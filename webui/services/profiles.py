from __future__ import annotations

import re
import shutil
from typing import Any

import yaml
from fastapi import HTTPException

from ..config import DATASET_PROFILES, DEFAULT_PROFILE, ROOT, refresh_profiles

PROFILE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$")


def resolve_profile(profile: str = DEFAULT_PROFILE) -> str:
    if not profile:
        profile = DEFAULT_PROFILE
    if profile not in DATASET_PROFILES:
        raise HTTPException(status_code=400, detail="无效的数据集配置")
    return profile


def profile_config(profile: str = DEFAULT_PROFILE) -> dict[str, Any]:
    return DATASET_PROFILES[resolve_profile(profile)]


def profile_classes(profile: str = DEFAULT_PROFILE) -> list[dict[str, Any]]:
    config = profile_config(profile)
    raw = yaml.safe_load(config["config"].read_text(encoding="utf-8")) or {}
    names = raw.get("names", {})
    display_names = raw.get("display_names", {})
    if isinstance(names, list):
        names = {index: value for index, value in enumerate(names)}
    if isinstance(display_names, list):
        display_names = {index: value for index, value in enumerate(display_names)}

    return [
        {
            "id": int(class_id),
            "name": str(name),
            "displayName": str(display_names.get(class_id, display_names.get(str(class_id), name))),
        }
        for class_id, name in sorted(names.items(), key=lambda item: int(item[0]))
    ]


def profile_run_prefix(profile: str) -> str:
    profile_config(profile)
    return f"{profile}_yolo11n"


def best_model_path(profile: str = DEFAULT_PROFILE) -> Any | None:
    """返回该配置最新的 best.pt 路径，没有则返回 None。"""
    prefix = profile_run_prefix(profile)
    candidates = list((ROOT / "runs").glob(f"{prefix}*/weights/best.pt"))
    if not candidates:
        return None
    return max(candidates, key=lambda item: item.stat().st_mtime)


def _normalize_classes(classes: list[dict[str, Any]] | None) -> tuple[dict[int, str], dict[int, str]]:
    """将前端传入的类别列表规范化为 {id: name} 与 {id: display_name}，id 从 0 递增。"""
    if not classes:
        raise HTTPException(status_code=400, detail="至少需要 1 个类别")
    if len(classes) > 200:
        raise HTTPException(status_code=400, detail="类别数量不能超过 200")
    names: dict[int, str] = {}
    display_names: dict[int, str] = {}
    seen: set[str] = set()
    for index, item in enumerate(classes):
        name = str(item.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail=f"第 {index + 1} 个类别缺少英文名称")
        if len(name) > 64:
            raise HTTPException(status_code=400, detail=f"类别名称过长：{name}")
        if name in seen:
            raise HTTPException(status_code=400, detail=f"类别名称重复：{name}")
        seen.add(name)
        names[index] = name
        display_name = str(item.get("displayName") or "").strip()
        if display_name:
            if len(display_name) > 64:
                raise HTTPException(status_code=400, detail=f"类别显示名过长：{display_name}")
            display_names[index] = display_name
    return names, display_names


def _write_profile_yaml(config_path: Any, profile_id: str, title: str, classes: list[dict[str, Any]]) -> None:
    names, display_names = _normalize_classes(classes)
    payload: dict[str, Any] = {
        "path": (ROOT / "datasets" / profile_id).as_posix(),
        "title": title,
        "train": "images/train",
        "val": "images/val",
        "test": "images/test",
        "names": names,
    }
    if display_names:
        payload["display_names"] = display_names
    config_path.write_text(
        "# 数据集配置，可在网页端「数据集配置」页面管理或直接编辑此文件\n"
        + yaml.safe_dump(payload, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )


def _ensure_split_dirs(root: Any) -> None:
    for split in ("train", "val", "test"):
        (root / "images" / split).mkdir(parents=True, exist_ok=True)
        (root / "labels" / split).mkdir(parents=True, exist_ok=True)


def create_profile(profile_id: str, title: str, classes: list[dict[str, Any]]) -> dict[str, Any]:
    from ..services.datasets import invalidate_dataset_counts

    profile_id = (profile_id or "").strip()
    title = (title or "").strip()
    if not PROFILE_ID_RE.match(profile_id):
        raise HTTPException(
            status_code=400,
            detail="配置 ID 只能包含字母、数字、下划线、短横线，且需以字母或数字开头（例如 cat_det）",
        )
    if not title:
        raise HTTPException(status_code=400, detail="标题不能为空")
    if len(title) > 64:
        raise HTTPException(status_code=400, detail="标题不能超过 64 个字符")
    if profile_id in DATASET_PROFILES:
        raise HTTPException(status_code=409, detail=f"配置 {profile_id} 已存在")
    root = ROOT / "datasets" / profile_id
    if root.exists():
        raise HTTPException(status_code=409, detail=f"数据集目录 datasets/{profile_id} 已存在，请先处理冲突")
    _ensure_split_dirs(root)
    _write_profile_yaml(root / f"{profile_id}.yaml", profile_id, title, classes)
    refresh_profiles()
    invalidate_dataset_counts(profile_id)
    return profile_payload(profile_id)


def update_profile(profile_id: str, title: str | None = None, classes: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    from ..services.datasets import invalidate_dataset_counts

    config = profile_config(profile_id)
    raw = yaml.safe_load(config["config"].read_text(encoding="utf-8")) or {}
    if title is not None:
        title = title.strip()
        if not title:
            raise HTTPException(status_code=400, detail="标题不能为空")
        if len(title) > 64:
            raise HTTPException(status_code=400, detail="标题不能超过 64 个字符")
        raw["title"] = title
    if classes is not None:
        names, display_names = _normalize_classes(classes)
        raw["names"] = names
        if display_names:
            raw["display_names"] = display_names
        else:
            raw.pop("display_names", None)
    config["config"].write_text(
        yaml.safe_dump(raw, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )
    refresh_profiles()
    invalidate_dataset_counts(profile_id)
    return profile_payload(profile_id)


def delete_profile(profile_id: str, delete_files: bool = False) -> dict[str, Any]:
    from ..services.datasets import invalidate_dataset_counts

    config = profile_config(profile_id)
    if len(DATASET_PROFILES) <= 1:
        raise HTTPException(status_code=400, detail="至少需要保留一个数据集配置，不能删除最后一个")
    root = config["root"]
    config["config"].unlink(missing_ok=True)
    if delete_files and root.exists():
        shutil.rmtree(root, ignore_errors=True)
    refresh_profiles()
    invalidate_dataset_counts(profile_id)
    return {"deleted": profile_id, "deleteFiles": delete_files}


def list_profile_models(profile: str) -> list[dict[str, Any]]:
    """列出该配置下所有已训练模型（runs/<prefix>*/weights/best.pt）。"""
    prefix = profile_run_prefix(profile)
    candidates = list((ROOT / "runs").glob(f"{prefix}*/weights/best.pt"))
    rows = []
    for path in sorted(candidates, key=lambda item: item.stat().st_mtime, reverse=True):
        stat = path.stat()
        rows.append(
            {
                "path": str(path),
                "name": path.parents[1].name,
                "mtime": stat.st_mtime,
                "size": stat.st_size,
                "url": f"/files/{path.relative_to(ROOT).as_posix()}",
            }
        )
    return rows


def profile_payload(profile: str) -> dict[str, Any]:
    from ..services.datasets import dataset_counts

    config = profile_config(profile)
    classes = profile_classes(profile)
    counts = dataset_counts(profile)
    best = best_model_path(profile)
    return {
        "id": profile,
        "title": config["title"],
        "configPath": str(config["config"]),
        "classes": classes,
        "classCount": len(classes),
        "totalImages": counts["totalImages"],
        "totalLabels": counts["totalLabels"],
        "ready": counts["ready"],
        "bestModel": str(best) if best else None,
    }


def list_profiles() -> list[dict[str, Any]]:
    return [profile_payload(profile) for profile in DATASET_PROFILES]
