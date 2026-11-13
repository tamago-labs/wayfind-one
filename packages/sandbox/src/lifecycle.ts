// MicroVM image lifecycle contract (mirrors the computer agent).
// Lambda itself calls the runtime-prefixed paths:
// - ready probe (build time): GET|POST /ready or .../runtime/v1/ready.
// - validate probe (build time): POST /validate or .../runtime/v1/validate.
// - run hook (EVERY boot, including build-time boots): POST /hooks/run,
//   /run, or .../runtime/v1/run carrying {microvmId, runHookPayload}.
//   A non-200 here fails the image — tolerant accept is mandatory.
// - suspend/resume/terminate: DISABLED on this image, answered anyway.
import { mkdirSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { MIN_SESSION_TOKEN_LEN, WORKSPACE_DIR } from './config.js';
import { json, readBody } from './http.js';
import { hasSession, setAiCredentials, setRunPolicy, setSandboxProfile, setSessionToken, type AiCredentials, type RunPolicy, type SandboxProfile } from './session.js';

const RT = '/aws/lambda-microvms/runtime/v1';

const READY = new Set([
  'GET /ready',
  'POST /ready',
  `GET ${RT}/ready`,
  `POST ${RT}/ready`,
]);
const VALIDATE = new Set([`POST /validate`, `POST ${RT}/validate`]);
const NOOP = new Set([
  'POST /hooks/suspend',
  `POST ${RT}/suspend`,
  'POST /hooks/resume',
  `POST ${RT}/resume`,
  'POST /hooks/terminate',
  `POST ${RT}/terminate`,
]);
const RUN = new Set(['POST /hooks/run', 'POST /run', `POST ${RT}/run`]);

/** Returns true when the route was a lifecycle hook (handled). */
export async function handleLifecycle(
  route: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (READY.has(route)) {
    json(res, 200, { ok: true, service: 'wayfind-sandbox' });
    return true;
  }
  if (VALIDATE.has(route)) {
    json(res, 200, { ok: true, service: 'wayfind-sandbox' });
    return true;
  }
  if (NOOP.has(route)) {
    json(res, 200, { ok: true, noop: true });
    return true;
  }
  if (RUN.has(route)) {
    const body = (await readBody(req)) as { sessionToken?: unknown; aiCredentials?: unknown; policy?: unknown; profile?: unknown };
    if (typeof body.sessionToken === 'string') {
      if (body.sessionToken.length < MIN_SESSION_TOKEN_LEN) {
        json(res, 400, { error: 'sessionToken must be at least 16 chars' });
        return true;
      }
      setSessionToken(body.sessionToken);
    }
    // Optional per-boot inference credential (memory-only). Shape:
    // { provider, key, model? }. Absent → /ai fails closed (503).
    const ac = body.aiCredentials as Partial<AiCredentials> | undefined;
    if (ac && typeof ac === 'object') {
      if (typeof ac.provider === 'string' && typeof ac.key === 'string' && ac.provider && ac.key) {
        setAiCredentials({
          provider: ac.provider,
          key: ac.key,
          ...(typeof ac.model === 'string' && ac.model ? { model: ac.model } : {}),
        });
      }
    }
    // Optional per-boot run policy (memory-only). Shape:
    // { securityLevel, allowedModels? }. The image enforces it on every
    // inference path — absent means "no policy stated", and attested-only
    // callers must pass verified_inference explicitly.
    const pol = body.policy as Partial<RunPolicy> | undefined;
    if (pol && typeof pol === 'object' && typeof pol.securityLevel === 'string' && pol.securityLevel) {
      setRunPolicy({
        securityLevel: pol.securityLevel,
        allowedModels: Array.isArray(pol.allowedModels) ? pol.allowedModels.filter((m): m is string => typeof m === 'string') : [],
      });
    }
    // Optional boot profile (review = read-only tools, analysis = +exec).
    // Absent means full tools (pre-profile callers). Enforced at the tool
    // choke points, not here.
    const prof = body.profile as SandboxProfile | undefined;
    if (prof === 'review' || prof === 'analysis') {
      setSandboxProfile(prof);
    }
    mkdirSync(WORKSPACE_DIR, { recursive: true });
    json(res, 200, { ok: true, workspace: WORKSPACE_DIR, session: hasSession() });
    return true;
  }
  return false;
}
