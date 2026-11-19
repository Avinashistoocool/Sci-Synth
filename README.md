# PDF AI Explorer

PDF AI Explorer is a Manifest V3 browser extension for reading PDFs and requesting AI explanations.
It opens PDFs in an extension viewer and provides explanations for text, equations, figures, tables, and scanned regions.
It supports OpenAI-compatible endpoints, Anthropic, Google Gemini, and Ollama.
Use a model with image support for page transcription and image-based explanations.

## Requirements

- Use Microsoft Edge or a compatible Chromium browser with support for unpacked extensions.
- Install Node.js and npm to build the extension.
- Provide an API key for OpenAI-compatible, Anthropic, or Gemini services.
- Alternatively, run Ollama and configure a model on your computer.

## Build and install

1. Open a terminal in the project directory.
2. Install dependencies if they are not installed:

   ```powershell
   npm ci
   ```

3. Build the extension:

   ```powershell
   npm run build
   ```

4. Open `edge://extensions` in Edge, or open your browser's extensions page.
5. Enable **Developer mode**.
6. Select **Load unpacked** and select the `dist` directory.
7. Open the extension settings page.
8. Select a provider and enter its model, base URL, and API key when required.
9. Select **Test connection**, then select **Save**.

For Ollama, permit requests from the extension origin before testing the connection.
The settings page suggests `OLLAMA_ORIGINS=chrome-extension://*`; restrict this value when you know your extension ID.
The development command `npm run dev` rebuilds on changes; reload the unpacked extension after rebuilding.

## Use

Open a PDF in Edge to start the viewer when automatic interception is enabled.
Alternatively, click the extension icon, use **Open PDF**, or drop a PDF onto the viewer.
Hold **Alt** and hover over content to request an explanation.
Use **Explore** to request explanations on hover without holding the trigger key.
See [Usage](docs/USAGE.md) for controls, settings, and troubleshooting.
See [Architecture](docs/ARCHITECTURE.md) for processing, storage, and permissions.

## Privacy

The extension stores provider settings, including API keys, in `chrome.storage.local` in your browser profile.
Do not treat browser-profile storage as a secure vault.
The viewer fetches remote PDF URLs, with credentials enabled, from the document's origin.
PDF text excerpts, questions, document-brief samples, and optional page or region images can reach your configured AI endpoint.
Scanned-page AI transcription and document briefs are enabled by default when a provider is configured.
Bundled Tesseract performs quick OCR locally; this does not make AI requests local.
Select Ollama with a local endpoint if you require local AI processing; verify the endpoint and model configuration.
Do not share private PDFs or API keys when publishing this project.

## Project status

The source package version is `0.1.0`; the extension manifest version is `0.5.1`.
Build the extension locally and load the `dist` directory as an unpacked extension.
