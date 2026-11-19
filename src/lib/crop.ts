import type { PDFPageProxy } from 'pdfjs-dist';
import type { ChatImage } from './llm';
import type { Box } from './extract';

const TARGET_LONG_SIDE = 1100;
const MAX_SCALE = 5;
const MIN_SCALE = 1.5;

/** Renders just `box` (PDF user space) of a page to a PNG, sized for vision models. */
export async function cropRegion(page: PDFPageProxy, box: Box, pad = 6): Promise<ChatImage> {
  const [vx0, vy0, vx1, vy1] = page.view;
  const b = {
    x0: Math.max(vx0, box.x0 - pad),
    y0: Math.max(vy0, box.y0 - pad),
    x1: Math.min(vx1, box.x1 + pad),
    y1: Math.min(vy1, box.y1 + pad),
  };
  const w = Math.max(1, b.x1 - b.x0);
  const h = Math.max(1, b.y1 - b.y0);
  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, TARGET_LONG_SIDE / Math.max(w, h)));
  const vp = page.getViewport({ scale });
  const [ax, ay] = vp.convertToViewportPoint(b.x0, b.y1);
  const [bx, by] = vp.convertToViewportPoint(b.x1, b.y0);
  const left = Math.min(ax, bx);
  const top = Math.min(ay, by);
  const cw = Math.ceil(Math.abs(bx - ax));
  const ch = Math.ceil(Math.abs(by - ay));

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cw, ch);
  await page.render({ canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, -left, -top] }).promise;

  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('crop failed'))), 'image/png'));
  canvas.width = canvas.height = 0;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { mime: 'image/png', base64: btoa(bin) };
}
