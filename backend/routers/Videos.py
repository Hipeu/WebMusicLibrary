"""视频资料库：本地文件与哔哩哔哩 / YouTube 链接的持久化管理。"""
import json
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from services.library_config import get_library_path

router = APIRouter(prefix="/api/videos")
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
VIDEO_DATA_DIR = os.path.join(DATA_DIR, "videos")
VIDEO_COVER_DIR = os.path.join(VIDEO_DATA_DIR, "covers")
MANIFEST_PATH = os.path.join(VIDEO_DATA_DIR, "videos.json")
VIDEO_DIR_NAME = "_videos"
PLAYABLE_EXTENSIONS = {".mp4", ".webm"}
ALLOWED_EXTENSIONS = {".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v", ".flv", ".wmv"}


def _ensure_dirs():
    os.makedirs(VIDEO_DATA_DIR, exist_ok=True)
    os.makedirs(VIDEO_COVER_DIR, exist_ok=True)
    os.makedirs(os.path.join(get_library_path(), VIDEO_DIR_NAME), exist_ok=True)


def _load():
    _ensure_dirs()
    try:
        with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
            value = json.load(f)
            return value if isinstance(value, list) else []
    except Exception:
        return []


def _save(items):
    _ensure_dirs()
    with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)


def _public_cover(item):
    value = item.get("cover_path")
    if value:
        return f"/data/{value}"
    return item.get("cover_url")


def _public(item):
    result = dict(item)
    if item.get("file_path"):
        result["file_url"] = f"/library/{item['file_path']}"
        result["file_exists"] = os.path.isfile(os.path.join(get_library_path(), item["file_path"]))
    result["cover_url"] = _public_cover(item)
    result["playable_in_app"] = item.get("extension", "").lower() in PLAYABLE_EXTENSIONS
    result["source_label"] = {"bilibili": "哔哩哔哩", "youtube": "YouTube", "local": item.get("extension", "").replace(".", "").upper() or "本地视频"}.get(item.get("source"), "视频")
    return result


def _extract_meta(url):
    host = (urlparse(url).hostname or "").lower()
    if "bilibili.com" in host or "b23.tv" in host:
        source = "bilibili"
    elif "youtube.com" in host or "youtu.be" in host:
        source = "youtube"
    else:
        raise HTTPException(status_code=400, detail="当前仅支持哔哩哔哩和 YouTube 视频链接")
    title, author, cover = "", "", ""
    try:
        request = Request(url, headers={"User-Agent": "Mozilla/5.0 WebMusicPlayer/1.0"})
        with urlopen(request, timeout=8) as response:
            html = response.read(1_500_000).decode("utf-8", errors="ignore")
        def meta(name):
            pattern = rf'<meta[^>]+(?:property|name)=["\']{re.escape(name)}["\'][^>]+content=["\']([^"\']+)'
            found = re.search(pattern, html, re.I)
            return found.group(1).strip() if found else ""
        title = meta("og:title") or meta("twitter:title")
        author = meta("author") or meta("og:site_name")
        cover = meta("og:image") or meta("twitter:image")
    except Exception:
        pass
    return source, title, author, cover


def _cache_remote_cover(url, video_id):
    """将平台预览图缓存到 data，规避浏览器跨域限制并让封面可随备份迁移。"""
    if not url:
        return None
    try:
        request = Request(url, headers={"User-Agent": "Mozilla/5.0 WebMusicPlayer/1.0"})
        with urlopen(request, timeout=12) as response:
            content_type = response.headers.get_content_type()
            suffix = {"image/png": ".png", "image/webp": ".webp"}.get(content_type, ".jpg")
            target = os.path.join(VIDEO_COVER_DIR, f"{video_id}{suffix}")
            with open(target, "wb") as output:
                shutil.copyfileobj(response, output)
        return f"videos/covers/{video_id}{suffix}"
    except Exception:
        return None


@router.get("")
def list_videos():
    return [_public(item) for item in _load()]


@router.post("/upload")
async def upload_video(file: UploadFile = File(...)):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="不支持的视频格式")
    _ensure_dirs()
    video_id = uuid.uuid4().hex
    safe_name = re.sub(r'[<>:"/\\|?*]', "", Path(file.filename).stem).strip() or "video"
    filename = f"{video_id}_{safe_name}{suffix}"
    rel = f"{VIDEO_DIR_NAME}/{filename}"
    destination = os.path.join(get_library_path(), rel)
    with open(destination, "wb") as target:
        shutil.copyfileobj(file.file, target)
    item = {
        "id": video_id, "title": safe_name, "artist": "", "producer": "", "cast": "",
        "source": "local", "file_path": rel.replace("\\", "/"), "extension": suffix,
        "codec": "未检测到", "song_ids": [], "import_time": int(time.time() * 1000),
    }
    items = _load(); items.append(item); _save(items)
    return _public(item)


@router.post("/web")
async def add_web_video(url: str = Form(...)):
    source, title, artist, cover = _extract_meta(url.strip())
    video_id = uuid.uuid4().hex
    _ensure_dirs()
    cached_cover = _cache_remote_cover(cover, video_id)
    item = {
        "id": video_id, "title": title or ("YouTube 视频" if source == "youtube" else "哔哩哔哩视频"),
        "artist": artist or "", "producer": "", "cast": "", "source": source,
        "website_url": url.strip(), "cover_url": cover or "", "cover_path": cached_cover, "extension": "", "codec": "在线视频",
        "song_ids": [], "import_time": int(time.time() * 1000),
    }
    items = _load(); items.append(item); _save(items)
    return _public(item)


@router.put("/{video_id}")
async def update_video(video_id: str, payload: dict):
    items = _load(); item = next((entry for entry in items if entry.get("id") == video_id), None)
    if not item: raise HTTPException(status_code=404, detail="视频不存在")
    allowed = {"title", "artist", "producer", "cast", "website_url", "song_ids"}
    for key in allowed:
        if key in payload:
            item[key] = payload[key] if key != "song_ids" else list(dict.fromkeys(payload[key] or []))
    _save(items)
    return _public(item)


@router.post("/{video_id}/cover")
async def update_cover(video_id: str, file: UploadFile = File(...)):
    items = _load(); item = next((entry for entry in items if entry.get("id") == video_id), None)
    if not item: raise HTTPException(status_code=404, detail="视频不存在")
    if item.get("source") == "local": raise HTTPException(status_code=400, detail="本地视频不可修改独立封面")
    suffix = Path(file.filename or "cover.jpg").suffix.lower()
    if suffix not in {".jpg", ".jpeg", ".png", ".webp"}: raise HTTPException(status_code=400, detail="封面格式不支持")
    _ensure_dirs(); name = f"{video_id}{suffix}"; dest = os.path.join(VIDEO_COVER_DIR, name)
    with open(dest, "wb") as target: shutil.copyfileobj(file.file, target)
    item["cover_path"] = f"videos/covers/{name}"; _save(items)
    return _public(item)


@router.delete("/{video_id}")
def delete_video(video_id: str):
    items = _load(); item = next((entry for entry in items if entry.get("id") == video_id), None)
    if not item: raise HTTPException(status_code=404, detail="视频不存在")
    if item.get("file_path"):
        try: os.remove(os.path.join(get_library_path(), item["file_path"]))
        except OSError: pass
    if item.get("cover_path"):
        try: os.remove(os.path.join(DATA_DIR, item["cover_path"]))
        except OSError: pass
    _save([entry for entry in items if entry.get("id") != video_id])
    return {"status": "ok"}


@router.post("/{video_id}/open")
def open_video(video_id: str):
    item = next((entry for entry in _load() if entry.get("id") == video_id), None)
    path = os.path.normpath(os.path.join(get_library_path(), (item or {}).get("file_path", "")))
    root = os.path.normpath(get_library_path())
    if not item or not item.get("file_path") or not path.startswith(root + os.sep) or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="本地视频不存在")
    if sys.platform.startswith("win"): os.startfile(path)
    elif sys.platform == "darwin": subprocess.Popen(["open", path])
    else: subprocess.Popen(["xdg-open", path])
    return {"status": "ok"}
