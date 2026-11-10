// Step 1: build the exec agent, stage a clean bundle, zip, upload to S3.
// Run from the package dir:
//   cd packages/sandbox
//   npx tsx scripts/image/01-package-upload.ts
//
// Bundle = Dockerfile + dist/ + production node_modules + package.json. The image carries code only — NEVER
// keys (the session bearer is injected per-VM at /run).
import { execSync } from 'child_process';
import archiver from 'archiver';
import { copyFileSync, cpSync, createWriteStream, mkdirSync, rmSync, statSync } from 'fs';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { createReadStream } from 'fs';
import { BUCKET, DIR, ZIP_KEY, s3, saveState } from './config';

const STAGE = `${DIR}/stage`;

function sh(cmd: string, cwd: string): void {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
}

async function main(): Promise<void> {
  // 1. Compile the exec agent (single source of truth: src/).
  sh('npx tsc -p tsconfig.json', '.');

  // 2. Fresh production-only install into the stage dir (exec agent has
  // real runtime deps now: @modelcontextprotocol/sdk + zod). Installed
  // fresh with --omit=dev so the builder needs no registry access.
  rmSync(STAGE, { recursive: true, force: true });
  mkdirSync(STAGE, { recursive: true });
  copyFileSync('package.json', `${STAGE}/package.json`);
  copyFileSync('package-lock.json', `${STAGE}/package-lock.json`);
  sh(`npm ci --omit=dev --prefix ${STAGE} --no-audit --no-fund`, '.');
  rmSync(`${STAGE}/package-lock.json`, { force: true });
  cpSync('dist', `${STAGE}/dist`, { recursive: true });

  // 3. Zip: Dockerfile at root + staged bundle.
  const zipPath = `${DIR}/exec.zip`;
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    out.on('close', () => resolve());
    archive.on('error', (err) => reject(err));
    archive.pipe(out);
    archive.file(`${DIR}/Dockerfile`, { name: 'Dockerfile' });
    archive.file(`${STAGE}/package.json`, { name: 'package.json' });
    archive.directory(`${STAGE}/dist/`, 'dist');
    archive.directory(`${STAGE}/node_modules/`, 'node_modules');
    void archive.finalize();
  });
  const size = statSync(zipPath).size;
  console.log(`Staged bundle: ${(size / 1024).toFixed(0)} KB — ${zipPath}`);

  // 4. Upload (streamed).
  await s3.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: ZIP_KEY, Body: createReadStream(zipPath) }),
  );
  saveState({ zipKey: `s3://${BUCKET}/${ZIP_KEY}` });
  console.log(`Uploaded s3://${BUCKET}/${ZIP_KEY}`);
}

main().catch((err) => {
  console.error('Package-upload failed:', err);
  process.exit(1);
});
