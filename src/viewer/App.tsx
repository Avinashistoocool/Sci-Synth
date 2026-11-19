import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type PageViewport } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cropRegion } from '../lib/crop';
import { cache } from '../lib/db';
import { DocContext, type AiState, type BriefState, type OcrState } from '../lib/docContext';
import type { Box, PageData } from '../lib/extract';
import { DoubtGraph, visibleAnswer, type ThoughtNode } from '../lib/graph';
import { isImageUnsupported, streamChat } from '../lib/llm';
import { tutorSystemPrompt, tutorUserPrompt } from '../lib/prompts';
import { activeConfig, isConfigured, loadSettings, onSettingsChanged, type Settings } from '../lib/settings';
import { GRANULARITIES, KIND_LABEL, pickTarget, type Granularity, type Target, type TargetKind } from '../lib/target';
import { ConceptList, DoubtTree } from './DoubtsPanel';
import { ConceptChips, Md, ThreadView, type PendingAsk } from './Thread';
import { PageView } from './PageView';

GlobalWorkerOptions.workerSrc = workerUrl;

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Explanation {
  id: number;
  target: Target;
  anchor: Rect;
  text: string;
  status: 'loading' | 'streaming' | 'done' | 'error' | 'setup';
  error?: string;
  cached?: boolean;
  usedImage?: boolean;
  ms?: number;
  /** Doubt-tree node holding this explanation (set once it has finished). */
  nodeId?: string;
  /** Deepest node of the follow-up thread opened from this popover. */
  leafId?: string;
}

type PageMeta = { kind: 'text' | 'scan' | 'ocr'; conf?: number; error?: string; ai?: boolean; aiError?: string };

const GRAN_LABEL: Record<Granularity, string> = { auto: 'Auto', word: 'Word', sentence: 'Sentence', paragraph: 'Paragraph' };
const MIN_SCALE = 0.4;
const MAX_SCALE = 4;
const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(s * 100) / 100));
const modelId = (s: Settings) => `${s.provider}:${activeConfig(s).model}`;

function fileNameFromUrl(u: string) {
  try {
    return decodeURIComponent(new URL(u).pathname.split('/').pop() || u);
  } catch {
    return u;
  }
}

export function App() {
  const fileParam = useMemo(() => new URLSearchParams(location.search).get('file'), []);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [doc, setDoc] = useState<DocContext | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [scale, setScale] = useState(1.25);
  const [baseSize, setBaseSize] = useState({ w: 612, h: 792 });
  const [brief, setBrief] = useState<BriefState>({ status: 'idle' });
  const [sidebar, setSidebar] = useState(true);
  const [exploreMode, setExploreMode] = useState(false);
  const [highlight, setHighlight] = useState<{ rects: Rect[]; kind: TargetKind | 'selection' } | null>(null);
  const [popover, setPopover] = useState<Explanation | null>(null);
  const [graph, setGraph] = useState<DoubtGraph | null>(null);
  const [, setGraphVersion] = useState(0);
  const [pending, setPending] = useState<PendingAsk | null>(null);
  const [sideLeaf, setSideLeaf] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState<'ask' | 'tree' | 'concepts' | 'page'>('ask');
  const [openConcept, setOpenConcept] = useState<string | null>(null);
  const [popPinned, setPopPinned] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [granularity, setGranularity] = useState<Granularity>('auto');
  const [granToast, setGranToast] = useState(false);
  const [keyHeldUi, setKeyHeldUi] = useState(false);
  const [pageMeta, setPageMeta] = useState<Record<number, PageMeta>>({});
  const [ocrState, setOcrState] = useState<OcrState>({ status: 'idle' });
  const [aiState, setAiState] = useState<AiState>({ busy: [], done: 0 });

  const scrollRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<Settings | null>(null);
  const docRef = useRef<DocContext | null>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const scaleRef = useRef(scale);
  const exploreRef = useRef(false);
  const granRef = useRef<Granularity>('auto');
  const currentPageRef = useRef(1);
  const keyHeldRef = useRef(false);
  const mouse = useRef({ x: -1, y: -1 });
  const hoverKey = useRef('');
  const dwellTimer = useRef<number>(0);
  const flashGran = useRef<number>(0);
  const abortRef = useRef<AbortController | null>(null);
  const explId = useRef(0);
  const rafPending = useRef(false);
  const noVisionModels = useRef(new Set<string>());
  const graphRef = useRef<DoubtGraph | null>(null);
  const askAbort = useRef<AbortController | null>(null);
  const popPinnedRef = useRef(false);

  settingsRef.current = settings;
  docRef.current = doc;
  pdfRef.current = pdf;
  scaleRef.current = scale;
  exploreRef.current = exploreMode;
  graphRef.current = graph;
  popPinnedRef.current = popPinned;

  // keyHeld is read in event handlers via the ref; the state copy only drives the cursor style.
  const keyHeld = useMemo(
    () => ({
      get current() {
        return keyHeldRef.current;
      },
      set current(v: boolean) {
        if (keyHeldRef.current !== v) setKeyHeldUi(v);
        keyHeldRef.current = v;
      },
    }),
    [],
  );

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      granRef.current = s.granularity;
      setGranularity(s.granularity);
    });
    return onSettingsChanged(setSettings);
  }, []);

  // ---------- loading ----------
  const openPdf = useCallback(
    async (src: { url: string } | { data: ArrayBuffer; name: string }) => {
      setError(null);
      setPdf(null);
      setDoc(null);
      setPopover(null);
      setHighlight(null);
      setGraph(null);
      setSideLeaf(null);
      setPending(null);
      setPageMeta({});
      setOcrState({ status: 'idle' });
      setAiState({ busy: [], done: 0 });
      setProgress(0);
      try {
        const task = getDocument({
          ...('url' in src ? { url: src.url, withCredentials: true } : { data: new Uint8Array(src.data) }),
          cMapUrl: chrome.runtime.getURL('cmaps/'),
          cMapPacked: true,
          standardFontDataUrl: chrome.runtime.getURL('standard_fonts/'),
          isEvalSupported: false,
        });
        task.onProgress = ({ loaded, total }: { loaded: number; total: number }) =>
          total && setProgress(Math.min(1, loaded / total));
        const p = await task.promise;
        const meta = await p.getMetadata().catch(() => null);
        const metaTitle = ((meta?.info as Record<string, unknown> | undefined)?.Title as string | undefined)?.trim();
        const name = 'url' in src ? fileNameFromUrl(src.url) : src.name;
        const t = metaTitle && metaTitle.length > 3 ? metaTitle : name;
        document.title = `${t} – PDF AI Explorer`;
        setTitle(t);

        const first = (await p.getPage(1)).getViewport({ scale: 1 });
        setBaseSize({ w: first.width, h: first.height });
        const avail = (scrollRef.current?.clientWidth ?? 1000) - 48;
        setScale(clampScale(Math.min(avail / first.width, 1.6)));

        const ctx = await DocContext.open(p, 'url' in src ? src.url : `${src.name}:${src.data.byteLength}`, t);
        currentPageRef.current = 1;
        setCurrentPage(1);
        setPdf(p);
        setDoc(ctx);
      } catch (e) {
        const msg = (e as Error).message || String(e);
        setError(
          fileParam?.startsWith('file:') && /fetch|network|load/i.test(msg)
            ? `Couldn't read the local file. Enable "Allow access to file URLs" for this extension in edge://extensions. (${msg})`
            : msg,
        );
      } finally {
        setProgress(null);
      }
    },
    [fileParam],
  );

  useEffect(() => {
    if (fileParam) void openPdf({ url: fileParam });
  }, [fileParam, openPdf]);

  // Load this PDF's doubt tree + concept graph.
  useEffect(() => {
    if (!doc) return;
    let off: (() => void) | undefined;
    let cancelled = false;
    void DoubtGraph.load(doc.fp).then((g) => {
      if (cancelled) return;
      setGraph(g);
      off = g.subscribe(() => setGraphVersion(g.version));
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, [doc]);

  // Track per-page status (text / scanned / OCR'd / AI-read).
  useEffect(() => {
    if (!doc) return;
    const onPage = (n: number, d: PageData) =>
      setPageMeta((m) => ({
        ...m,
        [n]: {
          kind: d.ocr ? 'ocr' : d.hasText ? 'text' : 'scan',
          conf: d.ocrConf,
          error: d.ocrError,
          ai: d.ai,
          aiError: d.aiError,
        },
      }));
    const onOcr = (s: OcrState) => setOcrState(s);
    const onAi = (s: AiState) => setAiState(s);
    doc.pageListeners.add(onPage);
    doc.ocrListeners.add(onOcr);
    doc.aiListeners.add(onAi);
    return () => {
      doc.pageListeners.delete(onPage);
      doc.ocrListeners.delete(onOcr);
      doc.aiListeners.delete(onAi);
    };
  }, [doc]);

  // AI-read the scanned page you're looking at + the next 2 (lazy, so you only pay for what you read).
  useEffect(() => {
    if (!doc || !settings || !settings.aiOcr || !isConfigured(settings)) return;
    const t = window.setTimeout(() => {
      const pages = [currentPage, currentPage + 1, currentPage + 2].filter((p) => {
        const m = pageMeta[p];
        return m && m.kind !== 'text' && !m.ai && !m.aiError;
      });
      if (pages.length) doc.requestAi(pages, settings);
    }, 400);
    return () => clearTimeout(t);
  }, [doc, settings, currentPage, pageMeta]);

  // Build page cache, OCR scanned pages, then the whole-document brief, in the background.
  const configured = !!settings && isConfigured(settings);
  useEffect(() => {
    if (!doc || !settings) return;
    let cancelled = false;
    const l = (s: BriefState) => setBrief(s);
    doc.briefListeners.add(l);
    setBrief(doc.briefState);
    void doc
      .warmAll(
        () => currentPageRef.current,
        () => cancelled,
        settings.ocr,
      )
      .then(() => {
        if (!cancelled && settings.buildBrief && isConfigured(settings)) void doc.ensureBrief(settings);
      });
    return () => {
      cancelled = true;
      doc.briefListeners.delete(l);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, settings?.buildBrief, settings?.ocr, configured]);

  // ---------- explanations ----------
  const explain = useCallback(async (target: Target, anchor: Rect) => {
    const s = settingsRef.current;
    const ctx = docRef.current;
    if (!s || !ctx) return;
    abortRef.current?.abort();
    const id = ++explId.current;
    const base: Explanation = { id, target, anchor, text: '', status: 'loading' };

    if (!isConfigured(s)) {
      setPopover({ ...base, status: 'setup' });
      return;
    }
    setPopover(base);
    setPopPinned(false);
    const t0 = performance.now();
    const ac = new AbortController();
    abortRef.current = ac;
    const g = graphRef.current;
    const finish = (raw: string, extra: Partial<Explanation>) => {
      const text = visibleAnswer(raw);
      let nodeId: string | undefined;
      // Every finished hover explanation becomes (or reuses) a root node in the doubt tree.
      if (g && text.trim()) {
        const existing = g.findHover(target.key);
        if (existing) nodeId = existing.id;
        else {
          const label = target.text.trim() ? target.text.trim().slice(0, 140) : (target.caption ?? KIND_LABEL[target.kind]);
          const node = g.createNode({
            parentId: null,
            kind: 'hover',
            question: `Explain ${KIND_LABEL[target.kind].toLowerCase()}: “${label}${target.text.length > 140 ? '…' : ''}”`,
            anchor: { page: target.page, kind: target.kind, text: target.text.slice(0, 1500) || (target.caption ?? '') },
            targetKey: target.key,
          });
          nodeId = node.id;
          void g.complete(node.id, raw);
        }
      }
      const done: Explanation = { ...base, text, status: 'done', ms: performance.now() - t0, nodeId, leafId: nodeId, ...extra };
      if (id === explId.current) setPopover(done);
    };

    const wantImage = target.vision && s.vision && !noVisionModels.current.has(modelId(s));
    // Kick off the crop and the prompt in parallel; the crop only costs ~20–60 ms.
    const imageP = wantImage
      ? ctx.pdf.getPage(target.page).then((pg) => cropRegion(pg, target.box)).catch(() => undefined)
      : Promise.resolve(undefined);

    try {
      let image = await imageP;
      if (id !== explId.current) return;
      if (target.kind === 'region' && !image) {
        setPopover({
          ...base,
          status: 'error',
          error: s.vision
            ? 'This scanned page is still being OCR’d and your model can’t read images. Wait for OCR or pick a vision model.'
            : 'This scanned page is still being OCR’d. Enable “Send images” in settings for instant answers.',
        });
        return;
      }
      let prepared = await ctx.prepare(target, s, !!image, g?.contextFor(target.text, null).knownNames ?? []);
      const hit = await cache.getAnswer(prepared.cacheKey);
      if (id !== explId.current) return;
      if (hit) return finish(hit, { cached: true, usedImage: !!image });

      let text = '';
      let pending = false;
      const run = async () => {
        for await (const delta of streamChat(s, {
          system: prepared.system,
          user: prepared.user,
          image,
          maxTokens: (s.style === 'concise' ? 260 : 600) + (target.kind === 'math' || image ? 200 : 0),
          signal: ac.signal,
        })) {
          if (id !== explId.current) return false;
          text += delta;
          if (!pending) {
            pending = true;
            requestAnimationFrame(() => {
              pending = false;
              if (id === explId.current)
                setPopover((p) =>
                  p && p.id === id && p.status !== 'done'
                    ? { ...p, text: visibleAnswer(text), status: 'streaming', usedImage: !!image }
                    : p,
                );
            });
          }
        }
        return true;
      };

      try {
        if (!(await run())) return;
      } catch (e) {
        // Text-only model: remember it and retry once without the image.
        if (!image || text || !isImageUnsupported(e)) throw e;
        noVisionModels.current.add(modelId(s));
        image = undefined;
        prepared = await ctx.prepare(target, s, false, g?.contextFor(target.text, null).knownNames ?? []);
        if (!(await run())) return;
      }
      if (id !== explId.current) return;
      finish(text, { usedImage: !!image });
      if (text.trim()) void cache.putAnswer(prepared.cacheKey, text);
    } catch (e) {
      if ((e as Error).name === 'AbortError' || id !== explId.current) return;
      setPopover({ ...base, status: 'error', error: (e as Error).message });
    }
  }, []);

  const closePopover = useCallback(() => {
    abortRef.current?.abort();
    explId.current++;
    hoverKey.current = '';
    setPopover(null);
    setPopPinned(false);
    setHighlight(null);
    setPending((p) => (p?.surface === 'popover' ? null : p));
  }, []);

  // ---------- tutor: follow-up questions that grow the doubt tree ----------
  const ask = useCallback(
    async (question: string, parentId: string | null, surface: 'popover' | 'sidebar') => {
      const s = settingsRef.current;
      const ctx = docRef.current;
      const g = graphRef.current;
      if (!s || !ctx || !g) return;
      if (!isConfigured(s)) {
        setPending({ surface, parentId, question, text: '', status: 'error', error: 'Add an API key in settings first.' });
        return;
      }
      askAbort.current?.abort();
      const ac = new AbortController();
      askAbort.current = ac;
      setPending({ surface, parentId, question, text: '', status: 'loading' });

      const path = parentId ? g.pathTo(parentId) : [];
      const rootAnchor = path[0]?.anchor;
      const anchor = rootAnchor ?? { page: currentPageRef.current, kind: 'page', text: '' };
      const mem = g.contextFor(question, parentId, anchor);
      // Fresh questions from the sidebar get the current page as light grounding.
      let passage = rootAnchor;
      if (!passage) {
        const pd = await ctx.getPage(currentPageRef.current).catch(() => undefined);
        if (pd?.text) passage = { page: pd.page, kind: 'page', text: pd.text.slice(0, 1500) };
      }
      const user = tutorUserPrompt({
        question,
        thread: mem.path.map((n) => ({ q: n.question, a: n.answer, page: n.anchor?.page })),
        related: mem.concepts.map((c) => ({
          name: c.name,
          note: c.note,
          state: c.state,
          pages: c.pages,
          links: Object.entries(c.related)
            .sort((a, b) => b[1].w - a[1].w)
            .slice(0, 3)
            .map(([id, e]) => `${e.rel ?? 'related to'} ${g.concepts.get(id)?.name ?? ''}`)
            .filter((x) => !x.endsWith(' ')),
        })),
        passage,
        known: mem.knownNames,
      });

      let raw = '';
      let rafQueued = false;
      try {
        for await (const d of streamChat(s, {
          system: tutorSystemPrompt(ctx.title, ctx.brief, s.style),
          user,
          maxTokens: s.style === 'concise' ? 700 : 1200,
          signal: ac.signal,
        })) {
          raw += d;
          if (!rafQueued) {
            rafQueued = true;
            requestAnimationFrame(() => {
              rafQueued = false;
              setPending((p) => (p && p.question === question ? { ...p, text: visibleAnswer(raw), status: 'streaming' } : p));
            });
          }
        }
        if (ac.signal.aborted) return;
        const node = g.createNode({
          parentId,
          kind: 'question',
          question,
          anchor: rootAnchor ? { ...rootAnchor } : passage ? { page: passage.page, kind: 'page', text: '' } : undefined,
        });
        await g.complete(node.id, raw);
        setPending(null);
        if (surface === 'popover') setPopover((p) => (p ? { ...p, leafId: node.id } : p));
        else setSideLeaf(node.id);
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setPending((p) => (p ? { ...p, status: 'error', error: (e as Error).message } : p));
      }
    },
    [],
  );

  const openNodeInSidebar = useCallback((id: string) => {
    setSidebar(true);
    setSideTab('ask');
    setSideLeaf(id);
    setPending((p) => (p?.surface === 'sidebar' ? null : p));
  }, []);

  const openConceptInSidebar = useCallback((id: string) => {
    setSidebar(true);
    setSideTab('concepts');
    setOpenConcept(id);
    requestAnimationFrame(() =>
      document.getElementById(`concept-${CSS.escape(id)}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
    );
  }, []);

  // ---------- hover hit-testing ----------
  /** PDF-space boxes → rects relative to the .pages wrapper. */
  const toWrapperRects = (pageEl: HTMLElement, vp: PageViewport, boxes: Box[]): Rect[] =>
    boxes.map((b) => {
      const [xa, ya, xb, yb] = vp.convertToViewportRectangle([b.x0, b.y0, b.x1, b.y1]) as number[];
      return {
        left: pageEl.offsetLeft + Math.min(xa, xb),
        top: pageEl.offsetTop + Math.min(ya, yb),
        width: Math.abs(xb - xa),
        height: Math.abs(yb - ya),
      };
    });

  const boundsOf = (rs: Rect[]): Rect => {
    const l = Math.min(...rs.map((r) => r.left));
    const t = Math.min(...rs.map((r) => r.top));
    const r = Math.max(...rs.map((x) => x.left + x.width));
    const b = Math.max(...rs.map((x) => x.top + x.height));
    return { left: l, top: t, width: r - l, height: b - t };
  };

  const explainSelection = useCallback((): boolean => {
    const sel = window.getSelection();
    const text = sel?.toString().replace(/\s+/g, ' ').trim();
    if (!sel || !text || text.length < 2 || !sel.rangeCount) return false;
    const range = sel.getRangeAt(0);
    const pageEl = (range.startContainer.parentElement ?? null)?.closest<HTMLElement>('.page');
    const wrapper = pagesRef.current;
    if (!pageEl || !wrapper) return false;
    const wr = wrapper.getBoundingClientRect();
    const rects = [...range.getClientRects()]
      .filter((r) => r.width > 1 && r.height > 1)
      .map((r) => ({ left: r.left - wr.left, top: r.top - wr.top, width: r.width, height: r.height }));
    if (!rects.length) return false;
    const page = Number(pageEl.dataset.page);
    const key = `sel:${page}:${text}`;
    if (hoverKey.current === key) return true;
    hoverKey.current = key;
    clearTimeout(dwellTimer.current);
    const anchor = boundsOf(rects);
    setHighlight({ rects, kind: 'selection' });
    const pr = pageEl.getBoundingClientRect();
    const vp = viewportFor(page);
    let box: Box = { x0: 0, y0: 0, x1: 0, y1: 0 };
    if (vp) {
      const [ax, ay] = vp.convertToPdfPoint(anchor.left + wr.left - pr.left, anchor.top + wr.top - pr.top) as number[];
      const [bx, by] = vp.convertToPdfPoint(
        anchor.left + anchor.width + wr.left - pr.left,
        anchor.top + anchor.height + wr.top - pr.top,
      ) as number[];
      box = { x0: Math.min(ax, bx), x1: Math.max(ax, bx), y0: Math.min(ay, by), y1: Math.max(ay, by) };
    }
    const kind = text.split(' ').length <= 3 && text.length < 40 ? 'word' : 'sentence';
    const mathy = /[\u0370-\u03FF\u2200-\u22FF=^_]/.test(text);
    void explain({ page, kind, text, rects: [box], box, key, vision: mathy }, anchor);
    return true;
  }, [explain]);

  const viewportCache = useRef(new Map<string, PageViewport>());
  const viewportFor = (page: number): PageViewport | undefined => {
    const p = pdfRef.current;
    if (!p) return undefined;
    const k = `${page}@${scaleRef.current}`;
    return viewportCache.current.get(k);
  };

  const hitTest = useCallback(async () => {
    const ctx = docRef.current;
    const p = pdf;
    const s = settingsRef.current;
    if (!ctx || !p || !s) return;
    if (!(keyHeld.current || exploreRef.current)) return;
    // The reader is in a follow-up conversation in the popover: don't replace it.
    if (popPinnedRef.current) return;
    const { x, y } = mouse.current;
    const el = document.elementFromPoint(x, y);
    if (!el || el.closest('.popover')) return;
    const pageEl = el.closest<HTMLElement>('.page');
    if (!pageEl) return;
    const pageNum = Number(pageEl.dataset.page);
    const k = `${pageNum}@${scaleRef.current}`;
    let vp = viewportCache.current.get(k);
    if (!vp) {
      vp = (await p.getPage(pageNum)).getViewport({ scale: scaleRef.current });
      viewportCache.current.set(k, vp);
    }
    const data = ctx.peekPage(pageNum) ?? (await ctx.getPage(pageNum));
    const pr = pageEl.getBoundingClientRect();
    const [px, py] = vp.convertToPdfPoint(x - pr.left, y - pr.top) as number[];
    const target = pickTarget(data, px, py, granRef.current);
    if (!target) {
      if (!popover) {
        hoverKey.current = '';
        setHighlight(null);
      }
      return;
    }
    if (target.key === hoverKey.current) return;
    hoverKey.current = target.key;
    const rects = toWrapperRects(pageEl, vp, target.rects);
    setHighlight({ rects, kind: target.kind });
    clearTimeout(dwellTimer.current);
    const key = target.key;
    dwellTimer.current = window.setTimeout(() => {
      if (hoverKey.current === key) void explain(target, boundsOf(rects));
    }, s.dwellMs);
  }, [pdf, explain, popover]);

  const scheduleHitTest = useCallback(() => {
    if (rafPending.current) return;
    rafPending.current = true;
    requestAnimationFrame(() => {
      rafPending.current = false;
      void hitTest();
    });
  }, [hitTest]);

  const cycleGranularity = useCallback((dir: 1 | -1) => {
    const i = GRANULARITIES.indexOf(granRef.current);
    const next = GRANULARITIES[(i + dir + GRANULARITIES.length) % GRANULARITIES.length];
    granRef.current = next;
    setGranularity(next);
    hoverKey.current = '';
    flashGran.current = window.setTimeout(() => setGranToast(false), 900);
    setGranToast(true);
  }, []);

  useEffect(() => {
    const isTrigger = (e: KeyboardEvent) => settingsRef.current && e.key === settingsRef.current.triggerKey;
    const down = (e: KeyboardEvent) => {
      if (isTrigger(e)) {
        if (e.key === 'Alt') e.preventDefault();
        if (e.repeat) return;
        keyHeld.current = true;
        if (!explainSelection()) scheduleHitTest();
        return;
      }
      if (e.key === 'Escape') closePopover();
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, select');
      if (!typing && (keyHeld.current || exploreRef.current) && !e.ctrlKey && !e.metaKey) {
        const n = { '1': 'auto', '2': 'word', '3': 'sentence', '4': 'paragraph' }[e.key] as Granularity | undefined;
        if (n) {
          e.preventDefault();
          granRef.current = n;
          setGranularity(n);
          hoverKey.current = '';
          setGranToast(true);
          clearTimeout(flashGran.current);
          flashGran.current = window.setTimeout(() => setGranToast(false), 900);
          scheduleHitTest();
          return;
        }
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        setScale((s) => clampScale(s * 1.15));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        setScale((s) => clampScale(s / 1.15));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        setScale(1);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (isTrigger(e)) {
        if (e.key === 'Alt') e.preventDefault();
        keyHeld.current = false;
        clearTimeout(dwellTimer.current);
        if (!exploreRef.current) {
          if (!popover) setHighlight(null);
          hoverKey.current = '';
        }
      }
    };
    const blur = () => {
      keyHeld.current = false;
      clearTimeout(dwellTimer.current);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [scheduleHitTest, explainSelection, closePopover, popover]);

  const onMouseMove = (e: React.MouseEvent) => {
    mouse.current = { x: e.clientX, y: e.clientY };
    keyHeld.current = e.getModifierState(settingsRef.current?.triggerKey ?? 'Alt');
    if (keyHeld.current || exploreRef.current) scheduleHitTest();
  };

  // Ctrl+wheel zooms; Alt+wheel changes hover granularity. Must be non-passive to preventDefault.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let acc = 0;
    const fn = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        setScale((s) => clampScale(s * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      } else if (keyHeld.current) {
        e.preventDefault();
        acc += e.deltaY;
        if (Math.abs(acc) >= 60) {
          cycleGranularity(acc > 0 ? 1 : -1);
          acc = 0;
          scheduleHitTest();
        }
      }
    };
    el.addEventListener('wheel', fn, { passive: false });
    return () => el.removeEventListener('wheel', fn);
  }, [cycleGranularity, scheduleHitTest]);

  const onScroll = () => {
    const sc = scrollRef.current;
    const wrap = pagesRef.current;
    if (!sc || !wrap || !pdf) return;
    const mid = sc.scrollTop + sc.clientHeight / 3;
    const pages = wrap.querySelectorAll<HTMLElement>('.page');
    for (const el of pages) {
      if (el.offsetTop + el.offsetHeight > mid) {
        const n = Number(el.dataset.page);
        currentPageRef.current = n;
        setCurrentPage(n);
        break;
      }
    }
    if (keyHeld.current || exploreRef.current) scheduleHitTest();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!(e.target as HTMLElement).closest('.popover') && popover && !keyHeld.current) closePopover();
  };

  // Scale changed → positions are stale.
  useEffect(() => {
    setHighlight(null);
    setPopover(null);
    hoverKey.current = '';
    viewportCache.current.clear();
  }, [scale]);

  const scrollToPage = (n: number) => {
    const el = pagesRef.current?.querySelector<HTMLElement>(`.page[data-page="${n}"]`);
    if (el && scrollRef.current) scrollRef.current.scrollTop = el.offsetTop - 12;
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    await openPdf({ data: await f.arrayBuffer(), name: f.name });
  };

  const rebuildBrief = () => {
    if (doc && settings && isConfigured(settings)) void doc.ensureBrief(settings, true);
  };

  const aiReadCurrentPage = () => {
    if (!doc || !settings) return;
    void doc.aiRead(currentPageRef.current, settings);
  };

  // ---------- render ----------
  const pageNums = useMemo(() => (pdf ? Array.from({ length: pdf.numPages }, (_, i) => i + 1) : []), [pdf]);
  const triggerLabel = settings?.triggerKey ?? 'Alt';
  const ocrPages = useMemo(
    () => new Map(Object.entries(pageMeta).filter(([, m]) => m.kind === 'ocr').map(([k, m]) => [Number(k), m.ai ? 'AI' : 'OCR'] as const)),
    [pageMeta],
  );
  const curMeta = pageMeta[currentPage] as PageMeta | undefined;
  const aiBusyHere = aiState.busy.includes(currentPage);

  return (
    <div
      className="app"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void onFile(e.dataTransfer.files[0]);
      }}
    >
      <header className="toolbar">
        <div className="brand">✦ PDF AI Explorer</div>
        <div className="title" title={title}>
          {title}
        </div>
        {pdf && (
          <>
            <div className="pager">
              <input
                type="number"
                min={1}
                max={pdf.numPages}
                value={currentPage}
                onChange={(e) => {
                  const n = Math.min(pdf.numPages, Math.max(1, Number(e.target.value) || 1));
                  setCurrentPage(n);
                  currentPageRef.current = n;
                  scrollToPage(n);
                }}
              />
              <span>/ {pdf.numPages}</span>
            </div>
            <div className="zoom">
              <button onClick={() => setScale((s) => clampScale(s / 1.15))} title="Zoom out (Ctrl -)">
                −
              </button>
              <span>{Math.round(scale * 100)}%</span>
              <button onClick={() => setScale((s) => clampScale(s * 1.15))} title="Zoom in (Ctrl +)">
                +
              </button>
            </div>
            <div className="seg" title={`Hover target size. While holding ${triggerLabel}: scroll wheel or keys 1–4.`}>
              {GRANULARITIES.map((g, i) => (
                <button
                  key={g}
                  className={granularity === g ? 'on' : ''}
                  onClick={() => {
                    granRef.current = g;
                    setGranularity(g);
                    hoverKey.current = '';
                  }}
                >
                  <small>{i + 1}</small> {GRAN_LABEL[g]}
                </button>
              ))}
            </div>
            <button
              className={`explore-toggle ${exploreMode ? 'on' : ''}`}
              onClick={() => {
                setExploreMode((v) => !v);
                hoverKey.current = '';
              }}
              title={`Explore mode: explain on hover without holding ${triggerLabel}`}
            >
              ✦ Explore {exploreMode ? 'ON' : 'OFF'}
            </button>
          </>
        )}
        <label className="btn">
          Open PDF
          <input type="file" accept="application/pdf,.pdf" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        <button className="btn" onClick={() => setSidebar((v) => !v)}>
          {sidebar ? 'Hide panel' : 'Show panel'}
        </button>
        <button className="btn" onClick={() => chrome.runtime.openOptionsPage()}>
          ⚙
        </button>
      </header>

      {progress !== null && (
        <div className="progress">
          <div style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}

      <div className="body">
        <div
          className={`scroll ${keyHeldUi || exploreMode ? 'exploring' : ''}`}
          ref={scrollRef}
          onMouseMove={onMouseMove}
          onScroll={onScroll}
          onPointerDown={onPointerDown}
          onMouseUp={() => keyHeld.current && explainSelection()}
        >
          {error && <div className="error-box">⚠ {error}</div>}
          {!pdf && !error && progress === null && (
            <div className="empty">
              <h2>Drop a PDF here</h2>
              <p>or use “Open PDF”. PDFs you open in Edge are redirected here automatically.</p>
              <p className="muted">
                Then hold <kbd>{triggerLabel}</kbd> and point at a word, sentence, equation or figure.
              </p>
            </div>
          )}
          {pdf && (
            <div className="pages" ref={pagesRef}>
              {pageNums.map((n) => (
                <PageView key={n} pdf={pdf} pageNum={n} scale={scale} baseSize={baseSize} ocr={ocrPages.get(n)} />
              ))}
              {highlight &&
                highlight.rects.map((r, i) => (
                  <div
                    key={i}
                    className={`hl hl-${highlight.kind}`}
                    style={{ left: r.left - 2, top: r.top - 2, width: r.width + 4, height: r.height + 4 }}
                  />
                ))}
              {highlight && highlight.kind !== 'selection' && (
                <div
                  className="hl-tag"
                  style={{
                    left: boundsOf(highlight.rects).left - 2,
                    top: boundsOf(highlight.rects).top - 20,
                  }}
                >
                  {KIND_LABEL[highlight.kind as TargetKind]}
                </div>
              )}
              {popover && (
                <Popover
                  ex={popover}
                  graph={graph}
                  pending={pending?.surface === 'popover' ? pending : null}
                  wrapperWidth={pagesRef.current?.clientWidth ?? 800}
                  onClose={closePopover}
                  onRetry={() => void explain(popover.target, popover.anchor)}
                  onAsk={(q) => {
                    setPopPinned(true);
                    void ask(q, popover.leafId ?? popover.nodeId ?? null, 'popover');
                  }}
                  onFocusAsk={() => setPopPinned(true)}
                  onConcept={openConceptInSidebar}
                  onOpenInPanel={() => {
                    const leaf = popover.leafId ?? popover.nodeId;
                    if (leaf) openNodeInSidebar(leaf);
                    closePopover();
                  }}
                />
              )}
            </div>
          )}
          {granToast && <div className="gran-toast">Target: {GRAN_LABEL[granularity]}</div>}
        </div>

        {sidebar && (
          <aside className="sidebar">
            {settings && !isConfigured(settings) && (
              <div className="card warn">
                No AI provider configured.{' '}
                <a href="#" onClick={() => chrome.runtime.openOptionsPage()}>
                  Add your API key
                </a>
                .
              </div>
            )}
            <div className="tabs">
              {(
                [
                  ['ask', 'Ask'],
                  ['tree', `Doubts${graph ? ` ${graph.nodes.size}` : ''}`],
                  ['concepts', `Concepts${graph ? ` ${graph.concepts.size}` : ''}`],
                  ['page', 'Document'],
                ] as const
              ).map(([k, label]) => (
                <button key={k} className={sideTab === k ? 'on' : ''} onClick={() => setSideTab(k)}>
                  {label}
                </button>
              ))}
            </div>

            {sideTab === 'ask' && (
              <div className="card grow">
                <div className="card-h">
                  <span>{sideLeaf ? 'Thread' : 'Ask about this PDF'}</span>
                  {sideLeaf && (
                    <button
                      className="link"
                      onClick={() => {
                        setSideLeaf(null);
                        setPending((p) => (p?.surface === 'sidebar' ? null : p));
                      }}
                    >
                      + New topic
                    </button>
                  )}
                </div>
                {!sideLeaf && !pending && (
                  <p className="muted">
                    Ask a doubt about anything — it's answered with the PDF, your earlier doubts, and related concepts in
                    mind. Each question becomes a branch you can come back to. Hold <kbd>{triggerLabel}</kbd> + hover for
                    quick explanations.
                  </p>
                )}
                {graph ? (
                  <ThreadView
                    graph={graph}
                    leafId={sideLeaf}
                    pending={pending?.surface === 'sidebar' ? pending : null}
                    onAsk={(q) => void ask(q, sideLeaf, 'sidebar')}
                    onConcept={openConceptInSidebar}
                    onJump={scrollToPage}
                    placeholder={sideLeaf ? 'Ask a follow-up…' : `Ask about p.${currentPage} or anything in this PDF…`}
                  />
                ) : (
                  <p className="muted">Open a PDF first.</p>
                )}
                {sideLeaf && graph && graph.children(sideLeaf).length > 0 && (
                  <div className="branches">
                    <span className="muted">Other branches from here:</span>
                    {graph.children(sideLeaf).map((ch) => (
                      <button key={ch.id} className="link" onClick={() => setSideLeaf(ch.id)}>
                        ↳ {ch.question.slice(0, 70)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {sideTab === 'tree' && graph && (
              <div className="card grow">
                <div className="card-h">
                  <span>Doubt tree</span>
                  {sideLeaf && (
                    <button
                      className="link danger"
                      onClick={() => {
                        const root = graph.pathTo(sideLeaf)[0];
                        if (root && confirm('Delete this whole thread?')) {
                          void graph.deleteThread(root.id);
                          setSideLeaf(null);
                        }
                      }}
                    >
                      Delete open thread
                    </button>
                  )}
                </div>
                <DoubtTree graph={graph} activeId={sideLeaf} onOpen={openNodeInSidebar} />
              </div>
            )}

            {sideTab === 'concepts' && graph && (
              <div className="card grow">
                <div className="card-h">
                  <span>Concept map</span>
                  <span className="muted small">shaky first</span>
                </div>
                <ConceptList
                  graph={graph}
                  openId={openConcept}
                  setOpenId={setOpenConcept}
                  onOpenNode={openNodeInSidebar}
                  onJump={scrollToPage}
                />
              </div>
            )}

            {sideTab === 'page' && (
              <>
                {pdf && (
                  <div className="card">
                    <div className="card-h">
                      <span>Page {currentPage}</span>
                      {(curMeta?.kind === 'scan' || curMeta?.kind === 'ocr') && configured && !aiBusyHere && (
                        <button className="link" onClick={aiReadCurrentPage}>
                          {curMeta.ai ? 'Re-read with AI' : 'Read with AI'}
                        </button>
                      )}
                    </div>
                    <p className="muted">
                      {curMeta?.kind === 'text' && 'Text layer ✓'}
                      {curMeta?.kind === 'ocr' && curMeta.ai && (
                        <span className="ok-text">Handwritten/scanned · read by AI ✓</span>
                      )}
                      {curMeta?.kind === 'ocr' && !curMeta.ai && (
                        <>
                          Scanned page · quick OCR ✓{curMeta.conf !== undefined && ` (confidence ${curMeta.conf}%)`}
                          {aiBusyHere ? (
                            <span className="pulse"> · AI is reading this page…</span>
                          ) : curMeta.aiError ? (
                            <span className="err"> · AI read failed: {curMeta.aiError}</span>
                          ) : (
                            curMeta.conf !== undefined &&
                            curMeta.conf < 70 && (
                              <span className="warn-text"> Low confidence — the image is also sent to the AI.</span>
                            )
                          )}
                        </>
                      )}
                      {curMeta?.kind === 'scan' &&
                        (aiBusyHere ? (
                          <span className="pulse">AI is reading this page…</span>
                        ) : curMeta.error ? (
                          <span className="err">OCR failed: {curMeta.error}</span>
                        ) : (
                          'Scanned page · queued (images are sent to the AI meanwhile)'
                        ))}
                      {!curMeta && 'Indexing…'}
                    </p>
                    {aiState.unavailable && <p className="err">{aiState.unavailable}</p>}
                    {ocrState.status === 'running' && (
                      <div className="ocr-prog">
                        <span>
                          Quick OCR {ocrState.done}/{ocrState.total} pages
                          {ocrState.failed > 0 && ` · ${ocrState.failed} failed`}
                        </span>
                        <div>
                          <div style={{ width: `${(ocrState.done / Math.max(1, ocrState.total)) * 100}%` }} />
                        </div>
                      </div>
                    )}
                    {aiState.done > 0 && <p className="muted small">{aiState.done} page(s) read by AI this session</p>}
                  </div>
                )}
                <div className="card">
                  <div className="card-h">
                    <span>Document brief</span>
                    {doc && settings && isConfigured(settings) && (
                      <button className="link" onClick={rebuildBrief} disabled={brief.status === 'building'}>
                        {brief.status === 'ready' ? 'Rebuild' : 'Build'}
                      </button>
                    )}
                  </div>
                  {brief.status === 'idle' && <p className="muted">Built automatically once the PDF is indexed.</p>}
                  {brief.status === 'building' && <p className="muted pulse">Reading the document…</p>}
                  {brief.status === 'error' && <p className="err">{brief.error}</p>}
                  {brief.status === 'ready' && <pre className="brief">{brief.text}</pre>}
                </div>
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function Popover({
  ex,
  graph,
  pending,
  wrapperWidth,
  onClose,
  onRetry,
  onAsk,
  onFocusAsk,
  onConcept,
  onOpenInPanel,
}: {
  ex: Explanation;
  graph: DoubtGraph | null;
  pending: PendingAsk | null;
  wrapperWidth: number;
  onClose: () => void;
  onRetry: () => void;
  onAsk: (q: string) => void;
  onFocusAsk: () => void;
  onConcept: (id: string) => void;
  onOpenInPanel: () => void;
}) {
  const wide = ex.target.kind === 'math' || ex.target.kind === 'figure' || ex.target.kind === 'table';
  const W = wide ? 460 : 420;
  const left = Math.max(8, Math.min(ex.anchor.left, wrapperWidth - W - 8));
  const top = ex.anchor.top + ex.anchor.height + 8;
  const node: ThoughtNode | undefined = ex.nodeId ? graph?.nodes.get(ex.nodeId) : undefined;
  const threaded = !!graph && !!node && (ex.leafId !== ex.nodeId || !!pending);

  return (
    <div className="popover" style={{ left, top, width: W }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="pop-h">
        <span>
          ✦ {KIND_LABEL[ex.target.kind]} · p{ex.target.page}
        </span>
        {ex.usedImage && (
          <span className="badge" title="The rendered region was sent to the AI">
            👁 image
          </span>
        )}
        {ex.target.ocr && <span className="badge">OCR</span>}
        <span className="pop-meta">{ex.cached ? 'cached' : ex.ms ? `${(ex.ms / 1000).toFixed(1)}s` : ''}</span>
        {node && (
          <button className="link" onClick={onOpenInPanel} title="Continue this thread in the side panel">
            ⇱ Panel
          </button>
        )}
        <button className="x" onClick={onClose} title="Close (Esc)">
          ×
        </button>
      </div>
      <div className="pop-b">
        {ex.status === 'setup' && (
          <p>
            Add an API key first —{' '}
            <a href="#" onClick={() => chrome.runtime.openOptionsPage()}>
              open settings
            </a>
            .
          </p>
        )}
        {ex.status === 'loading' && (
          <div className="dots">
            <span />
            <span />
            <span />
          </div>
        )}
        {(ex.status === 'streaming' || ex.status === 'done') && <Md text={ex.text} streaming={ex.status === 'streaming'} />}
        {node && graph && <ConceptChips graph={graph} node={node} onConcept={onConcept} />}
        {ex.status === 'error' && (
          <>
            <p className="err">{ex.error}</p>
            <button className="btn small" onClick={onRetry}>
              Retry
            </button>
          </>
        )}
        {ex.status === 'done' && graph && node && (
          <div className={threaded ? 'pop-thread' : ''}>
            <ThreadView
              graph={graph}
              leafId={ex.leafId ?? ex.nodeId!}
              pending={pending}
              skipRoot
              onAsk={onAsk}
              onConcept={onConcept}
              onFocus={onFocusAsk}
              placeholder="Still confused? Ask a follow-up…"
            />
          </div>
        )}
      </div>
    </div>
  );
}
