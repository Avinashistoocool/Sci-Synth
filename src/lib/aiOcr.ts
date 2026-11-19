import type { PDFPageProxy } from 'pdfjs-dist';
import { finalize, type Block, type BlockKind, type PageData, type Run } from './extract';
import { completeChat, type ChatImage } from './llm';
import type { Settings } from './settings';

const LONG_SIDE = 1600;

const SYSTEM =
  'You are a precise OCR engine for scanned, photographed and handwritten documents (lecture notes, textbooks, papers). You transcribe exactly what is written and return strict JSON.';

const USER = `Transcribe this page image.

Return ONLY a JSON object, no markdown fences, no commentary:
{"blocks":[{"type":"heading|text|math|figure|table","text":"...","box":[ymin,xmin,ymax,xmax]}]}

Rules:
- One block per paragraph, heading, displayed equation, figure/diagram, or table, in reading order.
- "box" is the block's bounding box on the image, integers normalised to 0–1000 ([ymin, xmin, ymax, xmax]).
- Keep the original line breaks inside a block as "\\n".
- Write all mathematics in LaTeX. Inline math inside text as $...$. For type "math", "text" is the LaTeX only (no $).
- For "figure": a one-sentence description of the diagram followed by its labels/annotations.
- For "table": rows separated by "\\n", cells by " | ".
- Transcribe faithfully; do not correct, summarise or translate. Use [illegible] for unreadable parts.
- Skip page numbers, scanner watermarks and ruled-paper lines.`;

interface RawBlock {
  type?: string;
  text?: string;
  box?: number[];
}

async function renderJpeg(page: PDFPageProxy) {
  const base = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: LONG_SIDE / Math.max(base.width, base.height) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp, annotationMode: 0 }).promise;
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('render failed'))), 'image/jpeg', 0.85),
  );
  const w = canvas.width;
  const h = canvas.height;
  canvas.width = canvas.height = 0;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const image: ChatImage = { mime: 'image/jpeg', base64: btoa(bin) };
  return { image, vp, w, h };
}

function parseBlocks(raw: string): RawBlock[] {
  const s = raw.indexOf('{');
  const e = raw.lastIndexOf('}');
  if (s < 0 || e <= s) throw new Error('AI OCR returned no JSON');
  let j: { blocks?: RawBlock[] };
  try {
    j = JSON.parse(raw.slice(s, e + 1));
  } catch {
    // Models sometimes leave raw backslashes from LaTeX unescaped – escape lone ones and retry.
    j = JSON.parse(raw.slice(s, e + 1).replace(/\\(?!["\\/bfnrtu])/g, '\\\\'));
  }
  if (!Array.isArray(j.blocks)) throw new Error('AI OCR JSON has no "blocks"');
  return j.blocks.filter((b) => typeof b.text === 'string' && b.text.trim());
}

const KINDS: Record<string, BlockKind> = { heading: 'heading', text: 'text', math: 'math', figure: 'figure', table: 'table' };

/** Transcribes a scanned/handwritten page with the user's vision model. */
export async function aiTranscribePage(page: PDFPageProxy, settings: Settings, signal?: AbortSignal): Promise<PageData> {
  const { image, vp, w, h } = await renderJpeg(page);
  const raw = await completeChat(settings, { system: SYSTEM, user: USER, image, maxTokens: 4000, signal });
  const parsed = parseBlocks(raw);

  const validBoxes = parsed.every(
    (b) => Array.isArray(b.box) && b.box.length === 4 && b.box.every((n) => Number.isFinite(n)) && b.box[2] > b.box[0] && b.box[3] > b.box[1],
  );
  const toPdf = (px: number, py: number) => vp.convertToPdfPoint(px, py) as number[];

  const blocks: Block[] = parsed.map((rb, i) => {
    // Without usable boxes, stack blocks evenly down the page so hovering still maps to something sensible.
    const [ymin, xmin, ymax, xmax] = validBoxes
      ? rb.box!.map((n) => Math.max(0, Math.min(1000, n)))
      : [60 + (880 * i) / parsed.length, 60, 60 + (880 * (i + 1)) / parsed.length, 940];
    const [ax, ay] = toPdf((xmin / 1000) * w, (ymin / 1000) * h);
    const [bx, by] = toPdf((xmax / 1000) * w, (ymax / 1000) * h);
    const box = { x0: Math.min(ax, bx), x1: Math.max(ax, bx), y0: Math.min(ay, by), y1: Math.max(ay, by) };

    const kind = KINDS[rb.type ?? 'text'] ?? 'text';
    const lines = rb.text!.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
    let text = '';
    const runs: Run[] = [];
    const lh = (box.y1 - box.y0) / Math.max(1, lines.length);
    lines.forEach((l, li) => {
      if (text) text += kind === 'table' || kind === 'math' ? '\n' : ' ';
      const s = text.length;
      text += l;
      // Approximate each line as an even horizontal slice of the block.
      runs.push({ s, e: text.length, x0: box.x0, x1: box.x0 + (box.x1 - box.x0) * Math.min(1, l.length / Math.max(...lines.map((x) => x.length))), y1: box.y1 - li * lh, y0: box.y1 - (li + 1) * lh });
    });
    return {
      id: 0,
      kind,
      text: kind === 'math' ? `$$${text}$$` : text,
      runs: kind === 'math' ? runs.map((r) => ({ ...r, s: r.s + 2, e: r.e + 2 })) : runs,
      ...box,
      h: lh,
      lines: lines.length,
      order: i,
      conf: 95,
    };
  });

  const out = finalize(page.pageNumber, blocks, page.view as PageData['view'], true);
  out.ai = true;
  out.ocrConf = 95;
  return out;
}
