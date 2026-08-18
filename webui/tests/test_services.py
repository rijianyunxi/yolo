import asyncio
import sys
from pathlib import Path
from tempfile import TemporaryFile

import pytest
from fastapi import HTTPException
from starlette.datastructures import UploadFile

sys.path.insert(0, "D:/work/yolo")

from webui.config import DATASET_PROFILES, DEFAULT_PROFILE
from webui.services.datasets import (
    dataset_counts,
    image_dimensions,
    parse_yolo_labels,
    safe_filename,
    save_upload,
    split_paths,
    validate_yolo_label_file,
)
from webui.services.predictions import PredictionTask, prediction_task_payload
from webui.services.profiles import profile_config, resolve_profile
from webui.services.tasks import ManagedTask, task_payload

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


def test_save_upload_writes_and_rejects_bad_ext(tmp_path):
    result = asyncio.run(save_upload(make_upload("a.jpg", b"xx"), tmp_path, {".jpg"}))
    assert (tmp_path / result["name"]).exists()
    with pytest.raises(HTTPException):
        asyncio.run(save_upload(make_upload("b.txt", b"x"), tmp_path, {".jpg"}))


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
    task = ManagedTask(id="t1", kind="full-train:cat", command=["python", "train.py"])
    task.status = "success"
    task.returncode = 0
    payload = task_payload(task)
    assert payload["id"] == "t1"
    assert payload["status"] == "success"
    assert payload["returncode"] == 0


def test_prediction_task_payload_includes_predictions_only_when_requested():
    task = PredictionTask(id="p1", profile=DEFAULT_PROFILE, upload_path=Path("t"))
    task.status = "completed"
    task.model_source = "pretrained"
    task.detections = [{"classId": 0, "name": "cat", "confidence": 0.9, "xyxy": [1, 2, 3, 4]}]
    assert "predictions" not in prediction_task_payload(task)
    payload = prediction_task_payload(task, include_predictions=True)
    assert "predictions" in payload
    assert payload["modelSource"] == "pretrained"
