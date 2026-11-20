import threading

from islamic_rag.settings import Settings

settings = Settings()
INFER_LOCK = threading.Lock()