// wayfind chat — participate in a ONE conversation from the CLI.
// Usage:
//   wayfind chat "message" --conversation <id> [--sub bot/message]
//   wayfind chat "message" --new [--model <id>] [--system "..."] [--level standard|verified_inference]
// --new provisions a conversation, inits the bot, sends the message, and
// leaves it live (close it from the website or a later stop command).
// Default sub is bot/message (the in-VM bot loop); use --sub exec to run
// a raw command instead (body must then be JSON via --json-body).
import { loadToken } from '../sandbox/api.js';
import { apiBase } from '../auth/client.js';

async function post(path, token, body) {
  const res = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `request failed (${res.status})`);
  return data;
}

export async function chat(rawArgs) {
  const args = [...rawArgs];
  let conversationId = '';
  let isNew = false;
  let model = 'Qwen/Qwen3.8-27B';
  let system = 'You are a helpful assistant. Answer concisely.';
  let level = 'standard';
  let sub = 'bot/message';
  const messageParts = [];
  while (args.length) {
    const flag = args.shift();
    if (flag === '--conversation' || flag === '--id') conversationId = args.shift() ?? '';
    else if (flag === '--new') isNew = true;
    else if (flag === '--model') model = args.shift() ?? model;
    else if (flag === '--system') system = args.shift() ?? system;
    else if (flag === '--level') level = args.shift() ?? level;
    else if (flag === '--sub') sub = args.shift() ?? sub;
    else if (flag === '--') {
      messageParts.push(...args);
      break;
    } else if (flag.startsWith('--')) {
      console.error(`Unknown flag: ${flag}`);
      process.exit(1);
    } else {
      messageParts.push(flag);
    }
  }
  const message = messageParts.join(' ').trim();
  if (!message) {
    console.error('Usage: wayfind chat "message" --conversation <id> | --new [--model id] [--system "..."]');
    process.exit(1);
  }
  const token = await loadToken();
  if (isNew) {
    const created = await post('/conversations', token, { model, securityLevel: level });
    if (!created?.conversationId) throw new Error(`provision failed: ${JSON.stringify(created)}`);
    conversationId = created.conversationId;
    console.log(`Conversation ${conversationId} live (${created.model}, ${created.securityLevel}).`);
    try {
      await post(`/conversations/${conversationId}/message`, token, {
        sub: 'bot/init',
        body: { system, model },
      });
    } catch (err) {
      console.error(`bot/init failed (conversation stays live): ${err.message}`);
      process.exit(1);
    }
  }
  if (!conversationId) {
    console.error('Pass --conversation <id> or --new.');
    process.exit(1);
  }
  const body = sub === 'bot/message' ? { content: message } : { cmd: message };
  const out = await post(`/conversations/${conversationId}/message`, token, { sub, body });
  const result = out?.result ?? out;
  if (typeof result?.text === 'string') {
    process.stdout.write(result.text + (result.text.endsWith('\n') ? '' : '\n'));
    if (result.head) console.log(`[seq ${result.seq} · head ${String(result.head).slice(0, 12)}]`);
  } else if (typeof result?.stdout === 'string') {
    process.stdout.write(result.stdout);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
  if (isNew) console.log(`Conversation stays live: ${conversationId}`);
}
