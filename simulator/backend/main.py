from pathlib import Path
import os
import re

from dotenv import load_dotenv

# Use an explicit path so .env is found regardless of where uvicorn is launched from
load_dotenv(Path(__file__).parent / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes.extract import router as extract_router
from routes.simulate import router as simulate_router
import review

app = FastAPI(title="Sci-Synth simulator (local)")

# CORS: only the Sci-Synth extension and localhost pages may call this API.
# Set SCISYNTH_EXTENSION_ID to your extension ID (see chrome://extensions) to allow only that
# extension. Without it, any chrome-extension:// origin is allowed; the server must still
# listen on 127.0.0.1 only.
_ext_id = os.getenv("SCISYNTH_EXTENSION_ID", "").strip()
_ext = re.escape(_ext_id) if _ext_id else "[a-p]{32}"
_origin_regex = rf"^(chrome-extension://{_ext}|http://(localhost|127\.0\.0\.1)(:\d+)?)$"

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=_origin_regex,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    allow_credentials=False,
)

app.include_router(extract_router)
app.include_router(simulate_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "simulate": "safe-solver", "spec_version": 1, "review": review.enabled()}
