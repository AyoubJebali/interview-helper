"""
Placeholder WebSocket route for the Pipecat voice pipeline.

This is where the interview "agent" lives: audio comes in over the socket,
gets run through a Pipecat pipeline (STT -> LLM -> TTS, or your chosen
services), and audio/events flow back out. Wire up your actual
transport/pipeline here — see Pipecat's docs for the websocket transport.
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(prefix="/api/interview", tags=["interview"])


@router.websocket("/ws/{session_id}")
async def interview_session(websocket: WebSocket, session_id: str):
    await websocket.accept()
    try:
        # TODO: build and run your Pipecat pipeline here, e.g.:
        # pipeline = Pipeline([transport.input(), stt, llm, tts, transport.output()])
        # task = PipelineTask(pipeline)
        # await PipelineRunner().run(task)
        while True:
            data = await websocket.receive_bytes()
            # feed `data` into the pipeline's transport input
    except WebSocketDisconnect:
        pass
