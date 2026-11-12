// `spawn_inner_sandbox` tool (STUB — honest 501, Phase 2 builds behavior).
//
// Contract: the outer agent calls this when a task involves sensitive data.
// A disposable inner MicroVM (near-ai-only, attested, killed after the task)
// runs the work; files go in sealed and never touch the outer computer's
// disk; `{ result, evidence }` comes back with a nesting-bound receipt.
//
// Orchestration: agents-as-tools, never a handoff — the outer agent stays
// responsible for the final answer and this tool is a bounded call.
// No sub-agents on the escalation path; no escalation tool inside inner
// sandboxes (nesting cap 2).
import { tool } from '@openai/agents';
import { z } from 'zod';
import { guarded, type GuardOpts } from '../../core/guard.js';

/** Build the escalation tool. No runner is needed yet — Phase 2 wires it. */
export function createSpawnInnerSandboxTool(opts: GuardOpts): ReturnType<typeof tool> {
  return tool({
    name: 'spawn_inner_sandbox',
    description:
      'Run sensitive work in a disposable attested inner sandbox. ' +
      'Use when the task involves sensitive files or data that must never land on this computer. ' +
      'The inner sandbox runs the goal with near-ai-only attested inference and returns result + evidence. ' +
      'Inner sandboxes arrive in Phase 2 — calls fail until then.',
    parameters: z.object({
      goal: z.string().describe('What the inner sandbox should do, as a self-contained task'),
      fileRefs: z.array(z.string()).describe('Sealed file references to push direct-to-inner (bytes never transit this computer)').optional(),
      policy: z.string().describe('Security policy for the run (inner runs pin verified_inference)').optional(),
    }),
    execute: guarded(
      'spawn_inner_sandbox',
      (a: { goal: string }) => a.goal.slice(0, 80),
      async () => {
        // Honest stub: the contract is fixed, the behavior lands in Phase 2.
        throw new Error('spawn_inner_sandbox: inner sandboxes arrive in Phase 2 (honest 501).');
      },
      opts,
    ),
    // Nothing to approve — the call always fails until Phase 2 wires it.
    needsApproval: async () => false,
  });
}
