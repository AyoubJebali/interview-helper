from dataclasses import dataclass
from enum import Enum
from uuid import uuid4

from app.services.pipeline_factory import build_interview_worker

from pipecat.workers.runner import WorkerRunner
from pipecat.pipeline.task import PipelineWorker
from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection

class SessionStatus(str, Enum):
    STARTING = "starting"
    STARTED = "started"
    STOPPED = "stopped"

@dataclass
class Session:
    id: str
    connection: SmallWebRTCConnection
    status: SessionStatus = SessionStatus.STOPPED
    worker: PipelineWorker | None = None

class SessionManager:
    def __init__(self):
        self._sessions: dict[str, Session] = {}
        self._runner: WorkerRunner = WorkerRunner()

    async def start_runner(self):
        await self._runner.run(auto_end=False)

    def create(self, connection: SmallWebRTCConnection) -> Session:
        session_id = str(uuid4())
        session = Session(id=session_id, connection=connection)
        self._sessions[session_id] = session
        return session

    def get(self, session_id: str) -> Session | None:
        return self._sessions.get(session_id)

    async def start(self, session_id: str):
        session = self.get(session_id)
        if not session:
            return None
        session.status = SessionStatus.STARTING
        try:
            session.worker = build_interview_worker(session.connection)
            await self._runner.add_workers(session.worker)
            session.status = SessionStatus.STARTED
        except Exception:
            session.status = SessionStatus.STOPPED
            raise
        return session

    async def stop(self, session_id: str):
        session = self.get(session_id)
        if not session:
            return None
        if session.worker:
            await session.worker.cancel()
        session.status = SessionStatus.STOPPED
        return session

    def remove(self, session_id: str):
        self._sessions.pop(session_id, None)

session_manager = SessionManager()