import os
import json
import shutil
import re
from fastapi import APIRouter, UploadFile, File
from services.metadata_service import parse_metadata

router = APIRouter(prefix="/api/music")

MUSIC_LIBRARY = os.path.join(os.path.expanduser("~"), "Music", "Music_Library")


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

    # 创建目录结构
    artist_dir = os.path.join(MUSIC_LIBRARY, artist)
    album_dir = os.path.join(artist_dir, album)
    os.makedirs(album_dir, exist_ok=True)

    # 移动文件
    safe_title = sanitize_name(title) or "unknown"
    ext = os.path.splitext(file.filename)[1]
    final_filename = f"{safe_title}{ext}"
    final_path = os.path.join(album_dir, final_filename)
    shutil.move(temp_path, final_path)

    # 保存封面
    meta["cover_path"] = None
    cover = save_cover(meta, album_dir)
    if cover:
        meta["cover_path"] = cover.replace(
            MUSIC_LIBRARY, ""
        ).replace("\\", "/").lstrip("/")

    # 保存歌词
    if meta.get("lyrics"):
        lrc_path = os.path.join(album_dir, f"{safe_title}.lrc")
        with open(lrc_path, "w", encoding="utf-8") as f:
            f.write(meta["lyrics"])
    meta.pop("lyrics", None)
    # 封面数据不写入 JSON（文件体积太大），移除
    meta.pop("cover_data", None)
    meta.pop("cover_mime", None)

    # 保存 JSON 元信息
    json_path = os.path.join(album_dir, f"{safe_title}.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    # 清理临时目录
    temp_dir = os.path.join(MUSIC_LIBRARY, "_temp")
    if os.path.exists(temp_dir) and not os.listdir(temp_dir):
        os.rmdir(temp_dir)

    # 返回给前端的数据
    file_rel = final_path.replace(MUSIC_LIBRARY, "").replace("\\", "/").lstrip("/")

    return {
        "status": "ok",
        "title": title,
        "artist": artist,
        "album": album,
        "file_path": file_rel,
        "cover_url": ("/library/" + meta["cover_path"]) if meta.get("cover_path") else None,
        "meta": meta,
    }


@router.get("/list")
def list_music():
    """扫描 Music_Library 目录，返回所有音乐分类"""
    result = []
    if not os.path.exists(MUSIC_LIBRARY):
        return result

    artists = sorted([
        d for d in os.listdir(MUSIC_LIBRARY)
        if os.path.isdir(os.path.join(MUSIC_LIBRARY, d)) and not d.startswith("_")
    ])

    for artist in artists:
        artist_path = os.path.join(MUSIC_LIBRARY, artist)
        albums = sorted([
            d for d in os.listdir(artist_path)
            if os.path.isdir(os.path.join(artist_path, d))
        ])

        artist_data = {"artist": artist, "albums": []}

        for album in albums:
            album_path = os.path.join(artist_path, album)
            album_data = {"album": album, "songs": [], "cover_url": None}

            files = sorted(os.listdir(album_path))
            for f in files:
                fpath = os.path.join(album_path, f)
                ext = os.path.splitext(f)[1].lower()

                if ext in (".mp3", ".flac", ".ogg", ".oga", ".opus", ".m4a", ".m4b", ".mp4", ".wav", ".wave", ".aiff", ".aif", ".wma", ".ape", ".wv"):
                    # 音频文件 — 查找对应的 JSON 元信息
                    base = os.path.splitext(f)[0]
                    json_file = os.path.join(album_path, f"{base}.json")
                    meta = {}
                    if os.path.exists(json_file):
                        with open(json_file, "r", encoding="utf-8") as jf:
                            meta = json.load(jf)

                    rel_path = os.path.join(artist, album, f).replace("\\", "/")
                    song_data = {
                        "title": meta.get("title") or base,
                        "artist": meta.get("artist") or artist,
                        "album": meta.get("album") or album,
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
                        "cover_url": f"/library/{meta['cover_path']}" if meta.get("cover_path") else None,
                    }
                    album_data["songs"].append(song_data)

                elif "cover" in f.lower() and ext in (".jpg", ".jpeg", ".png", ".webp"):
                    rel = os.path.join(artist, album, f).replace("\\", "/")
                    album_data["cover_url"] = f"/library/{rel}"

            album_data["songs"].sort(key=lambda s: s.get("trackNo") or 9999)
            artist_data["albums"].append(album_data)

        result.append(artist_data)

    return result


@router.delete("/delete")
def delete_music(artist: str, album: str, title: str):
    """删除指定歌曲"""
    if not artist or not album or not title:
        return {"status": "error", "msg": "指定 artist/album/title"}

    album_dir = os.path.join(MUSIC_LIBRARY, sanitize_name(artist), sanitize_name(album))
    if not os.path.exists(album_dir):
        return {"status": "error", "msg": "目录不存在"}

    for f in os.listdir(album_dir):
        if os.path.splitext(f)[0] == title:
            os.remove(os.path.join(album_dir, f))

    for f in os.listdir(album_dir):
        if os.path.splitext(f)[0] == title.replace(" ", "_"):
            os.remove(os.path.join(album_dir, f))

    # 清理空目录
    if os.path.exists(album_dir) and not os.listdir(album_dir):
        os.rmdir(album_dir)
    artist_dir = os.path.dirname(album_dir)
    if os.path.exists(artist_dir) and not os.listdir(artist_dir):
        os.rmdir(artist_dir)

    return {"status": "ok"}
