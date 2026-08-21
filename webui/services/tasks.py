from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from ..config import MAX_TASK_LOGS_TO_KEEP, ROOT, TASK_HISTORY, TASK_LOGS
from .training_metrics import parse_training_metrics


TASK_SCHEMA_VERSION = 2
_ACTIVE_STATUSES = {"running", "stopping"}
_TERMINAL_STATUSES = {"success", "failed", "cancelled", "interrupted"}


@dataclass
class ManagedTask:
    id: str
    kind: str
    command: list[str]
    profile: str | None = None
    params: dict[str, Any] = field(default_factory=dict)
    status: str = "running"
    started_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    returncode: int | None = None
    log_path: Path | None = None
    process: subprocess.Popen[str] | None = None
    stop_requested: bool = False
    cancel_reason: str | None = None
    message: str | None = None
    error: str | None = None
    metrics: dict[str, Any] | None = None
    result_dir: Path | None = None
    parent_task_id: str | None = None
    last_heartbeat_at: float = field(default_factory=time.time)
    pid: int | None = None
    schema_version: int = TASK_SCHEMA_VERSION


task_lock = threading.Lock()
history_lock = threading.Lock()
task_history_store: list[dict[str, Any]] = []
current_task: ManagedTask | None = None


def _safe_run_component(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9_-]+", "_", value).strip("_")
    return value[:48] or "task"


def _task_run_dir(task: ManagedTask) -> Path:
    runs_root = (ROOT / "runs").resolve()
    mode = _safe_run_component(str(task.params.get("mode") or "train"))
    profile = _safe_run_component(str(task.profile or "default"))
    return runs_root / f"{profile}_{mode}_{task.id}"


def _replace_run_name(command: list[str], run_name: str) -> list[str]:
    updated = list(command)
    try:
        index = updated.index("--name")
    except ValueError:
        return updated
    if index + 1 < len(updated):
        updated[index + 1] = run_name
    return updated


def _touch(task: ManagedTask) -> None:
    task.last_heartbeat_at = time.time()


def mark_running(task: ManagedTask, process: subprocess.Popen[str]) -> None:
    """集中记录子进程已启动，避免路由和 worker 各自修改任务状态。"""
    with task_lock:
        task.process = process
        task.pid = process.pid
        task.status = "stopping" if task.stop_requested else "running"
        _touch(task)
    persist_task_record(task)


def request_stop(task: ManagedTask, reason: str = "用户请求停止") -> bool:
    """请求停止任务；重复请求保持幂等并返回 False。"""
    with task_lock:
        if task.status not in _ACTIVE_STATUSES:
            return False
        if task.stop_requested:
            return False
        task.stop_requested = True
        task.cancel_reason = reason
        task.status = "stopping"
        _touch(task)
    persist_task_record(task)
    return True


def terminate_task_process(task: ManagedTask) -> None:
    """终止已经启动的训练子进程。实际状态由 worker 在 wait 后确认。"""
    process = task.process
    if process is None or process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, text=True)
    else:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass


def mark_finished(task: ManagedTask, returncode: int | None, error: str | None = None) -> None:
    """集中完成任务状态迁移，保证停止竞态最终只落盘一个终态。"""
    with task_lock:
        task.returncode = returncode
        task.finished_at = time.time()
        task.error = error
        if task.stop_requested:
            task.status = "cancelled"
            task.message = task.message or f"训练任务已取消：{task.cancel_reason or '用户请求停止'}"
        else:
            task.status = "success" if returncode == 0 else "failed"
            if task.status == "success":
                task.message = task.message or "训练任务已完成"
            else:
                task.message = task.message or (f"训练任务执行失败：{error}" if error else "训练任务执行失败")
        _touch(task)
    persist_task_record(task)


def mark_interrupted(record: dict[str, Any], now: float | None = None) -> dict[str, Any]:
    """将历史中的活动任务迁移为中断；服务不自动接管未知 PID。"""
    migrated = _migrate_task_record(record)
    if migrated.get("status") in _ACTIVE_STATUSES:
        timestamp = now or time.time()
        migrated["status"] = "interrupted"
        migrated["finishedAt"] = migrated.get("finishedAt") or timestamp
        migrated["lastHeartbeatAt"] = timestamp
        migrated["message"] = "服务重启导致任务中断，请重新启动训练"
    return migrated


def run_command(command: list[str], task: ManagedTask) -> None:
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    log_path = TASK_LOGS / f"{task.id}.log"
    task.log_path = log_path
    process: subprocess.Popen[str] | None = None
    finished = False

    with log_path.open("w", encoding="utf-8", errors="replace") as log:
        log.write(f"$ {' '.join(command)}\n\n")
        log.flush()
        try:
            process = subprocess.Popen(
                command,
                cwd=ROOT,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=env,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
                start_new_session=os.name != "nt",
            )
            mark_running(task, process)
            if task.stop_requested:
                terminate_task_process(task)
            assert process.stdout is not None
            last_persisted = time.monotonic()
            for line in process.stdout:
                log.write(line)
                log.flush()
                _touch(task)
                if time.monotonic() - last_persisted >= 5:
                    persist_task_record(task)
                    last_persisted = time.monotonic()

            task.returncode = process.wait()
            refresh_task_metrics(task)
            mark_finished(task, task.returncode)
            finished = True
            log.write(f"\n[exit {task.returncode}]\n")
            if task.metrics:
                log.write(f"[metrics] epoch={task.metrics['current']['epoch']} mAP50-95={task.metrics['current'].get('mAP50_95')}\n")
        except Exception as exc:
            if process is not None and process.poll() is None:
                terminate_task_process(task)
            if not finished:
                task.message = "训练任务启动或执行异常"
                mark_finished(task, process.returncode if process is not None else None, error=str(exc))
                finished = True
            log.write(f"\n[error] {exc}\n")


def start_task(
    kind: str,
    command: list[str],
    *,
    profile: str | None = None,
    params: dict[str, Any] | None = None,
    parent_task_id: str | None = None,
) -> ManagedTask:
    global current_task
    with task_lock:
        if current_task and current_task.status in _ACTIVE_STATUSES:
            raise HTTPException(status_code=409, detail="已有任务正在运行或正在停止")

        task = ManagedTask(
            id=uuid.uuid4().hex[:12],
            kind=kind,
            command=list(command),
            profile=profile,
            params=dict(params or {}),
            parent_task_id=parent_task_id,
        )
        if "train" in kind:
            run_dir = _task_run_dir(task)
            task.result_dir = run_dir
            task.params["requestedRunName"] = task.params.get("runName")
            task.params["runName"] = run_dir.name
            task.params["runDir"] = str(run_dir)
            task.command = _replace_run_name(task.command, run_dir.name)
        current_task = task
        persist_task_record(task)
        thread = threading.Thread(target=run_command, args=(task.command, task), daemon=True)
        thread.start()
        return task


def refresh_task_metrics(task: ManagedTask | None) -> None:
    """只从任务自己的结果目录读取 results.csv，避免同名前缀目录误匹配。"""
    if task is None or "train" not in task.kind:
        return
    run_dir = task.result_dir
    if run_dir is None:
        raw_run_dir = task.params.get("runDir")
        if isinstance(raw_run_dir, str) and raw_run_dir:
            run_dir = Path(raw_run_dir).resolve()
    if run_dir is None:
        return
    try:
        run_dir = run_dir.resolve()
        run_dir.relative_to((ROOT / "runs").resolve())
    except (OSError, ValueError):
        return
    csv_path = run_dir / "results.csv"
    try:
        if not csv_path.is_file() or csv_path.stat().st_mtime < task.started_at - 1:
            return
    except OSError:
        return
    metrics = parse_training_metrics(run_dir)
    if metrics is not None:
        task.result_dir = run_dir
        task.params["runDir"] = str(run_dir)
        task.metrics = metrics
        _touch(task)


def task_payload(task: ManagedTask | None) -> dict[str, Any] | None:
    if task is None:
        return None
    return {
        "id": task.id,
        "schemaVersion": task.schema_version,
        "kind": task.kind,
        "profile": task.profile,
        "params": task.params,
        "status": task.status,
        "startedAt": task.started_at,
        "finishedAt": task.finished_at,
        "returncode": task.returncode,
        "command": task.command,
        "metrics": task.metrics,
        "resultDir": str(task.result_dir) if task.result_dir else task.params.get("runDir"),
        "runDir": str(task.result_dir) if task.result_dir else task.params.get("runDir"),
        "parentTaskId": task.parent_task_id,
        "cancelReason": task.cancel_reason,
        "message": task.message,
        "error": task.error,
        "lastHeartbeatAt": task.last_heartbeat_at,
        "pid": task.pid,
    }


def task_record(task: ManagedTask) -> dict[str, Any]:
    return task_payload(task) or {}


def persist_task_record(task: ManagedTask) -> None:
    record = task_record(task)
    with history_lock:
        task_history_store[:] = [item for item in task_history_store if item.get("id") != record["id"]]
        task_history_store.insert(0, record)
        task_history_store[:] = task_history_store[:50]
        TASK_HISTORY.parent.mkdir(parents=True, exist_ok=True)
        temp_path = TASK_HISTORY.with_name(f".{TASK_HISTORY.name}.{uuid.uuid4().hex}.tmp")
        try:
            temp_path.write_text(
                json.dumps(task_history_store, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            temp_path.replace(TASK_HISTORY)
        finally:
            try:
                temp_path.unlink(missing_ok=True)
            except OSError:
                pass
    prune_task_logs()


def prune_task_logs() -> None:
    logs = sorted(TASK_LOGS.glob("*.log"), key=lambda path: path.stat().st_mtime, reverse=True)
    for log_path in logs[MAX_TASK_LOGS_TO_KEEP:]:
        try:
            log_path.unlink(missing_ok=True)
        except OSError:
            pass


def _migrate_task_record(item: dict[str, Any]) -> dict[str, Any]:
    """将旧版 snake/camel 混用的任务历史补齐到当前 schema。"""
    record = dict(item)
    record["schemaVersion"] = int(record.get("schemaVersion") or 1)
    record.setdefault("parentTaskId", record.get("parent_task_id"))
    record.setdefault("cancelReason", record.get("cancel_reason"))
    record.setdefault("message", None)
    record.setdefault("error", None)
    record.setdefault("lastHeartbeatAt", record.get("last_heartbeat_at") or record.get("startedAt") or time.time())
    record.setdefault("pid", record.get("pid"))
    params = record.get("params")
    if not isinstance(params, dict):
        record["params"] = {}
    run_dir = record.get("runDir") or record.get("resultDir") or record["params"].get("runDir")
    if run_dir:
        record["runDir"] = run_dir
        record["resultDir"] = record.get("resultDir") or run_dir
        record["params"].setdefault("runDir", run_dir)
    record["schemaVersion"] = TASK_SCHEMA_VERSION
    return record


def load_task_history() -> None:
    global task_history_store
    if not TASK_HISTORY.exists():
        return
    try:
        loaded = json.loads(TASK_HISTORY.read_text(encoding="utf-8"))
        if isinstance(loaded, list):
            restored = []
            for item in loaded:
                if not isinstance(item, dict):
                    continue
                restored.append(mark_interrupted(item))
            task_history_store = restored[:50]
    except (json.JSONDecodeError, OSError, TypeError, ValueError):
        task_history_store = []


load_task_history()
