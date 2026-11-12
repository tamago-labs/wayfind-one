# Wayfind Computer

The agent runtime behind Wayfind Cloud. A model-agnostic turn loop with tools, served over HTTP + SSE. In production it runs inside one Firecracker MicroVM per account (one computer per account, shared by all Bots); the Next.js app reaches it through `wayfind-api /computer/proxy/*`. Locally it runs as a plain Node.js server on `:8080`.

This is an **independent package** in the monorepo (`packages/computer/`): own `package.json`, own lockfile, own `node_modules`. Install and run everything from this directory — the repo root knows nothing about it.

## Layout

| Path | What it is |
|---|---|
| `src/server.ts` | HTTP/SSE entry point (agent runtime) |
| `src/cli.ts` | `wayfind` CLI: `chat`, `run`, `status`, `skill list\|run\|save`, `backup now\|list`, `models`, `keys` |
| `src/agent/` | Turn loop, subagents (`task` fan-out), skill loader, MCP client, 12 tools (`shell/read/write/list`, `edit`, `glob`/`grep`, `skill`, `task`, `question`, `webfetch`/`websearch`, `grounded`, `image`, `message_bot`, `create_bot`, `clock`, `schedule`) |
| `src/core/` | `config` (env), `guard` (doom-loop detection), `permissions` (enforcing by default) |
| `src/providers/` | OpenAI-compatible provider catalog (`providers.json`: baseURL, models, $/1M) + keystore with rotation |
| `src/runs/` + `src/usage/` | Run lifecycle, transcript compaction, usage metering with spend math |
| `src/cloud/sync.ts` | S3 workspace sync (presigned URLs, suspend/resume) |
| `src/voice/` | Speech-to-text endpoint |
| `workspace/` | Seed only: `providers.json` catalog, `mcp.json`, `permissions.json`. Runtime state (`.wayfind/`, conversations, skills) is gitignored |
| `scripts/image/` | Golden-image pipeline: builds `dist/`, stages a production bundle, zips to S3, creates the MicroVM image. See `scripts/image/README.md` |

## Run locally

```powershell
npm install          # isolated to this package
Copy-Item .env.example .env   # fill PROVIDER_API_KEY
npx tsx src/server.ts         # agent on :8080
npx tsx src/cli.ts status     # check it
npx tsx src/cli.ts run "list the workspace files"
```

| Env | Default | Meaning |
|---|---|---|
| `PROVIDER_BASE_URL` | `https://api.meta.ai/v1` | OpenAI-compatible base URL, no path suffix |
| `PROVIDER_MODEL` | `muse-spark-1.3` | Default model |
| `PROVIDER_API_KEY` | — | Required locally; in cloud injected per-VM via `/hooks/run` |
| `PORT` | `8080` | Server port |
| `WORKSPACE_DIR` | `./workspace` | Skills, MCP config, conversations (`/workspace` in the VM) |
| `PERMISSION_MODE` | `enforcing` | `enforcing` parks writes/asks for approval; `permissive` auto-allows + logs |

## Talk to it

```powershell
$run = Invoke-RestMethod -Method Post -Uri http://localhost:8080/task `
  -ContentType 'application/json' -Body '{"text":"list the workspace files"}'
curl.exe -N "http://localhost:8080/stream/$($run.runId)"   # SSE event stream
# Buffered alternative (what the cloud relay uses):
#   GET /runs/:id/events?cursor=n -> { events, nextCursor, done }
```

| Endpoint | Purpose |
|---|---|
| `GET /ready`, `GET /status` | Liveness + model/search/key readiness |
| `POST /task` → `GET /stream/:runId` | Start a run, follow its SSE events until `done`/`error` |
| `GET /approvals` → `POST /approvals/:id {approve\|reject\|approve-all}` | Human-in-the-loop: parked runs resume SDK-natively |
| `GET /questions` → `POST /questions/:id {answers}` | Model asks the user, run continues with the answer |
| `GET /bot-requests` → `POST /bot-requests/:id` | Bot-creation confirm/cancel |
| `GET /skills`, `/skills/resolve`, `/skills/install`, `/skills/scan` | Skill catalog + install |
| `GET/POST /mcp`, `GET/PUT /permissions`, `GET /providers` | MCP servers, permission policy, provider catalog |
| `GET /history/:conversationId`, `POST /summarize-role` | Transcript lookup, cheap role-label call |
| `GET /files`, `/files/view`, `/files/download`, `POST /files/upload`, `POST /voice/transcribe` | Workspace files + transcription |
| `POST /hooks/run\|suspend\|resume\|terminate` | Cloud lifecycle: inject keys + pull workspace, sync to S3, shut down |

## Test

Black-box suite in `scripts/computer-tests/` (repo root): needs this server running with a real key. Run order and what each step proves are in `scripts/computer-tests/README.md`:

```powershell
cd packages/computer; npx tsx src/server.ts   # :8080, needs PROVIDER_API_KEY
npx tsx scripts/computer-tests/01-health.ts   # from the repo root
```

## Ship

`scripts/image/` packages `dist/` + production `node_modules` + seed workspace into a Lambda MicroVM image (`npm ci --omit=dev`, reproducible from the lockfile). **The image carries zero keys** — no `.env`, no keystore. Keys arrive per-VM at boot via `/hooks/run` (Amplify secrets), and `.wayfind/` never leaves the VM.
