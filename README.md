# AiVoiceAgent

A Python voice agent project using Pipecat, Whisper STT, OpenRouter LLM, and Kokoro TTS.

## Project Structure

- `agent.py`: Main application entry point.
- `requirements.txt`: Python dependencies.
- `.env.example`: Example environment variables.
- `.gitignore`: Git ignore rules.
- `.ignore`: Optional ignore rules for local tools.

## Prerequisites

- Python 3.10+
- `pip`

## Local Setup

1. Create and activate a virtual environment:

   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```

2. Install dependencies:

   ```bash
   python -m pip install --upgrade pip
   pip install -r requirements.txt
   ```

3. Configure environment variables:

   ```bash
   cp .env.example .env
   ```

   Then edit `.env` and set your real API key:

   ```env
   OPENROUTER_API_KEY=your_real_key_here
   ```

## Run

```bash
python agent.py
```
