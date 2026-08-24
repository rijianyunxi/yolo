from __future__ import annotations

import hashlib
import os
import re
import threading
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
    THUMBNAILS_DIR,
    VALID_SPLITS,
    dataset_counts_cache,
    dataset_counts_cache_stats,
    dataset_counts_ttl,
    dataset_index_cache,
    dataset_index_cache_stats,
    dataset_index_ttl,
    image_dims_cache,
    image_dims_cache_stats,
    THUMBNAIL_CACHE_MAX_BYTES,
    THUMBNAIL_CACHE_MAX_ENTRIES,
    THUMBNAIL_CACHE_PRUNE_INTERVAL_SECONDS,
    THUMBNAIL_CACHE_TTL_SECONDS,
    thumbnail_cache_lock,
    thumbnail_cache_stats,
)
from .profiles import profile_classes, profile_config


_label_locks_guard = threading.Lock()
_label_locks: dict[str, threading.Lock] = {}


def _label_lock(label_path: Path) -> threading.Lock:
    key = str(label_path.resolve())
    with _label_locks_guard:
        return _label_locks.setdefault(key, threading.Lock())


def save_yolo_labels_atomic(label_path: Path, lines: list[str]) -> None:
    """以原子替换方式保存标签，避免中断时留下半截文件。"""
    label_path.parent.mkdir(parents=True, exist_ok=True)
    lock = _label_lock(label_path)
    temp_path = label_path.with_name(f".{label_path.name}.{uuid.uuid4().hex}.tmp")
    content = "\n".join(lines) + ("\n" if lines else "")
    with lock:
        try:
            temp_path.write_text(content, encoding="utf-8")
            os.replace(temp_path, label_path)
        finally:
            try:
                temp_path.unlink(missing_ok=True)
            except OSError:
                pass


def dataset_counts(profile: str = DEFAULT_PROFILE) -> dict[str, Any]:
    cached = dataset_counts_cache.get(profile)
    if cached and time.time() - cached[0] < dataset_counts_ttl:
        dataset_counts_cache_stats["hits"] += 1
        dataset_counts_cache_stats["entries"] = len(dataset_counts_cache)
        return cached[1]
    if cached:
        dataset_counts_cache_stats["expirations"] += 1
    dataset_counts_cache_stats["misses"] += 1

    dataset_root = profile_config(profile)["root"]
    splits: dict[str, Any] = {}
    total_images = 0
    total_labels = 0
    for split in ("train", "val", "test"):
        images_dir, labels_dir = resolve_split_dirs(dataset_root, split)
        if not images_dir.exists():
            splits[split] = {
                "images": 0,
                "labels": 0,
                "missingLabels": [],
                "orphanLabels": [],
                "missingLabelCount": 0,
                "orphanLabelCount": 0,
            }
            continue
        images = []
        try:
            images = [p for p in images_dir.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTS]
        except OSError:
            images = []
        labels = []
        if labels_dir.exists():
            try:
                labels = [p for p in labels_dir.glob("*.txt") if p.is_file()]
            except OSError:
                labels = []
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
    dataset_counts_cache_stats["entries"] = len(dataset_counts_cache)
    return result


def invalidate_dataset_counts(profile: str) -> None:
    dataset_counts_cache.pop(profile, None)
    dataset_counts_cache_stats["entries"] = len(dataset_counts_cache)

def dataset_cache_stats_snapshot() -> dict[str, Any]:
    dataset_counts_cache_stats["entries"] = len(dataset_counts_cache)
    requests = dataset_counts_cache_stats["hits"] + dataset_counts_cache_stats["misses"]
    return {
        **dataset_counts_cache_stats,
        "hitRate": dataset_counts_cache_stats["hits"] / requests if requests else 0.0,
    }


def natural_sort_key(name: str) -> list[tuple[int, int | str]]:
    """Natural sort key: splits a filename into digit/non-digit chunks so that
    1, 2, 10, 100 sort numerically instead of lexically."""
    return [
        (0, int(chunk)) if chunk.isdigit() else (1, chunk.lower())
        for chunk in re.split(r"(\d+)", name)
        if chunk != ""
    ]


def dataset_index(profile: str, split: str) -> list[tuple[str, bool]]:
    """返回按自然序排序的 (文件名, 是否有标签) 列表，带 TTL 目录索引缓存。

    万级图片下避免每次列表请求全量扫描目录并对每个文件 stat 标签文件；
    保存标注、上传、删除后调用 invalidate_dataset_index 显式失效。
    """
    cached = dataset_index_cache.get((profile, split))
    if cached is not None and time.time() - cached[0] < dataset_index_ttl:
        dataset_index_cache_stats["hits"] += 1
        dataset_index_cache_stats["entries"] = len(dataset_index_cache)
        return cached[1]
    if cached is not None:
        dataset_index_cache_stats["expirations"] += 1
    dataset_index_cache_stats["misses"] += 1

    images_dir, labels_dir = split_paths(profile, split)
    entries: list[tuple[str, bool]] = []
    try:
        for path in images_dir.iterdir():
            if path.is_file() and path.suffix.lower() in IMAGE_EXTS:
                entries.append((path.name, (labels_dir / f"{path.stem}.txt").exists()))
    except OSError:
        # 分组目录尚未创建时按空列表处理，与 dataset_counts 行为一致。
        entries = []
    entries.sort(key=lambda item: natural_sort_key(item[0]))
    dataset_index_cache[(profile, split)] = (time.time(), entries)
    dataset_index_cache_stats["entries"] = len(dataset_index_cache)
    return entries


def invalidate_dataset_index(profile: str, split: str | None = None) -> None:
    """显式失效某个配置（或指定分组）的目录索引。"""
    keys = [
        key
        for key in dataset_index_cache
        if key[0] == profile and (split is None or key[1] == split)
    ]
    for key in keys:
        dataset_index_cache.pop(key, None)
    if keys:
        dataset_index_cache_stats["invalidations"] += len(keys)
    dataset_index_cache_stats["entries"] = len(dataset_index_cache)


def dataset_index_cache_stats_snapshot() -> dict[str, Any]:
    dataset_index_cache_stats["entries"] = len(dataset_index_cache)
    requests = dataset_index_cache_stats["hits"] + dataset_index_cache_stats["misses"]
    return {
        **dataset_index_cache_stats,
        "hitRate": dataset_index_cache_stats["hits"] / requests if requests else 0.0,
    }


def image_dimensions_cache_stats_snapshot() -> dict[str, Any]:
    image_dims_cache_stats["entries"] = len(image_dims_cache)
    requests = image_dims_cache_stats["hits"] + image_dims_cache_stats["misses"]
    return {
        **image_dims_cache_stats,
        "hitRate": image_dims_cache_stats["hits"] / requests if requests else 0.0,
    }


def safe_filename(name: str) -> str:
    cleaned = Path(name or "file").name.replace(" ", "_")
    allowed = []
    for char in cleaned:
        if char.isalnum() or char in {"-", "_", "."}:
            allowed.append(char)
    result = "".join(allowed).strip(".")
    return result or f"file_{uuid.uuid4().hex[:8]}"


def resolve_split_dirs(dataset_root: Path, split: str) -> tuple[Path, Path]:
    """解析某个分组的图片/标签目录，兼容两种布局：
    - 标准布局:  <root>/images/<split> 与 <root>/labels/<split>
    - Roboflow 布局: <root>/<split_dir>/images 与 <root>/<split_dir>/labels
      （split_dir 对于 val 可能是 valid）
    优先返回实际存在的目录；都不存在时回退到标准布局路径。
    """
    split_dir_candidates: dict[str, list[str]] = {
        "train": ["train"],
        "val": ["valid", "val"],
        "test": ["test"],
    }
    standard_images = dataset_root / "images" / split
    if standard_images.exists():
        return standard_images, dataset_root / "labels" / split
    for split_dir in split_dir_candidates.get(split, [split]):
        robo_images = dataset_root / split_dir / "images"
        if robo_images.exists():
            return robo_images, dataset_root / split_dir / "labels"
    return standard_images, dataset_root / "labels" / split


def split_paths(profile: str, split: str) -> tuple[Path, Path]:
    if split not in VALID_SPLITS:
        raise HTTPException(status_code=400, detail="无效的数据集分组")
    dataset_root = profile_config(profile)["root"]
    return resolve_split_dirs(dataset_root, split)


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


def count_yolo_labels(label_path: Path) -> int:
    """统计有效 YOLO 标注行，但不构造 box 字典。

    轻量列表只需要 labelCount；避免为每张图创建大量临时对象和响应负载。
    """
    if not label_path.exists():
        return 0

    count = 0
    for line in label_path.read_text(encoding="utf-8", errors="replace").splitlines():
        parts = line.strip().split()
        if len(parts) != 5:
            continue
        try:
            int(parts[0])
            float(parts[1])
            float(parts[2])
            float(parts[3])
            float(parts[4])
        except ValueError:
            continue
        count += 1
    return count


def image_dimensions(image_path: Path) -> tuple[int, int]:
    try:
        mtime = image_path.stat().st_mtime
    except OSError:
        return 0, 0
    key = (str(image_path.resolve()), mtime)
    dims = image_dims_cache.get(key)
    if dims is not None:
        image_dims_cache_stats["hits"] += 1
        image_dims_cache_stats["entries"] = len(image_dims_cache)
    if dims is None:
        image_dims_cache_stats["misses"] += 1
        try:
            image = cv2.imread(str(image_path))
            height, width = image.shape[:2] if image is not None else (0, 0)
            dims = (int(width), int(height))
        except Exception:
            dims = (0, 0)
        if len(image_dims_cache) >= 4000:
            image_dims_cache.clear()
            image_dims_cache_stats["evictions"] += 1
        image_dims_cache[key] = dims
        image_dims_cache_stats["entries"] = len(image_dims_cache)
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


def _thumbnail_cache_snapshot() -> dict[str, Any]:
    entries = 0
    total_bytes = 0
    try:
        for path in THUMBNAILS_DIR.glob("*.jpg"):
            if path.is_file():
                entries += 1
                try:
                    total_bytes += path.stat().st_size
                except OSError:
                    pass
    except OSError:
        pass
    thumbnail_cache_stats["entries"] = entries
    thumbnail_cache_stats["bytes"] = total_bytes
    requests = thumbnail_cache_stats["hits"] + thumbnail_cache_stats["misses"]
    thumbnail_cache_stats["hitRate"] = thumbnail_cache_stats["hits"] / requests if requests else 0.0
    return dict(thumbnail_cache_stats)


def prune_thumbnail_cache(force: bool = False) -> dict[str, Any]:
    """按 TTL、最大文件数和总字节数清理缩略图缓存。"""
    now = time.time()
    with thumbnail_cache_lock:
        last_pruned = float(thumbnail_cache_stats.get("lastPrunedAt", 0))
        if not force and now - last_pruned < THUMBNAIL_CACHE_PRUNE_INTERVAL_SECONDS:
            return _thumbnail_cache_snapshot()
        thumbnail_cache_stats["lastPrunedAt"] = now
        try:
            files = [item for item in THUMBNAILS_DIR.iterdir() if item.is_file()]
        except OSError:
            return _thumbnail_cache_snapshot()
        cutoff = now - max(0.0, THUMBNAIL_CACHE_TTL_SECONDS)
        jpg_files: list[tuple[Path, float, int]] = []
        for path in files:
            try:
                stat = path.stat()
            except OSError:
                continue
            # 并发生成留下的临时文件不应无限积累。
            if path.name.startswith(".") and path.suffix == ".tmp":
                if stat.st_mtime <= cutoff:
                    try:
                        path.unlink()
                    except OSError:
                        pass
                continue
            if path.suffix.lower() != ".jpg":
                continue
            if stat.st_mtime <= cutoff:
                try:
                    path.unlink()
                    thumbnail_cache_stats["expirations"] += 1
                except OSError:
                    pass
                continue
            jpg_files.append((path, stat.st_mtime, stat.st_size))

        jpg_files.sort(key=lambda item: item[1])
        total_bytes = sum(item[2] for item in jpg_files)
        while len(jpg_files) > THUMBNAIL_CACHE_MAX_ENTRIES or total_bytes > THUMBNAIL_CACHE_MAX_BYTES:
            path, _, size = jpg_files.pop(0)
            try:
                path.unlink()
                total_bytes -= size
                thumbnail_cache_stats["evictions"] += 1
            except OSError:
                pass
        return _thumbnail_cache_snapshot()


def thumbnail_cache_stats_snapshot() -> dict[str, Any]:
    with thumbnail_cache_lock:
        return _thumbnail_cache_snapshot()


def thumbnail_cache_path(image_path: Path, width: int = 192) -> Path:
    """根据源文件路径、修改时间和大小生成稳定缩略图缓存路径。"""
    stat = image_path.stat()
    cache_key = hashlib.sha256(
        f"{image_path.resolve()}:{stat.st_mtime_ns}:{stat.st_size}:{width}".encode("utf-8")
    ).hexdigest()
    return THUMBNAILS_DIR / f"{cache_key}.jpg"


def ensure_thumbnail(image_path: Path, width: int = 192) -> Path:
    """生成固定最大宽度的 JPEG 缩略图，并以原子方式写入缓存。"""
    with thumbnail_cache_lock:
        prune_thumbnail_cache(force=False)
        target = thumbnail_cache_path(image_path, width)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and target.is_file():
            target.touch()
            thumbnail_cache_stats["hits"] += 1
            return target
        thumbnail_cache_stats["misses"] += 1
        image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if image is None:
            raise HTTPException(status_code=422, detail="图片无法读取，不能生成缩略图")
        height, source_width = image.shape[:2]
        if source_width > width:
            target_height = max(1, round(height * width / source_width))
            image = cv2.resize(image, (width, target_height), interpolation=cv2.INTER_AREA)
        temp = target.with_name(f".{target.name}.{uuid.uuid4().hex}.tmp")
        try:
            encoded_ok, encoded = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 82])
            if not encoded_ok:
                raise HTTPException(status_code=500, detail="缩略图编码失败")
            temp.write_bytes(encoded.tobytes())
            os.replace(temp, target)
        finally:
            try:
                temp.unlink(missing_ok=True)
            except OSError:
                pass
        prune_thumbnail_cache(force=True)
        return target

def image_record(image_path: Path, profile: str, split: str, include_boxes: bool = True) -> dict[str, Any]:
    _, labels_dir = split_paths(profile, split)
    label_path = labels_dir / f"{image_path.stem}.txt"
    width, height = image_dimensions(image_path)
    rel = image_path.relative_to(ROOT).as_posix()
    # 完整模式只解析一次：labelCount 与 boxes 复用结果；轻量列表跳过对象解析，仅统计有效行。
    boxes: list[dict[str, Any]] | None = None
    label_count = count_yolo_labels(label_path) if not include_boxes else 0
    if include_boxes:
        boxes = parse_yolo_labels(label_path)
        label_count = len(boxes)
    record = {
        "name": image_path.name,
        "stem": image_path.stem,
        "profile": profile,
        "split": split,
        "url": f"/files/{rel}",
        "thumbnailUrl": f"/thumbnails/{profile}/{split}/{image_path.name}",
        "width": width,
        "height": height,
        "hasLabel": label_path.exists(),
        "labelCount": label_count,
        "boxes": boxes or [],
        "labelMtime": _label_file_mtime(label_path),
        "mtime": _file_mtime(image_path),
    }
    return record


def _file_mtime(image_path: Path) -> float:
    """容错读取修改时间；文件在索引构建后被外部删除时返回 0 而不是抛错。"""
    try:
        return image_path.stat().st_mtime
    except OSError:
        return 0.0


def _label_file_mtime(label_path: Path) -> float | None:
    """容错读取标签文件修改时间；文件不存在时返回 None，供多窗口保存冲突校验使用。"""
    try:
        return label_path.stat().st_mtime
    except OSError:
        return None


def delete_dataset_images(profile: str, split: str, filenames: list[str]) -> dict[str, Any]:
    images_dir, labels_dir = split_paths(profile, split)
    targets: list[tuple[Path, Path]] = []
    seen: set[str] = set()
    for filename in filenames:
        image_name = safe_filename(filename)
        if image_name in seen:
            continue
        seen.add(image_name)
        image_path = images_dir / image_name
        if image_path.suffix.lower() not in IMAGE_EXTS or not image_path.exists():
            raise HTTPException(status_code=404, detail=f"训练图片不存在: {filename}")
        label_path = labels_dir / f"{image_path.stem}.txt"
        targets.append((image_path, label_path))

    deleted = []
    for image_path, label_path in targets:
        image_path.unlink()
        if label_path.exists():
            label_path.unlink()
        deleted.append(image_path.name)

    invalidate_dataset_counts(profile)
    invalidate_dataset_index(profile, split)
    return {"deleted": deleted, "dataset": dataset_counts(profile)}

_UPLOAD_CHUNK_BYTES = 1024 * 1024


def _verify_image_content(path: Path) -> None:
    """用 Pillow 校验图片文件内容可读，阻止伪扩展名或损坏文件进入数据集。"""
    from PIL import Image

    previous_max_pixels = Image.MAX_IMAGE_PIXELS
    Image.MAX_IMAGE_PIXELS = None
    try:
        with Image.open(path) as img:
            img.verify()
    except (OSError, ValueError, SyntaxError) as exc:
        raise HTTPException(
            status_code=400,
            detail="图片文件内容无法识别或已损坏",
        ) from exc
    finally:
        Image.MAX_IMAGE_PIXELS = previous_max_pixels


async def save_upload(file: UploadFile, target_dir: Path, allowed_exts: set[str]) -> dict[str, Any]:
    name = safe_filename(file.filename or "upload")
    suffix = Path(name).suffix.lower()
    if suffix not in allowed_exts:
        raise HTTPException(status_code=400, detail=f"不支持的文件类型：{name}")

    target = target_dir / name
    if target.exists():
        target = target_dir / f"{target.stem}_{uuid.uuid4().hex[:6]}{target.suffix}"

    # 先写同目录临时文件，校验通过后再原子替换到最终名，避免进程中断留下同名半文件。
    temp_path = target_dir / f".{name}.{uuid.uuid4().hex}.tmp"
    total = 0
    try:
        with temp_path.open("wb") as out:
            while True:
                chunk = await file.read(_UPLOAD_CHUNK_BYTES)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail=f"文件过大: {name}")
                out.write(chunk)
        if suffix in IMAGE_EXTS:
            _verify_image_content(temp_path)
        os.replace(temp_path, target)
    except (HTTPException, OSError):
        temp_path.unlink(missing_ok=True)
        raise

    try:
        rel_path = target.relative_to(ROOT).as_posix()
    except ValueError:
        rel_path = str(target)
    return {"name": target.name, "path": rel_path}
