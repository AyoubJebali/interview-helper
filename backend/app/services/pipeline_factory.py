import os

from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.task import PipelineWorker
from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
from pipecat.transports.base_transport import TransportParams
from pipecat.services.kokoro.tts import KokoroTTSService
from pipecat.services.openrouter.llm import OpenRouterLLMService
from pipecat.services.whisper.stt import Model as WhisperModel
from pipecat.services.whisper.stt import WhisperSTTService
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContext,
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)

def build_interview_worker(webrtc_connection: SmallWebRTCConnection):

    transport = SmallWebRTCTransport(
        webrtc_connection=webrtc_connection,
        params=TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            vad_analyzer=SileroVADAnalyzer(),
        ),
    )

    openrouter_api_key = os.getenv("OPENROUTER_API_KEY")
    if not openrouter_api_key:
        raise ValueError("Missing OPENROUTER_API_KEY. Set it in the .env file.")

    stt = WhisperSTTService(
        device="auto",
        compute_type="default",
        settings=WhisperSTTService.Settings(
            model=WhisperModel.LARGE,
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

    vad_analyzer = SileroVADAnalyzer(
        params=VADParams(
            confidence=0.7,
            start_secs=0.2,
            stop_secs=2.0,
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
            aggregators.user(),
            llm,
            tts,
            transport.output(),
            aggregators.assistant(),
        ]
    )

    return PipelineWorker(pipeline)
