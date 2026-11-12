# PLAN-P2.md — nested sandboxes for Wayfind ONE

Status: active. PIVOT.md is the vision; PLAN-P1 built the per-conversation
MicroVM + Trust Center shell. This plan re-architects onto **nested
sandboxes**: one persistent shared computer per user (outer sandbox, AI team
as files, Meta open-weight inference via Modal) + disposable per-task inner
sandboxes (Near-AI only, attested, killed after each task).
Detail: PLAN-P2-PHASE1.md (Phase 1 build plan — outer computer + team chat).

## Reality check 2026-11-12 (code surveyed, plans corrected below)

Phase 1 is **substantially built**, not future work. Verified on disk:
- Outer image fork exists: `packages/outer-sandbox` (@openai/agents loop,
  team store, `team/bots|history|config|manifest`, sync, voice/MCP/skills/
  permissions endpoints, outer-image pipeline, image v1.0 published as
  `wayfind-outer`). `packages/sandbox` (inner) is unchanged: near-ai-only,
  single-turn, no loop, no spawn tool.
- Frontend: `ensureComputer('one_outer')` boot gate + `ComputerTab`,
  file-backed roster (`lib/team.ts`, sidebar never touches `models.Bot`),
  `TeamChat` + `TeamRoster` + `NewBotModal` + approvals UI. Still 100%
  `conversation` naming; escalation UI: none; `Sandboxes` view: none.
- Cloud: `Computer.kind` + `ONE_OUTER_IMAGE_ARN` + `ONE_OUTER_MODEL` wired;
  kind-scoped **coexistence** (both kinds can exist; no suspend-other
  switch). `teamManifestSha` / `lastTeamSyncAt` / `parentComputerId` /
  `policy` are **schema-only, never written**. No `/computer/infer` proxy,
  no `/sandboxes/*` routes. Modal keys are **injected** via `/hooks/run`
  secrets (as-built, see decision below) — not proxied.
- UI-PARITY A–C built (chief enforcement server-side
  `store.ts:179-182`, `NewBotModal`, roster in sidebar); D mostly built
  (`TeamChat`, `Markdown.tsx`, approvals); bot-edit/delete still out.

Corrections applied through this doc: Modal posture recorded as-built
(injection now, proxy Phase 5); spawn stub marked missing (Phase 2);
inner agent-loop added (Phase 2); briefing artifact added (Phase 3);
UI-label rename moved forward (do now); schema-write gaps called out
where they land.

Locked inputs (2026-11-12):
- Outer inference = Meta open-weight models via Modal; `MODAL_API_KEY` +
  `PROVIDER_API_KEY` Wayfind-held in Amplify secrets, injected at provision.
  **As-built decision (code surveyed): injection, not proxy.** The v1.0
  outer image calls Modal directly (`workspace/providers.json` pinned to
  `meta-models/Muse-Spark-Open-816B-A42B`, `resolveModel` fails closed);
  no `/computer/infer` route exists. Rationale recorded: unblocks Phase 1
  without a new backend route; matches the ancestor's provision contract.
  Cost: master key material reaches VM memory (keystore 0600, never synced).
  The control-plane infer proxy moves to **Phase 5 hardening**; until then
  the threat model states injection explicitly and key rotation stays
  operational (rotation via keystore + re-provision).
- Routing is **structural**: sensitive files physically exist only inside
  inner sandboxes; the outer layer sees task text + returned results only.
- Team state (bots JSON, history, config) survives terminate via S3 sync —
  same mechanism as cloud's computer sync.
- Inner sandbox = fresh MicroVM per sensitive task, then kill.
- Rename starts at UI labels (conversation → sandbox, Trust Center →
  Sandboxes); API routes + DB models keep names until Phase 5.
  **Update: do the label rename now** (labels-only, kills doc/code drift);
  the old six-section Trust Center becomes the Sandboxes panel in Phase 4.

## Target UX — what "done" looks like (finance bot + HR bot)

The canonical flow the phases below must deliver, shown once in full
(finance) and repeated by every team bot (HR):

1. **Create the team.** App boots the outer computer. New Bot → finance
   bot (role, description, what counts as sensitive); New Bot → HR bot.
   Optional chief-of-staff star. Bots persist as `team/bots/*.json`.
2. **Train until confident.** Ordinary outer chat (`observed`, Meta/Modal):
   paste policy docs, run dry-runs on fake data, correct mistakes. History
   accumulates hash-chained in `team/history/<bot>.jsonl`.
3. **Pin what it knows.** BotPanel → Briefing → `team/briefs/<bot>.md`,
   versioned + S3-synced. Briefing + history is the bot's memory; the
   escalation later binds to the briefing version.
4. **Trigger — chat or UI, same tool.** Chat: "Review the attached March
   invoices" + file → bot classifies sensitive → approval dialog
   (manual mode) → approve. UI: composer "Run in sandbox" action + file
   picker → same path, one click less. Auto-logged mode collapses
   classify+approve into classify+log. The attachment is held client-side;
   the outer VM never receives the bytes.
5. **Sandbox run.** Fresh inner MicroVM (`verified_inference` only);
   files pushed sealed direct-to-inner, never touching outer disk or outer
   context. Attestation preflight fails closed before any prompt. Bounded
   single-agent tool loop (read/grep/local exec, NEAR-API-only egress),
   per-iteration signature verify, progress events in the outer thread.
6. **Mid-run uploads.** Attach in the thread → sealed direct-to-inner
   envelope appended to the running sandbox. Outer still never sees bytes.
7. **Close-out.** Final sealed checkpoint → receipt binding
   `{ outerComputerId, innerSandboxId, taskDescriptorHash }` → verified VM
   destroy. Result streams back with an evidence badge (outer `observed`,
   inner `hardware-attested`).
8. **Verify + export.** Sandboxes panel shows the nested run; panel check,
   CLI `verify`, NEAR widget must all agree; one-click evidence bundle.
   HR bot repeats the identical pattern — different bot, different
   briefing, same machinery.

Mental model: train in the open (outer, `observed`) until the bot knows
the job — then sensitive bytes skip the outer entirely and land sealed in
a disposable attested sandbox, and what comes back is a result plus proof.

## 0. Terminology (used throughout)

- **Computer (outer sandbox):** one persistent per-user VM, suspend/resume
  across visits, booted on app visit. Runs the AI team + everyday agent
  loop. Non-attested inference. Claims about it are `observed` at best.
- **Team:** the user's bots as `team/bots/*.json` on the computer's disk.
  Runtime source of truth. No `Bot` DB rows on the ONE path.
- **Sandbox (inner):** one disposable MicroVM per sensitive task. Sealed
  file intake, Near-AI-only inference with attestation preflight, sealed
  evidence out, terminated after the task. Claims about it can be
  `hardware-attested`.
- **Escalation:** the outer sub-agent spawning an inner sandbox. Always
  logged; the log entry is evidence.

## Phase 1 — outer computer for ONE — ✅ BUILT, SKIP IN EXECUTION

Goal: visiting the app boots (or resumes) exactly one shared computer that
understands the new flow. Sidebar team list comes from files, not the DB.

Execution: SKIP — nothing to build here. The remaining items (PIVOT edits,
strip audit, outer-tests, rotation doc) are parallel doc/test tasks, not a
build phase. Start execution at Phase 2.

Status: shipped. `packages/outer-sandbox` (fork of cloud `packages/computer`)
serves `GET /team/bots|history|config`, `POST /team/bots|chat`, approvals/
questions/voice/skills/MCP/permissions; frontend `ensureComputer` +
`TeamChat`/`TeamRoster`/`NewBotModal` wired to it; `team/**` syncs via the
existing presigned-sync path (`.wayfind/` skipped both directions, verified
in code). Image v1.0 published (`wayfind-outer`). Remaining Phase-1 gaps:
`spawn_inner_sandbox` (not even a stub — moved to Phase 2),
`teamManifestSha`/`lastTeamSyncAt` never written (land with Phase 4
history view), kind-scoped coexistence instead of suspend-other switch
(accepted as-built; never two actives *per kind*).

Original build steps kept below for the record:

1. **Boot-on-visit ensure.** Shell mount calls `request` + `provision`
   (reuse cloud `/computer/*` routes) and blocks the workspace on
   `provisionStatus === 'running'`. Suspend/resume preserved; no
   terminate-on-task. Show computer state in the shell (reuses the staged
   Sandboxes panel later — Phase 4).
2. **Provision hook (`/hooks/run`) for the new flow.** Inject
   `MODAL_API_KEY` + `PROVIDER_API_KEY` from Amplify secrets, mint
   `usageToken` onto the `Computer` row, pass `apiUrl` + workspace
   `{ bucket, prefix }` exactly like the current computer provision. Image
   must include the outer agent loop (Phase 3 builds it; Phase 1 can ship
   with a stub loop that only serves team files + health).
3. **Team files layout (on disk).**
   ```
   ~/team/bots/<bot-id>.json        # id, name, role, description, color, status, model prefs
   ~/team/history/<bot-id>.jsonl    # append-only, hash-chained like transcripts
   ~/team/config.json               # team-level prefs (default model, escalation policy)
   ```
   Schema versioned (`"v": 1`). Bot JSON mirrors the current `Bot` row
   fields so the sidebar needs no redesign.
4. **S3 sync path for `team/`.** Extend the presigned sync to
   `computers/{computerId}/workspace/team/**`. **Trap (verified in
   `sync.ts`): download skips `.wayfind/`** — so team files live under
   `team/`, NOT `.wayfind/`, or the skip rule is changed deliberately and
   documented. Restore-on-provision replays `team/**` before the agent
   loop starts.
5. **Sidebar reads from files.** Replace `listBots()` (Amplify Data,
   cross-repo coupling) with a proxy call listing `team/bots/*.json`.
   Bot create/edit writes a JSON file through the relay — the cloud bot
   builder is out of the ONE path. `UserProfile` (display name) stays on
   Amplify Data; `Bot` reads go dark on ONE.
6. **Modal key posture (decision, locked here — SUPERSEDED by as-built,
   see Locked inputs):** ~~The VM must NOT hold the master `MODAL_API_KEY`.
   Outer inference calls go VM → control-plane proxy → Modal~~. Reality:
   v1.0 injects via `/hooks/run` secrets and calls Modal directly; proxy
   deferred to Phase 5. Keystore 0600 + never synced is the current
   mitigation; rotation procedure must be documented before public use.

Acceptance: fresh user → visit → computer running → create bot in sidebar
→ terminate computer → provision again → team + history restored from S3.
`Bot` model untouched by ONE frontend (verify: no `models.Bot` import in
`frontend/`).

## Phase 2 — inner sandbox service

Goal: a sub-agent can spawn a disposable Near-AI sandbox per sensitive
task; files go in sealed, `{ result, evidence }` comes out, the VM dies.

**Starting state (surveyed): no `spawn_inner_sandbox` anywhere in code —
not even the 501 stub PHASE1 §4.4 specified.** `packages/sandbox` is
single-turn by design (`bot.ts`: "Single-turn only — No tool-execution
loop"). So Phase 2 builds three things, in order: the stub contract, the
inner loop, then the service routes.

1. **`/sandboxes` control-plane routes** (new; `/conversations/*` keeps
   serving during transition): `POST /sandboxes` (spawn: image + policy +
   sealed file envelope), `POST /sandboxes/:id/message` (relay, same proxy
   shape), `POST /sandboxes/:id/terminate` (final checkpoint + receipt +
   kill). Implementation reuses the conversation provision/relay/terminate
   code path — the difference is policy, not plumbing. The spawn path
   **must write `SandboxSession.parentComputerId + policy`** (schema +
   index exist, never written — Reality check).
2. **Escalation stub first.** `spawn_inner_sandbox({ goal, fileRefs,
   policy })` lands in the outer image returning honest 501 with the fixed
   contract, so the tool surface exists before behavior does. (PHASE1 §4.4
   specified this; it was never built — build it here.)
3. **Orchestration pattern (locked): agents-as-tools, NOT sub-agents.**
   Per the OpenAI agents orchestration guide: the outer bot is the manager
   and stays responsible for the final answer; `spawn_inner_sandbox` is a
   bounded tool call, not a handoff — control never transfers to the inner
   sandbox (it owns no conversation, has no escalation tool, cap at 2).
   Policy isolation is the reason the inner run is a separate agent at
   all; everywhere else, prefer direct tools over sub-agent fan-out
   (latency: a spawned agent round-trip costs seconds per hop with no
   isolation benefit inside a single trust domain). Concretely: no `task`
   fan-out on the escalation path, no sub-agents inside the inner
   sandbox — single agent + tool loop only. **Decided 2026-11-12: strip the
   outer `task` fan-out entirely (tools-only everywhere).** The inherited
   depth-4 fan-out goes; parallel work becomes sequential tool calls.
   Rationale: latency + trace legibility; nothing on the outer path needs
   capability isolation that tools don't already give.)
4. **Inner agent-loop (the "delegate until finished" requirement).**
   `packages/   sandbox` gains a bounded loop: prompt → tools → repeat until
   done/failed/budget. Bounds: max N tool steps, read-mostly tool
   allowlist, per-iteration response-signature verification against the
   session preflight, kill + partial-evidence receipt on budget exceed.
   Single agent with tools — no sub-agent fan-out inside (see orchestration
   pattern above). **Network (decided 2026-11-12): NEAR API only.**
   Inner egress allowlisted to NEAR AI endpoints; `exec` stays for local
   compute, `web`/grounded tools are unavailable inside. Sensitive bytes
   never share a VM with open internet. Without this loop, escalation
   returns one-shot answers, not finished tasks.
2. **Near-AI-only policy, fail closed.** Inner image = today's sandbox
   image (bot runner + `/ai` + preflight + sealed checkpoints) with the
   provider allowlist pinned to `near-ai`. Anything else → 501. Attestation
   preflight at session establishment stays mandatory (the 06 policy);
   `verified_inference` is the ONLY level an inner sandbox boots at.
3. **Structural separation (the core guarantee).** Sensitive files are
   pushed sealed directly to the inner sandbox and never land on the outer
   computer's disk, never transit the outer agent's context. The outer
   passes a task descriptor (goal + pointers, no bytes); the inner returns
   result + evidence. Document the byte-flow with a diagram in the repo —
   this is the claim auditors will check.
4. **Kill-per-task lifecycle.** Terminate runs: final sealed checkpoint →
   receipt → microVM destroy. No reuse, no warm pool in P2 (a pool is a
   Phase-5 optimization with its own threat note). `SandboxSession`-style
   rows record wall-clock for metering.
5. **Evidence return contract.** Every inner run returns
   `{ result, evidence }` where `evidence = { preflight summary,
   per-message verification, checkpoint manifest, receipt }` — the exact
   fields the receipt + widget reports are built from (PLAN-P1 §2.1). The
   outer stores the evidence; the receipt binds
   `{ outerComputerId, innerSandboxId, taskDescriptorHash }` (nesting
   proof).

Acceptance: outer stub → spawn inner → push sealed file → Near-AI reply
with preflight green → terminate → VM gone (verify at provider) → receipt
validates via `verify` with the nesting binding intact; outer disk contains
zero bytes of the sensitive file (grep the image after the run).

## Phase 3 — outer agent loop + escalation

Goal: the everyday team agent (Meta via Modal) does real work and
escalates structurally when data is sensitive.

Starting state (surveyed): the outer loop already runs (@openai/agents
+ `task` fan-out depth 4 + `message_bot` delegation), approvals/questions
infrastructure exists (`runner.ts:118-251`, 120s timeout), `team/config.json`
carries `escalation: 'manual'` default — but **nothing consumes it**, and
there is no briefing artifact. So Phase 3 is: wire the tool, enforce the
policy, bind the briefing.

1. **Outer agent loop on the computer.** ~~Bot runner extended (or a sibling
   runner):~~ The loop exists — extend it: transcript → Modal/Meta call ~~
   via the Phase-1 proxy~~ (direct, per as-built decision) → tools →
   append. Tools available outer: team file ops, `spawn_inner_sandbox`
   (escalation), computer-local exec. Tools NOT available outer: raw
   workspace reads of sealed inputs (they don't exist there by
   construction, Phase 2.3).
2. **Escalation tool.** `spawn_inner_sandbox({ goal, fileRefs, policy })`
   — a **blocking tool call with progress events** (manager waits; progress
   streams over the existing run-events channel; timeout kills the inner
   run and returns partial evidence — never fire-and-forget, never a
   handoff). The outer names files by sealed reference; the control plane
   moves bytes computer→inner without outer ever decrypting. Every call
   emits an audit entry `{ when, who, goal-hash, sandboxId, policy }`.
   Nesting caps at 2: an inner sandbox has no escalation tool — the call
   fails closed.
3. **Escalation policy (per team, `team/config.json`).** Modes:
   `manual` (user picks per task — reuse the inherited approvals UI for
   the confirm-before-spawn dialog, don't build new UI), `auto-logged`
   (agent classifies, every escalation logged as evidence). `auto-silent`
   does not exist. Default: `manual`. (Schema + GET/PUT exist; enforcement
   is the Phase-3 work.)
4. **Bot briefing artifact (the "train until it knows" flow).** New
   `team/briefs/<bot-id>.md`, versioned + S3-synced like team files,
   injected as system context alongside role/description/history. The
   escalation's `taskDescriptorHash` binds to the briefing version, so
   "what the bot knew when it spawned the run" is auditable. Editable in
   the sidebar (BotPanel), no new top-level UI.
4. **Metering + quotas.** Modal usage reported with the computer's
   `usageToken` (server-to-server, same as today); per-user quotas,
   concurrency limits, rate limiting land here, reconciled against the
   Modal bill — the "unified billing" row of the value-split.

Acceptance: chat with a team bot on Meta → ask about a sensitive file →
agent escalates (manual confirm or auto-logged per policy) → inner
Near-AI run → result streams back with evidence badge → audit log shows
the escalation. Outer transcript contains no sensitive bytes.

## Phase 4 — Sandboxes UI + nested trust

Goal: the Trust Center panel becomes **Sandboxes**, and nested evidence
renders inline.

(UI-label rename already done ahead of this phase — see Locked inputs.
This phase builds the panel itself.)

1. **Sandboxes panel.** Live view: outer computer (status, image, usage
   this session) + running inner sandboxes (task, policy, elapsed, kill)
   + closed runs (receipt, evidence class per layer). Replaces the current
   six-section Trust Center; conversation history renders from sealed
   checkpoints as today.
2. **Nested receipts.** Receipt v0 gains
   `{ outer: { computerId, imageDigest }, inner: { sandboxId, …06 fields },
   binding: { taskDescriptorHash } }`. `verify` (CLI + panel) checks both
   layers + the binding. Unsigned v0 shape first (format fixed, signer
   upgrades per PLAN-P1 §2.2).
3. **Rename pass — DONE EARLY, verify here.** UI labels: conversation →
   sandbox, Trust Center → Sandboxes, "new conversation" → "new sandbox".
   API/DB names unchanged (deferred, Phase 5). This phase verifies no
   `conversation`/`TrustCenter` label survives in user-visible strings.
4. **Evidence export.** Per-run bundle = inner receipt + transcript chain
   + widget reports + escalation audit entry. DPA-ready export stays one
   click. Panel also surfaces `teamManifestSha`/`lastTeamSyncAt` (writes
   land here — schema-only until now).
4. **Evidence export.** Per-run bundle = inner receipt + transcript chain
   + widget reports + escalation audit entry. DPA-ready export stays one
   click.

Acceptance: run the Phase-3 flow → Sandboxes panel shows outer + inner
with per-layer evidence labels (`observed` vs `hardware-attested`, never
mixed) → export bundle → offline `verify` green.

## Phase 5 — hardening, rename, E2E

Goal: production posture + the deferred renames + full gate.

0. **Modal proxy (deferred from Phase 1).** Build `POST /computer/infer`
   (usageToken auth, quota, SSE passthrough, metering) and flip the outer
   image to it; master keys stop reaching VM memory. Document rotation
   before public use either way.

1. **API/DB rename** (deferred from the start): `/conversations/*` →
   `/sandboxes/*`, `Conversation` model → `SandboxRun` (or keep rows,
   add view — decide here; migration must preserve existing receipts).
   Frontend `lib/wayfind.ts` follows.
2. **Policies that fail closed:** per-team mandatory levels, egress
   allowlists, attestation-required toggle (PLAN-P1 §2.2) — now enforced
   at escalation time, not just boot time.
3. **Image + execution trust:** signing/SBOM/reproducible builds for BOTH
   images (outer agent image + inner sandbox image); panel shows both
   digests + signatures.
4. **Quotas → plans, cost attribution** per run (Modal inference +
   execution), invoice-ready exports.
5. **E2E gate.** Login → computer boots → team persists across terminate
   → Meta chat → sensitive escalation → inner kill → nested receipt →
   `verify` (panel + CLI) → export bundle → `pull` restores files. Clean
   machine, evidence green, outer disk grep-clean.

## Explicit non-goals (carried + new)

PIVOT §7 + PLAN-P1 outs still hold (BYOK, SSO/SAML, S3 in data path,
suspend/resume of INNER sandboxes, browser-E2EE chat). New: warm inner
pools, `auto-silent` escalation, outer attestation claims (the outer
computer is never "verified" — it is `observed` infrastructure), more
than 2 nesting levels. The Modal proxy is NOT a non-goal — it is deferred
Phase-5 work with the injection threat model stated until then.

## PIVOT updates required (do with Phase 2 kickoff — slipped from Phase 1)

Locked decisions §4.3 (single NEAR-curated model), §4.4 (VM-backed-only
tasks), §4.10 (one conversation = one VM) get rewritten by this plan —
draft the PIVOT edits now, don't leave the docs contradicting the build.
Add to the Phase-2 acceptance list so it actually happens. The honesty
rule (§4.8) gains the layer axis: every claim labeled `observed` /
`signed` / `hardware-attested` **and** `outer` / `inner`.
