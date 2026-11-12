# Wayfind Outer Sandbox

The team agent server behind Wayfind ONE. Runs inside the per-user outer
computer (Firecracker MicroVM, one per account alongside the classic cloud
computer); the ONE frontend reaches it through `wayfind-api
/computer/proxy/*?kind=one_outer`. Locally it runs as a plain Node.js
server on `:8080`.

Forked from wayfind-cloud `packages/computer` — the two images deploy
independently and drift deliberately. What changed from the ancestor:

- **Bots are files** (`src/team/`): `team/bots/*.json` (v1, mirrors the
  old Bot row fields), `team/history/*.jsonl` (append-only hash-chained),
  `team/config.json`, `team/manifest.json`. No Amplify Data in this
  image — `create_bot` confirms write the file server-side.
- **Modal-only inference**: `resolveModel` fails closed unless provider
  is `modal` and the model is in the catalog entry.
- **Team endpoints**: `GET/POST /team/bots`, `GET /team/history/:botId`,
  `GET/PUT /team/config`, `POST /team/chat` (chat-only: empty
  skill/MCP allowlists). `/task` defaults to the on-disk roster.
- **Kind gate**: `/hooks/run` refuses any `kind !== one_outer`.
- **History dual-write**: top-level team runs append user+assistant turns
  to the bot's hash-chained jsonl on completion.
- **Pipeline**: `scripts/outer-image/` publishes `microvm-image:wayfind-outer`
  (`ONE_OUTER_IMAGE_ARN`). The inherited `scripts/image/` was removed.

## Layout

| Path | What it is |
|---|---|
| `src/server.ts` | HTTP/SSE entry point (agent runtime) |
| `src/team/store.ts` | Team files: schema, history chain, manifest |
| `src/agent/` | Turn loop, subagents, skill loader, MCP client, tools (incl. `create_bot`, `message_bot`; `spawn_inner_sandbox` stub lands in Phase 2) |
| `src/core/` | `config` (env), `guard`, `permissions` (enforcing by default) |
| `src/providers/` | Modal provider catalog + keystore with rotation |
| `src/runs/` + `src/usage/` | Run lifecycle, transcript, usage metering |
| `src/cloud/sync.ts` | S3 workspace sync (presigned URLs, suspend/resume) |
| `workspace/` | Seed only: `providers.json` catalog, `mcp.json`, `permissions.json` |
| `scripts/outer-image/` | Golden-image pipeline (package → create → run → terminate) |

## Run locally

```powershell
npm install
Copy-Item .env.example .env   # fill PROVIDER_API_KEY + MODAL_API_KEY
npx tsx src/server.ts         # agent on :8080
```

| Endpoint | Purpose |
|---|---|
| `GET /ready`, `GET /status` | Liveness + model/search/key readiness |
| `POST /team/bots`, `GET /team/bots` | File-backed team roster |
| `POST /team/chat` → `GET /runs/:id/events?cursor=n` | Chat as a bot, poll to done |
| `GET /team/history/:botId` | Hash-chained thread + verified flag |
| `POST /hooks/run\|suspend\|resume\|terminate` | Cloud lifecycle: kind gate, keys + team restore, sync to S3, shut down |

## Ship

`scripts/outer-image/` builds `dist/` + production `node_modules` + seed workspace into a Lambda MicroVM image. **The image carries zero keys** — no `.env`, no keystore. Keys arrive per-VM at boot via `/hooks/run` (Amplify secrets), and `.wayfind/` never leaves the VM.
