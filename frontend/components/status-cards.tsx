"use client"

import { useSocket } from "../lib/socket-provider"

type State = "healthy" | "warning" | "alert"

interface ServiceDisplay {
  name: string
  state: State
  label: string
  detail: string
}

const DOT: Record<State, string> = {
  healthy: "bg-success",
  warning: "bg-warning",
  alert: "bg-alert",
}

const TEXT: Record<State, string> = {
  healthy: "text-success",
  warning: "text-warning",
  alert: "text-alert",
}

export function StatusCards() {
  const { breakerStates } = useSocket()

  const services: ServiceDisplay[] = [
    {
      name: "users",
      state: breakerStates.users === "OPEN" ? "alert" : breakerStates.users === "HALF_OPEN" ? "warning" : "healthy",
      label: breakerStates.users,
      detail: breakerStates.users === "OPEN" 
        ? "circuit open · short-circuited" 
        : breakerStates.users === "HALF_OPEN" 
        ? "half-open · testing recovery" 
        : "circuit closed · operational"
    },
    {
      name: "orders",
      state: breakerStates.orders === "OPEN" ? "alert" : breakerStates.orders === "HALF_OPEN" ? "warning" : "healthy",
      label: breakerStates.orders,
      detail: breakerStates.orders === "OPEN" 
        ? "circuit open · short-circuited" 
        : breakerStates.orders === "HALF_OPEN" 
        ? "half-open · testing recovery" 
        : "circuit closed · operational"
    }
  ]

  return (
    <section className="flex h-full flex-col gap-3">
      {services.map((s) => (
        <div
          key={s.name}
          className="flex flex-1 items-center justify-between rounded-md border border-border bg-card px-5 py-4"
        >
          <div className="flex flex-col gap-1">
            <span className="font-mono text-sm text-foreground">{s.name}</span>
            <span className="text-xs text-muted-foreground">{s.detail}</span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${DOT[s.state]}`}
              aria-hidden="true"
            />
            <span className={`text-xs font-semibold uppercase ${TEXT[s.state]}`}>{s.label}</span>
          </div>
        </div>
      ))}
    </section>
  )
}
