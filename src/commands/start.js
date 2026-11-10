// wayfind start — P0: login guard. Sandbox sessions land in P0-next.
import { validate } from '../auth/client.js';
import { loadCredentials, clearCredentials } from '../auth/store.js';

export async function start() {
  const creds = await loadCredentials();
  if (!creds) {
    console.error('Not logged in. Run: npm run login');
    process.exit(1);
  }
  let me;
  try {
    me = await validate(creds.token);
  } catch {
    await clearCredentials();
    console.error('Saved login is invalid or expired. Run: npm run login');
    process.exit(1);
  }
  console.log(`Signed in as ${me.email ?? me.userId} (via ${me.via}).`);
  console.log('Sandbox sessions are not wired yet (P0-next). Login works — you are authenticated.');
}
