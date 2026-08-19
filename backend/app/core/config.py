from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    PROJECT_NAME: str = "Interview Helper"
    DATABASE_URL: str = "sqlite:///./dev.db"

    SECRET_KEY: str = "change-me"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24

    CORS_ORIGINS: list[str] = ["http://localhost:5173"]

    # Pipecat / voice AI provider keys
    OPENAI_API_KEY: str | None = None
    DEEPGRAM_API_KEY: str | None = None
    ELEVENLABS_API_KEY: str | None = None


settings = Settings()
