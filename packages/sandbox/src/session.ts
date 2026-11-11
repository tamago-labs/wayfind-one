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
