"use client"

import { useSocket } from "../lib/socket-provider"

function statusColor(status: number): string {
  if (status >= 500) return "text-alert"
  if (status === 429 || (status >= 400 && status < 500)) return "text-warning"
  if (status >= 200 && status < 300) return "text-success"
  return "text-muted-foreground"
}

export function LogPanel() {
  const { logs } = useSocket()

  return (
    <section className="flex flex-col rounded-md border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h2 className="text-sm font-medium text-foreground">Live requests</h2>
        <div className="flex items-center gap-2">
          <span
            className="h-1.5 w-1.5 rounded-full bg-success animate-pulse"
            aria-hidden="true"
          />
          <span className="text-xs text-muted-foreground">streaming</span>
        </div>
      </div>

      <div
        className="h-64 overflow-y-auto px-6 py-3 font-mono text-xs leading-relaxed"
        role="log"
        aria-label="Live request log"
      >
        {logs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            No live requests received yet. Send API traffic to monitor.
          </div>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              className="flex items-center gap-4 py-0.5 tabular-nums hover:bg-white/[0.02] transition-colors animate-log-flash"
            >
              <span className="w-20 shrink-0 text-muted-foreground">
                {log.time}
              </span>
              <span className="w-14 shrink-0 text-muted-foreground">
                {log.method}
              </span>
              <span className="flex-1 truncate text-foreground">{log.path}</span>
              <span className={`w-10 shrink-0 text-right ${statusColor(log.status)}`}>
                {log.status}
              </span>
              <span className="w-14 shrink-0 text-right text-muted-foreground">
                {log.ms}ms
              </span>
            </div>
          ))
        )}
      </div>
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes logFlash {
          0% { background-color: rgba(59, 130, 246, 0.25); }
          100% { background-color: transparent; }
        }
        .animate-log-flash {
          animation: logFlash 500ms ease-out forwards;
        }
      `}} />
    </section>
  )
}
