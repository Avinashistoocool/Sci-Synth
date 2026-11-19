import type { Settings } from './settings';

export interface ChatImage {
  mime: string;
  base64: string;
}

export interface ChatRequest {
  system: string;
  user: string;
  image?: ChatImage;
  maxTokens: number;
  signal?: AbortSignal;
}

export class LLMError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

/** True when the provider/model rejected the request because it can't take images. */
export const isImageUnsupported = (e: unknown) =>
  e instanceof LLMError && (e.status === 400 || e.status === 404 || e.status === 422 || e.status === 500) &&
  /image|vision|multimodal|modalit|content type|image_url|does not support|not supported/i.test(e.message);

async function* sseLines(res: Response): AsyncGenerator<string> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      yield line;
    }
  }
  if (buf.trim()) yield buf;
}

async function* sseData(res: Response): AsyncGenerator<unknown> {
  for await (const line of sseLines(res)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      yield JSON.parse(data);
    } catch {
      /* partial / keep-alive line */
    }
  }
}

async function ensureOk(res: Response): Promise<Response> {
  if (res.ok) return res;
  let msg = `${res.status} ${res.statusText}`;
  try {
    const body = await res.text();
    const j = JSON.parse(body);
    msg = j.error?.message ?? j.message ?? (typeof j.error === 'string' ? j.error : body.slice(0, 300));
  } catch {
    /* ignore */
  }
  if (res.status === 401 || res.status === 403) msg = `Auth failed (${res.status}): ${msg}. Check your API key.`;
  throw new LLMError(msg, res.status);
}

const trimSlash = (u: string) => u.replace(/\/+$/, '');

/** Streams text deltas from the configured provider. */
export async function* streamChat(s: Settings, req: ChatRequest): AsyncGenerator<string> {
  const cfg = s.providers[s.provider];
  const base = trimSlash(cfg.baseUrl);
  const { signal } = req;

  switch (s.provider) {
    case 'openai': {
      const res = await ensureOk(
        await fetch(`${base}/chat/completions`, {
          method: 'POST',
          signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify({
            model: cfg.model,
            stream: true,
            max_tokens: req.maxTokens,
            temperature: 0.3,
            messages: [
              { role: 'system', content: req.system },
              {
                role: 'user',
                content: req.image
                  ? [
                      { type: 'text', text: req.user },
                      { type: 'image_url', image_url: { url: `data:${req.image.mime};base64,${req.image.base64}`, detail: 'high' } },
                    ]
                  : req.user,
              },
            ],
          }),
        }),
      );
      for await (const j of sseData(res) as AsyncGenerator<any>) {
        const t = j.choices?.[0]?.delta?.content;
        if (t) yield t;
      }
      return;
    }

    case 'anthropic': {
      const res = await ensureOk(
        await fetch(`${base}/messages`, {
          method: 'POST',
          signal,
          headers: {
            'content-type': 'application/json',
            'x-api-key': cfg.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: cfg.model,
            stream: true,
            max_tokens: req.maxTokens,
            temperature: 0.3,
            // Mark the (large, stable) system prompt cacheable – cuts latency/cost on repeat hovers.
            system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
            messages: [
              {
                role: 'user',
                content: req.image
                  ? [
                      { type: 'image', source: { type: 'base64', media_type: req.image.mime, data: req.image.base64 } },
                      { type: 'text', text: req.user },
                    ]
                  : req.user,
              },
            ],
          }),
        }),
      );
      for await (const j of sseData(res) as AsyncGenerator<any>) {
        if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta') yield j.delta.text;
        if (j.type === 'error') throw new LLMError(j.error?.message ?? 'Anthropic stream error');
      }
      return;
    }

    case 'gemini': {
      const url = `${base}/models/${encodeURIComponent(cfg.model)}:streamGenerateContent?alt=sse`;
      const res = await ensureOk(
        await fetch(url, {
          method: 'POST',
          signal,
          headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: req.system }] },
            contents: [
              {
                role: 'user',
                parts: [
                  ...(req.image ? [{ inline_data: { mime_type: req.image.mime, data: req.image.base64 } }] : []),
                  { text: req.user },
                ],
              },
            ],
            generationConfig: {
              maxOutputTokens: req.maxTokens,
              temperature: 0.3,
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
        }),
      );
      for await (const j of sseData(res) as AsyncGenerator<any>) {
        for (const p of j.candidates?.[0]?.content?.parts ?? []) if (p.text && !p.thought) yield p.text;
      }
      return;
    }

    case 'ollama': {
      const res = await ensureOk(
        await fetch(`${base}/api/chat`, {
          method: 'POST',
          signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: cfg.model,
            stream: true,
            keep_alive: '30m',
            options: { num_predict: req.maxTokens, temperature: 0.3 },
            messages: [
              { role: 'system', content: req.system },
              { role: 'user', content: req.user, ...(req.image ? { images: [req.image.base64] } : {}) },
            ],
          }),
        }),
      );
      // Ollama streams newline-delimited JSON rather than SSE.
      for await (const line of sseLines(res)) {
        if (!line.trim()) continue;
        const j = JSON.parse(line);
        if (j.error) throw new LLMError(j.error);
        if (j.message?.content) yield j.message.content;
      }
      return;
    }
  }
}

export async function completeChat(s: Settings, req: ChatRequest): Promise<string> {
  let out = '';
  for await (const t of streamChat(s, req)) out += t;
  return out;
}
