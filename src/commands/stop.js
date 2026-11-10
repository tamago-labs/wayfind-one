// wayfind stop — terminate the caller's live sandbox session.
import { loadToken, terminate } from '../sandbox/api.js';

export async function stop() {
  const token = await loadToken();
  const out = await terminate(token, null);
  console.log(out?.alreadyGone ? 'No active sandbox.' : 'Sandbox terminated.');
}
