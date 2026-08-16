import argparse
import asyncio
import mimetypes
import os
import sys
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, TypedDict

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from loguru import logger

logger.remove()
logger.add(sys.stderr, level="DEBUG")

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import (
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    Frame,
    InterimTranscriptionFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
    OutputTransportMessageFrame,
    TranscriptionFrame,
    TTSTextFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.runner.types import SmallWebRTCRunnerArguments
from pipecat.services.kokoro.tts import KokoroTTSService
from pipecat.services.openrouter.llm import OpenRouterLLMService
from pipecat.services.whisper.stt import Model as WhisperModel
from pipecat.services.whisper.stt import WhisperSTTService
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection
from pipecat.transports.smallwebrtc.request_handler import (
    IceCandidate,
    SmallWebRTCPatchRequest,
    SmallWebRTCRequest,
    SmallWebRTCRequestHandler,
)
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
from pipecat.workers.runner import WorkerRunner

from rag import InterviewRAG, RAGContextInjector, get_questions_by_domain

ROOT_DIR = Path(__file__).resolve().parent
STATIC_DIR = ROOT_DIR / "static"
QUESTIONS_FILE = ROOT_DIR / "interview_questions.md"


def load_dotenv(dotenv_path: Path) -> None:
    """Minimal .env loader to avoid adding external dependencies."""
    if not dotenv_path.exists():
        return

    for line in dotenv_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


load_dotenv(ROOT_DIR / ".env")

# Built once per process so the question bank is only embedded once.
interview_rag = InterviewRAG(QUESTIONS_FILE)


class UIEventBroadcaster(FrameProcessor):
    """Intercepts frames across the pipeline and broadcasts transcriptions,
    LLM streaming tokens, and speech states to the client WebRTC DataChannel.
    """

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, TranscriptionFrame):
            msg = {
                "type": "user-transcription",
                "text": frame.text,
                "user_id": getattr(frame, "user_id", "candidate"),
                "timestamp": getattr(frame, "timestamp", time.time()),
            }
            await self.push_frame(OutputTransportMessageFrame(message=msg))
        elif isinstance(frame, InterimTranscriptionFrame):
            msg = {
                "type": "user-interim-transcription",
                "text": frame.text,
            }
            await self.push_frame(OutputTransportMessageFrame(message=msg))
        elif isinstance(frame, UserStartedSpeakingFrame):
            await self.push_frame(OutputTransportMessageFrame(message={"type": "user-started-speaking"}))
        elif isinstance(frame, UserStoppedSpeakingFrame):
            await self.push_frame(OutputTransportMessageFrame(message={"type": "user-stopped-speaking"}))
        elif isinstance(frame, BotStartedSpeakingFrame):
            await self.push_frame(OutputTransportMessageFrame(message={"type": "bot-started-speaking"}))
        elif isinstance(frame, BotStoppedSpeakingFrame):
            await self.push_frame(OutputTransportMessageFrame(message={"type": "bot-stopped-speaking"}))
        elif isinstance(frame, LLMFullResponseStartFrame):
            await self.push_frame(OutputTransportMessageFrame(message={"type": "bot-response-start"}))
        elif isinstance(frame, LLMFullResponseEndFrame):
            await self.push_frame(OutputTransportMessageFrame(message={"type": "bot-response-end"}))
        elif isinstance(frame, LLMTextFrame):
            await self.push_frame(OutputTransportMessageFrame(message={"type": "bot-llm-text", "text": frame.text}))
        elif isinstance(frame, TTSTextFrame):
            await self.push_frame(OutputTransportMessageFrame(message={"type": "bot-tts-text", "text": frame.text}))

        await self.push_frame(frame, direction)


async def run_bot(transport):
    openrouter_api_key = os.getenv("OPENROUTER_API_KEY")
    if not openrouter_api_key:
        raise ValueError("Missing OPENROUTER_API_KEY. Set it in the .env file.")

    stt = WhisperSTTService(
        device="auto",
        compute_type="default",
        settings=WhisperSTTService.Settings(
            model=WhisperModel.BASE,
            no_speech_prob=0.5,
        ),
    )

    llm = OpenRouterLLMService(
        api_key=openrouter_api_key,
        settings=OpenRouterLLMService.Settings(
            model="google/gemma-4-26b-a4b-it:free",
        ),
    )

    tts = KokoroTTSService(
        settings=KokoroTTSService.Settings(voice="af_heart"),
    )

    context = LLMContext(
        messages=[
            {
                "role": "system",
                "content": """You are Iris, a friendly mock interviewer. Start by greeting the candidate and asking
                                what role or domain they'd like to practice for (e.g. software engineering, behavioral,
                                data/product, system design). Then ask one interview question at a time, listen to
                                their answer, give brief constructive feedback, and ask a natural follow-up or move to
                                the next question. When the context includes a "Relevant interview questions from the
                                question bank" list, prefer drawing your next question from that list rather than
                                inventing one. Keep your turns short and conversational, like a real interviewer.""",
            }
        ]
    )

    vad_stop_secs = float(os.getenv("VAD_STOP_SECS", "2.0"))
    vad_analyzer = SileroVADAnalyzer(
        params=VADParams(
            confidence=0.7,
            start_secs=0.2,
            stop_secs=vad_stop_secs,
            min_volume=0.6,
        )
    )

    aggregators = LLMContextAggregatorPair(
        context=context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=vad_analyzer,
        ),
    )

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            UIEventBroadcaster(),
            aggregators.user(),
            RAGContextInjector(interview_rag),
            llm,
            UIEventBroadcaster(),
            tts,
            transport.output(),
            aggregators.assistant(),
        ]
    )

    worker = PipelineWorker(pipeline)
    runner = WorkerRunner()
    await runner.add_workers(worker)
    await runner.run()


async def bot(runner_args: SmallWebRTCRunnerArguments):
    """Entry point invoked for each new WebRTC connection."""
    transport = SmallWebRTCTransport(
        params=TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            audio_in_sample_rate=16000,
        ),
        webrtc_connection=runner_args.webrtc_connection,
    )

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        logger.info("Client connected")

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info("Client disconnected")

    await run_bot(transport)


# ==============================================================================
# FASTAPI APPLICATION & CUSTOM SERVER
# ==============================================================================

app = FastAPI(title="Iris Voice Agent")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

active_sessions: dict[str, dict[str, Any]] = {}
small_webrtc_handler: SmallWebRTCRequestHandler = SmallWebRTCRequestHandler()


@asynccontextmanager
async def app_lifespan(app: FastAPI):
    yield
    await small_webrtc_handler.close()


app.router.lifespan_context = app_lifespan


@app.get("/api/questions")
async def get_questions():
    """Returns question bank grouped by domain."""
    domains = get_questions_by_domain(QUESTIONS_FILE)
    return {"domains": domains}


@app.get("/api/config")
async def get_config():
    """Returns current agent pipeline configuration."""
    vad_stop_secs = float(os.getenv("VAD_STOP_SECS", "2.0"))
    return {
        "persona": "Iris Mock Interviewer",
        "stt": "Whisper STT (Base, int8 CPU)",
        "llm": "google/gemma-4-26b-a4b-it:free",
        "tts": "Kokoro (af_heart)",
        "vad": f"Silero VAD (stop_secs={vad_stop_secs}s)",
        "rag": "ChromaDB + all-MiniLM-L6-v2",
    }


@app.post("/api/rag/query")
async def test_rag_query(request: Request):
    """Allows testing RAG vector search directly."""
    body = await request.json()
    query = body.get("query", "")
    top_k = body.get("top_k", 3)
    results = interview_rag.retrieve(query, top_k=top_k)
    return {"query": query, "retrieved": results}


@app.get("/status")
async def get_status():
    return {"status": "ready", "transports": ["webrtc"]}


@app.post("/start")
async def start_session(request: Request):
    """Initializes a new WebRTC session."""
    try:
        request_data = await request.json()
    except Exception:
        request_data = {}

    session_id = str(uuid.uuid4())
    active_sessions[session_id] = request_data.get("body", {})

    return {
        "sessionId": session_id,
        "iceConfig": {
            "iceServers": [{"urls": ["stun:stun.l.google.com:19302"]}]
        },
    }


@app.post("/api/offer")
async def offer(
    request: SmallWebRTCRequest,
    background_tasks: BackgroundTasks,
    session_id: str | None = None,
):
    """Handles WebRTC offer requests."""
    resolved_session_id = session_id or str(uuid.uuid4())

    async def webrtc_connection_callback(connection: SmallWebRTCConnection):
        runner_args = SmallWebRTCRunnerArguments(
            webrtc_connection=connection,
            body=request.request_data,
            session_id=resolved_session_id,
        )
        background_tasks.add_task(bot, runner_args)

    answer = await small_webrtc_handler.handle_web_request(
        request=request,
        webrtc_connection_callback=webrtc_connection_callback,
    )
    return answer


@app.patch("/api/offer")
async def ice_candidate(request: SmallWebRTCPatchRequest):
    """Handles WebRTC ICE candidates."""
    await small_webrtc_handler.handle_patch_request(request)
    return {"status": "success"}


@app.api_route(
    "/sessions/{session_id}/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
)
async def proxy_request(
    session_id: str, path: str, request: Request, background_tasks: BackgroundTasks
):
    """Proxy route to support session-scoped requests."""
    active_session = active_sessions.get(session_id)
    if active_session is None:
        return Response(content="Invalid or not-yet-ready session_id", status_code=404)

    if path.endswith("api/offer"):
        try:
            request_data = await request.json()
            if request.method == "POST":
                webrtc_request = SmallWebRTCRequest(
                    sdp=request_data["sdp"],
                    type=request_data["type"],
                    pc_id=request_data.get("pc_id"),
                    restart_pc=request_data.get("restart_pc"),
                    request_data=request_data.get("request_data")
                    or request_data.get("requestData")
                    or active_session,
                )
                return await offer(webrtc_request, background_tasks, session_id=session_id)
            elif request.method == "PATCH":
                patch_request = SmallWebRTCPatchRequest(
                    pc_id=request_data["pc_id"],
                    candidates=[IceCandidate(**c) for c in request_data.get("candidates", [])],
                )
                return await ice_candidate(patch_request)
        except Exception as e:
            logger.error(f"Failed to parse WebRTC proxy request: {e}")
            return Response(content="Invalid WebRTC request", status_code=400)

    return Response(status_code=200)


# Mount static assets
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
@app.get("/client")
@app.get("/client/")
async def serve_ui():
    """Serves the new custom Dark Mode UI."""
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return JSONResponse({"status": "UI files not found"}, status_code=404)


def main():
    import uvicorn

    parser = argparse.ArgumentParser(description="Iris Voice Agent Runner")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Host address")
    parser.add_argument("--port", type=int, default=7860, help="Port number")
    args = parser.parse_args()

    print()
    print("🚀 Iris Voice Agent UI is ready!")
    print(f"   → Open in browser: http://localhost:{args.port}  (or http://127.0.0.1:{args.port})")
    print("   → Note: Browsers require 'localhost' or HTTPS to enable microphone access.")
    print()

    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()