from __future__ import annotations

import time
import uuid
from pathlib import Path
from typing import Any

import cv2
from fastapi import HTTPException, UploadFile

from ..config import (
    DEFAULT_PROFILE,
    IMAGE_EXTS,
    MAX_UPLOAD_BYTES,
    ROOT,
    VALID_SPLITS,
    dataset_counts_cache,
    dataset_counts_ttl,
    image_dims_cache,
)
from .profiles import profile_classes, profile_config


def dataset_counts(profile: str = DEFAULT_PROFILE) -> dict[str, Any]:
    cached = dataset_counts_cache.get(profile)
    if cached and time.time() - cached[0] < dataset_counts_ttl:
        return cached[1]

    dataset_root = profile_config(profile)["root"]
    splits: dict[str, Any] = {}
    total_images = 0
    total_labels = 0
    for split in ("train", "val", "test"):
        images_dir = dataset_root / "images" / split
        labels_dir = dataset_root / "labels" / split
        images = [p for p in images_dir.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTS]
        labels = [p for p in labels_dir.glob("*.txt") if p.is_file()]
        image_stems = {p.stem for p in images}
        label_stems = {p.stem for p in labels}
        missing_labels = sorted(image_stems - label_stems)
        orphan_labels = sorted(label_stems - image_stems)
        splits[split] = {
            "images": len(images),
            "labels": len(labels),
            "missingLabels": missing_labels[:20],
            "orphanLabels": orphan_labels[:20],
            "missingLabelCount": len(missing_labels),
            "orphanLabelCount": len(orphan_labels),
        }
        total_images += len(images)
        total_labels += len(labels)

    result = {
        "profile": profile,
        "splits": splits,
        "totalImages": total_images,
        "totalLabels": total_labels,
        "ready": splits["train"]["images"] > 0 and splits["val"]["images"] > 0,
    }
    dataset_counts_cache[profile] = (time.time(), result)
    return result


def invalidate_dataset_counts(profile: str) -> None:
    dataset_counts_cache.pop(profile, None)


def safe_filename(name: str) -> str:
    cleaned = Path(name or "file").name.replace(" ", "_")
    allowed = []
    for char in cleaned:
        if char.isalnum() or char in {"-", "_", "."}:
            allowed.append(char)
    result = "".join(allowed).strip(".")
    return result or f"file_{uuid.uuid4().hex[:8]}"


def split_paths(profile: str, split: str) -> tuple[Path, Path]:
    if split not in VALID_SPLITS:
        raise HTTPException(status_code=400, detail="无效的数据集分组")
    dataset_root = profile_config(profile)["root"]
    return dataset_root / "images" / split, dataset_root / "labels" / split


def parse_yolo_labels(label_path: Path) -> list[dict[str, Any]]:
    if not label_path.exists():
        return []

    boxes: list[dict[str, Any]] = []
    for line in label_path.read_text(encoding="utf-8", errors="replace").splitlines():
        parts = line.strip().split()
        if len(parts) != 5:
            continue
        try:
            boxes.append({
                "classId": int(parts[0]),
                "x": float(parts[1]),
                "y": float(parts[2]),
                "width": float(parts[3]),
                "height": float(parts[4]),
            })
        except ValueError:
            continue
    return boxes


def image_dimensions(image_path: Path) -> tuple[int, int]:
    try:
        mtime = image_path.stat().st_mtime
    except OSError:
        return 0, 0
    key = (str(image_path.resolve()), mtime)
    dims = image_dims_cache.get(key)
    if dims is None:
        try:
            image = cv2.imread(str(image_path))
            height, width = image.shape[:2] if image is not None else (0, 0)
            dims = (int(width), int(height))
        except Exception:
            dims = (0, 0)
        if len(image_dims_cache) > 4000:
            image_dims_cache.clear()
        image_dims_cache[key] = dims
    return dims


def validate_yolo_label_file(label_path: Path, profile: str) -> None:
    valid_class_ids = {item["id"] for item in profile_classes(profile)}
    for line_no, line in enumerate(label_path.read_text(encoding="utf-8", errors="replace").splitlines(), start=1):
        stripped = line.strip()
        if not stripped:
            continue
        parts = stripped.split()
        if len(parts) != 5:
            raise HTTPException(status_code=400, detail=f"标签格式错误: {label_path.name}:{line_no}")
        try:
            class_id = int(parts[0])
            x, y, width, height = [float(value) for value in parts[1:]]
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"标签数值错误: {label_path.name}:{line_no}") from exc
        if class_id not in valid_class_ids:
            raise HTTPException(status_code=400, detail=f"标签类别不存在: {label_path.name}:{line_no}")
        if not (0 <= x <= 1 and 0 <= y <= 1 and 0 < width <= 1 and 0 < height <= 1):
            raise HTTPException(status_code=400, detail=f"标签坐标越界: {label_path.name}:{line_no}")


def image_record(image_path: Path, profile: str, split: str) -> dict[str, Any]:
    _, labels_dir = split_paths(profile, split)
    label_path = labels_dir / f"{image_path.stem}.txt"
    width, height = image_dimensions(image_path)
    rel = image_path.relative_to(ROOT).as_posix()
    return {
        "name": image_path.name,
        "stem": image_path.stem,
        "profile": profile,
        "split": split,
        "url": f"/files/{rel}",
        "width": width,
        "height": height,
        "hasLabel": label_path.exists(),
        "labelCount": len(parse_yolo_labels(label_path)),
        "boxes": parse_yolo_labels(label_path),
        "mtime": image_path.stat().st_mtime,
    }


async def save_upload(file: UploadFile, target_dir: Path, allowed_exts: set[str]) -> dict[str, Any]:
    name = safe_filename(file.filename or "upload")
    suffix = Path(name).suffix.lower()
    if suffix not in allowed_exts:
        raise HTTPException(status_code=400, detail=f"不支持的文件类型：{name}")

    target = target_dir / name
    if target.exists():
        target = target_dir / f"{target.stem}_{uuid.uuid4().hex[:6]}{target.suffix}"

    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"文件过大: {name}")

    with target.open("wb") as out:
        out.write(content)

    return {"name": target.name, "path": str(target)}
