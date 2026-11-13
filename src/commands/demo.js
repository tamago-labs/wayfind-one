// wayfind demo — self-contained end-to-end judge flow (no login needed).
// Usage: wayfind demo [--keep-bot]
//
// Runs the whole verifiable loop against a throwaway account: ensure the
// outer computer, create an HR bot, escalate a sealed leave-balances sheet
// to a disposable inner sandbox, close the session, pull the signed receipt
// and verify it locally (shape + Ed25519). Exit 0 = ALL CHECKS PASSED.
//
// Auth is the embedded bundle below (throwaway demo account). If it is
// ever empty, the command falls back to your own `wayfind login`.
//
// THROWAWAY CREDENTIAL NOTE: the bundle below is base64, which is
// obfuscation, not encryption. It belongs to a dedicated demo account with
// no real data. Rotate/revoke it after the event (revoke the CliToken in
// the cloud console).
import { apiBase } from '../auth/client.js';
import { loadCredentials } from '../auth/store.js';
import { checkReceipt, verifySignature } from './verify.js';

// Maintainer: fill this with
//   node -e "console.log(Buffer.from(JSON.stringify({token:'<CliToken>'})).toString('base64'))"
// from a `wayfind login` session of the demo account, then rotate it here
// whenever the demo window closes.
const DEMO_BUNDLE = 'eyJ0b2tlbiI6ImF2c2RseTJlSUZFX19ZRmFETTFaT19ORVNCV3hfYndUanVmcTJjcmhtVGcifQ==';

const HR_CSV = `employee_id,name,department,leave_type,days_taken,balance_days
E001,Araya Srisai,Engineering,annual,14,6
E002,Bordin Kham,Engineering,annual,22,-2
E003,Chailai Phong,Finance,sick,31,0
E004,Dara Nilk,HR,annual,5,15
E005,Ekkachai Rith,Sales,annual,18,2
E006,Fon Kaeo,Sales,sick,9,6
`;

const HR_TASK =
  'Review these leave balances for policy issues. Flag anyone over 20 annual days, ' +
  'any negative balances, or unusual sick leave, with a verified breakdown per employee.';

function log(step, msg) {
  console.log(`[demo:${step}] ${msg}`);
}

function decodeBundle(b64) {
  try {
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

async function resolveToken() {
  if (DEMO_BUNDLE) {
    const b = decodeBundle(DEMO_BUNDLE);
    if (b?.token) return { token: b.token, apiUrl: b.apiUrl ?? null, via: 'embedded demo bundle' };
  }
  const creds = await loadCredentials();
  if (creds?.token) return { token: creds.token, apiUrl: null, via: 'your login' };
  console.error('No demo credential: run `wayfind login` first.');
  process.exit(2);
}

async function api(path, token, { method = 'GET', body } = {}) {
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `request failed (${res.status})`);
  return data;
}

const proxy = (token, path, opts) => {
  const sep = path.includes('?') ? '&' : '?';
  return api(`/computer/proxy${path}${sep}kind=one_outer`, token, opts);
};

async function ensureComputer(token) {
  let row = (await api('/computer/request', token, { method: 'POST', body: { kind: 'one_outer' } }))?.data;
  if (!row) throw new Error('computer request returned no row');
  const status = () => row?.provisionStatus ?? '?';
  if (status() === 'running') {
    log('computer', `${row.id.slice(0, 8)}… already running`);
    return row;
  }
  if (status() === 'suspended') {
    log('computer', 'resuming suspended computer…');
    row = (await api('/computer/action', token, { method: 'POST', body: { action: 'resume', kind: 'one_outer' } }))?.data ?? row;
  } else {
    log('computer', `provisioning (status: ${status()}) — a fresh VM takes a few minutes…`);
    row = (await api('/computer/provision', token, { method: 'POST', body: { kind: 'one_outer' } }))?.data ?? row;
  }
  const deadline = Date.now() + 10 * 60_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error('computer did not reach running in time');
    await new Promise((r) => setTimeout(r, 15000));
    row = (await api('/computer/request', token, { method: 'POST', body: { kind: 'one_outer' } }))?.data;
    log('computer', `status: ${status()}`);
    if (status() === 'running') return row;
    if (status() === 'failed' || status() === 'terminated') throw new Error(`computer went ${status()}`);
  }
}

async function pollRun(token, runId, timeoutMs = 10 * 60_000) {
  let cursor = 0;
  let output = '';
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (Date.now() > deadline) throw new Error('agent run timed out');
    const page = await proxy(token, `/runs/${runId}/events?cursor=${cursor}`);
    cursor = page.nextCursor ?? cursor;
    for (const e of page.events ?? []) {
      if (e.type === 'chunk' && typeof e.chunk === 'string') {
        output += e.chunk;
        process.stdout.write(e.chunk);
      } else if (e.type === 'agent' && typeof e.agent === 'string') {
        log('agent', e.agent);
      } else if (e.type === 'approval') {
        throw new Error(`run parked on approval ${e.approvalId ?? ''} (${e.permission ?? 'unknown'}) — escalation should be auto-logged for demo`);
      } else if (e.type === 'question') {
        throw new Error('run parked on a clarifying question — answer it in chat, then re-run demo');
      }
    }
    if (page.done) {
      process.stdout.write('\n');
      return output;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

export async function demo(rawArgs) {
  const t0 = Date.now();
  const args = [...rawArgs];
  let keepBot = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--keep-bot') keepBot = true;
    else if (args[i].startsWith('--')) {
      console.error(`Unknown flag: ${args[i]}\nUsage: wayfind demo [--keep-bot]`);
      process.exit(2);
    }
  }
  const { token, apiUrl, via } = await resolveToken();
  if (apiUrl) process.env.WAYFIND_API_URL = apiUrl;
  log('auth', `using ${via} credential`);

  // 1. Computer.
  await ensureComputer(token);

  // 2. Escalation to auto-logged (restored in finally).
  const prevConfig = (await proxy(token, '/team/config')).config ?? {};
  await proxy(token, '/team/config', { method: 'PUT', body: { escalation: 'auto-logged' } });
  log('config', 'escalation mode → auto-logged (restored after demo)');

  // 3. Demo HR bot.
  const botName = `Judge-${new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '')}`;
  const created = await proxy(token, '/team/bots', {
    method: 'POST',
    body: { name: botName, role: 'HR operations — reviews leave balances in sealed sandboxes' },
  });
  const botId = created?.bot?.id;
  if (!botId) throw new Error('bot create returned no id');
  log('bot', `${botName} (${botId.slice(0, 8)}…)`);

  let allOk = false;
  try {
    // One retry: a transient inner failure consumes the staged file, so the
    // retry re-stages fresh bytes and reuses the same live session.
    for (let attempt = 1; attempt <= 2 && !allOk; attempt++) {
      if (attempt > 1) log('run', `retry ${attempt}/2 with freshly sealed bytes…`);
      allOk = await runHrTask(token, botId);
    }
  } finally {
    // 8. Cleanup: restore mode, drop the demo bot, leave the computer running.
    try {
      await proxy(token, '/team/config', { method: 'PUT', body: { escalation: prevConfig.escalation ?? 'manual' } });
      log('cleanup', 'escalation mode restored');
    } catch (e) {
      log('cleanup', `config restore failed: ${e.message}`);
    }
    if (!keepBot) {
      try {
        await proxy(token, `/team/bots/${encodeURIComponent(botId)}`, { method: 'DELETE' });
        log('cleanup', 'demo bot deleted');
      } catch (e) {
        log('cleanup', `bot delete failed: ${e.message}`);
      }
    }
  }
  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`demo done in ${mins}m — computer left running for the next run`);
  process.exit(allOk ? 0 : 1);
}

async function runHrTask(token, botId) {
  // 4. Synthetic HR sheet → sealed staging (fresh bytes every attempt:
  // staged ids are single-use, so a retry must re-seal).
  const staged = await api('/sandboxes/stage', token, {
    method: 'POST',
    body: { files: [{ name: 'leave-balances.csv', contentBase64: Buffer.from(HR_CSV, 'utf8').toString('base64') }] },
  });
  const ref = (staged.staged ?? [])[0];
  if (!ref?.fileId) throw new Error('staging returned no file id');
  const fileRef = { id: ref.fileId, name: 'leave-balances.csv' };
  log('stage', `leave-balances.csv sealed [${ref.fileId.slice(0, 8)}…]`);

  // 5. Escalate through the outer agent (auto-logged, no approval cards).
  const chat = await proxy(token, '/team/chat', {
    method: 'POST',
    body: { botId, text: HR_TASK, fileRefs: [fileRef] },
  });
  if (!chat?.runId) throw new Error('chat returned no run id');
  log('run', `${chat.runId.slice(0, 8)}… — streaming:`);
  const answer = await pollRun(token, chat.runId);
  void answer;

  // 6. Close through the agent (not the raw terminate endpoint): only the
  // outer closeout pulls the transcript, signs the receipt and stores the
  // evidence bundle the receipt is verified against.
  const close = await proxy(token, '/team/chat', { method: 'POST', body: { botId, text: 'Close the sandbox.' } });
  if (!close?.runId) throw new Error('close chat returned no run id');
  await pollRun(token, close.runId);

  // 7. Receipt + local verify (shape + Ed25519). The newest closed bundle
  // for this demo is the one we just closed.
  const closed = await proxy(token, '/team/evidence');
  const runs = [...((closed.evidence ?? []))].sort((a, b) => String(b.closedAt ?? '').localeCompare(String(a.closedAt ?? '')));
  if (runs.length === 0) throw new Error('no closed sandbox found after close');
  const sid = runs[0].sandboxId;
  const bundle = await proxy(token, `/team/evidence/${encodeURIComponent(sid)}`);
  const receipt = bundle?.evidence?.receipt ?? null;
  if (!receipt) throw new Error('no receipt stored for the closed sandbox');
  log('receipt', `${receipt.class ?? '?'} · ${receipt.model ?? '?'} · ${sid.slice(0, 15)}…`);
  const { ok: shapeOk } = checkReceipt(receipt);
  let taskOk = shapeOk;
  if (receipt?.class === 'signed' && receipt?.signature?.sig) {
    const sig = await verifySignature(receipt);
    console.log(`  ${sig.ok ? 'PASS' : 'FAIL'}  Ed25519 receipt signature verifies (offline) — ${sig.detail}`);
    taskOk = taskOk && sig.ok;
  }
  // The analysis itself must have run: no receipt inference means the inner
  // run failed (e.g. consumed staged file after a transient error) — retry.
  const ranInference = !!receipt?.inference?.botEvidence?.messages?.some((m) => m?.checked);
  if (!ranInference) {
    log('run', 'no verified inference in receipt — retrying with fresh bytes');
    return false;
  }
  console.log(taskOk ? 'demo: ALL CHECKS PASSED' : 'demo: CHECKS FAILED');
  return taskOk;
}
