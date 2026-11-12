# PLAN-P2.md — nested sandboxes for Wayfind ONE

Status: active. PIVOT.md is the vision; PLAN-P1.md built the per-conversation
MicroVM + Trust Center shell. This plan re-architects onto **nested
sandboxes**: one persistent shared computer per user (outer sandbox, AI team
as files, Meta open-weight inference via Modal) + disposable per-task inner
sandboxes (Near-AI only, attested, killed after each task).
Detail: PLAN-P2-PHASE1.md (Phase 1 build plan — outer computer + team chat).

Locked inputs (2026-11-12):
- Outer inference = Meta open-weight models via Modal; `MODAL_API_KEY` +
  `PROVIDER_API_KEY` Wayfind-held in Amplify secrets, injected at provision.
- Routing is **structural**: sensitive files physically exist only inside
  inner sandboxes; the outer layer sees task text + returned results only.
- Team state (bots JSON, history, config) survives terminate via S3 sync —
  same mechanism as cloud's computer sync.
- Inner sandbox = fresh MicroVM per sensitive task, then kill.
- Rename starts at UI labels (conversation → sandbox, Trust Center →
  Sandboxes); API routes + DB models keep names until Phase 5.

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

## Phase 1 — outer computer for ONE

Goal: visiting the app boots (or resumes) exactly one shared computer that
understands the new flow. Sidebar team list comes from files, not the DB.

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
6. **Modal key posture (decision, locked here): proxy, don't inject.**
   The VM must NOT hold the master `MODAL_API_KEY`. Outer inference calls
   go VM → control-plane proxy → Modal (same shape as the NEAR billing
   proxy in the PIVOT value-split: per-user quotas, metering, no key
   exposure). If proxying costs a round-trip too many, the alternative is
   short-lived scoped tokens minted per computer — never the master key,
   and the threat model must say so.

Acceptance: fresh user → visit → computer running → create bot in sidebar
→ terminate computer → provision again → team + history restored from S3.
`Bot` model untouched by ONE frontend (verify: no `models.Bot` import in
`frontend/`).

## Phase 2 — inner sandbox service

Goal: a sub-agent can spawn a disposable Near-AI sandbox per sensitive
task; files go in sealed, `{ result, evidence }` comes out, the VM dies.

1. **`/sandboxes` control-plane routes** (new; `/conversations/*` keeps
   serving during transition): `POST /sandboxes` (spawn: image + policy +
   sealed file envelope), `POST /sandboxes/:id/message` (relay, same proxy
   shape), `POST /sandboxes/:id/terminate` (final checkpoint + receipt +
   kill). Implementation reuses the conversation provision/relay/terminate
   code path — the difference is policy, not plumbing.
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

1. **Outer agent loop on the computer.** Bot runner extended (or a sibling
   runner): transcript → Modal/Meta call via the Phase-1 proxy → tools →
   append. Tools available outer: team file ops, `spawn_inner_sandbox`
   (escalation), computer-local exec. Tools NOT available outer: raw
   workspace reads of sealed inputs (they don't exist there by
   construction, Phase 2.3).
2. **Escalation tool.** `spawn_inner_sandbox({ goal, fileRefs, policy })`
   — the outer names files by sealed reference; the control plane moves
   bytes computer→inner without outer ever decrypting. Every call emits an
   audit entry `{ when, who, goal-hash, sandboxId, policy }`. Nesting caps
   at 2: an inner sandbox has no escalation tool — the call fails closed.
3. **Escalation policy (per team, `team/config.json`).** Modes:
   `manual` (user picks per task), `auto-logged` (agent classifies,
   every escalation logged as evidence). `auto-silent` does not exist.
   Default: `manual`.
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
3. **Rename pass.** UI labels: conversation → sandbox, Trust Center →
   Sandboxes, "new conversation" → "new sandbox". API/DB names unchanged
   (deferred, Phase 5).
4. **Evidence export.** Per-run bundle = inner receipt + transcript chain
   + widget reports + escalation audit entry. DPA-ready export stays one
   click.

Acceptance: run the Phase-3 flow → Sandboxes panel shows outer + inner
with per-layer evidence labels (`observed` vs `hardware-attested`, never
mixed) → export bundle → offline `verify` green.

## Phase 5 — hardening, rename, E2E

Goal: production posture + the deferred renames + full gate.

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
than 2 nesting levels.

## PIVOT updates required (do with Phase 1)

Locked decisions §4.3 (single NEAR-curated model), §4.4 (VM-backed-only
tasks), §4.10 (one conversation = one VM) get rewritten by this plan —
draft the PIVOT edits in Phase 1, don't leave the docs contradicting the
build. The honesty rule (§4.8) gains the layer axis: every claim labeled
`observed` / `signed` / `hardware-attested` **and** `outer` / `inner`.
