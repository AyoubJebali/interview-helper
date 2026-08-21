"""Audio helpers for driving a real WebRTC session in tests.

These are plain aiortc/PyAV utilities, independent of pytest, so they can be
exercised outside the test suite too (e.g. to regenerate the fixture audio).
"""

import asyncio
import fractions
import wave
from pathlib import Path

import numpy as np
from aiortc.mediastreams import MediaStreamTrack
from av import AudioFrame


def generate_hello_wav(
    path: Path,
    text: str = "Hello",
    voice: str = "af_heart",
    trailing_silence_secs: float = 3.0,
) -> Path:
    """Synthesize a real spoken utterance with the same Kokoro TTS voice the
    bot uses, plus trailing silence so the server-side VAD can detect
    end-of-speech. Runs fully offline against the locally cached model.
    """
    from kokoro_onnx import Kokoro

    model_path = Path.home() / ".cache/pipecat/kokoro-onnx/kokoro-v1.0.onnx"
    voices_path = Path.home() / ".cache/pipecat/kokoro-onnx/voices-v1.0.bin"
    if not (model_path.exists() and voices_path.exists()):
        raise FileNotFoundError(
            "Kokoro model files not found in ~/.cache/pipecat/kokoro-onnx/. "
            "Run the app once so KokoroTTSService downloads them, or fetch "
            "them manually before running this test."
        )

    async def synth() -> tuple[np.ndarray, int]:
        kokoro = Kokoro(str(model_path), str(voices_path))
        chunks = []
        sample_rate = 24000
        async for samples, sample_rate in kokoro.create_stream(
            text, voice=voice, lang="en-us", speed=1.0
        ):
            chunks.append(samples)
        return np.concatenate(chunks), sample_rate

    audio, sample_rate = asyncio.run(synth())

    silence = np.zeros(int(sample_rate * trailing_silence_secs), dtype=np.float32)
    audio = np.concatenate([audio, silence])
    pcm16 = (np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16)

    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(sample_rate)
        f.writeframes(pcm16.tobytes())

    return path


class GatedAudioTrack(MediaStreamTrack):
    """A synthetic microphone track for tests.

    Emits silence until `begin_speech()` is called, then streams a
    pre-recorded utterance (which already ends in silence), then reverts to
    silence. Keeping audio flowing continuously - rather than ending the
    track - lets the server's VAD observe a real speech->silence transition
    instead of the stream simply stopping.
    """

    kind = "audio"

    def __init__(self, wav_path: Path, frame_ms: int = 20):
        super().__init__()
        with wave.open(str(wav_path), "rb") as f:
            if f.getsampwidth() != 2 or f.getnchannels() != 1:
                raise ValueError("expected 16-bit mono PCM wav")
            self._sample_rate = f.getframerate()
            raw = f.readframes(f.getnframes())

        self._speech = np.frombuffer(raw, dtype=np.int16)
        self._samples_per_frame = int(self._sample_rate * frame_ms / 1000)
        self._pos = 0
        self._pts = 0
        self._speech_event = asyncio.Event()

    def begin_speech(self) -> None:
        self._speech_event.set()

    async def recv(self) -> AudioFrame:
        await asyncio.sleep(self._samples_per_frame / self._sample_rate)

        if self._speech_event.is_set() and self._pos < len(self._speech):
            chunk = self._speech[self._pos : self._pos + self._samples_per_frame]
            self._pos += len(chunk)
            if len(chunk) < self._samples_per_frame:
                chunk = np.pad(chunk, (0, self._samples_per_frame - len(chunk)))
        else:
            chunk = np.zeros(self._samples_per_frame, dtype=np.int16)

        frame = AudioFrame(format="s16", layout="mono", samples=self._samples_per_frame)
        frame.planes[0].update(chunk.astype("<i2").tobytes())
        frame.sample_rate = self._sample_rate
        frame.pts = self._pts
        frame.time_base = fractions.Fraction(1, self._sample_rate)
        self._pts += self._samples_per_frame
        return frame


async def wait_for_ice_gathering_complete(pc, timeout: float = 10.0) -> None:
    """SmallWebRTCConnection expects a non-trickle offer, so wait until all
    local ICE candidates are gathered before sending the SDP offer.
    """
    if pc.iceGatheringState == "complete":
        return

    done = asyncio.Event()

    @pc.on("icegatheringstatechange")
    def _on_change():
        if pc.iceGatheringState == "complete":
            done.set()

    await asyncio.wait_for(done.wait(), timeout=timeout)


def has_spoken_response(
    wav_path: Path,
    min_speech_secs: float = 0.2,
    rms_threshold: float = 300.0,
    window_secs: float = 0.05,
) -> tuple[bool, float]:
    """Detect whether a recorded wav contains a meaningful amount of
    non-silent audio, as a proxy for "the bot said something back".
    """
    with wave.open(str(wav_path), "rb") as f:
        sample_rate = f.getframerate()
        sampwidth = f.getsampwidth()
        nchannels = f.getnchannels()
        raw = f.readframes(f.getnframes())

    if sampwidth != 2:
        raise ValueError("expected 16-bit PCM recording")

    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float64)
    if nchannels > 1:
        samples = samples.reshape(-1, nchannels).mean(axis=1)

    frame_len = max(1, int(sample_rate * window_secs))
    n_frames = len(samples) // frame_len
    voiced_frames = 0
    for i in range(n_frames):
        window = samples[i * frame_len : (i + 1) * frame_len]
        rms = float(np.sqrt(np.mean(window**2)))
        if rms > rms_threshold:
            voiced_frames += 1

    voiced_secs = voiced_frames * window_secs
    return voiced_secs >= min_speech_secs, voiced_secs
