// Inner-sandbox model picker. Client-side only (localStorage) — the choice
// rides each chat call, so no database or migration is involved.

export interface InnerModel {
  id: string;
  label: string;
  desc: string;
  /** Qwen has passing attestation proof runs; others are checked live. */
  badge: 'verified' | 'pilot';
}

export const INNER_MODELS: InnerModel[] = [
  {
    id: 'Qwen/Qwen3.8-27B',
    label: 'Qwen 3.8-27B',
    desc: 'Default. reasoning model, fully attested in our proof kit.',
    badge: 'verified',
  },
  {
    id: 'z-ai/glm-5.3-flash',
    label: 'GLM 5.3 Flash',
    desc: 'Zhipu fast model via NEAR AI. Attestation checked live at run time.',
    badge: 'pilot',
  },
  {
    id: 'deepseek-ai/DeepSeek-V4.1-Flash-1017',
    label: 'DeepSeek V4.1 Flash',
    desc: 'DeepSeek fast model via NEAR AI. Attestation checked live at run time.',
    badge: 'pilot',
  },
];

export const DEFAULT_INNER_MODEL = INNER_MODELS[0].id;

const KEY = 'wayfind.innerModel';

export function getInnerModel(): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v && INNER_MODELS.some((m) => m.id === v)) return v;
  } catch {
    // Private mode — fall through to default.
  }
  return DEFAULT_INNER_MODEL;
}

export function setInnerModel(id: string): void {
  if (!INNER_MODELS.some((m) => m.id === id)) return;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Private mode — selection lasts for this tab only.
  }
}
