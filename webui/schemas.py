from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


# ---- Dataset ----

class AnnotationBoxOut(BaseModel):
    classId: int
    x: float
    y: float
    width: float
    height: float


class ClassInfo(BaseModel):
    id: int
    name: str
    displayName: str


class DatasetImage(BaseModel):
    name: str
    stem: str
    profile: str
    split: str
    url: str
    thumbnailUrl: str
    width: int
    height: int
    hasLabel: bool
    labelCount: int
    boxes: list[AnnotationBoxOut]
    labelMtime: float | None = None
    mtime: float


class DatasetCounts(BaseModel):
    model_config = {"extra": "allow"}


class DatasetImagesResponse(BaseModel):
    profile: str
    split: str
    classes: list[ClassInfo]
    images: list[DatasetImage]
    total: int
    page: int
    pageSize: int
    pageCount: int


class SavedUpload(BaseModel):
    name: str
    path: str


class UploadResponse(BaseModel):
    savedImages: list[SavedUpload]
    savedLabels: list[SavedUpload]
    dataset: dict[str, Any]


class SaveLabelsResponse(BaseModel):
    image: DatasetImage
    dataset: dict[str, Any]


# ---- Predictions ----

class Detection(BaseModel):
    classId: int
    name: str
    confidence: float
    xyxy: list[float]


class PredictionImage(BaseModel):
    name: str
    url: str
    path: str
    mtime: float
    sizeBytes: int
    taskId: str | None = None
    profile: str | None = None
    modelSource: str | None = None
    modelSha256: str | None = None
    conf: float | None = None
    createdAt: float
    detectionCount: int | None = None
    outputDir: str | None = None


class PredictionTaskPayload(BaseModel):
    id: str
    profile: str
    status: str
    message: str | None = None
    error: str | None = None
    createdAt: float
    startedAt: float | None = None
    finishedAt: float | None = None
    durationMs: int | float | None = None
    model: str | None = None
    modelSource: str | None = None
    modelSelector: str
    cancelRequested: bool
    cancelReason: str | None = None
    originalFilename: str | None = None
    inputSha256: str | None = None
    inputSize: int | None = None
    modelSha256: str | None = None
    parentTaskId: str | None = None
    conf: float | None = None
    detections: list[Detection]
    images: list[PredictionImage]


class PredictionTasksResponse(BaseModel):
    tasks: list[PredictionTaskPayload]


# ---- Managed tasks ----

class ManagedTaskPayload(BaseModel):
    id: str
    schemaVersion: int
    kind: str
    profile: str | None = None
    params: dict[str, Any]
    status: str
    startedAt: float | None = None
    finishedAt: float | None = None
    returncode: int | None = None
    command: list[str]
    metrics: dict[str, Any] | None = None
    resultDir: str | None = None
    runDir: str | None = None
    parentTaskId: str | None = None
    cancelReason: str | None = None
    message: str | None = None
    error: str | None = None
    lastHeartbeatAt: float | None = None
    pid: int | None = None