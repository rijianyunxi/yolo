from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import cv2

from ..config import DATASET_REPORTS, IMAGE_EXTS
from .datasets import resolve_split_dirs
from .profiles import profile_classes, profile_config, resolve_profile

REPORTS_DIR = DATASET_REPORTS
REPORTS_DIR.mkdir(parents=True, exist_ok=True)


def _issue(
    severity: str,
    code: str,
    message: str,
    *,
    split: str | None = None,
    filename: str | None = None,
    line: int | None = None,
) -> dict[str, Any]:
    return {
        "severity": severity,
        "code": code,
        "split": split,
        "filename": filename,
        "line": line,
        "message": message,
    }


def _read_label_lines(path: Path) -> list[str]:
    return path.read_text(encoding="utf-8", errors="replace").splitlines()


def check_dataset(profile: str, dataset_root: Path | None = None) -> dict[str, Any]:
    """检查数据集并返回可供 UI 展示的结构化报告。

    检查只读文件，不会为缺失的 images/labels 目录创建目录；同时兼容
    标准布局和 Roboflow 布局，并把 train/val 的阻断问题汇总到 ready。
    """
    profile = resolve_profile(profile)
    root = (dataset_root or Path(profile_config(profile)["root"])).resolve()
    classes = profile_classes(profile)
    valid_class_ids = {item["id"] for item in classes}
    issues: list[dict[str, Any]] = []
    splits: dict[str, Any] = {}
    class_distribution: dict[str, int] = {}
    total_images = 0
    total_labels = 0

    for split in ("train", "val", "test"):
        images_dir, labels_dir = resolve_split_dirs(root, split)
        images = []
        labels = []
        if images_dir.exists():
            try:
                images = sorted(
                    [p for p in images_dir.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTS],
                    key=lambda p: p.name.lower(),
                )
            except OSError as exc:
                issues.append(_issue("blocking", "images_unreadable", f"无法读取图片目录：{exc}", split=split))
        if labels_dir.exists():
            try:
                labels = sorted([p for p in labels_dir.glob("*.txt") if p.is_file()], key=lambda p: p.name.lower())
            except OSError as exc:
                issues.append(_issue("blocking", "labels_unreadable", f"无法读取标签目录：{exc}", split=split))

        image_by_stem = {path.stem: path for path in images}
        label_by_stem = {path.stem: path for path in labels}
        split_issues: list[dict[str, Any]] = []
        for stem in sorted(set(image_by_stem) - set(label_by_stem)):
            split_issues.append(_issue("blocking", "missing_label", "图片缺少同名标签文件", split=split, filename=image_by_stem[stem].name))
        for stem in sorted(set(label_by_stem) - set(image_by_stem)):
            split_issues.append(_issue("blocking", "orphan_label", "标签没有对应的图片文件", split=split, filename=label_by_stem[stem].name))

        for image_path in images:
            width, height = (0, 0)
            try:
                image = cv2.imread(str(image_path))
                if image is not None:
                    height, width = image.shape[:2]
            except Exception:
                width, height = 0, 0
            if width <= 0 or height <= 0:
                split_issues.append(_issue("blocking", "corrupt_image", "图片无法读取或文件已损坏", split=split, filename=image_path.name))

        for label_path in labels:
            try:
                lines = _read_label_lines(label_path)
            except OSError as exc:
                split_issues.append(_issue("blocking", "label_unreadable", f"无法读取标签文件：{exc}", split=split, filename=label_path.name))
                continue
            non_empty = [(line_no, line.strip()) for line_no, line in enumerate(lines, start=1) if line.strip()]
            if not non_empty:
                split_issues.append(_issue("warning", "empty_label", "标签文件为空", split=split, filename=label_path.name))
                continue
            for line_no, raw in non_empty:
                parts = raw.split()
                if len(parts) != 5:
                    split_issues.append(_issue("blocking", "invalid_format", "标签必须包含 5 个字段", split=split, filename=label_path.name, line=line_no))
                    continue
                try:
                    class_id = int(parts[0])
                    x, y, box_width, box_height = (float(value) for value in parts[1:])
                except ValueError:
                    split_issues.append(_issue("blocking", "invalid_number", "标签包含无法解析的数字", split=split, filename=label_path.name, line=line_no))
                    continue
                class_distribution[str(class_id)] = class_distribution.get(str(class_id), 0) + 1
                if class_id not in valid_class_ids:
                    split_issues.append(_issue("blocking", "invalid_class", "类别 ID 不存在于当前数据集配置", split=split, filename=label_path.name, line=line_no))
                if not (0 <= x <= 1 and 0 <= y <= 1 and 0 < box_width <= 1 and 0 < box_height <= 1):
                    split_issues.append(_issue("blocking", "invalid_coordinate", "标注坐标或尺寸越界", split=split, filename=label_path.name, line=line_no))
                elif box_width < 0.005 or box_height < 0.005:
                    split_issues.append(_issue("warning", "tiny_box", "标注框尺寸很小，请确认是否误标", split=split, filename=label_path.name, line=line_no))

        split_issues.sort(key=lambda item: (item["severity"] != "blocking", item.get("filename") or "", item.get("line") or 0))
        issues.extend(split_issues)
        splits[split] = {
            "images": len(images),
            "labels": len(labels),
            "missingLabelCount": len(set(image_by_stem) - set(label_by_stem)),
            "orphanLabelCount": len(set(label_by_stem) - set(image_by_stem)),
            "issues": split_issues,
            "imagesDir": str(images_dir),
            "labelsDir": str(labels_dir),
        }
        total_images += len(images)
        total_labels += len(labels)

    blocking_count = sum(1 for item in issues if item["severity"] == "blocking")
    warning_count = sum(1 for item in issues if item["severity"] == "warning")
    missing_required_split = [split for split in ("train", "val") if splits[split]["images"] == 0]
    for split in missing_required_split:
        issue = _issue("blocking", "empty_split", f"{split} 分组没有图片", split=split)
        issues.append(issue)
        splits[split]["issues"].append(issue)
    blocking_count = sum(1 for item in issues if item["severity"] == "blocking")
    warning_count = sum(1 for item in issues if item["severity"] == "warning")
    report = {
        "profile": profile,
        "root": str(root),
        "checkedAt": time.time(),
        "ready": blocking_count == 0,
        "blockingCount": blocking_count,
        "warningCount": warning_count,
        "totalImages": total_images,
        "totalLabels": total_labels,
        "splits": splits,
        "issues": issues[:1000],
        "classDistribution": class_distribution,
    }
    return report


def report_path(profile: str) -> Path:
    return REPORTS_DIR / f"dataset_check_{profile}.json"


def save_dataset_report(report: dict[str, Any]) -> dict[str, Any]:
    path = report_path(str(report["profile"]))
    temp = path.with_suffix(f".{time.time_ns()}.tmp")
    temp.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(path)
    return report


def load_dataset_report(profile: str) -> dict[str, Any] | None:
    path = report_path(resolve_profile(profile))
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None
