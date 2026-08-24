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
    assert {"datasetCounts", "datasetIndex", "imageDimensions", "thumbnails", "storage"}.issubset(result)
    assert {"hits", "misses", "entries", "hitRate"}.issubset(result["datasetCounts"])
    assert {"hits", "misses", "entries", "hitRate"}.issubset(result["imageDimensions"])
    assert {"hits", "misses", "entries", "bytes", "hitRate"}.issubset(result["thumbnails"])



def test_dataset_images_pagination_label_filter_and_missing_file(monkeypatch, tmp_path):
    import webui.routes.datasets as routes
    import webui.services.datasets as service

    images_dir = tmp_path / "images" / "train"
    labels_dir = tmp_path / "labels" / "train"
    images_dir.mkdir(parents=True)
    labels_dir.mkdir(parents=True)
    for i in range(1, 13):
        (images_dir / f"img_{i:02d}.jpg").write_bytes(b"x")
    (labels_dir / "img_02.txt").write_text("0 0.5 0.5 0.2 0.2\n", encoding="utf-8")
    (labels_dir / "img_10.txt").write_text("0 0.5 0.5 0.2 0.2\n", encoding="utf-8")

    def fake_split_paths(_profile, _split):
        return images_dir, labels_dir

    monkeypatch.setattr(routes, "split_paths", fake_split_paths)
    monkeypatch.setattr(service, "split_paths", fake_split_paths)
    monkeypatch.setattr(routes, "profile_classes", lambda profile: [])
    monkeypatch.setattr(routes, "resolve_profile", lambda profile: profile)
    monkeypatch.setattr(service, "ROOT", tmp_path)
    monkeypatch.setattr(service, "dataset_index_cache", {})

    page2 = routes.dataset_images(profile="tmp", split="train", page=2, page_size=5, label="all")
    assert page2["total"] == 12
    assert page2["page"] == 2
    assert page2["pageCount"] == 3
    assert [img["name"] for img in page2["images"]] == [
        "img_06.jpg",
        "img_07.jpg",
        "img_08.jpg",
        "img_09.jpg",
        "img_10.jpg",
    ]

    labeled = routes.dataset_images(profile="tmp", split="train", page_size=60, label="labeled")
    assert [img["name"] for img in labeled["images"]] == ["img_02.jpg", "img_10.jpg"]

    unlabeled = routes.dataset_images(profile="tmp", split="train", page_size=60, label="unlabeled")
    assert len(unlabeled["images"]) == 10
    assert all(not img["hasLabel"] for img in unlabeled["images"])

    # 索引命中后文件被外部删除：跳过该页缺失文件并失效索引，下一次请求重建
    (images_dir / "img_12.jpg").unlink()
    after_delete = routes.dataset_images(profile="tmp", split="train", page=3, page_size=5, label="all")
    assert [img["name"] for img in after_delete["images"]] == ["img_11.jpg"]
    rebuilt = routes.dataset_images(profile="tmp", split="train", page=3, page_size=5, label="all")
    assert rebuilt["total"] == 11
    assert [img["name"] for img in rebuilt["images"]] == ["img_11.jpg"]
def _save_labels_setup(monkeypatch, tmp_path):
    import webui.routes.datasets as routes
    import webui.services.datasets as service

    images_dir = tmp_path / "images" / "train"
    labels_dir = tmp_path / "labels" / "train"
    images_dir.mkdir(parents=True)
    labels_dir.mkdir(parents=True)
    image = images_dir / "a.jpg"
    image.write_bytes(b"jpeg-data")

    def fake_split_paths(_profile, _split):
        return images_dir, labels_dir

    monkeypatch.setattr(routes, "split_paths", fake_split_paths)
    monkeypatch.setattr(service, "split_paths", fake_split_paths)
    monkeypatch.setattr(routes, "profile_classes", lambda profile: [{"id": 0, "name": "cat"}])
    monkeypatch.setattr(routes, "resolve_profile", lambda profile: profile)
    monkeypatch.setattr(routes, "dataset_counts", lambda profile: {"total": 1})
    monkeypatch.setattr(service, "ROOT", tmp_path)
    monkeypatch.setattr(service, "image_dimensions", lambda path: (100, 80))
    return routes, labels_dir, image


def _save_request(routes, boxes=None, expected_label_mtime=None):
    return routes.SaveLabelsRequest(
        profile="tmp",
        split="train",
        filename="a.jpg",
        boxes=boxes or [],
        expected_label_mtime=expected_label_mtime,
    )


ONE_BOX_LABEL = "0 0.1 0.1 0.1 0.1"
SAVED_LABEL = "0 0.500000 0.500000 0.200000 0.300000"


def test_save_labels_creates_label_and_reports_label_mtime(monkeypatch, tmp_path):
    routes, labels_dir, _image = _save_labels_setup(monkeypatch, tmp_path)

    result = routes.save_dataset_labels(
        _save_request(
            routes,
            boxes=[{"class_id": 0, "x": 0.5, "y": 0.5, "width": 0.2, "height": 0.3}],
            expected_label_mtime=None,
        )
    )
    label = labels_dir / "a.txt"
    assert label.exists()
    assert label.read_text(encoding="utf-8").strip() == SAVED_LABEL
    img = result["image"]
    assert img["labelCount"] == 1
    assert img["labelMtime"] == pytest.approx(label.stat().st_mtime)
    assert result["dataset"] == {"total": 1}


def test_save_labels_conflicts_when_label_file_appeared(monkeypatch, tmp_path):
    # 客户端加载时无标签文件（expected=None），另一个窗口先写入了标签 → 409
    routes, labels_dir, _image = _save_labels_setup(monkeypatch, tmp_path)
    (labels_dir / "a.txt").write_text(ONE_BOX_LABEL, encoding="utf-8")

    with pytest.raises(HTTPException) as exc:
        routes.save_dataset_labels(_save_request(routes, expected_label_mtime=None))
    assert exc.value.status_code == 409
    assert "其他窗口" in exc.value.detail


def test_save_labels_conflicts_on_stale_mtime(monkeypatch, tmp_path):
    # 客户端持过期 mtime，另一个窗口已改写过标签 → 409
    routes, labels_dir, _image = _save_labels_setup(monkeypatch, tmp_path)
    label = labels_dir / "a.txt"
    label.write_text(ONE_BOX_LABEL, encoding="utf-8")
    stale = label.stat().st_mtime - 1000

    with pytest.raises(HTTPException) as exc:
        routes.save_dataset_labels(_save_request(routes, expected_label_mtime=stale))
    assert exc.value.status_code == 409


def test_save_labels_succeeds_with_current_mtime(monkeypatch, tmp_path):
    # 客户端持有当前 mtime，正常覆盖保存
    routes, labels_dir, _image = _save_labels_setup(monkeypatch, tmp_path)
    label = labels_dir / "a.txt"
    label.write_text(ONE_BOX_LABEL, encoding="utf-8")
    current = label.stat().st_mtime

    result = routes.save_dataset_labels(
        _save_request(routes, boxes=[{"class_id": 0, "x": 0.2, "y": 0.2, "width": 0.3, "height": 0.3}], expected_label_mtime=current)
    )
    assert result["image"]["labelCount"] == 1
    assert label.read_text(encoding="utf-8").strip().startswith("0 0.200000")


def test_files_route_cache_control_and_boundary(tmp_path, monkeypatch):
    from webui.routes import files as files_route

    datasets_dir = tmp_path / "datasets"
    predict_dir = tmp_path / "runs" / "web_predict"
    uploads_dir = tmp_path / "uploads"
    datasets_dir.mkdir()
    predict_dir.mkdir(parents=True)
    uploads_dir.mkdir()
    (datasets_dir / "img.jpg").write_bytes(b"jpeg-bytes")
    (predict_dir / "result.jpg").write_bytes(b"jpeg-result")
    (uploads_dir / "model.pt").write_bytes(b"model-bytes")

    monkeypatch.setattr(files_route, "ROOT", tmp_path)
    monkeypatch.setattr(files_route, "FILE_ROOTS", (datasets_dir, tmp_path / "runs", uploads_dir))
    monkeypatch.setattr(files_route, "PREDICT_RUNS", predict_dir)

    # 数据集图片 → public 缓存（可被浏览器缓存 1 小时）
    resp = files_route.files("datasets/img.jpg")
    assert resp.headers["cache-control"] == "public, max-age=3600"

    # 预测结果 → no-store（可能被清理或覆盖，避免陈旧缓存）
    resp2 = files_route.files("runs/web_predict/result.jpg")
    assert resp2.headers["cache-control"] == "private, no-store"

    # 上传/模型 → public 缓存
    resp3 = files_route.files("uploads/model.pt")
    assert resp3.headers["cache-control"] == "public, max-age=3600"

    # 边界外路径 → 403
    with pytest.raises(HTTPException) as exc:
        files_route.files("../outside.txt")
    assert exc.value.status_code == 403

    # 不存在的文件 → 404
    with pytest.raises(HTTPException) as exc2:
        files_route.files("runs/not-found.jpg")
    assert exc2.value.status_code == 404
