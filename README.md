<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/sci-synth-horizontal-dark.svg">
    <img src="docs/brand/sci-synth-horizontal.svg" alt="Sci-Synth" height="72">
  </picture>
  <br><em>Hover any line of a paper. Understand it.</em>
</p>

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

`simulator/backend/` holds an optional FastAPI backend. The extension uses it only if you set **Backend URL** in the settings.
The default is empty, and then the feature is hidden.

1. **Extract equations** sends the PDF to the backend. The backend asks the Groq API for a JSON equation spec
   (state variables, parameters, right-hand sides as math expressions, initial values, time span) and validates it.
2. The viewer shows exactly the equations and parameters that will be solved, plus optional reviewer warnings.
3. **Run simulation** sends that spec back; a fixed SciPy solver integrates it and the viewer plots the result.

Run the backend only on your own computer (it binds to `127.0.0.1`). It sends the PDF text to Groq with your Groq key.

### Security model

- **Threat:** a malicious PDF can contain instructions for the LLM (prompt injection). The earlier prototype asked the
  LLM for Python and ran it, so a PDF could run commands. That path is removed; **no model-written code is executed.**
- **Enforced without any LLM:** the reply must validate as a strict JSON spec (types, sizes, ranges, no extra fields).
  Each expression is parsed with Python's `ast` and checked against an allow-list (`+ - * /`, constant powers |p| <= 10,
  numbers, declared names, `t`, `pi`, `e`, 15 math functions). Everything else (attributes, subscripts, other function
  calls, strings, lambdas, ...) gives HTTP 422. The checked tree becomes numpy closures; nothing is passed to `eval`,
  `exec` or `compile`. The solver has a 5 s time limit, an evaluation cap, `max_step`, at most 5000 output points, and
  stops on non-finite or exploding values. The server binds to `127.0.0.1`; CORS allows only extension and localhost
  origins (`SCISYNTH_EXTENSION_ID` limits it to one extension).
- **Why not a "guard" LLM that inspects generated code?** It reads the same attacker-controlled text, can itself be
  prompt-injected, is probabilistic, and can miss obfuscated payloads. Not executing model output removes the risk instead.
- **Optional reviewer LLM (`SCISYNTH_REVIEW=1`, off by default):** reads only the validated spec and returns
  plausibility warnings (units, signs) that the viewer shows. It is advisory, cannot change what runs, and is not a security control.
- **Remaining risks:** heavy compute (bounded by the limits above); a valid but wrong system, so check the shown
  equations against the paper; the PDF text goes to Groq.

See [simulator/backend/README.md](simulator/backend/README.md) for setup, tests and details.

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
