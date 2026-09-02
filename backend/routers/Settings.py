import os
from fastapi import APIRouter, Body
from services.library_config import DEFAULT_LIBRARY, get_library_path, start_library_migration, migration_status, get_app_settings, save_app_settings

router = APIRouter(prefix="/api")


@router.get("/settings")
def get_settings():
    """返回资料库路径与跨浏览器同步的应用设置。"""
    return {
        "library_path": get_library_path(),
        "default_library_path": DEFAULT_LIBRARY,
        "app_settings": get_app_settings(),
    }


@router.put("/settings")
def put_settings(data: dict = Body(...)):
    """更新应用设置，或更新资料库位置并启动迁移。"""
    if not isinstance(data, dict):
        return {"status": "error", "msg": "设置格式错误"}
    app_settings = data.get("app_settings")
    if app_settings is not None:
        if not save_app_settings(app_settings):
            return {"status": "error", "msg": "保存设置失败"}
        return {"status": "ok", "app_settings": get_app_settings()}

    new_path = data.get("library_path")
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
