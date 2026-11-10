# PLAN-P0 — CLI login against wayfind-cloud (same user, separate page)

Date: 2026-11-10. Scope: login system only. No sandbox work in P0.

## Goal

```
$ npm start          → no valid token → "Not logged in. Run: npm run login"
$ npm run login      → code + wayfind-cloud page → approve → token saved
$ npm start          → token valid → proceed (sandbox session lands here in P0-next)
```

## Identity decision (locked)

- **Same user, not a separate thing.** CLI identity = the existing wayfind-cloud Cognito user (email or Google — whatever the user already uses). No new user pool, no API-key accounts, no parallel identity.
- **Separate page.** A dedicated `wayfind.click/cli-login` page (own minimal layout, **not** inside the `/app` shell) so the CLI approval flow never drags in the product UI. It still sits behind the existing `AuthGate`/Cognito session — "separate page, same session."

## A. wayfind-cloud changes

**A1. `DeviceCode` model** (`amplify/data/resource.ts`, function-only access, no public key):
`{codeHash (GSI), status: pending|approved|denied|expired, userId?, cliTokenId?, createdAt, expiresAt}` — 10-minute TTL, single-use. Same access pattern as `CreditLedger` (writes via function IAM only).

**A2. `CliToken` model** (same file): `{tokenHash, userId (owner), deviceName, createdAt, expiresAt (90d), revokedAt?}`. Shape mirrors the proven per-computer `usageToken` (random, stored hashed), but user-scoped + revocable. Revocation list UI drops into `/app` settings next to computer controls.

**A3. Endpoints** (`amplify/functions/wayfind-api/handler.ts`, beside `/computer/*`):
- `POST /auth/device` — unauthenticated. Mints user-facing code (`XXXX-XXXX`, stores hash only). Returns `{code, url: https://wayfind.click/cli-login, expiresIn: 600}`. IP rate-limited.
- `POST /auth/device/approve {code}` — **Cognito Bearer** (the browser session — this is where "same user" is enforced: `userId` comes from the verified Cognito JWT, never from the CLI). Marks code approved, mints CliToken, links `userId`.
- `POST /auth/device/poll {code}` — unauthenticated. → `{status: pending}` | `{status: approved, token, expiresAt}` (token revealed **once**, never stored plaintext) | `{status: denied|expired}`. CLI polls every 3s within the 10-min window.
- `GET /auth/me` — Cognito **or** CliToken. Returns `{userId, email}`. Doubles as CLI session check and future home of plan/quota.
- `POST /auth/revoke` — CliToken. Revokes the calling token (logout).

**A4. `verifyToken` learns CliTokens**: `Authorization: Bearer <cli-token>` → hash → live row (unexpired, unrevoked) → attach `userId` to request context. Cognito path untouched. Existing `userId`-scoped routes gain CLI access for free.

**A5. `/cli-login` page** (`app/cli-login/page.tsx`): own minimal layout (logo + code entry, no AppShell). Behind existing `AuthGate` so email/Google sign-in is reused, not rebuilt. Enter code → shows CLI device name → Approve / Deny → confirmation screen. Theming: navy/CTA to match.

## B. wayfind-one v2 CLI (new root package)

Root `package.json`: name `wayfind`, `bin: {wayfind: ./bin/wayfind.js}`, scripts `start` → `wayfind start`, `login` → `wayfind login`. Plain Node, four modules:

- `src/auth/store.js` — `~/.wayfind/credentials.json` (0600) `{token, expiresAt, email?}`; `load/save/clear`.
- `src/auth/client.js` — `requestCode()`, `pollForToken()` (3s, stops at expiry), `validate()` via `GET /auth/me`, `openBrowser()` with paste-URL fallback.
- `src/commands/login.js` — request → print `Visit <url>, enter <code>` → spinner poll → save → print logged-in email.
- `src/commands/start.js` — **login guard first**: missing/invalid token → `Not logged in. Run: npm run login` (exit 1); valid → proceed. Plus `logout` (server revoke + local delete).

Backend URL resolution: `WAYFIND_API_URL` env override, default production Function URL, `http://localhost:3000`-equivalent local override for dev (documented, not hardcoded).

## C. Build order

1. Cloud: A1 + A2 models → A3 endpoints → A4 `verifyToken` → deploy existing Amplify branch (no new secrets).
2. Cloud: A5 `/cli-login` page, browser-tested against deployed backend.
3. CLI: store → client → login/logout/start-guard; tested against local backend, then production.
4. E2E (fresh `~/.wayfind`): `npm start` blocked → `npm run login` → approve on page → `npm start` proceeds → `logout` → blocked again → revoked token rejected server-side.

## Deferred (not P0)

Token rotation / short-lived access+refresh (P1 with egress hardening). Loopback-callback login (rejected — one return channel). SSO/SAML beyond current Google+email (enterprise phase, PIVOT.md §11).
