// wayfind sandboxes — inspect inner sandbox sessions on your outer computer.
// Usage: wayfind sandboxes [--closed]
// Default lists live sessions; --closed lists closed runs with task titles
// (same summaries as the website's Sessions panel — no transcripts shipped).
import { listInnerEvidence, listInnerSandboxes, loadToken } from '../sandbox/api.js';

function relTime(iso) {
  if (!iso) return 'date unknown';
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff) || diff < 0) return 'just now';
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'Yesterday';
  if (d < 7) return `${d} days ago`;
  return new Date(iso).toLocaleDateString();
}

function fmtDur(ms) {
  if (typeof ms !== 'number' || ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function shortModel(m) {
  if (!m) return null;
  const parts = String(m).split('/');
  return parts[parts.length - 1] || m;
}

export async function sandboxes(rawArgs) {
  const closed = rawArgs.includes('--closed');
  if (rawArgs.some((a) => a !== '--closed')) {
    console.error('Usage: wayfind sandboxes [--closed]');
    process.exit(1);
  }
  const token = await loadToken();
  if (!closed) {
    const list = await listInnerSandboxes(token);
    if (list.length === 0) {
      console.log('No open sessions — escalate from a team chat and the session appears here.');
      return;
    }
    for (const s of list) {
      console.log(`${s.sandboxId} · ${s.profile ?? '?'} · ${s.policy ?? '?'}`);
    }
    return;
  }
  const runs = await listInnerEvidence(token);
  if (runs.length === 0) {
    console.log('No closed runs yet — close a session and its signed receipt lands here.');
    return;
  }
  for (const c of runs) {
    const dur = fmtDur(c.durationMs);
    const sub = [
      c.closedAt ? `Closed ${relTime(c.closedAt)}` : null,
      dur,
      c.stepsTotal > 0 ? `${c.stepsVerified} of ${c.stepsTotal} steps verified` : c.turns != null ? `${c.turns} turn(s)` : null,
      shortModel(c.model),
    ]
      .filter(Boolean)
      .join(' · ');
    console.log(`${c.task ?? 'Sandbox run'}`);
    console.log(`  ${sub}${c.receiptClass ? ` · receipt: ${c.receiptClass}` : ''}`);
    console.log(`  ${c.sandboxId}`);
  }
}
