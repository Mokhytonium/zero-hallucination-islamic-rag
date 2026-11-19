from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")

    openrouter_api_key: str = Field(default="", repr=False)
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    judge_model: str = "google/gemini-2.5-flash-lite"
    judge_model_alt: str = "openai/gpt-4o-mini"
    budget_cap_usd: float = 0.50

    embed_model: str = "BAAI/bge-m3"
    embed_batch_size: int = 32
    embed_max_length: int = 256

    reranker_model: str = "BAAI/bge-reranker-v2-m3"
    use_reranker: bool = True
    rerank_pool: int = 80
    reranker_batch_size: int = 16
    reranker_max_length: int = 512

    primary_translation: str = "fa.makarem"
    top_k: int = 15
    retrieval_pool: int = 150
    max_candidates_per_source: int = 12

    data_dir: Path = ROOT / "data"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "quran.db"

    @property
    def raw_quran(self) -> Path:
        return self.data_dir / "raw" / "quran"


settings = Settings()