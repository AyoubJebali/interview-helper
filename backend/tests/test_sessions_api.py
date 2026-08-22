"""Tests for the /api/sessions endpoints (app/api/sessions.py).

Session creation always negotiates a real WebRTC connection, so even the
basic tests use a real aiortc RTCPeerConnection as the client. The
`test_hello_gets_spoken_response` test goes further and drives the entire
pipeline for real: it streams actual "hello" speech audio into a live
session and asserts a real spoken response comes back through
STT -> LLM -> TTS. It requires OPENROUTER_API_KEY and downloads/loads real
models, so it's skipped automatically when that key isn't configured.
"""

import asyncio
import os

from dotenv import load_dotenv

import pytest
from aiortc import RTCPeerConnection, RTCSessionDescription
from aiortc.contrib.media import MediaRecorder

from tests.audio_utils import GatedAudioTrack, has_spoken_response, wait_for_ice_gathering_complete

load_dotenv()

requires_openrouter = pytest.mark.skipif(
    not os.getenv("OPENROUTER_API_KEY"),
    reason="OPENROUTER_API_KEY not set; skipping tests that run the real pipeline",
)


async def _offer_from_new_client() -> RTCPeerConnection:
    """A bare client peer connection with an audio transceiver, offering a
    fully-gathered (non-trickle) SDP offer, as SmallWebRTCConnection expects.
    """
    pc = RTCPeerConnection()
    pc.addTransceiver("audio", direction="sendrecv")
    offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    await wait_for_ice_gathering_complete(pc)
    return pc


async def test_create_session_returns_id_and_sdp_answer(app_client):
    pc = await _offer_from_new_client()
    try:
        resp = await app_client.post(
            "/api/sessions/create",
            json={"sdp": pc.localDescription.sdp, "type": pc.localDescription.type},
        )
        assert resp.status_code == 200

        data = resp.json()
        assert data["session_id"]
        assert data["type"] == "answer"
        assert "v=0" in data["sdp"]
    finally:
        await pc.close()


async def test_get_session_after_create_is_stopped(app_client):
    pc = await _offer_from_new_client()
    try:
        create_resp = await app_client.post(
            "/api/sessions/create",
            json={"sdp": pc.localDescription.sdp, "type": pc.localDescription.type},
        )
        session_id = create_resp.json()["session_id"]

        get_resp = await app_client.get(f"/api/sessions/{session_id}")
        assert get_resp.status_code == 200
        assert get_resp.json() == {"session_id": session_id, "status": "stopped"}
    finally:
        await pc.close()


async def test_get_nonexistent_session_returns_404(app_client):
    resp = await app_client.get("/api/sessions/does-not-exist")
    assert resp.status_code == 404


async def test_start_nonexistent_session_returns_404(app_client):
    resp = await app_client.post("/api/sessions/does-not-exist/start")
    assert resp.status_code == 404


async def test_stop_nonexistent_session_returns_404(app_client):
    resp = await app_client.post("/api/sessions/does-not-exist/stop")
    assert resp.status_code == 404


async def test_stop_session_sets_status_stopped(app_client):
    pc = await _offer_from_new_client()
    try:
        create_resp = await app_client.post(
            "/api/sessions/create",
            json={"sdp": pc.localDescription.sdp, "type": pc.localDescription.type},
        )
        session_id = create_resp.json()["session_id"]

        stop_resp = await app_client.post(f"/api/sessions/{session_id}/stop")
        assert stop_resp.status_code == 200
        assert stop_resp.json() == {"session_id": session_id, "status": "stopped"}
    finally:
        await pc.close()


@requires_openrouter
async def test_hello_gets_spoken_response(app_client, hello_wav_path, tmp_path):
    """Full end-to-end pipeline test: connect over real WebRTC, start the
    session, speak "hello", and verify real audio comes back out of the bot.
    """
    pc = RTCPeerConnection()
    mic_track = GatedAudioTrack(hello_wav_path)
    pc.addTrack(mic_track)

    recorded_path = tmp_path / "response.wav"
    recorder = MediaRecorder(str(recorded_path))

    connected = asyncio.Event()

    @pc.on("track")
    def on_track(track):
        if track.kind == "audio":
            recorder.addTrack(track)

    @pc.on("connectionstatechange")
    async def on_connection_state_change():
        if pc.connectionState == "connected":
            connected.set()

    offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    await wait_for_ice_gathering_complete(pc)

    try:
        create_resp = await app_client.post(
            "/api/sessions/create",
            json={"sdp": pc.localDescription.sdp, "type": pc.localDescription.type},
        )
        assert create_resp.status_code == 200
        data = create_resp.json()
        session_id = data["session_id"]

        await pc.setRemoteDescription(RTCSessionDescription(sdp=data["sdp"], type=data["type"]))

        start_resp = await app_client.post(f"/api/sessions/{session_id}/start")
        assert start_resp.status_code == 200
        assert start_resp.json()["status"] == "started"

        await asyncio.wait_for(connected.wait(), timeout=30)

        await recorder.start()
        await asyncio.sleep(1.5)  # let the pipeline settle before speaking
        mic_track.begin_speech()

        # Time for the "hello" utterance to be sent, VAD to detect
        # end-of-speech, and a full STT -> LLM -> TTS round trip.
        await asyncio.sleep(float(os.getenv("TEST_RESPONSE_WAIT_SECS", "35")))
    finally:
        await recorder.stop()
        await app_client.post(f"/api/sessions/{session_id}/stop")
        await pc.close()

    has_speech, voiced_secs = has_spoken_response(recorded_path)
    assert has_speech, (
        f"expected a spoken response from the bot, but only detected "
        f"{voiced_secs:.2f}s of voiced audio in the recording"
    )
