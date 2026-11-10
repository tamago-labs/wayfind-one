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
