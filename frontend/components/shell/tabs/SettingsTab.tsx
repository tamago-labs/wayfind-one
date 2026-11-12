'use client';

import { useEffect, useState } from 'react';
import { getPolicy, imageTrust, putPolicy, type Policy } from '@/lib/wayfind';
import { Err } from '../shared';

export default function SettingsSection() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [level, setLevel] = useState('none');
  const [models, setModels] = useState('');
  const [ttl, setTtl] = useState('1800');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [trust, setTrust] = useState<{ imageArn?: string | null; imageVersion?: string | null; zipSha256?: string | null; sbomSha256?: string | null; builtAt?: string | null; signature?: { kid?: string } | null } | null>(null);
  const [trustMissing, setTrustMissing] = useState(false);

  useEffect(() => {
    getPolicy().then((o) => {
      setPolicy(o.policy);
      setLevel(o.policy.mandatoryLevel);
      setModels((o.policy.allowedModels ?? []).join(', '));
      setTtl(String(o.policy.maxIdleTtlSeconds));
    }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    imageTrust().then((o) => setTrust(o.imageTrust)).catch(() => setTrustMissing(true));
  }, []);

  async function save() {
    setError(null);
    setSaved(false);
    try {
      const out = await putPolicy({
        mandatoryLevel: level as Policy['mandatoryLevel'],
        allowedModels: models.split(',').map((s) => s.trim()).filter(Boolean),
        maxIdleTtlSeconds: Number(ttl) || 1800,
      });
      setPolicy(out.policy);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <p className="text-sm text-ink">Execution policy is enforced server-side at provision time. Violations fail closed.</p>
      <Err message={error} />
      <div className="mt-4 max-w-2xl rounded-xl border border-navy/10 bg-white p-4">
        <p className="font-semibold text-navy">Policy {policy ? '' : '(loading…)'}</p>
        <label className="mt-3 block text-sm text-ink">
          Minimum security level
          <select value={level} onChange={(e) => setLevel(e.target.value)} className="mt-1 w-full rounded-lg border border-navy/15 px-2 py-1.5 text-navy">
            <option value="none">none — allow anything curated</option>
            <option value="standard">standard — isolated execution minimum</option>
            <option value="verified_inference">verified_inference — attested inference required</option>
          </select>
        </label>
        <label className="mt-3 block text-sm text-ink">
          Allowed models (comma-separated, empty = curated list)
          <input value={models} onChange={(e) => setModels(e.target.value)} placeholder="Qwen/Qwen3.8-27B" className="mt-1 w-full rounded-lg border border-navy/15 px-2 py-1.5 font-mono text-xs text-navy" />
        </label>
        <label className="mt-3 block text-sm text-ink">
          Max idle TTL (seconds)
          <input value={ttl} onChange={(e) => setTtl(e.target.value)} inputMode="numeric" className="mt-1 w-full rounded-lg border border-navy/15 px-2 py-1.5 text-navy" />
        </label>
        <button onClick={save} className="mt-3 rounded-lg bg-cta px-4 py-2 text-sm text-white hover:bg-ctahover">Save policy</button>
        {saved && <p className="mt-2 text-sm text-green-700">Saved and enforced on the next provision.</p>}
      </div>
      <div className="mt-4 max-w-2xl rounded-xl border border-navy/10 bg-white p-4">
        <p className="font-semibold text-navy">Sandbox image trust</p>
        {!trust && !trustMissing && <p className="mt-2 text-sm text-ink">Loading…</p>}
        {trustMissing && <p className="mt-2 text-sm text-ink">No trust record published yet — run <span className="font-mono">03-publish-trust.ts</span> after the next image build.</p>}
        {trust && (
          <div className="mt-2 text-xs text-ink">
            <p className="break-all font-mono">{trust.imageArn ?? '(none published)'}</p>
            <p className="mt-1">version {trust.imageVersion ?? '?'} · built {trust.builtAt ?? '?'}</p>
            <p className="break-all">zip sha256: {trust.zipSha256 ?? '?'}</p>
            <p>sbom: {trust.sbomSha256 ?? 'not recorded'}</p>
            <p>signed kid: {trust.signature?.kid ?? 'unsigned'} · verify offline with <span className="font-mono">wayfind image-trust</span></p>
          </div>
        )}
      </div>
    </div>
  );
}
