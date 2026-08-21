from __future__ import annotations

import argparse
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from webui.services.dataset_check import check_dataset, save_dataset_report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check YOLO dataset quality.")
    parser.add_argument("--profile", default="cat", help="Dataset profile name used in logs.")
    parser.add_argument("--data-root", type=Path, default=None, help="兼容旧入口；当前检查使用 profile 对应目录。")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    report = save_dataset_report(check_dataset(args.profile, args.data_root))
    print(f"Profile: {report['profile']}")
    print(f"Dataset root: {report['root']}")
    for split, summary in report["splits"].items():
        print(f"{split}: {summary['images']} images, {summary['labels']} labels")
    print(f"Blocking: {report['blockingCount']}; warnings: {report['warningCount']}")
    for issue in report["issues"][:20]:
        location = "/".join(str(item) for item in (issue.get("split"), issue.get("filename"), issue.get("line")) if item)
        print(f"  [{issue['severity']}] {location}: {issue['message']}")
    if not report["ready"]:
        raise SystemExit(1)
    print("Dataset quality check is OK.")


if __name__ == "__main__":
    main()
