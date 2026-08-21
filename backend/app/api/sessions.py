from fastapi import APIRouter, HTTPException

from app.schemas import OfferRequest
from app.services.session_manager import session_manager

from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection

router = APIRouter(prefix="/sessions", tags=["sessions"])

@router.post("/create")
async def create(request: OfferRequest):

    connection = SmallWebRTCConnection()
    await connection.initialize(sdp=request.sdp, type=request.type)

    session = session_manager.create(connection)

    @connection.event_handler("closed")
    async def on_closed(_conn):
        await session_manager.stop(session.id)

    answer = connection.get_answer()

    return {
        "session_id": session.id,
        "sdp": answer["sdp"],
        "type": answer["type"],
    }

@router.post("/{session_id}/start")
async def start_session(session_id: str):
    session = session_manager.get(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    await session_manager.start(session_id)
    return {"session_id": session_id, "status": session.status}

@router.post("/{session_id}/stop")
async def stop_session(session_id: str):
    session = session_manager.get(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    await session_manager.stop(session_id)
    return {"session_id": session_id, "status": session.status}

@router.get("/{session_id}")
async def get_session(session_id: str):
    session = session_manager.get(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    return {"session_id": session.id, "status": session.status}