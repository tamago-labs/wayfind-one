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

type PhaseListener = (phase: BootPhase, row?: ComputerRow) => void;

interface Flight {
  promise: Promise<ComputerRow>;
  done: boolean;
  result?: ComputerRow;
  failure?: unknown;
  lastPhase: BootPhase;
  lastRow?: ComputerRow;
  listeners: Set<PhaseListener>;
}

// Single-flight per kind: StrictMode double-mounts (and double-clicks)
// must share one ensure, never boot two VMs for one row.
const flights = new Map<ComputerKind, Flight>();

/**
 * Ensure exactly one computer is running. Concurrent callers for the same
 * kind share the in-flight attempt (late subscribers get the last phase
 * immediately, then live updates).
 */
export function ensureComputer(kind: ComputerKind, onPhase: PhaseListener): Promise<ComputerRow> {
  const existing = flights.get(kind);
  if (existing) {
    onPhase(existing.lastPhase, existing.lastRow);
    if (existing.done) {
      return existing.result ? Promise.resolve(existing.result) : Promise.reject(existing.failure);
    }
    return new Promise<ComputerRow>((resolve, reject) => {
      const forward: PhaseListener = (p, r) => onPhase(p, r);
      existing.listeners.add(forward);
      existing.promise.then(
        (row) => {
          existing.listeners.delete(forward);
          resolve(row);
        },
        (err) => {
          existing.listeners.delete(forward);
          reject(err);
        },
      );
    });
  }
  const flight: Flight = {
    promise: Promise.resolve() as unknown as Promise<ComputerRow>,
    done: false,
    lastPhase: 'checking',
    listeners: new Set(),
  };
  const emit: PhaseListener = (p, r) => {
    flight.lastPhase = p;
    flight.lastRow = r;
    onPhase(p, r);
    flight.listeners.forEach((l) => l(p, r));
  };
  flight.promise = runEnsure(kind, emit).then(
    (row) => {
      flight.done = true;
      flight.result = row;
      flights.delete(kind);
      return row;
    },
    (err) => {
      flight.done = true;
      flight.failure = err;
      flights.delete(kind);
      throw err;
    },
  );
  flights.set(kind, flight);
  return flight.promise;
}

async function runEnsure(kind: ComputerKind, onPhase: PhaseListener): Promise<ComputerRow> {
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
