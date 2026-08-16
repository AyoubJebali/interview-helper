"""Minimal RAG (retrieval-augmented generation) module for the mock interviewer.

This is intentionally written as plain, explicit steps rather than a
framework/abstraction, so each RAG concept (chunking, embedding, vector
search, injecting retrieved context into the prompt) is easy to point at
and read on its own.
"""

import re
from pathlib import Path

import chromadb
from loguru import logger
from sentence_transformers import SentenceTransformer

from pipecat.frames.frames import Frame, LLMContextFrame, OutputTransportMessageFrame
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

DOMAIN_HEADING_RE = re.compile(r"^##\s+(.+)$")
QUESTION_LINE_RE = re.compile(r"^-\s+(.+)$")


def load_question_chunks(path: Path) -> list[dict]:
    """Parse the markdown question bank into one chunk per question line."""
    chunks = []
    domain = "General"
    domain_index = 0

    if not path.exists():
        return chunks

    for line in path.read_text(encoding="utf-8").splitlines():
        heading_match = DOMAIN_HEADING_RE.match(line.strip())
        if heading_match:
            domain = heading_match.group(1).strip()
            domain_index = 0
            continue

        question_match = QUESTION_LINE_RE.match(line.strip())
        if question_match:
            slug = domain.lower().replace(" ", "-").replace("/", "-")
            chunks.append(
                {
                    "id": f"{slug}-{domain_index}",
                    "domain": domain,
                    "text": question_match.group(1).strip(),
                }
            )
            domain_index += 1

    return chunks


def get_questions_by_domain(path: Path) -> dict[str, list[str]]:
    """Parse the markdown question bank and group questions by domain."""
    domains: dict[str, list[str]] = {}
    current_domain = "General"

    if not path.exists():
        return domains

    for line in path.read_text(encoding="utf-8").splitlines():
        heading_match = DOMAIN_HEADING_RE.match(line.strip())
        if heading_match:
            current_domain = heading_match.group(1).strip()
            if current_domain not in domains:
                domains[current_domain] = []
            continue

        question_match = QUESTION_LINE_RE.match(line.strip())
        if question_match:
            if current_domain not in domains:
                domains[current_domain] = []
            domains[current_domain].append(question_match.group(1).strip())

    return domains


class InterviewRAG:
    """Loads the question bank into an in-memory vector store and retrieves from it."""

    def __init__(self, bank_path: Path, model_name: str = "all-MiniLM-L6-v2"):
        self._model = SentenceTransformer(model_name)

        # Ephemeral = in-memory, rebuilt fresh every run. No files on disk to
        # manage, no versioning to worry about — simplest option for a prototype.
        client = chromadb.EphemeralClient()
        self._collection = client.create_collection("interview_questions")

        chunks = load_question_chunks(bank_path)

        if chunks:
            # Step 1: embed every chunk in the question bank up front.
            embeddings = self._model.encode([chunk["text"] for chunk in chunks]).tolist()

            # Step 2: store the chunks + their embeddings in the vector database.
            self._collection.add(
                ids=[chunk["id"] for chunk in chunks],
                documents=[chunk["text"] for chunk in chunks],
                metadatas=[{"domain": chunk["domain"]} for chunk in chunks],
                embeddings=embeddings,
            )

        logger.info(f"InterviewRAG loaded {len(chunks)} question chunks from {bank_path.name}")

    def retrieve(self, query: str, top_k: int = 3) -> list[str]:
        """Embed the query, search the vector database, return matched question texts."""
        if self._collection.count() == 0:
            return []

        # Step 1: embed the query using the same model used for the chunks.
        query_embedding = self._model.encode([query]).tolist()

        # Step 2: search the vector database for the closest matching chunks.
        k = min(top_k, self._collection.count())
        results = self._collection.query(query_embeddings=query_embedding, n_results=k)

        if results and results.get("documents") and len(results["documents"]) > 0:
            return results["documents"][0]
        return []


class RAGContextInjector(FrameProcessor):
    """Pipecat pipeline processor: retrieves relevant questions and injects them into context.

    Placed between the user context aggregator and the LLM. On every completed
    user turn (an `LLMContextFrame`), it looks at the candidate's latest
    message, retrieves relevant interview questions from `InterviewRAG`, and
    appends them to the LLM context as a system message before the LLM runs.
    Also broadcasts the retrieved questions as a transport message to the UI.
    """

    def __init__(self, rag: InterviewRAG, top_k: int = 3):
        super().__init__()
        self._rag = rag
        self._top_k = top_k

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, LLMContextFrame):
            messages = frame.context.get_messages()
            last_message = messages[-1] if messages else None
            content = last_message.get("content") if isinstance(last_message, dict) else None

            if isinstance(content, str) and content.strip():
                # Step 3: retrieve relevant chunks for the candidate's latest message.
                retrieved = self._rag.retrieve(content.strip(), top_k=self._top_k)
                logger.debug(f"RAG retrieved: {retrieved}")

                if retrieved:
                    # Step 4: inject the retrieved chunks into the prompt as context.
                    context_block = "Relevant interview questions from the question bank:\n" + "\n".join(
                        f"- {question}" for question in retrieved
                    )
                    frame.context.add_message({"role": "system", "content": context_block})

                    # Broadcast RAG retrieval to client UI
                    await self.push_frame(
                        OutputTransportMessageFrame(
                            message={
                                "type": "rag-retrieval",
                                "query": content.strip(),
                                "retrieved": retrieved,
                            }
                        )
                    )

        await self.push_frame(frame, direction)


if __name__ == "__main__":
    rag = InterviewRAG(Path(__file__).resolve().parent / "interview_questions.md")
    print(rag.retrieve("I want to practice system design questions"))
    print(rag.retrieve("tell me about a conflict with a coworker"))
