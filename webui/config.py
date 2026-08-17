from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any


ROOT = Path(os.environ.get("YOLO_WORKDIR", Path(__file__).resolve().parents[1])).resolve()
WEBUI = ROOT / "webui"
STATIC = WEBUI / "static"
UPLOADS = WEBUI / "uploads"
TASK_LOGS = WEBUI / "task_logs"
TASK_HISTORY = WEBUI / "task_history.json"
PYTHON = ROOT / ".venv" / "Scripts" / "python.exe"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
VALID_SPLITS = {"train", "val", "test"}
MAX_UPLOAD_BYTES = 100 * 1024 * 1024
DATASET_PROFILES = {
    "cat": {
        "title": "猫检测",
        "root": ROOT / "datasets" / "cat",
        "config": ROOT / "datasets" / "cat" / "cat.yaml",
    },
    "safety": {
        "title": "安全生产检测",
        "root": ROOT / "datasets" / "safety",
        "config": ROOT / "datasets" / "safety" / "safety.yaml",
    },
}
DEFAULT_PROFILE = next(iter(DATASET_PROFILES))
MAX_PREDICT_QUEUE = 5
MAX_PREDICT_LIMIT = 200
MAX_TASK_LOGS_TO_KEEP = 50

for path in (UPLOADS, TASK_LOGS, ROOT / "runs"):
    path.mkdir(parents=True, exist_ok=True)

model_cache_lock = threading.Lock()
model_cache: dict[str, Any] = {}
predict_lock = threading.Lock()
dataset_counts_cache: dict[str, tuple[float, dict[str, Any]]] = {}
dataset_counts_ttl = 3.0
image_dims_cache: dict[tuple[str, float], tuple[int, int]] = {}
