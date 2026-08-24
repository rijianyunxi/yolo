from __future__ import annotations

import platform
import shutil
import sys
from typing import Any

import cv2
import torch
import ultralytics
from fastapi import APIRouter

from ..config import DATASET_PROFILES, DEFAULT_PROFILE, ROOT
from ..services.datasets import dataset_counts
from ..services.models import newest_best_model
from ..services.profiles import profile_classes, profile_config, resolve_profile
from ..services import tasks as tasks_service
from ..services.tasks import task_payload

router = APIRouter()


@router.get("/api/status")
def status(profile: str = DEFAULT_PROFILE) -> dict[str, Any]:
    profile = resolve_profile(profile)
    best = newest_best_model(profile)
    return {
        "profile": profile,
        "profiles": [
            {"id": key, "title": value["title"]}
            for key, value in DATASET_PROFILES.items()
        ],
        "classes": profile_classes(profile),
        "projectDir": str(ROOT),
        "python": sys.version.split()[0],
        "pythonExe": sys.executable,
        "platform": platform.platform(),
        "cpu": platform.processor() or platform.machine(),
        "torch": torch.__version__,
        "cuda": torch.cuda.is_available(),
        "cudaDevice": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "ultralytics": ultralytics.__version__,
        "opencv": cv2.__version__,
        "nvidiaSmi": shutil.which("nvidia-smi"),
        "pretrained": str(ROOT / "yolo11n.pt") if (ROOT / "yolo11n.pt").exists() else None,
        "bestModel": str(best) if best else None,
        "dataset": dataset_counts(profile),
        "task": task_payload(tasks_service.current_task),
    }


@router.get("/api/classes")
def classes(profile: str = DEFAULT_PROFILE) -> dict[str, Any]:
    profile = resolve_profile(profile)
    config = profile_config(profile)
    return {
        "profile": profile,
        "title": config["title"],
        "classes": profile_classes(profile),
    }


@router.get("/api/status-json")
def status_json() -> Any:
    # 直接返回 status() 即可由 FastAPI 完成 JSON 序列化，避免多余的
    # json.dumps -> json.loads 往返（旧实现仅在序列化失败时才有 default=str 兜底价值）。
    return status()
