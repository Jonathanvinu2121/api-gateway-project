import { ThroughputChart } from "@/components/throughput-chart"
import { StatusCards } from "@/components/status-cards"
import { ClientList } from "@/components/client-list"
import { LogPanel } from "@/components/log-panel"

export default function Page() {
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-10">
      <header className="mb-10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className="h-2 w-2 rounded-full bg-success"
            aria-hidden="true"
          />
          <h1 className="text-sm font-medium text-foreground">API Gateway</h1>
          <span className="text-xs text-muted-foreground">
            us-east-1 · production
          </span>
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          uptime 99.98%
        </span>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ThroughputChart />
        </div>
        <div className="lg:col-span-1">
          <StatusCards />
        </div>
      </div>

      <div className="mt-6">
        <ClientList />
      </div>

      <div className="mt-6">
        <LogPanel />
      </div>
    </main>
  )
}
