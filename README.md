# Sci-Synth

Sci-Synth is a Manifest V3 browser extension that helps you read scientific PDFs.
Open a PDF in the Sci-Synth viewer, then hold **Alt** and point at a word, sentence, equation, figure, table or scanned region.
Sci-Synth sends that part of the page to the AI provider that you configure and shows the explanation next to it.
It supports OpenAI-compatible endpoints, Anthropic, Google Gemini and a local Ollama server.

Project page: <https://avinashistoocool.github.io/Sci-Synth/>
Privacy policy: <https://avinashistoocool.github.io/Sci-Synth/privacy.html>

## The built-in PDF viewer stays the default

Sci-Synth does not take over PDFs.
The browser's own PDF viewer opens every PDF until you choose otherwise.
To open a PDF in Sci-Synth, do one of these:

- On a PDF tab, click the Sci-Synth toolbar icon.
- Right-click a PDF link and select **Open in Sci-Synth**.
- Right-click on a PDF page and select **Open this PDF in Sci-Synth**.
- In the viewer, click **Open PDF** or drop a PDF file onto it.
- Optional: add a site to **Sites that open in Sci-Synth** in the settings, or select **Always open PDFs from this site in Sci-Synth** in the viewer's **Document** panel. This is off by default and applies only to the sites that you add.

## Install from source

Requirements: Node.js 20 or later with npm, and Chrome, Edge or another Chromium browser.

```powershell
npm ci
npm run build
```

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. Select **Load unpacked** and select the `dist` folder.
4. Open the Sci-Synth settings (right-click the toolbar icon → **Options**).
5. Select a provider. Enter the model, the base URL and, for hosted providers, an API key.
6. Select **Save**. The browser asks for access to the provider's address. Allow it.
7. Select **Test connection**.

For Ollama, start it with `OLLAMA_ORIGINS=chrome-extension://*` (or your extension ID) so that the extension can call it.
`npm run dev` rebuilds on every change. Reload the unpacked extension after each rebuild.
`npm run typecheck` runs the TypeScript checks only.

## Permissions and why

| Permission | Type | Why |
| --- | --- | --- |
| `storage` | required | Stores your settings and API key in `chrome.storage.local`. |
| `unlimitedStorage` | required | Caches extracted page text, answers and notes in IndexedDB for large PDFs. |
| `contextMenus` | required | Adds **Open in Sci-Synth** to PDF links and PDF pages. |
| `activeTab` | required | Lets the toolbar icon and the menu read the address of the current tab when you click them. |
| `webRequest` | optional | Requested only when you add a site to the allowlist. It detects PDF responses from those sites. |
| host access (`http://*/*`, `https://*/*`) | optional | Requested per site, only when you need it: your AI provider's address when you save it, a PDF site that blocks cross-origin reads, a site that you add to the allowlist, or the local simulator address. |

Sci-Synth does not request `<all_urls>` or `tabs`.
Without optional permissions, it reads PDFs from servers that allow cross-origin reads (for example arxiv.org) and from files that you open or drop.
For other servers, the viewer shows **Allow access to *site***, **Open in the built-in viewer**, or the option to download the PDF and open the file.
To open `file://` PDFs from the address bar, enable **Allow access to file URLs** in the extension details.

## Privacy

- Sci-Synth has no developer server, no analytics and no tracking.
- Your API key and settings stay in `chrome.storage.local` in your browser profile. This is not an encrypted vault.
- PDF text excerpts, your questions, document-brief samples and, if enabled, page or region images go only to the AI provider that you configure.
- Cached text, answers and notes stay in IndexedDB on your computer. **Clear cache** and **Delete all notes** remove them.
- Quick OCR runs locally with bundled Tesseract. PDF.js and Tesseract are bundled; the extension loads no remote code.

Read the full [privacy policy](docs/PRIVACY.md).

## Optional: Simulate (local backend)

> **Security note.** The earlier prototype executed LLM-generated Python; that path is removed. A safe declarative solver is being added.
> `POST /api/simulate` now returns HTTP 501. No LLM-generated code is executed.

`simulator/backend/` holds an optional FastAPI backend from the earlier Sci-Synth prototype.
Today it only extracts an equation manifest (equation type, variables, time span) from a PDF with the Groq API.
The extension uses it only if you set **Backend URL** in the settings. The default is empty, and then the feature is hidden.

- Run the backend only on your own computer (it binds to `127.0.0.1`) and only with PDFs that you trust.
- The backend sends the PDF text to Groq with your Groq key.
- CORS allows only `chrome-extension://` origins and `http://localhost` / `http://127.0.0.1`. Set `SCISYNTH_EXTENSION_ID` to allow only your extension.

See [simulator/README.md](simulator/README.md) for setup.

The earlier Next.js frontend is not part of this repository any more. The extension replaces it.
Its sanitized source remains on the branch `docs/ste100-sanitized-source`.

## Documentation

- [Usage](docs/USAGE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Privacy policy](docs/PRIVACY.md)
- [Chrome Web Store checklist](docs/CHROME_WEB_STORE.md)

## Status

Version 1.0.0. Install from source. Chrome Web Store: not published yet.
This repository merges the former `pdf-ai-explorer` extension (history kept) with the Sci-Synth simulation prototype.
