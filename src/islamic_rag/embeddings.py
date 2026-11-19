import numpy as np

from . import store
from .settings import Settings

_MODEL_CACHE: dict = {}


def get_model(name: str, settings: Settings | None = None):
    from sentence_transformers import SentenceTransformer

    # Keep torch's default thread count (physical cores) instead of forcing
    # os.cpu_count() (logical); no measured benefit from oversubscribing.
    if name not in _MODEL_CACHE:
        source = name
        max_len = 256
        if settings is not None:
            max_len = settings.embed_max_length
            local = settings.data_dir / "models" / "bge-m3"
            if (local / "pytorch_model.bin").exists():
                source = str(local)
        model = SentenceTransformer(source, device="cpu")
        model.max_seq_length = max_len
        _MODEL_CACHE[name] = model
    return _MODEL_CACHE[name]


def encode(texts: list[str], settings: Settings, progress: bool = False) -> np.ndarray:
    model = get_model(settings.embed_model, settings)
    vecs = model.encode(
        texts,
        batch_size=settings.embed_batch_size,
        normalize_embeddings=True,
        show_progress_bar=progress,
        convert_to_numpy=True,
    )
    return vecs.astype(np.float32)


def _encode_bulk(model, texts: list[str], batch_size: int, progress: bool) -> np.ndarray:
    # Sort by token length so each batch pads to a similar length; short verses
    # (the vast majority) then run in cheap batches instead of being padded to a
    # single long verse in the same batch.
    lengths = np.array([len(ids) for ids in model.tokenizer(texts)["input_ids"]])
    order = np.argsort(lengths, kind="stable")
    sorted_texts = [texts[i] for i in order]
    sorted_vecs = model.encode(
        sorted_texts,
        batch_size=batch_size,
        normalize_embeddings=True,
        show_progress_bar=progress,
        convert_to_numpy=True,
    )
    vecs = np.empty_like(sorted_vecs)
    vecs[order] = sorted_vecs
    return vecs.astype(np.float32)


def build_index(settings: Settings) -> dict:
    con = store.connect(settings.db_path)
    records = con.execute("SELECT id, text_index FROM records ORDER BY id").fetchall()
    translations = con.execute(
        "SELECT record_id, text_index FROM translations WHERE translator_id=? ORDER BY record_id",
        (settings.primary_translation,),
    ).fetchall()
    assert len(records) == len(translations) == 6236

    model = get_model(settings.embed_model, settings)
    batch = max(settings.embed_batch_size, 64)
    ar_vecs = _encode_bulk(model, [r["text_index"] for r in records], batch, progress=True)
    fa_vecs = _encode_bulk(model, [r["text_index"] for r in translations], batch, progress=True)
    dim = ar_vecs.shape[1]

    rows = []
    for r, v in zip(records, ar_vecs, strict=True):
        rows.append((r["id"], "ar", settings.embed_model, dim, v.tobytes()))
    for r, v in zip(translations, fa_vecs, strict=True):
        rows.append((r["record_id"], "fa", settings.embed_model, dim, v.tobytes()))
    store.insert_vectors(con, rows)
    con.close()
    return {"model": settings.embed_model, "dim": dim, "vectors": len(rows)}