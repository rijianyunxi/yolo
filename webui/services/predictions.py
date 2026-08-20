from __future__ import annotations

import queue
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import torch
from fastapi import HTTPException

from ..config import IMAGE_EXTS, MAX_PREDICT_LIMIT, MAX_PREDICT_QUEUE, ROOT, predict_lock
from .models import load_model, newest_best_model


@dataclass
class PredictionTask:
    id: str
    profile: str
    upload_path: Path
    conf: float = 0.25
    status: str = "queued"
    message: str = ""
    error: str | None = None
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None
    model: str | None = None
    model_source: str | None = None
    detections: list[dict[str, Any]] = field(default_factory=list)
    images: list[dict[str, Any]] = field(default_factory=list)


predict_queue: queue.Queue[PredictionTask] = queue.Queue(maxsize=MAX_PREDICT_QUEUE)
predict_tasks: dict[str, PredictionTask] = {}
predict_tasks_lock = threading.Lock()


def list_predictions(limit: int = 48, since: float | None = None, until: float | None = None) -> list[dict[str, Any]]:
    limit = min(max(1, limit), MAX_PREDICT_LIMIT)
    files = []
    runs_root = ROOT / "runs"
    for path in runs_root.glob("web_predict_*/*"):
        if path.is_file() and path.suffix.lower() in IMAGE_EXTS:
            try:
                rel = path.relative_to(ROOT).as_posix()
            except ValueError:
                continue
            mtime = path.stat().st_mtime
            if since is not None and mtime < since:
                continue
            if until is not None and mtime > until:
                continue
            files.append({
                "name": path.name,
                "path": rel,
                "url": f"/files/{rel}",
                "mtime": mtime,
            })
    return sorted(files, key=lambda item: item["mtime"], reverse=True)[:limit]


def delete_prediction_records(paths: list[str]) -> dict[str, Any]:
    runs_root = ROOT / "runs"
    deleted: list[str] = []
    not_found: list[str] = []
    for rel in paths:
        try:
            resolved = (ROOT / rel).resolve(strict=False)
        except Exception:
            not_found.append(rel)
            continue
        # 只允许删除 web_predict_* 目录下的预测结果文件
        if not (
            resolved.is_file()
            and resolved.suffix.lower() in IMAGE_EXTS
            and resolved.parent.parent == runs_root
            and resolved.parent.name.startswith("web_predict_")
        ):
            not_found.append(rel)
            continue
        parent = resolved.parent
        resolved.unlink(missing_ok=True)
        # 尝试清理空目录
        if parent.exists():
            try:
                parent.rmdir()
            except OSError:
                pass
        deleted.append(rel)
    if not deleted and not_found:
        raise HTTPException(status_code=404, detail="未找到要删除的预测结果")
    return {"deleted": deleted, "notFound": not_found}


def prediction_task_payload(task: PredictionTask, include_predictions: bool = False) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": task.id,
        "profile": task.profile,
        "status": task.status,
        "message": task.message,
        "error": task.error,
        "createdAt": task.created_at,
        "startedAt": task.started_at,
        "finishedAt": task.finished_at,
        "model": task.model,
        "modelSource": task.model_source,
        "detections": task.detections,
        "images": task.images,
    }
    if include_predictions and task.status == "completed":
        payload["predictions"] = list_predictions()
    return payload


def run_prediction(task: PredictionTask) -> None:
    try:
        best_model = newest_best_model(task.profile)
        task.model_source = "trained" if best_model else "pretrained"
        model_path = best_model or (ROOT / "yolo11n.pt")
        if not model_path.exists():
            raise FileNotFoundError("未找到可用模型")
        task.model = str(model_path)
        task.message = "推理中：正在使用模型生成检测结果..."

        model = load_model(model_path)
        run_name = f"web_predict_{task.profile}_{task.upload_path.stem}"
        with predict_lock:
            results = model.predict(
                source=str(task.upload_path),
                imgsz=640,
                conf=task.conf,
                save=True,
                project=str(ROOT / "runs"),
                name=run_name,
                exist_ok=True,
                device="cpu" if not torch.cuda.is_available() else 0,
            )

        detections = []
        for result in results:
            names = result.names
            if result.boxes is None:
                continue
            for box in result.boxes:
                cls_id = int(box.cls[0].item())
                detections.append({
                    "classId": cls_id,
                    "name": names.get(cls_id, str(cls_id)),
                    "confidence": round(float(box.conf[0].item()), 4),
                    "xyxy": [round(float(v), 2) for v in box.xyxy[0].tolist()],
                })

        output_dir = ROOT / "runs" / run_name
        images = []
        if output_dir.exists():
            for image in output_dir.iterdir():
                if image.is_file() and image.suffix.lower() in IMAGE_EXTS:
                    rel = image.relative_to(ROOT).as_posix()
                    images.append({"name": image.name, "url": f"/files/{rel}", "path": rel})

        task.detections = detections
        task.images = images
        task.status = "completed"
        task.message = f"检测到 {len(detections)} 个目标" if detections else "未检测到目标"
    except Exception as exc:
        task.error = str(exc)
        task.message = f"推理失败：{exc}"
        task.status = "failed"
    finally:
        task.finished_at = time.time()


def predict_worker() -> None:
    while True:
        task = predict_queue.get()
        try:
            with predict_tasks_lock:
                task.status = "running"
                task.started_at = time.time()
                task.message = "推理中：正在使用模型生成检测结果..."
            run_prediction(task)
        finally:
            predict_queue.task_done()


predict_worker_thread = threading.Thread(target=predict_worker, daemon=True)
predict_worker_thread.start()
