# exec-image — golden image pipeline (P1 workstream 1)

Builds the minimal exec sandbox (`packages/sandbox/`) into a Lambda MicroVM
image. Same mechanics as wayfind-cloud's computer pipeline
(`packages/computer/scripts/image` over there), separate image name —
the two pipelines never touch each other.

## Flow

```bash
cd packages/sandbox
cp scripts/image/.env.example scripts/image/.env  # fill in
npx tsx scripts/image/01-package-upload.ts   # build dist + zip + S3
npx tsx scripts/image/02-create-image.ts     # build image, poll to CREATED
```

`.env` needs the wayfind-cloud AWS values (`MICROVM_BUCKET`,
`MICROVM_BUILD_ROLE_ARN`, `MICROVM_BASE_IMAGE_ARN`, `AWS_REGION`) —
see `wayfind-cloud/packages/computer/scripts/image/.env.example`.

## What's in the image

- `dist/` (compiled exec agent), production-only `node_modules`
  (`@modelcontextprotocol/sdk` + `zod`), `package.json` — no workspace
  seed (pushed per session).
- `Dockerfile`: `node:24-alpine`, port 8080, `WORKSPACE_DIR=/srv/exec/workspace`.

## Design deltas vs the computer image

- **Suspend/resume hooks DISABLED** — exec sessions are disposable, never
  resumed. Short idle TTL + terminate at provision time instead.
- **No keys, ever.** The session bearer is injected per-VM at `/run`;
  the workspace arrives per session via `POST /sync/in`. Nothing persists
  unless the CLI pulls it back via `/sync/out` + `/read`.
- Tiny bundle (KB, not tens of MB) — boots and snapshots fast.

## State (gitignored)

`.exec-image-state.json` — image ARN/version, zip key, last manual VM.
Next after image: `POST /sandbox/provision` in `wayfind-api`, then CLI `run`.
