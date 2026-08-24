from __future__ import annotations

import shutil
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from ..schemas import DatasetImagesResponse, SaveLabelsResponse, UploadResponse

from ..config import DEFAULT_PROFILE, IMAGE_EXTS, VALID_SPLITS
from ..services.dataset_check import load_dataset_report
from ..services.datasets import (
    _label_file_mtime,
    dataset_counts,
    dataset_index,
    delete_dataset_images,
    image_record,
    invalidate_dataset_counts,
    invalidate_dataset_index,
    commit_staged_uploads,
    safe_filename,
    save_upload,
    save_yolo_labels_atomic,
    split_paths,
    validate_yolo_label_file,
)
from ..services.profiles import profile_classes, profile_config, resolve_profile

router = APIRouter()


@router.get("/api/dataset/check")
def get_dataset_check(profile: str = DEFAULT_PROFILE) -> dict[str, Any]:
    profile = resolve_profile(profile)
    return {"report": load_dataset_report(profile)}


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
    # 客户端保存时回传上次读取到的标签文件 mtime；None 表示当时无标签文件。
    # 若与服务端当前值不一致，说明被其他窗口修改过，返回 409 避免后写覆盖先写。
    expected_label_mtime: float | None = None


class BatchDeleteImagesRequest(BaseModel):
    profile: str = DEFAULT_PROFILE
    split: str
    filenames: list[str] = Field(default_factory=list)


@router.post("/api/dataset/upload", response_model=UploadResponse)
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
    dataset_root = Path(profile_config(profile)["root"])
    staging_dir = Path(tempfile.mkdtemp(prefix=".upload-", dir=dataset_root))

    try:
        staging_images = staging_dir / "images"
        staging_labels = staging_dir / "labels"
        staging_images.mkdir()
        staging_labels.mkdir()

        staged_images = []
        staged_labels = []
        for image in images:
            if image.filename:
                staged_images.append(await save_upload(image, staging_images, IMAGE_EXTS))
        for label in labels:
            if label.filename:
                staged_labels.append(await save_upload(label, staging_labels, {".txt"}))

        # 先完成全量校验，再进入正式目录；任何非法文件都不会污染现有数据集。
        for staged_label in staged_labels:
            validate_yolo_label_file(staging_labels / staged_label["name"], profile)

        saved_images, saved_labels = commit_staged_uploads(
            staged_images,
            staged_labels,
            staging_images,
            staging_labels,
            image_dir,
            label_dir,
        )
    finally:
        shutil.rmtree(staging_dir, ignore_errors=True)

    invalidate_dataset_counts(profile)
    invalidate_dataset_index(profile, split)

    return {
        "savedImages": saved_images,
        "savedLabels": saved_labels,
        "dataset": dataset_counts(profile),
    }


@router.get("/api/dataset/images", response_model=DatasetImagesResponse)
def dataset_images(profile: str = DEFAULT_PROFILE, split: str = "train", page: int = 1, page_size: int = 60, label: str = "all", include_boxes: bool = True) -> dict[str, Any]:
    profile = resolve_profile(profile)
    images_dir, _ = split_paths(profile, split)
    # 目录索引缓存：预排序 (文件名, 是否有标签)，命中时避免全量扫描与逐文件 stat。
    entries = dataset_index(profile, split)
    if label in ("labeled", "unlabeled"):
        want_label = label == "labeled"
        entries = [(name, has_label) for name, has_label in entries if has_label == want_label]
    total = len(entries)
    page = max(1, page)
    page_size = min(max(1, page_size), 200)
    page_count = (total + page_size - 1) // page_size if total else 0
    if page_count and page > page_count:
        page = page_count
    elif total == 0:
        page = 1
    start = (page - 1) * page_size
    page_names = [name for name, _ in entries[start : start + page_size]]

    images = []
    stale = False
    for name in page_names:
        image_path = images_dir / name
        if not image_path.exists():
            # 索引构建后文件被外部删除：跳过并失效索引，下一次请求重建。
            stale = True
            continue
        images.append(image_record(image_path, profile, split, include_boxes=include_boxes))
    if stale:
        invalidate_dataset_index(profile, split)
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


@router.post("/api/dataset/labels", response_model=SaveLabelsResponse)
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
    current_label_mtime = _label_file_mtime(label_path)
    expected = payload.expected_label_mtime
    if (expected is None) != (current_label_mtime is None) or (
        expected is not None and abs(expected - current_label_mtime) > 1e-6
    ):
        raise HTTPException(
            status_code=409,
            detail="标注已被其他窗口修改，请重新加载后再编辑",
        )

    lines = []
    for box in payload.boxes:
        lines.append(
            f"{box.class_id} {box.x:.6f} {box.y:.6f} {box.width:.6f} {box.height:.6f}"
        )
    save_yolo_labels_atomic(label_path, lines)

    invalidate_dataset_counts(payload.profile)
    invalidate_dataset_index(payload.profile, payload.split)

    return {
        "image": image_record(image_path, payload.profile, payload.split),
        "dataset": dataset_counts(payload.profile),
    }


@router.post("/api/dataset/images/batch-delete")
def batch_delete_images(payload: BatchDeleteImagesRequest) -> dict[str, Any]:
    profile = resolve_profile(payload.profile)
    return delete_dataset_images(profile, payload.split, payload.filenames)


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
    invalidate_dataset_index(profile, split)

    return {"dataset": dataset_counts(profile)}
