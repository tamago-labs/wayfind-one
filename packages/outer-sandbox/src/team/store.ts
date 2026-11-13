// Team files: the AI team as JSON on disk — the runtime source of truth.
// Bots are NOT database rows on the ONE outer path. Layout (workspace
// root so the S3 sync walk picks it up — NEVER under .wayfind/, which the
// sync deliberately skips):
//   team/bots/<id>.json        v1 bot record (mirrors the old Bot row fields)
//   team/history/<id>.jsonl    append-only hash-chained user/assistant turns
//   team/config.json           team prefs (defaultModel, escalation mode)
//   team/briefs/<id>.md        pinned briefings (auditable training context)
//   team/evidence/<sandbox>.json per inner-sandbox run: result + verification
//                            + receipt (synced like everything else in team/)
//   team/manifest.json         path -> sha256, written on every save
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';
import { WORKSPACE_DIR } from '../core/config.js';

const TEAM_DIR = join(resolve(WORKSPACE_DIR), 'team');
const BOTS_DIR = join(TEAM_DIR, 'bots');
const HISTORY_DIR = join(TEAM_DIR, 'history');
const BRIEFS_DIR = join(TEAM_DIR, 'briefs');
const EVIDENCE_DIR = join(TEAM_DIR, 'evidence');
const CONFIG_PATH = join(TEAM_DIR, 'config.json');
const MANIFEST_PATH = join(TEAM_DIR, 'manifest.json');

const ID_RE = /^[A-Za-z0-9-]+$/;

export const BOT_COLORS = ['amber', 'moss', 'lagoon', 'ash', 'blue', 'coral', 'grape'] as const;
export const BOT_SHAPES = ['blob', 'circle', 'squircle', 'pebble'] as const;

export const TeamBotSchema = z.object({
  v: z.literal(1),
  id: z.string().regex(ID_RE).max(64),
  name: z.string().min(1).max(40),
  role: z.string().max(80).optional(),
  description: z.string().max(200).optional(),
  color: z.enum(BOT_COLORS).optional(),
  shape: z.enum(BOT_SHAPES).optional(),
  isChiefOfStaff: z.boolean().default(false),
  status: z.enum(['active', 'paused']).default('active'),
  model: z.string().max(128).optional(),
  sandboxTarget: z.enum(['direct', 'team']).optional(),
  sandboxProfile: z.enum(['review', 'analysis']).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type TeamBot = z.infer<typeof TeamBotSchema>;

export const TeamConfigSchema = z.object({
  v: z.literal(1),
  defaultModel: z.string().max(128),
  escalation: z.enum(['manual', 'auto-logged']),
});

export type TeamConfig = z.infer<typeof TeamConfigSchema>;

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function safeId(id: string): string {
  if (!ID_RE.test(id)) throw new Error(`bad bot id: ${id}`);
  return id;
}

/** Seed skeleton on first boot; never clobbers an existing team. */
export function ensureTeamSeed(defaultModel: string): void {
  mkdirSync(BOTS_DIR, { recursive: true });
  mkdirSync(HISTORY_DIR, { recursive: true });
  if (!existsSync(CONFIG_PATH)) {
    const cfg: TeamConfig = { v: 1, defaultModel, escalation: 'manual' };
    writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  }
  if (!existsSync(MANIFEST_PATH)) {
    writeFileSync(MANIFEST_PATH, JSON.stringify({ v: 1, files: {}, updatedAt: new Date().toISOString() }, null, 2));
  }
}

export function listTeamBots(): TeamBot[] {
  ensureTeamSeed('meta-models/Muse-Spark-Open-816B-A42B');
  const out: TeamBot[] = [];
  for (const f of readdirSync(BOTS_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const b = TeamBotSchema.parse(JSON.parse(readFileSync(join(BOTS_DIR, f), 'utf8')));
      if (b.id === f.slice(0, -5)) out.push(b);
    } catch {
      // Corrupt bot file: skip loudly, never crash the roster.
      console.error(`[team] skipping unreadable bot file: ${f}`);
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function getTeamBot(id: string): TeamBot | null {
  ensureTeamSeed('meta-models/Muse-Spark-Open-816B-A42B');
  const p = join(BOTS_DIR, `${safeId(id)}.json`);
  if (!existsSync(p)) return null;
  return TeamBotSchema.parse(JSON.parse(readFileSync(p, 'utf8')));
}

export interface SaveBotInput {
  id?: string;
  name: string;
  role?: string;
  description?: string;
  color?: (typeof BOT_COLORS)[number];
  shape?: (typeof BOT_SHAPES)[number];
  isChiefOfStaff?: boolean;
  status?: 'active' | 'paused';
  model?: string;
  sandboxTarget?: 'direct' | 'team';
  sandboxProfile?: 'review' | 'analysis';
}

/** Unused color/shape combo (cloud AppShell.createBot rule): prefer a
 * combo nobody holds yet; fall back to random when exhausted. */
export function freeCombo(): { color: (typeof BOT_COLORS)[number]; shape: (typeof BOT_SHAPES)[number] } {
  const used = new Set<string>();
  try {
    for (const b of listTeamBots()) {
      if (b.color && b.shape) used.add(`${b.color}/${b.shape}`);
    }
  } catch {
    // Fresh team — everything is free.
  }
  const free: Array<{ color: (typeof BOT_COLORS)[number]; shape: (typeof BOT_SHAPES)[number] }> = [];
  for (const color of BOT_COLORS) {
    for (const shape of BOT_SHAPES) {
      if (!used.has(`${color}/${shape}`)) free.push({ color, shape });
    }
  }
  const pool = free.length > 0 ? free : BOT_COLORS.flatMap((color) => BOT_SHAPES.map((shape) => ({ color, shape })));
  return pool[Math.floor(Math.random() * pool.length)];
}

function writeBotFile(bot: TeamBot): void {
  writeFileSync(join(BOTS_DIR, `${bot.id}.json`), JSON.stringify(bot, null, 2));
}

/** Hard delete: bot file + thread history, then manifest. Missing id → false. */
export function deleteTeamBot(id: string): boolean {
  ensureTeamSeed('meta-models/Muse-Spark-Open-816B-A42B');
  const safe = safeId(id);
  let gone = false;
  for (const p of [join(BOTS_DIR, `${safe}.json`), join(HISTORY_DIR, `${safe}.jsonl`)]) {
    try {
      if (existsSync(p)) {
        unlinkSync(p);
        gone = true;
      }
    } catch {
      // Best-effort per file.
    }
  }
  if (gone) writeManifest();
  return gone;
}

export function saveTeamBot(input: SaveBotInput): TeamBot {
  ensureTeamSeed('meta-models/Muse-Spark-Open-816B-A42B');
  const id = input.id && ID_RE.test(input.id) ? input.id : randomUUID();
  const prev = getTeamBot(id);
  const now = new Date().toISOString();
  const combo = !input.color || !input.shape ? freeCombo() : null;
  // Chief always carries the chief role unless the user wrote something
  // else (mirrors cloud AppShell.saveBotEdits).
  const isChief = input.isChiefOfStaff ?? prev?.isChiefOfStaff ?? false;
  let role = input.role !== undefined ? input.role : prev?.role;
  if (isChief && !(role ?? '').trim()) role = 'Chief of staff';
  const bot = TeamBotSchema.parse({
    v: 1,
    id,
    name: input.name,
    ...(role !== undefined ? { role } : {}),
    ...(input.description !== undefined ? { description: input.description } : prev?.description ? { description: prev.description } : {}),
    color: input.color ?? prev?.color ?? combo?.color ?? 'amber',
    shape: input.shape ?? prev?.shape ?? combo?.shape ?? 'blob',
    isChiefOfStaff: isChief,
    status: input.status ?? prev?.status ?? 'active',
    ...(input.model !== undefined ? { model: input.model } : prev?.model ? { model: prev.model } : {}),
    ...(input.sandboxTarget !== undefined ? { sandboxTarget: input.sandboxTarget } : prev?.sandboxTarget ? { sandboxTarget: prev.sandboxTarget } : {}),
    ...(input.sandboxProfile !== undefined ? { sandboxProfile: input.sandboxProfile } : prev?.sandboxProfile ? { sandboxProfile: prev.sandboxProfile } : {}),
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  });
  writeBotFile(bot);
  // One chief: crowning a new chief unsets all others.
  if (bot.isChiefOfStaff) {
    for (const other of listTeamBots()) {
      if (other.id !== bot.id && other.isChiefOfStaff) {
        writeBotFile({ ...other, isChiefOfStaff: false, updatedAt: now });
      }
    }
  }
  writeManifest();
  return bot;
}

/** Persist one closed inner-sandbox session's evidence bundle. Synced
 * with everything else under team/; the frontend viewer reads it back.
 * Overwrites are fine — one file per sandbox, written once at close. */
export function saveEvidence(sandboxId: string, record: Record<string, unknown>): void {
  ensureTeamSeed('meta-models/Muse-Spark-Open-816B-A42B');
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const safe = String(sandboxId).replace(/[^A-Za-z0-9-]/g, '').slice(0, 128);
  if (!safe) throw new Error('bad sandbox id for evidence');
  writeFileSync(join(EVIDENCE_DIR, `${safe}.json`), JSON.stringify({ v: 1, ...record }, null, 2));
  writeManifest();
}

/** One-line summary for the panel's closed-runs list. Human fields
 * (task, duration, verification counts) are extracted here so the list
 * never ships full transcripts. */
export interface EvidenceSummary {
  sandboxId: string;
  closedAt: string | null;
  turns: number | null;
  receiptClass: string | null;
  /** First user message, truncated — the row title. Null when no transcript. */
  task: string | null;
  /** provisionedAt → terminatedAt in ms. Null when timestamps missing. */
  durationMs: number | null;
  model: string | null;
  stepsVerified: number;
  stepsTotal: number;
}

/** List stored evidence bundles (newest first) for the panel's closed-runs
 * section. Summaries only — full bundles load per-row on demand. */
export function listEvidence(): EvidenceSummary[] {
  ensureTeamSeed('meta-models/Muse-Spark-Open-816B-A42B');
  const dir = join(TEAM_DIR, 'evidence');
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const out: EvidenceSummary[] = [];
  for (const name of names.slice(0, 200)) {
    try {
      const raw = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Record<string, unknown>;
      const receipt = raw.receipt as {
        class?: string;
        model?: string;
        provisionedAt?: string;
        terminatedAt?: string;
        inference?: { botEvidence?: { messages?: Array<{ checked?: boolean; valid?: boolean }> } };
      } | undefined;
      const transcript = Array.isArray(raw.transcript) ? raw.transcript as Array<{ role?: string; content?: string }> : [];
      const firstUser = transcript.find((t) => t?.role === 'user' && typeof t.content === 'string' && t.content.trim());
      const taskText = typeof firstUser?.content === 'string' ? firstUser.content.trim().slice(0, 140) : '';
      const msgs = receipt?.inference?.botEvidence?.messages ?? [];
      const checked = msgs.filter((m) => m?.checked);
      const t0 = receipt?.provisionedAt ? Date.parse(receipt.provisionedAt) : NaN;
      const t1 = receipt?.terminatedAt ? Date.parse(receipt.terminatedAt) : NaN;
      out.push({
        sandboxId: String(raw.sandboxId ?? name.replace(/\.json$/, '')),
        closedAt: typeof raw.closedAt === 'string' ? raw.closedAt : null,
        turns: typeof raw.turns === 'number' ? raw.turns : null,
        receiptClass: typeof receipt?.class === 'string' ? receipt.class : null,
        task: taskText ? taskText : null,
        durationMs: Number.isFinite(t0) && Number.isFinite(t1) && t1 >= t0 ? t1 - t0 : null,
        model: typeof receipt?.model === 'string' ? receipt.model : null,
        stepsVerified: checked.filter((m) => m.valid === true).length,
        stepsTotal: checked.length,
      });
    } catch {
      // Corrupt bundle — skip, never crash the list.
    }
  }
  out.sort((a, b) => String(b.closedAt ?? '').localeCompare(String(a.closedAt ?? '')));
  return out;
}

/** Read a stored evidence bundle (frontend viewer path). Null if absent. */
export function readEvidence(sandboxId: string): Record<string, unknown> | null {  const safe = String(sandboxId).replace(/[^A-Za-z0-9-]/g, '').slice(0, 128);
  if (!safe) return null;
  const p = join(EVIDENCE_DIR, `${safe}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Roster shape the agent loop already speaks (@mentions, delegation). */
export function toRosterEntry(b: TeamBot): { id: string; name: string; role?: string } {
  return { id: b.id, name: b.name, ...(b.role ? { role: b.role } : {}) };
}

function collectFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string, relBase: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const full = join(dir, name);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      const rel = ((relBase ? `${relBase}/` : '') + name).split(sep).join('/');
      if (isDir) {
        walk(full, rel);
      } else if (name !== 'manifest.json') {
        try {
          files[rel] = sha256Hex(readFileSync(full));
        } catch {
          // Vanished mid-walk — skip.
        }
      }
    }
  };
  walk(BOTS_DIR, 'bots');
  walk(HISTORY_DIR, 'history');
  walk(BRIEFS_DIR, 'briefs');
  walk(EVIDENCE_DIR, 'evidence');
  try {
    files['config.json'] = sha256Hex(readFileSync(CONFIG_PATH));
  } catch {
    // Missing config — seed will handle it.
  }
  return files;
}

function writeManifest(): void {
  writeFileSync(
    MANIFEST_PATH,
    JSON.stringify({ v: 1, files: collectFiles(), updatedAt: new Date().toISOString() }, null, 2),
  );
}

export interface ManifestCheck {
  ok: boolean;
  missing: string[];
  extra: string[];
  changed: string[];
}

/** Compare disk against the manifest — detects failed restores. */
export function verifyTeamManifest(): ManifestCheck {
  try {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as { files?: Record<string, string> };
    const want = manifest.files ?? {};
    const have = collectFiles();
    const missing = Object.keys(want).filter((k) => !(k in have));
    const extra = Object.keys(have).filter((k) => !(k in want));
    const changed = Object.keys(want).filter((k) => k in have && want[k] !== have[k]);
    return { ok: missing.length === 0 && changed.length === 0, missing, extra, changed };
  } catch {
    return { ok: false, missing: [], extra: [], changed: [] };
  }
}

export function getTeamConfig(): TeamConfig {
  ensureTeamSeed('meta-models/Muse-Spark-Open-816B-A42B');
  try {
    return TeamConfigSchema.parse(JSON.parse(readFileSync(CONFIG_PATH, 'utf8')));
  } catch {
    const fallback: TeamConfig = { v: 1, defaultModel: 'meta-models/Muse-Spark-Open-816B-A42B', escalation: 'manual' };
    writeFileSync(CONFIG_PATH, JSON.stringify(fallback, null, 2));
    return fallback;
  }
}

export function saveTeamConfig(input: { defaultModel?: string; escalation?: 'manual' | 'auto-logged' }): TeamConfig {
  const prev = getTeamConfig();
  const cfg = TeamConfigSchema.parse({
    v: 1,
    defaultModel: input.defaultModel ?? prev.defaultModel,
    escalation: input.escalation ?? prev.escalation,
  });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  writeManifest();
  return cfg;
}

export interface HistoryEntry {
  seq: number;
  role: 'user' | 'assistant';
  content: string;
  prev: string;
  hash: string;
}

function entryHash(seq: number, role: string, content: string, prev: string): string {
  return sha256Hex(Buffer.from(`${seq}\n${role}\n${content}\n${prev}`, 'utf8'));
}

/** Append one turn to the bot's hash-chained history. */
export function appendHistory(botId: string, role: 'user' | 'assistant', content: string): HistoryEntry {
  ensureTeamSeed('meta-models/Muse-Spark-Open-816B-A42B');
  const p = join(HISTORY_DIR, `${safeId(botId)}.jsonl`);
  const prev = readHistory(botId);
  const seq = prev.entries.length;
  const prevHash = seq === 0 ? 'GENESIS' : prev.entries[seq - 1].hash;
  const entry: HistoryEntry = { seq, role, content, prev: prevHash, hash: entryHash(seq, role, content, prevHash) };
  writeFileSync(p, (seq === 0 ? '' : readFileSync(p, 'utf8')) + JSON.stringify(entry) + '\n');
  writeManifest();
  return entry;
}

export function readHistory(botId: string): { entries: HistoryEntry[]; verified: boolean } {
  const p = join(HISTORY_DIR, `${safeId(botId)}.jsonl`);
  if (!existsSync(p)) return { entries: [], verified: true };
  const entries: HistoryEntry[] = [];
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as HistoryEntry);
    } catch {
      return { entries, verified: false };
    }
  }
  for (const [i, e] of entries.entries()) {
    if (e.seq !== i) return { entries, verified: false };
    const wantPrev = i === 0 ? 'GENESIS' : entries[i - 1].hash;
    if (e.prev !== wantPrev || e.hash !== entryHash(e.seq, e.role, e.content, e.prev)) {
      return { entries, verified: false };
    }
  }
  return { entries, verified: true };
}

/** Recent thread history as plain text for the per-turn system brief.
 * Sessions are in-RAM (lost on restart) and the SDK seed shape is
 * Responses-specific (dropped by the Modal chat provider), so the file
 * history is replayed as text the model always sees. Empty when fresh. */
export function threadHistoryBlock(botId: string, limit = 10): string {
  const { entries } = readHistory(botId);
  const recent = entries.slice(-limit);
  if (recent.length === 0) return '';
  const lines = recent.map((e) => `${e.role}: ${e.content}`);
  return `\n\n[thread history — earlier in this conversation, stay consistent with it]\n${lines.join('\n')}\n[end history]`;
}
