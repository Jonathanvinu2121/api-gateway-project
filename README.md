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
| Gateway runtime | Node.js 20 + Express | Lightweight, huge middleware ecosystem, matches the job-market stack this project targets |
| Auth | JWT (jsonwebtoken) + bcrypt | Stateless auth — gateway doesn't need a session store, just verifies signatures |
| Rate limit store | Redis (ioredis client) | Sub-millisecond key lookups; native `EXPIRE`/TTL semantics; Lua scripting for atomicity |
| Persistent store | MongoDB (Mongoose) | Flexible schema for heterogeneous request logs |
| Real-time stream | Socket.io | Push request/breaker events to dashboard without polling |
| Frontend | Next.js (App Router) + Tailwind v4 + custom SVG charts | Component structure originated from a v0 design export; charts hand-rolled in SVG rather than a charting library, kept the bundle light for a UI this simple |
| Mock services | Express (x2) | Simulate real upstreams with configurable latency/failure injection, runtime-adjustable via an admin-key-protected endpoint |
| Containerization | Docker + Docker Compose | One-command local spin-up: gateway + both mock services + Redis + MongoDB. Frontend runs separately via `npm run dev`, not containerized |
| Hosting (planned) | Render (gateway/services) + Vercel (frontend) | Both have functional free tiers compatible with this architecture |

Note: the original plan called for Vite + Recharts on the frontend. Partway through the build, a v0-generated design export (Next.js App Router, hand-rolled SVG charts) was adopted instead because it matched the intended minimal visual direction more precisely and didn't need restyling. The architecture diagram and request lifecycle below are otherwise unchanged from the original design.

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

**Dashboard tab** — live-updating view of the system: a throughput chart showing allowed vs blocked requests over a rolling 60-second window (built with hand-rolled SVG, accumulated via `useRef` counters read-and-reset on a 1-second interval to avoid losing or double-counting events between Socket.io messages), circuit breaker status cards per upstream service with color transitions on state change, a live tenant activity list derived from incoming events, and a color-coded scrolling event log.

**Playground tab** — a traffic generator authenticated via quick-register, manual JWT paste, or a seeded demo credential (see [seed.js](#getting-started)): pick a route, fire a single request / configurable burst / sustained load, see the full raw response (status, headers including `X-RateLimit-*`, latency, body), and a dedicated "Trip the Breaker" button that uses an admin-key-protected runtime endpoint to set a mock service's failure rate to 80%, hammers it with requests, and shows each one's real status and the breaker's reported state live in an output log — so the breaker's CLOSED → OPEN transition (and the rate limiter's behavior) can be watched and demonstrated end-to-end, with the Dashboard tab's status cards confirming the same state change visually in real time.

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

### Why a local Redis/MongoDB via Docker Compose, rather than managed cloud services?

The original plan called for Upstash (Redis REST API) and MongoDB Atlas specifically to keep the project deployable on free-tier hosts with potential outbound TCP restrictions. For local development and the verification process documented throughout this README, plain `redis:7-alpine` and `mongo:7` containers in Docker Compose were used instead — simpler to reason about while building and debugging (e.g. `mongosh` direct queries during verification), with no network dependency on an external service while iterating. The README's [Deployment](#deployment) section below still documents the Upstash/Atlas path for an actual public deployment, since that tradeoff (REST API sidesteps TCP restrictions on serverless/free-tier hosts) remains correct advice for that scenario — it just wasn't the path taken for local development and testing.

### Why log to MongoDB instead of just keeping metrics in memory?

In-memory metrics die on every deploy/restart and don't survive a multi-instance gateway (if this gateway were horizontally scaled, in-memory state wouldn't be shared across instances anyway). Persisting to Mongo means the dashboard's history survives restarts and the `/admin/metrics` aggregation reflects genuine historical data, not just "since the process last started." It's also what makes per-tenant breakdowns and longer-window analytics possible later.

### Why does the gateway need explicit CORS middleware, and how was the gap found?

Every backend route was built and tested via `curl` first — and `curl` does not enforce CORS, since CORS is a *browser* security mechanism, not an HTTP one. This meant the gateway worked perfectly through every command-line test across rate limiting, the circuit breaker, and the logging pipeline, while having a real, undetected bug: the Express app had no CORS middleware at all. Socket.io's connection (configured separately) worked fine, masking the gap further, since the dashboard's live data stream never touched the broken path.

The bug only surfaced once the Playground tab made its first real `fetch()` call from the browser — registration failed with a CORS error, confirmed via the browser's Network tab showing the preflight `OPTIONS` request succeeding but the actual `POST` being blocked. The fix was standard (the `cors` npm package, configured with an explicit allowed-origins list rather than a wildcard, since wildcard origins are incompatible with credentialed requests), but the discovery process is worth being able to explain: **command-line testing alone cannot validate browser-enforced security boundaries.** Any project with both a CLI-testable backend and a browser frontend needs at least one real browser-based request test before being considered verified, not just curl coverage.

### Why does the admin config endpoint use a simple shared secret instead of JWT auth?

The Playground's "Trip the Breaker" demo needs to adjust a mock service's failure-injection rate at runtime, via `POST /admin/configure/:service`. This endpoint *writes* — it can degrade a backend service's behavior — so it needed real auth, but full JWT/tenant auth would be the wrong tool here: this isn't a tenant-scoped action, it's a demo control surface that shouldn't be tied to any particular user's permissions.

The solution is a shared secret (`ADMIN_API_KEY`), checked via an `X-Admin-Key` header on both the gateway's forwarding route and the mock services' own `/configure` endpoints (defense at both layers, not just the gateway). The frontend reads the same value through a `NEXT_PUBLIC_*` environment variable, which means it's visible in browser devtools by design — this is intentional and worth stating plainly rather than treating as an oversight: **this key is a demo-only control, not a production security boundary.** In a real deployment, this endpoint either wouldn't exist publicly at all, or would sit behind real authenticated internal tooling, not a client-visible key.



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
docker compose up --build
```

This spins up: gateway (`:4000`), users-service (`:5001`), orders-service (`:5002`), Redis (`:6379`), MongoDB (`:27017`). Required gateway env vars (see `gateway/.env.example` for the full list with defaults): `PORT`, `USERS_SERVICE_URL`, `ORDERS_SERVICE_URL`, `MONGODB_URI`, `REDIS_URL`, `JWT_SECRET`, `CORS_ORIGIN` (comma-separated allowed frontend origins), `ADMIN_API_KEY` (shared secret for the Playground's runtime failure-rate control — must match the same value used by the frontend and both mock services).

Then seed demo tenants (one per pricing tier, with working credentials printed to console):
```bash
node gateway/seed.js
```

Frontend (runs separately, not containerized):
```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```
Note: the dev server defaults to port 3000, but will automatically fall back to 3001 (or the next free port) if something else is already using it — check the terminal output for the actual URL. `frontend/.env.local` needs `NEXT_PUBLIC_ADMIN_API_KEY` set to the same value as the gateway's `ADMIN_API_KEY`, and `NEXT_PUBLIC_GATEWAY_URL` (defaults to `http://localhost:4000`).

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
| GET | `/admin/metrics` | Aggregate throughput, block rate, breaker states. No auth (read-only, accepted gap for a portfolio project). |
| POST | `/admin/configure/:service` | Set a mock service's runtime failure-injection rate (0.0–1.0). Requires `X-Admin-Key` header matching `ADMIN_API_KEY`. Used by the Playground's "Trip the Breaker" flow. |
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
