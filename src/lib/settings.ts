import type { Granularity } from './target';

export type Provider = 'openai' | 'anthropic' | 'gemini' | 'ollama';
export type TriggerKey = 'Alt' | 'Control' | 'Shift';

export interface ProviderConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

export interface Settings {
  provider: Provider;
  providers: Record<Provider, ProviderConfig>;
  triggerKey: TriggerKey;
  dwellMs: number;
  /** Origins (scheme://host) whose PDFs open in Sci-Synth automatically. Empty by default. */
  siteAllowlist: string[];
  /** Optional local simulator backend, e.g. http://localhost:8000. Empty disables "Simulate". */
  simBackendUrl: string;
  style: 'concise' | 'detailed';
  buildBrief: boolean;
  granularity: Granularity;
  ocr: boolean;
  /** Transcribe scanned pages you're viewing with the vision model. */
  aiOcr: boolean;
  vision: boolean;
}

export const PROVIDER_INFO: Record<Provider, { label: string; needsKey: boolean; hint: string }> = {
  openai: {
    label: 'OpenAI / OpenAI-compatible',
    needsKey: true,
    hint: 'Works with OpenAI, Groq, OpenRouter, Together, etc. â€” just change the base URL.',
  },
  anthropic: { label: 'Anthropic Claude', needsKey: true, hint: 'Key from console.anthropic.com' },
  gemini: { label: 'Google Gemini', needsKey: true, hint: 'Key from aistudio.google.com' },
  ollama: {
    label: 'Ollama (local)',
    needsKey: false,
    hint: 'Start Ollama with OLLAMA_ORIGINS=chrome-extension://* so the extension may call it.',
  },
};

export const DEFAULT_SETTINGS: Settings = {
  provider: 'openai',
  providers: {
    openai: { apiKey: '', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' },
    anthropic: { apiKey: '', model: 'claude-haiku-4-5', baseUrl: 'https://api.anthropic.com/v1' },
    gemini: {
      apiKey: '',
      model: 'gemini-2.5-flash-lite',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    },
    ollama: { apiKey: '', model: 'llama3.2', baseUrl: 'http://localhost:11434' },
  },
  triggerKey: 'Alt',
  dwellMs: 250,
  siteAllowlist: [],
  simBackendUrl: '',
  style: 'concise',
  buildBrief: true,
  granularity: 'auto',
  ocr: true,
  aiOcr: true,
  vision: true,
};

function merge(raw: Partial<Settings> | undefined): Settings {
  const s = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
  delete (s as { autoIntercept?: unknown }).autoIntercept;
  if (!Array.isArray(s.siteAllowlist)) s.siteAllowlist = [];
  s.providers = { ...DEFAULT_SETTINGS.providers };
  for (const p of Object.keys(DEFAULT_SETTINGS.providers) as Provider[]) {
    s.providers[p] = { ...DEFAULT_SETTINGS.providers[p], ...(raw?.providers?.[p] ?? {}) };
  }
  return s;
}

export async function loadSettings(): Promise<Settings> {
  const r = await chrome.storage.local.get('settings');
  return merge(r.settings as Partial<Settings> | undefined);
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ settings: s });
}

export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  const fn = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && changes.settings) cb(merge(changes.settings.newValue as Partial<Settings>));
  };
  chrome.storage.onChanged.addListener(fn);
  return () => chrome.storage.onChanged.removeListener(fn);
}

export function activeConfig(s: Settings): ProviderConfig {
  return s.providers[s.provider];
}

export function isConfigured(s: Settings): boolean {
  const c = activeConfig(s);
  return !!c.model.trim() && (!PROVIDER_INFO[s.provider].needsKey || !!c.apiKey.trim());
}

/** Match pattern for the URL's host (all ports), e.g. "https://arxiv.org/*". */
export function originPattern(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

/** Site key used by the allowlist: "scheme://host" (no port, http/https only). */
export function siteKey(url: string): string | null {
  const p = originPattern(url);
  return p ? p.slice(0, -2) : null;
}

/**
 * Ask for optional host access (and optional API permissions). Call it first in a click handler,
 * before any other await, so the browser still sees the user gesture. Returns true when granted.
 */
export async function requestAccess(
  urls: string[],
  permissions: chrome.runtime.ManifestPermission[] = [],
): Promise<boolean> {
  const origins = [...new Set(urls.map(originPattern).filter((x): x is string => !!x))];
  if (!origins.length && !permissions.length) return true;
  try {
    return await new Promise<boolean>((resolve) =>
      chrome.permissions.request({ origins, permissions }, (ok) => resolve(!!ok && !chrome.runtime.lastError)),
    );
  } catch {
    return false;
  }
}

export async function hasAccess(url: string): Promise<boolean> {
  const p = originPattern(url);
  return p ? chrome.permissions.contains({ origins: [p] }) : false;
}
