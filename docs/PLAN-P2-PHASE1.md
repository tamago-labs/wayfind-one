# PLAN-P2 Phase 1 (detailed) — outer computer + team chat

## Build status 2026-11-12: SHIPPED (code surveyed)

Nearly everything below is built. `packages/outer-sandbox` serves team
CRUD + chat + approvals + voice/skills/MCP/permissions; frontend boots
`one_outer` and chats over Meta/Modal; image v1.0 published. What is NOT
built: `POST /computer/infer` (§3 — superseded by as-built injection,
proxy deferred to P2-Phase 5), `spawn_inner_sandbox` even as stub (§4.4 —
moved to P2-Phase 2), `teamManifestSha`/`lastTeamSyncAt` writes (§0 —
land with P2-Phase 4). Keep the steps below as the build record; the
acceptance list at the end is updated to remaining work.

Image build: PLAN-P2-OUTER-IMAGE.md (fork of cloud `packages/computer`).
Done = a logged-in user opens the app, one shared computer boots, and they
chat with a team AI bot (Meta open-weight via Modal) in the frontend. No
inner sandbox, no escalation, no attestation claims. Everything the outer
says is labeled `observed`.

Repo map: frontend + outer image live in **wayfind-one**
(`frontend/`, `packages/sandbox/` or a new `packages/outer-agent/`);
control-plane routes (provision, sync, Modal proxy, usage) live in
**wayfind-cloud** (`amplify/functions/wayfind-api/`). Steps mark the repo.

## 0. Computer data model (cloud schema — extend, don't fork)

Yes: the DB tracks the computer. S3 holds team bytes; DynamoDB holds
lifecycle + pointers (same hybrid-C split as conversations). Both products
share the Cognito pool and the `UserProfile.computer` hasOne — so one row
per user stays the invariant, and a `kind` discriminator says which flow
owns it. A separate model would risk two "computers" per user, two
provision paths, and split metering.

0.1. Extend `Computer` (wayfind-cloud `amplify/data/resource.ts`,
all nullable so existing rows are untouched — absent `kind` reads as
`classic`):

- `kind: enum ['classic', 'one_outer]` — which flow owns this row.
- `teamManifestSha: string` — sha of `team/manifest.json` at last sync
  (ONE only; lets provision verify restores and the shell show "team
  synced at X").
- `lastTeamSyncAt: datetime` — last successful team sync (ONE only).
- `outerModel: string` — pinned default Meta model id for this
  computer (ONE only; the allowlist itself stays a server constant).

0.2. Extend `SandboxSession` now (used in Phase 2, schema lands here so
no second migration):

- `parentComputerId: string` + secondary index — the nesting link: which
  outer computer spawned this inner run. Powers the Phase-4 Sandboxes
  history ("this computer → these runs").
- `policy: string` — ONE inner runs pin `verified_inference`.

0.3. Product-switch rule (same pool, one row): opening ONE while a
`classic` computer is `running` suspends it and provisions `one_outer`
(and vice versa). Team restore makes the ONE side cheap; the shell states
the switch explicitly — never two active computers, never silent
takeover.
**Status: AS-BUILT DIFFERENTLY — kind-scoped coexistence, not a switch.**
Cloud `pickComputer`/`dedupeComputers` scope by `kind`: both kinds may
exist, never two actives *per kind*, never cross-kind deletes. Accepted:
simpler, no silent takeover; cost is two VMs if the user straddles
products. Revisit only if billing demands it.

## 1. Boot-on-visit ensure (one)

1.1. On shell mount, frontend calls `GET /computer` state (or
`request` if none): states `not_provisioned → provisioning → running`,
plus `suspended → resume`, `terminated → provision fresh`. Poll every 3s
with backoff, 5-min cap, then error state with retry. (one/frontend,
cloud/routes/computer.ts already exists — add a single `GET /computer`
if missing.)

1.2. Shell UI states (one/frontend): `booting` (overlay with step text:
requesting → provisioning → restoring team → ready), `running`,
`degraded` (proxy reachable, loop unhealthy → read-only team list),
`failed` (error + retry button). Boot must not block login or sidebar
skeleton.

1.3. Approval gate: cloud `Computer.gateStatus` (`pending/approved/…`)
still applies. If `pending/queued`, shell shows "waiting for approval"
instead of polling provision. Decide in build: auto-approve ONE users or
keep the gate — default keep, surface the state.

## 2. Provision hook payload (cloud)

2.1. `POST /computer/provision` → VM `/hooks/run` receives (one/cloud
contract, extends the current shape):
`{ ownerId, computerId, usageToken (fresh, stored on row), apiUrl,
workspace: { bucket, prefix: 'computers/{id}/workspace' } }`.
NO provider master keys in this payload (proxy decision, PLAN-P2).

2.2. Restore order inside the VM entrypoint: download `team/**` via
presigned GETs → verify manifest (name/size/sha, written at last sync) →
start agent loop → report healthy. Boot fails closed if `team/config.json`
is corrupt (start empty team + flag, never half-restore).

## 3. Modal proxy route (cloud) — SUPERSEDED BY AS-BUILT

~~`POST /computer/infer` — VM-only auth via `usageToken`…~~ Not built, and
deliberately so: v1.0 injects `MODAL_API_KEY` + `PROVIDER_API_KEY` via
`/hooks/run` secrets and calls Modal directly from the VM
(`workspace/providers.json` pinned, `resolveModel` fails closed). The proxy
design below is preserved for P2-Phase 5 hardening; until then the threat
model states injection, and rotation stays operational. Original spec kept
for that build:

3.1. `POST /computer/infer` — VM-only auth via `usageToken` (the VM holds
no Cognito identity; browser NEVER calls this). Body:
`{ computerId, model, messages, stream?, usage: { sandboxRef? } }`.

3.2. Server: check Computer row `running` + per-user quota (1 computer,
N infer/min, daily token cap — constants file, Phase-1 values) →
forward to Modal with `MODAL_API_KEY` (+ `PROVIDER_API_KEY` as needed) →
stream SSE straight through to the VM (no buffering; chat UX depends on
it) → on completion, meter tokens against the usage ledger with the
`usageToken`.

3.3. Model allowlist server-side (constant, not client input): exact Meta
open-weight model IDs pinned at build time after a Modal spike (latency,
streaming format, tool-call support). Unknown model → 400. This is the
outer equivalent of the curated-model gate.

3.4. Errors: Modal 4xx/5xx → 502 with class `observed` (never leak the
key or upstream body); quota hit → 429 with `retryAfter`.

## 4. Outer agent image (one)

4.1. Endpoints on the agent server (extends the bot-runner shape):
`GET /health` (loop + last-restore info), `team/bots/list`,
`team/bots/save` (create/update one JSON file, schema-validated),
`agent/message` (`{ botId, content }` → append user turn → Modal call via
§3 → append assistant turn → return new entries), `agent/transcript`
(`{ botId }` → hash-chained entries + `verified:false, class:'observed'`).

4.2. `ai.ts` gains a `modal` provider branch: POST to the injected
`apiUrl/computer/infer` with `usageToken`. `near-ai` branch stays but is
unreachable in the outer image (allowlist has no near-ai models → the
501 still guards). System prompt = bot JSON `role` + `description` +
team display name.

4.3. History: `team/history/<bot-id>.jsonl`, append-only hash-chained
(same `seq/prev/hash` scheme as bot.ts transcripts — reuse the code, new
path). Single-turn per call first (no tool loop in Phase 1); `agent/message`
is one user turn → one assistant turn. Tool loop is Phase 3.

4.4. `spawn_inner_sandbox` ships as a **stub returning 501**
`inner sandboxes arrive in Phase 2`. Contract fixed early, behavior
honestly absent. Frontend renders no escalation affordance yet.
**Status: NOT BUILT — not even the stub exists in code. Moved to P2-Phase
2 item 2 (stub first, then behavior).**

## 5. Team files + S3 sync (one + cloud)

5.1. Schema v1 (`"v": 1` required key):
`team/bots/<id>.json = { v, id, name, role, description, color, status,
model, createdAt, updatedAt }` — mirrors current `Bot` rows so the
sidebar needs no redesign. `team/config.json = { v, defaultModel,
escalation: 'manual', displayName }`. History stays out of the JSON
(jsonl only).

5.2. Sync reuses `sync.ts` presigned URLs under
`computers/{computerId}/workspace/team/**`. The verified `.wayfind/` skip
stays — team files live under `team/`, period. Caps inherited (25MB/file,
2000 files). Sync triggers: every N messages, on clean suspend, always
before terminate; restore on every provision (step 2.2).

5.3. Conflict rule (multi-device later, stated now): last-writer-wins per
file with `updatedAt`; a `team/manifest.json` (path → sha256) makes
corrupt restores detectable. No merge UI in Phase 1.

## 6. Sidebar from files (one/frontend)

6.1. New `lib/team.ts`: `listTeamBots()` (proxy `team/bots/list`),
`saveTeamBot()` (proxy `team/bots/save`). `listBots()` (Amplify Data)
deleted from the ONE path once this lands — grep must show zero
`models.Bot` in `frontend/`. `UserProfile` display-name code stays.

6.2. Bot create/edit writes JSON via relay (same modal UI, new save
path). Bot fields map 1:1 to the v1 schema. Delete = save with
`status:'paused'` first (tombstone, restorable); hard delete is Phase 5.

6.3. Sidebar boot state: computer `provisioning` → skeleton list;
`running` + empty team → "create your first bot" empty state (bot
creation must work before any chat exists).

## 7. Team chat UI (one/frontend)

7.1. New main-area view `TeamChat` (main stage, replaces `WorkspaceEmpty`
when a bot is selected): bot header (avatar, name, model badge
`Meta · <model> · observed`), message list, composer, `Enter` send.
No security-level selector, no evidence panel, no escalation button —
the honest Phase-1 surface is "chat, observed."

7.2. Message flow: `agent/message` → optimistic user bubble → streamed
assistant tokens (SSE through the proxy chain browser→control
plane→VM→control plane→Modal — verify streaming works end-to-end before
polish) → transcript re-pull on completion. Errors render inline with
retry; 429 shows quota text; 501 shows "not in Phase 1".

7.3. Closed-history: history renders from `agent/transcript` (VM live) or
`team/history/*.jsonl` restored via sync (VM down) — same two-source
rule as checkpoints, without the crypto envelope (outer history is
`observed`, not sealed; sealing arrives with inner runs in Phase 2+).

## 8. Metering + limits (cloud)

8.1. VM reports Modal token counts per call with `usageToken`
(server-to-server, existing usage route). Control plane reconciles
against the proxy's own counts (it saw the bytes) — mismatch alerts, not
silent drops.

8.2. Phase-1 constants: 1 computer/user, infer 30/min, 200k tokens/day
(tune after first bills). Exceeding any → 429 + shell banner, never a
surprise bill.

## 9. Acceptance (updated 2026-11-12 — ✅ = verified built, → = remaining)

- [x] `Computer` row carries `kind:'one_outer'` (+ team sync fields in
  schema; writes land P2-Phase 4); `SandboxSession.parentComputerId`
  schema + index present (writes land P2-Phase 2).
- [x] Fresh user → app → computer `running` → create bot → chat turns on
  Meta/Modal (direct injection, streaming end to end).
- [x] Terminate computer → provision → team + history restored from S3,
  manifest verifies.
- [x] `grep -r models.Bot frontend/` empty on the sidebar path
  (`data.ts:listBots` survives only for the legacy Bots/New tabs);
  `UserProfile` code intact.
- [x] Only `usageToken` + `apiUrl` + Wayfind-held provider secrets
  injected (no Cognito identity in VM); `.wayfind/` never syncs.
- [x] Quota trip → 429 + banner, no key leak in any error body.
- [ ] → `spawn_inner_sandbox` → honest 501 (moved P2-Phase 2); no
  escalation UI anywhere (holds today).
- [x] Every assistant message carries `class:'observed'`; no
  `hardware-attested` string anywhere in the Phase-1 path.

## Non-goals (Phase 1)

Inner sandboxes, escalation, sealed envelopes outer-side, tool loop,
policies/allowlist UI, API renames, image signing, cost attribution —
all Phase ≥2. The `/conversations/*` path keeps running untouched for
the current Trust Center demos.
