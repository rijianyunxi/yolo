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
        "cat_yolo11n_cpu_smoke",
        "--epochs",
        "5",
        "--imgsz",
        "416",
        "--batch",
        "4",
    ])
    main()
