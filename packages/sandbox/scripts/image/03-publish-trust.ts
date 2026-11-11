// Step 3: publish the signed image-trust record for the just-built image.
// Run from the package dir AFTER 02-create-image.ts succeeds:
//   cd packages/sandbox
//   npx tsx scripts/image/03-publish-trust.ts
// Reads .exec-image-state.json (imageArn/version + zip/sbom hashes from 01),
// signs the manifest server-side via POST /image-trust/publish (bearer =
// IMAGE_TRUST_SECRET from scripts/image/.env). The published record is
// readable by any signed-in user; `wayfind image-trust` verifies it offline.
import { loadState, need } from './config';

import { homedir } from 'os';
import { join } from 'path';
import { readFileSync } from 'fs';

async function main(): Promise<void> {
  const secret = need('IMAGE_TRUST_SECRET');
  // Publisher identity: the CLI login (same account that owns the backend).
  const credsPath = join(homedir(), '.wayfind', 'credentials.json');
  let bearer = '';
  try {
    bearer = (JSON.parse(readFileSync(credsPath, 'utf8')) as { token?: string }).token ?? '';
  } catch {
    throw new Error(`not logged in — run the wayfind CLI login first (looked for ${credsPath})`);
  }
  const api = (process.env.WAYFIND_API_URL ?? 'https://td4dfiwfkmwp32gyqfzxb7axly0kbrwg.lambda-url.ap-southeast-1.on.aws').replace(/\/+$/, '');
  const st = loadState();
  if (!st.imageArn || !st.zipSha256) {
    throw new Error('state is missing imageArn/zipSha256 — run 01-package-upload.ts then 02-create-image.ts first');
  }
  const res = await fetch(`${api}/image-trust/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({
      imageArn: st.imageArn,
      imageVersion: st.imageVersion ?? '1.0',
      zipSha256: st.zipSha256,
      sbomSha256: (st as { sbomSha256?: string }).sbomSha256,
      builtAt: new Date().toISOString(),
      bearer: secret,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`publish failed (${res.status}): ${data?.error ?? JSON.stringify(data).slice(0, 200)}`);
  console.log(`Image trust published: ${data.manifest?.imageArn} kid=${data.signature?.kid}`);
  console.log('Verify: npx tsx scripts/image/03-publish-trust.ts --verify (or: wayfind image-trust)');
}

main().catch((err) => {
  console.error('Publish-trust failed:', err);
  process.exit(1);
});
