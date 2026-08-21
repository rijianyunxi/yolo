from __future__ import annotations

from pathlib import Path

from ultralytics import YOLO

from ..config import DEFAULT_PROFILE, ROOT, model_cache, model_cache_lock
from .profiles import profile_run_prefix


def newest_best_model(profile: str = DEFAULT_PROFILE) -> Path | None:
    prefix = profile_run_prefix(profile)
    candidates = list((ROOT / "runs").glob(f"{prefix}*/weights/best.pt"))
    if not candidates:
        return None
    return max(candidates, key=lambda path: path.stat().st_mtime)


def _cache_prefix(model_path: Path) -> str:
    return str(model_path.resolve()) + "|"


def _cache_key(model_path: Path) -> str:
    resolved = model_path.resolve()
    stat = resolved.stat()
    return f"{resolved}|{stat.st_mtime_ns}|{stat.st_size}"


def invalidate_model(model_path: Path) -> None:
    prefix = _cache_prefix(model_path)
    with model_cache_lock:
        for key in list(model_cache):
            if key.startswith(prefix):
                model_cache.pop(key, None)


def load_model(model_path: Path) -> YOLO:
    key = _cache_key(model_path)
    prefix = _cache_prefix(model_path)
    with model_cache_lock:
        model = model_cache.get(key)
        if model is None:
            for stale_key in list(model_cache):
                if stale_key.startswith(prefix):
                    model_cache.pop(stale_key, None)
            model = YOLO(str(model_path))
            model_cache[key] = model
        return model
