from .retrieve import Candidate
from .settings import Settings

_RERANKER_CACHE: dict = {}
_EXPECTED_BYTES = 2271071852


def reranker_available(settings: Settings) -> bool:
    local = settings.data_dir / "models" / "bge-reranker-v2-m3" / "model.safetensors"
    return local.exists() and local.stat().st_size == _EXPECTED_BYTES


def get_reranker(settings: Settings):
    # Keep torch's default thread count (physical cores); forcing os.cpu_count()
    # (logical) showed no measured benefit and oversubscribes hyperthreaded CPUs.
    from sentence_transformers import CrossEncoder

    name = settings.reranker_model
    if name not in _RERANKER_CACHE:
        local = settings.data_dir / "models" / "bge-reranker-v2-m3"
        source = str(local) if (local / "model.safetensors").exists() else name
        model = CrossEncoder(source, max_length=settings.reranker_max_length, device="cpu")
        _RERANKER_CACHE[name] = model
    return _RERANKER_CACHE[name]


def _passage(c: Candidate) -> str:
    return c.text_index + " " + c.translation_fa


def rerank_candidates(settings: Settings, query: str, candidates: list[Candidate]) -> list[Candidate]:
    if not candidates:
        return candidates
    model = get_reranker(settings)
    pairs = [(query, _passage(c)) for c in candidates]
    scores = model.predict(
        pairs,
        batch_size=settings.reranker_batch_size,
        show_progress_bar=False,
        convert_to_numpy=True,
    )
    for c, s in zip(candidates, scores, strict=True):
        c.rerank_score = float(s)
        c.score = float(s)
    return sorted(candidates, key=lambda c: -c.score)