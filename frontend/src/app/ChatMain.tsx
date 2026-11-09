import type { Status } from '../lib/api'

export default function ChatMain({ status }: { status: Status | null }) {
  if (!status) {
    return (
      <main className="flex flex-1 items-center justify-center bg-thread p-6">
        <div className="max-w-md rounded-2xl border border-navy/10 bg-white p-8 text-center shadow-sm">
          <h1 className="font-brico text-2xl font-extrabold">Daemon offline</h1>
          <p className="mt-2 text-sm text-heroslate">
            Start the daemon, then refresh. Click your profile card for connection options.
          </p>
          <code className="mt-4 block rounded-lg bg-ice px-3 py-2 font-mono text-xs">node bin/wayfind-one.js</code>
        </div>
      </main>
    )
  }

  if (!status.team) {
    return (
      <main className="flex flex-1 items-center justify-center bg-thread p-6">
        <div className="max-w-md rounded-2xl border border-navy/10 bg-white p-8 text-center shadow-sm">
          <h1 className="font-brico text-2xl font-extrabold">Welcome to Wayfind ONE</h1>
          <p className="mt-2 text-sm text-heroslate">
            Create or join a team to get started — the setup opens automatically.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="flex flex-1 flex-col bg-thread">
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-navy/10 bg-white p-8 text-center shadow-sm">
          <h1 className="font-brico text-2xl font-extrabold">{status.team.name}</h1>
          <p className="mt-2 text-sm text-heroslate">
            Your bots will appear in the sidebar. Select one to start chatting.
          </p>
        </div>
      </div>
      <div className="mx-auto w-full max-w-2xl px-6 pb-6">
        <div className="pointer-events-none flex items-center gap-3 rounded-full border border-navy/10 bg-white px-5 py-3 opacity-50">
          <span className="flex-1 text-sm text-heroslate">Message… (coming soon)</span>
          <span className="rounded-full bg-navy/10 px-4 py-1.5 text-sm font-bold text-heroslate">Send</span>
        </div>
      </div>
    </main>
  )
}
