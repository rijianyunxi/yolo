import sys
import uuid

import pytest
from fastapi import HTTPException

sys.path.insert(0, "D:/work/yolo")

from webui.config import DATASET_PROFILES, DEFAULT_PROFILE, ROOT, refresh_profiles
from webui.services import profiles as svc


@pytest.fixture()
def temp_profile():
    """创建一个临时数据集配置，测试结束无论成败都删除（含文件）。"""
    pid = f"zz_test_{uuid.uuid4().hex[:8]}"
    created = svc.create_profile(pid, "临时测试配置", [{"name": "a", "displayName": "甲"}, {"name": "b", "displayName": "乙"}])
    assert pid in DATASET_PROFILES
    try:
        yield pid
    finally:
        if pid in DATASET_PROFILES:
            svc.delete_profile(pid, delete_files=True)


def test_create_profile_creates_yaml_and_dirs(temp_profile):
    pid = temp_profile
    config = svc.profile_config(pid)
    assert config["config"].name == f"{pid}.yaml"
    for split in ("train", "val", "test"):
        assert (config["root"] / "images" / split).is_dir()
        assert (config["root"] / "labels" / split).is_dir()


def test_create_profile_classes_order(temp_profile):
    pid = temp_profile
    classes = svc.profile_classes(pid)
    assert [c["name"] for c in classes] == ["a", "b"]
    assert [c["displayName"] for c in classes] == ["甲", "乙"]


def test_create_duplicate_profile_rejected(temp_profile):
    pid = temp_profile
    with pytest.raises(HTTPException) as exc:
        svc.create_profile(pid, "重复", [{"name": "x"}])
    assert exc.value.status_code == 409


def test_create_invalid_id_rejected():
    with pytest.raises(HTTPException) as exc:
        svc.create_profile("bad id!", "标题", [{"name": "x"}])
    assert exc.value.status_code == 400


def test_update_title_and_classes(temp_profile):
    pid = temp_profile
    updated = svc.update_profile(
        pid,
        title="改后的标题",
        classes=[{"name": "c", "displayName": "丙"}, {"name": "d"}],
    )
    assert updated["title"] == "改后的标题"
    assert [c["name"] for c in updated["classes"]] == ["c", "d"]
    assert [c["displayName"] for c in updated["classes"]] == ["丙", "d"]


def test_update_only_title_preserves_classes(temp_profile):
    pid = temp_profile
    updated = svc.update_profile(pid, title="只有标题")
    assert updated["classCount"] == 2


def test_list_profiles_and_models(temp_profile):
    pid = temp_profile
    items = svc.list_profiles()
    ids = [item["id"] for item in items]
    assert pid in ids
    assert svc.list_profile_models(pid) == []


def test_best_model_path_none_and_models(temp_profile):
    pid = temp_profile
    assert svc.best_model_path(pid) is None
    weights = ROOT / "runs" / f"{pid}_yolo11n" / "weights"
    weights.mkdir(parents=True, exist_ok=True)
    (weights / "best.pt").write_bytes(b"weights")
    try:
        rows = svc.list_profile_models(pid)
        assert rows and rows[0]["size"] == 7
        assert rows[0]["url"].startswith("/files/")
    finally:
        import shutil
        shutil.rmtree(weights.parent, ignore_errors=True)


def test_delete_last_profile_blocked():
    # 仅当当前只有一个配置时，删除应被拒绝
    if len(DATASET_PROFILES) == 1:
        only = DEFAULT_PROFILE
        with pytest.raises(HTTPException) as exc:
            svc.delete_profile(only)
        assert exc.value.status_code == 400
    else:
        pytest.skip("当前存在多个配置，跳过删除唯一配置保护测试")
