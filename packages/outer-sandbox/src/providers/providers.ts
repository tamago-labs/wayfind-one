// Provider catalog (cherry-lite): workspace/providers.json lists providers
// (baseURL, key source, per-model limits + cost/1M tokens). Resolution
// order per provider: env key → keystore key (arrays rotate). Models are
// resolved to SDK Model objects via OpenAIProvider — true per-agent
// providers with no global-client race.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OpenAIProvider } from '@openai/agents-openai';
import { WORKSPACE_DIR } from '../core/config.js';
import { drawKey } from './keystore.js';

export interface ModelCost {
  input: number;
  output: number;
}

export interface CatalogModel {
  context?: number;
  cost?: ModelCost;
}

export interface CatalogProvider {
  baseURL: string;
  key?: { env?: string; keystore?: string };
  models?: Record<string, CatalogModel>;
  /** Hosted grounded search (Meta web_search). Only for Responses-API providers that support it. */
  grounding?: boolean;
}

export interface Catalog {
  defaults?: { provider?: string; model?: string };
  small?: { provider?: string; model?: string };
  providers?: Record<string, CatalogProvider>;
}

export function loadCatalog(): Catalog {
  const path = join(WORKSPACE_DIR, 'providers.json');
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Catalog;
  } catch {
    console.error('providers.json is not valid JSON — ignoring');
    return {};
  }
}

export function providerGrounding(providerId?: string): boolean {
  if (!providerId) return false;
  try {
    const entry = loadCatalog().providers?.[providerId];
    if (entry?.grounding !== true) return false;
    // Hosted web_search only exists on Meta's API (api.meta.ai). The Modal
    // open-weights endpoint serves chat only — grounding there goes through
    // the explicit grounded_search tool (Meta direct, metaApiKey), never here.
    const base = entry.baseURL ?? process.env.PROVIDER_BASE_URL ?? 'https://api.meta.ai/v1';
    return base.includes('api.meta.ai');
  } catch {
    return false;
  }
}

export function resolveApiKey(p: CatalogProvider): string {
  if (p.key?.env) {
    const v = process.env[p.key.env];
    if (v) return v;
  }
  const storeName = p.key?.keystore ?? 'MODAL_API_KEY';
  return drawKey(storeName) ?? '';
}

/** Meta key for Meta-only services (grounded search, voice). Never the chat-model key. */
export function metaApiKey(): string {
  return process.env.PROVIDER_API_KEY ?? drawKey('PROVIDER_API_KEY') ?? '';
}

const providerCache = new Map<string, OpenAIProvider>();

/** Drop cached model clients so a key rotation (e.g. /run injection) takes effect. */
export function clearProviderCache(): void {
  providerCache.clear();
}

function providerClient(id: string, p: CatalogProvider): OpenAIProvider {
  // Cache on endpoint too: catalog edits or env overrides must not go stale.
  const cacheKey = `${id}|${p.baseURL}`;
  let client = providerCache.get(cacheKey);
  if (!client) {
    client = new OpenAIProvider({ apiKey: resolveApiKey(p) || 'missing-key', baseURL: p.baseURL });
    providerCache.set(cacheKey, client);
  }
  return client;
}

export interface ResolvedModel {
  providerId: string;
  modelId: string;
  // SDK Model object (getModel is async) — awaited by callers.
  get(): Promise<unknown>;
  cost?: ModelCost;
  context?: number;
}

export function resolveModel(providerId?: string, modelId?: string): ResolvedModel {
  const catalog = loadCatalog();
  const pid = providerId ?? catalog.defaults?.provider ?? 'modal';
  const mid = modelId ?? catalog.defaults?.model ?? process.env.PROVIDER_MODEL ?? 'meta-models/Muse-Spark-Open-816B-A42B';
  // Outer-sandbox policy: Modal-served Meta open-weight models ONLY.
  // Anything else fails closed — this image must never call a provider
  // the allowlist hasn't pinned (PLAN-P2 outer image, delta 1).
  if (pid !== 'modal') throw new Error(`outer-sandbox serves the modal provider only (asked: ${pid})`);
  const entry = catalog.providers?.[pid];
  if (!entry) throw new Error('modal provider missing from providers.json — fail closed');
  if (!entry.models?.[mid]) throw new Error(`model ${mid} not in the modal catalog — fail closed`);
  const client = providerClient(pid, entry);
  const meta = entry?.models?.[mid];
  return {
    providerId: pid,
    modelId: mid,
    get: () => client.getModel(mid),
    cost: meta?.cost,
    context: meta?.context,
  };
}

export function resolveSmallModel(): ResolvedModel {
  const catalog = loadCatalog();
  return resolveModel(catalog.small?.provider, catalog.small?.model);
}
