import type { PDFDocumentProxy } from 'pdfjs-dist';
import { aiTranscribePage } from './aiOcr';
import { cache, hashKey, type DocRecord } from './db';
import { EXTRACT_VERSION, extractPage, type PageData } from './extract';
import { completeChat, isImageUnsupported } from './llm';
import { OCR_WORKERS, ocrPage } from './ocr';
import { BRIEF_SYSTEM, briefUserPrompt, explainSystemPrompt, explainUserPrompt, knownConceptsLine } from './prompts';
import { activeConfig, type Settings } from './settings';
import type { Target } from './target';

const BEFORE_CHARS = 1600;
const AFTER_CHARS = 500;
const TARGET_MAX = 2500;
const BRIEF_SAMPLE_CHARS = 14000;

export interface PreparedPrompt {
  system: string;
  user: string;
  cacheKey: string;
}

export type OcrState =
  | { status: 'idle' }
  | { status: 'running'; done: number; total: number; failed: number }
  | { status: 'done'; pages: number; failed: number };

export interface AiState {
  busy: number[];
  done: number;
  unavailable?: string;
}

const AI_OCR_CONCURRENCY = 2;

/**
 * Per-document knowledge: cached page extractions (+OCR) and a whole-document "brief".
 * Everything is keyed by the PDF fingerprint, so re-opening a PDF is instant.
 */
export class DocContext {
  private pages = new Map<number, PageData>();
  private inflight = new Map<number, Promise<PageData>>();
  private ocrInflight = new Map<number, Promise<PageData>>();
  private record!: DocRecord;
  private briefPromise: Promise<string | undefined> | null = null;
  briefListeners = new Set<(state: BriefState) => void>();
  briefState: BriefState = { status: 'idle' };
  pageListeners = new Set<(page: number, data: PageData) => void>();
  ocrListeners = new Set<(s: OcrState) => void>();
  ocrState: OcrState = { status: 'idle' };

  private constructor(
    readonly pdf: PDFDocumentProxy,
    readonly fp: string,
  ) {}

  static async open(pdf: PDFDocumentProxy, fallbackId: string, title: string): Promise<DocContext> {
    const fp = pdf.fingerprints[0] ?? (await hashKey(fallbackId));
    const ctx = new DocContext(pdf, fp);
    const existing = await cache.getDoc(fp);
    ctx.record = { fp, title, numPages: pdf.numPages, openedAt: Date.now(), ...existing };
    ctx.record.openedAt = Date.now();
    ctx.record.title = title || existing?.title || '';
    await cache.putDoc(ctx.record);
    if (ctx.record.brief) ctx.setBrief({ status: 'ready', text: ctx.record.brief });
    return ctx;
  }

  get title() {
    return this.record.title;
  }

  get brief() {
    return this.record.brief;
  }

  peekPage(n: number) {
    return this.pages.get(n);
  }

  private setPage(n: number, data: PageData) {
    this.pages.set(n, data);
    for (const l of this.pageListeners) l(n, data);
  }

  async getPage(n: number): Promise<PageData> {
    const hit = this.pages.get(n);
    if (hit) return hit;
    let p = this.inflight.get(n);
    if (!p) {
      p = (async () => {
        const stored = await cache.getPage(this.fp, n);
        if (stored && stored.v === EXTRACT_VERSION) return stored;
        const data = await extractPage(await this.pdf.getPage(n));
        void cache.putPage({ ...data, fp: this.fp });
        return data;
      })();
      this.inflight.set(n, p);
    }
    const data = await p;
    if (!this.pages.has(n)) this.setPage(n, data);
    this.inflight.delete(n);
    return this.pages.get(n)!;
  }

  /** OCR a page with no text layer; the result replaces the page data and is cached. */
  ocr(n: number, force = false): Promise<PageData> {
    const cur = this.pages.get(n);
    if ((cur?.ocr && !force) || cur?.ai) return Promise.resolve(cur!);
    let p = this.ocrInflight.get(n);
    if (!p) {
      p = (async () => {
        const data = await ocrPage(await this.pdf.getPage(n));
        // AI transcription may have finished first; never downgrade it.
        if (this.pages.get(n)?.ai) return this.pages.get(n)!;
        void cache.putPage({ ...data, fp: this.fp });
        this.setPage(n, data);
        return data;
      })().finally(() => this.ocrInflight.delete(n));
      this.ocrInflight.set(n, p);
    }
    return p;
  }

  // ---- AI transcription (vision model) for scanned / handwritten pages ----
  private aiQueue: number[] = [];
  private aiRunning = new Set<number>();
  private aiSettings: Settings | null = null;
  aiListeners = new Set<(s: AiState) => void>();
  aiState: AiState = { busy: [], done: 0 };

  private emitAi(patch: Partial<AiState> = {}) {
    this.aiState = { ...this.aiState, busy: [...this.aiRunning], ...patch };
    for (const l of this.aiListeners) l(this.aiState);
  }

  /** Queue pages for AI transcription. `front` = user is looking at them now. */
  requestAi(pages: number[], settings: Settings, front = true) {
    this.aiSettings = settings;
    if (this.aiState.unavailable) return;
    const want = pages.filter((p) => p >= 1 && p <= this.pdf.numPages && !this.aiRunning.has(p));
    this.aiQueue = front
      ? [...want, ...this.aiQueue.filter((p) => !want.includes(p))]
      : [...this.aiQueue, ...want.filter((p) => !this.aiQueue.includes(p))];
    this.pumpAi();
  }

  private pumpAi() {
    const s = this.aiSettings;
    while (s && this.aiRunning.size < AI_OCR_CONCURRENCY && this.aiQueue.length) {
      const n = this.aiQueue.shift()!;
      void this.runAi(n, s);
    }
  }

  private async runAi(n: number, s: Settings) {
    const d = await this.getPage(n);
    if (d.hasText || d.ai || this.aiRunning.has(n)) return this.pumpAi();
    this.aiRunning.add(n);
    this.emitAi();
    try {
      const data = await aiTranscribePage(await this.pdf.getPage(n), s);
      void cache.putPage({ ...data, fp: this.fp });
      this.setPage(n, data);
      this.emitAi({ done: this.aiState.done + 1 });
    } catch (e) {
      console.warn(`AI transcription failed on page ${n}`, e);
      if (isImageUnsupported(e)) {
        this.aiQueue = [];
        this.emitAi({ unavailable: `Your model (${activeConfig(s).model}) can't read images. Pick a vision model in settings.` });
      } else {
        const cur = this.pages.get(n);
        if (cur) this.setPage(n, { ...cur, aiError: (e as Error)?.message ?? String(e) });
      }
    } finally {
      this.aiRunning.delete(n);
      this.emitAi();
      this.pumpAi();
    }
  }

  /** Force a fresh AI read of one page (e.g. "Read with AI" button). */
  async aiRead(n: number, settings: Settings) {
    const d = await this.getPage(n);
    if (d.ai || d.aiError) this.setPage(n, { ...d, ai: undefined, aiError: undefined });
    this.emitAi({ unavailable: undefined });
    this.requestAi([n], settings);
  }

  private setOcr(s: OcrState) {
    this.ocrState = s;
    for (const l of this.ocrListeners) l(s);
  }

  /** Extract pages (nearest to `around` first) and OCR scanned ones as soon as they're found. */
  async warmAll(around: () => number, isCancelled: () => boolean, ocrEnabled: boolean) {
    const n = this.pdf.numPages;
    const active = new Set<number>();
    const attempts = new Map<number, number>();
    const lanes = new Set<Promise<void>>();
    let done = 0;
    let failed = 0;
    const pending = () =>
      Array.from({ length: n }, (_, i) => i + 1).filter((p) => {
        const d = this.pages.get(p);
        return d && !d.hasText && !d.ocr && !d.ocrError && !active.has(p);
      });
    const report = () => {
      const left = pending().length + active.size;
      const total = done + left;
      this.setOcr(left ? { status: 'running', done, total, failed } : { status: 'done', pages: done, failed });
    };
    const nextPage = () => {
      const todo = pending();
      if (!todo.length) return undefined;
      const cur = around();
      todo.sort((a, b) => Math.abs(a - cur) - Math.abs(b - cur));
      return todo[0];
    };
    const lane = async () => {
      for (;;) {
        if (isCancelled()) return;
        const p = nextPage();
        if (p === undefined) return;
        active.add(p);
        report();
        try {
          await this.ocr(p);
          done++;
        } catch (e) {
          const tries = (attempts.get(p) ?? 0) + 1;
          attempts.set(p, tries);
          console.warn(`OCR failed on page ${p} (attempt ${tries})`, e);
          // One retry for transient failures (timeouts, worker crash); then give up on that page.
          if (tries >= 2) {
            failed++;
            done++;
            const d = this.pages.get(p);
            if (d) this.setPage(p, { ...d, ocrError: (e as Error)?.message ?? String(e) });
          }
        } finally {
          active.delete(p);
          report();
        }
      }
    };
    const kick = () => {
      if (!ocrEnabled) return;
      while (lanes.size < OCR_WORKERS && pending().length > lanes.size) {
        const l: Promise<void> = lane().finally(() => lanes.delete(l));
        lanes.add(l);
      }
    };

    const order = Array.from({ length: n }, (_, i) => i + 1).sort(
      (a, b) => Math.abs(a - around()) - Math.abs(b - around()),
    );
    for (const p of order) {
      if (isCancelled()) return;
      const d = await this.getPage(p);
      if (!d.hasText && !d.ocr) kick();
      await new Promise((r) => setTimeout(r, 0));
    }
    kick();
    while (lanes.size) await Promise.all([...lanes]);
    report();
  }

  private setBrief(s: BriefState) {
    this.briefState = s;
    for (const l of this.briefListeners) l(s);
  }

  /** Builds (once per PDF) a compact overview used as shared context for every explanation. */
  ensureBrief(settings: Settings, force = false): Promise<string | undefined> {
    const model = `${settings.provider}:${activeConfig(settings).model}`;
    if (!force && this.record.brief) return Promise.resolve(this.record.brief);
    if (!force && this.briefPromise) return this.briefPromise;
    this.setBrief({ status: 'building' });
    this.briefPromise = (async () => {
      try {
        const sample = await this.sampleForBrief();
        if (sample.replace(/\s/g, '').length < 200) {
          this.setBrief({ status: 'error', error: 'Not enough text yet (scanned PDF? OCR will run first).' });
          this.briefPromise = null;
          return undefined;
        }
        const text = (
          await completeChat(settings, {
            system: BRIEF_SYSTEM,
            user: briefUserPrompt(this.title, this.pdf.numPages, sample),
            maxTokens: 600,
          })
        ).trim();
        this.record = { ...this.record, brief: text, briefModel: model };
        await cache.putDoc(this.record);
        this.setBrief({ status: 'ready', text });
        return text;
      } catch (e) {
        this.setBrief({ status: 'error', error: (e as Error).message });
        this.briefPromise = null;
        return undefined;
      }
    })();
    return this.briefPromise;
  }

  /** Beginning of the doc + headings + evenly spread excerpts, within a char budget. */
  private async sampleForBrief(): Promise<string> {
    const n = this.pdf.numPages;
    const head: string[] = [];
    let used = 0;
    for (let p = 1; p <= Math.min(n, 3) && used < BRIEF_SAMPLE_CHARS * 0.55; p++) {
      const t = (await this.getPage(p)).text.slice(0, BRIEF_SAMPLE_CHARS * 0.55 - used);
      head.push(t);
      used += t.length;
    }
    const headings: string[] = [];
    const spread: string[] = [];
    const step = Math.max(1, Math.floor(n / 8));
    for (let p = 4; p <= n; p++) {
      const data = await this.getPage(p);
      for (const b of data.blocks) {
        if ((b.kind === 'heading' || b.kind === 'caption') && headings.length < 60) headings.push(`p${p}: ${b.text.slice(0, 120)}`);
      }
      if ((p - 4) % step === 0) spread.push(`[p${p}] ${data.text.slice(0, 500)}`);
    }
    let out = head.join('\n\n');
    if (headings.length) out += `\n\n--- Headings & captions ---\n${headings.join('\n')}`;
    for (const s of spread) {
      if (out.length + s.length > BRIEF_SAMPLE_CHARS) break;
      out += `\n\n${s}`;
    }
    return out.slice(0, BRIEF_SAMPLE_CHARS);
  }

  /** The "local context window": the target + nearby text on this page (and previous page tail if needed). */
  async prepare(t: Target, settings: Settings, hasImage: boolean, known: string[] = []): Promise<PreparedPrompt> {
    const data = await this.getPage(t.page);
    const target = t.text.slice(0, TARGET_MAX);
    let before = '';
    let after = '';

    const idx = t.blockId ?? -1;
    const block = idx >= 0 ? data.blocks[idx] : undefined;
    if (block) {
      const ctxText = (b: (typeof data.blocks)[number]) =>
        b.kind === 'figure' || b.kind === 'table' ? `[${b.kind}${b.caption ? `: ${b.caption}` : ''}]` : b.text;
      before = data.blocks.slice(0, idx).map(ctxText).join('\n');
      after = data.blocks.slice(idx + 1).map(ctxText).join('\n');
      // For words/sentences, the rest of their own paragraph is the most relevant context.
      if (t.kind === 'word' || t.kind === 'sentence') {
        const at = block.text.indexOf(t.text);
        if (at >= 0) {
          before = `${before}\n${block.text.slice(0, at)}`;
          after = `${block.text.slice(at + t.text.length)}\n${after}`;
        } else before = `${before}\n${block.text}`;
      }
    } else {
      before = data.text;
    }

    if (before.length < BEFORE_CHARS * 0.5 && t.page > 1) {
      const prev = await this.getPage(t.page - 1);
      before = `${prev.text.slice(-(BEFORE_CHARS - before.length))}\n${before}`;
    }
    before = before.trim().slice(-BEFORE_CHARS);
    after = after.trim().slice(0, AFTER_CHARS);

    const model = `${settings.provider}:${activeConfig(settings).model}`;
    return {
      system: explainSystemPrompt(this.title, this.record.brief, settings.style),
      user: explainUserPrompt({
        page: t.page,
        kind: t.kind,
        before,
        target,
        after,
        caption: t.caption,
        hasImage,
        ocr: t.ocr,
      }) + (known.length ? `\n\n${knownConceptsLine(known)}` : ''),
      cacheKey: await hashKey(this.fp, EXTRACT_VERSION, 'm1', t.key, target, t.kind, settings.style, model, hasImage ? 'img' : 'txt'),
    };
  }
}

export type BriefState =
  | { status: 'idle' }
  | { status: 'building' }
  | { status: 'ready'; text: string }
  | { status: 'error'; error: string };
