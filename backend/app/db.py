from sqlmodel import SQLModel, Session, create_engine

from app.core.config import settings

connect_args = {"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(settings.DATABASE_URL, echo=False, connect_args=connect_args)


def init_db() -> None:
    from app.models import user  # noqa: F401 ensure models are imported
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
