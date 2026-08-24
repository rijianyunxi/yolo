from __future__ import annotations

import logging
import uuid

from fastapi import FastAPI
from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import STATIC
from .routes import cache, datasets, files, models, predictions, profiles, status, tasks

logger = logging.getLogger("webui")

app = FastAPI(title="YOLO 目标检测训练台")
app.mount("/static", StaticFiles(directory=STATIC), name="static")
app.include_router(status.router)
app.include_router(tasks.router)
app.include_router(profiles.router)
app.include_router(datasets.router)
app.include_router(models.router)
app.include_router(predictions.router)
app.include_router(files.router)
app.include_router(cache.router)


@app.middleware("http")
async def add_request_id(request: Request, call_next):
    """为每个请求生成 request_id 并写入响应头，便于日志与错误响应串联排查。"""
    request_id = request.headers.get("X-Request-Id") or uuid.uuid4().hex[:16]
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-Id"] = request_id
    return response


@app.exception_handler(Exception)
async def unhandled_error(request: Request, exc: Exception) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None) or "-"
    logger.exception(
        "未处理的异常: %s %s (requestId=%s)", request.method, request.url.path, request_id
    )
    return JSONResponse(
        status_code=500,
        content={
            "detail": "服务器内部错误，请查看后端日志",
            "code": "internal_error",
            "requestId": request_id,
        },
    )
