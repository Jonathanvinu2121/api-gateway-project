"use client"

import { useState, useRef } from "react"
import { Button } from "./ui/button"

interface ResponseDetails {
  status: number
  statusText: string
  latencyMs: number
  headers: Record<string, string>
  body: string
  fetchedAt?: number
}

type StageState = 'pending' | 'passed' | 'failed'

interface PipelineState {
  auth: StageState
  rateLimit: StageState
  circuitBreaker: StageState
  proxy: StageState
}

function getPipelineStages(statusCode: number): PipelineState {
  if (statusCode === 0) {
    return {
      auth: 'pending',
      rateLimit: 'pending',
      circuitBreaker: 'pending',
      proxy: 'pending'
    }
  }

  if (statusCode === 401) {
    return {
      auth: 'failed',
      rateLimit: 'pending',
      circuitBreaker: 'pending',
      proxy: 'pending'
    }
  }

  if (statusCode === 429) {
    return {
      auth: 'passed',
      rateLimit: 'failed',
      circuitBreaker: 'pending',
      proxy: 'pending'
    }
  }

  if (statusCode === 503) {
    return {
      auth: 'passed',
      rateLimit: 'passed',
      circuitBreaker: 'failed',
      proxy: 'pending'
    }
  }

  if (statusCode >= 500 && statusCode < 600) {
    return {
      auth: 'passed',
      rateLimit: 'passed',
      circuitBreaker: 'passed',
      proxy: 'failed'
    }
  }

  return {
    auth: 'passed',
    rateLimit: 'passed',
    circuitBreaker: 'passed',
    proxy: 'passed'
  }
}

export function Playground() {
  // Authentication State
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [token, setToken] = useState("")
  const [authStatus, setAuthStatus] = useState("")

  // Picker State
  const [route, setRoute] = useState("/api/users/data")

  // Load Parameters
  const [burstCount, setBurstCount] = useState(10)
  const [sustainedRate, setSustainedRate] = useState(5)
  const [sustainedDuration, setSustainedDuration] = useState(3)

  // Output/Status State
  const [isRunning, setIsRunning] = useState(false)
  const [playgroundLogs, setPlaygroundLogs] = useState<string[]>([])
  const [lastResponse, setLastResponse] = useState<ResponseDetails | null>(null)

  // Visual Progress & Animation States
  const [activeAction, setActiveAction] = useState<"single" | "burst" | "sustained" | "breaker" | null>(null)
  const [lastAction, setLastAction] = useState<"single" | "burst" | "sustained" | "breaker" | null>(null)
  const [completedRequestCount, setCompletedRequestCount] = useState(0)
  const [totalRequestCount, setTotalRequestCount] = useState(0)

  const adminApiKey = process.env.NEXT_PUBLIC_ADMIN_API_KEY || "admin_demo_secret_key"
  const gatewayUrl = process.env.NEXT_PUBLIC_GATEWAY_URL || "http://localhost:4000"

  const addLog = (msg: string) => {
    setPlaygroundLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`])
  }

  // 1. Register and get token
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) return

    setAuthStatus("Registering...")
    try {
      // Register tenant
      const regRes = await fetch(`${gatewayUrl}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: email.split("@")[0] || "Demo Tenant", email, password })
      })

      if (!regRes.ok) {
        throw new Error(await regRes.text())
      }

      const regData = await regRes.json()
      setToken(regData.token)
      setAuthStatus(`Registered & Authenticated: Tenant ${regData.user.tenantId.slice(0, 8)} (${regData.user.tier})`)
      addLog("Tenant registered successfully. JWT Token acquired.")
    } catch (err: any) {
      console.error(err)
      setAuthStatus(`Registration failed: ${err.message}`)
      addLog(`Auth Error: ${err.message}`)
    }
  }

  // Helper to fire a single request and return raw response details
  const fireRequest = async (jwtToken: string): Promise<ResponseDetails> => {
    const start = Date.now()
    const targetUrl = `${gatewayUrl}${route}`
    
    try {
      const res = await fetch(targetUrl, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${jwtToken}`
        }
      })
      const latencyMs = Date.now() - start
      const headers: Record<string, string> = {}
      res.headers.forEach((val, key) => {
        headers[key] = val
      })
      
      const body = await res.text()
      let prettyBody = body
      try {
        prettyBody = JSON.stringify(JSON.parse(body), null, 2)
      } catch {}

      return {
        status: res.status,
        statusText: res.statusText,
        latencyMs,
        headers,
        body: prettyBody,
        fetchedAt: Date.now()
      }
    } catch (err: any) {
      const latencyMs = Date.now() - start
      return {
        status: 0,
        statusText: "Connection Failed",
        latencyMs,
        headers: {},
        body: `Failed to connect: ${err.message}`,
        fetchedAt: Date.now()
      }
    }
  }

  // 2. Single request
  const handleSingle = async () => {
    if (!token) {
      addLog("Error: Set token first before sending requests.")
      return
    }

    setIsRunning(true)
    setActiveAction("single")
    setLastAction("single")
    addLog(`Sending Single Request to ${route}...`)
    const res = await fireRequest(token)
    setLastResponse(res)
    addLog(`Finished Single Request. Status: ${res.status} (${res.latencyMs}ms)`)
    setIsRunning(false)
    setActiveAction(null)
  }

  // 3. Burst Load
  const handleBurst = async () => {
    if (!token) {
      addLog("Error: Set token first before sending requests.")
      return
    }

    setIsRunning(true)
    setActiveAction("burst")
    setLastAction("burst")
    setCompletedRequestCount(0)
    setTotalRequestCount(burstCount)
    addLog(`Firing Burst of ${burstCount} concurrent requests to ${route}...`)
    
    const promises = Array.from({ length: burstCount }, async () => {
      const res = await fireRequest(token)
      setCompletedRequestCount(prev => prev + 1)
      return res
    })
    const results = await Promise.all(promises)
    
    // Log summaries
    const statusCounts = results.reduce((acc, curr) => {
      acc[curr.status] = (acc[curr.status] || 0) + 1
      return acc
    }, {} as Record<number, number>)

    addLog(`Burst finished: ${JSON.stringify(statusCounts)}`)
    
    // Set last response to the slowest one to examine metrics
    if (results.length > 0) {
      setLastResponse(results[results.length - 1])
    }
    setIsRunning(false)
    setActiveAction(null)
  }

  // 4. Sustained Load
  const handleSustained = async () => {
    if (!token) {
      addLog("Error: Set token first before sending requests.")
      return
    }

    setIsRunning(true)
    setActiveAction("sustained")
    setLastAction("sustained")
    const totalRequests = sustainedRate * sustainedDuration
    setCompletedRequestCount(0)
    setTotalRequestCount(totalRequests)
    addLog(`Starting Sustained load: ${sustainedRate} reqs/sec for ${sustainedDuration} seconds...`)

    let requestCount = 0
    const results: ResponseDetails[] = []

    const intervalMs = 1000 / sustainedRate
    let timer: NodeJS.Timeout

    const sendNext = async () => {
      if (requestCount >= totalRequests) {
        clearInterval(timer)
        addLog(`Sustained load finished. Fired ${requestCount} requests total.`)
        setIsRunning(false)
        setActiveAction(null)
        return
      }

      requestCount++
      const res = await fireRequest(token)
      results.push(res)
      setLastResponse(res)
      setCompletedRequestCount(prev => prev + 1)
    }

    timer = setInterval(sendNext, intervalMs)
  }

  // 5. Trip the Breaker centerpiece demo
  const handleTripBreaker = async () => {
    if (!token) {
      addLog("Error: Authenticate first to run trip-breaker flow.")
      return
    }

    setIsRunning(true)
    setActiveAction("breaker")
    setLastAction("breaker")
    setCompletedRequestCount(0)
    setTotalRequestCount(8)
    const service = route.includes("users") ? "users" : "orders"
    addLog(`[Flow] Starting Trip Breaker flow for service '${service}'...`)

    try {
      // Step A: Set Failure Rate to 80% on mock upstream service via Admin configuration
      addLog(`[Flow] Setting failure rate of ${service}-service to 80% (0.8)...`)
      const configRes = await fetch(`${gatewayUrl}/admin/configure/${service}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Key": adminApiKey
        },
        body: JSON.stringify({ failureRate: 0.8 })
      })

      if (!configRes.ok) {
        throw new Error(`Configure failed: ${await configRes.text()}`)
      }
      addLog(`[Flow] Configuration verified. Upstream service failure rate is now 80%.`)

      // Step B: Send rapid requests (consecutively) to trigger circuit breaker OPEN transition
      addLog(`[Flow] Sending 8 rapid requests to force consecutive failures...`)
      for (let i = 1; i <= 8; i++) {
        const res = await fireRequest(token)
        setLastResponse(res)
        setCompletedRequestCount(i)
        addLog(`[Flow] Hammer request #${i}: Status ${res.status} | Breaker Header: ${res.headers["x-circuit-state"] || "CLOSED"}`)
        
        if (res.headers["x-circuit-state"] === "OPEN") {
          addLog(`[Flow] Success! Breaker transitioned to OPEN state.`)
          break
        }
        await new Promise((r) => setTimeout(r, 100))
      }

      // Step C: Heal service back to 0.0 failure rate
      addLog(`[Flow] Restoring failure rate of ${service}-service back to healthy (0.0)...`)
      const restoreRes = await fetch(`${gatewayUrl}/admin/configure/${service}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Admin-Key": adminApiKey
        },
        body: JSON.stringify({ failureRate: 0.0 })
      })

      if (!restoreRes.ok) {
        throw new Error(`Heal failed: ${await restoreRes.text()}`)
      }
      addLog(`[Flow] Service healed to 0.0 failure rate. Breaker is in cooldown period before recovering.`)

    } catch (err: any) {
      console.error(err)
      addLog(`[Flow Error] ${err.message}`)
    } finally {
      setIsRunning(false)
      setActiveAction(null)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Configuration & Controls */}
      <div className="flex flex-col gap-6 lg:col-span-2">
        {/* Auth Box */}
        <section className="rounded-md border border-border bg-card p-6">
          <h2 className="text-sm font-medium text-foreground">1. Client credentials (JWT)</h2>
          
          <form onSubmit={handleRegister} className="mt-4 flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <input
                type="email"
                placeholder="email@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none"
              />
              <input
                type="password"
                placeholder="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none"
              />
            </div>
            
            <Button
              type="submit"
              disabled={isRunning}
              className="h-9 w-full bg-primary hover:bg-primary/90 text-foreground text-xs font-semibold"
            >
              Register & Get Token
            </Button>
            
            <div className="flex items-center justify-center mt-1">
              <span className="text-[11px] text-muted-foreground">or paste token below:</span>
            </div>
          </form>

          <textarea
            placeholder="Paste raw JWT string..."
            value={token}
            onChange={(e) => {
              setToken(e.target.value)
              setAuthStatus("Pasted custom JWT token manually.")
            }}
            className="mt-4 h-16 w-full rounded border border-border bg-background p-2 font-mono text-[11px] text-foreground focus:outline-none resize-none"
          />

          {authStatus && (
            <div className="mt-3 text-xs font-mono text-success">
              {authStatus}
            </div>
          )}
        </section>

        {/* Load Patterns Box */}
        <section className="rounded-md border border-border bg-card p-6">
          <h2 className="text-sm font-medium text-foreground">2. Route & Request Generator</h2>

          <div className="mt-4 flex items-center justify-between border-b border-border pb-4">
            <span className="text-xs text-muted-foreground">Target Route:</span>
            <div className="flex gap-2">
              <button
                onClick={() => setRoute("/api/users/data")}
                className={`rounded px-3 py-1 text-xs font-mono transition-colors ${
                  route === "/api/users/data" ? "bg-muted text-foreground border border-muted-foreground" : "bg-transparent text-muted-foreground border border-transparent"
                }`}
              >
                /api/users/data
              </button>
              <button
                onClick={() => setRoute("/api/orders/data")}
                className={`rounded px-3 py-1 text-xs font-mono transition-colors ${
                  route === "/api/orders/data" ? "bg-muted text-foreground border border-muted-foreground" : "bg-transparent text-muted-foreground border border-transparent"
                }`}
              >
                /api/orders/data
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Load Actions */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-medium text-muted-foreground uppercase">Load Patterns</h3>
                {activeAction && activeAction !== "single" && (
                  <span className="text-[10px] font-mono text-warning font-semibold animate-pulse">
                    Sending... {completedRequestCount} / {totalRequestCount}
                  </span>
                )}
              </div>
              
              <div className="flex flex-col gap-2">
                <Button
                  onClick={handleSingle}
                  disabled={isRunning}
                  className="h-8 text-xs justify-start flex items-center gap-1.5"
                >
                  {activeAction === "single" && (
                    <svg className="animate-spin h-3 w-3 text-current" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  )}
                  Single Request
                </Button>

                <div className="flex gap-2">
                  <Button
                    onClick={handleBurst}
                    disabled={isRunning}
                    className="h-8 text-xs flex-1 flex items-center justify-center gap-1.5"
                  >
                    {activeAction === "burst" && (
                      <svg className="animate-spin h-3 w-3 text-current" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    )}
                    {activeAction === "burst" ? `Bursting (${completedRequestCount}/${totalRequestCount})` : `Burst (${burstCount})`}
                  </Button>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={burstCount}
                    onChange={(e) => setBurstCount(Number(e.target.value))}
                    className="w-12 rounded border border-border bg-background text-center text-xs font-mono text-foreground focus:outline-none"
                  />
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={handleSustained}
                    disabled={isRunning}
                    className="h-8 text-xs flex-1 flex items-center justify-center gap-1.5"
                  >
                    {activeAction === "sustained" && (
                      <svg className="animate-spin h-3 w-3 text-current" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    )}
                    {activeAction === "sustained" ? `Sending (${completedRequestCount}/${totalRequestCount})` : `Sustained (${sustainedRate} req/s)`}
                  </Button>
                  <div className="flex gap-1 items-center">
                    <input
                      type="number"
                      min="1"
                      value={sustainedRate}
                      onChange={(e) => setSustainedRate(Number(e.target.value))}
                      className="w-10 rounded border border-border bg-background text-center text-xs font-mono text-foreground focus:outline-none"
                      title="Rate (requests per second)"
                    />
                    <span className="text-[10px] text-muted-foreground">req for</span>
                    <input
                      type="number"
                      min="1"
                      value={sustainedDuration}
                      onChange={(e) => setSustainedDuration(Number(e.target.value))}
                      className="w-10 rounded border border-border bg-background text-center text-xs font-mono text-foreground focus:outline-none"
                      title="Duration (seconds)"
                    />
                    <span className="text-[10px] text-muted-foreground">sec</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Breaker Centering Demo */}
            <div className="flex flex-col gap-3 border-t border-border pt-4 md:border-t-0 md:border-l md:border-border md:pl-4 md:pt-0">
              <h3 className="text-xs font-medium text-muted-foreground uppercase">Interactive Demo</h3>
              <p className="text-[11px] text-muted-foreground leading-normal">
                Toggles Failure Rate to 80%, executes rapid requests to trigger the state transition to <span className="text-alert">OPEN</span>, and heals the service back to 0%.
              </p>
              <Button
                onClick={handleTripBreaker}
                disabled={isRunning}
                className="h-9 w-full bg-alert hover:bg-alert/90 text-foreground text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                {activeAction === "breaker" && (
                  <svg className="animate-spin h-3 w-3 text-current" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                )}
                {activeAction === "breaker" ? `Tripping Breaker (${completedRequestCount}/${totalRequestCount})` : "Trip the Breaker"}
              </Button>
            </div>
          </div>
        </section>

        {/* Logs Panel */}
        <section className="rounded-md border border-border bg-card p-6 flex-1 flex flex-col min-h-48">
          <h2 className="text-sm font-medium text-foreground">Playground output log</h2>
          
          <div className="mt-3 flex-1 h-36 overflow-y-auto rounded border border-border bg-background p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {playgroundLogs.length === 0 ? (
              <span className="text-muted-foreground/40">Waiting for actions...</span>
            ) : (
              playgroundLogs.map((l, i) => {
                const isBreakerOpenMsg = l.includes("Breaker transitioned to OPEN state") || l.includes("Success! Breaker transitioned to OPEN")
                return (
                  <div
                    key={i}
                    className={`px-1 py-0.5 rounded ${
                      isBreakerOpenMsg
                        ? "animate-breaker-pulse text-alert font-bold"
                        : "animate-log-flash"
                    }`}
                  >
                    {l}
                  </div>
                )
              })
            )}
          </div>
        </section>
      </div>

      {/* Response Panel */}
      <div className="flex flex-col lg:col-span-1">
        <section className="flex h-full flex-col rounded-md border border-border bg-card p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">Live response panel</h2>
            {lastResponse && (
              <div key={lastResponse.fetchedAt} className="flex gap-1 bg-background/40 p-0.5 rounded border border-border/40">
                {([200, 401, 429, 503] as const).map((code) => {
                  const isActive = lastResponse.status === code
                  let animationClass = ""
                  if (isActive) {
                    if (code === 200) animationClass = "animate-badge-200"
                    if (code === 401 || code === 429) animationClass = "animate-badge-warning"
                    if (code === 503) animationClass = "animate-badge-503"
                  } else {
                    animationClass = "opacity-30 text-muted-foreground bg-muted/10"
                  }
                  return (
                    <span
                      key={code}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition-all duration-300 ${animationClass}`}
                    >
                      {code}
                    </span>
                  )
                })}
              </div>
            )}
          </div>

          {!lastResponse ? (
            <div className="mt-6 flex flex-1 items-center justify-center rounded border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              No response data available. Send requests using load patterns.
            </div>
          ) : (
            <div key={lastResponse.fetchedAt} className="animate-fade-in-slide mt-4 flex-1 flex flex-col gap-4 font-mono text-[11px]">
              
              {/* Pipeline Panel */}
              {lastAction === "single" && (
                <div className="rounded border border-border bg-background/50 p-3">
                  <span className="text-muted-foreground uppercase text-[10px] block mb-2 font-semibold">Request Execution Pipeline</span>
                  <div className="flex items-center justify-between gap-1 text-[10px] font-semibold">
                    {(() => {
                      const stages = getPipelineStages(lastResponse.status)
                      const renderStage = (label: string, state: 'pending' | 'passed' | 'failed') => {
                        let bgClass = "bg-muted/30 text-muted-foreground/50 border-muted/20"
                        let indicator = "●"
                        if (state === "passed") {
                          bgClass = "bg-success/10 text-success border-success/30"
                          indicator = "✓"
                        } else if (state === "failed") {
                          bgClass = "bg-alert/10 text-alert border-alert/30 animate-shake"
                          indicator = "✗"
                        }
                        
                        return (
                          <div className={`flex flex-col items-center flex-1 py-1 px-0.5 rounded border text-center font-mono ${bgClass}`}>
                            <span className="text-[10px] font-bold">{indicator} {label}</span>
                            <span className="text-[7px] uppercase tracking-wider text-muted-foreground mt-0.5">{state}</span>
                          </div>
                        )
                      }
                      
                      return (
                        <>
                          {renderStage("Auth", stages.auth)}
                          <span className="text-muted-foreground/30">→</span>
                          {renderStage("Rate Limit", stages.rateLimit)}
                          <span className="text-muted-foreground/30">→</span>
                          {renderStage("Breaker", stages.circuitBreaker)}
                          <span className="text-muted-foreground/30">→</span>
                          {renderStage("Proxy", stages.proxy)}
                        </>
                      )
                    })()}
                  </div>
                </div>
              )}

              <div>
                <span className="text-muted-foreground uppercase text-[10px] block">Status Code</span>
                <span className={`text-sm font-semibold ${
                  lastResponse.status >= 500 ? "text-alert" : lastResponse.status >= 400 ? "text-warning" : "text-success"
                }`}>
                  {lastResponse.status} {lastResponse.statusText}
                </span>
              </div>

              <div>
                <span className="text-muted-foreground uppercase text-[10px] block">Latency</span>
                <span className="text-foreground">{lastResponse.latencyMs}ms</span>
              </div>

              <div>
                <span className="text-muted-foreground uppercase text-[10px] block mb-1">Key Headers</span>
                <div className="rounded border border-border bg-background p-2 overflow-x-auto leading-normal text-muted-foreground max-h-40">
                  {Object.entries(lastResponse.headers).map(([key, val]) => {
                    const isKeyHeader = key.startsWith("x-ratelimit") || key === "x-circuit-state" || key === "retry-after"
                    return (
                      <div key={key} className={isKeyHeader ? "text-foreground font-semibold" : ""}>
                        {key}: {val}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="flex-1 flex flex-col min-h-36">
                <span className="text-muted-foreground uppercase text-[10px] block mb-1">Response Body</span>
                <pre className="flex-1 rounded border border-border bg-background p-2 overflow-y-auto overflow-x-auto text-[10px] text-foreground max-h-72 select-text whitespace-pre-wrap">
                  {lastResponse.body}
                </pre>
              </div>
            </div>
          )}
        </section>
      </div>
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes logFlash {
          0% { background-color: rgba(59, 130, 246, 0.25); }
          100% { background-color: transparent; }
        }
        .animate-log-flash {
          animation: logFlash 500ms ease-out forwards;
        }

        @keyframes breakerPulse {
          0% { background-color: rgba(239, 68, 68, 0.4); transform: scale(1); }
          50% { background-color: rgba(239, 68, 68, 0.2); transform: scale(1.02); }
          100% { background-color: transparent; transform: scale(1); }
        }
        .animate-breaker-pulse {
          animation: breakerPulse 800ms ease-in-out 3;
        }

        @keyframes badge200 {
          0% { background-color: rgb(34, 197, 94); color: #fff; box-shadow: 0 0 10px rgba(34, 197, 94, 0.6); transform: scale(1.1); }
          50% { background-color: rgb(34, 197, 94); color: #fff; box-shadow: 0 0 10px rgba(34, 197, 94, 0.6); transform: scale(1.1); }
          100% { background-color: rgba(34, 197, 94, 0.2); color: rgb(34, 197, 94); box-shadow: none; transform: scale(1); }
        }
        .animate-badge-200 {
          animation: badge200 1000ms ease-out forwards;
        }

        @keyframes badgeWarning {
          0% { background-color: rgb(234, 179, 8); color: #fff; box-shadow: 0 0 10px rgba(234, 179, 8, 0.6); transform: scale(1.1); }
          50% { background-color: rgb(234, 179, 8); color: #fff; box-shadow: 0 0 10px rgba(234, 179, 8, 0.6); transform: scale(1.1); }
          100% { background-color: rgba(234, 179, 8, 0.2); color: rgb(234, 179, 8); box-shadow: none; transform: scale(1); }
        }
        .animate-badge-warning {
          animation: badgeWarning 1000ms ease-out forwards;
        }

        @keyframes badge503 {
          0% { background-color: rgb(239, 68, 68); color: #fff; box-shadow: 0 0 10px rgba(239, 68, 68, 0.6); transform: scale(1.1); }
          50% { background-color: rgb(239, 68, 68); color: #fff; box-shadow: 0 0 10px rgba(239, 68, 68, 0.6); transform: scale(1.1); }
          100% { background-color: rgba(239, 68, 68, 0.2); color: rgb(239, 68, 68); box-shadow: none; transform: scale(1); }
        }
        .animate-badge-503 {
          animation: badge503 1000ms ease-out forwards;
        }

        @keyframes fadeInSlide {
          0% { opacity: 0; transform: translateY(4px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in-slide {
          animation: fadeInSlide 300ms ease-out forwards;
        }

        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-3px); }
          75% { transform: translateX(3px); }
        }
        .animate-shake {
          animation: shake 250ms ease-in-out 2;
        }
      `}} />
    </div>
  )
}
