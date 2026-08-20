from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..services.profiles import (
    create_profile,
    delete_profile,
    list_profile_models,
    list_profiles,
    update_profile,
)

router = APIRouter()


class ProfileClassIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    displayName: str = Field(default="", max_length=64)


class ProfileCreateRequest(BaseModel):
    id: str = Field(min_length=1, max_length=32)
    title: str = Field(min_length=1, max_length=64)
    classes: list[ProfileClassIn] = Field(min_length=1, max_length=200)


class ProfileUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=64)
    classes: list[ProfileClassIn] | None = Field(default=None, min_length=1, max_length=200)


@router.get("/api/profiles")
def profiles() -> dict[str, Any]:
    return {"profiles": list_profiles()}


@router.post("/api/profiles")
def profiles_create(payload: ProfileCreateRequest) -> dict[str, Any]:
    return {"profile": create_profile(payload.id, payload.title, [item.model_dump() for item in payload.classes])}


@router.put("/api/profiles/{profile}")
def profiles_update(profile: str, payload: ProfileUpdateRequest) -> dict[str, Any]:
    classes = [item.model_dump() for item in payload.classes] if payload.classes is not None else None
    return {"profile": update_profile(profile, payload.title, classes)}


@router.delete("/api/profiles/{profile}")
def profiles_delete(profile: str, deleteFiles: bool = False) -> dict[str, Any]:
    return delete_profile(profile, delete_files=deleteFiles)


@router.get("/api/profiles/{profile}/models")
def profile_models(profile: str) -> dict[str, Any]:
    return {"profile": profile, "models": list_profile_models(profile)}
