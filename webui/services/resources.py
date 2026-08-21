from __future__ import annotations

import os
import shutil
import time
from pathlib import Path
from typing import Any

import psutil
import torch


MIN_DISK_FREE_BYTES = 512 * 1024 * 1024
MIN_MEMORY_AVAILABLE_BYTES = 256 * 1024 * 1024
MIN_GPU_FREE_BYTES = 256 * 1024 * 1024


def training_resource_snapshot(root: Path, device: str = "auto") -> dict[str, Any]:
    disk = shutil.disk_usage(root)
    memory = psutil.virtual_memory()
    snapshot: dict[str, Any] = {
        "checkedAt": time.time(),
        "disk": {
            "totalBytes": disk.total,
            "freeBytes": disk.free,
            "usedBytes": disk.used,
        },
        "memory": {
            "totalBytes": memory.total,
            "availableBytes": memory.available,
            "percent": memory.percent,
        },
        "cpu": {"count": os.cpu_count() or 1, "loadPercent": psutil.cpu_percent(interval=None)},
        "gpu": None,
        "warnings": [],
        "blocking": [],
    }
    if disk.free < MIN_DISK_FREE_BYTES:
        snapshot["blocking"].append("磁盘剩余空间不足 512 MB")
    elif disk.free < 2 * MIN_DISK_FREE_BYTES:
        snapshot["warnings"].append("磁盘剩余空间低于 1 GB")
    if memory.available < MIN_MEMORY_AVAILABLE_BYTES:
        snapshot["blocking"].append("系统可用内存不足 256 MB")
    elif memory.available < 1024 * 1024 * 1024:
        snapshot["warnings"].append("系统可用内存低于 1 GB")

    if torch.cuda.is_available():
        try:
            index = torch.cuda.current_device()
            free, total = torch.cuda.mem_get_info(index)
            snapshot["gpu"] = {
                "available": True,
                "device": torch.cuda.get_device_name(index),
                "freeBytes": int(free),
                "totalBytes": int(total),
            }
            if device == "cuda" and free < MIN_GPU_FREE_BYTES:
                snapshot["blocking"].append("GPU 可用显存不足 256 MB")
            elif device in {"auto", "cuda"} and free < 1024 * 1024 * 1024:
                snapshot["warnings"].append("GPU 可用显存低于 1 GB")
        except Exception as exc:
            snapshot["gpu"] = {"available": True, "error": str(exc)}
    elif device == "cuda":
        snapshot["blocking"].append("请求 CUDA 训练但当前没有可用 GPU")

    snapshot["ready"] = not snapshot["blocking"]
    return snapshot
