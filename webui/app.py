from __future__ import annotations

import logging
import time
import uuid

from fastapi import FastAPI, HTTPException
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
app.include_router(cache.router)
app.include_router(files.router)


# 常见 HTTP 状态码到错误标识的映射，供前端/调用方按 code 分支处理。
_STATUS_ERROR_CODES: dict[int, str] = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "payload_too_large",
    422: "validation_error",
    429: "too_many_requests",
}


@app.middleware("http")
async def add_request_id_and_log(request: Request, call_next):
    """为每个请求生成 request_id、写入响应头并输出结构化请求日志。"""
    request_id = request.headers.get("X-Request-Id") or uuid.uuid4().hex[:16]
    request.state.request_id = request_id
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = round((time.perf_counter() - start) * 1000, 1)
    logger.info(
        "%s %s -> %d (%.1fms) requestId=%s",
        request.method, request.url.path, response.status_code, duration_ms, request_id,
    )
    response.headers["X-Request-Id"] = request_id
    return response


@app.exception_handler(HTTPException)
async def unified_http_error_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """统一 HTTPException 错误格式为 {code, message, details, requestId}。"""
    # detail 字段保留以兼容现有前端（api.ts 读 json.detail）；新消费方请用 message。
    request_id = getattr(request.state, "request_id", None) or "-"
    code = _STATUS_ERROR_CODES.get(exc.status_code, "error")
    detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "detail": detail,
            "message": detail,
            "code": code,
            "details": None,
            "requestId": request_id,
        },
    )


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
