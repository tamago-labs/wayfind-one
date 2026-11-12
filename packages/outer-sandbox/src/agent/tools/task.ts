// `task` tool (opencode pattern): launch a subagent for autonomous work.
// Subagent types: `general` (full toolset) or `research` (read-only:
// no write/edit/shell/task/question). `task_id` resumes a previous child
// session instead of starting fresh.
//
// When to use / not to use (opencode doctrine): delegate independent work
// streams in parallel; do NOT delegate what a single read/glob/grep answers.
// Prompts must be self-contained (exact paths, return shape) — children see
// only the prompt. Prefer parallel `task` calls in one turn over serial ones.
import { tool } from '@openai/agents';
import { z } from 'zod';
import { approvalPolicy, guarded, type GuardOpts } from '../../core/guard.js';

export type SubagentType = 'general' | 'research';

export interface ChildResult {
  output: string;
  taskId: string;
}

export interface ChildRequest {
  description: string;
  prompt: string;
  subagentType: SubagentType;
  taskId?: string;
  command?: string;
}

export type RunChild = (req: ChildRequest) => Promise<ChildResult>;

const TYPES: SubagentType[] = ['general', 'research'];

export function createTaskTool(runChild: RunChild, opts: GuardOpts): ReturnType<typeof tool> {
  return tool({
    name: 'task',
    description:
      'Spawn a subagent for an independent work stream and wait for its result. ' +
      'Use for parallel lanes (research, setup, build) instead of serial work. ' +
      'Pick subagent_type: general (full tools) or research (read-only). ' +
      'Write a self-contained prompt: exact workspace-relative paths, what to do, and the return shape. ' +
      'The subagent sees only your prompt — no conversation history — unless you pass task_id to resume a previous child session. ' +
      'Returns <task_result task_id="…">…</task_result>.',
    parameters: z.object({
      description: z.string().describe('Short lane label, e.g. "research auth options"'),
      prompt: z.string().describe('Full instructions for the subagent'),
      subagent_type: z.string().describe('general (default) or research (read-only)').optional(),
      task_id: z.string().optional().describe('Resume this previous child session instead of starting fresh'),
      command: z.string().optional().describe('The command that triggered this task'),
    }),
    execute: guarded(
      'task',
      (a: { description: string }) => a.description,
      async (a: { description: string; prompt: string; subagent_type?: string; task_id?: string; command?: string }) => {
        if (a.subagent_type !== undefined && !(TYPES as string[]).includes(a.subagent_type)) {
          throw new Error(`Unknown subagent type "${a.subagent_type}" — valid types: ${TYPES.join(', ')}`);
        }
        const label = a.command ? `[${a.description} via ${a.command}]` : `[${a.description}]`;
        const { output, taskId } = await runChild({
          description: a.description,
          prompt: `${label} ${a.prompt}`,
          subagentType: (a.subagent_type as SubagentType | undefined) ?? 'general',
          taskId: a.task_id,
          command: a.command,
        });
        return `<task_result task_id="${taskId}">\n${output}\n</task_result>`;
      },
      opts,
    ),
    needsApproval: approvalPolicy('task', (a: { description: string }) => a.description),
  });
}
