# computer-image — golden image pipeline (Phase 1)

Builds the real agent computer (`packages/computer/`) into a Lambda MicroVM image.
`scripts/computer-tests/` (E2E test scripts) is unrelated — different folder on purpose.

## Flow

```bash
cp packages/computer/scripts/image/.env.example packages/computer/scripts/image/.env  # fill in
npx tsx packages/computer/scripts/image/01-package-upload.ts   # build dist + stage + zip + S3
npx tsx packages/computer/scripts/image/02-create-image.ts      # build image, poll to CREATED
# manual boot (Phase 3):
$env:MODAL_API_KEY='...'; $env:PROVIDER_API_KEY='...'  # this shell only, never committed
npx tsx packages/computer/scripts/image/03-run-computer.ts      # run VM + /run identity + cloud chat test
```

## What's in the image

- `dist/` (compiled agent server), production-only `node_modules`, `package.json`
- `workspace/` seed: `providers.json` catalog only
- `Dockerfile`: `node:24-alpine`, port 8080, `WORKSPACE_DIR=/srv/computer/workspace`

## Secrets rule

**The image carries zero keys.** No `.env`, no `keystore`, no baked secrets.
`MODAL_API_KEY` / `PROVIDER_API_KEY` are injected per-VM at `/run` (Phase 2 hooks),
sourced from Amplify secrets. If you can read a key out of the zip or the image,
the pipeline is broken — fix it before Phase 3.

## State (gitignored)

- `stage/` — local bundle staging (rebuilt every run)
- `computer.zip` — packaged bundle
- `.computer-image-state.json` — `{ imageArn, imageVersion, zipKey }`

## Next

Phase 2: server `/ready` + `/run` (identity/keystore) + `/suspend` (S3 sync) hooks.
Phase 3: manual `03-run-computer.ts` provision + first cloud boot verification.
Record the image ARN/version in `docs/DEV-HANDOFF.md §8` when CREATED.
