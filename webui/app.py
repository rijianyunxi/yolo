from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi import Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import STATIC
from .routes import datasets, files, predictions, status, tasks

logger = logging.getLogger("webui")

app = FastAPI(title="YOLO 目标检测训练台")
app.mount("/static", StaticFiles(directory=STATIC), name="static")
app.include_router(status.router)
app.include_router(tasks.router)
app.include_router(datasets.router)
app.include_router(predictions.router)
app.include_router(files.router)


@app.exception_handler(Exception)
async def unhandled_error(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("未处理的异常: %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "服务器内部错误，请查看后端日志"})
