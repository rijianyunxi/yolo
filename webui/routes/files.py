from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ..config import IMAGE_EXTS, PREDICT_RUNS, ROOT, STATIC
from ..services.datasets import ensure_thumbnail, safe_filename, split_paths
from ..services.profiles import resolve_profile

router = APIRouter()

FILE_ROOTS = (ROOT / "datasets", ROOT / "runs", ROOT / "uploads", STATIC)


def _resolve_served_file(file_path: str) -> Path:
    """解析 /files/ 请求路径并做边界校验；只允许 FILE_ROOTS 下的真实文件。"""
    path = (ROOT / file_path).resolve()
    if not any(root.resolve() in path.parents or path == root.resolve() for root in FILE_ROOTS):
        raise HTTPException(status_code=403, detail="无效的文件路径")
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="文件不存在")
    return path


def _cache_control_for(path: Path) -> str:
    """按文件所属根目录返回缓存策略：预测结果可被清理/覆盖，禁止长期缓存。"""
    predict_root = PREDICT_RUNS.resolve(strict=False)
    if predict_root == path or predict_root in path.parents:
        return "private, no-store"
    return "public, max-age=3600"


@router.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


@router.get("/thumbnails/{profile}/{split}/{filename}")
def thumbnail(profile: str, split: str, filename: str) -> FileResponse:
    profile = resolve_profile(profile)
    images_dir, _ = split_paths(profile, split)
    image_name = safe_filename(filename)
    image_path = images_dir / image_name
    if image_path.suffix.lower() not in IMAGE_EXTS or not image_path.exists():
        raise HTTPException(status_code=404, detail="图片不存在")
    cached = ensure_thumbnail(image_path)
    return FileResponse(cached, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=31536000, immutable"})


@router.get("/files/{file_path:path}")
def files(file_path: str) -> FileResponse:
    path = _resolve_served_file(file_path)
    return FileResponse(path, headers={"Cache-Control": _cache_control_for(path)})


@router.get("/{path:path}")
def spa_fallback(path: str) -> FileResponse:
    if path.startswith("api/"):
        raise HTTPException(status_code=404, detail="接口不存在")
    if path.startswith(("files/", "static/")):
        raise HTTPException(status_code=404, detail="页面不存在")
    return FileResponse(STATIC / "index.html")
