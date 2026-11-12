// `wayfind` CLI: chat (REPL) | run (one-shot) | status | skills | keys.
// Usage (from packages/computer/): npx tsx src/cli.ts chat
import { createInterface } from 'node:readline';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PORT, PROVIDER_API_KEY, PROVIDER_BASE_URL, WORKSPACE_DIR, requireApiKey } from './core/config.js';
import { initProvider } from './providers/provider.js';
import { createTriageAgent } from './agent/agent.js';
import { maskedKeys, writeKey } from './providers/keystore.js';
import { loadSkills } from './agent/skills.js';
import { startRun, resolveApproval, answerQuestion } from './runs/runner.js';
import { askCli } from './core/permissions.js';
import type { QuestionPrompt } from './agent/tools/question.js';
import { run } from '@openai/agents';

const AGENT_URL = process.env.AGENT_URL ?? `http://localhost:${PORT}`;

async function cmdStatus(): Promise<void> {
  const res = await fetch(`${AGENT_URL}/status`);
  console.log(JSON.stringify(await res.json(), null, 2));
}

async function cmdSkills(): Promise<void> {
  for (const s of loadSkills()) {
    console.log(`- ${s.name}: ${s.description}`);
  }
}

async function cmdModels(): Promise<void> {
  requireApiKey();
  if (!PROVIDER_BASE_URL.includes('openrouter')) {
    console.log(`Provider discovery supports OpenRouter; base is ${PROVIDER_BASE_URL}.`);
    console.log('Configured models come from workspace/providers.json.');
    return;
  }
  const res = await fetch(`${PROVIDER_BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${PROVIDER_API_KEY}` },
  });
  if (!res.ok) {
    console.error(`models fetch failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const { data } = (await res.json()) as { data: Array<{ id: string; context_length?: number }> };
  for (const m of data.slice(0, 50)) {
    console.log(`- ${m.id}${m.context_length ? ` (ctx ${m.context_length})` : ''}`);
  }
  if (data.length > 50) console.log(`…and ${data.length - 50} more`);
}

async function cmdSkill(args: string[]): Promise<void> {
  const [sub, name, ...rest] = args;
  if (sub === 'run' && name) {
    requireApiKey();
    initProvider();
    const skills = loadSkills();
    const s = skills.find((k) => k.name === name);
    if (!s) {
      console.error(`Unknown skill "${name}". Available: ${skills.map((k) => k.name).join(', ') || '(none)'}`);
      process.exit(1);
    }
    const task = rest.join(' ') || 'Follow the skill.';
    await cmdRun(`# Skill: ${s.name}\n\n${s.content}\n\nTask: ${task}`);
    return;
  }
  if (sub === 'save' && name) {
    const convo = join(WORKSPACE_DIR, 'conversations.jsonl');
    let excerpt = '(no transcript yet)';
    if (existsSync(convo)) {
      const lines = readFileSync(convo, 'utf8').trim().split('\n').filter(Boolean).slice(-6);
      excerpt = lines
        .map((l) => {
          try {
            const m = JSON.parse(l) as { role: string; text: string };
            return `**${m.role}:** ${m.text.slice(0, 2000)}`;
          } catch {
            return '';
          }
        })
        .filter(Boolean)
        .join('\n\n');
    }
    const dir = join(WORKSPACE_DIR, 'skills', name);
    mkdirSync(dir, { recursive: true });
    const draft = `---\nname: ${name}\ndescription: >\n  TODO: one-line trigger description. Use this skill whenever ...\n---\n\n# ${name}\n\n> DRAFT saved ${new Date().toISOString()} — edit steps, validation and approval boundaries before use.\n\n## Source transcript (excerpt)\n\n${excerpt}\n\n## Steps\n\n1. TODO\n\n## Validation\n\n- TODO\n`;
    writeFileSync(join(dir, 'SKILL.md'), draft);
    console.log(`Draft saved to ${join('skills', name, 'SKILL.md')} — review and edit before use.`);
    return;
  }
  console.error('Usage: wayfind skill [run <name> [task]|save <name>]');
  process.exit(1);
}

async function cmdBackup(args: string[]): Promise<void> {
  const dir = join(WORKSPACE_DIR, '.wayfind', 'backups');
  const [sub] = args;
  if (sub === 'now') {
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const out = join(dir, `${stamp}.tgz`);
    await new Promise<void>((resolve, reject) => {
      execFile('tar', ['-czf', out, '-C', WORKSPACE_DIR, '--exclude=.wayfind/backups', '.'], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    console.log(`Backup written to ${out}`);
    return;
  }
  if (sub === 'list' || sub === undefined) {
    if (!existsSync(dir)) {
      console.log('(no backups yet)');
      return;
    }
    for (const f of readdirSync(dir)) console.log(`- ${f}`);
    return;
  }
  console.error('Usage: wayfind backup [now|list]');
  process.exit(1);
}

async function cmdKeys(args: string[]): Promise<void> {
  const [sub, name, ...rest] = args;
  if (sub === 'list' || sub === undefined) {
    console.log(JSON.stringify(maskedKeys(), null, 2));
    return;
  }
  if (sub === 'set' && name && rest.length > 0) {
    writeKey(name, rest.join(' '));
    console.log(`Saved ${name} to the keystore.`);
    return;
  }
  console.error('Usage: wayfind keys [list|set <NAME> <value>]');
  process.exit(1);
}

/** stdin select for the `question` tool (single choice per question). */
export async function cliAsk(questions: QuestionPrompt[]): Promise<string[][]> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const out: string[][] = [];
  for (const q of questions) {
    console.log(`\n[question] ${q.header ? `${q.header}: ` : ''}${q.question}`);
    q.options.forEach((o, i) => console.log(`  ${i + 1}. ${o.label}${o.description ? ` — ${o.description}` : ''}`));
    console.log('  0. Skip');
    const answer = await new Promise<string>((resolve) => rl.question('choose [0-9]: ', resolve));
    const n = Number.parseInt(answer.trim(), 10);
    const picked = q.options[n - 1];
    out.push(picked ? [picked.label] : []);
  }
  rl.close();
  return out;
}

async function cmdRun(text: string): Promise<void> {
  requireApiKey();
  initProvider();
  const r = startRun(text, {});
  // Stream the local run's events to stdout.
  let cursor = 0;
  const asked = new Set<string>();
  const qAsked = new Set<string>();
  for (;;) {
    while (cursor < r.events.length) {
      const e = r.events[cursor];
      cursor += 1;
      if (e.type === 'chunk' && e.chunk) process.stdout.write(e.chunk);
      if (e.type === 'approval' && e.approvalId) console.log(`\n[approval requested: ${e.permission} "${e.target}"]`);
      if (e.type === 'error') console.error(`\n[error] ${e.error}`);
      if (e.type === 'question' && e.qid && !qAsked.has(e.qid)) {
        qAsked.add(e.qid);
        const qid = e.qid;
        const answers = await cliAsk(e.questions ?? []);
        answerQuestion(qid, answers);
      }
    }
    if (r.done) break;
    if (r.parked) {
      for (const p of r.interruptions) {
        if (asked.has(p.id)) continue;
        asked.add(p.id);
        const answer = await askCli(p.permission, p.target);
        await resolveApproval(p.id, answer === 'deny' ? 'reject' : 'approve');
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  process.stdout.write('\n');
}

async function cmdChat(): Promise<void> {
  requireApiKey();
  initProvider();
  const agent = await createTriageAgent({}, undefined, undefined, cliAsk);
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: 'you> ' });
  console.log(`Wayfind REPL (model via ${process.env.PROVIDER_BASE_URL ?? 'env'}). Empty line quits.`);
  const history: unknown[] = [];
  rl.prompt();
  for await (const line of rl) {
    const text = line.trim();
    if (!text) {
      rl.close();
      break;
    }
    history.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text }] });
    const stream = await run(agent, history as never, {
      stream: true,
      maxTurns: 20,
    });
    let full = '';
    for await (const event of stream as unknown as Iterable<{
      type: string;
      data?: { type: string; delta?: string };
    }>) {
      if (event.type === 'raw_model_stream_event' && event.data?.type === 'output_text_delta' && event.data.delta) {
        process.stdout.write(event.data.delta);
        full += event.data.delta;
      }
    }
    process.stdout.write('\n');
    history.push({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: full }] });
    rl.prompt();
  }
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'status') return void (await cmdStatus());
  if (cmd === 'skills') return void (await cmdSkills());
  if (cmd === 'models') return void (await cmdModels());
  if (cmd === 'skill') return void (await cmdSkill(rest));
  if (cmd === 'backup') return void (await cmdBackup(rest));
  if (cmd === 'keys') return void (await cmdKeys(rest));
  if (cmd === 'run' && rest.length > 0) return void (await cmdRun(rest.join(' ')));
  if (cmd === 'chat' || cmd === undefined) return void (await cmdChat());
  console.error('Usage: wayfind [chat|run <text>|status|skills|models|skill [run|save]|backup [now|list]|keys [list|set]]');
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
