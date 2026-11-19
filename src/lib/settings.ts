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
  autoIntercept: boolean;
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
    hint: 'Works with OpenAI, Groq, OpenRouter, Together, etc. — just change the base URL.',
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
  autoIntercept: true,
  style: 'concise',
  buildBrief: true,
  granularity: 'auto',
  ocr: true,
  aiOcr: true,
  vision: true,
};

function merge(raw: Partial<Settings> | undefined): Settings {
  const s = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
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
