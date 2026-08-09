import os
import shutil
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


def _wipe_dir(path):
    """清空目录下的所有内容（保留目录本身）"""
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


@router.delete("/reset")
def reset_data():
    """重置整个资料库：清空音乐库与 data 备份目录，回到初始状态"""
    _wipe_dir(get_library_path())
    _wipe_dir(DATA_DIR)
    # 重建备份目录
    for d in (LYRICS_DIR, METADATA_DIR, PICTURE_DIR):
        os.makedirs(d, exist_ok=True)
    return {"status": "ok"}
