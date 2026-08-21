from __future__ import annotations

import argparse
from pathlib import Path

import torch
from ultralytics import YOLO


ROOT = Path(__file__).resolve().parents[1]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train a YOLO model for a configured dataset profile.")
    parser.add_argument("--profile", default="cat", help="Dataset profile name used in logs.")
    parser.add_argument("--data", type=Path, required=True, help="Path to YOLO dataset yaml.")
    parser.add_argument("--name", required=True, help="Run name under runs/.")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--device", default="auto", choices=("auto", "cpu", "cuda"))
    parser.add_argument("--workers", type=int, default=0)
    parser.add_argument("--model", type=Path, default=ROOT / "yolo11n.pt")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    data = args.data if args.data.is_absolute() else ROOT / args.data
    model_path = args.model if args.model.is_absolute() else ROOT / args.model
    data = data.resolve()
    model_path = model_path.resolve()
    if not data.exists():
        raise SystemExit(f"Dataset yaml not found: {data}")
    if not model_path.exists():
        raise SystemExit(f"Base model not found: {model_path}")

    if args.device == "cuda" and not torch.cuda.is_available():
        raise SystemExit("CUDA device requested but CUDA is unavailable")
    device = 0 if args.device in {"auto", "cuda"} and torch.cuda.is_available() else "cpu"
    print(f"Profile: {args.profile}")
    print(f"Dataset yaml: {data}")
    print(f"Base model: {model_path}")
    print(f"Device: {device}")

    model = YOLO(str(model_path))
    model.train(
        data=str(data),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        project=str(ROOT / "runs"),
        name=args.name,
        device=device,
        workers=args.workers,
    )


if __name__ == "__main__":
    main()
