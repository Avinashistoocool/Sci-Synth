# Usage

## Configure the provider

1. Open the extension settings page with the toolbar gear or your browser's extensions page.
2. Select **OpenAI / OpenAI-compatible**, **Anthropic Claude**, **Google Gemini**, or **Ollama (local)**.
3. Enter the model and base URL for the selected provider.
4. Enter an API key for a hosted provider.
5. Select **Test connection** to send a short test request.
6. Select **Save** to store the settings.

The default provider is OpenAI, and its default model is `gpt-4o-mini`.
Each provider keeps separate model, base URL, and API key settings.
OpenAI-compatible endpoints require the correct provider URL and a compatible API.
Ollama does not require an API key, but it must accept the extension origin.

## Open a PDF

- Open an HTTP or HTTPS PDF in a tab when **Open PDFs in AI Explorer automatically** is enabled.
- Click the extension icon on a PDF tab, or select **Open PDF in AI Explorer** on a PDF link.
- Click **Open PDF** in the viewer, or drop a PDF file onto the viewer.
- Enable **Allow access to file URLs** in the extension details to open `file://` PDFs directly.

Automatic interception applies to successful, inline main-frame PDF responses.
It also recognizes `.pdf` URLs returned as `application/octet-stream`.
It does not intercept responses marked as attachments.
The extension icon opens an empty viewer when the current tab does not contain a recognized PDF URL.

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

## Manage local data

Select **Clear cache** to remove cached documents, page data, and answers from IndexedDB.
Select **Delete all notes** to remove saved doubt trees and concept maps from IndexedDB.
These controls do not remove provider settings from `chrome.storage.local`.
They do not retract data already sent to an AI provider.

## Troubleshoot

- If local files fail to open, enable **Allow access to file URLs** in the extension details.
- If PDF loading fails, check access to the PDF URL and its server's cross-origin behavior.
- If the connection test fails, check the selected provider, model, base URL, and API key.
- If image transcription fails, select a vision-capable model or disable AI page transcription.
- If old viewer tabs block the database, close those tabs and reopen the PDF.
- If a rebuild does not appear in the browser, reload the unpacked extension.
