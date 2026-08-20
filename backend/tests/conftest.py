import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Point the app at a throwaway sqlite db and a test secret before any
# `app.*` module is imported, since settings are read at import time.
os.environ.setdefault("DATABASE_URL", f"sqlite:///{BACKEND_DIR / 'tests' / '.test.db'}")
os.environ.setdefault("SECRET_KEY", "test-secret-key")

import httpx
import pytest
import pytest_asyncio

from tests.audio_utils import generate_hello_wav

FIXTURES_DIR = Path(__file__).parent / "fixtures"
HELLO_WAV_PATH = FIXTURES_DIR / "hello.wav"


@pytest.fixture(scope="session")
def hello_wav_path() -> Path:
    """Real 'hello' speech audio (Kokoro TTS + trailing silence), generated
    once and cached on disk for subsequent runs.
    """
    if not HELLO_WAV_PATH.exists():
        try:
            generate_hello_wav(HELLO_WAV_PATH)
        except FileNotFoundError as e:
            pytest.skip(str(e))
    return HELLO_WAV_PATH


@pytest_asyncio.fixture(scope="session")
async def app_client():
    """An httpx client wired directly into the FastAPI app (no real socket),
    with the app's lifespan (DB init + pipecat worker runner) started for the
    duration of the test session.
    """
    from app.main import app

    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            yield client
