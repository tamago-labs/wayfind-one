import { apiFetch } from './wayfind';

export type ComputerKind = 'classic' | 'one_outer';
export type ProvisionStatus = 'not_provisioned' | 'provisioning' | 'running' | 'suspended' | 'terminated';

export interface ComputerRow {
  id: string;
  provisionStatus: ProvisionStatus;
  microvmId?: string | null;
  endpoint?: string | null;
  kind?: ComputerKind | null;
  requestedAt?: string | null;
}

/** Boot phases the shell overlay renders. */
export type BootPhase =
  | 'checking'
  | 'requesting'
  | 'provisioning'
  | 'running'
  | 'suspended'
  | 'failed';

export async function requestComputer(kind?: ComputerKind): Promise<{ data: ComputerRow }> {
  return apiFetch('/computer/request', { method: 'POST', body: kind ? { kind } : {} });
}

export async function provisionComputer(kind?: ComputerKind): Promise<{ data: ComputerRow; switched?: boolean }> {
  return apiFetch('/computer/provision', { method: 'POST', body: kind ? { kind } : {} });
}

export async function computerAction(action: 'suspend' | 'resume' | 'terminate', kind?: ComputerKind): Promise<{ data: ComputerRow }> {
  return apiFetch('/computer/action', { method: 'POST', body: { action, ...(kind ? { kind } : {}) } });
}

const POLL_MS = 3000;
const MAX_WAIT_MS = 5 * 60_000;

/**
 * Ensure exactly one computer is running. Pre-deploy the backend ignores
 * kind and boots the classic image (team endpoints 404 there) — the
 * overlay surfaces that honestly; post-deploy kind selects the image.
 */
export async function ensureComputer(
  kind: ComputerKind,
  onPhase: (phase: BootPhase, row?: ComputerRow) => void,
): Promise<ComputerRow> {
  const started = Date.now();
  onPhase('checking');
  let row = (await requestComputer(kind)).data;
  if (row.provisionStatus === 'running') {
    onPhase('running', row);
    return row;
  }
  if (row.provisionStatus === 'suspended') {
    // Suspended wakes on resume — then poll like a fresh provision.
    await computerAction('resume', kind);
    row = (await requestComputer(kind)).data;
  } else {
    onPhase('requesting', row);
    try {
      row = (await provisionComputer(kind)).data;
    } catch (e) {
      // 409 suspended (same-kind resume path): resume, then poll.
      if (!/suspend/i.test(e instanceof Error ? e.message : String(e))) throw e;
      row = (await requestComputer(kind)).data;
      if (row.provisionStatus !== 'suspended') throw e;
      await computerAction('resume', kind);
      row = (await requestComputer(kind)).data;
    }
    if (row.provisionStatus === 'running') {
      onPhase('running', row);
      return row;
    }
    if (row.provisionStatus === 'suspended') {
      onPhase('suspended', row);
      return row;
    }
  }
  for (;;) {
    if (Date.now() - started > MAX_WAIT_MS) {
      throw new Error('computer boot timed out after 5 minutes — retry');
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
    row = (await requestComputer(kind)).data;
    if (row.provisionStatus === 'running') {
      onPhase('running', row);
      return row;
    }
    if (row.provisionStatus === 'suspended') {
      onPhase('suspended', row);
      return row;
    }
    if (row.provisionStatus !== 'provisioning' && row.provisionStatus !== 'not_provisioned') {
      throw new Error(`unexpected computer state: ${row.provisionStatus}`);
    }
    onPhase('provisioning', row);
  }
}
