import os
import json
from fastapi import APIRouter, Body

router = APIRouter(prefix="/api/playlists")

# 备份目录位于 backend/routers/，需上溯三层到项目根目录
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
PLAYLISTS_FILE = os.path.join(DATA_DIR, "playlists.json")


def load_playlists():
    """读取播放列表数据（data/playlists.json），不存在或损坏返回 []"""
    if os.path.exists(PLAYLISTS_FILE):
        try:
            with open(PLAYLISTS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data if isinstance(data, list) else []
        except Exception:
            return []
    return []


def save_playlists(data):
    """整体覆盖保存播放列表数据到 data/playlists.json"""
    os.makedirs(DATA_DIR, exist_ok=True)
    try:
        with open(PLAYLISTS_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
    except Exception:
        return False


@router.get("")
def get_playlists():
    """返回全部播放列表"""
    return load_playlists()


@router.put("")
def put_playlists(data: list = Body(...)):
    """整体覆盖保存全部播放列表（前端为权威，全量同步）"""
    ok = save_playlists(data)
    return {"status": "ok" if ok else "error"}
