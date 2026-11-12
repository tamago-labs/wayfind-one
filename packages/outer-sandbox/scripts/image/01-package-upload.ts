// Step 1: build the agent server, stage a clean production bundle, zip, upload to S3.
// Run: npx tsx packages/computer/scripts/image/01-package-upload.ts
//
// Bundle = Dockerfile + dist/ + production node_modules + package.json +
// workspace seed (providers catalog only — NEVER keys). node_modules is
// installed fresh with --omit=dev so the image stays lean and the builder
// needs no registry access at build time.
import { execSync } from 'child_process';
import { ZipArchive } from 'archiver';
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
  // 1. Compile the agent server (single source of truth: packages/computer/src).
  sh('npm run build --workspace=wayfind-computer', '.');

  // 2. Fresh production-only install into the stage dir.
  rmSync(STAGE, { recursive: true, force: true });
  mkdirSync(`${STAGE}/workspace`, { recursive: true });
  copyFileSync('packages/computer/package.json', `${STAGE}/package.json`);
  copyFileSync('packages/computer/package-lock.json', `${STAGE}/package-lock.json`);
  sh(`npm ci --omit=dev --prefix ${STAGE} --no-audit --no-fund`, '.');
  cpSync('packages/computer/dist', `${STAGE}/dist`, { recursive: true });
  // Catalog only — keystore/.env are NEVER staged (injected at /run, Phase 2).
  copyFileSync('packages/computer/workspace/providers.json', `${STAGE}/workspace/providers.json`);

  // 3. Zip: Dockerfile at root + staged bundle.
  const zipPath = `${DIR}/computer.zip`;
  const files: Array<[string, string]> = [
    [`${DIR}/Dockerfile`, 'Dockerfile'],
    [`${STAGE}/package.json`, 'package.json'],
  ];
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    out.on('close', () => resolve());
    archive.on('error', (err) => reject(err));
    archive.pipe(out);
    for (const [src, name] of files) archive.file(src, { name });
    archive.directory(`${STAGE}/dist/`, 'dist');
    archive.directory(`${STAGE}/node_modules/`, 'node_modules');
    archive.directory(`${STAGE}/workspace/`, 'workspace');
    void archive.finalize();
  });
  const size = statSync(zipPath).size;
  console.log(`Staged bundle: ${(size / 1024 / 1024).toFixed(1)} MB → ${zipPath}`);

  // 4. Upload (streamed — bundle is tens of MB).
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
