from __future__ import annotations

import hashlib
import json
import queue
import shutil
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import torch
from fastapi import HTTPException

from ..config import (
    IMAGE_EXTS,
    MAX_PREDICT_LIMIT,
    MAX_PREDICT_QUEUE,
    MAX_PREDICT_TASK_HISTORY,
    PREDICT_RUNS,
    PREDICTION_HISTORY,
    ROOT,
    UPLOADS,
    predict_lock,
)
from .imported_models import resolve_model_selector
from .models import load_model
from .storage import prune_storage, storage_stats, upload_storage_slot


PREDICTION_TERMINAL_STATUSES = {"completed", "failed", "cancelled", "interrupted"}
PREDICTION_ACTIVE_STATUSES = {"queued", "running", "stopping"}


class _PredictionCancelled(Exception):
    """Internal control-flow exception used after a cooperative cancellation check."""


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
    model_selector: str = ""
    output_dir: Path | None = None
    detections: list[dict[str, Any]] = field(default_factory=list)
    images: list[dict[str, Any]] = field(default_factory=list)
    cancel_requested: bool = False
    cancel_reason: str | None = None
    original_filename: str | None = None
    input_sha256: str | None = None
    input_size: int | None = None
    duration_ms: int | None = None
    model_sha256: str | None = None
    parent_task_id: str | None = None
    schema_version: int = 1
    cancel_event: threading.Event = field(default_factory=threading.Event, repr=False)


predict_queue: queue.Queue[PredictionTask] = queue.Queue(maxsize=MAX_PREDICT_QUEUE)
predict_tasks: dict[str, PredictionTask] = {}
predict_tasks_lock = threading.Lock()


def file_sha256(path: Path) -> str | None:
    try:
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except OSError:
        return None


def _write_history(records: list[dict[str, Any]]) -> None:
    PREDICTION_HISTORY.parent.mkdir(parents=True, exist_ok=True)
    temp_path = PREDICTION_HISTORY.with_name(f".{PREDICTION_HISTORY.name}.{uuid.uuid4().hex}.tmp")
    try:
        temp_path.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
        temp_path.replace(PREDICTION_HISTORY)
    finally:
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass


def _task_record(task: PredictionTask) -> dict[str, Any]:
    return {
        "schemaVersion": task.schema_version,
        "id": task.id,
        "profile": task.profile,
        "uploadPath": str(task.upload_path),
        "originalFilename": task.original_filename,
        "inputSha256": task.input_sha256,
        "inputSize": task.input_size,
        "conf": task.conf,
        "status": task.status,
        "message": task.message,
        "error": task.error,
        "cancelRequested": task.cancel_requested,
        "cancelReason": task.cancel_reason,
        "createdAt": task.created_at,
        "startedAt": task.started_at,
        "finishedAt": task.finished_at,
        "durationMs": task.duration_ms,
        "model": task.model,
        "modelSource": task.model_source,
        "modelSelector": task.model_selector,
        "modelSha256": task.model_sha256,
        "parentTaskId": task.parent_task_id,
        "outputDir": str(task.output_dir) if task.output_dir else None,
        "detections": task.detections,
        "images": task.images,
    }


def _history_records() -> list[dict[str, Any]]:
    return sorted(
        (_task_record(item) for item in predict_tasks.values()),
        key=lambda item: item["createdAt"],
        reverse=True,
    )[:MAX_PREDICT_TASK_HISTORY]


def persist_prediction_task(task: PredictionTask) -> None:
    with predict_tasks_lock:
        predict_tasks[task.id] = task
        _write_history(_history_records())


def remove_prediction_task(task_id: str) -> None:
    with predict_tasks_lock:
        predict_tasks.pop(task_id, None)
        _write_history(_history_records())


def _task_from_record(record: dict[str, Any]) -> PredictionTask | None:
    task_id = str(record.get("id") or "").strip()
    profile = str(record.get("profile") or "").strip()
    if not task_id or not profile:
        return None
    status = str(record.get("status") or "failed")
    if status in {"queued", "running", "stopping"}:
        status = "interrupted"
    output_dir = record.get("outputDir")

    def number(name: str, default: float | None = None) -> float | None:
        try:
            value = float(record.get(name))
        except (TypeError, ValueError):
            return default
        return value if value == value else default

    def integer(name: str, default: int | None = None) -> int | None:
        try:
            return int(record.get(name))
        except (TypeError, ValueError):
            return default

    conf = number("conf", 0.25)
    if conf is None or not 0.01 <= conf <= 0.99:
        conf = 0.25
    created_at = number("createdAt", time.time()) or time.time()
    started_at = number("startedAt")
    finished_at = number("finishedAt")
    duration_ms = integer("durationMs")
    input_size = integer("inputSize")
    schema_version = integer("schemaVersion", 1) or 1
    task = PredictionTask(
        id=task_id,
        profile=profile,
        upload_path=Path(str(record.get("uploadPath") or "")),
        conf=conf,
        status=status,
        message=str(record.get("message") or ""),
        error=record.get("error"),
        created_at=created_at,
        started_at=started_at,
        finished_at=finished_at,
        model=record.get("model"),
        model_source=record.get("modelSource"),
        model_selector=str(record.get("modelSelector") or ""),
        output_dir=Path(str(output_dir)) if output_dir else None,
        detections=list(record.get("detections") or []),
        images=list(record.get("images") or []),
        cancel_requested=bool(record.get("cancelRequested", False)),
        cancel_reason=record.get("cancelReason"),
        original_filename=record.get("originalFilename"),
        input_sha256=record.get("inputSha256"),
        input_size=input_size,
        duration_ms=duration_ms,
        model_sha256=record.get("modelSha256"),
        parent_task_id=record.get("parentTaskId"),
        schema_version=schema_version,
    )
    if status == "interrupted":
        task.finished_at = task.finished_at or time.time()
        task.message = "服务重启，预测任务已中断"
    return task


def load_prediction_history() -> None:
    if not PREDICTION_HISTORY.exists():
        return
    try:
        loaded = json.loads(PREDICTION_HISTORY.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return
    if not isinstance(loaded, list):
        return
    restored: dict[str, PredictionTask] = {}
    for item in loaded[:MAX_PREDICT_TASK_HISTORY]:
        if isinstance(item, dict):
            task = _task_from_record(item)
            if task:
                restored[task.id] = task
    with predict_tasks_lock:
        predict_tasks.update(restored)
        if any(task.status == "interrupted" for task in restored.values()):
            _write_history(_history_records())


def _prediction_image_payload(path: Path, task: PredictionTask | None = None) -> dict[str, Any]:
    rel = path.relative_to(ROOT).as_posix()
    stat = path.stat()
    return {
        "name": path.name,
        "url": f"/files/{rel}",
        "path": rel,
        "mtime": stat.st_mtime,
        "sizeBytes": stat.st_size,
        "taskId": task.id if task else None,
        "profile": task.profile if task else None,
        "modelSource": task.model_source if task else None,
        "modelSha256": task.model_sha256 if task else None,
        "conf": task.conf if task else None,
        "createdAt": task.created_at if task else stat.st_mtime,
        "detectionCount": len(task.detections) if task else None,
        "outputDir": str(task.output_dir.relative_to(ROOT).as_posix()) if task and task.output_dir else None,
    }


def _task_for_result(path: Path) -> PredictionTask | None:
    try:
        resolved = path.resolve()
    except OSError:
        return None
    with predict_tasks_lock:
        for task in predict_tasks.values():
            if task.output_dir and task.output_dir.resolve() == resolved.parent:
                return task
    return None


def _safe_upload_file(path: Path) -> bool:
    """只允许在上传暂存目录内读取重试源文件，避免历史记录污染导致越界复制。"""
    try:
        resolved = path.resolve(strict=False)
        upload_root = UPLOADS.resolve()
        return resolved.parent == upload_root and resolved.is_file() and not path.is_symlink()
    except (OSError, ValueError):
        return False


def protected_storage_paths() -> tuple[list[Path], list[Path]]:
    """返回不能被配额清理的活动结果目录和仍可重试的上传文件。"""
    output_dirs: list[Path] = []
    upload_files: list[Path] = []
    with predict_tasks_lock:
        tasks = list(predict_tasks.values())
    for task in tasks:
        if task.status in PREDICTION_ACTIVE_STATUSES and task.output_dir:
            output_dirs.append(task.output_dir)
        if task.upload_path:
            # 活动任务的输入不能被清理；失败 / 中断任务的输入按上传目录 TTL 回收，
            # 过期后重试会明确提示原始文件已不存在。
            if task.status in {"queued", "running", "stopping"} and _safe_upload_file(task.upload_path):
                upload_files.append(task.upload_path)
    return output_dirs, upload_files


def maintain_prediction_storage(
    force: bool = False,
    protected_prediction_dirs: list[Path] | None = None,
) -> dict[str, Any]:
    output_dirs, upload_files = protected_storage_paths()
    if protected_prediction_dirs:
        output_dirs.extend(protected_prediction_dirs)
    return prune_storage(
        protected_prediction_dirs=output_dirs,
        protected_upload_files=upload_files,
        force=force,
    )


def list_predictions(
    limit: int | None = 48,
    since: float | None = None,
    until: float | None = None,
    task_id: str | None = None,
    profile: str | None = None,
    model: str | None = None,
    min_conf: float | None = None,
) -> list[dict[str, Any]]:
    maintain_prediction_storage(force=False)
    if limit is not None:
        limit = min(max(1, limit), MAX_PREDICT_LIMIT)
    files: dict[str, dict[str, Any]] = {}
    legacy_root = ROOT / "runs"
    candidates = list(PREDICT_RUNS.glob("*/*")) + list(legacy_root.glob("web_predict_*/*"))
    for path in candidates:
        if not (path.is_file() and path.suffix.lower() in IMAGE_EXTS):
            continue
        try:
            item = _prediction_image_payload(path, _task_for_result(path))
        except (OSError, ValueError):
            continue
        files[item["path"]] = item
    result = []
    for item in files.values():
        if since is not None and item["mtime"] < since:
            continue
        if until is not None and item["mtime"] > until:
            continue
        if task_id and item.get("taskId") != task_id:
            continue
        if profile and item.get("profile") != profile:
            continue
        if model and item.get("modelSource") != model and item.get("modelSha256") != model:
            continue
        if min_conf is not None and (item.get("conf") is None or item["conf"] < min_conf):
            continue
        result.append(item)
    ordered = sorted(result, key=lambda item: item["mtime"], reverse=True)
    return ordered if limit is None else ordered[:limit]


def _is_prediction_result(path: Path) -> bool:
    if not path.is_file() or path.suffix.lower() not in IMAGE_EXTS:
        return False
    try:
        resolved = path.resolve()
        new_root = PREDICT_RUNS.resolve()
        legacy_root = (ROOT / "runs").resolve()
        return (
            resolved.parent.parent == new_root
            or (resolved.parent.parent == legacy_root and resolved.parent.name.startswith("web_predict_"))
        )
    except OSError:
        return False


def _safe_prediction_dir(path: Path) -> bool:
    try:
        resolved = path.resolve(strict=False)
        new_root = PREDICT_RUNS.resolve()
        if resolved != new_root and new_root in resolved.parents and len(resolved.relative_to(new_root).parts) == 1:
            return True
        legacy_root = (ROOT / "runs").resolve()
        return (
            resolved.parent == legacy_root
            and resolved.name.startswith("web_predict_")
        )
    except (OSError, ValueError):
        return False


def _remove_task_output(task: PredictionTask) -> bool:
    if not task.output_dir or not _safe_prediction_dir(task.output_dir):
        return False
    try:
        shutil.rmtree(task.output_dir)
        return True
    except FileNotFoundError:
        return False
    except OSError:
        return False


def delete_prediction_records(paths: list[str]) -> dict[str, Any]:
    deleted: list[str] = []
    not_found: list[str] = []
    deleted_set: set[str] = set()
    for rel in paths:
        try:
            resolved = (ROOT / rel).resolve(strict=False)
        except Exception:
            not_found.append(rel)
            continue
        if not _is_prediction_result(resolved):
            not_found.append(rel)
            continue
        try:
            resolved.unlink(missing_ok=True)
            resolved.parent.rmdir()
        except OSError:
            pass
        deleted.append(rel)
        deleted_set.add(rel.replace("\\", "/"))

    if deleted_set:
        with predict_tasks_lock:
            for task in predict_tasks.values():
                task.images = [item for item in task.images if item.get("path") not in deleted_set]
            _write_history(_history_records())
    if not deleted and not_found:
        raise HTTPException(status_code=404, detail="未找到要删除的预测结果")
    return {"deleted": deleted, "notFound": not_found}


def prediction_stats(
    task_id: str | None = None,
    profile: str | None = None,
    model: str | None = None,
) -> dict[str, Any]:
    items = list_predictions(None, task_id=task_id, profile=profile, model=model)
    total_bytes = sum(int(item.get("sizeBytes") or 0) for item in items)
    mtimes = [float(item["mtime"]) for item in items]
    return {
        "count": len(items),
        "totalBytes": total_bytes,
        "oldestAt": min(mtimes) if mtimes else None,
        "newestAt": max(mtimes) if mtimes else None,
        "taskCount": len({item["taskId"] for item in items if item.get("taskId")}),
    }


def cleanup_prediction_records(
    task_ids: list[str] | None = None,
    before: float | None = None,
) -> dict[str, Any]:
    requested = set(task_ids or [])
    deleted_tasks: list[str] = []
    skipped: list[dict[str, str]] = []
    not_found: list[str] = []
    with predict_tasks_lock:
        tasks = list(predict_tasks.values())
    for task in tasks:
        if requested and task.id not in requested:
            continue
        if not requested and before is not None and (task.finished_at or task.created_at) >= before:
            continue
        if task.status in PREDICTION_ACTIVE_STATUSES:
            skipped.append({"taskId": task.id, "reason": "任务正在运行或排队"})
            continue
        if requested and task.id not in predict_tasks:
            not_found.append(task.id)
            continue
        _remove_task_output(task)
        if task.images:
            task.images = []
        deleted_tasks.append(task.id)
    if requested:
        existing = {task.id for task in tasks}
        not_found.extend(sorted(requested - existing))
    if deleted_tasks:
        with predict_tasks_lock:
            _write_history(_history_records())
    return {"deletedTasks": deleted_tasks, "skipped": skipped, "notFound": sorted(set(not_found))}


def request_prediction_cancel(task_id: str, reason: str = "用户取消") -> PredictionTask:
    with predict_tasks_lock:
        task = predict_tasks.get(task_id)
        if task is None:
            raise HTTPException(status_code=404, detail="预测任务不存在")
        if task.status in PREDICTION_TERMINAL_STATUSES:
            return task
        task.cancel_requested = True
        task.cancel_reason = reason.strip()[:200] or "用户取消"
        task.cancel_event.set()
        if task.status == "queued":
            task.status = "cancelled"
            task.finished_at = time.time()
            task.message = f"预测任务已取消：{task.cancel_reason}"
        elif task.status == "running":
            task.status = "stopping"
            task.message = "正在停止推理，当前模型调用结束后清理结果..."
        _write_history(_history_records())
    if task.status == "cancelled":
        try:
            task.upload_path.unlink(missing_ok=True)
        except OSError:
            pass
    return task


def retry_prediction_task(task_id: str) -> PredictionTask:
    with predict_tasks_lock:
        source = predict_tasks.get(task_id)
    if source is None:
        raise HTTPException(status_code=404, detail="预测任务不存在")
    if source.status not in {"failed", "interrupted"}:
        raise HTTPException(status_code=409, detail="只有失败或服务中断的任务可以重试")
    if not _safe_upload_file(source.upload_path):
        raise HTTPException(status_code=409, detail="原始上传文件已不存在，无法重试")
    suffix = source.upload_path.suffix.lower() or ".jpg"
    upload_path = source.upload_path.with_name(f"retry_{uuid.uuid4().hex[:12]}{suffix}")
    try:
        source_size = source.upload_path.stat().st_size
    except OSError as exc:
        raise HTTPException(status_code=409, detail="原始上传文件已不存在，无法重试") from exc
    _, protected_uploads = protected_storage_paths()
    # 重试源文件本身必须在清理锁内受保护，避免过期清理与复制之间发生竞态。
    protected_uploads.append(source.upload_path)
    try:
        with upload_storage_slot(source_size, protected_upload_files=protected_uploads) as capacity_available:
            if not capacity_available:
                raise HTTPException(status_code=507, detail="上传目录容量已满，请清理历史预测或上传文件后重试")
            shutil.copy2(source.upload_path, upload_path)
    except HTTPException:
        raise
    except OSError as exc:
        try:
            upload_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise HTTPException(status_code=500, detail=f"复制重试输入文件失败：{exc}") from exc
    task = PredictionTask(
        id=uuid.uuid4().hex[:12],
        profile=source.profile,
        upload_path=upload_path,
        conf=source.conf,
        model_selector=source.model_selector,
        original_filename=source.original_filename,
        input_sha256=file_sha256(upload_path),
        input_size=upload_path.stat().st_size,
        parent_task_id=source.id,
        message="等待中：正在排队等待重试",
    )
    persist_prediction_task(task)
    try:
        predict_queue.put_nowait(task)
    except queue.Full:
        remove_prediction_task(task.id)
        upload_path.unlink(missing_ok=True)
        raise HTTPException(status_code=429, detail="预测队列已满，请稍后再试")
    return task


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
        "durationMs": task.duration_ms,
        "model": task.model,
        "modelSource": task.model_source,
        "modelSelector": task.model_selector,
        "cancelRequested": task.cancel_requested,
        "cancelReason": task.cancel_reason,
        "originalFilename": task.original_filename,
        "inputSha256": task.input_sha256,
        "inputSize": task.input_size,
        "modelSha256": task.model_sha256,
        "parentTaskId": task.parent_task_id,
        "conf": task.conf,
        "detections": task.detections,
        "images": task.images,
    }
    if include_predictions and task.status == "completed":
        payload["predictions"] = list(task.images)
    return payload


def _check_cancelled(task: PredictionTask) -> None:
    if task.cancel_event.is_set() or task.cancel_requested:
        raise _PredictionCancelled(task.cancel_reason or "用户取消")


def run_prediction(task: PredictionTask) -> None:
    started = time.monotonic()
    try:
        _check_cancelled(task)
        model_path, task.model_source = resolve_model_selector(task.model_selector, task.profile)
        task.model = str(model_path)
        task.model_sha256 = file_sha256(model_path)
        task.message = "推理中：正在使用模型生成检测结果..."
        persist_prediction_task(task)
        _check_cancelled(task)

        model = load_model(model_path)
        task.output_dir = PREDICT_RUNS / task.id
        maintain_prediction_storage(force=True, protected_prediction_dirs=[task.output_dir])
        _check_cancelled(task)
        with predict_lock:
            results = model.predict(
                source=str(task.upload_path),
                imgsz=640,
                conf=task.conf,
                save=True,
                project=str(PREDICT_RUNS),
                name=task.id,
                exist_ok=False,
                device="cpu" if not torch.cuda.is_available() else 0,
            )
        _check_cancelled(task)

        detections = []
        for result in results:
            _check_cancelled(task)
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

        images = []
        task.detections = detections
        if task.output_dir.exists():
            images = []
            for image in task.output_dir.iterdir():
                if image.is_file() and image.suffix.lower() in IMAGE_EXTS:
                    images.append(_prediction_image_payload(image, task))
        task.images = images
        task.status = "completed"
        task.message = f"检测到 {len(detections)} 个目标" if detections else "未检测到目标"
    except _PredictionCancelled as exc:
        task.cancel_requested = True
        task.cancel_reason = task.cancel_reason or str(exc)
        _remove_task_output(task)
        task.images = []
        task.status = "cancelled"
        task.message = f"预测任务已取消：{task.cancel_reason}"
    except Exception as exc:
        if task.cancel_event.is_set() or task.cancel_requested:
            task.cancel_requested = True
            task.cancel_reason = task.cancel_reason or "用户取消"
            _remove_task_output(task)
            task.images = []
            task.status = "cancelled"
            task.message = f"预测任务已取消：{task.cancel_reason}"
        else:
            task.error = str(exc)
            task.message = f"推理失败：{exc}"
            task.status = "failed"
    finally:
        task.finished_at = time.time()
        task.duration_ms = max(0, round((time.monotonic() - started) * 1000))
        if task.status in {"completed", "cancelled"}:
            try:
                task.upload_path.unlink(missing_ok=True)
            except OSError:
                pass
        maintain_prediction_storage(
            force=True,
            protected_prediction_dirs=[task.output_dir] if task.output_dir else None,
        )
        persist_prediction_task(task)


def predict_worker() -> None:
    while True:
        task = predict_queue.get()
        try:
            if task.cancel_event.is_set() or task.status == "cancelled":
                if task.status != "cancelled":
                    task.status = "cancelled"
                    task.finished_at = time.time()
                    task.message = f"预测任务已取消：{task.cancel_reason or '用户取消'}"
                try:
                    task.upload_path.unlink(missing_ok=True)
                except OSError:
                    pass
                persist_prediction_task(task)
                continue
            with predict_tasks_lock:
                if task.cancel_event.is_set() or task.status == "cancelled":
                    task.status = "cancelled"
                    task.finished_at = task.finished_at or time.time()
                    task.message = f"预测任务已取消：{task.cancel_reason or '用户取消'}"
                    should_skip = True
                else:
                    task.status = "running"
                    task.started_at = time.time()
                    task.message = "推理中：正在使用模型生成检测结果..."
                    should_skip = False
            if should_skip:
                try:
                    task.upload_path.unlink(missing_ok=True)
                except OSError:
                    pass
                persist_prediction_task(task)
                continue
            persist_prediction_task(task)
            run_prediction(task)
        finally:
            predict_queue.task_done()


load_prediction_history()
predict_worker_thread = threading.Thread(target=predict_worker, daemon=True)
predict_worker_thread.start()
