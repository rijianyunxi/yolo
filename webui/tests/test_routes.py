from __future__ import annotations

import queue
from pathlib import Path
from tempfile import TemporaryFile

import pytest
from fastapi import HTTPException
from starlette.datastructures import UploadFile

from webui.routes import predictions as predictions_route
from webui.routes import tasks as tasks_route
from webui.services import predictions as prediction_service
from webui.services import tasks as task_service
from webui.services.tasks import ManagedTask, task_payload


def upload(filename: str, data: bytes = b"image-bytes") -> UploadFile:
    handle = TemporaryFile()
    handle.write(data)
    handle.seek(0)
    return UploadFile(filename=filename, file=handle)


def test_train_route_blocks_before_start_when_dataset_report_has_blocking_issue(monkeypatch):
    called = False

    def fail_start(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("阻断时不应启动训练")

    monkeypatch.setattr(tasks_route, "check_dataset", lambda profile: {"blockingCount": 1, "issues": [{"severity": "blocking", "message": "缺少 train 图片", "split": "train", "filename": None}]})
    monkeypatch.setattr(tasks_route, "save_dataset_report", lambda report: report)
    monkeypatch.setattr(tasks_route, "start_task", fail_start)

    with pytest.raises(HTTPException) as exc:
        tasks_route.run_smoke_train(tasks_route.TrainRequest(profile="cat"))

    assert exc.value.status_code == 409
    assert "训练前数据集检查未通过" in str(exc.value.detail)
    assert called is False


def test_train_route_passes_structured_task_parameters(monkeypatch):
    task = ManagedTask(id="route-task", kind="cpu-smoke-train:cat", command=["python"], profile="cat", params={"mode": "smoke"})
    captured: dict[str, object] = {}
    monkeypatch.setattr(tasks_route, "_ensure_dataset_ready", lambda profile: {"ready": True})
    monkeypatch.setattr(tasks_route, "_train_command", lambda payload, smoke: (["python", "train.py"], {"mode": "smoke", "epochs": 5}))

    def fake_start(kind, command, **kwargs):
        captured.update({"kind": kind, "command": command, **kwargs})
        return task

    monkeypatch.setattr(tasks_route, "start_task", fake_start)
    result = tasks_route.run_smoke_train(tasks_route.TrainRequest(profile="cat"))

    assert result["task"]["id"] == "route-task"
    assert captured["profile"] == "cat"
    assert captured["params"] == {"mode": "smoke", "epochs": 5}


def test_stop_route_is_idempotent(monkeypatch):
    task = ManagedTask(id="stop-route", kind="full-train:cat", command=[])
    task.status = "running"
    calls: list[str] = []

    def fake_request_stop(current):
        calls.append("request")
        current.status = "stopping"
        return True

    monkeypatch.setattr(task_service, "current_task", task)
    monkeypatch.setattr(tasks_route, "request_stop", fake_request_stop)
    monkeypatch.setattr(tasks_route, "terminate_task_process", lambda current: calls.append("terminate"))
    monkeypatch.setattr(tasks_route, "task_payload", task_payload)

    first = tasks_route.stop_task()
    second = tasks_route.stop_task()

    assert first["task"]["status"] == "stopping"
    assert second["task"]["status"] == "stopping"
    assert calls == ["request", "terminate"]


def test_predict_route_rejects_invalid_confidence_without_writing_file():
    with pytest.raises(HTTPException) as exc:
        predictions_route.predict(upload("test.jpg"), conf=1.2, profile="cat", model="")
    assert exc.value.status_code == 400


def test_predict_route_returns_queued_task_and_persists_upload(monkeypatch, tmp_path):
    queued: list[object] = []
    monkeypatch.setattr(predictions_route, "UPLOADS", tmp_path)
    monkeypatch.setattr(predictions_route, "resolve_profile", lambda profile: profile)
    monkeypatch.setattr(predictions_route, "file_sha256", lambda path: "sha")
    monkeypatch.setattr(predictions_route, "persist_prediction_task", lambda task: None)
    monkeypatch.setattr(predictions_route.predict_queue, "put_nowait", lambda task: queued.append(task))

    result = predictions_route.predict(upload("猫.jpg", b"abc"), conf=0.4, profile="cat", model="best.pt")

    assert result["status"] == "queued"
    assert result["inputSha256"] == "sha"
    assert len(queued) == 1
    task = queued[0]
    assert task.original_filename == "猫.jpg"
    assert task.upload_path.exists()
    task.upload_path.unlink()


def test_predict_route_cleans_upload_when_queue_is_full(monkeypatch, tmp_path):
    removed: list[str] = []
    monkeypatch.setattr(predictions_route, "UPLOADS", tmp_path)
    monkeypatch.setattr(predictions_route, "resolve_profile", lambda profile: profile)
    monkeypatch.setattr(predictions_route, "file_sha256", lambda path: "sha")
    monkeypatch.setattr(predictions_route, "persist_prediction_task", lambda task: None)
    monkeypatch.setattr(predictions_route, "remove_prediction_task", lambda task_id: removed.append(task_id))

    def full(_task):
        raise queue.Full

    monkeypatch.setattr(predictions_route.predict_queue, "put_nowait", full)
    with pytest.raises(HTTPException) as exc:
        predictions_route.predict(upload("test.jpg"), conf=0.25, profile="cat", model="")

    assert exc.value.status_code == 429
    assert len(removed) == 1
    assert list(tmp_path.iterdir()) == []


def test_cancel_prediction_route_returns_current_state(monkeypatch):
    task = prediction_service.PredictionTask(id="cancel-route", profile="cat", upload_path=Path("missing.jpg"))
    task.status = "completed"
    monkeypatch.setattr(predictions_route, "request_prediction_cancel", lambda task_id, reason: task)
    result = predictions_route.cancel_prediction_task("cancel-route", predictions_route.CancelPredictionRequest(reason="重复取消"))
    assert result["id"] == "cancel-route"
    assert result["status"] == "completed"


def test_retry_prediction_route_maps_service_error(monkeypatch):
    def fail(_task_id):
        raise HTTPException(status_code=409, detail="原始上传文件已不存在，无法重试")

    monkeypatch.setattr(predictions_route, "retry_prediction_task", fail)
    with pytest.raises(HTTPException) as exc:
        predictions_route.retry_prediction("failed-route")
    assert exc.value.status_code == 409


def test_prediction_filter_route_rejects_invalid_min_conf():
    with pytest.raises(HTTPException) as exc:
        predictions_route.predictions(min_conf=1.5)
    assert exc.value.status_code == 400


def test_prediction_cleanup_route_passes_task_ids_and_cutoff(monkeypatch):
    captured: dict[str, object] = {}
    monkeypatch.setattr(predictions_route, "cleanup_prediction_records", lambda task_ids, before: captured.update({"task_ids": task_ids, "before": before}) or {"deletedTasks": []})
    result = predictions_route.cleanup_predictions(predictions_route.CleanupPredictionRequest(task_ids=["a", "b"], before=123.0))
    assert result == {"deletedTasks": []}
    assert captured == {"task_ids": ["a", "b"], "before": 123.0}



def test_cache_stats_route_exposes_lifecycle_metrics():
    from webui.routes import cache as cache_route

    result = cache_route.cache_stats()
    assert {"datasetCounts", "imageDimensions", "thumbnails", "storage"}.issubset(result)
    assert {"hits", "misses", "entries", "hitRate"}.issubset(result["datasetCounts"])
    assert {"hits", "misses", "entries", "hitRate"}.issubset(result["imageDimensions"])
    assert {"hits", "misses", "entries", "bytes", "hitRate"}.issubset(result["thumbnails"])
