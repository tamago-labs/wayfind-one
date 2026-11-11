/** @type {import('next').NextConfig} */
const nextConfig = {
  // Reference copy of wayfind-cloud's amplify_outputs.json (same backend,
  // two frontends). Re-copy after any backend deploy that changes outputs.
  transpilePackages: ['@aws-amplify/ui-react'],
};

export default nextConfig;
