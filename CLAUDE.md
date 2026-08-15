# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-file Python voice agent built on Pipecat. It runs a real-time WebRTC voice pipeline: speech-to-text (Whisper) → LLM (OpenRouter) → text-to-speech (Kokoro), with Silero VAD for turn-taking. The bot persona ("Ava") is a real estate agent assistant defined inline in `agent.py`.

## Setup & run

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then set OPENROUTER_API_KEY
python agent.py
```

There is no test suite, lint config, or build step in this repo — it's a single script.

## Architecture

Everything lives in `agent.py`:

- `bot(runner_args)` — entry point invoked by Pipecat's dev runner (`pipecat.runner.run.main()`, called from `__main__`) for each new WebRTC connection. Constructs a `SmallWebRTCTransport` and wires connect/disconnect event handlers before delegating to `run_bot`.
- `run_bot(transport)` — builds the actual pipeline: `WhisperSTTService` (CUDA, float16, large model) → `LLMContextAggregatorPair.user()` (with `SileroVADAnalyzer` for VAD, now attached to the user aggregator rather than `TransportParams` per pipecat 1.0) → `OpenRouterLLMService` → `KokoroTTSService` → `LLMContextAggregatorPair.assistant()`. The system prompt / persona is set via `LLMContext(messages=[...])` at pipeline construction time. Pipeline runs via `PipelineWorker` + `WorkerRunner`.
- `load_dotenv()` — hand-rolled `.env` loader (no python-dotenv dependency); called at import time before any env var is read. Uses `setdefault`, so real environment variables always take precedence over `.env` file values.

Key env var: `OPENROUTER_API_KEY` (required; raises `ValueError` at startup if missing).

STT (`WhisperSTTService`) is configured for CPU (`device="cpu"`, `compute_type="int8"`, `WhisperModel.BASE`) by default, since not every dev machine has a GPU. If running on a CUDA-capable host, switch to `device="cuda"`, `compute_type="float16"`, and a larger model (e.g. `WhisperModel.LARGE`) for better accuracy/latency.
