import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.services.session_manager import session_manager
from app.api.auth import router as auth_router
from app.api.sessions import router as interview_router
from app.core.config import settings
from app.db import init_db

app = FastAPI(title=settings.PROJECT_NAME)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api")
app.include_router(interview_router, prefix="/api")

@app.on_event("startup")
async def on_startup():
    init_db()
    asyncio.create_task(session_manager.start_runner())
