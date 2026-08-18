from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from ..config import DEFAULT_PROFILE, IMAGE_EXTS, VALID_SPLITS
from ..services.datasets import (
    dataset_counts,
    image_record,
    invalidate_dataset_counts,
    safe_filename,
    save_upload,
    split_paths,
    validate_yolo_label_file,
)
from ..services.profiles import profile_classes, resolve_profile

router = APIRouter()


class AnnotationBox(BaseModel):
    class_id: int = Field(default=0, ge=0)
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)


class SaveLabelsRequest(BaseModel):
    profile: str = DEFAULT_PROFILE
    split: str
    filename: str
    boxes: list[AnnotationBox] = Field(default_factory=list)


@router.post("/api/dataset/upload")
async def upload_dataset(
    profile: str = Form(DEFAULT_PROFILE),
    split: str = Form(...),
    images: list[UploadFile] = File(default=[]),
    labels: list[UploadFile] = File(default=[]),
) -> dict[str, Any]:
    if split not in VALID_SPLITS:
        raise HTTPException(status_code=400, detail="无效的数据集分组")

    profile = resolve_profile(profile)
    image_dir, label_dir = split_paths(profile, split)
    image_dir.mkdir(parents=True, exist_ok=True)
    label_dir.mkdir(parents=True, exist_ok=True)

    saved_images = []
    saved_labels = []
    for image in images:
        if image.filename:
            saved_images.append(await save_upload(image, image_dir, IMAGE_EXTS))
    for label in labels:
        if label.filename:
            saved_label = await save_upload(label, label_dir, {".txt"})
            label_path = Path(saved_label["path"])
            try:
                validate_yolo_label_file(label_path, profile)
            except HTTPException:
                label_path.unlink(missing_ok=True)
                raise
            saved_labels.append(saved_label)

    invalidate_dataset_counts(profile)

    return {
        "savedImages": saved_images,
        "savedLabels": saved_labels,
        "dataset": dataset_counts(profile),
    }


@router.get("/api/dataset/images")
def dataset_images(profile: str = DEFAULT_PROFILE, split: str = "train", page: int = 1, page_size: int = 60, label: str = "all") -> dict[str, Any]:
    profile = resolve_profile(profile)
    images_dir, labels_dir = split_paths(profile, split)
    all_images = sorted(
        [path for path in images_dir.iterdir() if path.is_file() and path.suffix.lower() in IMAGE_EXTS],
        key=lambda item: item.name.lower(),
    )
    if label in ("labeled", "unlabeled"):
        want_label = label == "labeled"
        all_images = [p for p in all_images if (labels_dir / f"{p.stem}.txt").exists() == want_label]
    total = len(all_images)
    page = max(1, page)
    page_size = min(max(1, page_size), 200)
    page_count = (total + page_size - 1) // page_size if total else 0
    if page_count and page > page_count:
        page = page_count
    elif total == 0:
        page = 1
    start = (page - 1) * page_size
    images = [image_record(path, profile, split) for path in all_images[start : start + page_size]]
    return {
        "profile": profile,
        "split": split,
        "classes": profile_classes(profile),
        "images": images,
        "total": total,
        "page": page,
        "pageSize": page_size,
        "pageCount": page_count,
    }


@router.post("/api/dataset/labels")
def save_dataset_labels(payload: SaveLabelsRequest) -> dict[str, Any]:
    resolve_profile(payload.profile)
    images_dir, labels_dir = split_paths(payload.profile, payload.split)
    valid_class_ids = {item["id"] for item in profile_classes(payload.profile)}
    invalid_boxes = [box.class_id for box in payload.boxes if box.class_id not in valid_class_ids]
    if invalid_boxes:
        raise HTTPException(status_code=400, detail="标注类别不在当前数据集配置中")

    image_name = safe_filename(payload.filename)
    image_path = images_dir / image_name
    if image_path.suffix.lower() not in IMAGE_EXTS or not image_path.exists():
        raise HTTPException(status_code=404, detail="训练图片不存在")

    label_path = labels_dir / f"{image_path.stem}.txt"
    lines = []
    for box in payload.boxes:
        lines.append(
            f"{box.class_id} {box.x:.6f} {box.y:.6f} {box.width:.6f} {box.height:.6f}"
        )
    label_path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")

    invalidate_dataset_counts(payload.profile)

    return {
        "image": image_record(image_path, payload.profile, payload.split),
        "dataset": dataset_counts(payload.profile),
    }


@router.delete("/api/dataset/images/{profile}/{split}/{filename}")
def delete_dataset_image(profile: str, split: str, filename: str) -> dict[str, Any]:
    profile = resolve_profile(profile)
    images_dir, labels_dir = split_paths(profile, split)
    image_name = safe_filename(filename)
    image_path = images_dir / image_name
    if image_path.suffix.lower() not in IMAGE_EXTS or not image_path.exists():
        raise HTTPException(status_code=404, detail="训练图片不存在")

    label_path = labels_dir / f"{image_path.stem}.txt"
    image_path.unlink()
    if label_path.exists():
        label_path.unlink()

    invalidate_dataset_counts(profile)

    return {"dataset": dataset_counts(profile)}
