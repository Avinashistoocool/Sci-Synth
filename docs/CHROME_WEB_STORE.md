# Chrome Web Store publishing checklist

Status: not published. Use this checklist when you publish Sci-Synth.

## 1. Developer account

1. Sign in at <https://chrome.google.com/webstore/devconsole> with the Google account that will own the item.
2. Pay the one-time registration fee (USD 5).
3. Verify the contact email address. Optional: set up a group publisher.

## 2. Build the package

```powershell
npm ci
npm run build
Compress-Archive -Path dist\* -DestinationPath sci-synth-1.0.0.zip -Force
```

- Zip the **contents** of `dist/`, so that `manifest.json` is at the root of the zip.
- Increase `version` in `public/manifest.json` (and `package.json`) for every upload.
- Do not commit the zip (`*.zip` is in `.gitignore`).
- Load `dist/` unpacked once more and test it before you upload.

## 3. Store listing

| Item | Requirement | State |
| --- | --- | --- |
| Name | "Sci-Synth" | Ready |
| Short description | Up to 132 characters; the manifest description is used | Ready |
| Detailed description | What it does, the opt-in viewer, BYO AI key, no analytics | To write (use the README) |
| Icon | 128x128 PNG | `public/icons/icon128.png` (simple generated icon; consider a designed one) |
| Screenshots | 1 to 5, 1280x800 or 640x400 | To do (real screenshots of the viewer and settings) |
| Small promo tile | 440x280 PNG | To do |
| Category | Education or Productivity | To choose |
| Language | English | Ready |
| Homepage | <https://avinashistoocool.github.io/Sci-Synth/> | Ready |
| Support URL | <https://github.com/Avinashistoocool/Sci-Synth/issues> | Ready |

## 4. Single purpose

Suggested statement:

> Sci-Synth is a PDF reader that explains the content of scientific PDFs. The user opens a PDF in the Sci-Synth viewer and points at text, equations, figures or scanned regions; Sci-Synth sends that part to the AI provider that the user configured and shows the explanation.

## 5. Permission justifications

| Permission | Justification to enter |
| --- | --- |
| `storage` | Stores the user's settings and AI provider key locally. |
| `unlimitedStorage` | Caches extracted text, answers and notes for large PDFs in IndexedDB. |
| `contextMenus` | Adds "Open in Sci-Synth" to PDF links and PDF pages. |
| `activeTab` | Reads the current tab's address when the user clicks the toolbar icon, to open that PDF in the viewer. |
| `webRequest` (optional) | Requested only when the user adds a site to "Sites that open in Sci-Synth". Detects PDF responses from those sites to open them in the viewer. Not used otherwise. |
| Host access `http://*/*`, `https://*/*` (optional) | Requested per site at run time: the user's AI provider endpoint, a PDF site that blocks cross-origin reads, an allowlisted site, or the local simulator. |
| Remote code | No. All JavaScript, PDF.js, Tesseract workers, WASM and language data are bundled. |

## 6. Privacy practices (data-use disclosures)

- Data types to declare:
  - **Website content**: PDF text and images are sent to the user's AI provider.
  - **Authentication information**: the user enters their own API key. It is stored locally and sent only to that provider.
- Certify that data is not sold, not used for purposes unrelated to the single purpose, and not used for creditworthiness.
- Privacy policy URL: <https://avinashistoocool.github.io/Sci-Synth/privacy.html> (source: `docs/PRIVACY.md`).

## 7. Remote code policy

- Manifest V3 forbids remotely hosted code. Sci-Synth bundles all code. PDF.js and Tesseract (worker, core WASM, English data) are copied into `dist/` by `vite.config.ts`.
- The CSP `script-src 'self' 'wasm-unsafe-eval'` is allowed in MV3; it permits bundled WASM, not remote scripts.
- PDF.js runs with `isEvalSupported: false`.
- Calls to AI providers send data and receive text. They do not load code.

## 8. Review

- Typical review takes from a few days to about three weeks. Items with broad host access or `webRequest` can take longer.
- Answer reviewer email from the developer account address.

## 9. Rejection risks and remaining changes

| Risk | Mitigation in 1.0.0 | Remaining |
| --- | --- | --- |
| Broad host permissions | No required host access; `http://*/*` and `https://*/*` are optional and requested per site. | Be ready to explain the per-site requests. Consider listing the common provider hosts explicitly. |
| `webRequest` | Optional; requested only for the allowlist. | If the reviewer objects, remove the allowlist feature and the `webRequest` entry; the toolbar and menu still work. |
| Taking over the PDF viewer | Not done; the built-in viewer stays the default. | None. |
| Simulator | Not part of the extension package; the feature is hidden unless the user sets a local URL. The backend runs a fixed SciPy solver on a validated JSON spec and never executes model-written code. | Mention it in the description only as an optional local developer tool, or not at all. |
| Missing assets | – | Screenshots (1280x800), 440x280 promo tile, detailed description. |
| Icon quality | Simple generated icon. | Optional: replace with a designed icon. |

## 10. After publication

- Update the project page and the README: replace "Chrome Web Store: coming soon" with the store link.
- Keep `docs/PRIVACY.md` and `docs/privacy.html` the same.
