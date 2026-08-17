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


def load_model(model_path: Path) -> YOLO:
    key = str(model_path.resolve())
    with model_cache_lock:
        model = model_cache.get(key)
        if model is None:
            model = YOLO(str(model_path))
            model_cache.clear()
            model_cache[key] = model
        return model
