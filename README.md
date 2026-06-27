# API Gateway & Distributed Rate Limiter

A centralized API gateway demonstrating production-grade distributed systems patterns: JWT-based multi-tenant auth, dynamic request routing, Redis-backed rate limiting (token bucket + sliding window), and a hand-rolled circuit breaker for fault tolerance — with a live dashboard and traffic playground to watch it all work in real time.

**Live demo:** `<add your deployed link here>`
**Demo video:** `<add a 60-90s screen recording link here — this matters more than the live link if Render free tier has cold starts>`

---

## Table of Contents

- [Why This Project](#why-this-project)
- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Core Features](#core-features)
- [Key Design Decisions](#key-design-decisions)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Deployment](#deployment)
- [API Reference](#api-reference)
- [What I'd Do Differently at Scale](#what-id-do-differently-at-scale)

---

## Why This Project

Every backend tutorial builds a CRUD app. This project builds the thing that sits *in front of* CRUD apps — the layer real companies pay for: Kong, AWS API Gateway, Cloudflare's rate limiter. The goal was to implement the actual algorithms (not just call a library) for the two hardest parts of that layer:

1. **Rate limiting that's correct under concurrency** — most rate limiter demos use `INCR` + `EXPIRE` as two Redis calls, which has a race condition. This implementation uses atomic Lua scripts instead.
2. **Fault tolerance that doesn't waste resources** — when a downstream service is dying, a gateway shouldn't keep hammering it and timing out slowly. It should fail fast.

---

## Architecture Overview

```
                                   ┌─────────────────┐
                                   │   React Frontend │
                                   │ Dashboard + Play  │
                                   └─────────┬────────┘
                                             │ HTTPS + WebSocket
                                             ▼
                          ┌──────────────────────────────────┐
                          │            API GATEWAY            │
                          │  ┌──────────────────────────────┐ │
  Client/Tenant ────────▶│  │  1. JWT Auth Middleware       │ │
  Request                │  ├──────────────────────────────┤ │
                          │  │  2. Dynamic Router            │ │
                          │  ├──────────────────────────────┤ │
                          │  │  3. Rate Limiter              │ │──────▶ Redis
                          │  │     (Token Bucket /           │ │      (Upstash)
                          │  │      Sliding Window,           │ │      Lua scripts,
                          │  │      via Lua scripts)         │ │      keyed by
                          │  ├──────────────────────────────┤ │      tenant:route
                          │  │  4. Circuit Breaker           │ │
                          │  │     (CLOSED/OPEN/HALF_OPEN    │ │
                          │  │      per upstream)            │ │
                          │  ├──────────────────────────────┤ │
                          │  │  5. Proxy + Logger            │ │──────▶ MongoDB
                          │  └──────────────────────────────┘ │      (Atlas)
                          └───────────┬──────────────┬─────────┘      request logs,
                                      │              │                tenants, users
                         ┌────────────┘              └────────────┐
                         ▼                                        ▼
                ┌──────────────────┐                    ┌──────────────────┐
                │  users-service    │                    │  orders-service   │
                │  (mock, injects   │                    │  (mock, injects   │
                │  latency/failures)│                    │  latency/failures)│
                └──────────────────┘                    └──────────────────┘
```

**Request lifecycle through the gateway:**

```
Request → JWT verify → Resolve tenant + tier → Rate limit check (Redis, ~1-5ms)
        → [429 if blocked] → Circuit breaker check (in-memory, per upstream)
        → [503 if OPEN] → Proxy to upstream → Log to MongoDB
        → Stream event via WebSocket → Response to client
```

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Gateway runtime | Node.js + Express | Lightweight, huge middleware ecosystem, matches the job-market stack this project targets |
| Auth | JWT (jsonwebtoken) + bcrypt | Stateless auth — gateway doesn't need a session store, just verifies signatures |
| Rate limit store | Redis (Upstash, free tier) | Sub-millisecond key lookups; native `EXPIRE`/TTL semantics; Lua scripting for atomicity |
| Persistent store | MongoDB (Atlas, free tier) | Flexible schema for heterogeneous request logs; easy free-tier hosting |
| Real-time stream | Socket.io | Push request/breaker events to dashboard without polling |
| Frontend | React + Vite + Tailwind + Recharts | Fast dev loop, utility CSS for a dense dashboard UI, Recharts for the live charts |
| Mock services | Express (x2) | Simulate real upstreams with configurable latency/failure injection |
| Containerization | Docker + Docker Compose | One-command local spin-up: gateway + services + local Redis + local Mongo |
| Hosting | Render (gateway/services) + Vercel (frontend) | Both have functional free tiers compatible with this architecture |

---

## Core Features

### 1. Multi-Tenant JWT Auth
- Tenants have a **plan tier** (`free` / `pro` / `enterprise`) that maps directly to rate-limit configuration
- JWT carries `tenantId` and `tier` as claims — no extra DB lookup needed per request to know *who's* calling and *what they're entitled to*

### 2. Dynamic Routing
- Routes are config-driven (stored in Mongo, cached in memory), not hardcoded in Express route definitions
- Each route maps a path prefix to an upstream URL, plus per-route overrides: timeout, retry count, rate-limit algorithm, rate-limit thresholds
- Routes can be added/updated via an admin endpoint without restarting the gateway process

### 3. Dual Rate Limiting Algorithms (selectable per route)

| Algorithm | Behavior | Best for |
|---|---|---|
| **Token Bucket** | Bucket holds N tokens, refills at rate R/sec, each request consumes 1 token | Bursty traffic — lets a client briefly exceed average rate as long as they've "saved up" tokens |
| **Sliding Window Counter** | Tracks request count across a rolling time window (not fixed buckets) | Strict, precise limits — no boundary-exploitation like fixed windows allow |

Both are implemented as **atomic Redis Lua scripts**, keyed by `ratelimit:{tenantId}:{routePrefix}` — so tenant A's traffic on `/api/orders` never affects tenant B's quota or tenant A's quota on `/api/users`.

### 4. Circuit Breaker (hand-rolled state machine)
- Per-upstream-service breaker, not global — `orders-service` can be OPEN while `users-service` stays CLOSED
- **CLOSED** → normal operation, failures counted in a rolling window
- **OPEN** → trips after N consecutive failures or error rate exceeds threshold; all requests short-circuit immediately with `503` (no wasted timeout waiting on a dying service)
- **HALF_OPEN** → after a cooldown period, allows a small number of trial requests through; success → back to CLOSED, failure → back to OPEN
- State transitions are emitted as events, visible live on the dashboard

### 5. Observability
- Every request logged to MongoDB: tenant, route, status, latency, rate-limit decision, breaker state at request time
- Live WebSocket stream of these events powers the dashboard's request feed and charts
- `/admin/metrics` aggregates throughput, block rate, per-tenant breakdown, current breaker states

### 6. Frontend: Dashboard + Playground

**Dashboard tab** — live-updating view of the system: throughput chart (allowed vs blocked), circuit breaker state cards with transition animations, per-tenant quota bars, scrolling color-coded event log, and a latency sparkline for the rate-limit check itself.

**Playground tab** — a traffic generator: pick a tenant and route, fire a single request / burst / sustained load / chaos pattern, see the raw response (status, headers, latency), and a dedicated "trip the breaker" button that hammers a route until the mock service's failure rate trips it — so the dashboard's state change can be watched live.

---

## Key Design Decisions

*(This section is written so I can defend every choice out loud in an interview — not just describe what the code does, but why it does it that way.)*

### Why Lua scripts instead of `INCR` + `EXPIRE`?

The naive rate limiter does:
```
count = INCR(key)
if count == 1: EXPIRE(key, window)
if count > limit: reject
```
This is **two separate round trips** to Redis. Between the `INCR` and the `EXPIRE`, or between two concurrent requests both reading `count`, there's a race window. Under real concurrent load (which a gateway by definition has — that's its whole job), this can let more requests through than the limit allows, or in rarer cases mis-set the TTL.

A Lua script runs **atomically** on the Redis server — the entire check-and-increment logic executes as one indivisible operation, no other client's commands can interleave. This is the difference between "works in a demo with one curl request" and "works under the concurrent load a gateway actually sees." I pre-load the script with `SCRIPT LOAD` and call it via `EVALSHA` (not `EVAL`) to avoid re-sending the script body on every single request — `EVALSHA` just sends a hash, which matters once you're doing this on every request through the gateway.

### Why implement both token bucket AND sliding window, instead of picking one?

Because they solve different problems and a real gateway needs both:

- **Token bucket** is *permissive of bursts*. If a client tier allows 100 req/min on average but they want to fire 20 requests in the first second because they just loaded a page with 20 API calls, token bucket allows it (assuming they had tokens saved up) — then makes them wait as the bucket drains. This is the right model for **client-facing APIs** where bursty UI behavior is normal.
- **Sliding window** is *strict*. It doesn't care about bursts — it counts exactly how many requests happened in the trailing N seconds, with no boundary trick. (Fixed windows have a known flaw: a client can send the full quota at 11:59:59 and another full quota at 12:00:01, doubling their effective rate across the boundary. Sliding window eliminates that.) This is the right model for **protecting expensive backend operations** — e.g., a route that hits a paid third-party API per call, where you need a hard, precise ceiling.

Making the algorithm a per-route config choice (rather than a global gateway setting) reflects how this actually gets used in practice: a single gateway fronts routes with very different traffic shapes and cost profiles.

### Why a hand-rolled circuit breaker instead of `opossum`?

`opossum` is the right call in a real production codebase — no reason to reinvent a well-tested library. For a learning/portfolio project, though, hand-rolling it means I actually understand the state machine rather than being able to say "I imported a circuit breaker." The implementation:

- Tracks failures in a rolling window (not just a raw counter that never resets) so transient blips don't permanently trip the breaker
- Trips to OPEN on either N consecutive failures *or* an error-rate threshold over the window — consecutive-failure tripping catches a hard outage fast; error-rate tripping catches a degraded-but-not-dead service
- HALF_OPEN allows a small number of trial requests rather than flipping straight back to CLOSED, so recovery is verified gradually instead of potentially re-opening the floodgates onto a still-recovering service

The core interview-defensible point: **a circuit breaker's job isn't to prevent failures, it's to fail fast instead of failing slow.** Without it, a dying upstream causes the gateway to hang on timeouts for every request routed to it, which under load can exhaust the gateway's own connection pool and take down a healthy part of the system too. OPEN-state short-circuiting turns a slow cascading failure into a fast, contained one.

### Why per-tenant *and* per-route rate-limit keys, not just per-tenant?

If limits were only per-tenant, one expensive route could exhaust a tenant's entire quota and starve every other route they use. Keying by `tenantId:routePrefix` means tenant isolation is real (no noisy-tenant problem) *and* route isolation is real (no noisy-route problem) — both axes matter in a multi-tenant system.

### Why Upstash (Redis REST API) instead of a raw TCP Redis client?

Some free-tier hosts (and many serverless environments) restrict outbound non-HTTP TCP connections, or make persistent TCP connections from a serverless function awkward (connection-per-invocation overhead). Upstash exposes Redis over a REST API, which sidesteps that entirely and keeps the project deployable on free infrastructure without a "works locally, breaks in prod" gap. The tradeoff — REST has slightly higher per-call latency than raw TCP — is acceptable here and is exactly the kind of cost/latency tradeoff worth being able to articulate.

### Why log to MongoDB instead of just keeping metrics in memory?

In-memory metrics die on every deploy/restart and don't survive a multi-instance gateway (if this gateway were horizontally scaled, in-memory state wouldn't be shared across instances anyway). Persisting to Mongo means the dashboard's history survives restarts and the `/admin/metrics` aggregation reflects genuine historical data, not just "since the process last started." It's also what makes per-tenant breakdowns and longer-window analytics possible later.

---

## Project Structure

```
.
├── gateway/                 # The core API gateway
│   ├── src/
│   │   ├── middleware/
│   │   │   ├── auth.js              # JWT verification
│   │   │   ├── rateLimiter.js       # Token bucket + sliding window dispatch
│   │   │   └── circuitBreaker.js    # State machine
│   │   ├── lua/
│   │   │   ├── tokenBucket.lua
│   │   │   └── slidingWindow.lua
│   │   ├── routes/
│   │   │   ├── auth.routes.js
│   │   │   ├── admin.routes.js      # route config CRUD, metrics
│   │   │   └── proxy.routes.js      # catch-all dynamic proxy
│   │   ├── sockets/
│   │   │   └── eventStream.js       # Socket.io emitter
│   │   ├── models/                  # Mongoose schemas: Tenant, User, Route, RequestLog
│   │   └── server.js
│   ├── Dockerfile
│   └── .env.example
├── services/
│   ├── users-service/        # Mock upstream #1
│   └── orders-service/       # Mock upstream #2
├── frontend/
│   ├── src/
│   │   ├── pages/Dashboard.jsx
│   │   ├── pages/Playground.jsx
│   │   ├── components/
│   │   └── lib/socket.js
│   └── vite.config.js
├── shared/                   # Shared constants/types between gateway and services
├── docker-compose.yml
├── seed.js                   # Creates demo tenants at free/pro/enterprise tiers
└── README.md
```

---

## Getting Started

### Local development (Docker Compose — recommended)

```bash
git clone <your-repo-url>
cd api-gateway-project
cp gateway/.env.example gateway/.env
docker-compose up --build
```

This spins up: gateway (`:4000`), users-service (`:5001`), orders-service (`:5002`), local Redis (`:6379`), local MongoDB (`:27017`).

Then seed demo data:
```bash
node seed.js
```

Frontend:
```bash
cd frontend
npm install
npm run dev
```

### Manual setup (without Docker)

Requires local Redis and MongoDB running, or Upstash/Atlas connection strings in `.env`.

```bash
# Gateway
cd gateway && npm install && npm run dev

# Mock services (separate terminals)
cd services/users-service && npm install && npm run dev
cd services/orders-service && npm install && npm run dev

# Frontend
cd frontend && npm install && npm run dev
```

---

## Deployment

**Backend (gateway + mock services) → Render free tier**
1. Push repo to GitHub
2. Create 3 Render Web Services (gateway, users-service, orders-service), each pointed at its subdirectory
3. Set environment variables on each (Mongo URI, Redis/Upstash URL, JWT secret, upstream URLs pointing at the *other* Render services' public URLs)
4. Note: free-tier Render services spin down after inactivity — first request after idle will be slow (cold start). Either accept this for a portfolio demo (mention it in the video) or ping `/health` periodically with a free uptime monitor.

**Database → MongoDB Atlas free tier (M0, 512MB)**
- Create a free cluster, whitelist `0.0.0.0/0` for simplicity (fine for a portfolio project, call out that you'd restrict this in production)

**Redis → Upstash free tier**
- Create a free Redis database, use the REST URL + token with `@upstash/redis`

**Frontend → Vercel free tier**
- Connect repo, set root directory to `/frontend`, set `VITE_GATEWAY_URL` env var to the deployed gateway's public URL

---

## API Reference

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | Create user + tenant |
| POST | `/auth/login` | Returns JWT |

### Gateway (proxied, auth required)
| Method | Path | Description |
|---|---|---|
| ANY | `/api/:service/*` | Routed to configured upstream based on `:service` prefix |

Response headers on every rate-limited route:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1719500000
```
On block: `429 Too Many Requests` + `Retry-After: <seconds>`

### Admin
| Method | Path | Description |
|---|---|---|
| GET | `/admin/metrics` | Aggregate throughput, block rate, breaker states |
| GET | `/admin/routes` | List configured routes |
| POST | `/admin/routes` | Add/update a route (path, upstream, timeout, rate-limit config) |

### WebSocket
| Event | Payload | Description |
|---|---|---|
| `request:logged` | `{ tenant, route, status, latency, rateLimitDecision, breakerState }` | Emitted per completed request |
| `breaker:transition` | `{ service, from, to }` | Emitted on circuit breaker state change |

---

## What I'd Do Differently at Scale

Worth being upfront about in an interview — these are the corners cut for a free-tier portfolio project, and what changes in a real production deployment:

- **Horizontal scaling**: the circuit breaker state here is in-memory per gateway instance. With multiple gateway instances behind a load balancer, breaker state would need to move to Redis too (or use a gossip/shared-state approach) so all instances agree on whether a service is tripped.
- **Redis as a single point of failure**: a real deployment would use Redis Cluster or a managed multi-AZ Redis, not a single free-tier instance.
- **Config hot-reload**: route config is cached in memory and refreshed on an interval; a production system would use pub/sub (Redis or otherwise) to invalidate the cache instantly on config change instead of waiting for the next poll.
- **Observability**: structured logs to Mongo are fine for a demo; production would want this in a time-series store (Prometheus/Grafana, or a hosted equivalent) built for that access pattern, with Mongo poorly suited to high-cardinality metric queries at scale.
