from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from ..services.predictions import maintain_prediction_storage
from ..services.datasets import (
    dataset_cache_stats_snapshot,
    dataset_index_cache_stats_snapshot,
    image_dimensions_cache_stats_snapshot,
    label_count_cache_stats_snapshot,
    prune_thumbnail_cache,
    thumbnail_cache_stats_snapshot,
)

router = APIRouter()


@router.get("/api/cache/stats")
def cache_stats() -> dict[str, Any]:
    storage = maintain_prediction_storage(force=False)
    return {
        "datasetCounts": dataset_cache_stats_snapshot(),
        "datasetIndex": dataset_index_cache_stats_snapshot(),
        "imageDimensions": image_dimensions_cache_stats_snapshot(),
        "labelCounts": label_count_cache_stats_snapshot(),
        "thumbnails": thumbnail_cache_stats_snapshot(),
        "storage": storage,
    }


@router.post("/api/cache/prune")
def prune_cache() -> dict[str, Any]:
    return {
        "thumbnails": prune_thumbnail_cache(force=True),
        "storage": maintain_prediction_storage(force=True),
    }
