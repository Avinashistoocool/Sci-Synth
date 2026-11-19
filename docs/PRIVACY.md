# Sci-Synth privacy policy

Effective date: 19 November 2026. Applies to the Sci-Synth browser extension, version 1.0.0 and later.

## Summary

Sci-Synth has no developer server. It collects no analytics and does not track you.
The developer receives none of your data.
Sci-Synth sends PDF content only to the AI provider that you configure, and only to give you the explanations that you ask for.

## Data that Sci-Synth handles

| Data | Where it goes | Why |
| --- | --- | --- |
| Settings, including your AI provider API key | `chrome.storage.local` in your browser profile | To call the provider that you selected. |
| PDF content: text excerpts near the item that you point at, your questions, earlier answers in the same thread, sampled page text for the document brief, and (if enabled) images of a page region or a scanned page | The AI provider endpoint that you configure (for example OpenAI, Anthropic, Google Gemini, an OpenAI-compatible service, or a local Ollama server) | To create the explanations, answers, page transcriptions and the document brief. |
| Extracted page text, cached answers, document briefs, doubt notes and concept notes | IndexedDB in your browser profile | To make repeat questions fast and keep your notes. |
| The PDF file | Read by the viewer from the PDF's address or from the file that you open | To show the PDF. Sci-Synth does not store the original PDF file. |
| The PDF file (optional simulator only) | The simulator backend address that you set, normally `http://localhost` on your own computer | Only if you set a backend URL and select **Extract equations**. The backend that you run sends the PDF text to the Groq API with your own key. If you enable its optional reviewer, it also sends the extracted equation spec to Groq. |

Sci-Synth does not sell data, does not use data for advertising or credit decisions, and does not transfer data to anyone other than the services that you configure.
Your AI provider handles the data that it receives under its own privacy policy.

## Permissions

Sci-Synth asks for access to a website only when you act: when you save a provider address, allow a PDF site, add a site to **Sites that open in Sci-Synth**, or save a simulator address.
Sci-Synth does not read or change the content of web pages that you visit. The browser's built-in PDF viewer stays the default.

## Your controls

- **Clear cache** deletes cached documents, pages and answers.
- **Delete all notes** deletes doubt and concept notes.
- Remove the extension to delete all its local data, including your API key.
- Remove a site from the allowlist to give back its access.
- Data that was already sent to an AI provider stays under that provider's control.

## Security

API keys are stored in `chrome.storage.local`. This storage is not encrypted by the extension. Do not use Sci-Synth on a shared browser profile with a key that you cannot revoke.

## Children

Sci-Synth is not directed at children under 13.

## Changes and contact

Changes to this policy appear in the source repository with a new effective date.
Contact: open an issue at <https://github.com/Avinashistoocool/Sci-Synth/issues>.
