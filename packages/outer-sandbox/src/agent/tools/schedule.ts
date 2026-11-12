import { tool } from '@openai/agents';
import { z } from 'zod';
import type { GuardOpts } from '../../core/guard.js';

/** Chat-created schedules. The backend owns validation + nextRunAt: the
 * model only supplies what/when, attribution comes from the run itself. */
export function createScheduleTool(opts: GuardOpts): ReturnType<typeof tool> {
  return tool({
    name: 'schedule_task',
    description:
      'Schedule future work for THIS bot: a one-shot ("in 30 minutes", "in 3 days at 9am") or a repeating cron ' +
      '("every weekday at 9am" → cron "0 9 * * 1-5", "every Monday 9am" → "0 9 * * 1"). ' +
      'ALWAYS call now first to resolve relative times into concrete dates, and confirm the timezone with the user ' +
      '(default UTC — say so explicitly if they gave none). ' +
      'Past times are rejected: "9am today" at noon means tomorrow — compute the correct first fire yourself. ' +
      'The approval card is the confirm step, so do NOT add a question-tool confirm on top — but DO use the question ' +
      'tool for genuine forks (which timezone? one-shot or repeating?). ' +
      'Only confirm the schedule to the user AFTER this tool returns success — never promise it beforehand. ' +
      'Each fire runs the prompt as this bot and lands in this thread. ' +
      'Manage (pause/delete) under the bot panel → Details → Schedules.',
    parameters: z.object({
      prompt: z.string().describe('The task text each fire executes (what the bot should do)'),
      kind: z.enum(['once', 'cron']).describe('once = runAt, cron = repeating expression'),
      runAt: z.string().optional().describe('ISO time for kind=once, must be in the future'),
      cron: z.string().optional().describe('5-field cron (minute precision) for kind=cron, e.g. "0 9 * * 1-5"'),
      timezone: z.string().optional().describe('IANA timezone, e.g. Asia/Bangkok. Defaults to UTC.'),
      name: z.string().optional().describe('Short label shown in the Schedules list'),
    }),
    execute: async (args: {
      prompt: string;
      kind: 'once' | 'cron';
      runAt?: string;
      cron?: string;
      timezone?: string;
      name?: string;
    }) => {
      const apiUrl = (opts.apiUrl ?? process.env.WAYFIND_API_URL ?? '').replace(/\/$/, '');
      const usageToken = process.env.USAGE_TOKEN ?? '';
      const userToken = opts.userToken ?? '';
      const missing: string[] = [];
      if (!apiUrl) missing.push('API base (WAYFIND_API_URL)');
      if (!usageToken && !userToken) missing.push('a credential (usage token on cloud, sign-in on local dev)');
      if (missing.length > 0) {
        return (
          `Scheduling isn't available from this computer (missing: ${missing.join(', ')}). ` +
          `On local dev, make sure you're signed in; on a cloud computer this is configured automatically.`
        );
      }
      if (!opts.ownerId || !opts.conversationId) {
        return 'Cannot attribute this schedule: the run carries no owner or bot identity.';
      }
      let res: Response;
      try {
        res = await fetch(`${apiUrl}/routines`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Cloud VMs use their per-computer usage token; local dev
            // forwards the signed-in user's own JWT (never logged/stored).
            ...(usageToken
              ? { 'X-computer-usage-token': usageToken }
              : { Authorization: `Bearer ${userToken}` }),
          },
          body: JSON.stringify({
            ownerId: opts.ownerId,
            botId: opts.conversationId,
            prompt: args.prompt,
            kind: args.kind,
            ...(args.runAt ? { runAt: args.runAt } : {}),
            ...(args.cron ? { cron: args.cron } : {}),
            ...(args.timezone ? { timezone: args.timezone } : {}),
            ...(args.name ? { name: args.name } : {}),
          }),
        });
      } catch (err) {
        return `Schedule request failed: ${err instanceof Error ? err.message : err}.`;
      }
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        routine?: { id?: string; kind?: string; nextRunAt?: string; timezone?: string; status?: string };
      };
      if (!res.ok || !body.ok || !body.routine) {
        return `Schedule rejected: ${body.error ?? `backend → ${res.status}`}. Fix the input and try again.`;
      }
      const r = body.routine;
      return (
        `Scheduled (${r.kind}, first/next fire ${r.nextRunAt} ${r.timezone ?? 'UTC'}). ` +
        `It runs as this bot and lands in this thread; manage it under bot panel → Details → Schedules.`
      );
    },
    // Creating autonomous future runs always asks — the card is the confirm.
    needsApproval: async () => {
      if (process.env.PERMISSION_MODE === 'permissive') return false;
      return true;
    },
  });
}
