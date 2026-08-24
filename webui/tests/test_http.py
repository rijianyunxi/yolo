from __future__ import annotations

import queue
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from webui.app import app
from webui.routes import predictions as predictions_route
from webui.routes import tasks as tasks_route
from webui.services.predictions import PredictionTask, prediction_task_payload
from webui.services.tasks import ManagedTask, task_payload


@pytest.fixture
def client() -> TestClient:
    with TestClient(app) as value:
        yield value


def test_http_predict_accepts_multipart_and_returns_queued_task(monkeypatch, client, tmp_path):
    queued: list[PredictionTask] = []
    monkeypatch.setattr(predictions_route, "UPLOADS", tmp_path)
    monkeypatch.setattr(predictions_route, "resolve_profile", lambda profile: profile)
    monkeypatch.setattr(predictions_route, "file_sha256", lambda path: "sha-http")
    monkeypatch.setattr(predictions_route, "persist_prediction_task", lambda task: None)
    monkeypatch.setattr(predictions_route.predict_queue, "put_nowait", queued.append)

    response = client.post(
        "/api/predict",
        data={"conf": "0.4", "profile": "cat", "model": "best.pt"},
        files={"file": ("猫.jpg", b"jpeg-bytes", "image/jpeg")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "queued"
    assert body["inputSha256"] == "sha-http"
    assert len(queued) == 1
    assert queued[0].original_filename == "猫.jpg"
    assert queued[0].upload_path.exists()
    queued[0].upload_path.unlink()


def test_http_predict_rejects_invalid_extension_and_oversized_upload(monkeypatch, client, tmp_path):
    monkeypatch.setattr(predictions_route, "UPLOADS", tmp_path)
    monkeypatch.setattr(predictions_route, "resolve_profile", lambda profile: profile)

    invalid_extension = client.post(
        "/api/predict",
        data={"conf": "0.25", "profile": "cat"},
        files={"file": ("input.txt", b"not-image", "text/plain")},
    )
    assert invalid_extension.status_code == 400
    assert "仅支持图片文件" in invalid_extension.json()["detail"]
    assert list(tmp_path.iterdir()) == []

    monkeypatch.setattr(predictions_route, "MAX_UPLOAD_BYTES", 3)
    oversized = client.post(
        "/api/predict",
        data={"conf": "0.25", "profile": "cat"},
        files={"file": ("input.jpg", b"1234", "image/jpeg")},
    )
    assert oversized.status_code == 413
    assert "文件过大" in oversized.json()["detail"]
    assert list(tmp_path.iterdir()) == []


def test_http_predict_returns_507_when_upload_storage_is_full(monkeypatch, client, tmp_path):
    monkeypatch.setattr(predictions_route, "UPLOADS", tmp_path)
    monkeypatch.setattr(predictions_route, "resolve_profile", lambda profile: profile)
    monkeypatch.setattr(
        predictions_route,
        "upload_storage_slot",
        lambda incoming_bytes, protected_upload_files=(): _capacity(False),
    )

    response = client.post(
        "/api/predict",
        data={"conf": "0.25", "profile": "cat"},
        files={"file": ("input.jpg", b"123", "image/jpeg")},
    )

    assert response.status_code == 507
    assert "上传目录容量已满" in response.json()["detail"]
    assert list(tmp_path.iterdir()) == []


def _capacity(value: bool):
    class CapacityContext:
        def __enter__(self):
            return value

        def __exit__(self, exc_type, exc, tb):
            return False

    return CapacityContext()


def test_http_predict_queue_full_cleans_temporary_upload(monkeypatch, client, tmp_path):
    monkeypatch.setattr(predictions_route, "UPLOADS", tmp_path)
    monkeypatch.setattr(predictions_route, "resolve_profile", lambda profile: profile)
    monkeypatch.setattr(predictions_route, "file_sha256", lambda path: "sha-full")
    monkeypatch.setattr(predictions_route, "persist_prediction_task", lambda task: None)
    removed: list[str] = []
    monkeypatch.setattr(predictions_route, "remove_prediction_task", lambda task_id: removed.append(task_id))

    def full(_task):
        raise queue.Full

    monkeypatch.setattr(predictions_route.predict_queue, "put_nowait", full)
    response = client.post(
        "/api/predict",
        data={"conf": "0.25", "profile": "cat"},
        files={"file": ("input.jpg", b"123", "image/jpeg")},
    )

    assert response.status_code == 429
    assert "预测队列已满" in response.json()["detail"]
    assert len(removed) == 1
    assert list(tmp_path.iterdir()) == []


def test_http_train_returns_409_before_start_when_dataset_is_blocked(monkeypatch, client):
    started = False

    def fail_start(*args, **kwargs):
        nonlocal started
        started = True
        raise AssertionError("数据集阻断时不应启动训练")

    monkeypatch.setattr(
        tasks_route,
        "check_dataset",
        lambda profile: {
            "blockingCount": 1,
            "issues": [{"severity": "blocking", "message": "缺少 train 图片", "split": "train", "filename": None}],
        },
    )
    monkeypatch.setattr(tasks_route, "save_dataset_report", lambda report: report)
    monkeypatch.setattr(tasks_route, "start_task", fail_start)

    response = client.post("/api/tasks/train-smoke", json={"profile": "cat"})

    assert response.status_code == 409
    assert "训练前数据集检查未通过" in response.json()["detail"]
    assert started is False


def test_http_train_validates_request_and_returns_task(monkeypatch, client):
    task = ManagedTask(id="http-train", kind="cpu-smoke-train:cat", command=["python"], profile="cat", params={"mode": "smoke"})
    captured: dict[str, object] = {}
    monkeypatch.setattr(tasks_route, "_ensure_dataset_ready", lambda profile: {"ready": True})
    monkeypatch.setattr(tasks_route, "_train_command", lambda payload, smoke: (["python", "train.py"], {"mode": "smoke", "epochs": 5}))

    def fake_start(kind, command, **kwargs):
        captured.update({"kind": kind, "command": command, **kwargs})
        return task

    monkeypatch.setattr(tasks_route, "start_task", fake_start)
    response = client.post("/api/tasks/train-smoke", json={"profile": "cat", "epochs": 5})

    assert response.status_code == 200
    assert response.json()["task"]["id"] == "http-train"
    assert captured["profile"] == "cat"
    assert captured["params"] == {"mode": "smoke", "epochs": 5}

    invalid_device = client.post("/api/tasks/train-smoke", json={"profile": "cat", "device": "tpu"})
    assert invalid_device.status_code == 422


def test_http_prediction_task_cancel_retry_and_cleanup_json(monkeypatch, client, tmp_path):
    task = PredictionTask(id="http-prediction", profile="cat", upload_path=tmp_path / "input.jpg")
    task.status = "completed"
    monkeypatch.setattr(predictions_route, "request_prediction_cancel", lambda task_id, reason: task)
    cancelled = client.post("/api/predictions/tasks/http-prediction/cancel", json={"reason": "重复取消"})
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "completed"

    retry_task = PredictionTask(id="http-retry", profile="cat", upload_path=tmp_path / "input.jpg")
    retry_task.status = "failed"
    monkeypatch.setattr(predictions_route, "retry_prediction_task", lambda task_id: retry_task)
    retried = client.post("/api/predictions/tasks/http-retry/retry", json={})
    assert retried.status_code == 200
    assert retried.json()["id"] == "http-retry"
    assert retried.json()["status"] == "failed"

    monkeypatch.setattr(predictions_route, "cleanup_prediction_records", lambda task_ids, before: {"deletedTasks": task_ids, "skipped": [], "notFound": []})
    cleaned = client.post("/api/predictions/cleanup", json={"task_ids": ["http-prediction"]})
    assert cleaned.status_code == 200
    assert cleaned.json()["deletedTasks"] == ["http-prediction"]

    empty_cleanup = client.post("/api/predictions/cleanup", json={})
    assert empty_cleanup.status_code == 400
    assert "请指定任务 ID 或清理时间" in empty_cleanup.json()["detail"]


def test_http_prediction_filter_and_file_path_errors_are_json(client):
    invalid_filter = client.get("/api/predictions?min_conf=1.5")
    assert invalid_filter.status_code == 400
    assert invalid_filter.json()["detail"] == "最小置信度必须在 0 到 1 之间"

    blocked_path = client.get("/files/not-found.jpg")
    assert blocked_path.status_code == 403
    assert blocked_path.json()["detail"] == "无效的文件路径"

    missing_file = client.get("/files/runs/not-found.jpg")
    assert missing_file.status_code == 404
    assert missing_file.json()["detail"] == "文件不存在"


def test_http_unknown_api_returns_json_404(client):
    response = client.get("/api/no-such-endpoint")
    assert response.status_code == 404
    assert response.json()["detail"] == "接口不存在"


def test_http_status_json_returns_plain_status_object(monkeypatch, client):
    # status-json 直接返回 status() 对象，避免 json.dumps -> json.loads 往返
    monkeypatch.setattr(
        "webui.routes.status.dataset_counts",
        lambda profile: {"count": 0, "images": 0, "labels": 0},
    )
    response = client.get("/api/status-json")
    assert response.status_code == 200
    body = response.json()
    assert "profile" in body
    assert "classes" in body
    assert body["dataset"] == {"count": 0, "images": 0, "labels": 0}


def test_http_response_includes_request_id_header(client):
    response = client.get("/api/classes")
    assert response.status_code == 200
    assert response.headers.get("X-Request-Id")



def test_http_cache_stats_reachable_and_exposes_dataset_index(client):
    # cache 路由需在 files 的 catch-all 之前注册，否则 /api/cache/stats 会被吞成 404
    response = client.get("/api/cache/stats")
    assert response.status_code == 200
    body = response.json()
    assert "datasetCounts" in body
    index_stats = body["datasetIndex"]
    assert {"hits", "misses", "expirations", "invalidations", "entries", "hitRate"}.issubset(index_stats)


def test_http_dataset_images_response_matches_schema(client):
    from webui.schemas import DatasetImagesResponse

    response = client.get("/api/dataset/images?profile=cat&split=train&page=1&page_size=3")
    assert response.status_code == 200
    body = response.json()
    # FastAPI response_model 已在序列化时校验；此处再显式验证结构一致
    parsed = DatasetImagesResponse(**body)
    assert parsed.total == body["total"]
    assert len(parsed.images) == len(body["images"])


def test_http_dataset_images_uses_index_and_unknown_api_still_404(client):
    first = client.get("/api/dataset/images?profile=cat&split=train&page=1&page_size=3")
    assert first.status_code == 200
    assert "images" in first.json()

    stats = client.get("/api/cache/stats").json()["datasetIndex"]
    assert stats["misses"] >= 1
    assert stats["entries"] >= 1

    # 再次请求应命中目录索引（hits 增加）
    second = client.get("/api/dataset/images?profile=cat&split=train&page=1&page_size=3")
    assert second.status_code == 200
    stats2 = client.get("/api/cache/stats").json()["datasetIndex"]
    assert stats2["hits"] > stats["hits"]

    unknown = client.get("/api/no-such-endpoint")
    assert unknown.status_code == 404
    assert unknown.json()["detail"] == "接口不存在"
