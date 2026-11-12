# outer-image — ONE outer golden image pipeline

Builds `packages/outer-sandbox/` into a Lambda MicroVM image. Forked from
the classic computer pipeline; state, names, and buckets keys are all
separate so the two images never collide.

## Flow

```powershell
# .env.local already holds AWS_REGION + MICROVM_BUCKET + build role + base image
npx tsx packages/outer-sandbox/scripts/outer-image/01-package-upload.ts   # build dist + stage + zip + S3
npx tsx packages/outer-sandbox/scripts/outer-image/02-create-image.ts     # build image, poll to CREATED
$env:MODAL_API_KEY='...'; $env:PROVIDER_API_KEY='...'  # this shell only, never committed
npx tsx packages/outer-sandbox/scripts/outer-image/03-run-outer.ts        # boot VM + /hooks/run (kind one_outer) + team chat test
npx tsx packages/outer-sandbox/scripts/outer-image/04-terminate-outer.ts # terminate the manual VM (stops charges)
```

`02` accepts `--replace` to delete a same-named image first.
`04` accepts `--delete-image` to also delete the golden image.

## What's in the image

- `dist/` (compiled outer server), production-only `node_modules`, `package.json`
- `workspace/` seed: `providers.json` catalog only (team/ is seeded at runtime by `/hooks/run`)
- `Dockerfile`: `node:24-alpine`, port 8080, `WORKSPACE_DIR=/srv/outer-sandbox/workspace`

## Secrets rule

**The image carries zero keys.** No `.env`, no keystore, no baked secrets.
`MODAL_API_KEY` / `PROVIDER_API_KEY` are injected per-VM at `/hooks/run`
from Amplify secrets (manual `03` uses your shell env). If you can read a
key out of the zip or the image, the pipeline is broken — fix it first.

## State (gitignored)

- `stage/` — local bundle staging (rebuilt every run)
- `outer-sandbox.zip` — packaged bundle
- `.outer-image-state.json` — `{ imageArn, imageVersion, zipKey, microvmId, endpoint }`

## After CREATED

Record the ARN as `ONE_OUTER_IMAGE_ARN` (backend env, provision-by-kind).
The kind gate is enforced both sides: image refuses `kind !== one_outer`,
provision must select this image for `one_outer` rows.
