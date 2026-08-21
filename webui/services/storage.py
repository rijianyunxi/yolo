from __future__ import annotations

import shutil
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable

from ..config import (
    IMAGE_EXTS,
    PREDICT_RUNS,
    PREDICTION_STORAGE_MAX_BYTES,
    PREDICTION_STORAGE_MAX_ENTRIES,
    PREDICTION_STORAGE_TTL_SECONDS,
    ROOT,
    STORAGE_PRUNE_INTERVAL_SECONDS,
    UPLOADS,
    UPLOAD_STORAGE_MAX_BYTES,
    UPLOAD_STORAGE_MAX_ENTRIES,
    UPLOAD_STORAGE_TTL_SECONDS,
    storage_quota_lock,
)


_storage_stats: dict[str, dict[str, Any]] = {
    "predictions": {"entries": 0, "bytes": 0, "deleted": 0, "expired": 0, "evicted": 0, "failed": 0, "lastPrunedAt": 0.0},
    "uploads": {"entries": 0, "bytes": 0, "deleted": 0, "expired": 0, "evicted": 0, "failed": 0, "lastPrunedAt": 0.0},
}


def _safe_resolved(path: Path, root: Path) -> Path | None:
    try:
        resolved = path.resolve(strict=False)
        root_resolved = root.resolve()
        if resolved == root_resolved or root_resolved not in resolved.parents:
            return None
        return resolved
    except (OSError, ValueError):
        return None


def _tree_size_and_mtime(path: Path) -> tuple[int, float]:
    total = 0
    newest = 0.0
    try:
        root_stat = path.stat()
        newest = root_stat.st_mtime
    except OSError:
        return 0, newest
    if path.is_file():
        return root_stat.st_size, newest
    try:
        for item in path.rglob("*"):
            try:
                if item.is_symlink():
                    continue
                stat = item.stat()
                newest = max(newest, stat.st_mtime)
                if item.is_file():
                    total += stat.st_size
            except OSError:
                continue
    except OSError:
        pass
    return total, newest


def _prediction_candidates() -> list[Path]:
    candidates: list[Path] = []
    for root, legacy in ((PREDICT_RUNS, False), (ROOT / "runs", True)):
        try:
            for item in root.iterdir():
                if not item.is_dir() or item.is_symlink():
                    continue
                if item.resolve(strict=False) == PREDICT_RUNS.resolve(strict=False):
                    continue
                if legacy and not item.name.startswith("web_predict_"):
                    continue
                # New layout is runs/web_predict/<task-id>; the root itself is not a task.
                if not legacy and item == PREDICT_RUNS:
                    continue
                if _safe_resolved(item, root):
                    candidates.append(item)
        except OSError:
            continue
    return candidates


def _file_candidates() -> list[Path]:
    try:
        return [item for item in UPLOADS.iterdir() if item.is_file() and not item.is_symlink()]
    except OSError:
        return []


def _snapshot(kind: str, quota_bytes: int, quota_entries: int) -> dict[str, Any]:
    candidates = _prediction_candidates() if kind == "predictions" else _file_candidates()
    total_bytes = 0
    for item in candidates:
        size, _ = _tree_size_and_mtime(item)
        total_bytes += size
    stats = _storage_stats[kind]
    stats["entries"] = len(candidates)
    stats["bytes"] = total_bytes
    stats["quotaBytes"] = quota_bytes
    stats["quotaEntries"] = quota_entries
    stats["overQuota"] = total_bytes > quota_bytes or len(candidates) > quota_entries
    stats["hitRate"] = 0.0
    return dict(stats)


def _delete_candidate(path: Path, kind: str) -> bool:
    try:
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink()
        return True
    except FileNotFoundError:
        return True
    except OSError:
        _storage_stats[kind]["failed"] += 1
        return False


def _prune_candidates(
    kind: str,
    candidates: Iterable[Path],
    protected: set[Path],
    ttl_seconds: float,
    max_entries: int,
    max_bytes: int,
    now: float,
) -> None:
    records: list[tuple[Path, float, int]] = []
    failed_paths: set[Path] = set()
    for path in candidates:
        size, newest = _tree_size_and_mtime(path)
        if path.resolve(strict=False) in protected:
            records.append((path, newest, size))
            continue
        if newest <= now - max(0.0, ttl_seconds):
            if _delete_candidate(path, kind):
                _storage_stats[kind]["deleted"] += 1
                _storage_stats[kind]["expired"] += 1
            else:
                # 删除失败的过期条目仍要进入本轮快照，确保 overQuota 和 bytes
                # 诊断反映真实磁盘占用，而不是把失败项从统计中“隐藏”。
                failed_paths.add(path.resolve(strict=False))
                records.append((path, newest, size))
            continue
        records.append((path, newest, size))

    records.sort(key=lambda item: item[1])
    total_bytes = sum(item[2] for item in records)
    # First remove oldest unprotected entries until both quotas are satisfied.
    while len(records) > max_entries or total_bytes > max_bytes:
        removable_index = next((
            index
            for index, item in enumerate(records)
            if item[0].resolve(strict=False) not in protected
            and item[0].resolve(strict=False) not in failed_paths
        ), None)
        if removable_index is None:
            break
        path, _, size = records.pop(removable_index)
        if _delete_candidate(path, kind):
            total_bytes -= size
            _storage_stats[kind]["deleted"] += 1
            _storage_stats[kind]["evicted"] += 1
        else:
            # Failed files stay in the snapshot but do not spin forever in this pass.
            failed_paths.add(path.resolve(strict=False))
            records.append((path, 0.0, size))
            break


def prune_storage(
    *,
    protected_prediction_dirs: Iterable[Path] = (),
    protected_upload_files: Iterable[Path] = (),
    force: bool = False,
) -> dict[str, Any]:
    """清理预测结果和上传暂存目录；任何单个文件失败都降级为诊断信息。"""
    now = time.time()
    protected_predictions = {item.resolve(strict=False) for item in protected_prediction_dirs}
    protected_uploads = {item.resolve(strict=False) for item in protected_upload_files}
    with storage_quota_lock:
        should_prune = force or any(now - float(_storage_stats[k]["lastPrunedAt"]) >= STORAGE_PRUNE_INTERVAL_SECONDS for k in _storage_stats)
        if should_prune:
            _prune_candidates("predictions", _prediction_candidates(), protected_predictions, PREDICTION_STORAGE_TTL_SECONDS, PREDICTION_STORAGE_MAX_ENTRIES, PREDICTION_STORAGE_MAX_BYTES, now)
            _prune_candidates("uploads", _file_candidates(), protected_uploads, UPLOAD_STORAGE_TTL_SECONDS, UPLOAD_STORAGE_MAX_ENTRIES, UPLOAD_STORAGE_MAX_BYTES, now)
            _storage_stats["predictions"]["lastPrunedAt"] = now
            _storage_stats["uploads"]["lastPrunedAt"] = now
        result = {
            "predictions": _snapshot("predictions", PREDICTION_STORAGE_MAX_BYTES, PREDICTION_STORAGE_MAX_ENTRIES),
            "uploads": _snapshot("uploads", UPLOAD_STORAGE_MAX_BYTES, UPLOAD_STORAGE_MAX_ENTRIES),
        }
        result["predictions"]["protectedEntries"] = sum(1 for item in _prediction_candidates() if item.resolve(strict=False) in protected_predictions)
        result["uploads"]["protectedEntries"] = sum(1 for item in _file_candidates() if item.resolve(strict=False) in protected_uploads)
        return result


def storage_stats(
    *,
    protected_prediction_dirs: Iterable[Path] = (),
    protected_upload_files: Iterable[Path] = (),
) -> dict[str, Any]:
    return prune_storage(protected_prediction_dirs=protected_prediction_dirs, protected_upload_files=protected_upload_files, force=False)


def _upload_capacity_from_snapshot(incoming_bytes: int, snapshot: dict[str, Any]) -> bool:
    return (
        incoming_bytes <= UPLOAD_STORAGE_MAX_BYTES
        and snapshot["bytes"] + max(0, incoming_bytes) <= UPLOAD_STORAGE_MAX_BYTES
        and snapshot["entries"] + 1 <= UPLOAD_STORAGE_MAX_ENTRIES
    )


def upload_capacity_available(
    incoming_bytes: int,
    *,
    protected_upload_files: Iterable[Path] = (),
) -> bool:
    """在清理后判断新上传文件是否仍会超过上传目录配额。"""
    snapshot = prune_storage(protected_upload_files=protected_upload_files, force=True)["uploads"]
    return _upload_capacity_from_snapshot(incoming_bytes, snapshot)


@contextmanager
def upload_storage_slot(
    incoming_bytes: int,
    *,
    protected_upload_files: Iterable[Path] = (),
):
    """在检查配额到写入文件之间持有同一把锁，避免并发上传同时越过配额。"""
    with storage_quota_lock:
        snapshot = prune_storage(protected_upload_files=protected_upload_files, force=True)["uploads"]
        yield _upload_capacity_from_snapshot(incoming_bytes, snapshot)
