from __future__ import annotations

import json
import os
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


@dataclass
class ManagedTask:
    id: str
    kind: str
    command: list[str]
    status: str = "running"
    started_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    returncode: int | None = None
    log_path: Path | None = None
    process: subprocess.Popen[str] | None = None


task_lock = threading.Lock()
history_lock = threading.Lock()
task_history_store: list[dict[str, Any]] = []
current_task: ManagedTask | None = None


def run_command(command: list[str], task: ManagedTask) -> None:
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    log_path = TASK_LOGS / f"{task.id}.log"
    task.log_path = log_path

    with log_path.open("w", encoding="utf-8", errors="replace") as log:
        log.write(f"$ {' '.join(command)}\n\n")
        log.flush()
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
        task.process = process
        assert process.stdout is not None
        for line in process.stdout:
            log.write(line)
            log.flush()

        task.returncode = process.wait()
        task.finished_at = time.time()
        task.status = "success" if task.returncode == 0 else "failed"
        log.write(f"\n[exit {task.returncode}]\n")
        persist_task_record(task)


def start_task(kind: str, command: list[str]) -> ManagedTask:
    global current_task
    with task_lock:
        if current_task and current_task.status == "running":
            raise HTTPException(status_code=409, detail="已有任务正在运行")

        task = ManagedTask(id=uuid.uuid4().hex[:12], kind=kind, command=command)
        current_task = task
        persist_task_record(task)
        thread = threading.Thread(target=run_command, args=(command, task), daemon=True)
        thread.start()
        return task


def task_payload(task: ManagedTask | None) -> dict[str, Any] | None:
    if task is None:
        return None
    return {
        "id": task.id,
        "kind": task.kind,
        "status": task.status,
        "startedAt": task.started_at,
        "finishedAt": task.finished_at,
        "returncode": task.returncode,
        "command": task.command,
    }


def task_record(task: ManagedTask) -> dict[str, Any]:
    return task_payload(task) or {}


def persist_task_record(task: ManagedTask) -> None:
    record = task_record(task)
    with history_lock:
        task_history_store[:] = [item for item in task_history_store if item.get("id") != record["id"]]
        task_history_store.insert(0, record)
        task_history_store[:] = task_history_store[:50]
        TASK_HISTORY.write_text(
            json.dumps(task_history_store, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    prune_task_logs()


def prune_task_logs() -> None:
    logs = sorted(TASK_LOGS.glob("*.log"), key=lambda path: path.stat().st_mtime, reverse=True)
    for log_path in logs[MAX_TASK_LOGS_TO_KEEP:]:
        try:
            log_path.unlink(missing_ok=True)
        except OSError:
            pass


def load_task_history() -> None:
    global task_history_store
    if not TASK_HISTORY.exists():
        return
    try:
        loaded = json.loads(TASK_HISTORY.read_text(encoding="utf-8"))
        if isinstance(loaded, list):
            task_history_store = [item for item in loaded if isinstance(item, dict)][:50]
    except (json.JSONDecodeError, OSError):
        task_history_store = []


load_task_history()
