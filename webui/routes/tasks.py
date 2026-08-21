from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
import torch
from pydantic import BaseModel, Field

from ..config import DEFAULT_PROFILE, PYTHON, ROOT, TASK_LOGS
from ..services.dataset_check import check_dataset, save_dataset_report
from ..services.profiles import profile_config, profile_run_prefix
from ..services import tasks as tasks_service
from ..services.resources import training_resource_snapshot
from ..services.tasks import history_lock, refresh_task_metrics, request_stop, start_task, task_history_store, task_payload, terminate_task_process

router = APIRouter()


class ProfileRequest(BaseModel):
    profile: str = DEFAULT_PROFILE


class TrainRequest(ProfileRequest):
    epochs: int | None = Field(default=None, ge=1, le=10000)
    imgsz: int | None = Field(default=None, ge=32, le=4096)
    batch: int | None = Field(default=None, ge=1, le=512)
    device: str = Field(default="auto", pattern="^(auto|cpu|cuda)$")
    workers: int = Field(default=0, ge=0, le=32)
    model: str | None = None


def _training_options(payload: TrainRequest, smoke: bool) -> dict[str, Any]:
    options = {
        "epochs": payload.epochs if payload.epochs is not None else (5 if smoke else 100),
        "imgsz": payload.imgsz if payload.imgsz is not None else (416 if smoke else 640),
        "batch": payload.batch if payload.batch is not None else (4 if smoke else 8),
        "device": payload.device,
        "workers": payload.workers,
        "model": payload.model,
    }
    if options["imgsz"] % 32:
        raise HTTPException(status_code=400, detail="图片尺寸 imgsz 必须是 32 的倍数")
    if options["device"] == "cuda" and not torch.cuda.is_available():
        raise HTTPException(status_code=400, detail="当前环境不可用 CUDA，不能选择 CUDA 训练")
    if options["model"]:
        model_path = (ROOT / options["model"]).resolve() if not Path(options["model"]).is_absolute() else Path(options["model"]).resolve()
        try:
            model_path.relative_to(ROOT)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="模型路径必须位于项目目录内") from exc
        if not model_path.exists() or model_path.suffix.lower() != ".pt":
            raise HTTPException(status_code=400, detail="训练模型不存在或不是 .pt 文件")
        options["model"] = str(model_path)
    return options


def _train_command(payload: TrainRequest, smoke: bool) -> tuple[list[str], dict[str, Any]]:
    config = profile_config(payload.profile)
    options = _training_options(payload, smoke)
    name = f"{profile_run_prefix(payload.profile)}_cpu_smoke" if smoke else profile_run_prefix(payload.profile)
    resources = training_resource_snapshot(ROOT, options["device"])
    if resources["blocking"]:
        raise HTTPException(status_code=409, detail="训练前资源检查未通过：" + "；".join(resources["blocking"]))
    options["runName"] = name
    options["resourceSnapshot"] = resources
    command = [
        str(PYTHON), str(ROOT / "scripts" / "train_profile.py"),
        "--profile", payload.profile,
        "--data", str(config["config"]),
        "--name", name,
        "--epochs", str(options["epochs"]),
        "--imgsz", str(options["imgsz"]),
        "--batch", str(options["batch"]),
        "--device", str(options["device"]),
        "--workers", str(options["workers"]),
    ]
    if options["model"]:
        command.extend(["--model", str(options["model"])])
    return command, options


@router.get("/api/tasks/resources")
def task_resources(device: str = "auto") -> dict[str, Any]:
    if device not in {"auto", "cpu", "cuda"}:
        raise HTTPException(status_code=400, detail="无效的训练设备")
    return {"resources": training_resource_snapshot(ROOT, device)}


@router.get("/api/log")
def log() -> dict[str, Any]:
    task = tasks_service.current_task
    refresh_task_metrics(task)
    if not task or not task.log_path or not task.log_path.exists():
        return {"task": task_payload(task), "log": ""}
    text = task.log_path.read_text(encoding="utf-8", errors="replace")
    return {"task": task_payload(task), "log": text[-60000:]}


@router.get("/api/task")
def task() -> dict[str, Any]:
    refresh_task_metrics(tasks_service.current_task)
    return {"task": task_payload(tasks_service.current_task)}


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
    report = save_dataset_report(check_dataset(payload.profile))
    return {"report": report}


def _ensure_dataset_ready(profile: str) -> dict[str, Any]:
    report = save_dataset_report(check_dataset(profile))
    if report["blockingCount"]:
        examples = [
            f'{item.get("split") or ""}/{item.get("filename") or ""}: {item["message"]}'
            for item in report["issues"]
            if item["severity"] == "blocking"
        ][:3]
        suffix = "；".join(examples)
        raise HTTPException(status_code=409, detail=f'训练前数据集检查未通过（{report["blockingCount"]} 个阻断问题）' + (f'：{suffix}' if suffix else ""))
    return report


@router.post("/api/tasks/train-smoke")
def run_smoke_train(payload: TrainRequest) -> dict[str, Any]:
    _ensure_dataset_ready(payload.profile)
    command, options = _train_command(payload, smoke=True)
    task = start_task(
        f"cpu-smoke-train:{payload.profile}",
        command,
        profile=payload.profile,
        params={"mode": "smoke", **options},
    )
    return {"task": task_payload(task)}


@router.post("/api/tasks/train-full")
def run_full_train(payload: TrainRequest) -> dict[str, Any]:
    _ensure_dataset_ready(payload.profile)
    command, options = _train_command(payload, smoke=False)
    task = start_task(
        f"full-train:{payload.profile}",
        command,
        profile=payload.profile,
        params={"mode": "full", **options},
    )
    return {"task": task_payload(task)}


@router.post("/api/tasks/stop")
def stop_task() -> dict[str, Any]:
    task = tasks_service.current_task
    if not task or task.status not in {"running", "stopping"}:
        return {"task": task_payload(task)}
    if task.status == "stopping":
        return {"task": task_payload(task)}
    request_stop(task)
    terminate_task_process(task)
    return {"task": task_payload(task)}
