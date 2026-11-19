import { VISUAL_KINDS, boxOf, mathScore, isMathy, type Block, type Box, type PageData, type Run } from './extract';
import { sentenceSpans, wordAt } from './segment';

export type Granularity = 'auto' | 'word' | 'sentence' | 'paragraph';
export const GRANULARITIES: Granularity[] = ['auto', 'word', 'sentence', 'paragraph'];

export type TargetKind = 'word' | 'sentence' | 'paragraph' | 'heading' | 'caption' | 'math' | 'figure' | 'table' | 'region';

export interface Target {
  page: number;
  kind: TargetKind;
  text: string;
  /** Rectangles to highlight (PDF user space). */
  rects: Box[];
  /** Region to send to a vision model. */
  box: Box;
  blockId?: number;
  /** Stable identity for de-duplicating hovers and caching. */
  key: string;
  vision: boolean;
  caption?: string;
  ocr?: boolean;
}

export const KIND_LABEL: Record<TargetKind, string> = {
  word: 'Word',
  sentence: 'Sentence',
  paragraph: 'Paragraph',
  heading: 'Heading',
  caption: 'Caption',
  math: 'Equation',
  figure: 'Figure',
  table: 'Table',
  region: 'Region',
};

const inBox = (b: Box, x: number, y: number, pad: number) =>
  x >= b.x0 - pad && x <= b.x1 + pad && y >= b.y0 - pad && y <= b.y1 + pad;

const dist = (b: Box, x: number, y: number) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1));

/** Smallest block under the point; otherwise the nearest block within `reach` points. */
export function blockAt(data: PageData, x: number, y: number, reach = 10): Block | undefined {
  let best: Block | undefined;
  let bestScore = Infinity;
  for (const b of data.blocks) {
    if (!inBox(b, x, y, 2)) continue;
    // Prefer non-visual blocks when nested, then the smallest one.
    const score = (b.x1 - b.x0) * (b.y1 - b.y0) * (VISUAL_KINDS.has(b.kind) ? 4 : 1);
    if (score < bestScore) {
      best = b;
      bestScore = score;
    }
  }
  if (best) return best;
  let bestD = reach;
  for (const b of data.blocks) {
    const d = dist(b, x, y);
    if (d < bestD) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

const charX = (r: Run, off: number) => r.x0 + ((off - r.s) / Math.max(1, r.e - r.s)) * (r.x1 - r.x0);

/** Highlight rects for a [s,e) character range of a block, merged per line. */
export function rangeRects(b: Block, s: number, e: number): Box[] {
  const rects: Box[] = [];
  for (const r of b.runs) {
    const a = Math.max(s, r.s);
    const z = Math.min(e, r.e);
    if (z <= a) continue;
    const box = { x0: charX(r, a), x1: charX(r, z), y0: r.y0, y1: r.y1 };
    const last = rects[rects.length - 1];
    if (last && Math.abs(last.y0 - box.y0) < (r.y1 - r.y0) * 0.5 && box.x0 - last.x1 < (r.y1 - r.y0) * 2) {
      last.x0 = Math.min(last.x0, box.x0);
      last.x1 = Math.max(last.x1, box.x1);
      last.y0 = Math.min(last.y0, box.y0);
      last.y1 = Math.max(last.y1, box.y1);
    } else rects.push(box);
  }
  return rects;
}

const unionAll = (rs: Box[]): Box =>
  rs.reduce((a, r) => ({ x0: Math.min(a.x0, r.x0), y0: Math.min(a.y0, r.y0), x1: Math.max(a.x1, r.x1), y1: Math.max(a.y1, r.y1) }));

/** Character offset in the block nearest to a point. */
function offsetAt(b: Block, x: number, y: number): number | null {
  let best: Run | null = null;
  let bestD = Infinity;
  for (const r of b.runs) {
    const d = dist(r, x, y);
    if (d < bestD) {
      best = r;
      bestD = d;
    }
  }
  if (!best) return null;
  const t = (x - best.x0) / Math.max(1e-3, best.x1 - best.x0);
  return Math.max(best.s, Math.min(best.e - 1, best.s + Math.floor(t * (best.e - best.s))));
}

export function pickTarget(data: PageData, x: number, y: number, gran: Granularity): Target | null {
  const b = blockAt(data, x, y);
  const pg = data.page;
  if (!b) {
    if (data.hasText) return null;
    // Scanned page without OCR yet: send the region around the cursor to a vision model.
    const [vx0, vy0, vx1, vy1] = data.view;
    const box = {
      x0: Math.max(vx0, x - 230),
      x1: Math.min(vx1, x + 230),
      y0: Math.max(vy0, y - 80),
      y1: Math.min(vy1, y + 80),
    };
    const key = `${pg}:r:${Math.round(x / 40)}:${Math.round(y / 40)}`;
    return { page: pg, kind: 'region', text: '', rects: [box], box, key, vision: true };
  }

  const base = { page: pg, blockId: b.id, ocr: data.ocr, caption: b.caption };
  // OCR of handwriting/poor scans is unreliable: let the vision model read the pixels too.
  const unsure = !!data.ocr && (b.conf ?? 0) < 90;
  const whole = (kind: TargetKind, vision: boolean): Target => ({
    ...base,
    kind,
    text: b.text,
    rects: [boxOf(b)],
    box: boxOf(b),
    key: `${pg}:${b.id}:${kind}`,
    vision: vision || unsure,
  });

  if (b.kind === 'figure' || b.kind === 'table') return whole(b.kind, true);
  if (b.kind === 'math') return whole('math', true);
  if (gran === 'paragraph' || (gran === 'auto' && b.text.length < 220))
    return whole(b.kind === 'heading' || b.kind === 'caption' ? b.kind : 'paragraph', isMathy(mathScore(b.text, b.runs)));
  if ((b.kind === 'heading' || b.kind === 'caption') && gran !== 'word') return whole(b.kind, false);

  const off = offsetAt(b, x, y);
  if (off === null) return whole('paragraph', false);

  if (gran === 'word') {
    const w = wordAt(b.text, off);
    if (w) {
      const rects = rangeRects(b, w.start, w.end);
      if (rects.length)
        return { ...base, kind: 'word', text: w.word, rects, box: unionAll(rects), key: `${pg}:${b.id}:w${w.start}`, vision: unsure };
    }
  }

  const spans = sentenceSpans(b.text);
  if (spans.length <= 1) return whole('paragraph', isMathy(mathScore(b.text, b.runs)));
  const [s, e] = spans.find(([s0, e0]) => off >= s0 && off < e0) ?? spans[spans.length - 1];
  const rects = rangeRects(b, s, e);
  if (!rects.length) return whole('paragraph', false);
  // Sentences with inline math get an image too, so symbols aren't lost in extraction.
  const vision = unsure || isMathy(mathScore(b.text, b.runs, s, e));
  return {
    ...base,
    kind: 'sentence',
    text: b.text.slice(s, e).trim(),
    rects,
    box: unionAll(rects),
    key: `${pg}:${b.id}:s${s}`,
    vision,
  };
}
