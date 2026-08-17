from __future__ import annotations

from train_profile import main


if __name__ == "__main__":
    import sys

    sys.argv.extend([
        "--profile",
        "cat",
        "--data",
        "datasets/cat/cat.yaml",
        "--name",
        "cat_yolo11n",
        "--epochs",
        "100",
        "--imgsz",
        "640",
        "--batch",
        "8",
    ])
    main()
