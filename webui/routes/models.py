from __future__ import annotations

from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile

from ..services.imported_models import (
    delete_imported_model,
    import_model,
    list_imported_models,
)

router = APIRouter()


@router.post("/api/models/import")
async def import_model_route(file: UploadFile = File(...)) -> dict[str, Any]:
    try:
        return {"model": import_model(file)}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"导入模型失败：{exc}") from exc


@router.get("/api/models/imported")
def imported_models() -> dict[str, Any]:
    return {"models": list_imported_models()}


@router.delete("/api/models/imported/{filename}")
def remove_imported_model(filename: str) -> dict[str, Any]:
    return delete_imported_model(filename)
