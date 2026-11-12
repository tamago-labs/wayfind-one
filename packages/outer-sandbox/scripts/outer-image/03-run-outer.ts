// Step 3: boot the golden outer image manually, inject identity + secrets
// via /hooks/run (with kind one_outer), verify team chat end-to-end.
// Run: npx tsx packages/outer-sandbox/scripts/outer-image/03-run-outer.ts
//
// Secrets come from YOUR shell env (exported for this terminal only) —
// never from a file: $env:MODAL_API_KEY / $env:PROVIDER_API_KEY (PowerShell)
// or MODAL_API_KEY=... PROVIDER_API_KEY=... (sh). Same names as the local
// .env so copy-paste works; values travel only inside this POST /run.
import {
  CreateMicrovmAuthTokenCommand,
  GetMicrovmCommand,
  RunMicrovmCommand,
} from '@aws-sdk/client-lambda-microvms';
import { EGRESS_INTERNET, INGRESS_ALL, loadState, mv, saveState, waitFor } from './config';

function needEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name} in shell env — export it for this terminal only (never commit it).`);
    process.exit(1);
  }
  return v;
}

async function vmFetch(endpoint: string, token: string, path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`https://${endpoint}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), 'X-aws-proxy-auth': token, 'Content-Type': 'application/json' },
  });
  return res;
}

async function main(): Promise<void> {
  const modalKey = needEnv('MODAL_API_KEY');
  const metaKey = needEnv('PROVIDER_API_KEY');
  const { imageArn } = loadState();
  if (!imageArn) {
    console.error('No imageArn in state — run 02-create-image.ts first.');
    process.exit(1);
  }

  const ownerId = process.env.COMPUTER_OWNER_ID ?? 'manual-boot';
  const computerId = process.env.COMPUTER_ID ?? `manual-${Date.now().toString(36)}`;
  const bucket = process.env.COMPUTER_WORKSPACE_BUCKET ?? '';
  const prefix = bucket ? `computers/${computerId}/workspace/` : '';

  const startedAt = Date.now();
  const run = await mv.send(
    new RunMicrovmCommand({
      imageIdentifier: imageArn,
      // Identity for Lambda's OWN /run call (before our secrets POST).
      // Secrets never go here — payload may be logged; IDs only.
      runHookPayload: JSON.stringify({ ownerId, computerId }),
      ingressNetworkConnectors: [INGRESS_ALL],
      egressNetworkConnectors: [EGRESS_INTERNET],
      idlePolicy: { autoResumeEnabled: true, maxIdleDurationSeconds: 900, suspendedDurationSeconds: 300 },
      maximumDurationInSeconds: 14_400, // 4h cap for the manual VM
    }),
  );
  const microvmId = run.microvmId;
  if (!microvmId) throw new Error('run-microvm returned no microvmId');
  console.log(`MicroVM ${microvmId} starting...`);

  const info = await waitFor(
    'run to RUNNING',
    async () => {
      const res = await mv.send(new GetMicrovmCommand({ microvmIdentifier: microvmId }));
      console.log(`  ... state=${res.state}`);
      return res.state === 'RUNNING' ? res : null;
    },
    { intervalMs: 10_000, timeoutMs: 10 * 60_000 },
  );
  console.log(`RUNNING after ${((Date.now() - startedAt) / 1000).toFixed(1)}s — endpoint ${info.endpoint}`);
  if (!info.endpoint) throw new Error('VM has no endpoint');
  saveState({ microvmId, endpoint: info.endpoint });

  const tokenRes = await mv.send(
    new CreateMicrovmAuthTokenCommand({
      microvmIdentifier: microvmId,
      expirationInMinutes: 60,
      allowedPorts: [{ allPorts: {} }],
    }),
  );
  const token = tokenRes.authToken?.['X-aws-proxy-auth'];
  if (!token) throw new Error('No X-aws-proxy-auth in auth token response');
  console.log('Auth token minted (60m).');

  const ready = await vmFetch(info.endpoint, token, '/ready');
  console.log(`GET /ready → ${ready.status} ${await ready.text()}`);

  // Inject per-VM identity + secrets (this is what provision-by-kind will do).
  const runRes = await vmFetch(info.endpoint, token, '/hooks/run', {
    method: 'POST',
    body: JSON.stringify({
      ownerId,
      computerId,
      kind: 'one_outer',
      secrets: { MODAL_API_KEY: modalKey, PROVIDER_API_KEY: metaKey },
      ...(bucket && prefix ? { workspace: { bucket, prefix } } : {}),
    }),
  });
  console.log(`POST /hooks/run → ${runRes.status} ${await runRes.text()}`);
  if (runRes.status !== 200) throw new Error('run hook rejected — refusing to continue on a bad boot');

  // End-to-end: create a team bot, one chat turn through the outer VM.
  const botRes = await vmFetch(info.endpoint, token, '/team/bots', {
    method: 'POST',
    body: JSON.stringify({ name: 'Smoke', role: 'boot test' }),
  });
  const { bot } = (await botRes.json()) as { bot: { id: string } };
  if (!bot?.id) throw new Error(`team bot create failed: ${botRes.status}`);
  console.log(`Team bot created: ${bot.id}`);

  const chatRes = await vmFetch(info.endpoint, token, '/team/chat', {
    method: 'POST',
    body: JSON.stringify({ botId: bot.id, text: 'Reply with exactly: outer-ok', ownerId }),
  });
  const { runId } = (await chatRes.json()) as { runId: string };
  if (!runId) throw new Error(`team chat failed: ${chatRes.status}`);
  const done = await waitFor(
    'team chat to done',
    async () => {
      const ev = await vmFetch(info.endpoint, token, `/runs/${runId}/events`);
      const body = (await ev.json()) as { events?: Array<{ type?: string; output?: string }>; done?: boolean };
      const hit = (body.events ?? []).find((e) => e.type === 'done');
      if (hit) return hit;
      if (body.done) throw new Error('run finished with no done event');
      return null;
    },
    { intervalMs: 5_000, timeoutMs: 10 * 60_000 },
  );
  console.log(`Outer chat reply: ${done?.output ?? '(no done event)'}`);
  console.log(`\nVM ${microvmId} is yours for 4h. Suspend/resume/terminate come with the manager.`);
}

main().catch((err) => {
  console.error('Run-computer failed:', err);
  process.exit(1);
});
