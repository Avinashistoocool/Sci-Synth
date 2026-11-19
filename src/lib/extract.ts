import { OPS, type PDFPageProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

/** Bump when the extraction format changes so stale IndexedDB entries are rebuilt. */
export const EXTRACT_VERSION = 3;

export type BlockKind = 'text' | 'heading' | 'caption' | 'math' | 'figure' | 'table';
export const VISUAL_KINDS: ReadonlySet<BlockKind> = new Set(['math', 'figure', 'table']);

/** Character range [s, e) of block.text drawn inside a box (PDF user space, y up). `m` = math font. */
export interface Run {
  s: number;
  e: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  m?: 1;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Block extends Box {
  id: number;
  kind: BlockKind;
  text: string;
  /** Dominant font size. */
  h: number;
  runs: Run[];
  lines: number;
  /** Content-stream order, used for reading order. */
  order: number;
  caption?: string;
  /** OCR confidence 0–100 (OCR'd pages only). */
  conf?: number;
}

export interface PageData {
  v: number;
  page: number;
  text: string;
  blocks: Block[];
  hasText: boolean;
  ocr?: boolean;
  ocrConf?: number;
  ocrError?: string;
  /** Transcribed by the vision model (much better than Tesseract on handwriting/math). */
  ai?: boolean;
  aiError?: string;
  view: [number, number, number, number];
}

const MATH_FONT = /CMMI|CMSY|CMEX|CMBSY|CMMIB|MSAM|MSBM|EUFM|EUSM|EUEX|RSFS|STMARY|WASY|Math|Symbol|STIX|XITS|Asana|Euler/i;
const MATH_CHAR = /[\u0370-\u03FF\u2190-\u21FF\u2200-\u22FF\u2A00-\u2AFF\u27C0-\u27EF\u2300-\u23FF\u{1D400}-\u{1D7FF}=+<>^_|]/u;
const EQ_NUMBER = /\(\s*\d+(\.\d+)?[a-z]?\s*\)\s*$/;
const CAPTION = /^(Figure|Fig\.?|Table|Tab\.|Algorithm|Listing|Chart|Diagram|Plate|Exhibit)\s*[A-Z]?\d+(\.\d+)?\s*[.:|\-–—]?\s/i;

const isTextItem = (i: unknown): i is TextItem => typeof (i as TextItem).str === 'string';

// ---------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------

export const boxOf = (b: Box): Box => ({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 });
const union = (a: Box, b: Box): Box => ({
  x0: Math.min(a.x0, b.x0),
  y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1),
  y1: Math.max(a.y1, b.y1),
});
const area = (b: Box) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const hGap = (a: Box, b: Box) => Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1));
const vGap = (a: Box, b: Box) => Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
const vOverlap = (a: Box, b: Box) => Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
const intersects = (a: Box, b: Box, pad = 0) =>
  a.x0 - pad < b.x1 && b.x0 - pad < a.x1 && a.y0 - pad < b.y1 && b.y0 - pad < a.y1;
const centerIn = (b: Box, r: Box, pad = 0) => {
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  return cx >= r.x0 - pad && cx <= r.x1 + pad && cy >= r.y0 - pad && cy <= r.y1 + pad;
};

type Mat = [number, number, number, number, number, number];
const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
function transformBox(m: Mat, x0: number, y0: number, x1: number, y1: number): Box {
  const pts = [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

// ---------------------------------------------------------------------------
// math scoring
// ---------------------------------------------------------------------------

export function mathScore(text: string, runs: Run[], s = 0, e = text.length) {
  let chars = 0;
  let mathChars = 0;
  for (const ch of text.slice(s, e)) {
    if (/\s/.test(ch)) continue;
    chars++;
    if (MATH_CHAR.test(ch)) mathChars++;
  }
  let fontTotal = 0;
  let fontMath = 0;
  for (const r of runs) {
    const len = Math.min(e, r.e) - Math.max(s, r.s);
    if (len <= 0) continue;
    fontTotal += len;
    if (r.m) fontMath += len;
  }
  return { chars: chars ? mathChars / chars : 0, font: fontTotal ? fontMath / fontTotal : 0 };
}

export const isMathy = (sc: { chars: number; font: number }, strict = false) =>
  strict ? sc.font > 0.35 || sc.chars > 0.18 : sc.font > 0.12 || sc.chars > 0.07;

// ---------------------------------------------------------------------------
// items -> lines -> blocks
// ---------------------------------------------------------------------------

interface Line {
  text: string;
  runs: Run[];
  x0: number;
  x1: number;
  y: number;
  h: number;
  order: number;
}

function buildLines(items: TextItem[], isMathFont: (f: string) => boolean): Line[] {
  const lines: Line[] = [];
  let cur: Line | null = null;
  let eol = false;
  let order = 0;

  for (const it of items) {
    order++;
    const [, , c, d, x, y] = it.transform;
    const h = Math.hypot(c, d) || it.height || 10;
    const raw = it.str;
    if (!raw.trim()) {
      if (cur && raw && !cur.text.endsWith(' ')) cur.text += ' ';
      if (it.hasEOL) eol = true;
      continue;
    }
    const str = raw.replace(/\s+/g, ' ');
    const w = Math.max(0, it.width);
    const m = isMathFont(it.fontName);
    const mh = cur ? Math.max(h, cur.h) : h;
    // Gaps > ~1.2em on the same baseline are column gutters or table cells, not word spaces.
    const same =
      cur !== null && !eol && Math.abs(y - cur.y) < mh * 0.55 && x > cur.x0 - h && x - cur.x1 < mh * 1.2;

    if (same && cur) {
      if (x - cur.x1 > h * 0.15 && !cur.text.endsWith(' ') && !str.startsWith(' ')) cur.text += ' ';
      const piece = cur.text.endsWith(' ') && str.startsWith(' ') ? str.slice(1) : str;
      const s = cur.text.length;
      cur.text += piece;
      cur.runs.push({ s, e: cur.text.length, x0: x, x1: x + w, y0: y - h * 0.22, y1: y + h * 0.8, ...(m ? { m: 1 } : {}) });
      cur.x1 = Math.max(cur.x1, x + w);
      cur.h = Math.max(cur.h, h);
    } else {
      const piece = str.trimStart();
      cur = {
        text: piece,
        runs: [{ s: 0, e: piece.length, x0: x, x1: x + w, y0: y - h * 0.22, y1: y + h * 0.8, ...(m ? { m: 1 } : {}) }],
        x0: x,
        x1: x + w,
        y,
        h,
        order,
      };
      lines.push(cur);
    }
    eol = !!it.hasEOL;
  }

  for (const l of lines) {
    l.text = l.text.trimEnd();
    for (const r of l.runs) r.e = Math.min(r.e, l.text.length);
    l.runs = l.runs.filter((r) => r.e > r.s);
  }
  return lines.filter((l) => l.text);
}

function appendText(b: { text: string; runs: Run[] }, text: string, runs: Run[], sep: ' ' | '\n' | ' | ' = ' ') {
  let shift: number;
  if (sep === ' ' && /[A-Za-z]-$/.test(b.text) && /^[a-z]/.test(text)) {
    b.text = b.text.slice(0, -1);
    for (const r of b.runs) r.e = Math.min(r.e, b.text.length);
    shift = b.text.length;
    b.text += text;
  } else if (!b.text) {
    shift = 0;
    b.text = text;
  } else {
    shift = b.text.length + sep.length;
    b.text += sep + text;
  }
  for (const r of runs) b.runs.push({ ...r, s: r.s + shift, e: r.e + shift });
}

function runsBox(runs: Run[]): Box {
  let b: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const r of runs) b = union(b, r);
  return b;
}

function buildBlocks(lines: Line[]): Block[] {
  const blocks: (Block & { lastY: number })[] = [];
  let cur: (Block & { lastY: number }) | null = null;

  for (const l of lines) {
    const lb = runsBox(l.runs);
    const fits =
      cur !== null &&
      cur.lastY - l.y > 0 &&
      cur.lastY - l.y < Math.max(l.h, cur.h) * 1.75 &&
      Math.abs(l.h - cur.h) < Math.max(l.h, cur.h) * 0.3 &&
      l.x0 < cur.x1 &&
      l.x1 > cur.x0;

    if (fits && cur) {
      appendText(cur, l.text, l.runs);
      Object.assign(cur, union(cur, lb));
      cur.lastY = l.y;
      cur.lines++;
    } else {
      cur = {
        id: 0,
        kind: 'text',
        text: '',
        runs: [],
        ...lb,
        h: l.h,
        lines: 1,
        order: l.order,
        lastY: l.y,
      };
      appendText(cur, l.text, l.runs);
      blocks.push(cur);
    }
  }
  return blocks.map(({ lastY: _lastY, ...b }) => b);
}

function mergeBlocks(parts: Block[], kind: BlockKind, sep: ' ' | '\n' | ' | ' = ' '): Block {
  const sorted = [...parts].sort((a, b) => a.order - b.order);
  const out: Block = {
    id: 0,
    kind,
    text: '',
    runs: [],
    ...boxOf(sorted[0]),
    h: Math.max(...sorted.map((p) => p.h)),
    lines: sorted.reduce((n, p) => n + p.lines, 0),
    order: sorted[0].order,
  };
  for (const p of sorted) {
    appendText(out, p.text, p.runs, sep);
    Object.assign(out, union(out, p));
  }
  return out;
}

/** Union-find over `items` where `link(a, b)` says two items belong together. */
function components<T>(items: T[], link: (a: T, b: T) => boolean): T[][] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) if (link(items[i], items[j])) parent[find(i)] = find(j);
  return groupBy(items, find);
}

function groupBy<T>(items: T[], find: (i: number) => number): T[][] {
  const groups = new Map<number, T[]>();
  items.forEach((it, i) => {
    const r = find(i);
    let g = groups.get(r);
    if (!g) groups.set(r, (g = []));
    g.push(it);
  });
  return [...groups.values()];
}

/**
 * Union-find of boxes that intersect (with padding), using a uniform grid so it stays ~linear.
 * Handwritten/vector-ink pages can have tens of thousands of strokes; O(n²) would freeze the tab.
 */
function boxComponents<T extends Box>(items: T[], pad: number, cell = 48): T[][] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const grid = new Map<number, number[]>();
  const key = (cx: number, cy: number) => cx * 100003 + cy;
  items.forEach((b, i) => {
    const cx0 = Math.floor((b.x0 - pad) / cell);
    const cx1 = Math.floor((b.x1 + pad) / cell);
    const cy0 = Math.floor((b.y0 - pad) / cell);
    const cy1 = Math.floor((b.y1 + pad) / cell);
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cy = cy0; cy <= cy1; cy++) {
        const k = key(cx, cy);
        let bucket = grid.get(k);
        if (!bucket) grid.set(k, (bucket = []));
        // Comparing against a bounded number of recent neighbours keeps dense cells cheap.
        for (let n = bucket.length - 1, seen = 0; n >= 0 && seen < 24; n--, seen++) {
          const j = bucket[n];
          if (find(i) !== find(j) && intersects(b, items[j], pad)) parent[find(i)] = find(j);
        }
        bucket.push(i);
      }
  });
  return groupBy(items, find);
}

function classifyText(blocks: Block[]) {
  const sizes = blocks.flatMap((b) => Array(Math.min(b.text.length, 400)).fill(b.h) as number[]).sort((a, b) => a - b);
  const bodyH = sizes[Math.floor(sizes.length / 2)] ?? 10;
  for (const b of blocks) {
    if (CAPTION.test(b.text)) b.kind = 'caption';
    else if (
      b.lines <= 2 &&
      b.text.length < 120 &&
      !/[.,;:]$/.test(b.text) &&
      (b.h > bodyH * 1.15 || (/^(\d+(\.\d+)*\.?|[IVX]+\.|[A-Z]\.)\s+[A-Z]/.test(b.text) && b.text.length < 80))
    )
      b.kind = 'heading';
    else if (b.text.length < 500) {
      const sc = mathScore(b.text, b.runs);
      if (isMathy(sc, true) || (EQ_NUMBER.test(b.text) && isMathy(sc))) b.kind = 'math';
    }
  }
  return bodyH;
}

/** Display equations get split by sub/superscripts, wide spacing and equation numbers — glue them back. */
function mergeMath(blocks: Block[]): Block[] {
  const cand = blocks.filter((b) => b.kind === 'math' || (b.kind === 'text' && b.lines <= 1 && b.text.length <= 160));
  const rest = blocks.filter((b) => !cand.includes(b));
  const out = [...rest];
  for (const g of components(cand, (a, b) => {
    const h = Math.max(a.h, b.h);
    if (a.kind === 'math' && b.kind === 'math') return vGap(a, b) < h * 0.9 && hGap(a, b) < h * 4;
    if (a.kind === 'math' || b.kind === 'math') {
      const other = a.kind === 'math' ? b : a;
      // Same row as the math: short bits (eq. numbers, "where") may sit far away; longer text must be adjacent.
      const reach = other.text.length <= 8 ? h * 25 : h * 4;
      return vOverlap(a, b) > Math.min(a.y1 - a.y0, b.y1 - b.y0) * 0.4 && hGap(a, b) < reach;
    }
    return false;
  })) {
    if (g.some((b) => b.kind === 'math')) out.push(g.length > 1 ? mergeBlocks(g, 'math') : g[0]);
    else out.push(...g);
  }
  return out;
}

/** Vector-graphics / image regions from the operator list (charts, diagrams, photos, ruled tables). */
function graphicRegions(fnArray: number[], argsArray: unknown[][], view: PageData['view']): Box[] {
  const pageArea = (view[2] - view[0]) * (view[3] - view[1]);
  const stack: Mat[] = [];
  let ctm: Mat = [1, 0, 0, 1, 0, 0];
  const marks: (Box & { img: boolean })[] = [];
  const skipAfter = new Set<number>([OPS.endPath, OPS.clip, OPS.eoClip]);
  const imageOps = new Set<number>([
    OPS.paintImageXObject,
    OPS.paintInlineImageXObject,
    OPS.paintImageMaskXObject,
    OPS.paintImageXObjectRepeat,
    OPS.paintSolidColorImageMask,
  ]);

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, args as Mat);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm);
      if (Array.isArray(args?.[0]) && (args[0] as number[]).length === 6) ctm = mul(ctm, args[0] as Mat);
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.constructPath) {
      if (skipAfter.has(fnArray[i + 1])) continue;
      const mm = args?.[2] as ArrayLike<number> | undefined;
      if (!mm || !Number.isFinite(mm[0]) || !Number.isFinite(mm[3])) continue;
      marks.push({ ...transformBox(ctm, mm[0], mm[1], mm[2], mm[3]), img: false });
    } else if (imageOps.has(fn)) {
      marks.push({ ...transformBox(ctm, 0, 0, 1, 1), img: true });
    }
  }

  const usable = marks.filter((m) => area(m) < pageArea * 0.7);
  const regions: Box[] = [];
  for (const g of boxComponents(usable, 6)) {
    const box = g.reduce<Box>(union, g[0]);
    const w = box.x1 - box.x0;
    const h = box.y1 - box.y0;
    const bigImage = g.some((m) => m.img && area(m) >= 1600);
    if (area(box) > pageArea * 0.85) continue;
    if (bigImage || (g.length >= 4 && w >= 50 && h >= 35)) regions.push(box);
  }
  return regions;
}

/** Many short, grid-aligned fragments = a table (or labels of an undetected chart). */
function clusterTables(blocks: Block[]): Block[] {
  const frag = blocks.filter((b) => (b.kind === 'text' || b.kind === 'heading') && b.lines === 1 && b.text.length <= 40);
  const rest = blocks.filter((b) => !frag.includes(b));
  const out = [...rest];
  for (const g of components(frag, (a, b) => {
    const h = Math.max(a.h, b.h);
    const sameRow = vOverlap(a, b) > Math.min(a.y1 - a.y0, b.y1 - b.y0) * 0.5 && hGap(a, b) < h * 8;
    const sameCol = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0 && vGap(a, b) < h * 1.6;
    return sameRow || sameCol;
  })) {
    const cols = new Set(g.map((b) => Math.round(b.x0 / 12)));
    const rows = new Set(g.map((b) => Math.round(b.y0 / 6)));
    if (g.length >= 6 && cols.size >= 2 && rows.size >= 2) {
      const ordered = [...g].sort((a, b) => (Math.abs(a.y0 - b.y0) < a.h * 0.5 ? a.x0 - b.x0 : b.y0 - a.y0));
      const t = mergeBlocks(ordered.map((b, i) => ({ ...b, order: i })), 'table', ' | ');
      t.order = Math.min(...g.map((b) => b.order));
      out.push(t);
    } else out.push(...g);
  }
  return out;
}

function absorbIntoRegions(blocks: Block[], regions: Box[]): Block[] {
  let rest = blocks;
  const out: Block[] = [];
  for (const r of regions) {
    const inside = rest.filter((b) => b.kind !== 'caption' && b.text.length <= 400 && centerIn(b, r, 4));
    rest = rest.filter((b) => !inside.includes(b));
    const labels = inside.length ? mergeBlocks(inside, 'figure', ' | ') : null;
    out.push({
      id: 0,
      kind: 'figure',
      text: labels?.text ?? '',
      runs: labels?.runs ?? [],
      ...(labels ? union(r, labels) : r),
      h: labels?.h ?? 10,
      lines: labels?.lines ?? 0,
      order: labels?.order ?? Infinity,
    });
  }
  // Tables found by text clustering that overlap a drawn region join it.
  for (const b of out) {
    const tables = rest.filter((t) => t.kind === 'table' && intersects(t, b));
    if (!tables.length) continue;
    rest = rest.filter((t) => !tables.includes(t));
    const merged = mergeBlocks([b.text ? b : { ...b, order: Infinity }, ...tables].filter((x) => x.text), 'table', ' | ');
    Object.assign(b, merged, union(b, merged), { kind: 'table' });
  }
  return [...rest, ...out];
}

function linkCaptions(blocks: Block[]) {
  const caps = blocks.filter((b) => b.kind === 'caption');
  for (const v of blocks.filter((b) => b.kind === 'figure' || b.kind === 'table')) {
    let best: Block | undefined;
    let bestD = 40;
    for (const c of caps) {
      const d = vGap(c, v);
      if (d < bestD && hGap(c, v) < 20) {
        best = c;
        bestD = d;
      }
    }
    if (best) {
      v.caption = best.text;
      if (/^(Table|Tab\.)/i.test(best.text)) v.kind = 'table';
      if (!Number.isFinite(v.order)) v.order = best.order - 0.5;
    }
  }
}

export function finalize(page: number, blocks: Block[], view: PageData['view'], ocr = false): PageData {
  blocks.sort((a, b) => a.order - b.order || b.y1 - a.y1);
  blocks.forEach((b, i) => {
    b.id = i;
    if (!Number.isFinite(b.order)) b.order = i;
  });
  const text = blocks
    .map((b) =>
      b.kind === 'figure' || b.kind === 'table'
        ? `[${b.kind === 'table' ? 'Table' : 'Figure'}${b.caption ? `: ${b.caption}` : ''}${b.text ? ` — labels: ${b.text.slice(0, 300)}` : ''}]`
        : b.text,
    )
    .join('\n\n');
  const plain = blocks.filter((b) => b.kind !== 'figure').map((b) => b.text).join('');
  return { v: EXTRACT_VERSION, page, text, blocks, hasText: plain.replace(/\s/g, '').length > 25, view, ...(ocr ? { ocr } : {}) };
}

export async function extractPage(page: PDFPageProxy): Promise<PageData> {
  const view = page.view as PageData['view'];
  // The operator list gives us drawn graphics *and* loads font objects (needed for real font names).
  const opList = await page.getOperatorList().catch(() => null);
  const tc = await page.getTextContent();
  const fontCache = new Map<string, boolean>();
  const isMathFont = (id: string) => {
    let v = fontCache.get(id);
    if (v === undefined) {
      let name = '';
      try {
        if (page.commonObjs.has(id)) name = (page.commonObjs.get(id) as { name?: string })?.name ?? '';
      } catch {
        /* font not loaded */
      }
      v = MATH_FONT.test(name);
      fontCache.set(id, v);
    }
    return v;
  };

  let blocks = buildBlocks(buildLines(tc.items.filter(isTextItem), isMathFont));
  classifyText(blocks);
  blocks = mergeMath(blocks);
  const regions = opList ? graphicRegions(opList.fnArray, opList.argsArray as unknown[][], view) : [];
  blocks = absorbIntoRegions(clusterTables(blocks), regions);
  linkCaptions(blocks);
  return finalize(page.pageNumber, blocks, view);
}

export { runsBox, appendText };
