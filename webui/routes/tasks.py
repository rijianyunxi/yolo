from __future__ import annotations

import os
import signal
import subprocess
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..config import DEFAULT_PROFILE, PYTHON, ROOT, TASK_LOGS
from ..services.profiles import profile_config, profile_run_prefix
from ..services.tasks import (
    current_task,
    history_lock,
    start_task,
    task_history_store,
    task_payload,
)

router = APIRouter()


class ProfileRequest(BaseModel):
    profile: str = DEFAULT_PROFILE


@router.get("/api/log")
def log() -> dict[str, Any]:
    task = current_task
    if not task or not task.log_path or not task.log_path.exists():
        return {"task": task_payload(task), "log": ""}
    text = task.log_path.read_text(encoding="utf-8", errors="replace")
    return {"task": task_payload(task), "log": text[-60000:]}


@router.get("/api/task")
def task() -> dict[str, Any]:
    return {"task": task_payload(current_task)}


@router.get("/api/tasks/history")
def task_history() -> dict[str, Any]:
    with history_lock:
        return {"tasks": list(task_history_store)}


@router.get("/api/tasks/history/{task_id}/log")
def task_history_log(task_id: str) -> dict[str, Any]:
    log_path = TASK_LOGS / f"{task_id}.log"
    if not log_path.exists():
        raise HTTPException(status_code=404, detail="该历史任务没有日志文件")
    text = log_path.read_text(encoding="utf-8", errors="replace")
    return {"taskId": task_id, "log": text[-60000:]}


@router.post("/api/tasks/check")
def run_dataset_check(payload: ProfileRequest) -> dict[str, Any]:
    config = profile_config(payload.profile)
    task = start_task(
        f"dataset-check:{payload.profile}",
        [
            str(PYTHON),
            str(ROOT / "scripts" / "check_dataset.py"),
            "--profile",
            payload.profile,
            "--data-root",
            str(config["root"]),
        ],
    )
    return {"task": task_payload(task)}


@router.post("/api/tasks/train-smoke")
def run_smoke_train(payload: ProfileRequest) -> dict[str, Any]:
    config = profile_config(payload.profile)
    task = start_task(
        f"cpu-smoke-train:{payload.profile}",
        [
            str(PYTHON),
            str(ROOT / "scripts" / "train_profile.py"),
            "--profile",
            payload.profile,
            "--data",
            str(config["config"]),
            "--name",
            f"{profile_run_prefix(payload.profile)}_cpu_smoke",
            "--epochs",
            "5",
            "--imgsz",
            "416",
            "--batch",
            "4",
        ],
    )
    return {"task": task_payload(task)}


@router.post("/api/tasks/train-full")
def run_full_train(payload: ProfileRequest) -> dict[str, Any]:
    config = profile_config(payload.profile)
    task = start_task(
        f"full-train:{payload.profile}",
        [
            str(PYTHON),
            str(ROOT / "scripts" / "train_profile.py"),
            "--profile",
            payload.profile,
            "--data",
            str(config["config"]),
            "--name",
            profile_run_prefix(payload.profile),
            "--epochs",
            "100",
            "--imgsz",
            "640",
            "--batch",
            "8",
        ],
    )
    return {"task": task_payload(task)}


@router.post("/api/tasks/stop")
def stop_task() -> dict[str, Any]:
    task = current_task
    if not task or task.status != "running" or not task.process:
        return {"task": task_payload(task)}
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(task.process.pid), "/T", "/F"], capture_output=True, text=True)
    else:
        os.killpg(task.process.pid, signal.SIGTERM)
    task.status = "stopping"
    return {"task": task_payload(task)}
