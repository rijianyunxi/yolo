from __future__ import annotations

import csv
import math
from pathlib import Path
from typing import Any


def _number(value: str | None) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value.strip())
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _point(row: dict[str, str]) -> dict[str, Any]:
    epoch = _number(row.get("epoch"))
    box = _number(row.get("train/box_loss"))
    cls = _number(row.get("train/cls_loss"))
    dfl = _number(row.get("train/dfl_loss"))
    return {
        "epoch": int(epoch) if epoch is not None else 0,
        "loss": {
            "box": box,
            "cls": cls,
            "dfl": dfl,
            "total": (sum(value for value in (box, cls, dfl) if value is not None) if any(value is not None for value in (box, cls, dfl)) else None),
        },
        "precision": _number(row.get("metrics/precision(B)")),
        "recall": _number(row.get("metrics/recall(B)")),
        "mAP50": _number(row.get("metrics/mAP50(B)")),
        "mAP50_95": _number(row.get("metrics/mAP50-95(B)")),
    }


def parse_training_metrics(run_dir: Path) -> dict[str, Any] | None:
    """读取 Ultralytics results.csv，返回适合前端展示的当前/最佳指标。"""
    csv_path = run_dir / "results.csv"
    if not csv_path.exists() or not csv_path.is_file():
        return None
    points: list[dict[str, Any]] = []
    try:
        with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle):
                point = _point(row)
                if point["epoch"] > 0:
                    points.append(point)
    except (OSError, UnicodeError, csv.Error):
        return None
    if not points:
        return None
    best = max(
        points,
        key=lambda item: item["mAP50_95"] if item["mAP50_95"] is not None else float("-inf"),
    )
    return {
        "runDir": str(run_dir),
        "epochs": len(points),
        "current": points[-1],
        "best": best,
        "recent": points[-5:],
    }


def metrics_for_params(params: dict[str, Any] | None) -> dict[str, Any] | None:
    if not params:
        return None
    run_dir = params.get("runDir")
    if not isinstance(run_dir, str) or not run_dir:
        return None
    return parse_training_metrics(Path(run_dir))
