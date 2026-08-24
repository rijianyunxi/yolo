from __future__ import annotations

import hashlib
import json
import logging
import uuid
from pathlib import Path
from typing import Any

from fastapi import HTTPException, UploadFile

from ..config import MAX_UPLOAD_BYTES, MODELS_DIR, ROOT
from .models import invalidate_model, load_model

logger = logging.getLogger("webui")

IMPORTED_MODELS_DIR = MODELS_DIR / "imported"
MODEL_EXT = ".pt"


def _ensure_dir() -> None:
    IMPORTED_MODELS_DIR.mkdir(parents=True, exist_ok=True)


def _metadata_path(path: Path) -> Path:
    return path.with_name(path.name + ".json")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _normalise_names(names: Any) -> dict[str, str]:
    if isinstance(names, list):
        return {str(index): str(value) for index, value in enumerate(names)}
    if isinstance(names, dict):
        return {str(key): str(value) for key, value in names.items()}
    return {}


def _inspect_model(path: Path) -> dict[str, Any]:
    try:
        model = load_model(path)
        names = _normalise_names(getattr(model, "names", {}))
        return {
            "task": str(getattr(model, "task", "detect") or "detect"),
            "classCount": len(names),
            "classes": names,
            "sha256": _sha256(path),
        }
    except Exception as exc:
        invalidate_model(path)
        raise HTTPException(status_code=400, detail=f"模型文件无法加载或不是有效的 Ultralytics 模型：{exc}") from exc


def _read_metadata(path: Path) -> dict[str, Any]:
    metadata_path = _metadata_path(path)
    try:
        raw = json.loads(metadata_path.read_text(encoding="utf-8"))
        if isinstance(raw, dict):
            return raw
    except (OSError, json.JSONDecodeError):
        pass
    return {}


def _write_metadata(path: Path, metadata: dict[str, Any]) -> None:
    metadata_path = _metadata_path(path)
    temp_path = metadata_path.with_name(f".{metadata_path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temp_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
        temp_path.replace(metadata_path)
    finally:
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass


def imported_model_payload(path: Path) -> dict[str, Any]:
    stat = path.stat()
    rel = path.relative_to(ROOT).as_posix()
    metadata = _read_metadata(path)
    return {
        "filename": path.name,
        "name": path.stem,
        "path": str(path),
        "size": stat.st_size,
        "mtime": stat.st_mtime,
        "url": f"/files/{rel}",
        "sha256": metadata.get("sha256"),
        "task": metadata.get("task"),
        "classCount": metadata.get("classCount"),
        "classes": metadata.get("classes", {}),
    }


def import_model(file: UploadFile) -> dict[str, Any]:
    """导入并预检一个 .pt 模型文件到 models/imported 目录。"""
    _ensure_dir()
    filename = Path(file.filename or "model.pt").name
    if Path(filename).suffix.lower() != MODEL_EXT:
        logger.warning("模型导入失败 filename=%s error=invalid_model_ext", filename)
        raise HTTPException(status_code=400, detail="仅支持 .pt 模型文件")
    content = file.file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        logger.warning("模型导入失败 filename=%s error=too_large size=%s", filename, len(content))
        raise HTTPException(status_code=413, detail="模型文件过大")
    if len(content) == 0:
        logger.warning("模型导入失败 filename=%s error=empty", filename)
        raise HTTPException(status_code=400, detail="模型文件为空")

    target = IMPORTED_MODELS_DIR / filename
    if target.exists():
        stem = Path(filename).stem
        target = IMPORTED_MODELS_DIR / f"{stem}_{uuid.uuid4().hex[:6]}{MODEL_EXT}"
    try:
        target.write_bytes(content)
        metadata = _inspect_model(target)
        _write_metadata(target, metadata)
        return imported_model_payload(target)
    except HTTPException as exc:
        target.unlink(missing_ok=True)
        _metadata_path(target).unlink(missing_ok=True)
        logger.warning(
            "模型导入失败 filename=%s status=%s error=%s",
            target.name,
            exc.status_code,
            exc.detail,
        )
        raise
    except Exception as exc:
        target.unlink(missing_ok=True)
        _metadata_path(target).unlink(missing_ok=True)
        invalidate_model(target)
        logger.warning("模型导入失败 filename=%s error=%s", target.name, exc)
        raise HTTPException(status_code=400, detail=f"导入模型失败：{exc}") from exc


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
    _metadata_path(path).unlink(missing_ok=True)
    invalidate_model(path)
    return {"deleted": name}


def resolve_model_selector(selector: str, profile: str = "") -> tuple[Path, str]:
    """将模型选择器解析为模型路径与来源标识。"""
    from ..services.profiles import resolve_profile as resolve_profile_checked

    profile = resolve_profile_checked(profile)
    selector = (selector or "").strip()
    if selector in ("", "auto", "best"):
        from .models import newest_best_model

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
