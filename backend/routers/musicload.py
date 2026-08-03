import os
import json
import shutil
import re
from fastapi import APIRouter, UploadFile, File
from pydantic import BaseModel
from services.metadata_service import parse_metadata

router = APIRouter(prefix="/api/music")

MUSIC_LIBRARY = os.path.join(os.path.expanduser("~"), "Music", "Music_Library")
MANIFEST_FILE = os.path.join(MUSIC_LIBRARY, ".manifest.json")

# 备份目录：封面 / 歌词 / 元信息（防止本地音乐删除后丢失）
# musicload.py 位于 backend/routers/，需上溯三层到项目根目录
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
PICTURE_DIR = os.path.join(DATA_DIR, "picture")
LYRICS_DIR = os.path.join(DATA_DIR, "Lyrics")
METADATA_DIR = os.path.join(DATA_DIR, "metadata")


def ensure_data_dirs():
    for d in (PICTURE_DIR, LYRICS_DIR, METADATA_DIR):
        os.makedirs(d, exist_ok=True)


def find_cover_in_dir(dir_path):
    """在目录中查找封面文件（cover.jpg / cover.png / cover.webp 等）"""
    if not os.path.isdir(dir_path):
        return None
    for f in sorted(os.listdir(dir_path)):
        if f.startswith("cover") and os.path.splitext(f)[1].lower() in (".jpg", ".jpeg", ".png", ".webp"):
            return f
    return None


def backup_song_artifacts(artist, album, filename_base, source_dir):
    """将封面 / 歌词 / 元信息从音乐库备份到 data 目录"""
    ensure_data_dirs()
    dest_picture = os.path.join(PICTURE_DIR, artist, album)
    dest_lyrics = os.path.join(LYRICS_DIR, artist, album)
    dest_metadata = os.path.join(METADATA_DIR, artist, album)
    os.makedirs(dest_picture, exist_ok=True)
    os.makedirs(dest_lyrics, exist_ok=True)
    os.makedirs(dest_metadata, exist_ok=True)

    try:
        # 封面
        for f in os.listdir(source_dir):
            if f.startswith("cover") and os.path.splitext(f)[1].lower() in (".jpg", ".jpeg", ".png", ".webp"):
                shutil.copy2(os.path.join(source_dir, f), os.path.join(dest_picture, f))
        # 歌词
        lrc_src = os.path.join(source_dir, f"{filename_base}.lrc")
        if os.path.exists(lrc_src):
            shutil.copy2(lrc_src, os.path.join(dest_lyrics, f"{filename_base}.lrc"))
        # 元信息 JSON
        json_src = os.path.join(source_dir, f"{filename_base}.json")
        if os.path.exists(json_src):
            shutil.copy2(json_src, os.path.join(dest_metadata, f"{filename_base}.json"))
    except Exception:
        pass


def remove_backup_artifacts(artist, album, filename_base):
    """从 data 备份目录删除对应文件，并清理空目录"""
    for base_dir in (PICTURE_DIR, LYRICS_DIR, METADATA_DIR):
        dest = os.path.join(base_dir, artist, album)
        if not os.path.isdir(dest):
            continue
        for ext in (".json", ".lrc"):
            f = os.path.join(dest, f"{filename_base}{ext}")
            if os.path.exists(f):
                try:
                    os.remove(f)
                except Exception:
                    pass
        # 删除该目录下的封面
        for f in os.listdir(dest):
            if f.startswith("cover"):
                try:
                    os.remove(os.path.join(dest, f))
                except Exception:
                    pass
        # 清理空目录
        if os.path.isdir(dest) and not os.listdir(dest):
            try:
                os.rmdir(dest)
            except Exception:
                pass
        artist_dest = os.path.dirname(dest)
        if os.path.isdir(artist_dest) and not os.listdir(artist_dest):
            try:
                os.rmdir(artist_dest)
            except Exception:
                pass


class CheckRequest(BaseModel):
    paths: list[str]


def load_manifest():
    """读取音乐库清单（记录所有导入过的歌曲，即使文件被外部删除）"""
    if os.path.exists(MANIFEST_FILE):
        try:
            with open(MANIFEST_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def save_manifest(manifest):
    try:
        with open(MANIFEST_FILE, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def sanitize_name(name):
    """清理文件夹名，移除非法字符"""
    if not name or name == "未知":
        return None
    name = re.sub(r'[<>:"/\\|?*]', "", name)
    return name.strip() or None


def save_cover(meta, output_dir):
    """将提取到的封面数据保存为文件，返回相对路径"""
    if not meta.get("cover_data") or not meta.get("cover_mime"):
        return None
    ext_map = {
        "image/jpeg": ".jpg", "image/jpg": ".jpg",
        "image/png": ".png", "image/webp": ".webp",
    }
    cover_ext = ext_map.get(meta["cover_mime"], ".jpg")
    cover_path = os.path.join(output_dir, f"cover{cover_ext}")
    try:
        with open(cover_path, "wb") as f:
            f.write(meta["cover_data"])
        return cover_path
    except Exception:
        return None


@router.post("/upload")
async def upload_music(file: UploadFile = File(...)):
    """上传音乐文件，按 Artist/Album 组织到 Music_Library"""
    temp_path = os.path.join(MUSIC_LIBRARY, "_temp", file.filename)
    os.makedirs(os.path.dirname(temp_path), exist_ok=True)

    # 保存临时文件
    with open(temp_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # 提取元信息（使用 metadata_service）
    meta = parse_metadata(temp_path)
    title = meta["title"] or os.path.splitext(file.filename)[0]
    artist = sanitize_name(meta["artist"]) or "Various Artists"
    album = sanitize_name(meta["album"]) or "Unknown Album"

    # 创建目录结构（仅存放音频文件）
    artist_dir = os.path.join(MUSIC_LIBRARY, artist)
    album_dir = os.path.join(artist_dir, album)
    os.makedirs(album_dir, exist_ok=True)

    # 移动音频文件
    safe_title = sanitize_name(title) or "unknown"
    ext = os.path.splitext(file.filename)[1]
    final_filename = f"{safe_title}{ext}"
    final_path = os.path.join(album_dir, final_filename)
    shutil.move(temp_path, final_path)

    # 封面 / 歌词 / 元信息直接写入 data 备份目录
    data_cover_dir = os.path.join(PICTURE_DIR, artist, album)
    data_lyrics_dir = os.path.join(LYRICS_DIR, artist, album)
    data_metadata_dir = os.path.join(METADATA_DIR, artist, album)
    os.makedirs(data_cover_dir, exist_ok=True)
    os.makedirs(data_lyrics_dir, exist_ok=True)
    os.makedirs(data_metadata_dir, exist_ok=True)

    # 封面
    meta["cover_path"] = None
    cover = save_cover(meta, data_cover_dir)
    if cover:
        meta["cover_path"] = cover.replace(DATA_DIR, "").replace("\\", "/").lstrip("/")

    # 歌词（data/Lyrics）
    if meta.get("lyrics"):
        with open(os.path.join(data_lyrics_dir, f"{safe_title}.lrc"), "w", encoding="utf-8") as f:
            f.write(meta["lyrics"])
    meta.pop("lyrics", None)
    # 封面二进制不写入 JSON（文件体积太大）
    meta.pop("cover_data", None)
    meta.pop("cover_mime", None)

    # 元信息 JSON（data/metadata）
    with open(os.path.join(data_metadata_dir, f"{safe_title}.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    # 清理临时目录
    temp_dir = os.path.join(MUSIC_LIBRARY, "_temp")
    if os.path.exists(temp_dir) and not os.listdir(temp_dir):
        os.rmdir(temp_dir)

    # 返回给前端的数据
    file_rel = final_path.replace(MUSIC_LIBRARY, "").replace("\\", "/").lstrip("/")

    # 记录到清单（即使文件被外部删除，清单仍保留记录）
    manifest = load_manifest()
    manifest[file_rel] = {
        "title": title,
        "artist": artist,
        "album": album,
        "genre": meta.get("genre"),
        "year": meta.get("year"),
        "duration": meta.get("duration"),
        "trackNo": meta.get("trackNo"),
        "composer": meta.get("composer"),
        "lyricist": meta.get("lyricist"),
        "publisher": meta.get("publisher"),
        "comment": meta.get("comment"),
        "bitrate": meta.get("bitrate"),
        "codec": meta.get("codec"),
        "file_path": file_rel,
        "cover_path": meta.get("cover_path"),
        "metadata_path": f"metadata/{artist}/{album}/{safe_title}.json",
        "lyrics_path": f"Lyrics/{artist}/{album}/{safe_title}.lrc",
    }
    save_manifest(manifest)

    return {
        "status": "ok",
        "title": title,
        "artist": artist,
        "album": album,
        "file_path": file_rel,
        "cover_url": ("/data/" + meta["cover_path"]) if meta.get("cover_path") else None,
        "meta": meta,
    }


@router.get("/list")
def list_music():
    """返回音乐库所有歌曲（以清单为准，标记文件是否存在）"""
    manifest = load_manifest()

    # artist -> { album -> {"songs": [], "cover_url": None} }
    groups = {}

    def ensure_group(artist, album):
        if artist not in groups:
            groups[artist] = {}
        if album not in groups[artist]:
            groups[artist][album] = {"songs": [], "cover_url": None}
        return groups[artist][album]

    # 1. 从清单构建（含缺失文件，标记 file_exists）
    for file_path, s in manifest.items():
        exists = os.path.exists(os.path.join(MUSIC_LIBRARY, file_path))
        artist = s.get("artist") or "Various Artists"
        album = s.get("album") or "Unknown Album"
        g = ensure_group(artist, album)
        cover_path = s.get("cover_path")
        if cover_path and os.path.exists(os.path.join(DATA_DIR, cover_path)):
            g["cover_url"] = f"/data/{cover_path}"
        # 优先读取 data/metadata 中的元信息，manifest 兜底
        meta = {}
        metadata_path = s.get("metadata_path")
        if metadata_path and os.path.exists(os.path.join(DATA_DIR, metadata_path)):
            try:
                with open(os.path.join(DATA_DIR, metadata_path), "r", encoding="utf-8") as mf:
                    meta = json.load(mf)
            except Exception:
                meta = {}
        lyrics_path = s.get("lyrics_path")
        lyrics_url = f"/data/{lyrics_path}" if lyrics_path and os.path.exists(os.path.join(DATA_DIR, lyrics_path)) else None
        song_cover_url = f"/data/{cover_path}" if cover_path and os.path.exists(os.path.join(DATA_DIR, cover_path)) else None
        g["songs"].append({
            "title": meta.get("title") or s.get("title") or os.path.splitext(os.path.basename(file_path))[0],
            "artist": meta.get("artist") or s.get("artist") or artist,
            "album": meta.get("album") or s.get("album") or album,
            "genre": meta.get("genre") if meta.get("genre") is not None else s.get("genre"),
            "duration": meta.get("duration") if meta.get("duration") is not None else s.get("duration"),
            "trackNo": meta.get("trackNo") if meta.get("trackNo") is not None else s.get("trackNo"),
            "year": meta.get("year") if meta.get("year") is not None else s.get("year"),
            "composer": meta.get("composer") if meta.get("composer") is not None else s.get("composer"),
            "lyricist": meta.get("lyricist") if meta.get("lyricist") is not None else s.get("lyricist"),
            "publisher": meta.get("publisher") if meta.get("publisher") is not None else s.get("publisher"),
            "comment": meta.get("comment") if meta.get("comment") is not None else s.get("comment"),
            "bitrate": meta.get("bitrate") if meta.get("bitrate") is not None else s.get("bitrate"),
            "codec": meta.get("codec") if meta.get("codec") is not None else s.get("codec"),
            "file_path": file_path,
            "file_url": f"/library/{file_path}",
            "cover_url": song_cover_url,
            "lyrics_url": lyrics_url,
            "file_exists": exists,
        })

    # 2. 扫描目录中未在清单内的额外音频文件（用户手动放入）
    if os.path.exists(MUSIC_LIBRARY):
        audio_exts = (".mp3", ".flac", ".ogg", ".oga", ".opus", ".m4a", ".m4b",
                      ".mp4", ".wav", ".wave", ".aiff", ".aif", ".wma", ".ape", ".wv")
        for artist_name in sorted(os.listdir(MUSIC_LIBRARY)):
            artist_path = os.path.join(MUSIC_LIBRARY, artist_name)
            if not os.path.isdir(artist_path) or artist_name.startswith("_"):
                continue
            for album_name in sorted(os.listdir(artist_path)):
                album_path = os.path.join(artist_path, album_name)
                if not os.path.isdir(album_path):
                    continue
                for f in sorted(os.listdir(album_path)):
                    ext = os.path.splitext(f)[1].lower()
                    if ext not in audio_exts:
                        continue
                    rel_path = os.path.join(artist_name, album_name, f).replace("\\", "/")
                    if rel_path in manifest:
                        continue  # 已在清单中
                    base = os.path.splitext(f)[0]
                    json_file = os.path.join(album_path, f"{base}.json")
                    meta = {}
                    if os.path.exists(json_file):
                        try:
                            with open(json_file, "r", encoding="utf-8") as jf:
                                meta = json.load(jf)
                        except Exception:
                            pass
                    g = ensure_group(artist_name, album_name)
                    # 封面优先从 data/picture 读取
                    data_cover = find_cover_in_dir(os.path.join(PICTURE_DIR, artist_name, album_name))
                    if data_cover and not g["cover_url"]:
                        g["cover_url"] = f"/data/picture/{artist_name}/{album_name}/{data_cover}"
                    g["songs"].append({
                        "title": meta.get("title") or base,
                        "artist": meta.get("artist") or artist_name,
                        "album": meta.get("album") or album_name,
                        "genre": meta.get("genre"),
                        "duration": meta.get("duration"),
                        "trackNo": meta.get("trackNo"),
                        "year": meta.get("year"),
                        "composer": meta.get("composer"),
                        "lyricist": meta.get("lyricist"),
                        "publisher": meta.get("publisher"),
                        "comment": meta.get("comment"),
                        "bitrate": meta.get("bitrate"),
                        "codec": meta.get("codec"),
                        "file_path": rel_path,
                        "file_url": f"/library/{rel_path}",
                        "cover_url": f"/data/picture/{artist_name}/{album_name}/{data_cover}" if data_cover else None,
                        "file_exists": True,
                    })

    # 3. 组装结果
    result = []
    for artist, albums_map in sorted(groups.items()):
        albums_list = []
        for album, data in sorted(albums_map.items()):
            data["songs"].sort(key=lambda s: s.get("trackNo") or 9999)
            albums_list.append({"album": album, "songs": data["songs"], "cover_url": data["cover_url"]})
        result.append({"artist": artist, "albums": albums_list})

    return result


@router.delete("/delete")
def delete_music(artist: str, album: str, title: str):
    """删除指定歌曲（含备份），并清理空的专辑 / 艺人目录"""
    if not artist or not album or not title:
        return {"status": "error", "msg": "指定 artist/album/title"}

    san_artist = sanitize_name(artist) or artist
    san_album = sanitize_name(album) or album
    album_dir = os.path.join(MUSIC_LIBRARY, san_artist, san_album)

    # 从清单中找到对应 file_path，获取精确文件名
    manifest = load_manifest()
    target_path = None
    for key, entry in manifest.items():
        if entry.get("title") == title:
            target_path = key
            break

    safe_title = None
    if target_path:
        safe_title = os.path.splitext(os.path.basename(target_path))[0]
    else:
        safe_title = sanitize_name(title) or title

    # 删除音乐库中的歌曲文件（音频 / json / lrc）
    if target_path:
        fpath = os.path.join(MUSIC_LIBRARY, target_path)
        for p in (fpath, os.path.splitext(fpath)[0] + ".json", os.path.splitext(fpath)[0] + ".lrc"):
            if os.path.exists(p):
                try:
                    os.remove(p)
                except Exception:
                    pass
    elif os.path.exists(album_dir):
        for f in os.listdir(album_dir):
            base = os.path.splitext(f)[0]
            if base == title or base == title.replace(" ", "_"):
                try:
                    os.remove(os.path.join(album_dir, f))
                except Exception:
                    pass

    # 删除 data 备份（封面 / 歌词 / 元信息）
    remove_backup_artifacts(san_artist, san_album, safe_title)

    # 若专辑目录只剩封面或已空，删除封面并清理空目录
    if os.path.exists(album_dir):
        files = os.listdir(album_dir)
        if files and all(f.startswith("cover") for f in files):
            for f in files:
                try:
                    os.remove(os.path.join(album_dir, f))
                except Exception:
                    pass
        if os.path.exists(album_dir) and not os.listdir(album_dir):
            try:
                os.rmdir(album_dir)
            except Exception:
                pass
        artist_dir = os.path.dirname(album_dir)
        if os.path.exists(artist_dir) and not os.listdir(artist_dir):
            try:
                os.rmdir(artist_dir)
            except Exception:
                pass

    # 从清单移除
    removed = False
    for key in list(manifest.keys()):
        entry = manifest.get(key) or {}
        if entry.get("title") == title:
            del manifest[key]
            removed = True
    if removed:
        save_manifest(manifest)

    return {"status": "ok"}


@router.post("/check")
def check_files(req: CheckRequest):
    """批量检查文件是否存在（相对音乐库根目录的路径）"""
    result = {}
    for p in req.paths or []:
        # 防止路径穿越
        full = os.path.normpath(os.path.join(MUSIC_LIBRARY, p))
        if not full.startswith(MUSIC_LIBRARY):
            result[p] = False
            continue
        result[p] = os.path.exists(full)
    return {"exists": result}
