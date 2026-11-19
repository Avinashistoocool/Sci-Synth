# Sci-Synth simulator (optional, local)

The backend is in [`backend/`](backend/). See [backend/README.md](backend/README.md) for endpoints, setup, tests
and the **security model**.

In short: the LLM returns a JSON equation spec, never code. A deterministic parser accepts only an allow-list of math
operations and builds the right-hand side without `eval`/`exec`. A fixed SciPy solver (`solve_ivp`) integrates it under
time and size limits and streams NDJSON `{"t","x","y"}` lines, then `DONE`. An optional second LLM
(`SCISYNTH_REVIEW=1`) adds plausibility warnings only; it cannot change what runs.

```powershell
cd simulator/backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```
