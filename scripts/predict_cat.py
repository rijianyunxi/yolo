from __future__ import annotations

from pathlib import Path

from ultralytics import YOLO


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    model = YOLO(str(ROOT / "runs" / "cat_yolo11n" / "weights" / "best.pt"))
    model.predict(
        source=str(ROOT / "test_images"),
        imgsz=640,
        conf=0.25,
        save=True,
        project=str(ROOT / "runs"),
        name="cat_predict",
    )


if __name__ == "__main__":
    main()
