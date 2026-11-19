# Usage

## Configure the provider

1. Open the extension settings page with the toolbar gear or your browser's extensions page.
2. Select **OpenAI / OpenAI-compatible**, **Anthropic Claude**, **Google Gemini**, or **Ollama (local)**.
3. Enter the model and base URL for the selected provider.
4. Enter an API key for a hosted provider.
5. Select **Save** to store the settings. The browser asks for access to the provider's address; allow it.
6. Select **Test connection** to send a short test request.

The default provider is OpenAI, and its default model is `gpt-4o-mini`.
Each provider keeps separate model, base URL, and API key settings.
OpenAI-compatible endpoints require the correct provider URL and a compatible API.
Ollama does not require an API key, but it must accept the extension origin.

## Open a PDF

The browser's built-in PDF viewer stays the default. Sci-Synth opens a PDF only when you ask:

- Click the Sci-Synth toolbar icon on a PDF tab.
- Right-click a PDF link and select **Open in Sci-Synth**.
- Right-click on a PDF page and select **Open this PDF in Sci-Synth**.
- Click **Open PDF** in the viewer, or drop a PDF file onto the viewer.
- Enable **Allow access to file URLs** in the extension details to open `file://` PDFs directly.

The toolbar icon opens an empty viewer when the current tab does not show a recognized PDF address.
A recognized address ends in `.pdf` or has a `/pdf/<id>` path, as on arxiv.org.

### When a site blocks the viewer

Some servers do not allow cross-origin reads. Then the viewer shows three choices:

- **Allow access to *site***: the browser asks for access to that site only. Then the viewer loads the PDF with your cookies for that site.
- **Open in the built-in viewer**: go back to the browser's viewer.
- Download the PDF, then use **Open PDF**.

### Always open PDFs from a site (optional)

This option is off by default.

1. Open a PDF from the site in Sci-Synth.
2. In the **Document** panel, select **Always open PDFs from *site* in Sci-Synth**.
3. Allow the permission request (site access and `webRequest`).

You can also add or remove sites in the settings under **Sites that open in Sci-Synth**.
Sci-Synth then opens successful, inline PDF responses from those sites only.
It does not open responses marked as attachments.
When you remove the last site, Sci-Synth gives the `webRequest` permission back.

## Read and ask

1. Hold the configured trigger key and hover over content.
2. Wait for the hover delay, then read the explanation.
3. Ask a follow-up question in the explanation popover or the **Ask** panel.
4. Open **Doubts** to return to earlier questions.
5. Open **Concepts** to review the saved concept map.
6. Open **Document** to inspect page processing and the document brief.

The default trigger key is **Alt**, and the default hover delay is 250 ms.
Select **Explore** to explain content on hover without holding the trigger key.
Select text and hold the trigger key to explain the selection.
Choose **Auto**, **Word**, **Sentence**, or **Paragraph** to change the hover target.
Press **1** through **4**, or turn the wheel while holding the trigger key, to change the target.
Use the page control to jump to a page; use the zoom buttons or **Ctrl** plus the wheel to zoom.
Press **Esc** to close an explanation.

## Work with scanned pages

Quick offline OCR uses bundled English Tesseract assets when **Quick offline OCR** is enabled.
AI page transcription sends rendered images of the current scanned page and up to two following pages.
This transcription requires **Read scanned / handwritten pages with your AI model** and a configured vision model.
Select **Read with AI** in the **Document** panel to request a page transcription manually.
**Send an image** controls image-based explanations; unsupported vision requests can retry as text.
Disable AI page transcription, image-based explanations, and document briefs to avoid those automatic AI requests.
Questions and explanations still send text to the configured endpoint.

## Simulate (optional, local backend)

The earlier prototype executed LLM-generated Python; that path is removed. A safe declarative solver is being added.

1. Start the backend on your computer (see `simulator/README.md`).
2. In the settings, set **Backend URL** (for example `http://localhost:8000`) and select **Save**.
3. In the viewer, open **Document** and select **Extract equations**.

The viewer sends the PDF to `{backend}/api/extract` and shows the returned manifest: equation type, variables and time span.
**Run simulation** stays disabled until the safe solver is available.
Use the backend only with PDFs that you trust. When **Backend URL** is empty, the feature is hidden.

## Manage local data

Select **Clear cache** to remove cached documents, page data, and answers from IndexedDB.
Select **Delete all notes** to remove saved doubt trees and concept maps from IndexedDB.
These controls do not remove provider settings from `chrome.storage.local`.
They do not retract data already sent to an AI provider.

## Troubleshoot

- If local files fail to open, enable **Allow access to file URLs** in the extension details.
- If PDF loading fails, select **Allow access to *site*** or download the PDF and use **Open PDF**.
- If AI requests fail after you change the base URL, select **Save** again and allow the access request.
- If the connection test fails, check the selected provider, model, base URL, and API key.
- If image transcription fails, select a vision-capable model or disable AI page transcription.
- If old viewer tabs block the database, close those tabs and reopen the PDF.
- If a rebuild does not appear in the browser, reload the unpacked extension.
