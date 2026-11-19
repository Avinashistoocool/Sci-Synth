import { RenderingCancelledException, TextLayer, type PDFDocumentProxy } from 'pdfjs-dist';
import { memo, useEffect, useRef, useState } from 'react';

interface Props {
  pdf: PDFDocumentProxy;
  pageNum: number;
  scale: number;
  baseSize: { w: number; h: number };
  ocr?: 'AI' | 'OCR';
}

function PageViewImpl({ pdf, pageNum, scale, baseSize, ocr }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const textHost = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [size, setSize] = useState(baseSize);

  useEffect(() => {
    const el = rootRef.current!;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), {
      root: el.closest('.scroll'),
      rootMargin: '1200px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) {
      canvasHost.current?.replaceChildren();
      textHost.current?.replaceChildren();
      return;
    }
    let cancelled = false;
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | null = null;
    let textLayer: TextLayer | null = null;

    (async () => {
      const page = await pdf.getPage(pageNum);
      if (cancelled) return;
      const vp = page.getViewport({ scale });
      const raw = page.getViewport({ scale: 1 });
      setSize({ w: raw.width, h: raw.height });

      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = `${vp.width}px`;
      canvas.style.height = `${vp.height}px`;
      renderTask = page.render({
        canvasContext: canvas.getContext('2d', { alpha: false })!,
        viewport: vp,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      await renderTask.promise;
      if (cancelled) return;
      canvasHost.current!.replaceChildren(canvas);

      const tl = document.createElement('div');
      tl.className = 'textLayer';
      textLayer = new TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport: vp });
      await textLayer.render();
      if (cancelled) return;
      textHost.current!.replaceChildren(tl);
    })().catch((e) => {
      if (!(e instanceof RenderingCancelledException) && !cancelled) console.warn(`page ${pageNum}:`, e);
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [visible, scale, pdf, pageNum]);

  return (
    <div
      ref={rootRef}
      className="page"
      data-page={pageNum}
      style={
        {
          width: size.w * scale,
          height: size.h * scale,
          '--scale-factor': scale,
        } as React.CSSProperties
      }
    >
      <div ref={canvasHost} className="canvas-host" />
      <div ref={textHost} className="text-host" />
      {!visible && <div className="page-num-placeholder">{pageNum}</div>}
      {ocr && (
        <div className={`ocr-badge ${ocr === 'AI' ? 'ai' : ''}`} title={ocr === 'AI' ? 'Transcribed by your AI model' : 'Quick OCR text'}>
          {ocr}
        </div>
      )}
    </div>
  );
}

export const PageView = memo(PageViewImpl);
