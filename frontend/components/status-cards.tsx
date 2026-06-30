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
              key={`dot-${s.label}`}
              className={`h-2 w-2 rounded-full transition-all duration-300 ${DOT[s.state]} animate-dot-pulse`}
              style={{ color: s.state === 'alert' ? 'rgb(239, 68, 68)' : s.state === 'warning' ? 'rgb(234, 179, 8)' : 'rgb(34, 197, 94)' }}
              aria-hidden="true"
            />
            <span
              key={`text-${s.label}`}
              className={`text-xs font-semibold uppercase transition-all duration-300 ${TEXT[s.state]} animate-text-glow`}
              style={{ color: s.state === 'alert' ? 'rgb(239, 68, 68)' : s.state === 'warning' ? 'rgb(234, 179, 8)' : 'rgb(34, 197, 94)' }}
            >
              {s.label}
            </span>
          </div>
        </div>
      ))}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes dotPulse {
          0% { transform: scale(1); box-shadow: 0 0 0 0 currentColor; }
          50% { transform: scale(1.6); box-shadow: 0 0 10px 4px currentColor; }
          100% { transform: scale(1); box-shadow: 0 0 0 0 currentColor; }
        }
        .animate-dot-pulse {
          animation: dotPulse 600ms ease-out forwards;
        }
        @keyframes textGlow {
          0% { opacity: 0.5; }
          50% { opacity: 1; text-shadow: 0 0 6px currentColor; }
          100% { opacity: 1; }
        }
        .animate-text-glow {
          animation: textGlow 600ms ease-out forwards;
        }
      `}} />
    </section>
  )
}
