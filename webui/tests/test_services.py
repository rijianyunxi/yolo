import asyncio
import sys
from pathlib import Path
from tempfile import TemporaryFile

import pytest
from fastapi import HTTPException
from starlette.datastructures import UploadFile

sys.path.insert(0, "D:/work/yolo")

from webui.config import IMAGE_EXTS, DATASET_PROFILES, DEFAULT_PROFILE
from webui.services.dataset_check import check_dataset
from webui.services.training_metrics import parse_training_metrics
from webui.services.resources import training_resource_snapshot
from webui.services.datasets import (
    dataset_counts,
    image_dimensions,
    parse_yolo_labels,
    safe_filename,
    save_upload,
    ensure_thumbnail,
    thumbnail_cache_path,
    save_yolo_labels_atomic,
    split_paths,
    validate_yolo_label_file,
)
from webui.services.predictions import (
    PredictionTask,
    cleanup_prediction_records,
    list_predictions,
    prediction_stats,
    prediction_task_payload,
    request_prediction_cancel,
    retry_prediction_task,
    snapshot_prediction_task,
)
from webui.services.imported_models import import_model
from webui.services.profiles import profile_config, resolve_profile
from webui.services.tasks import ManagedTask, mark_finished, run_command, task_payload
from webui.routes.tasks import TrainRequest, _training_options


def _capacity(value: bool):
    class CapacityContext:
        def __enter__(self):
            return value

        def __exit__(self, exc_type, exc, tb):
            return False

    return CapacityContext()

SMOKE_IMAGE = Path("D:/work/yolo/webui/uploads/smoke_test.jpg")


def make_upload(filename: str, data: bytes) -> UploadFile:
    handle = TemporaryFile()
    handle.write(data)
    handle.seek(0)
    return UploadFile(filename=filename, file=handle)


def test_profile_config_invalid_profile_raises():
    with pytest.raises(HTTPException) as exc:
        profile_config("nonexistent")
    assert exc.value.status_code == 400


def test_profile_config_empty_falls_back_to_default():
    config = profile_config("")
    assert config is DATASET_PROFILES[DEFAULT_PROFILE]


def test_resolve_profile_empty_falls_back_to_default():
    assert resolve_profile("") == DEFAULT_PROFILE


def test_resolve_profile_valid_profile():
    assert resolve_profile(DEFAULT_PROFILE) == DEFAULT_PROFILE


def test_resolve_profile_invalid_raises():
    with pytest.raises(HTTPException) as exc:
        resolve_profile("nonexistent")
    assert exc.value.status_code == 400

def test_split_paths_valid():
    images_dir, labels_dir = split_paths(DEFAULT_PROFILE, "train")
    assert images_dir.name == "train"
    assert labels_dir.name == "train"


def test_split_paths_invalid_split():
    with pytest.raises(HTTPException) as exc:
        split_paths(DEFAULT_PROFILE, "bogus")
    assert exc.value.status_code == 400


def test_parse_yolo_labels_ignores_malformed(tmp_path):
    label = tmp_path / "sample.txt"
    label.write_text("0 0.5 0.5 0.2 0.2\nnot-a-label\n1 0.1 0.1 0.1 0.1\n", encoding="utf-8")
    boxes = parse_yolo_labels(label)
    assert len(boxes) == 2
    assert boxes[0]["classId"] == 0

def test_image_record_parses_label_once_and_reports_label_state(monkeypatch, tmp_path):
    import webui.services.datasets as ds

    images_dir = tmp_path / "images" / "train"
    labels_dir = tmp_path / "labels" / "train"
    images_dir.mkdir(parents=True)
    labels_dir.mkdir(parents=True)
    (labels_dir / "a.txt").write_text(
        "0 0.5 0.5 0.2 0.3\n1 0.1 0.1 0.1 0.1\nnot-a-label\n",
        encoding="utf-8",
    )
    labeled_image = images_dir / "a.jpg"
    labeled_image.write_bytes(b"jpeg-data")

    monkeypatch.setattr(ds, "split_paths", lambda profile, split: (images_dir, labels_dir))
    monkeypatch.setattr(ds, "ROOT", tmp_path)
    monkeypatch.setattr(ds, "image_dimensions", lambda path: (120, 90))

    # 计数包装：断言 image_record 对同一标签文件只解析一次（labelCount / boxes 复用）。
    parse_calls = {"count": 0}
    original_parse = ds.parse_yolo_labels

    def counting_parse(label_path):
        parse_calls["count"] += 1
        return original_parse(label_path)

    monkeypatch.setattr(ds, "parse_yolo_labels", counting_parse)

    record = ds.image_record(labeled_image, "tmp", "train")
    assert record["stem"] == "a"
    assert record["width"] == 120
    assert record["height"] == 90
    assert record["hasLabel"] is True
    assert record["labelCount"] == 2
    assert len(record["boxes"]) == 2
    assert record["boxes"][0]["classId"] == 0
    assert record["boxes"][0]["x"] == 0.5
    assert parse_calls["count"] == 1, "标签文件应只解析一次"

    unlabeled_image = images_dir / "b.jpg"
    unlabeled_image.write_bytes(b"jpeg-data")
    record2 = ds.image_record(unlabeled_image, "tmp", "train")
    assert record2["hasLabel"] is False
    assert record2["labelCount"] == 0
    assert record2["boxes"] == []


def test_validate_yolo_label_file_ok(tmp_path):
    label = tmp_path / "ok.txt"
    label.write_text("0 0.5 0.5 0.2 0.3\n", encoding="utf-8")
    validate_yolo_label_file(label, DEFAULT_PROFILE)


def test_validate_yolo_label_file_bad_class(tmp_path):
    label = tmp_path / "bad_class.txt"
    label.write_text("9 0.5 0.5 0.2 0.3\n", encoding="utf-8")
    with pytest.raises(HTTPException) as exc:
        validate_yolo_label_file(label, DEFAULT_PROFILE)
    assert exc.value.status_code == 400


def test_validate_yolo_label_file_bad_coords(tmp_path):
    label = tmp_path / "bad_coords.txt"
    label.write_text("0 1.5 0.5 0.2 0.3\n", encoding="utf-8")
    with pytest.raises(HTTPException) as exc:
        validate_yolo_label_file(label, DEFAULT_PROFILE)
    assert exc.value.status_code == 400


def test_validate_yolo_label_file_bad_format(tmp_path):
    label = tmp_path / "bad_format.txt"
    label.write_text("0 0.5 0.5\n", encoding="utf-8")
    with pytest.raises(HTTPException) as exc:
        validate_yolo_label_file(label, DEFAULT_PROFILE)
    assert exc.value.status_code == 400


def _png_bytes() -> bytes:
    import io
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (16, 16), (200, 30, 30)).save(buf, format="PNG")
    return buf.getvalue()


def test_save_upload_rejects_bad_ext_and_non_image_content(tmp_path):
    # 非白名单扩展名被拒绝
    with pytest.raises(HTTPException):
        asyncio.run(save_upload(make_upload("b.txt", b"x"), tmp_path, {".jpg"}))
    # 伪图片扩展名但内容不是图片 -> 400，且不残留文件
    with pytest.raises(HTTPException) as exc:
        asyncio.run(save_upload(make_upload("fake.jpg", b"xx"), tmp_path, {".jpg"}))
    assert exc.value.status_code == 400
    assert not list(tmp_path.iterdir())


def test_save_upload_accepts_valid_image(tmp_path):
    result = asyncio.run(save_upload(make_upload("cat.png", _png_bytes()), tmp_path, IMAGE_EXTS))
    assert (tmp_path / result["name"]).exists()
    assert result["path"]


def test_save_upload_rejects_oversize_and_cleans_up(tmp_path, monkeypatch):
    monkeypatch.setattr("webui.services.datasets.MAX_UPLOAD_BYTES", 8)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(save_upload(make_upload("big.jpg", b"0123456789"), tmp_path, {".jpg"}))
    assert exc.value.status_code == 413
    assert not list(tmp_path.iterdir())


def test_save_yolo_labels_atomic_writes_expected_content(tmp_path):
    label_path = tmp_path / "labels" / "sample.txt"
    save_yolo_labels_atomic(label_path, ["0 0.500000 0.500000 0.200000 0.300000"])
    assert label_path.read_text(encoding="utf-8") == "0 0.500000 0.500000 0.200000 0.300000\n"
    assert not list(label_path.parent.glob(".sample.txt.*.tmp"))


def test_save_yolo_labels_atomic_can_clear_existing_file(tmp_path):
    label_path = tmp_path / "sample.txt"
    label_path.write_text("old label\n", encoding="utf-8")
    save_yolo_labels_atomic(label_path, [])
    assert label_path.exists()
    assert label_path.read_text(encoding="utf-8") == ""



def test_thumbnail_generation_is_cached_and_invalidated(tmp_path, monkeypatch):
    import cv2
    import numpy as np
    import webui.services.datasets as datasets

    thumbnail_dir = tmp_path / "thumbnails"
    monkeypatch.setattr(datasets, "THUMBNAILS_DIR", thumbnail_dir)
    source = tmp_path / "source.png"
    cv2.imwrite(str(source), np.zeros((100, 320, 3), dtype=np.uint8))

    first = ensure_thumbnail(source, width=192)
    assert first == thumbnail_cache_path(source, width=192)
    decoded = cv2.imread(str(first))
    assert decoded is not None
    assert decoded.shape[1] == 192
    assert decoded.shape[0] < 100
    assert ensure_thumbnail(source, width=192) == first

    source.write_bytes(source.read_bytes() + b"changed")
    second = ensure_thumbnail(source, width=192)
    assert second != first
    assert cv2.imread(str(second)) is not None

def test_image_dimensions():
    if SMOKE_IMAGE.exists():
        width, height = image_dimensions(SMOKE_IMAGE)
        assert width > 0 and height > 0
    else:
        assert image_dimensions(Path("missing.png")) == (0, 0)


def test_safe_filename_sanitizes():
    name = safe_filename("a b/c?d.jpg")
    assert name == name.replace(" ", "_")
    assert "?" not in name and "/" not in name


def test_dataset_counts_structure():
    counts = dataset_counts(DEFAULT_PROFILE)
    assert set(counts["splits"]) == {"train", "val", "test"}
    assert counts["totalImages"] >= 0
    assert counts["totalLabels"] >= 0


def test_task_payload():
    task = ManagedTask(
        id="t1",
        kind="full-train:cat",
        command=["python", "train.py"],
        profile="cat",
        params={"mode": "full", "epochs": 100},
    )
    task.status = "success"
    task.returncode = 0
    payload = task_payload(task)
    assert payload["id"] == "t1"
    assert payload["status"] == "success"
    assert payload["returncode"] == 0
    assert payload["profile"] == "cat"
    assert payload["params"]["epochs"] == 100


def test_training_options_use_mode_defaults():
    assert _training_options(TrainRequest(profile=DEFAULT_PROFILE), smoke=True) == {
        "epochs": 5,
        "imgsz": 416,
        "batch": 4,
        "device": "auto",
        "workers": 0,
        "model": None,
    }
    assert _training_options(TrainRequest(profile=DEFAULT_PROFILE), smoke=False)["epochs"] == 100


def test_training_options_reject_non_multiple_imgsz():
    with pytest.raises(HTTPException) as exc:
        _training_options(TrainRequest(profile=DEFAULT_PROFILE, imgsz=500), smoke=False)
    assert exc.value.status_code == 400
    assert "32 的倍数" in str(exc.value.detail)


def test_training_options_reject_model_outside_project():
    with pytest.raises(HTTPException) as exc:
        _training_options(TrainRequest(profile=DEFAULT_PROFILE, model="../outside.pt"), smoke=False)
    assert exc.value.status_code == 400
    assert "项目目录内" in str(exc.value.detail)


def test_import_model_rejects_invalid_checkpoint():
    with pytest.raises(HTTPException) as exc:
        import_model(make_upload("broken.pt", b"not a model checkpoint"))
    assert exc.value.status_code == 400


def test_prediction_task_payload_includes_lifecycle_metadata():
    task = PredictionTask(id="p-meta", profile=DEFAULT_PROFILE, upload_path=Path("t"), original_filename="猫.jpg")
    task.status = "cancelled"
    task.cancel_requested = True
    task.cancel_reason = "用户取消"
    task.duration_ms = 123
    payload = prediction_task_payload(task)
    assert payload["cancelRequested"] is True
    assert payload["cancelReason"] == "用户取消"
    assert payload["originalFilename"] == "猫.jpg"
    assert payload["durationMs"] == 123


def test_queued_prediction_can_be_cancelled_without_running(monkeypatch, tmp_path):
    import webui.services.predictions as service

    task = PredictionTask(id="p-cancel", profile=DEFAULT_PROFILE, upload_path=tmp_path / "input.jpg")
    task.upload_path.write_bytes(b"input")
    monkeypatch.setattr(service, "_write_history", lambda records: None)
    with service.predict_tasks_lock:
        service.predict_tasks[task.id] = task
    try:
        result = request_prediction_cancel(task.id, "测试取消")
        assert result.status == "cancelled"
        assert result.cancel_requested is True
        assert result.cancel_event.is_set()
        assert not task.upload_path.exists()
    finally:
        with service.predict_tasks_lock:
            service.predict_tasks.pop(task.id, None)


def test_failed_prediction_retry_creates_child_task(monkeypatch, tmp_path):
    import webui.services.predictions as service

    class FakeQueue:
        def __init__(self):
            self.items = []

        def put_nowait(self, item):
            self.items.append(item)

    source_path = tmp_path / "source.jpg"
    source_path.write_bytes(b"retry-input")
    source = PredictionTask(
        id="p-failed",
        profile=DEFAULT_PROFILE,
        upload_path=source_path,
        status="failed",
        conf=0.4,
        model_selector="pretrained",
        original_filename="source.jpg",
    )
    fake_queue = FakeQueue()
    monkeypatch.setattr(service, "predict_queue", fake_queue)
    monkeypatch.setattr(service, "UPLOADS", tmp_path)
    monkeypatch.setattr(service, "_write_history", lambda records: None)
    with service.predict_tasks_lock:
        service.predict_tasks[source.id] = source
    try:
        retried = retry_prediction_task(source.id)
        assert retried.id != source.id
        assert retried.parent_task_id == source.id
        assert retried.conf == 0.4
        assert retried.model_selector == "pretrained"
        assert retried.upload_path.read_bytes() == b"retry-input"
        assert fake_queue.items == [retried]
        assert source.status == "failed"
    finally:
        with service.predict_tasks_lock:
            service.predict_tasks.pop(source.id, None)
            for item in fake_queue.items:
                service.predict_tasks.pop(item.id, None)
        for item in [source_path, *[entry.upload_path for entry in fake_queue.items]]:
            item.unlink(missing_ok=True)


def test_prediction_retry_rejects_source_outside_upload_directory(monkeypatch, tmp_path):
    import webui.services.predictions as service

    source_path = tmp_path / "outside.jpg"
    source_path.write_bytes(b"retry-input")
    upload_root = tmp_path / "uploads"
    upload_root.mkdir()
    source = PredictionTask(
        id="p-outside",
        profile=DEFAULT_PROFILE,
        upload_path=source_path,
        status="failed",
    )
    monkeypatch.setattr(service, "UPLOADS", upload_root)
    with service.predict_tasks_lock:
        service.predict_tasks[source.id] = source
    try:
        with pytest.raises(HTTPException) as exc_info:
            retry_prediction_task(source.id)
        assert exc_info.value.status_code == 409
        assert not list(upload_root.iterdir())
    finally:
        with service.predict_tasks_lock:
            service.predict_tasks.pop(source.id, None)


def test_failed_prediction_retry_returns_507_when_upload_storage_is_full(monkeypatch, tmp_path):
    import webui.services.predictions as service

    source_path = tmp_path / "source.jpg"
    source_path.write_bytes(b"retry-input")
    source = PredictionTask(
        id="p-full",
        profile=DEFAULT_PROFILE,
        upload_path=source_path,
        status="failed",
    )

    class FakeQueue:
        def put_nowait(self, item):
            raise AssertionError("配额不足时不应进入预测队列")

    monkeypatch.setattr(service, "predict_queue", FakeQueue())
    monkeypatch.setattr(service, "UPLOADS", tmp_path)
    monkeypatch.setattr(service, "protected_storage_paths", lambda: ([], []))
    monkeypatch.setattr(service, "upload_storage_slot", lambda incoming_bytes, protected_upload_files=(): _capacity(False))
    with service.predict_tasks_lock:
        service.predict_tasks[source.id] = source
    try:
        with pytest.raises(HTTPException) as exc_info:
            retry_prediction_task(source.id)
        assert exc_info.value.status_code == 507
        assert not list(tmp_path.glob("retry_*"))
    finally:
        with service.predict_tasks_lock:
            service.predict_tasks.pop(source.id, None)


def test_prediction_filter_stats_and_safe_cleanup(monkeypatch, tmp_path):
    import webui.services.predictions as service

    root = tmp_path / "root"
    runs = root / "runs" / "web_predict"
    runs.mkdir(parents=True)
    monkeypatch.setattr(service, "ROOT", root)
    monkeypatch.setattr(service, "PREDICT_RUNS", runs)
    monkeypatch.setattr(service, "_write_history", lambda records: None)
    completed_dir = runs / "completed"
    completed_dir.mkdir()
    image = completed_dir / "result.jpg"
    image.write_bytes(b"12345")
    task = PredictionTask(
        id="completed",
        profile="demo",
        upload_path=tmp_path / "upload.jpg",
        status="completed",
        model_source="trained",
        conf=0.55,
        output_dir=completed_dir,
    )
    with service.predict_tasks_lock:
        service.predict_tasks[task.id] = task
    try:
        result = list_predictions(10, profile="demo", model="trained", min_conf=0.5)
        assert len(result) == 1
        assert result[0]["taskId"] == "completed"
        assert result[0]["sizeBytes"] == 5
        stats = prediction_stats(profile="demo")
        assert stats["count"] == 1
        assert stats["totalBytes"] == 5
        cleaned = cleanup_prediction_records(["completed"])
        assert cleaned["deletedTasks"] == ["completed"]
        assert not completed_dir.exists()
        assert task.images == []
    finally:
        with service.predict_tasks_lock:
            service.predict_tasks.pop(task.id, None)


def test_prediction_task_payload_includes_predictions_only_when_requested():
    task = PredictionTask(id="p1", profile=DEFAULT_PROFILE, upload_path=Path("t"))
    task.status = "completed"
    task.model_source = "pretrained"
    task.detections = [{"classId": 0, "name": "cat", "confidence": 0.9, "xyxy": [1, 2, 3, 4]}]
    assert "predictions" not in prediction_task_payload(task)
    payload = prediction_task_payload(task, include_predictions=True)
    assert "predictions" in payload
    assert payload["modelSource"] == "pretrained"


def test_check_dataset_reports_quality_issues_and_distribution(tmp_path, monkeypatch):
    import cv2
    import numpy as np
    import webui.services.dataset_check as checker

    root = tmp_path / "roboflow"
    for split in ("train", "valid"):
        (root / split / "images").mkdir(parents=True)
        (root / split / "labels").mkdir(parents=True)
    cv2.imwrite(str(root / "train" / "images" / "ok.jpg"), np.zeros((32, 32, 3), dtype=np.uint8))
    (root / "train" / "labels" / "ok.txt").write_text("0 0.5 0.5 0.2 0.2\n", encoding="utf-8")
    (root / "train" / "images" / "missing.jpg").write_bytes(b"broken")
    (root / "train" / "labels" / "bad.txt").write_text("4 1.2 0.5 0.2\n", encoding="utf-8")
    cv2.imwrite(str(root / "valid" / "images" / "val.jpg"), np.zeros((32, 32, 3), dtype=np.uint8))
    (root / "valid" / "labels" / "val.txt").write_text("0 0.5 0.5 0.001 0.2\n", encoding="utf-8")

    monkeypatch.setattr(checker, "resolve_profile", lambda profile: profile)
    monkeypatch.setattr(checker, "profile_config", lambda profile: {"root": root})
    monkeypatch.setattr(checker, "profile_classes", lambda profile: [{"id": 0, "name": "cat", "displayName": "猫"}])
    report = check_dataset("demo")

    assert report["ready"] is False
    assert report["blockingCount"] >= 3
    assert report["warningCount"] >= 1
    assert report["splits"]["val"]["images"] == 1
    assert report["classDistribution"]["0"] == 2
    assert any(issue["code"] == "missing_label" for issue in report["issues"])
    assert any(issue["code"] == "invalid_format" for issue in report["issues"])
    assert any(issue["code"] == "corrupt_image" for issue in report["issues"])


def test_check_dataset_ready_for_clean_standard_layout(tmp_path, monkeypatch):
    import cv2
    import numpy as np
    import webui.services.dataset_check as checker

    root = tmp_path / "standard"
    for split in ("train", "val"):
        (root / "images" / split).mkdir(parents=True)
        (root / "labels" / split).mkdir(parents=True)
        cv2.imwrite(str(root / "images" / split / "one.png"), np.zeros((16, 16, 3), dtype=np.uint8))
        (root / "labels" / split / "one.txt").write_text("0 0.5 0.5 0.5 0.5\n", encoding="utf-8")

    monkeypatch.setattr(checker, "resolve_profile", lambda profile: profile)
    monkeypatch.setattr(checker, "profile_config", lambda profile: {"root": root})
    monkeypatch.setattr(checker, "profile_classes", lambda profile: [{"id": 0, "name": "cat", "displayName": "猫"}])
    report = check_dataset("demo")
    assert report["ready"] is True
    assert report["blockingCount"] == 0


def test_parse_training_metrics_returns_current_best_and_recent(tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    (run_dir / "results.csv").write_text(
        "epoch,train/box_loss,train/cls_loss,train/dfl_loss,metrics/precision(B),metrics/recall(B),metrics/mAP50(B),metrics/mAP50-95(B)\n"
        "1,1.0,2.0,3.0,0.5,0.4,0.6,0.3\n"
        "2,0.8,1.5,2.2,0.7,0.6,0.8,0.5\n",
        encoding="utf-8",
    )
    result = parse_training_metrics(run_dir)
    assert result is not None
    assert result["current"]["epoch"] == 2
    assert result["best"]["mAP50_95"] == 0.5
    assert result["current"]["loss"]["total"] == 4.5
    assert len(result["recent"]) == 2


def test_training_resource_snapshot_has_expected_sections(tmp_path):
    result = training_resource_snapshot(tmp_path, "cpu")
    assert "disk" in result and "memory" in result and "cpu" in result
    assert isinstance(result["warnings"], list)
    assert isinstance(result["blocking"], list)


def test_task_payload_includes_schema_and_runtime_metadata():
    task = ManagedTask(
        id="t-runtime",
        kind="full-train:cat",
        command=["python", "train.py"],
        profile="cat",
        params={"mode": "full", "runDir": "D:/work/yolo/runs/cat_full_t-runtime"},
    )
    task.parent_task_id = "parent-1"
    task.cancel_reason = "资源不足"
    task.pid = 1234
    payload = task_payload(task)
    assert payload["schemaVersion"] == 2
    assert payload["parentTaskId"] == "parent-1"
    assert payload["cancelReason"] == "资源不足"
    assert payload["pid"] == 1234
    assert payload["runDir"].endswith("cat_full_t-runtime")


def test_task_history_migrates_old_active_record_to_interrupted():
    import webui.services.tasks as service

    record = {
        "id": "old-1",
        "kind": "full-train:cat",
        "status": "running",
        "startedAt": 100.0,
        "params": {"runName": "cat_yolo11n"},
    }
    migrated = service.mark_interrupted(record, now=200.0)
    assert migrated["schemaVersion"] == 2
    assert migrated["status"] == "interrupted"
    assert migrated["finishedAt"] == 200.0
    assert migrated["lastHeartbeatAt"] == 200.0
    assert migrated["message"]
    assert record["status"] == "running"


def test_start_task_allocates_unique_run_dir_and_rewrites_command(monkeypatch, tmp_path):
    import webui.services.tasks as service

    monkeypatch.setattr(service, "ROOT", tmp_path)
    monkeypatch.setattr(service, "TASK_HISTORY", tmp_path / "task_history.json")
    monkeypatch.setattr(service, "TASK_LOGS", tmp_path / "task_logs")
    service.TASK_LOGS.mkdir()
    monkeypatch.setattr(service, "persist_task_record", lambda task: None)
    monkeypatch.setattr(service, "run_command", lambda command, task: None)
    monkeypatch.setattr(service, "current_task", None)
    first = service.start_task("full-train:cat", ["python", "train.py", "--name", "cat_yolo11n"], profile="cat", params={"mode": "full", "runName": "cat_yolo11n"})
    monkeypatch.setattr(service, "current_task", None)
    second = service.start_task("full-train:cat", ["python", "train.py", "--name", "cat_yolo11n"], profile="cat", params={"mode": "full", "runName": "cat_yolo11n"})
    assert first.params["runDir"] != second.params["runDir"]
    assert first.params["runName"] != "cat_yolo11n"
    assert first.command[first.command.index("--name") + 1] == first.params["runName"]
    assert first.params["requestedRunName"] == "cat_yolo11n"


def test_refresh_task_metrics_uses_only_task_run_dir(tmp_path, monkeypatch):
    import webui.services.tasks as service

    run_dir = tmp_path / "runs" / "cat_full_task"
    wrong_dir = tmp_path / "runs" / "cat_full_task_extra"
    run_dir.mkdir(parents=True)
    wrong_dir.mkdir(parents=True)
    csv = "epoch,train/box_loss,train/cls_loss,train/dfl_loss,metrics/mAP50-95(B)\n1,1,1,1,0.2\n"
    (wrong_dir / "results.csv").write_text(csv, encoding="utf-8")
    task = ManagedTask(id="metric-1", kind="full-train:cat", command=[], started_at=0, params={"runDir": str(run_dir)})
    monkeypatch.setattr(service, "ROOT", tmp_path)
    service.refresh_task_metrics(task)
    assert task.metrics is None
    assert task.result_dir is None


def test_status_reads_live_current_task_reference(monkeypatch):
    import webui.routes.status as status_route
    import webui.services.tasks as service

    task = ManagedTask(id="status-live", kind="full-train:cat", command=[])
    task.status = "running"
    monkeypatch.setattr(service, "current_task", task)
    payload = status_route.status(profile=DEFAULT_PROFILE)
    assert payload["task"]["id"] == "status-live"
    assert payload["task"]["status"] == "running"


def test_prediction_history_malformed_numbers_fall_back_safely():
    import webui.services.predictions as service

    task = service._task_from_record({
        "id": "malformed-history",
        "profile": "cat",
        "status": "running",
        "conf": "not-a-number",
        "createdAt": "broken",
        "startedAt": "broken",
        "finishedAt": "broken",
        "durationMs": "broken",
        "inputSize": "broken",
        "schemaVersion": "broken",
    })
    assert task is not None
    assert task.status == "interrupted"
    assert task.conf == 0.25
    assert task.schema_version == 1
    assert task.started_at is None
    assert task.finished_at is not None



def test_mark_finished_records_terminal_status_messages(monkeypatch):
    import webui.services.tasks as service

    records = []
    monkeypatch.setattr(service, "persist_task_record", lambda task: records.append(task_payload(task)))

    success = ManagedTask(id="finish-success", kind="full-train:cat", command=[])
    mark_finished(success, 0)
    assert success.status == "success"
    assert success.message == "训练任务已完成"
    assert success.error is None

    failed = ManagedTask(id="finish-failed", kind="full-train:cat", command=[])
    mark_finished(failed, 1, error="模型文件不存在")
    assert failed.status == "failed"
    assert failed.message == "训练任务执行失败：模型文件不存在"
    assert failed.error == "模型文件不存在"
    assert len(records) == 2


def test_mark_finished_stop_request_wins_over_nonzero_returncode(monkeypatch):
    import webui.services.tasks as service

    monkeypatch.setattr(service, "persist_task_record", lambda task: None)
    task = ManagedTask(id="finish-cancelled", kind="full-train:cat", command=[])
    task.stop_requested = True
    task.cancel_reason = "用户主动停止"

    mark_finished(task, 1, error="进程被终止")

    assert task.status == "cancelled"
    assert task.cancel_reason == "用户主动停止"
    assert task.message == "训练任务已取消：用户主动停止"
    assert task.error == "进程被终止"


def test_run_command_popen_failure_persists_failed_terminal_task(tmp_path, monkeypatch):
    import webui.services.tasks as service

    log_dir = tmp_path / "task_logs"
    log_dir.mkdir()
    monkeypatch.setattr(service, "ROOT", tmp_path)
    monkeypatch.setattr(service, "TASK_LOGS", log_dir)
    persisted = []
    monkeypatch.setattr(service, "persist_task_record", lambda task: persisted.append(task_payload(task)))

    def fail_to_start(*args, **kwargs):
        raise OSError("python executable unavailable")

    monkeypatch.setattr(service.subprocess, "Popen", fail_to_start)
    task = ManagedTask(id="start-failed", kind="full-train:cat", command=["missing-python"])

    run_command(task.command, task)

    assert task.status == "failed"
    assert task.returncode is None
    assert task.error == "python executable unavailable"
    assert task.message == "训练任务启动或执行异常"
    assert persisted and persisted[-1]["status"] == "failed"
    assert "python executable unavailable" in (log_dir / "start-failed.log").read_text(encoding="utf-8")


def test_thumbnail_cache_prune_removes_expired_and_enforces_limits(tmp_path, monkeypatch):
    import time
    import webui.services.datasets as datasets

    cache_dir = tmp_path / "thumbnails"
    cache_dir.mkdir()
    expired = cache_dir / "expired.jpg"
    expired.write_bytes(b"old")
    fresh = cache_dir / "fresh.jpg"
    fresh.write_bytes(b"new")
    old_time = time.time() - 3600
    import os
    os.utime(expired, (old_time, old_time))
    monkeypatch.setattr(datasets, "THUMBNAILS_DIR", cache_dir)
    monkeypatch.setattr(datasets, "THUMBNAIL_CACHE_TTL_SECONDS", 60)
    monkeypatch.setattr(datasets, "THUMBNAIL_CACHE_MAX_ENTRIES", 10)
    monkeypatch.setattr(datasets, "THUMBNAIL_CACHE_MAX_BYTES", 1024)
    result = datasets.prune_thumbnail_cache(force=True)
    assert not expired.exists()
    assert fresh.exists()
    assert result["expirations"] >= 1


def test_thumbnail_cache_prune_enforces_byte_quota(tmp_path, monkeypatch):
    import time
    import webui.services.datasets as datasets

    cache_dir = tmp_path / "thumbnails"
    cache_dir.mkdir()
    first = cache_dir / "first.jpg"
    second = cache_dir / "second.jpg"
    first.write_bytes(b"1" * 8)
    time.sleep(0.01)
    second.write_bytes(b"2" * 8)
    monkeypatch.setattr(datasets, "THUMBNAILS_DIR", cache_dir)
    monkeypatch.setattr(datasets, "THUMBNAIL_CACHE_TTL_SECONDS", 3600)
    monkeypatch.setattr(datasets, "THUMBNAIL_CACHE_MAX_ENTRIES", 10)
    monkeypatch.setattr(datasets, "THUMBNAIL_CACHE_MAX_BYTES", 8)
    result = datasets.prune_thumbnail_cache(force=True)
    assert not first.exists()
    assert second.exists()
    assert result["bytes"] <= 8
    assert result["evictions"] >= 1


def test_storage_quota_prunes_old_prediction_dirs_and_uploads(tmp_path, monkeypatch):
    import os
    import time
    import webui.services.storage as storage

    prediction_root = tmp_path / "predict"
    upload_root = tmp_path / "uploads"
    prediction_root.mkdir()
    upload_root.mkdir()
    old_prediction = prediction_root / "old-task"
    old_prediction.mkdir()
    old_result = old_prediction / "result.jpg"
    old_result.write_bytes(b"prediction")
    old_upload = upload_root / "old.jpg"
    old_upload.write_bytes(b"upload")
    old_time = time.time() - 3600
    os.utime(old_prediction, (old_time, old_time))
    os.utime(old_result, (old_time, old_time))
    os.utime(old_upload, (old_time, old_time))

    monkeypatch.setattr(storage, "PREDICT_RUNS", prediction_root)
    monkeypatch.setattr(storage, "UPLOADS", upload_root)
    monkeypatch.setattr(storage, "PREDICTION_STORAGE_TTL_SECONDS", 60)
    monkeypatch.setattr(storage, "UPLOAD_STORAGE_TTL_SECONDS", 60)
    monkeypatch.setattr(storage, "PREDICTION_STORAGE_MAX_BYTES", 1024)
    monkeypatch.setattr(storage, "UPLOAD_STORAGE_MAX_BYTES", 1024)
    monkeypatch.setattr(storage, "PREDICTION_STORAGE_MAX_ENTRIES", 10)
    monkeypatch.setattr(storage, "UPLOAD_STORAGE_MAX_ENTRIES", 10)
    monkeypatch.setattr(storage, "STORAGE_PRUNE_INTERVAL_SECONDS", 0)

    result = storage.prune_storage(force=True)
    assert not old_prediction.exists()
    assert not old_upload.exists()
    assert result["predictions"]["expired"] >= 1
    assert result["uploads"]["expired"] >= 1


def test_storage_quota_delete_failure_is_reported_without_raising(tmp_path, monkeypatch):
    import time
    import webui.services.storage as storage

    upload_root = tmp_path / "uploads"
    upload_root.mkdir()
    old_upload = upload_root / "locked.jpg"
    old_upload.write_bytes(b"upload")
    old_time = time.time() - 3600
    import os
    os.utime(old_upload, (old_time, old_time))

    monkeypatch.setattr(storage, "PREDICT_RUNS", tmp_path / "predict")
    monkeypatch.setattr(storage, "UPLOADS", upload_root)
    storage.PREDICT_RUNS.mkdir()
    monkeypatch.setattr(storage, "UPLOAD_STORAGE_TTL_SECONDS", 60)
    monkeypatch.setattr(storage, "UPLOAD_STORAGE_MAX_BYTES", 1)
    monkeypatch.setattr(storage, "UPLOAD_STORAGE_MAX_ENTRIES", 1)
    monkeypatch.setattr(storage, "STORAGE_PRUNE_INTERVAL_SECONDS", 0)
    def fail_delete(path, kind):
        storage._storage_stats[kind]["failed"] += 1
        return False

    monkeypatch.setattr(storage, "_delete_candidate", fail_delete)

    result = storage.prune_storage(force=True)

    assert old_upload.exists()
    assert result["uploads"]["failed"] >= 1
    assert result["uploads"]["overQuota"] is True


def test_storage_quota_protects_active_paths(tmp_path, monkeypatch):
    import webui.services.storage as storage

    prediction_root = tmp_path / "predict"
    upload_root = tmp_path / "uploads"
    prediction_root.mkdir()
    upload_root.mkdir()
    active = prediction_root / "active"
    active.mkdir()
    (active / "result.jpg").write_bytes(b"123456789")
    upload = upload_root / "retry.jpg"
    upload.write_bytes(b"123456789")
    monkeypatch.setattr(storage, "PREDICT_RUNS", prediction_root)
    monkeypatch.setattr(storage, "UPLOADS", upload_root)
    monkeypatch.setattr(storage, "PREDICTION_STORAGE_TTL_SECONDS", 0)
    monkeypatch.setattr(storage, "UPLOAD_STORAGE_TTL_SECONDS", 0)
    monkeypatch.setattr(storage, "PREDICTION_STORAGE_MAX_BYTES", 1)
    monkeypatch.setattr(storage, "UPLOAD_STORAGE_MAX_BYTES", 1)
    monkeypatch.setattr(storage, "PREDICTION_STORAGE_MAX_ENTRIES", 1)
    monkeypatch.setattr(storage, "UPLOAD_STORAGE_MAX_ENTRIES", 1)
    monkeypatch.setattr(storage, "STORAGE_PRUNE_INTERVAL_SECONDS", 0)

    result = storage.prune_storage(protected_prediction_dirs=[active], protected_upload_files=[upload], force=True)
    assert active.exists() and upload.exists()
    assert result["predictions"]["protectedEntries"] == 1
    assert result["uploads"]["protectedEntries"] == 1


def test_prediction_task_payload_copies_mutable_lists():
    task = PredictionTask(id="p-copy", profile=DEFAULT_PROFILE, upload_path=Path("t"))
    task.detections = [{"classId": 1, "name": "cat", "confidence": 0.9}]
    task.images = [{"name": "a.jpg", "path": "runs/x/a.jpg"}]
    payload = prediction_task_payload(task)

    # 返回的列表是拷贝，修改任务不会影响已生成的快照
    task.detections.clear()
    task.images.append({"name": "b.jpg", "path": "runs/x/b.jpg"})
    assert payload["detections"] == [{"classId": 1, "name": "cat", "confidence": 0.9}]
    assert payload["images"] == [{"name": "a.jpg", "path": "runs/x/a.jpg"}]

    # 修改快照中的列表也不会影响任务
    payload["detections"].append({"classId": 2})
    payload["images"].clear()
    assert task.detections == []
    assert task.images == [
        {"name": "a.jpg", "path": "runs/x/a.jpg"},
        {"name": "b.jpg", "path": "runs/x/b.jpg"},
    ]


def test_snapshot_prediction_task_returns_none_for_missing_and_isolated_payload(monkeypatch):
    import webui.services.predictions as service

    task = PredictionTask(id="p-snap", profile=DEFAULT_PROFILE, upload_path=Path("t"))
    task.status = "completed"
    task.images = [{"name": "a.jpg", "path": "runs/x/a.jpg"}]
    monkeypatch.setattr(service, "_write_history", lambda records: None)
    with service.predict_tasks_lock:
        service.predict_tasks[task.id] = task
    try:
        assert snapshot_prediction_task("missing-id") is None
        payload = snapshot_prediction_task(task.id, include_predictions=True)
        assert payload is not None
        assert payload["id"] == "p-snap"
        assert payload["predictions"] == task.images

        # 快照与任务状态解耦：任务被清空后快照仍保留原数据
        with service.predict_tasks_lock:
            task.images = []
            task.status = "failed"
        assert payload["predictions"] == [{"name": "a.jpg", "path": "runs/x/a.jpg"}]
        assert payload["status"] == "completed"
    finally:
        with service.predict_tasks_lock:
            service.predict_tasks.pop(task.id, None)


def test_model_cache_evicts_oldest_beyond_cap(monkeypatch, tmp_path):
    import webui.services.models as models_service
    from webui.config import MODEL_CACHE_MAX_ENTRIES, model_cache, model_cache_lock

    class FakeModel:
        def __init__(self, name: str):
            self.name = name

    monkeypatch.setattr(models_service, "_create_model", lambda path: FakeModel(path.name))

    model_files = []
    for index in range(MODEL_CACHE_MAX_ENTRIES + 2):
        model_file = tmp_path / f"model_{index}.pt"
        model_file.write_bytes(b"fake-weights")
        model_files.append(model_file)

    with model_cache_lock:
        saved = dict(model_cache)
        model_cache.clear()
    try:
        loaded = [models_service.load_model(path) for path in model_files]
        with model_cache_lock:
            assert len(model_cache) <= MODEL_CACHE_MAX_ENTRIES
        # 最旧的 model_0 应被 LRU 淘汰
        assert loaded[0].name == "model_0.pt"
        with model_cache_lock:
            keys = set(model_cache)
        assert not any(key.startswith(str(model_files[0].resolve()) + "|") for key in keys)
    finally:
        with model_cache_lock:
            model_cache.clear()
            model_cache.update(saved)



def test_dataset_index_builds_natural_sorted_entries_with_label_state(monkeypatch, tmp_path):
    import webui.services.datasets as datasets

    images_dir = tmp_path / "images"
    labels_dir = tmp_path / "labels"
    images_dir.mkdir()
    labels_dir.mkdir()
    for name in ["img_2.jpg", "img_10.jpg", "img_1.jpg", "a.jpg", "notes.txt"]:
        (images_dir / name).write_bytes(b"x")
    (labels_dir / "img_1.txt").write_text("0 0.5 0.5 0.2 0.2\n", encoding="utf-8")

    monkeypatch.setattr(datasets, "split_paths", lambda profile, split: (images_dir, labels_dir))
    monkeypatch.setattr(datasets, "dataset_index_cache", {})
    monkeypatch.setattr(datasets, "dataset_index_ttl", 60)
    entries = datasets.dataset_index("fake", "train")
    assert [name for name, _ in entries] == ["a.jpg", "img_1.jpg", "img_2.jpg", "img_10.jpg"]
    state = dict(entries)
    assert state["img_1.jpg"] is True
    assert state["img_10.jpg"] is False
    assert "notes.txt" not in state


def test_dataset_index_ttl_expiration_and_explicit_invalidation(monkeypatch, tmp_path):
    import webui.services.datasets as datasets

    images_dir = tmp_path / "images"
    labels_dir = tmp_path / "labels"
    images_dir.mkdir()
    labels_dir.mkdir()
    (images_dir / "one.jpg").write_bytes(b"x")
    monkeypatch.setattr(datasets, "split_paths", lambda profile, split: (images_dir, labels_dir))
    monkeypatch.setattr(datasets, "dataset_index_cache", {})
    monkeypatch.setattr(datasets, "dataset_index_ttl", 60)

    assert [n for n, _ in datasets.dataset_index("fake", "train")] == ["one.jpg"]

    # TTL 内目录变化仍命中旧索引（快路径）
    (images_dir / "two.jpg").write_bytes(b"x")
    assert [n for n, _ in datasets.dataset_index("fake", "train")] == ["one.jpg"]

    # 显式失效后重建
    datasets.invalidate_dataset_index("fake", "train")
    assert [n for n, _ in datasets.dataset_index("fake", "train")] == ["one.jpg", "two.jpg"]

    # TTL 过期后自动重建
    monkeypatch.setattr(datasets, "dataset_index_ttl", -1)
    (images_dir / "three.jpg").write_bytes(b"x")
    assert [n for n, _ in datasets.dataset_index("fake", "train")] == ["one.jpg", "three.jpg", "two.jpg"]


def test_dataset_index_invalidate_all_splits_and_stats(monkeypatch, tmp_path):
    import webui.services.datasets as datasets

    images_dir = tmp_path / "images"
    labels_dir = tmp_path / "labels"
    images_dir.mkdir()
    labels_dir.mkdir()
    (images_dir / "x.jpg").write_bytes(b"x")
    monkeypatch.setattr(datasets, "split_paths", lambda profile, split: (images_dir, labels_dir))
    monkeypatch.setattr(datasets, "dataset_index_cache", {})
    monkeypatch.setattr(datasets, "dataset_index_ttl", 60)
    monkeypatch.setattr(
        datasets,
        "dataset_index_cache_stats",
        {"hits": 0, "misses": 0, "expirations": 0, "invalidations": 0, "entries": 0},
    )

    datasets.dataset_index("fake", "train")
    datasets.dataset_index("fake", "val")
    datasets.dataset_index("fake", "train")  # 命中
    stats = datasets.dataset_index_cache_stats_snapshot()
    assert stats["hits"] == 1
    assert stats["misses"] == 2
    assert stats["entries"] == 2
    assert stats["hitRate"] == 1 / 3

    datasets.invalidate_dataset_index("fake")
    assert datasets.dataset_index_cache_stats_snapshot()["invalidations"] == 2
    assert datasets.dataset_index_cache_stats_snapshot()["entries"] == 0


def test_dataset_index_missing_dir_returns_empty(monkeypatch, tmp_path):
    import webui.services.datasets as datasets

    missing_images = tmp_path / "no_such_dir"
    missing_labels = tmp_path / "no_such_labels"
    monkeypatch.setattr(datasets, "split_paths", lambda profile, split: (missing_images, missing_labels))
    monkeypatch.setattr(datasets, "dataset_index_cache", {})
    assert datasets.dataset_index("fake", "train") == []
