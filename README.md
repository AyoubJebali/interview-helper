# AiVoiceAgent

A Python voice mock-interviewer agent using Pipecat, Whisper STT, OpenRouter LLM, and Kokoro TTS. Uses RAG (retrieval-augmented generation) to ground its interview questions in a local question bank, retrieved with ChromaDB and `sentence-transformers` embeddings.

## Project Structure

- `agent.py`: Main application entry point — builds the voice pipeline.
- `rag.py`: RAG logic — loads the question bank into a vector store and retrieves relevant questions per turn.
- `interview_questions.md`: The question bank RAG retrieves from.
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

Open the URL it prints (usually `http://localhost:7860`), connect via the browser UI, and start talking — the bot will ask what role or domain you'd like to practice, then interview you using questions retrieved from `interview_questions.md`.

You can also smoke-test just the retrieval piece, without starting the voice pipeline:

```bash
python rag.py
```
