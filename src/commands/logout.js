// wayfind logout — revoke server-side, delete local credentials.
import { revokeSelf } from '../auth/client.js';
import { loadCredentials, clearCredentials } from '../auth/store.js';

export async function logout() {
  const creds = await loadCredentials();
  if (creds) {
    try {
      await revokeSelf(creds.token);
      console.log('Token revoked on Wayfind Cloud.');
    } catch (err) {
      console.log(`Server revoke skipped (${err instanceof Error ? err.message : String(err)}) — clearing locally.`);
    }
  }
  await clearCredentials();
  console.log('Logged out.');
}
