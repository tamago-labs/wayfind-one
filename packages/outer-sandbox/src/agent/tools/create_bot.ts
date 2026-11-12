// `create_bot` tool: the chief of staff proposes a new bot and the user
// confirms on a card before anything is created.
//
// Delivery is hook-injected (same pattern as `question`): the server hook
// pushes a `bot_request` SSE event and waits for POST /bot-requests/:id
// (120s → cancelled). The frontend owns Bot records (Amplify) — the tool
// only carries the proposal; creation + result reporting happen there.
// `needsApproval` is always false — the confirm card IS the checkpoint.
import { tool } from '@openai/agents';
import { z } from 'zod';
import { check, loadRules } from '../../core/permissions.js';

export interface BotRequest {
  name: string;
  role?: string;
  description?: string;
}

export interface BotRequestResult {
  /** confirm + botId on success; cancel on decline/timeout; error explains a failed create (e.g. name taken). */
  decision: 'confirm' | 'cancel';
  botId?: string;
  error?: string;
}

export type BotRequestHook = (req: BotRequest) => Promise<BotRequestResult>;

export function createBotRequestTool(hook: BotRequestHook): ReturnType<typeof tool> {
  return tool({
    name: 'create_bot',
    description:
      'Propose a new bot for the user. The user sees a confirmation card with the name and role — the bot is only created after they confirm. ' +
      'Use when the user asks for a new bot or helper. Keep names short (one word) and roles to a few words.',
    parameters: z.object({
      name: z.string().describe('Bot name, one short word, e.g. "Reef"'),
      role: z.string().optional().describe('Short role label, e.g. "travel planner"'),
      description: z.string().optional().describe('One-line job description for the new bot'),
    }),
    // No guarded() wrapper: the confirm card is the checkpoint (same
    // reasoning as `question`). An explicit deny rule is still honored.
    execute: async (a: { name: string; role?: string; description?: string }) => {
      if (check(loadRules(), 'create_bot', a.name) === 'deny') {
        throw new Error(`Denied by policy: create_bot "${a.name}"`);
      }
      const name = a.name.trim().slice(0, 40);
      if (!name) throw new Error('create_bot needs a non-empty name.');
      const res = await hook({ name, role: a.role?.slice(0, 80), description: a.description?.slice(0, 200) });
      if (res.decision === 'confirm' && res.botId) {
        return `Bot "${name}" created (id ${res.botId}). It is now in the user's roster — tell the user it is ready and what to do next.`;
      }
      if (res.error) {
        return `Bot creation did not complete: ${res.error}. Adjust (e.g. pick another name) and call create_bot again, or tell the user.`;
      }
      return 'The user declined to create the bot. Tell the user nothing was created.';
    },
    // Inherently user-directed — never gated by permission rules.
    needsApproval: async () => false,
  });
}
