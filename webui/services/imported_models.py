from __future__ import annotations

import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import HTTPException, UploadFile

from ..config import MAX_UPLOAD_BYTES, MODELS_DIR, ROOT
from .models import load_model, newest_best_model

IMPORTED_MODELS_DIR = MODELS_DIR / "imported"

MODEL_EXT = ".pt"


class ImportedModelFileError(ValueError):
    pass


def _ensure_dir() -> None:
    IMPORTED_MODELS_DIR.mkdir(parents=True, exist_ok=True)


def imported_model_payload(path: Path) -> dict[str, Any]:
    stat = path.stat()
    rel = path.relative_to(ROOT).as_posix()
    return {
        "filename": path.name,
        "name": path.stem,
        "path": str(path),
        "size": stat.st_size,
        "mtime": stat.st_mtime,
        "url": f"/files/{rel}",
    }


def import_model(file: UploadFile) -> dict[str, Any]:
    """导入一个 .pt 模型文件到 models/imported 目录。"""
    _ensure_dir()
    filename = Path(file.filename or "model.pt").name
    if Path(filename).suffix.lower() != MODEL_EXT:
        raise HTTPException(status_code=400, detail="仅支持 .pt 模型文件")
    content = file.file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="模型文件过大")
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="模型文件为空")

    target = IMPORTED_MODELS_DIR / filename
    if target.exists():
        stem = Path(filename).stem
        target = IMPORTED_MODELS_DIR / f"{stem}_{uuid.uuid4().hex[:6]}{MODEL_EXT}"
    with target.open("wb") as out:
        out.write(content)
    return imported_model_payload(target)


def list_imported_models() -> list[dict[str, Any]]:
    _ensure_dir()
    rows = []
    for path in IMPORTED_MODELS_DIR.glob(f"*{MODEL_EXT}"):
        if path.is_file():
            try:
                rows.append(imported_model_payload(path))
            except OSError:
                continue
    rows.sort(key=lambda item: item["mtime"], reverse=True)
    return rows


def delete_imported_model(filename: str) -> dict[str, Any]:
    name = Path(filename or "").name
    if not name or Path(name).suffix.lower() != MODEL_EXT:
        raise HTTPException(status_code=400, detail="无效的模型文件名")
    path = IMPORTED_MODELS_DIR / name
    if not path.exists():
        raise HTTPException(status_code=404, detail="导入的模型不存在")
    path.unlink()
    return {"deleted": name}


def resolve_model_selector(selector: str, profile: str = "") -> tuple[Path, str]:
    """将模型选择器解析为模型路径与来源标识。
    - "" / "auto" / "best"：优先使用该配置的已训练 best.pt，其次 yolo11n.pt 预训练
    - "pretrained"：固定使用 yolo11n.pt 预训练模型
    - "imported:<filename>"：使用导入到 models/imported 下的模型
    """
    from ..services.profiles import resolve_profile as resolve_profile_checked

    profile = resolve_profile_checked(profile)
    selector = (selector or "").strip()
    if selector in ("", "auto", "best"):
        best = newest_best_model(profile)
        if best and best.exists():
            return best, "trained"
        pretrained = ROOT / "yolo11n.pt"
        if pretrained.exists():
            return pretrained, "pretrained"
        raise HTTPException(status_code=400, detail="当前配置没有训练模型，也未找到 yolo11n.pt 预训练模型")
    if selector == "pretrained":
        pretrained = ROOT / "yolo11n.pt"
        if not pretrained.exists():
            raise HTTPException(status_code=400, detail="未找到 yolo11n.pt 预训练模型")
        return pretrained, "pretrained"
    if selector.startswith("imported:"):
        filename = Path(selector[len("imported:") :]).name
        if not filename or Path(filename).suffix.lower() != MODEL_EXT:
            raise HTTPException(status_code=400, detail="无效的导入模型选择")
        path = IMPORTED_MODELS_DIR / filename
        if not path.exists():
            raise HTTPException(status_code=404, detail="导入的模型不存在，可能已被删除")
        return path, f"imported:{filename}"
    raise HTTPException(status_code=400, detail="未知的模型选择")
