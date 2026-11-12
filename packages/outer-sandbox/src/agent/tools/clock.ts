import { tool } from '@openai/agents';
import { z } from 'zod';
import type { GuardOpts } from '../../core/guard.js';

/** Current date/time. Read-only — never gated. The model is otherwise
 * time-blind (no clock in its instructions), so scheduling ("in 30 minutes",
 * "Monday 9am") and "is this receipt from this month?" checks need this. */
export function createClockTool(_opts: GuardOpts): ReturnType<typeof tool> {
  return tool({
    name: 'now',
    description:
      'Current date and time. Pass the user\'s IANA timezone (e.g. Asia/Bangkok) for their local time — defaults to UTC. ' +
      'Use it to resolve relative times ("in 30 minutes", "tomorrow 9am") and to timestamp schedule_task calls.',
    parameters: z.object({
      timezone: z.string().optional().describe('IANA timezone, e.g. Asia/Bangkok. Defaults to UTC.'),
    }),
    execute: async (args: { timezone?: string }) => {
      const now = new Date();
      const tz = args.timezone?.trim() || 'UTC';
      try {
        const local = new Intl.DateTimeFormat('en-CA', {
          timeZone: tz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
          weekday: 'short',
        }).format(now);
        return JSON.stringify({ iso: now.toISOString(), local, timezone: tz });
      } catch {
        return JSON.stringify({ iso: now.toISOString(), timezone: 'UTC', note: `unknown timezone "${tz}" — showing UTC` });
      }
    },
    needsApproval: async () => false,
  });
}
