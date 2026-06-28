"use client"

import { useSocket } from "../lib/socket-provider"

export function ClientList() {
  const { tenants } = useSocket()

  // Derive tenant list and sort by request count descending
  const clients = Object.entries(tenants)
    .map(([id, requests]) => ({
      id,
      name: id === "anonymous" ? "anonymous" : `tenant-${id.slice(0, 8)}`,
      requests
    }))
    .sort((a, b) => b.requests - a.requests)

  return (
    <section className="rounded-md border border-border bg-card p-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-foreground">Active clients</h2>
        <span className="text-xs text-muted-foreground">
          {clients.length} {clients.length === 1 ? "tenant" : "tenants"} active
        </span>
      </div>

      {clients.length === 0 ? (
        <div className="mt-6 text-center text-xs text-muted-foreground">
          No active clients in current session. Waiting for requests...
        </div>
      ) : (
        <ul className="mt-4">
          {clients.map((c, i) => (
            <li
              key={c.id}
              className={`flex items-center justify-between py-3 ${
                i !== 0 ? "border-t border-border" : ""
              }`}
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-foreground">{c.name}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {c.id}
                </span>
              </div>
              <span className="font-mono text-sm tabular-nums text-muted-foreground">
                {c.requests.toLocaleString()} reqs
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
