import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, "D:/work/yolo")

from webui.services.datasets import (
    dataset_counts,
    image_record,
    save_upload,
    split_paths,
    validate_yolo_label_file,
)
from webui.services.profiles import profile_config

PROFILE = "cat"
SPLIT = "test"


def make_upload(filename: str, data: bytes):
    from starlette.datastructures import UploadFile
    from tempfile import TemporaryFile

    handle = TemporaryFile()
    handle.write(data)
    handle.seek(0)
    return UploadFile(filename=filename, file=handle)


async def main() -> None:
    images_dir, labels_dir = split_paths(PROFILE, SPLIT)
    images_dir.mkdir(parents=True, exist_ok=True)
    labels_dir.mkdir(parents=True, exist_ok=True)

    image_path = Path("D:/work/yolo/webui/uploads/smoke_test.jpg")
    image_data = image_path.read_bytes() if image_path.exists() else b"not-a-real-image"

    # 1. upload a test image
    saved = await save_upload(make_upload("web_import_smoke.jpg", image_data), images_dir, {".jpg", ".jpeg", ".png"})
    label_name = Path(saved["path"]).stem
    print("saved image:", Path(saved["path"]).name)

    # 2. valid label passes validation
    valid_label = labels_dir / f"{label_name}.txt"
    valid_label.write_text("0 0.5 0.5 0.5 0.5\n", encoding="utf-8")
    validate_yolo_label_file(valid_label, PROFILE)
    print("valid label: ok")

    # 3. invalid label (bad class id) is rejected
    bad_label = labels_dir / f"{label_name}_bad.txt"
    bad_label.write_text("99 0.5 0.5 0.5 0.5\n", encoding="utf-8")
    try:
        validate_yolo_label_file(bad_label, PROFILE)
        raise AssertionError("expected invalid label to be rejected")
    except Exception as exc:
        print("invalid label rejected:", str(exc)[:40])

    # 4. image record exposes real dimensions
    record = image_record(Path(saved["path"]), PROFILE, SPLIT)
    print("image dims:", record["width"], "x", record["height"])

    # 5. dataset counts reflect the uploaded image
    counts = dataset_counts(PROFILE)
    print("test split images:", counts["splits"][SPLIT]["images"])

    # cleanup
    for p in (valid_label, bad_label):
        p.unlink(missing_ok=True)
    Path(saved["path"]).unlink(missing_ok=True)
    print("cleanup done")


if __name__ == "__main__":
    asyncio.run(main())
