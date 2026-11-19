# Sci-Synth

Sci-Synth reads a physics PDF and prepares a manifest for a numerical simulation.
The Next.js frontend sends the PDF to a FastAPI backend.
The backend uses Groq for extraction and for the Python simulation script.
The frontend shows the simulation data that the backend returns.

## Requirements

- Python with the packages in `backend/requirements.txt`
- Node.js and npm for the frontend
- A Groq API key

## Start the backend

1. Copy `backend/.env.example` to `backend/.env`.
2. Set `GROQ_API_KEY` in `backend/.env`.
3. Open a terminal in `backend`.
4. Install the dependencies with `pip install -r requirements.txt`.
5. Start the API with `python -m uvicorn main:app --reload`.

The API listens at `http://localhost:8000`.
Do not commit `backend/.env`.

## Start the frontend

1. Open a second terminal in `frontend`.
2. Install the packages with `npm ci`.
3. Start the frontend with `npm run dev`.
4. Open `http://localhost:3000`.

The frontend uses `http://localhost:8000` as its default API address.
Set `NEXT_PUBLIC_API_URL` before you start Next.js if the API uses a different address.
See [the frontend guide](frontend/docs/STE100.md) for the controls and API routes.

## Safety and privacy

Do not use the generated simulation code with untrusted input.
The backend runs model-generated Python in a subprocess.
The PDF content and the simulation request can go to the configured Groq service.
Do not upload a private PDF unless you permit this transfer.
The repository does not include the example article or local environment files.