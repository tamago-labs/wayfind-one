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

export interface ProfileRow {
  id: string;
  ownerId: string;
  email?: string | null;
  displayName?: string | null;
}

export async function getMyProfile(ownerId: string): Promise<ProfileRow | null> {
  const { data, errors } = await dataClient().models.UserProfile.profileByOwnerId({ ownerId });
  if (errors) throw new Error(JSON.stringify(errors));
  return ((data ?? [])[0] ?? null) as unknown as ProfileRow | null;
}

export async function updateProfileName(id: string, displayName: string): Promise<void> {
  const { errors } = await dataClient().models.UserProfile.update({ id, displayName });
  if (errors) throw new Error(JSON.stringify(errors));
}
