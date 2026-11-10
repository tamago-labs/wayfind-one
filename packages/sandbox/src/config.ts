// Shared constants: ports, workspace, caps.
export const PORT = Number(process.env.PORT ?? 8080);
export const WORKSPACE_DIR = process.env.WORKSPACE_DIR ?? '/srv/exec/workspace';

export const MAX_BODY_BYTES = 128 * 1024 * 1024;
export const MAX_OUTPUT_BYTES = 64 * 1024;
export const MAX_READ_BYTES = 1024 * 1024;
export const MAX_LIST_ENTRIES = 10_000;
export const MAX_GLOB_MATCHES = 2000;
export const MAX_GREP_MATCHES = 500;
export const MAX_SYNC_FILES = 2000;
export const EXEC_TIMEOUT_MS = 120_000;
export const MIN_SESSION_TOKEN_LEN = 16;
