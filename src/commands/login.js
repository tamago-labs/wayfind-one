// wayfind login — device flow against wayfind-cloud (same Cognito user).
import { requestCode, pollForToken, openBrowser } from '../auth/client.js';
import { saveCredentials } from '../auth/store.js';

export async function login() {
  let issued;
  try {
    issued = await requestCode();
  } catch (err) {
    console.error(`Login failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  const urlWithCode = `${issued.url}?code=${encodeURIComponent(issued.code)}`;
  console.log('');
  console.log('  1. Visit this page and sign in (email or Google — your Wayfind Cloud account):');
  console.log(`     ${issued.url}`);
  console.log('');
  console.log(`  2. Enter this code:  ${issued.code}`);
  console.log('');
  console.log('  Waiting for approval… (Ctrl+C to cancel)');
  const opened = await openBrowser(urlWithCode);
  if (!opened) console.log('  (Could not open a browser automatically — copy the URL above.)');

  let approved;
  try {
    approved = await pollForToken(issued.code, { timeoutMs: (issued.expiresIn ?? 600) * 1000 });
  } catch (err) {
    console.error(`\nLogin failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  await saveCredentials({ token: approved.token, expiresAt: approved.expiresAt ?? null });
  console.log('\nLogged in. Token saved to ~/.wayfind/credentials.json');
  console.log('Run `npm start` (or `wayfind start`) to continue.');
}
