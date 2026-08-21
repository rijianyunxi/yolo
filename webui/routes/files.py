from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ..config import IMAGE_EXTS, ROOT, STATIC
from ..services.datasets import ensure_thumbnail, safe_filename, split_paths
from ..services.profiles import resolve_profile

router = APIRouter()

FILE_ROOTS = (ROOT / "datasets", ROOT / "runs", ROOT / "uploads", STATIC)


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
    path = (ROOT / file_path).resolve()
    if not any(root.resolve() in path.parents or path == root.resolve() for root in FILE_ROOTS):
        raise HTTPException(status_code=403, detail="无效的文件路径")
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(path)


@router.get("/{path:path}")
def spa_fallback(path: str) -> FileResponse:
    if path.startswith(("api/", "files/", "static/")):
        raise HTTPException(status_code=404, detail="页面不存在")
    return FileResponse(STATIC / "index.html")
