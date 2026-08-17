from __future__ import annotations

from typing import Any

import yaml
from fastapi import HTTPException

from ..config import DATASET_PROFILES, DEFAULT_PROFILE


def profile_config(profile: str = DEFAULT_PROFILE) -> dict[str, Any]:
    if profile not in DATASET_PROFILES:
        raise HTTPException(status_code=400, detail="无效的数据集配置")
    return DATASET_PROFILES[profile]


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
