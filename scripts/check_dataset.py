from __future__ import annotations

import argparse
from pathlib import Path


IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
DEFAULT_ROOT = Path(__file__).resolve().parents[1]


def collect(dataset_root: Path, split: str):
    images_dir = dataset_root / "images" / split
    labels_dir = dataset_root / "labels" / split
    images_dir.mkdir(parents=True, exist_ok=True)
    labels_dir.mkdir(parents=True, exist_ok=True)
    images = {p.stem: p for p in images_dir.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXTS}
    labels = {p.stem: p for p in labels_dir.glob("*.txt") if p.is_file()}
    return images, labels


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check YOLO dataset image/label pairing.")
    parser.add_argument("--profile", default="cat", help="Dataset profile name used in logs.")
    parser.add_argument(
        "--data-root",
        type=Path,
        default=DEFAULT_ROOT / "datasets" / "cat",
        help="Dataset root containing images/{split} and labels/{split}.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    dataset_root = args.data_root.resolve()
    ok = True
    print(f"Profile: {args.profile}")
    print(f"Dataset root: {dataset_root}")

    for split in ("train", "val", "test"):
        images, labels = collect(dataset_root, split)
        missing_labels = sorted(set(images) - set(labels))
        orphan_labels = sorted(set(labels) - set(images))

        print(f"{split}: {len(images)} images, {len(labels)} labels")

        if missing_labels:
            ok = False
            print(f"  Missing labels: {len(missing_labels)}")
            for name in missing_labels[:10]:
                print(f"    {name}")

        if orphan_labels:
            ok = False
            print(f"  Orphan labels: {len(orphan_labels)}")
            for name in orphan_labels[:10]:
                print(f"    {name}")

    if not ok:
        raise SystemExit(1)

    print("Dataset image/label pairing is OK.")


if __name__ == "__main__":
    main()
