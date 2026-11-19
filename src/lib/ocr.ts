import type { PDFPageProxy } from 'pdfjs-dist';
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import { finalize, mathScore, isMathy, type Block, type PageData, type Run } from './extract';

/**
 * Speed notes:
 * - Recognition time scales with pixel count. ~2000 px on the long side (≈170 DPI for A4) keeps
 *   normal text and handwriting legible while being ~4× cheaper than 300 DPI.
 * - Several WASM workers run in parallel (one per spare core, capped).
 * - A page that times out only kills its own worker; the pool keeps going.
 */
const TARGET_LONG_SIDE = 2000;
const MAX_SCALE = 300 / 72;
const PAGE_TIMEOUT_MS = 240_000;
/** Words below this confidence are dropped; handwriting often scores 20–60, so keep the bar low. */
const MIN_WORD_CONF = 10;
export const OCR_WORKERS = Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 4) / 2)));

function spawnWorker(): Promise<Worker> {
  return createWorker('eng', OEM.LSTM_ONLY, {
    workerPath: chrome.runtime.getURL('tesseract/worker.min.js'),
    corePath: chrome.runtime.getURL('tesseract/core/'),
    langPath: chrome.runtime.getURL('tesseract/lang'),
    workerBlobURL: false,
    cacheMethod: 'none',
    gzip: true,
    errorHandler: (e: unknown) => console.warn('Tesseract worker error', e),
  }).then(async (w) => {
    await w.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1' });
    return w;
  });
}

// ---- tiny worker pool --------------------------------------------------------
const idle: Worker[] = [];
const waiters: ((w: Worker) => void)[] = [];
let spawned = 0;

async function acquire(): Promise<Worker> {
  const w = idle.pop();
  if (w) return w;
  if (spawned < OCR_WORKERS) {
    spawned++;
    try {
      return await spawnWorker();
    } catch (e) {
      spawned--;
      throw new OcrError(`OCR engine failed to start: ${(e as Error)?.message ?? e}`);
    }
  }
  return new Promise((res) => waiters.push(res));
}

function release(w: Worker) {
  const next = waiters.shift();
  if (next) next(w);
  else idle.push(w);
}

/** Kill a stuck worker and hand a fresh one to whoever is waiting. */
function replace(w: Worker) {
  void w.terminate().catch(() => undefined);
  spawned--;
  if (waiters.length) {
    spawned++;
    spawnWorker().then(release, () => {
      spawned--;
    });
  }
}

export class OcrError extends Error {}

/** Renders a page and runs Tesseract on it. Up to OCR_WORKERS pages run concurrently. */
export async function ocrPage(page: PDFPageProxy): Promise<PageData> {
  const t0 = performance.now();
  const { canvas, vp } = await renderForOcr(page);
  const t1 = performance.now();
  const worker = await acquire();
  const t2 = performance.now();
  let timer = 0;
  let timedOut = false;
  try {
    const { data } = await Promise.race([
      worker.recognize(canvas, {}, { blocks: true, text: false }),
      new Promise<never>((_, rej) => {
        timer = window.setTimeout(() => {
          timedOut = true;
          rej(new OcrError(`OCR timed out after ${PAGE_TIMEOUT_MS / 1000}s`));
        }, PAGE_TIMEOUT_MS);
      }),
    ]);
    console.info(
      `OCR page ${page.pageNumber}: ${canvas.width}×${canvas.height}px, render ${Math.round(t1 - t0)} ms, ` +
        `wait ${Math.round(t2 - t1)} ms, recognize ${Math.round(performance.now() - t2)} ms`,
    );
    return toPageData(page, vp, data);
  } finally {
    clearTimeout(timer);
    canvas.width = canvas.height = 0;
    if (timedOut) replace(worker);
    else release(worker);
  }
}

async function renderForOcr(page: PDFPageProxy) {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(MAX_SCALE, TARGET_LONG_SIDE / Math.max(base.width, base.height));
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Annotations/forms are irrelevant for OCR and only cost time.
  await page.render({ canvasContext: ctx, viewport: vp, annotationMode: 0 }).promise;
  enhance(ctx, canvas.width, canvas.height);
  return { canvas, vp };
}

/** Grayscale + contrast stretch: helps faint pencil, coloured ink and yellowed paper. */
function enhance(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    d[i] = g;
    hist[g | 0]++;
  }
  const total = d.length / 4;
  let lo = 0;
  let hi = 255;
  for (let acc = 0; lo < 255 && (acc += hist[lo]) < total * 0.01; lo++);
  for (let acc = 0; hi > 0 && (acc += hist[hi]) < total * 0.05; hi--);
  const range = Math.max(30, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / range));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}

type OcrData = Awaited<ReturnType<Worker['recognize']>>['data'];

function toPageData(page: PDFPageProxy, vp: ReturnType<PDFPageProxy['getViewport']>, data: OcrData): PageData {
  const toPdf = (bb: { x0: number; y0: number; x1: number; y1: number }) => {
    const [ax, ay] = vp.convertToPdfPoint(bb.x0, bb.y0) as number[];
    const [bx, by] = vp.convertToPdfPoint(bb.x1, bb.y1) as number[];
    return { x0: Math.min(ax, bx), x1: Math.max(ax, bx), y0: Math.min(ay, by), y1: Math.max(ay, by) };
  };

  const blocks: Block[] = [];
  let order = 0;
  let confSum = 0;
  let confN = 0;
  for (const tb of data.blocks ?? []) {
    for (const para of tb.paragraphs) {
      const runs: Run[] = [];
      let text = '';
      let lines = 0;
      let hSum = 0;
      let pConf = 0;
      for (const line of para.lines) {
        const words = line.words.filter((w) => w.text.trim() && w.confidence >= MIN_WORD_CONF);
        if (!words.length) continue;
        lines++;
        for (const w of words) {
          const box = toPdf(w.bbox);
          if (text) {
            const prev = runs[runs.length - 1];
            if (/[A-Za-z]-$/.test(text) && prev && prev.y1 > box.y1 + 2 && /^[a-z]/.test(w.text)) {
              text = text.slice(0, -1);
              prev.e = text.length;
            } else text += ' ';
          }
          const s = text.length;
          text += w.text;
          runs.push({ s, e: text.length, ...box });
          hSum += box.y1 - box.y0;
          pConf += w.confidence;
          confSum += w.confidence * w.text.length;
          confN += w.text.length;
        }
      }
      if (!text.trim()) continue;
      const bb = toPdf(para.bbox);
      const h = hSum / Math.max(1, runs.length);
      const sc = mathScore(text, runs);
      blocks.push({
        id: 0,
        kind:
          isMathy(sc, true) && text.length < 300
            ? 'math'
            : lines <= 2 && text.length < 90 && !/[.,;:]$/.test(text)
              ? 'heading'
              : 'text',
        text,
        runs,
        ...bb,
        h,
        lines,
        order: order++,
        conf: Math.round(pConf / runs.length),
      });
    }
  }
  const out = finalize(page.pageNumber, blocks, page.view as PageData['view'], true);
  out.ocrConf = confN ? Math.round(confSum / confN) : 0;
  return out;
}
