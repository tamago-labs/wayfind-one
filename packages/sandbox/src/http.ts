// HTTP plumbing: JSON responses, body parsing, bearer gate.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAX_BODY_BYTES } from './config.js';
import { getSandboxProfile, getSessionToken, hasSession } from './session.js';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Review profile denies local mutation: exec, file writes, edits. Reads stay. */
export function requireExecAllowed(tool: string): void {
  if (getSandboxProfile() === 'review') {
    throw new HttpError(403, `${tool} is disabled in the review profile (read-only sandbox)`);
  }
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

export function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, 'invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

export function authed(req: IncomingMessage): boolean {
  const token = getSessionToken();
  if (!token) return false;
  return (req.headers.authorization ?? '') === `Bearer ${token}`;
}

export function requireSession(req: IncomingMessage): void {
  if (!authed(req)) {
    throw new HttpError(
      hasSession() ? 401 : 503,
      hasSession() ? 'unauthorized' : 'session not initialized (POST /hooks/run first)',
    );
  }
}
