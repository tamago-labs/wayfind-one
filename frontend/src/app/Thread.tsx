import { useEffect, useRef } from 'react'
import type { Bot } from '../lib/api'

/** Thread for one bot. Agent replies land one turn at a time for now —
 *  each user message gets exactly one tool-run or stub reply. */
export default function Thread({ bot, typing }: { bot: Bot; typing: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [bot.msgs.length, typing, bot.id])

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-white px-4 py-3 shadow-sm">
          <p className="text-navy">Hi, I&apos;m {bot.name}.</p>
          <p className="mt-1 text-sm text-heroslate">
            {bot.role
              ? bot.role
              : 'My role is not defined yet — start with `$ <command>` to run something on my computer.'}
          </p>
        </div>
        {bot.msgs.map((m, i) =>
          m.t === 'u' ? (
            <div key={i} className="ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-navy px-4 py-3 text-white">
              {m.x}
            </div>
          ) : (
            <div key={i} className="max-w-[80%] rounded-2xl rounded-bl-md bg-white px-4 py-3 text-navy shadow-sm">
              <span className="whitespace-pre-wrap">{m.x}</span>
            </div>
          ),
        )}
        {typing && (
          <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-white px-4 py-3 text-navy shadow-sm">
            <span className="inline-flex gap-1" aria-label="Working">
              <i className="h-2 w-2 animate-bounce rounded-full bg-heroslate" />
              <i className="h-2 w-2 animate-bounce rounded-full bg-heroslate [animation-delay:150ms]" />
              <i className="h-2 w-2 animate-bounce rounded-full bg-heroslate [animation-delay:300ms]" />
            </span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
