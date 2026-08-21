import uuid
from datetime import datetime, timezone

from sqlmodel import SQLModel, Field


class User(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    email: str = Field(index=True, unique=True)
    hashed_password: str
    first_name: str | None = None
    last_name: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
