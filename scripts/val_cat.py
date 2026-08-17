from __future__ import annotations

from pathlib import Path

from ultralytics import YOLO


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    model = YOLO(str(ROOT / "runs" / "cat_yolo11n" / "weights" / "best.pt"))
    model.val(data=str(ROOT / "datasets" / "cat" / "cat.yaml"), imgsz=640)


if __name__ == "__main__":
    main()
