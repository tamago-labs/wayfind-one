// Per-boot session bearer. Set once via POST /hooks/run (or the runtime
// /run hook) with a caller-minted token; required on every tool route.
// Disposable model: in-memory only, never persisted, gone with the VM.
let sessionToken: string | null = null;

export function getSessionToken(): string | null {
  return sessionToken;
}

export function setSessionToken(token: string): void {
  sessionToken = token;
}

export function hasSession(): boolean {
  return sessionToken !== null;
}

export interface AiCredentials {
  provider: string;
  key: string;
  model?: string;
}

// In-VM inference credential, injected per-boot via /hooks/run alongside
// the bearer. Memory-only, never logged, dies with the VM. Phase 1
// posture (documented): the Wayfind-held provider key is exposed to VM
// memory for the session lifetime; Phase 2 moves calls to a backend
// relay so keys never enter the guest.
let aiCredentials: AiCredentials | null = null;

export function getAiCredentials(): AiCredentials | null {
  return aiCredentials;
}

export function setAiCredentials(creds: AiCredentials | null): void {
  aiCredentials = creds;
}

// Per-boot run policy, injected via /hooks/run alongside the bearer.
// The image ENFORCES this itself (fail closed) — it does not trust the
// provision path to have checked: no attestation, no run; model outside
// the allowlist, no inference. This is the guarantee behind the
// verified_inference label; a creation-time gate alone would be bypassable
// by anyone who can call RunMicrovm.
export interface RunPolicy {
  /** Pinned by the control plane for inner sandboxes. */
  securityLevel: string;
  /** Allowed models; empty = the injected credential's model only. */
  allowedModels: string[];
}

let runPolicy: RunPolicy | null = null;

export function getRunPolicy(): RunPolicy | null {
  return runPolicy;
}

export function setRunPolicy(policy: RunPolicy | null): void {
  runPolicy = policy;
}

// Boot profile: review (read-only tools) or analysis (+exec). Accepted via
// /hooks/run; absent means full tools (pre-profile callers: classic exec
// runs and conversations). The image enforces it at the tool choke points.
export type SandboxProfile = 'review' | 'analysis';

let sandboxProfile: SandboxProfile = 'analysis';

export function getSandboxProfile(): SandboxProfile {
  return sandboxProfile;
}

export function setSandboxProfile(profile: SandboxProfile): void {
  sandboxProfile = profile;
}
