# Interview Helper

AI interview practice agent. React frontend (Vercel), FastAPI + SQLModel +
Pipecat backend (host with WebSocket support, e.g. Railway/Render/Fly.io).

## Local development

### Backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in SECRET_KEY and provider API keys
uvicorn app.main:app --reload
```
Uses SQLite by default locally. To use Postgres instead, run `docker compose up db`
and point `DATABASE_URL` at it (see `.env.example`).

### Frontend
```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

## Deployment

- **Frontend → Vercel**: import the repo, set root directory to `frontend`,
  add `VITE_API_URL` / `VITE_WS_URL` env vars pointing at your backend.
- **Backend → Railway/Render/Fly.io**: deploy `backend/` (Dockerfile included).
  Vercel serverless functions don't support the persistent WebSocket
  connections Pipecat needs, so the backend must live somewhere with a
  long-running process.

## Structure

- `backend/app/core` — settings, JWT/password hashing
- `backend/app/models` — SQLModel tables
- `backend/app/api` — routers (`auth.py` for login/register/me,
  `interview_ws.py` for the Pipecat voice session WebSocket)
- `backend/app/services` — put your Pipecat pipeline construction here
- `frontend/src/lib/api.ts` — typed fetch client + token storage
- `frontend/src/pages` — Login, Register, Dashboard
