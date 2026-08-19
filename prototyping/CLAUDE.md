# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Python voice mock-interviewer agent ("Iris") built on Pipecat and FastAPI. It runs a real-time WebRTC voice pipeline: speech-to-text (Whisper) → RAG-augmented LLM (OpenRouter) → text-to-speech (Kokoro), with Silero VAD for turn-taking. RAG grounds Iris's questions in a local question bank (`interview_questions.md`), retrieved via ChromaDB + `sentence-transformers` embeddings. A custom dark-mode web UI (`static/`) is served by the same FastAPI app.

## Setup & run

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then set OPENROUTER_API_KEY
python agent.py
```

Open the printed URL (default `http://localhost:7860`) — browsers require `localhost` or HTTPS for mic access. `python agent.py --host <host> --port <port>` overrides the bind address.

You can smoke-test just the RAG retrieval piece without starting the voice pipeline:

```bash
python rag.py
```

There is no test suite, lint config, or build step in this repo.

## Architecture

- `agent.py` — FastAPI app + voice pipeline, entry point (`main()`, run via `__main__`).
  - `bot(runner_args)` — invoked per new WebRTC connection (from the `/api/offer` handler via `BackgroundTasks`). Constructs a `SmallWebRTCTransport` and wires connect/disconnect event handlers before delegating to `run_bot`.
  - `run_bot(transport)` — builds the pipeline: `WhisperSTTService` (CPU, int8, `WhisperModel.BASE` by default) → `UIEventBroadcaster` → `LLMContextAggregatorPair.user()` (with `SileroVADAnalyzer` configured via `VADParams` with increased `stop_secs` for conversational pauses) → `RAGContextInjector` → `OpenRouterLLMService` (`google/gemma-4-26b-a4b-it:free`) → `UIEventBroadcaster` → `KokoroTTSService` (`af_heart` voice) → `LLMContextAggregatorPair.assistant()`. The system prompt / persona ("Iris, a friendly mock interviewer") is set via `LLMContext(messages=[...])` at pipeline construction time. Pipeline runs via `PipelineWorker` + `WorkerRunner`.
  - `UIEventBroadcaster` — a `FrameProcessor` that intercepts pipeline frames (transcriptions, LLM/TTS streaming text, speaking-state changes) and rebroadcasts them to the browser over the WebRTC DataChannel as `OutputTransportMessageFrame` JSON messages, so the UI can show live transcript/state.
  - `load_dotenv()` — hand-rolled `.env` loader (no python-dotenv dependency despite it being in requirements); called at import time before any env var is read. Uses `setdefault`, so real environment variables always take precedence over `.env` file values.
  - FastAPI routes: `/api/questions` (question bank by domain), `/api/config` (pipeline config summary), `/api/rag/query` (direct RAG retrieval test), `/status`, `/start` (creates a session id), `/api/offer` + `PATCH /api/offer` (WebRTC SDP offer / ICE candidates via `SmallWebRTCRequestHandler`), `/sessions/{session_id}/{path}` (proxy route that forwards session-scoped offer/ICE requests), and `/`, `/client` (serves `static/index.html`); `/static` is mounted from `static/`.
- `rag.py` — RAG logic, deliberately written as plain explicit steps rather than a framework abstraction:
  - `load_question_chunks` / `get_questions_by_domain` — parse `interview_questions.md` (`## Domain` headings, `- question` lines) into chunks / domain-grouped lists.
  - `InterviewRAG` — embeds the question bank with `sentence-transformers` (`all-MiniLM-L6-v2`) into an in-memory (`EphemeralClient`) ChromaDB collection at construction time; `retrieve(query, top_k)` embeds the query and returns the closest matching question texts. Rebuilt fresh every process start — no persistence.
  - `RAGContextInjector` — a `FrameProcessor` placed between the user context aggregator and the LLM. On each completed user turn (`LLMContextFrame`), retrieves relevant questions for the candidate's latest message and appends them as a system message to the LLM context before the LLM runs; also broadcasts the retrieval to the UI via `OutputTransportMessageFrame`.
- `interview_questions.md` — the question bank RAG retrieves from, organized by `## Domain` headings with `- question` bullet lines.
- `static/` — the dark-mode web client: `index.html` (split-stage UI with hero visualizer + side inspector), `style.css` (HSL-based design system), `orb_visualizer.js` (canvas neural-orb audio visualizer), `app.js` (WebRTC connection manager, Web Audio analyzers, DataChannel event handling, live transcript).

Key env var: `OPENROUTER_API_KEY` (required; raises `ValueError` at startup if missing).

STT (`WhisperSTTService`) is configured for CPU (`device="cpu"`, `compute_type="int8"`, `WhisperModel.BASE`) by default, since not every dev machine has a GPU. If running on a CUDA-capable host, switch to `device="cuda"`, `compute_type="float16"`, and a larger model (e.g. `WhisperModel.LARGE`) for better accuracy/latency.

Note: there is an uncommitted local change to `agent.py` (as of this writing) that drops the explicit `device`/`compute_type` args from `WhisperSTTService`, falling back to library defaults — check `git diff agent.py` if STT device behavior looks unexpected.
