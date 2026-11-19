# Sci-Synth simulator backend (optional, local)

> **Security note.** The earlier prototype executed LLM-generated Python; that path is removed. A safe declarative solver is being added.
> `POST /api/simulate` returns HTTP 501 with the message "Simulation is disabled pending a safe solver (no LLM-generated code is executed)".

This FastAPI backend is optional. The Sci-Synth extension works without it.

## Endpoints

| Method and path | Result |
| --- | --- |
| `POST /api/extract` | Accepts a PDF (`multipart/form-data`, field `file`, 20 MB limit). Extracts its text with `pypdf`, asks Groq for an equation manifest, and returns the manifest as JSON. |
| `POST /api/simulate` | Returns HTTP 501. Reserved for the safe solver. |
| `GET /health` | Returns `{"status": "ok", "simulate": "disabled"}`. |

The manifest (`models.py`, class `Manifest`) has `eq_type`, `description`, `variables`, `t_span` and `t_points`.

## Run

1. Copy `.env.example` to `.env` in this folder.
2. Set `GROQ_API_KEY`. Optional: set `SCISYNTH_EXTENSION_ID` to your extension ID from `chrome://extensions`.
3. Install the packages and start the server on the loopback address only:

   ```powershell
   cd simulator/backend
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements.txt
   python -m uvicorn main:app --host 127.0.0.1 --port 8000
   ```

4. In the Sci-Synth settings, set **Backend URL** to `http://localhost:8000` and select **Save**.
5. In the viewer, open the **Document** panel and select **Extract equations**.

## Safety

- Run the backend only on your own computer, and only with PDFs that you trust.
- Do not bind it to `0.0.0.0` or expose it to a network.
- The backend sends PDF text to the Groq API. Do not use private PDFs unless you accept this transfer.
- CORS allows `chrome-extension://` origins and `http://localhost` / `http://127.0.0.1` only. `SCISYNTH_EXTENSION_ID` limits it to one extension.
- Do not commit `.env`.

## Extend (planned safe solver)

Add the solver in `routes/simulate.py`. The plan:

1. The LLM returns a JSON equation spec (extend `models.Manifest`).
2. A deterministic parser with a whitelist of operators and functions builds the right-hand side.
3. A fixed SciPy integrator (`solve_ivp`) runs it and streams NDJSON lines `{"t", "x", "y"}`, then `DONE`.

Never pass model output to `exec`, `eval`, `subprocess` or `compile`.
