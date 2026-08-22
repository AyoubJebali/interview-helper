import asyncio

from dotenv import load_dotenv
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.services.session_manager import session_manager
from app.api.auth import router as auth_router
from app.api.sessions import router as interview_router
from app.core.config import settings
from app.db import init_db

@asynccontextmanager
async def lifespan(app: FastAPI):

    # Everything BEFORE 'yield' runs on startup
    load_dotenv()
    init_db()
    asyncio.create_task(session_manager.start_runner())

    yield  # The app serves requests while frozen here
    
    # Everything AFTER 'yield' runs on shutdown
    pass

app = FastAPI(title=settings.PROJECT_NAME, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api")
app.include_router(interview_router, prefix="/api")
