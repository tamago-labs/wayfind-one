import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Reference copy of wayfind-cloud's amplify_outputs.json (same backend,
  // two frontends). Re-copy after any backend deploy that changes outputs.
  transpilePackages: ['@aws-amplify/ui-react'],
  // Repo root has its own lockfile (CLI workspace); silence the
  // multiple-lockfiles warning by pinning tracing to frontend/.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
