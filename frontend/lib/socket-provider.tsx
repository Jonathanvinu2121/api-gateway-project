"use client"

import React, { createContext, useContext, useEffect, useRef, useState } from "react"
import { io, Socket } from "socket.io-client"

export interface LogEntry {
  id: string
  time: string
  method: string
  path: string
  status: number
  ms: number
}

interface SocketContextType {
  logs: LogEntry[]
  allowedData: number[]
  blockedData: number[]
  breakerStates: {
    users: "CLOSED" | "OPEN" | "HALF_OPEN"
    orders: "CLOSED" | "OPEN" | "HALF_OPEN"
  }
  tenants: Record<string, number>
}

const SocketContext = createContext<SocketContextType | null>(null)

export function useSocket() {
  const context = useContext(SocketContext)
  if (!context) {
    throw new Error("useSocket must be used within a SocketProvider")
  }
  return context
}

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  
  // Rolling 60-second window initialized to 60 zeros
  const [allowedData, setAllowedData] = useState<number[]>(() => Array(60).fill(0))
  const [blockedData, setBlockedData] = useState<number[]>(() => Array(60).fill(0))

  const [breakerStates, setBreakerStates] = useState<{
    users: "CLOSED" | "OPEN" | "HALF_OPEN"
    orders: "CLOSED" | "OPEN" | "HALF_OPEN"
  }>({
    users: "CLOSED",
    orders: "CLOSED"
  })

  const [tenants, setTenants] = useState<Record<string, number>>({})

  // Event count accumulators for the current 1-second interval bucket
  const allowedAccumulator = useRef(0)
  const blockedAccumulator = useRef(0)

  useEffect(() => {
    // Connect to the API Gateway socket server
    const socketUrl = process.env.NEXT_PUBLIC_GATEWAY_URL || "http://localhost:4000"
    console.log(`[SocketProvider] Connecting to ${socketUrl}...`)
    const socket: Socket = io(socketUrl)

    socket.on("connect", () => {
      console.log(`[SocketProvider] Connected to Socket.io. ID: ${socket.id}`)
    })

    socket.on("request:logged", (data: {
      tenantId: string
      route: string
      statusCode: number
      latencyMs: number
      rateLimitDecision: "allowed" | "blocked"
      breakerState: "CLOSED" | "OPEN" | "HALF_OPEN"
      timestamp: string
    }) => {
      // 1. Log list (prepend, limit to 50)
      const date = new Date(data.timestamp)
      const timeString = date.toLocaleTimeString("en-GB", { hour12: false })
      
      const newEntry: LogEntry = {
        id: `${data.timestamp}-${Math.random()}`,
        time: timeString,
        method: "GET", // Default HTTP method
        path: data.route,
        status: data.statusCode,
        ms: data.latencyMs
      }

      setLogs((prev) => [newEntry, ...prev].slice(0, 50))

      // 2. Client list stats
      setTenants((prev) => {
        const currentCount = prev[data.tenantId] || 0
        return {
          ...prev,
          [data.tenantId]: currentCount + 1
        }
      })

      // 3. Accumulate counts for allowed/blocked per second
      if (data.rateLimitDecision === "blocked") {
        blockedAccumulator.current += 1
      } else {
        allowedAccumulator.current += 1
      }
    })

    socket.on("breaker:transition", (data: {
      service: "users" | "orders"
      from: "CLOSED" | "OPEN" | "HALF_OPEN"
      to: "CLOSED" | "OPEN" | "HALF_OPEN"
    }) => {
      console.log(`[SocketProvider] Breaker Transition - ${data.service}: ${data.from} -> ${data.to}`)
      setBreakerStates((prev) => ({
        ...prev,
        [data.service]: data.to
      }))
    })

    socket.on("disconnect", () => {
      console.log("[SocketProvider] Disconnected from Socket.io")
    })

    // Tick interval: slides the rolling 60-second window every 1 second
    const interval = setInterval(() => {
      // Capture accumulated values and reset accumulators
      const currentAllowed = allowedAccumulator.current
      const currentBlocked = blockedAccumulator.current
      allowedAccumulator.current = 0
      blockedAccumulator.current = 0

      setAllowedData((prev) => {
        const next = [...prev.slice(1), currentAllowed]
        return next
      })

      setBlockedData((prev) => {
        const next = [...prev.slice(1), currentBlocked]
        return next
      })
    }, 1000)

    return () => {
      socket.disconnect()
      clearInterval(interval)
    }
  }, [])

  return (
    <SocketContext.Provider value={{ logs, allowedData, blockedData, breakerStates, tenants }}>
      {children}
    </SocketContext.Provider>
  )
}
