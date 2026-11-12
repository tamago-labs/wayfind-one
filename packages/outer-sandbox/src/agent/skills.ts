// Skills loader (mezo/opencode format): scans workspace/skills/**/SKILL.md,
// parses `name`/`description` front-matter, injects the catalog into the
// agent prompt. Full content loads on demand via the `skill` tool.
//
// Importer: the `import_skill` agent tool resolves a chat-provided source
// (`npx skills add owner/repo[/path][@ref]`, a GitHub URL, a direct SKILL.md
// URL, or a workspace-local discovery hit) into a preview, the user confirms
// via the question tool, and only then is it saved under workspace/skills/.
// We never shell out — sources resolve over HTTPS (node fetch), because the
// sandbox shell is unreliable and imports must be deterministic.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { tool } from '@openai/agents';
import { z } from 'zod';
import { WORKSPACE_DIR } from '../core/config.js';

import { approvalPolicy, guarded, type GuardOpts } from '../core/guard.js';
import { check, loadRules } from '../core/permissions.js';
import { detectMcpReferences } from './mcp.js';
export interface Skill {
  name: string;
  description: string;
  path: string;
  content: string;
}

function parseFrontmatter(md: string): { name: string; description: string; body: string } {
  const match = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { name: '', description: '', body: md };
  const [, front, body] = match;
  const name = front.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? '';
  // description may be `>` folded across lines — join continuation lines.
  const descLines: string[] = [];
  let inDesc = false;
  for (const line of front.split('\n')) {
    if (/^description:\s*/.test(line)) {
      inDesc = true;
      const rest = line.replace(/^description:\s*>?\s*/, '');
      if (rest) descLines.push(rest);
    } else if (inDesc && /^\s+\S/.test(line)) {
      descLines.push(line.trim());
    } else {
      inDesc = false;
    }
  }
  return { name, description: descLines.join(' '), body };
}

function findSkillFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) findSkillFiles(full, out);
    else if (e === 'SKILL.md') out.push(full);
  }
  return out;
}

export function loadSkills(): Skill[] {
  const skills: Skill[] = [];
  for (const file of findSkillFiles(join(WORKSPACE_DIR, 'skills'))) {
    const raw = readFileSync(file, 'utf8');
    const { name, description, body } = parseFrontmatter(raw);
    if (!name) continue;
    skills.push({ name, description, path: file, content: body.trim() });
  }
  return skills;
}

export function skillCatalogPrompt(skills: Skill[]): string {
  if (skills.length === 0) return '';
  const lines = skills.map((s) => `- ${s.name}: ${s.description}`);
  return (
    `\n\nAvailable skills (use the skill tool to load one before relevant work):\n${lines.join('\n')}`
  );
}

/** Per-bot skill allowlist. Undefined = all installed skills enabled; [] = none. */
export function filterSkills(skills: Skill[], allowed?: string[]): Skill[] {
  if (allowed === undefined) return skills;
  const set = new Set(allowed);
  return skills.filter((s) => set.has(s.name));
}

export function createSkillTool(skills: Skill[], opts: GuardOpts): ReturnType<typeof tool> {
  return tool({
    name: 'skill',
    description: 'Load a skill by name to get its full workflow, then follow it.',
    parameters: z.object({ name: z.string().describe('Skill name from the catalog') }),
    execute: guarded('skill', (a: { name: string }) => a.name, async ({ name }: { name: string }) => {
      const s = skills.find((k) => k.name === name);
      if (!s) return `Unknown skill "${name}". Available: ${skills.map((k) => k.name).join(', ') || '(none)'}`;
      return `# Skill: ${s.name}\n\n${s.content}`;
    }, opts),
    needsApproval: approvalPolicy('skill', (a: { name: string }) => a.name),
  });
}

// ---------------------------------------------------------------------------
// Importer
// ---------------------------------------------------------------------------

export interface SkillSourceFile {
  /** Path relative to the skill dir, e.g. `SKILL.md` or `references/api.md`. */
  path: string;
  content: string;
}

export interface SkillPreview {
  name: string;
  description: string;
  /** Human-readable origin, e.g. `github:owner/repo/path@ref` or a URL. */
  source: string;
  files: SkillSourceFile[];
}

export type ResolveError = { ok: false; error: string };
export type ResolveFound = { ok: true; preview: SkillPreview };
/** Source resolves to a repo/dir holding several skills — user picks one. */
export type ResolveChoices = { ok: true; choices: string[]; hint: string };
export type ResolveResult = ResolveError | ResolveFound | ResolveChoices;

const SKILL_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_FILES = 50;
const MAX_TOTAL_BYTES = 1_000_000;

function skillsDir(): string {
  return join(WORKSPACE_DIR, 'skills');
}

function sourcesFile(): string {
  return join(WORKSPACE_DIR, '.wayfind', 'skills.json');
}

/** Where a skill came from, for the Settings list. Best-effort record. */
export function getSkillSources(): Record<string, string> {
  try {
    if (!existsSync(sourcesFile())) return {};
    return JSON.parse(readFileSync(sourcesFile(), 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

function recordSkillSource(name: string, source: string): void {
  try {
    const dir = dirname(sourcesFile());
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const all = getSkillSources();
    all[name] = source;
    writeFileSync(sourcesFile(), JSON.stringify(all, null, 2) + '\n');
  } catch {
    /* best-effort */
  }
}

export function forgetSkillSource(name: string): void {
  try {
    const all = getSkillSources();
    delete all[name];
    writeFileSync(sourcesFile(), JSON.stringify(all, null, 2) + '\n');
  } catch {
    /* best-effort */
  }
}

/** Validate a preview before it may be saved. Returns blocking errors. */
export function validateSkillPreview(p: SkillPreview, opts?: { allowOverwrite?: boolean }): string[] {
  const errors: string[] = [];
  if (!p.name || !SKILL_NAME_RE.test(p.name) || p.name.length > 64) {
    errors.push(
      `Invalid skill name "${p.name}" — use lowercase letters, numbers, and hyphens only (e.g. my-skill).`,
    );
  }
  if (!p.description || p.description.length > 1024) {
    errors.push('Skill needs a description of 1–1024 characters in its frontmatter.');
  }
  if (!p.files.some((f) => f.path === 'SKILL.md')) {
    errors.push('Skill must include a SKILL.md file.');
  }
  if (!opts?.allowOverwrite && existsSync(join(skillsDir(), p.name, 'SKILL.md'))) {
    errors.push(`A skill named "${p.name}" is already installed — confirm overwrite to replace it.`);
  }
  const total = p.files.reduce((n, f) => n + f.content.length, 0);
  if (p.files.length > MAX_FILES || total > MAX_TOTAL_BYTES) {
    errors.push(`Skill is too large (${p.files.length} files) — imports are capped at ${MAX_FILES} files / 1MB.`);
  }
  return errors;
}

export function saveSkillPreview(p: SkillPreview): string {
  // Absolute: the traversal guard below compares absolute paths.
  const dir = resolve(join(skillsDir(), p.name));
  mkdirSync(dir, { recursive: true });
  for (const f of p.files) {
    const dest = resolve(dir, f.path);
    // Never write outside the skill dir, no matter what the source lists.
    if (dest !== dir && !dest.startsWith(dir + sep)) continue;
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, f.content);
  }
  recordSkillSource(p.name, p.source);
  return dir;
}

export function removeSkill(name: string): boolean {
  const dir = join(skillsDir(), name);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
  rmSync(dir, { recursive: true, force: true });
  forgetSkillSource(name);
  return true;
}

/** Installed-skill summary for the Settings list. */
export function listInstalledSkills(): Array<{ name: string; description: string; source: string; files: number }> {
  const sources = getSkillSources();
  return loadSkills().map((s) => ({
    name: s.name,
    description: s.description,
    source: sources[s.name] ?? 'local',
    files: countFiles(dirname(s.path)),
  }));
}

function countFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) n += countFiles(full);
    else n += 1;
  }
  return n;
}

/** SKILL.md files in the workspace that are NOT installed (repo discovery). */
export function scanLocalSkills(): Array<{ name: string; path: string; description: string }> {
  const root = resolve(WORKSPACE_DIR);
  const installed = resolve(skillsDir());
  const out: Array<{ name: string; path: string; description: string }> = [];
  for (const file of findSkillFiles(root)) {
    if (file === installed || file.startsWith(installed + sep)) continue;
    if (file.includes(`${sep}.wayfind${sep}`)) continue;
    try {
      const { name, description } = parseFrontmatter(readFileSync(file, 'utf8'));
      if (!name) continue;
      out.push({ name, path: relative(root, dirname(file)), description });
    } catch {
      /* unreadable — skip */
    }
  }
  return out.slice(0, 30);
}

// --- source resolution ------------------------------------------------------

type ParsedSource =
  | { kind: 'github'; owner: string; repo: string; subpath: string; ref: string }
  | { kind: 'skillmd'; url: string };

/** Accept `npx skills add <spec>`, bare `owner/repo[/path][@ref]`, GitHub URLs, or direct SKILL.md URLs. */
export function parseSkillSource(input: string): ParsedSource | null {
  let s = input.trim().replace(/^npx\s+skills\s+add\s+/, '').replace(/^["']|["']$/g, '');
  // Trailing @ref applies to every form (no slashes allowed after the @).
  let ref = 'HEAD';
  const atRef = s.match(/@([^/\s]+)$/);
  if (atRef) {
    ref = atRef[1];
    s = s.slice(0, atRef.index).replace(/\/$/, '');
  }
  // Direct SKILL.md file URL on any host.
  if (/^https?:\/\/\S+SKILL\.md$/.test(s)) return { kind: 'skillmd', url: s };
  const noProto = s.replace(/^https?:\/\/github\.com\//, '');
  // Reject non-GitHub absolute URLs and anything with whitespace.
  if (/^https?:\/\//.test(noProto) || /\s/.test(noProto)) return null;
  const m = noProto.match(/^([^/]+)\/([^/]+?)(?:\.git)?(?:\/(.+?))?\/?$/);
  if (!m) return null;
  const [, owner, repo, restRaw] = m;
  let subpath = (restRaw ?? '').replace(/\/$/, '');
  let branchRef = ref;
  // blob/<branch>/<path> or tree/<branch>/<path> — the URL branch wins.
  const bt = subpath.match(/^(?:blob|tree)\/([^/\s]+)\/(.+)$/);
  if (bt) {
    branchRef = bt[1];
    subpath = bt[2];
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return null;
  // A link straight at a SKILL.md file is a single-file fetch.
  if (subpath.endsWith('SKILL.md')) {
    const prefix = `https://raw.githubusercontent.com/${owner}/${repo}/${branchRef}`;
    return { kind: 'skillmd', url: `${prefix}/${subpath}` };
  }
  return { kind: 'github', owner, repo, subpath, ref: branchRef };
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/vnd.github.raw+json, text/plain' } });
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > MAX_TOTAL_BYTES ? null : text;
  } catch {
    return null;
  }
}

interface GhTreeEntry {
  path?: string;
  type?: string;
}

async function githubTree(owner: string, repo: string, ref: string): Promise<GhTreeEntry[] | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { tree?: GhTreeEntry[]; truncated?: boolean };
    if (!Array.isArray(data.tree) || data.truncated) return null;
    return data.tree;
  } catch {
    return null;
  }
}

/** Download every file under a skill dir from a GitHub tree snapshot. */
async function downloadSkillDir(
  owner: string,
  repo: string,
  ref: string,
  dir: string,
  tree: GhTreeEntry[],
): Promise<SkillSourceFile[] | null> {
  const prefix = dir ? `${dir}/` : '';
  const entries = tree.filter((e) => e.type === 'blob' && e.path?.startsWith(prefix));
  if (!entries.some((e) => e.path === `${prefix}SKILL.md`)) return null;
  if (entries.length > MAX_FILES) return null;
  const files: SkillSourceFile[] = [];
  let total = 0;
  for (const e of entries) {
    const rel = e.path!.slice(prefix.length);
    if (!rel || rel.startsWith('.git/')) continue;
    const content = await fetchText(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${prefix}${rel}`);
    if (content === null) return null;
    total += content.length;
    if (total > MAX_TOTAL_BYTES) return null;
    files.push({ path: rel, content });
  }
  return files.length > 0 ? files : null;
}

function previewFromFiles(source: string, files: SkillSourceFile[]): ResolveResult {
  const md = files.find((f) => f.path === 'SKILL.md');
  if (!md) return { ok: false, error: 'Source has no SKILL.md file.' };
  const { name, description } = parseFrontmatter(md.content);
  if (!name) return { ok: false, error: 'SKILL.md has no `name` in its frontmatter — cannot import.' };
  // No full validation here: preview must also work for already-installed
  // skills (Settings shows Overwrite, chat shows the conflict). Install-time
  // paths validate before writing.
  return { ok: true, preview: { name, description, source, files } };
}

/**
 * Resolve a user-provided source to an installable preview. Pure network —
 * never writes. Multi-skill repos return choices for the user to pick from.
 */
export async function resolveSkillSource(input: string): Promise<ResolveResult> {
  const parsed = parseSkillSource(input);
  if (!parsed) {
    return {
      ok: false,
      error:
        'Could not understand that source. Paste a GitHub repo/path link, a direct SKILL.md URL, or `npx skills add owner/repo[/path]`.',
    };
  }
  if (parsed.kind === 'skillmd') {
    const content = await fetchText(parsed.url);
    if (content === null) return { ok: false, error: 'Could not download that SKILL.md — check the link.' };
    return previewFromFiles(parsed.url, [{ path: 'SKILL.md', content }]);
  }
  const { owner, repo, subpath } = parsed;
  let ref = parsed.ref;
  // `HEAD` isn't fetchable from raw/tree endpoints — resolve the default branch.
  if (ref === 'HEAD') {
    try {
      const meta = (await (
        await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
          headers: { Accept: 'application/vnd.github+json' },
        })
      ).json()) as { default_branch?: string };
      if (meta.default_branch) ref = meta.default_branch;
    } catch {
      /* fall through with HEAD */
    }
  }
  const source = `github:${owner}/${repo}${subpath ? `/${subpath}` : ''}@${ref}`;
  // Fast path: subpath points at (or contains) a skill dir.
  const direct = await fetchText(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${subpath ? `${subpath}/` : ''}SKILL.md`);
  if (direct !== null) {
    return previewFromFiles(source, [{ path: 'SKILL.md', content: direct }]);
  }
  // Slow path: list the tree for skill dirs (capped).
  const tree = await githubTree(owner, repo, ref);
  if (!tree) {
    return {
      ok: false,
      error: `No SKILL.md at that path and the repo tree could not be listed — check the repo, path, and ref.`,
    };
  }
  const base = subpath ? `${subpath}/` : '';
  const skillDirs = new Set<string>();
  for (const e of tree) {
    if (e.type !== 'blob' || !e.path?.endsWith('/SKILL.md') || !e.path.startsWith(base)) continue;
    const dir = e.path.slice(0, -'/SKILL.md'.length);
    // Only shallow skill dirs: skills/<name> or <name> (not deeply nested).
    const depth = dir.slice(base.length).split('/').filter(Boolean).length;
    if (depth >= 1 && depth <= 2) skillDirs.add(dir);
  }
  const dirs = [...skillDirs].slice(0, 20);
  if (dirs.length === 0) {
    return { ok: false, error: `No SKILL.md found in ${owner}/${repo}${subpath ? ` under ${subpath}` : ''}.` };
  }
  if (dirs.length === 1) {
    const files = await downloadSkillDir(owner, repo, ref, dirs[0], tree);
    if (files) return previewFromFiles(`github:${owner}/${repo}/${dirs[0]}@${ref}`, files);
  }
  return {
    ok: true,
    choices: dirs,
    hint: `Found ${dirs.length} skills in ${owner}/${repo}. Ask the user which to import (e.g. \`npx skills add ${owner}/${repo}/${dirs[0].split('/').pop()}\` or paste the SKILL.md link).`,
  };
}

/**
 * Chat-driven skill importer. Two-step by design: preview first (read-only,
 * no approval), save only after the approval card. One call can carry a
 * whole batch — the single approval card lists everything upfront,
 * Approve-all style. The save step intentionally does NOT wrap in
 * guarded(): the needsApproval gate below is the single checkpoint
 * (its grant key is (tool-name, full-args) as derived by driveStream,
 * while guarded() would key ('write', 'skills/') — that miss emits a
 * ghost approval card that blocks nothing and confuses).
 * Deny policy is still honored explicitly.
 */
export function createSkillImportTool(_opts: GuardOpts): ReturnType<typeof tool> {
  const saveNow = async (preview: SkillPreview, overwrite: boolean): Promise<string> => {
    if (check(loadRules(), 'write', 'skills/') === 'deny') {
      return `Cannot install "${preview.name}": saving to skills/ is denied by policy.`;
    }
    const errors = validateSkillPreview(preview, { allowOverwrite: overwrite });
    if (errors.length > 0) return `Cannot install "${preview.name}": ${errors.join(' ')}`;
    const dir = saveSkillPreview(preview);
    let msg = `Installed "${preview.name}" from ${preview.source} (${preview.files.length} file(s)).`;
    // Skill-aware MCP: if the skill references MCP servers, the skill alone
    // is not enough — surface candidates so the model asks to install them.
    // (A genuine fork, not a confirm: the question tool is appropriate here.)
    try {
      const refs = detectMcpReferences(dir);
      if (refs.length > 0) {
        const lines = refs.map((r) => {
          const how = r.url ? r.url : (r.command ?? []).join(' ');
          const env = r.envKeys.length > 0 ? ` (needs env: ${r.envKeys.join(', ')})` : '';
          return `- ${r.name}: ${how}${env} [from ${r.source}]`;
        });
        msg +=
          `\nThis skill references ${refs.length} MCP server(s) it needs to actually work:\n${lines.join('\n')}\n` +
          `Ask the user with the question tool whether to install each one — one question can cover install + ` +
          `collecting any missing env values via custom answers. Install approved ones with install_mcp_server ` +
          `(show the exact command/URL + env KEY NAMES first; the approval card is the confirm). ` +
          `Local-path rule: run server checkouts already on the computer directly, else npx -y — never npm install -g. ` +
          `Paths on the user's own machine (C:\\…, /Users/…) do not exist on the computer.`;
      }
    } catch {
      // Detection is best-effort — the install itself already succeeded.
    }
    return msg;
  };

  return tool({
    name: 'import_skill',
    description:
      'Import skills from GitHub repos/links, direct SKILL.md URLs, or `npx skills add owner/repo[/path]` specs. ' +
      'ALWAYS call first with save:false to preview, show the preview to the user, ' +
      'then call again with save:true to install — the approval card is the confirm step. ' +
      'Pass several sources at once via sources:[...] (e.g. every skill the user picked from a multi-skill repo): ' +
      'one approval covers the whole batch. Pass overwrite:true only if replacing was confirmed.',
    parameters: z.object({
      source: z.string().optional().describe('GitHub URL, SKILL.md URL, or npx skills add spec (single install)'),
      sources: z
        .array(z.string())
        .optional()
        .describe('Several sources at once — one approval covers the whole batch'),
      save: z.boolean().default(false).describe('false = preview only; true = install'),
      overwrite: z.boolean().default(false).describe('Replace already-installed skills of the same name'),
    }),
    execute: async (args: { source?: string; sources?: string[]; save?: boolean; overwrite?: boolean }) => {
      const save = args.save ?? false;
      const overwrite = args.overwrite ?? false;
      const list = args.sources?.length ? args.sources : args.source ? [args.source] : [];
      if (list.length === 0) {
        return 'Usage: import_skill with source:"..." or sources:["...", ...], save:false to preview, save:true to install.';
      }
      if (list.length > 30) {
        return `Batch capped at 30 sources per call — got ${list.length}. Split it up.`;
      }
      const results = await Promise.all(list.map(async (s) => ({ s, r: await resolveSkillSource(s) })));
      const problems = results.filter(({ r }) => !r.ok);
      const choiceLists = results.filter(({ r }) => r.ok && 'choices' in r);
      const previews = results.filter(({ r }) => r.ok && 'preview' in r);
      if (!save) {
        const lines: string[] = [];
        for (const { r } of previews) {
          const p = (r as { preview: SkillPreview }).preview;
          const warnings = validateSkillPreview(p);
          lines.push(
            `- ${p.name}: ${p.description} (from ${p.source}${warnings.length > 0 ? ` — note: ${warnings.join(' ')}` : ''})`,
          );
        }
        for (const { s, r } of choiceLists) {
          const c = (r as { choices: string[]; hint: string }).choices;
          lines.push(`- ${s}: holds ${c.length} skills — ask the user which to install: ${c.join(', ')}`);
        }
        for (const { s, r } of problems) {
          lines.push(`- ${s}: FAILED — ${(r as { error: string }).error}`);
        }
        return (
          `Skill preview (${previews.length} installable, NOT installed yet):\n${lines.join('\n')}\n` +
          `Show this to the user, then call import_skill again with the same sources and save:true — ` +
          `the approval card is the confirm step, so do NOT add a question-tool confirm on top. ` +
          `For choices lists, use the question tool so the user can pick (a genuine fork, not a confirm).` +
          (previews.some(({ r }) => validateSkillPreview((r as { preview: SkillPreview }).preview).length > 0)
            ? ` If replacing was confirmed, pass overwrite:true.`
            : '')
        );
      }
      const done: string[] = [];
      const failed: string[] = [];
      for (const { r } of previews) {
        const msg = await saveNow((r as { preview: SkillPreview }).preview, overwrite);
        (msg.startsWith('Installed') ? done : failed).push(msg);
      }
      for (const { s, r } of [...choiceLists, ...problems]) {
        failed.push(`${s}: ${'hint' in r ? (r as { hint: string }).hint : (r as { error: string }).error}`);
      }
      return (
        `Batch install: ${done.length} installed, ${failed.length} failed.\n` +
        [...done, ...failed].map((m) => `- ${m}`).join('\n') +
        `\nInstalled skills are available to all bots immediately — no restart needed.`
      );
    },
    // Preview (and failed resolves) never park: only the file-writing save
    // step interrupts for approval, mirroring the write tool.
    needsApproval: async (_ctx: unknown, input: { save?: boolean }) => {
      if (!input.save) return false;
      if (process.env.PERMISSION_MODE === 'permissive') return false;
      return check(loadRules(), 'write', 'skills/') === 'ask';
    },
  });
}

/** Read-only workspace scan for importable skills (repo discovery). */
export function createSkillScanTool(): ReturnType<typeof tool> {
  return tool({
    name: 'scan_skills',
    description:
      'Find SKILL.md files already in the workspace (e.g. inside a cloned repo) that are not installed yet. ' +
      'Call when the user asks to find/use skills from the repo. Returns candidates; import a chosen one with import_skill.',
    parameters: z.object({}),
    execute: async () => {
      const found = scanLocalSkills();
      if (found.length === 0) {
        return 'No uninstalled skills found in the workspace. Clone a repo first, or import from a link with import_skill.';
      }
      return (
        `Uninstalled skills in the workspace:\n` +
        found.map((f) => `  - ${f.name}: ${f.description} (at ${f.path})`).join('\n') +
        `\nAsk the user which to import, then import_skill with the SKILL.md path contents.`
      );
    },
  });
}

/** How chat import works — appended to the agent instructions. */
export const SKILL_IMPORT_GUIDANCE =
  ' Skill imports: when the user shares GitHub skill links, SKILL.md URLs, or `npx skills add ...` commands — ' +
  'or asks to find skills in the workspace/repo (use scan_skills for that) — ' +
  'call import_skill with save:false to preview, show the preview, then call import_skill with save:true. ' +
  'When the user picks SEVERAL skills (e.g. "all 20"), pass every source in ONE call via sources:[...] — ' +
  'a single approval card covers the whole batch. ' +
  'The approval card is the confirm step — do not add a question-tool confirm on top. ' +
  'But when a source holds several skills and the user has not chosen yet, use the question tool ' +
  'so they can pick (a genuine fork, not a confirm). ' +
  'Never execute bundled scripts; skills are markdown only. ' +
  'Never research packages via shell (no npm view/pack, tarball downloads, or cache cleaning) — ' +
  'read the skill docs or ask the user instead.';
