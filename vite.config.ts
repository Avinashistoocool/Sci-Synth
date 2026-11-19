import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { cpSync, readdirSync } from 'node:fs';

const copyPdfjsAssets = () => ({
  name: 'copy-pdfjs-assets',
  closeBundle() {
    const nm = (p: string) => resolve(__dirname, 'node_modules', p);
    const out = (p: string) => resolve(__dirname, 'dist', p);
    for (const d of ['cmaps', 'standard_fonts']) cpSync(nm(`pdfjs-dist/${d}`), out(d), { recursive: true });
    // Tesseract OCR runs fully offline from bundled assets (no CDN).
    cpSync(nm('tesseract.js/dist/worker.min.js'), out('tesseract/worker.min.js'));
    for (const f of readdirSync(nm('tesseract.js-core')).filter((f) => /^tesseract-core.*\.(wasm|wasm\.js)$/.test(f)))
      cpSync(nm(`tesseract.js-core/${f}`), out(`tesseract/core/${f}`));
    cpSync(nm('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'), out('tesseract/lang/eng.traineddata.gz'));
  },
});

export default defineConfig({
  plugins: [react(), copyPdfjsAssets()],
  base: './',
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16)) },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    modulePreload: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        viewer: resolve(__dirname, 'viewer.html'),
        options: resolve(__dirname, 'options.html'),
        background: resolve(__dirname, 'src/background.ts'),
      },
      output: {
        entryFileNames: (c) => (c.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
});
