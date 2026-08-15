import os
import sys
from pathlib import Path
from loguru import logger

logger.remove()
logger.add(sys.stderr, level="DEBUG")

from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineWorker
from pipecat.workers.runner import WorkerRunner
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.runner.types import SmallWebRTCRunnerArguments
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.services.kokoro.tts import KokoroTTSService
from pipecat.services.openrouter.llm import OpenRouterLLMService
from pipecat.services.whisper.stt import Model as WhisperModel
from pipecat.services.whisper.stt import WhisperSTTService
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport

from rag import InterviewRAG, RAGContextInjector


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


load_dotenv(Path(__file__).resolve().parent / ".env")

# Built once per process (not per call) so the question bank is only embedded once.
interview_rag = InterviewRAG(Path(__file__).resolve().parent / "interview_questions.md")


async def run_bot(transport):
    openrouter_api_key = os.getenv("OPENROUTER_API_KEY")
    if not openrouter_api_key:
        raise ValueError("Missing OPENROUTER_API_KEY. Set it in the .env file.")

    stt = WhisperSTTService(
        device="cpu",
        compute_type="int8",
        settings=WhisperSTTService.Settings(
            model=WhisperModel.BASE,
        ),
    )

    llm = OpenRouterLLMService(
        api_key=openrouter_api_key,
        settings=OpenRouterLLMService.Settings(
            model="google/gemma-4-26b-a4b-it:free",  # Default model
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

    # VAD now lives on the user aggregator (moved out of TransportParams in pipecat 1.0)
    aggregators = LLMContextAggregatorPair(
        context=context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=SileroVADAnalyzer(),
        ),
    )

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            aggregators.user(),
            RAGContextInjector(interview_rag),
            llm,
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
    """Entry point the dev runner calls for every new WebRTC connection."""
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


if __name__ == "__main__":
    from pipecat.runner.run import main

    main()