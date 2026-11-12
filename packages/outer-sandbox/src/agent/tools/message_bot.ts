// `message_bot` tool: the chief of staff talks to another bot by name
// (@mentions). Runs the message as a real turn in the target bot's own
// conversation — same session, system, and skills as if the user had
// written there — and returns the reply for the chief to relay.
//
// The transcript lands under the target conversationId (no parentId), so
// switching to that bot shows the chief's message and the reply. No
// approval card by design (user decision): the checkpoint is the user
// typing @Name in the chief thread.
import { tool } from '@openai/agents';
import { z } from 'zod';
import { guarded, type GuardOpts } from '../../core/guard.js';

export interface RosterEntry {
  id: string;
  name: string;
  role?: string;
  /** Per-bot skill allowlist. Undefined = all enabled. */
  skills?: string[] | null;
  /** Per-bot MCP allowlist. Undefined = all enabled. */
  mcp?: string[] | null;
}

/** Send a message to another bot; resolves with that bot's reply text. */
export type MessageRunner = (botName: string, message: string) => Promise<string>;

export function rosterDirectory(roster: RosterEntry[], isChief: boolean): string {
  if (roster.length === 0) return 'You have no other bots yet.';
  const header = isChief ? 'Bots you coordinate:' : 'Your chief of staff:';
  return (
    header +
    '\n' +
    roster.map((b) => `- ${b.name}${b.role ? ` (${b.role})` : ''}`).join('\n')
  );
}

export function createMessageBotTool(send: MessageRunner, opts: GuardOpts): ReturnType<typeof tool> {
  return tool({
    name: 'message_bot',
    description:
      'Send a message to another bot on your team and get its reply. ' +
      'Use when the user\'s text @mentions a bot by name, or asks you to consult one. ' +
      'The other bot answers in its own role — relay its reply in your own words, keeping any Sources list. ' +
      'Only message bots listed in your team roster, never yourself.',
    parameters: z.object({
      bot: z.string().describe('Bot name exactly as listed (without the @)'),
      message: z.string().describe('What to ask or tell that bot, as the user would write it'),
    }),
    execute: guarded(
      'message_bot',
      (a: { bot: string }) => a.bot,
      async (a: { bot: string; message: string }) => {
        if (!a.bot.trim() || !a.message.trim()) throw new Error('message_bot needs both bot and message.');
        const reply = await send(a.bot.trim(), a.message);
        return `<message_result bot="${a.bot.trim()}">\n${reply}\n</message_result>`;
      },
      opts,
    ),
    // User-directed by construction (@mention in the chief thread) — no card.
    needsApproval: async () => false,
  });
}
