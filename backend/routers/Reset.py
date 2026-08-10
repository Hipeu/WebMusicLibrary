import os
import shutil
import threading
from fastapi import APIRouter
from services.library_config import get_library_path

router = APIRouter(prefix="/api")

# 音乐库与备份目录

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
LYRICS_DIR = os.path.join(DATA_DIR, "Lyrics")
METADATA_DIR = os.path.join(DATA_DIR, "metadata")
PICTURE_DIR = os.path.join(DATA_DIR, "picture")

# 重置进度（后台线程更新）
_reset = {"running": False, "done": 0, "total": 0, "error": None}


def _count_entries(path):
    """统计目录顶层条目数（用于重置进度 total）"""
    if not os.path.isdir(path):
        return 0
    try:
        return len(os.listdir(path))
    except Exception:
        return 0


def _wipe_dir(path):
    """清空目录下的所有内容（保留目录本身），并更新进度"""
    if not os.path.isdir(path):
        return
    for name in os.listdir(path):
        p = os.path.join(path, name)
        try:
            if os.path.isdir(p) and not os.path.islink(p):
                shutil.rmtree(p)
            else:
                os.remove(p)
        except Exception:
            pass
        _reset["done"] = _reset["done"] + 1


def _reset_worker():
    """后台线程：清空资料库与 data 备份目录，重建备份目录"""
    try:
        _reset["total"] = _count_entries(get_library_path()) + _count_entries(DATA_DIR)
        _wipe_dir(get_library_path())
        _wipe_dir(DATA_DIR)
        # 重建备份目录
        for d in (LYRICS_DIR, METADATA_DIR, PICTURE_DIR):
            os.makedirs(d, exist_ok=True)
        _reset.update(running=False, error=None)
    except Exception as e:
        _reset.update(running=False, error=str(e))


@router.delete("/reset")
def reset_data():
    """重置整个资料库：清空音乐库与 data 备份目录，回到初始状态。
    后台线程执行，立即返回，前端通过 /api/reset/progress 轮询进度。
    """
    if _reset["running"]:
        return {"status": "busy"}
    _reset.update(running=True, done=0, total=0, error=None)
    t = threading.Thread(target=_reset_worker, daemon=True)
    t.start()
    return {"status": "started"}


@router.get("/reset/progress")
def reset_progress():
    """返回重置进度状态"""
    return dict(_reset)
