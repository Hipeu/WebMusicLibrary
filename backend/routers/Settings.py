import os
from fastapi import APIRouter, Body
from services.library_config import get_library_path, start_library_migration, migration_status

router = APIRouter(prefix="/api")


@router.get("/settings")
def get_settings():
    """返回当前资料库路径等设置"""
    return {
        "library_path": get_library_path(),
    }


@router.put("/settings")
def put_settings(data: dict = Body(...)):
    """更新资料库位置：校验绝对路径 → 后台迁移旧文件 → 保存配置。
    立即返回，前端通过 /api/settings/migration 轮询进度。
    """
    new_path = data.get("library_path") if isinstance(data, dict) else None
    path, error = start_library_migration(new_path)
    if error:
        return {"status": "error", "msg": error}
    return {"status": "migrating", "library_path": path, "total": migration_status()["total"]}


@router.get("/settings/migration")
def get_migration():
    """返回资料库迁移进度"""
    st = migration_status()
    if st["running"]:
        return {"status": "migrating", "done": st["done"], "total": st["total"]}
    if st["error"]:
        return {"status": "error", "msg": st["error"]}
    return {"status": "done", "done": st["done"], "total": st["total"]}
