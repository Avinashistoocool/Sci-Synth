# Architecture and data flow

Sci-Synth builds a Manifest V3 extension with a background service worker, settings page, and PDF viewer.
An optional local FastAPI backend in `simulator/backend/` extracts equation manifests from PDFs.
Vite writes these entry points to `dist`, and TypeScript checks the source during `npm run build`.
The build copies PDF.js maps and fonts, Tesseract workers, WASM files, and English language data.

## PDF routing and rendering

The browser's built-in PDF viewer stays the default.
`src/background.ts` provides the entry points: the toolbar action and two context-menu items (PDF link, PDF page).
`src/lib/pdfUrl.ts` decides which addresses look like PDFs.
Automatic opening is opt-in per site. Only when the user adds a site to `siteAllowlist` does the extension request
`webRequest` and host access for that site. The service worker then examines main-frame response headers and
redirects inline PDF responses from allowlisted sites only. With an empty allowlist, the extension has no `webRequest` permission.
`src/viewer/App.tsx` loads PDF URLs with PDF.js.
It sends cookies only when the user granted access to the PDF's site. Without access, a plain CORS request works for servers
that allow it; otherwise the viewer offers a per-site permission request, the built-in viewer, or a local file.
It reads uploaded or dropped PDF files from browser memory.
PDF.js renders pages in the viewer and extracts embedded text when available.

## OCR and AI requests

`src/lib/docContext.ts` extracts page content, coordinates OCR work, and prepares prompts with nearby text.
`src/lib/ocr.ts` uses bundled Tesseract assets for local, English-language OCR on scanned pages.
When enabled, `src/lib/aiOcr.ts` renders scanned pages as JPEG images and requests transcription from the configured model.
The viewer schedules the current scanned page and up to two following pages for AI transcription.
It also sends selected region images when image-based explanations are enabled.
The document brief sends sampled page text to the provider after page processing when brief creation is enabled.
Questions can include page excerpts, earlier answers, and related concept notes.
`src/lib/llm.ts` sends requests directly from the extension to the configured OpenAI-compatible, Anthropic, Gemini, or Ollama endpoint.
The extension has no project-operated AI proxy.

## Optional simulator

`src/viewer/SimulatePanel.tsx` appears only when the user sets `simBackendUrl`.
It posts the PDF bytes to `{backend}/api/extract` and shows the returned `Manifest` as JSON.
`POST /api/simulate` returns HTTP 501: the earlier prototype executed LLM-generated Python; that path is removed.
A safe declarative solver (JSON equation spec, whitelisted parser, fixed SciPy integrator) is being added in `simulator/backend/routes/simulate.py`.
The backend allows CORS from `chrome-extension://` origins and localhost only.

## Local storage and privacy

`src/lib/settings.ts` stores provider configuration and preferences in `chrome.storage.local`.
API keys are available to extension code and travel to the configured provider for authenticated requests.
`src/lib/db.ts` stores document metadata, extracted pages, document briefs, cached answers, doubt nodes, and concepts in IndexedDB.
It does not define an IndexedDB store for original PDF files.
The browser can also retain downloaded PDFs or requests according to its own behavior.
**Clear cache** deletes document, page, and answer records; it keeps notes and provider settings.
**Delete all notes** deletes doubt and concept records; it keeps cache records and provider settings.
Do not assume that requests to hosted providers remain on the device.
Use a local Ollama endpoint only when local processing meets your privacy requirements.

## Permissions

Required: `storage`, `unlimitedStorage`, `contextMenus` and `activeTab`.
`activeTab` gives the toolbar action and the menu the current tab's address when the user clicks them.
Optional: `webRequest` and host access (`http://*/*`, `https://*/*`) are declared as optional and requested at run time, per site:

- the AI provider's base URL, when the user saves the provider settings;
- the simulator backend URL, when the user saves it;
- a PDF site that blocks cross-origin reads, when the user selects **Allow access**;
- an allowlisted site, plus `webRequest`, when the user adds it.

The extension does not request `<all_urls>` or `tabs`.
Local `file://` access also requires the browser's separate **Allow access to file URLs** setting.
The extension-page content security policy permits bundled scripts and WASM execution (`wasm-unsafe-eval`). No remote code loads.
