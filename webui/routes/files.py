from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ..config import ROOT, STATIC

router = APIRouter()

FILE_ROOTS = (ROOT / "datasets", ROOT / "runs", ROOT / "uploads", STATIC)


@router.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


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
