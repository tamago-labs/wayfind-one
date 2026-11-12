// Specialist sub-agents (chat-further handoffs pattern). The triage agent
// hands off; each specialist runs with a narrower toolset and reports back.
// Research runs on the catalog `small` model (cheap); overrides flow through.
import { Agent } from '@openai/agents';
import type { GuardOpts } from '../core/guard.js';
import { resolveModel, resolveSmallModel } from '../providers/providers.js';
import { createBuiltinTools } from './tools/builtin.js';
import type { AgentSelection } from './agent.js';

async function specialistModel(sel: AgentSelection, useSmall: boolean): Promise<never> {
  const resolved = useSmall && !sel.provider && !sel.model ? resolveSmallModel() : resolveModel(sel.provider, sel.model);
  return (await resolved.get()) as never;
}

export async function createResearchAgent(opts: GuardOpts, sel: AgentSelection = {}): Promise<InstanceType<typeof Agent>> {
  const allowed = new Set(['read', 'list', 'shell']);
  return new Agent({
    name: 'Research',
    model: await specialistModel(sel, true),
    instructions:
      'You are a research specialist. Gather facts from files and the shell, ' +
      'summarize findings crisply with sources (file paths, commands run). ' +
      'You cannot write files — report back so the lead agent can act.',
    tools: createBuiltinTools(opts).filter((t) => allowed.has((t as { name: string }).name)),
  });
}

export async function triageHandoffs(opts: GuardOpts, sel: AgentSelection = {}): Promise<Array<InstanceType<typeof Agent>>> {
  return [await createResearchAgent(opts, sel)];
}
