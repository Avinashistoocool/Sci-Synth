from pathlib import Path
from dotenv import load_dotenv

# Use an explicit path so .env is found regardless of where uvicorn is launched from
load_dotenv(Path(__file__).parent / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes.extract import router as extract_router
from routes.simulate import router as simulate_router

app = FastAPI(title="Sci-Synth")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

app.include_router(extract_router)
app.include_router(simulate_router)
