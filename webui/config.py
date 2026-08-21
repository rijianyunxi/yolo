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
PREDICTION_HISTORY = WEBUI / "prediction_history.json"
DATASET_REPORTS = WEBUI / "reports"
THUMBNAILS_DIR = WEBUI / "thumbnails"
PYTHON = ROOT / ".venv" / "Scripts" / "python.exe"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
VALID_SPLITS = {"train", "val", "test"}
MAX_UPLOAD_BYTES = 100 * 1024 * 1024

# 缩略图磁盘缓存生命周期配置，可通过环境变量覆盖。
THUMBNAIL_CACHE_TTL_SECONDS = float(os.environ.get("YOLO_THUMBNAIL_CACHE_TTL_SECONDS", 7 * 24 * 3600))
THUMBNAIL_CACHE_MAX_ENTRIES = int(os.environ.get("YOLO_THUMBNAIL_CACHE_MAX_ENTRIES", 10000))
THUMBNAIL_CACHE_MAX_BYTES = int(os.environ.get("YOLO_THUMBNAIL_CACHE_MAX_BYTES", 512 * 1024 * 1024))
THUMBNAIL_CACHE_PRUNE_INTERVAL_SECONDS = float(os.environ.get("YOLO_THUMBNAIL_CACHE_PRUNE_INTERVAL_SECONDS", 60))

# 预测输出和上传暂存目录的容量治理配置。清理失败不会阻断业务请求，
# 但会在诊断接口中返回 failed / overQuota，便于运维处理。
PREDICTION_STORAGE_TTL_SECONDS = float(os.environ.get("YOLO_PREDICTION_STORAGE_TTL_SECONDS", 30 * 24 * 3600))
PREDICTION_STORAGE_MAX_ENTRIES = int(os.environ.get("YOLO_PREDICTION_STORAGE_MAX_ENTRIES", 2000))
PREDICTION_STORAGE_MAX_BYTES = int(os.environ.get("YOLO_PREDICTION_STORAGE_MAX_BYTES", 5 * 1024 * 1024 * 1024))
UPLOAD_STORAGE_TTL_SECONDS = float(os.environ.get("YOLO_UPLOAD_STORAGE_TTL_SECONDS", 3 * 24 * 3600))
UPLOAD_STORAGE_MAX_ENTRIES = int(os.environ.get("YOLO_UPLOAD_STORAGE_MAX_ENTRIES", 200))
UPLOAD_STORAGE_MAX_BYTES = int(os.environ.get("YOLO_UPLOAD_STORAGE_MAX_BYTES", 2 * 1024 * 1024 * 1024))
STORAGE_PRUNE_INTERVAL_SECONDS = float(os.environ.get("YOLO_STORAGE_PRUNE_INTERVAL_SECONDS", 60))


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
MAX_PREDICT_TASK_HISTORY = 100
MAX_TASK_LOGS_TO_KEEP = 50

PREDICT_RUNS = ROOT / "runs" / "web_predict"

for path in (UPLOADS, TASK_LOGS, ROOT / "runs", PREDICT_RUNS, DATASET_REPORTS, THUMBNAILS_DIR):
    path.mkdir(parents=True, exist_ok=True)

model_cache_lock = threading.Lock()
model_cache: dict[str, Any] = {}
predict_lock = threading.Lock()
dataset_counts_cache: dict[str, tuple[float, dict[str, Any]]] = {}
dataset_counts_ttl = 3.0
image_dims_cache: dict[tuple[str, float], tuple[int, int]] = {}

# 缓存诊断计数只在进程内保留，不写入业务数据文件。
dataset_counts_cache_stats = {"hits": 0, "misses": 0, "expirations": 0, "entries": 0}
image_dims_cache_stats = {"hits": 0, "misses": 0, "evictions": 0, "entries": 0}
thumbnail_cache_lock = threading.RLock()
storage_quota_lock = threading.RLock()
thumbnail_cache_stats = {"hits": 0, "misses": 0, "evictions": 0, "expirations": 0, "entries": 0, "bytes": 0, "hitRate": 0.0, "lastPrunedAt": 0.0}
