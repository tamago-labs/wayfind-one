import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import outputs from '@/amplify_outputs.json';

Amplify.configure(outputs);

// Untyped data client: the generated Schema lives in wayfind-cloud.
// Reads are owner-scoped server-side; the function API stays the path
// for anything that provisions or relays (VMs, keys, receipts).
// `any` is deliberate — typing against the cross-repo schema couples the
// two frontends; the Bot reads below only touch documented fields.
/* eslint-disable @typescript-eslint/no-explicit-any */
let client: any = null;

export function dataClient(): any {
  if (!client) client = generateClient();
  return client;
}

export interface BotRow {
  id: string;
  name?: string | null;
  role?: string | null;
  description?: string | null;
  status?: string | null;
  color?: string | null;
}

export async function listBots(): Promise<BotRow[]> {
  const { data, errors } = await dataClient().models.Bot.list();
  if (errors) throw new Error(JSON.stringify(errors));
  return (data ?? []) as unknown as BotRow[];
}
