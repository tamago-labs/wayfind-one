# PLAN-P2 outer image — `packages/outer-agent`

## Build status 2026-11-12: SHIPPED as `packages/outer-sandbox` (note the
name — the package is `outer-sandbox`, not `outer-agent`)

Surveyed: the fork exists with the @openai/agents loop, team store
(`team/bots|history|config|manifest.json`, one-chief enforcement),
sync with `.wayfind/` skipped both directions, `providers.json` pinned to
`meta-models/Muse-Spark-Open-816B-A42B`, full server surface (team, chat,
approvals/questions, voice, skills, MCP, permissions, usage), and the
`scripts/outer-image/` pipeline through terminate (image v1.0 `wayfind-outer`
published). Deltas 1 (injection kept — matches as-built), 2, 4, 6 are done.
Delta 3 (escalation stub): NOT built, moved to P2-Phase 2. Delta 5 (strip
audit): UNVERIFIED — go tool-by-tool before public use. Delta 7 tests:
`outer-tests/` suite not found — verify or build. Steps below kept as the
build record.

Ancestor: wayfind-cloud `packages/computer` (agent loop + HTTP/SSE server,
one computer per account, zero-keys image, `/hooks/*` lifecycle, golden
image pipeline, black-box tests). The disposable `packages/sandbox` is the
INNER image ancestor — not used here. Fork, don't share: copy the tree
into wayfind-one `packages/outer-agent` (own package.json/lockfile, cloud
convention), service name `wayfind-outer`. No cross-repo dependency —
the two images deploy independently and drift deliberately.

## What we inherit unchanged

Turn loop (`@openai/agents`), `task` subagent fan-out, approvals +
questions (human-in-the-loop), permission modes, 10 of 14 tools
(shell/read/write/edit/glob/grep/web/grounded/image/clock/schedule),
`runs/` lifecycle + compaction, `usage/` metering, S3 presigned sync
(incremental manifest, `.wayfind/` never leaves the VM), `/hooks/suspend`
`/resume` `/terminate`, SSE streaming, MCP client, skills loader.

## Deltas (build order)

### 1. Provider transport → Modal (injection kept, proxy deferred)

The ancestor already calls Modal's open-weights endpoint directly
(`modal` provider + `Muse-Spark-Open-816B-A42B` pinned in seed
`providers.json`, `MODAL_API_KEY` injected via `/hooks/run` into the
keystore with rotation) — the same injection shape the provision flow
uses. Delta 1 keeps this and hardens it: `resolveModel` fails closed
unless provider is `modal` AND the model is in the catalog entry
(anything else throws; the image never calls an unpinned provider).
The control-plane infer proxy (baseURL swap, master key never in VM)
is deferred to Phase 5 hardening — it needs a backend route that
doesn't exist yet, and injection matches the current provision
contract.

### 2. Team files replace Bot-DB coupling

- On-disk layout (workspace root so sync picks it up — NEVER under
  `.wayfind/`, which the sync walk skips by design):
  `team/bots/<id>.json` (v1 schema, mirrors Bot rows),
  `team/history/<bot-id>.jsonl` (append-only hash-chained, same
  seq/prev/hash scheme as transcripts), `team/config.json`
  (defaultModel, escalation mode), `team/manifest.json` (path → sha256).
- `create_bot` / `message_bot` tools go file-backed (read/write JSON +
  schema-validate). No Amplify Data client in this image, ever.
- Old `conversations/` runtime dir → retired; per-bot jsonl is the
  history. `GET /history/:botId` serves it; VM-down history renders from
  the S3-restored files (same two-source rule, `observed` only).

### 3. Escalation stub (contract now, behavior Phase 2)

New tool `spawn_inner_sandbox({ goal, fileRefs, policy })` returning
hard `501 inner sandboxes arrive in Phase 2`. `task` fan-out otherwise
untouched — it becomes the escalation vehicle later. Approvals UI stays;
Phase 3 reuses it for manual-escalation confirm. No escalation affordance
wired to anything real.

### 4. Sync + seed

Sync code unchanged — `team/**` rides the existing workspace sync
(manifest in `.wayfind/`, 25MB/file, 2000 cap). Seed `workspace/` ships
a `team/` skeleton + `providers.json` with the Modal/proxy entry only.
Boot order in `/hooks/run` handler: inject (usageToken, apiUrl, workspace
prefix) → download `team/**` via presigned GETs → verify against
`team/manifest.json` → fail closed on corrupt config (empty team +
flagged, never half-restored) → start loop → report healthy + `kind`
check (`one_outer`, else refuse).

### 5. Strip audit (cloud-only surface)

Go tool by tool and mark keep/strip/disable: candidates for removal —
voice transcription, schedule, credit-ledger reporting, cloud Bot-DB
reads, `skill` installs that assume cloud workspace. Default: strip
anything that phones a cloud-only service; log the decision per tool in
this file's appendix when done. Nothing stripped silently.

### 6. Image pipeline (second image)

Duplicate `scripts/image/` → `scripts/outer-image/` with own
`config.ts` (new `ONE_OUTER_IMAGE_ARN` env — provision selects image by
`kind`; `COMPUTER_IMAGE_ARN` untouched), own state file, same Dockerfile
discipline (prod `node_modules`, seed workspace, **zero keys**). Publish
flow: package → upload → create-image → run-computer smoke → terminate.
Smoke test boots the image and asserts: `/health` ok, team endpoints
respond, no `MODAL_API_KEY`/`PROVIDER_API_KEY` in env dump or disk grep.

### 7. Black-box tests (`scripts/outer-tests/`)

Mirror `computer-tests/` style, needs server + proxy stub: health,
team CRUD round-trip, one chat turn (mocked infer proxy), sync
push→wipe→pull integrity vs manifest, `spawn_inner_sandbox` → honest
501, key-absence grep (fail on any master-key material), corrupt-config
boot → empty-team-flagged. Green suite is the image's ship gate.

## Backend deltas (cloud, next deploy batch — not this package)

- `provisionComputer`: select image ARN by `kind`
  (`ONE_OUTER_IMAGE_ARN` vs `COMPUTER_IMAGE_ARN`); stamp `kind`,
  `outerModel` on the row at provision.
- `/hooks/run` payload per kind (usageToken, apiUrl, workspace prefix;
  team fields for `one_outer`).
- Product-switch rule: provisioning `one_outer` while a `classic` VM is
  running suspends it first (and vice versa) — never two actives.
- `POST /computer/infer` proxy route (Phase-1 step 3): usageToken auth,
  quota, OpenAI-compatible SSE, metering.

## Acceptance

- [ ] Fresh boot from the new image: team CRUD + chat turn via proxy
  stub, streaming intact end to end.
- [ ] Suspend → terminate → fresh VM: team + history restored, manifest
  verifies, loop healthy.
- [ ] Env/disk grep: no master provider keys anywhere; only usageToken +
  apiUrl injected.
- [ ] Strip audit complete, every tool accounted keep/strip with reason.
- [ ] `outer-tests/` green; image published as `ONE_OUTER_IMAGE_ARN`.

## Non-goals

Inner sandbox spawn (Phase 2), tool-execution loop beyond single-turn
chat (Phase 3), multi-device merge UI, image signing (Phase 5), any
change to the classic computer image or its pipeline.
