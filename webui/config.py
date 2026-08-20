from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any

import yaml


ROOT = Path(os.environ.get("YOLO_WORKDIR", Path(__file__).resolve().parents[1])).resolve()
WEBUI = ROOT / "webui"
STATIC = WEBUI / "static"
UPLOADS = WEBUI / "uploads"
TASK_LOGS = WEBUI / "task_logs"
MODELS_DIR = ROOT / "models"
TASK_HISTORY = WEBUI / "task_history.json"
PYTHON = ROOT / ".venv" / "Scripts" / "python.exe"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
VALID_SPLITS = {"train", "val", "test"}
MAX_UPLOAD_BYTES = 100 * 1024 * 1024


def _discover_profiles() -> dict[str, dict[str, Any]]:
    """从 datasets/<profile>/<profile>.yaml 自动发现数据集配置，新增 profile 无需改代码。"""
    profiles: dict[str, dict[str, Any]] = {}
    datasets_root = ROOT / "datasets"
    if not datasets_root.exists():
        return profiles
    for root_dir in sorted(datasets_root.iterdir()):
        if not root_dir.is_dir():
            continue
        yamls = sorted(root_dir.glob("*.yaml"))
        if not yamls:
            continue
        config_path = yamls[0]
        title = None
        try:
            raw = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
            title = raw.get("title")
        except Exception:
            title = None
        profiles[str(root_dir.name)] = {
            "title": str(title or root_dir.name),
            "root": root_dir,
            "config": config_path,
        }
    return profiles


DATASET_PROFILES = _discover_profiles()
DEFAULT_PROFILE = next(iter(DATASET_PROFILES), "")


def refresh_profiles() -> None:
    """运行时重新发现数据集配置并更新内存快照，供增删改配置后调用。"""
    global DEFAULT_PROFILE
    discovered = _discover_profiles()
    DATASET_PROFILES.clear()
    DATASET_PROFILES.update(discovered)
    if not DATASET_PROFILES:
        DEFAULT_PROFILE = ""
    elif DEFAULT_PROFILE not in DATASET_PROFILES:
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
