from __future__ import annotations

import queue
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from ..config import DEFAULT_PROFILE, IMAGE_EXTS, MAX_UPLOAD_BYTES, UPLOADS
from ..services.predictions import (
    PredictionTask,
    cleanup_prediction_records,
    delete_prediction_records,
    list_predictions,
    persist_prediction_task,
    predict_queue,
    predict_tasks,
    predict_tasks_lock,
    prediction_stats,
    prediction_task_payload,
    remove_prediction_task,
    request_prediction_cancel,
    retry_prediction_task,
    file_sha256,
    maintain_prediction_storage,
    protected_storage_paths,
)
from ..services.profiles import resolve_profile
from ..services.storage import upload_storage_slot

router = APIRouter()


class DeletePredictionRequest(BaseModel):
    paths: list[str] = Field(default_factory=list, max_length=200)


class CleanupPredictionRequest(BaseModel):
    task_ids: list[str] = Field(default_factory=list, max_length=200)
    before: float | None = None


class CancelPredictionRequest(BaseModel):
    reason: str = "用户取消"


@router.post("/api/predict")
def predict(
    file: UploadFile = File(...),
    conf: float = Form(0.25),
    profile: str = Form(DEFAULT_PROFILE),
    model: str = Form(""),
) -> dict[str, Any]:
    profile = resolve_profile(profile)
    if not 0.01 <= conf <= 0.99:
        raise HTTPException(status_code=400, detail="置信度阈值必须在 0.01 到 0.99 之间")
    original_filename = file.filename or "upload.jpg"
    suffix = Path(original_filename).suffix.lower()
    if suffix not in IMAGE_EXTS:
        raise HTTPException(status_code=400, detail="仅支持图片文件")

    upload_name = f"{int(time.time())}_{uuid.uuid4().hex[:8]}{suffix}"
    upload_path = UPLOADS / upload_name
    content = file.file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="文件过大")
    _, protected_uploads = protected_storage_paths()
    with upload_storage_slot(len(content), protected_upload_files=protected_uploads) as capacity_available:
        if not capacity_available:
            raise HTTPException(status_code=507, detail="上传目录容量已满，请清理历史预测或上传文件后重试")
        try:
            upload_path.write_bytes(content)
        except OSError as exc:
            try:
                upload_path.unlink(missing_ok=True)
            except OSError:
                pass
            raise HTTPException(status_code=500, detail=f"保存上传文件失败：{exc}") from exc

    task = PredictionTask(
        id=uuid.uuid4().hex[:12],
        profile=profile,
        upload_path=upload_path,
        conf=conf,
        model_selector=model,
        original_filename=original_filename,
        input_sha256=file_sha256(upload_path),
        input_size=len(content),
        message="等待中：正在排队等待推理",
    )
    persist_prediction_task(task)
    try:
        predict_queue.put_nowait(task)
    except queue.Full:
        remove_prediction_task(task.id)
        upload_path.unlink(missing_ok=True)
        raise HTTPException(status_code=429, detail="预测队列已满（最多同时排队 5 个），请稍后再试")
    return prediction_task_payload(task)


@router.get("/api/predictions/tasks")
def prediction_tasks_route() -> dict[str, Any]:
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


@router.post("/api/predictions/tasks/{task_id}/cancel")
def cancel_prediction_task(task_id: str, payload: CancelPredictionRequest | None = None) -> dict[str, Any]:
    task = request_prediction_cancel(task_id, (payload.reason if payload else "用户取消"))
    return prediction_task_payload(task)


@router.post("/api/predictions/tasks/{task_id}/retry")
def retry_prediction(task_id: str) -> dict[str, Any]:
    return prediction_task_payload(retry_prediction_task(task_id))


@router.get("/api/predictions")
def predictions(
    limit: int = 48,
    since: float | None = None,
    until: float | None = None,
    task_id: str | None = None,
    profile: str | None = None,
    model: str | None = None,
    min_conf: float | None = None,
) -> dict[str, Any]:
    if min_conf is not None and not 0 <= min_conf <= 1:
        raise HTTPException(status_code=400, detail="最小置信度必须在 0 到 1 之间")
    result = list_predictions(limit, since, until, task_id, profile, model, min_conf)
    return {"predictions": result, "total": len(result), "page": 1, "pageCount": 1, "pageSize": len(result)}


@router.get("/api/predictions/stats")
def prediction_statistics(
    task_id: str | None = None,
    profile: str | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    return prediction_stats(task_id, profile, model)


@router.post("/api/predictions/cleanup")
def cleanup_predictions(payload: CleanupPredictionRequest) -> dict[str, Any]:
    if not payload.task_ids and payload.before is None:
        raise HTTPException(status_code=400, detail="请指定任务 ID 或清理时间")
    result = cleanup_prediction_records(payload.task_ids, payload.before)
    maintain_prediction_storage(force=True)
    return result


@router.post("/api/predictions/delete")
def delete_predictions(payload: DeletePredictionRequest) -> dict[str, Any]:
    result = delete_prediction_records(payload.paths)
    maintain_prediction_storage(force=True)
    return result
