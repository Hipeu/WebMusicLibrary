import os
from fastapi import APIRouter, Body
from services.library_config import get_library_path, set_library_path

router = APIRouter(prefix="/api")


@router.get("/settings")
def get_settings():
    """返回当前资料库路径等设置"""
    return {
        "library_path": get_library_path(),
    }


@router.put("/settings")
def put_settings(data: dict = Body(...)):
    """更新资料库位置：校验绝对路径 → 迁移旧文件 → 保存配置"""
    new_path = data.get("library_path") if isinstance(data, dict) else None
    path, error = set_library_path(new_path)
    if error:
        return {"status": "error", "msg": error}
    return {"status": "ok", "library_path": path}
