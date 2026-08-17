from __future__ import annotations

import queue
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from ..config import DEFAULT_PROFILE, IMAGE_EXTS, MAX_UPLOAD_BYTES, UPLOADS
from ..services.predictions import (
    PredictionTask,
    list_predictions,
    predict_queue,
    predict_tasks,
    predict_tasks_lock,
    prediction_task_payload,
)
from ..services.profiles import profile_config

router = APIRouter()


@router.post("/api/predict")
def predict(
    file: UploadFile = File(...),
    conf: float = Form(0.25),
    profile: str = Form(DEFAULT_PROFILE),
) -> dict[str, Any]:
    profile_config(profile)
    suffix = Path(file.filename or "upload.jpg").suffix.lower()
    if suffix not in IMAGE_EXTS:
        raise HTTPException(status_code=400, detail="仅支持图片文件")

    upload_name = f"{int(time.time())}_{uuid.uuid4().hex[:8]}{suffix}"
    upload_path = UPLOADS / upload_name
    content = file.file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="文件过大")
    with upload_path.open("wb") as out:
        out.write(content)

    task = PredictionTask(
        id=uuid.uuid4().hex[:12],
        profile=profile,
        upload_path=upload_path,
        conf=conf,
        message="等待中：正在排队等待推理",
    )
    try:
        predict_queue.put_nowait(task)
    except queue.Full:
        upload_path.unlink(missing_ok=True)
        raise HTTPException(status_code=429, detail="预测队列已满（最多同时排队 5 个），请稍后再试")
    with predict_tasks_lock:
        predict_tasks[task.id] = task
    return prediction_task_payload(task)


@router.get("/api/predictions/tasks")
def prediction_tasks() -> dict[str, Any]:
    with predict_tasks_lock:
        tasks = [prediction_task_payload(task) for task in predict_tasks.values()]
    return {"tasks": sorted(tasks, key=lambda item: item["createdAt"], reverse=True)[:20]}


@router.get("/api/predictions/tasks/{task_id}")
def prediction_task(task_id: str) -> dict[str, Any]:
    with predict_tasks_lock:
        task = predict_tasks.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="预测任务不存在")
    return prediction_task_payload(task, include_predictions=True)


@router.get("/api/predictions")
def predictions(limit: int = 48, since: float | None = None, until: float | None = None) -> dict[str, Any]:
    return {"predictions": list_predictions(limit, since, until)}
