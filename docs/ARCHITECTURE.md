# Architecture and data flow

PDF AI Explorer builds a Manifest V3 extension with a background service worker, settings page, and PDF viewer.
Vite writes these entry points to `dist`, and TypeScript checks the source during `npm run build`.
The build copies PDF.js maps and fonts, Tesseract workers, WASM files, and English language data.

## PDF routing and rendering

`src/background.ts` examines main-frame PDF response headers and redirects eligible tabs to `viewer.html`.
It also detects local `.pdf` tab URLs when the browser permits extension access to local files.
The toolbar action and PDF-link context menu provide manual entry points.
`src/viewer/App.tsx` loads PDF URLs with PDF.js and uses credentialed requests for URL-based PDFs.
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

The manifest requests `storage` for settings and `unlimitedStorage` for extension storage.
It requests `webRequest` to inspect main-frame response headers for PDF detection.
It requests `tabs` to open or redirect PDF tabs and `contextMenus` for PDF-link actions.
The manifest requests `<all_urls>` host access for PDF URLs and configured provider endpoints.
This broad host access can expose browsing URLs and response headers to the extension's PDF detection logic.
Local `file://` access also requires the browser's separate **Allow access to file URLs** setting.
The extension-page content security policy permits bundled scripts and WASM execution.
