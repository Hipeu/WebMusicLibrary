import os
import json
import re
from fastapi import APIRouter, Body, UploadFile, File, Form

router = APIRouter(prefix="/api/artists")

# 备份目录位于 backend/routers/，需上溯两层到项目根目录的 data/
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
ARTISTS_FILE = os.path.join(DATA_DIR, "artists.json")
ARTISTS_IMG_DIR = os.path.join(DATA_DIR, "artists_img")

ALLOWED_COVER_EXTS = (".jpg", ".jpeg", ".png", ".webp")


def load_artists():
    """读取艺人数据（data/artists.json），格式 { 艺人名: { cover_url, bio, genres } }"""
    if os.path.exists(ARTISTS_FILE):
        try:
            with open(ARTISTS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data if isinstance(data, dict) else {}
        except Exception:
            return {}
    return {}


def save_artists(data):
    """整体覆盖保存艺人数据"""
    os.makedirs(DATA_DIR, exist_ok=True)
    try:
        with open(ARTISTS_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
    except Exception:
        return False


def sanitize_name(name):
    """清理文件夹名，移除非法字符"""
    if not name:
        return None
    name = re.sub(r'[<>:"/\\|?*]', "", name)
    return name.strip() or None


def artist_img_dir(name):
    """艺人封面图片目录"""
    safe = sanitize_name(name) or "unknown"
    return os.path.join(ARTISTS_IMG_DIR, safe)


@router.get("")
def get_artists():
    """返回全部艺人数据"""
    return load_artists()


@router.put("")
def put_artist(data: dict = Body(...)):
    """新增 / 更新单个艺人记录"""
    name = (data.get("name") or "").strip()
    if not name:
        return {"status": "error", "msg": "缺少艺人名称"}
    artists = load_artists()
    current = artists.get(name, {}) or {}
    record = {}
    # 显式传 null 视为清除封面；未传则保留原值
    if "cover_url" in data:
        if data.get("cover_url"):
            record["cover_url"] = data.get("cover_url")
    elif current.get("cover_url"):
        record["cover_url"] = current.get("cover_url")
    if "bio" in data:
        record["bio"] = data.get("bio") or ""
    elif current.get("bio"):
        record["bio"] = current.get("bio")
    if "genres" in data:
        record["genres"] = data.get("genres") or []
    elif current.get("genres"):
        record["genres"] = current.get("genres")
    for key in ("bio_source", "bio_source_id", "cover_source", "cover_source_id", "cover_position", "matched"):
        if key in data and data.get(key):
            record[key] = data.get(key)
        elif current.get(key):
            record[key] = current.get(key)
    artists[name] = record
    ok = save_artists(artists)
    return {"status": "ok" if ok else "error", "artist": record}


@router.delete("/{name}")
def delete_artist(name: str):
    """删除艺人记录及其封面图片"""
    artists = load_artists()
    if name in artists:
        del artists[name]
        save_artists(artists)
    img_dir = artist_img_dir(name)
    if os.path.isdir(img_dir):
        try:
            for f in os.listdir(img_dir):
                os.remove(os.path.join(img_dir, f))
            os.rmdir(img_dir)
        except Exception:
            pass
    return {"status": "ok"}


@router.post("/cover")
async def upload_artist_cover(name: str = Form(...), file: UploadFile = File(...)):
    """上传艺人封面，保存到 data/artists_img/{name}/cover.{ext}，返回 cover_url"""
    safe = sanitize_name(name) or "unknown"
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_COVER_EXTS:
        ext = ".jpg"
    dest_dir = os.path.join(ARTISTS_IMG_DIR, safe)
    os.makedirs(dest_dir, exist_ok=True)
    # 清理旧封面
    for f in os.listdir(dest_dir):
        try:
            os.remove(os.path.join(dest_dir, f))
        except Exception:
            pass
    dest_path = os.path.join(dest_dir, f"cover{ext}")
    with open(dest_path, "wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)
    return {
        "status": "ok",
        "cover_url": f"/data/artists_img/{safe}/cover{ext}",
    }
