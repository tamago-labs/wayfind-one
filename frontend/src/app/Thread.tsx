import type { Bot } from '../lib/api'

/** Thread for one bot. Agent replies are not wired yet — the greeting
 *  below is the whole thread until local inference lands. */
export default function Thread({ bot }: { bot: Bot }) {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-white px-4 py-3 shadow-sm">
          <p className="text-navy">Hi, I&apos;m {bot.name}.</p>
          <p className="mt-1 text-sm text-heroslate">
            {bot.role
              ? bot.role
              : 'My role is not defined yet — tell me what to do once chatting is wired up.'}
          </p>
        </div>
        {bot.msgs.map((m, i) =>
          m.t === 'u' ? (
            <div key={i} className="ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-navy px-4 py-3 text-white">
              {m.x}
            </div>
          ) : (
            <div key={i} className="max-w-[80%] rounded-2xl rounded-bl-md bg-white px-4 py-3 text-navy shadow-sm">
              {m.x}
            </div>
          ),
        )}
      </div>
    </div>
  )
}
