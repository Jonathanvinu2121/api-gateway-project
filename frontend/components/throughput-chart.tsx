"use client"

import { useId } from "react"
import { useSocket } from "../lib/socket-provider"

export function ThroughputChart() {
  const { allowedData, blockedData } = useSocket()
  const gradientId = useId()
  const width = 720
  const height = 220
  const padX = 8
  const padY = 16

  // Use a stable scale starting from 0, with a minimum peak height of 5
  const max = Math.max(5, ...allowedData, ...blockedData)
  const min = 0
  const range = max - min || 1

  const allowedPoints = allowedData.map((value, i) => {
    const x = padX + (i / (allowedData.length - 1)) * (width - padX * 2)
    const y = padY + (1 - (value - min) / range) * (height - padY * 2)
    return [x, y] as const
  })

  const blockedPoints = blockedData.map((value, i) => {
    const x = padX + (i / (blockedData.length - 1)) * (width - padX * 2)
    const y = padY + (1 - (value - min) / range) * (height - padY * 2)
    return [x, y] as const
  })

  const allowedLinePath = allowedPoints
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ")

  const blockedLinePath = blockedPoints
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(" ")

  const currentAllowed = allowedData[allowedData.length - 1]
  const currentBlocked = blockedData[blockedData.length - 1]

  return (
    <section className="flex h-full flex-col rounded-md border border-border bg-card p-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-medium text-foreground">
            Request throughput
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Requests / sec · last 60 sec
          </p>
        </div>
        <div className="text-right">
          <div className="font-mono text-2xl tabular-nums text-foreground">
            <span className="text-success">{currentAllowed}</span>
            <span className="mx-1 text-muted-foreground">/</span>
            <span className="text-alert">{currentBlocked}</span>
          </div>
          <div className="font-mono text-xs text-muted-foreground">allowed / blocked req/s</div>
        </div>
      </div>

      <div className="mt-6 flex-1">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          role="img"
          aria-label="Line chart of request throughput over the last 60 seconds"
        >
          {[0.25, 0.5, 0.75].map((g) => (
            <line
              key={g}
              x1={padX}
              x2={width - padX}
              y1={padY + g * (height - padY * 2)}
              y2={padY + g * (height - padY * 2)}
              stroke="var(--border)"
              strokeWidth={1}
            />
          ))}

          {/* Allowed throughput path */}
          <path
            d={allowedLinePath}
            fill="none"
            stroke="var(--success)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* Blocked throughput path */}
          <path
            d={blockedLinePath}
            fill="none"
            stroke="var(--alert)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </div>

      <div className="mt-4 flex justify-between font-mono text-[11px] text-muted-foreground">
        <span>60s ago</span>
        <span>45s</span>
        <span>30s</span>
        <span>15s</span>
        <span>now</span>
      </div>
    </section>
  )
}
