import os
import json
import shutil
import re
import hashlib
import subprocess
import sys
import logging
import time
from fastapi import APIRouter, UploadFile, File, Form, Body
from pydantic import BaseModel
from services.metadata_service import parse_metadata
from services.library_config import get_library_path
from services.artist_utils import normalize_artists

logger = logging.getLogger("musicload")


def _trash_dir():
    """项目根目录下的 trash 文件夹（音乐文件删除后移入此处，可手动找回）"""
    return os.path.join(PROJECT_ROOT, "trash")


def _send_to_trash(path):
    """将文件移入项目 trash 文件夹（保留 Artist/Album 相对结构）；失败返回 False（不永久删除兜底）"""
    try:
        lib = os.path.normpath(get_library_path())
        full = os.path.normpath(path)
        rel = os.path.relpath(full, lib)
        if rel.startswith(".."):
            rel = os.path.basename(full)
        dest = os.path.join(_trash_dir(), rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.move(full, dest)
        return True
    except Exception as e:
        logger.error("移入 trash 文件夹失败 %s: %s", path, e)
        return False


def _remove_file(path, to_trash):
    """按开关删除文件：回收站或永久删除；返回是否成功"""
    if not os.path.exists(path):
        return True
    try:
        if to_trash:
            return _send_to_trash(path)
        os.remove(path)
        return True
    except Exception as e:
        logger.error("删除文件失败 %s: %s", path, e)
        return False

router = APIRouter(prefix="/api/music")

def manifest_file():
    return os.path.join(get_library_path(), ".manifest.json")

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


def read_album_description(meta_dir):
    path = os.path.join(meta_dir, "album.json")
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f).get("description")
    except Exception:
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
        song_jsons = [f for f in os.listdir(dest) if f.endswith(".json") and f != "album.json"]
        if not song_jsons:
            album_meta = os.path.join(dest, "album.json")
            if os.path.exists(album_meta):
                try:
                    os.remove(album_meta)
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
    if os.path.exists(manifest_file()):
        try:
            with open(manifest_file(), "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def save_manifest(manifest):
    try:
        with open(manifest_file(), "w", encoding="utf-8") as f:
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


def _file_sha256(path):
    """计算文件 SHA-256（分块读取，避免大文件占用内存）"""
    try:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                h.update(chunk)
        return h.hexdigest()
    except Exception:
        return None


@router.post("/upload")
async def upload_music(file: UploadFile = File(...), auto_organize: str = Form("0")):
    """上传音乐文件，按 Artist/Album 组织到 Music_Library。
    auto_organize=1 时把多位艺人统一为 "A & B & C" 格式。
    """
    temp_path = os.path.join(get_library_path(), "_temp", file.filename)
    os.makedirs(os.path.dirname(temp_path), exist_ok=True)

    # 保存临时文件
    with open(temp_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # 提取元信息（使用 metadata_service）
    meta = parse_metadata(temp_path)
    title = meta["title"] or os.path.splitext(file.filename)[0]
    artist = sanitize_name(meta["artist"]) or "Various Artists"
    album = sanitize_name(meta["album"]) or "Unknown Album"
    if auto_organize == "1":
        meta["artist"] = normalize_artists(meta.get("artist"))
        meta["album_artist"] = normalize_artists(meta.get("album_artist"))
        artist = sanitize_name(meta["artist"]) or artist

    # 创建目录结构（仅存放音频文件）
    artist_dir = os.path.join(get_library_path(), artist)
    album_dir = os.path.join(artist_dir, album)
    os.makedirs(album_dir, exist_ok=True)

    # 移动音频文件
    safe_title = sanitize_name(title) or "unknown"
    ext = os.path.splitext(file.filename)[1]
    final_filename = f"{safe_title}{ext}"
    final_path = os.path.join(album_dir, final_filename)
    shutil.move(temp_path, final_path)
    # 记录文件哈希（用于导入时判断是否为同一首）
    file_hash = _file_sha256(final_path)

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
    temp_dir = os.path.join(get_library_path(), "_temp")
    if os.path.exists(temp_dir) and not os.listdir(temp_dir):
        os.rmdir(temp_dir)

    # 返回给前端的数据
    file_rel = final_path.replace(get_library_path(), "").replace("\\", "/").lstrip("/")

    # 记录到清单（即使文件被外部删除，清单仍保留记录）
    manifest = load_manifest()
    manifest[file_rel] = {
        "title": title,
        "artist": artist,
        "album": album,
        "album_artist": meta.get("album_artist"),
        "genre": meta.get("genre"),
        "year": meta.get("year"),
        "duration": meta.get("duration"),
        "trackNo": meta.get("trackNo"),
        "discNo": meta.get("discNo"),
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
        "sha256": file_hash,
        "import_time": int(time.time() * 1000),
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
            groups[artist][album] = {"songs": [], "cover_url": None, "description": None}
        return groups[artist][album]

    # 1. 从清单构建（含缺失文件，标记 file_exists）
    for file_path, s in manifest.items():
        exists = os.path.exists(os.path.join(get_library_path(), file_path))
        track_artist = s.get("artist") or "Various Artists"
        album = s.get("album") or "Unknown Album"
        # 专辑归属由「专辑艺人」决定，无专辑艺人则回退为曲目艺人
        group_artist = s.get("album_artist") or track_artist
        g = ensure_group(group_artist, album)
        cover_path = s.get("cover_path")
        # 专辑封面取第一首有封面歌曲的封面
        if not g["cover_url"] and cover_path and os.path.exists(os.path.join(DATA_DIR, cover_path)):
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
        if metadata_path:
            description = read_album_description(os.path.dirname(os.path.join(DATA_DIR, metadata_path)))
            if description is not None and g["description"] is None:
                g["description"] = description
        lyrics_path = s.get("lyrics_path")
        lyrics_url = f"/data/{lyrics_path}" if lyrics_path and os.path.exists(os.path.join(DATA_DIR, lyrics_path)) else None
        song_cover_url = f"/data/{cover_path}" if cover_path and os.path.exists(os.path.join(DATA_DIR, cover_path)) else None
        g["songs"].append({
            "title": meta.get("title") or s.get("title") or os.path.splitext(os.path.basename(file_path))[0],
            "artist": meta.get("artist") or s.get("artist") or track_artist,
            "album": meta.get("album") or s.get("album") or album,
            "album_artist": meta.get("album_artist") if meta.get("album_artist") is not None else s.get("album_artist"),
            "genre": meta.get("genre") if meta.get("genre") is not None else s.get("genre"),
            "duration": meta.get("duration") if meta.get("duration") is not None else s.get("duration"),
            "trackNo": meta.get("trackNo") if meta.get("trackNo") is not None else s.get("trackNo"),
            "discNo": meta.get("discNo") if meta.get("discNo") is not None else s.get("discNo"),
            "year": meta.get("year") if meta.get("year") is not None else s.get("year"),
            "composer": meta.get("composer") if meta.get("composer") is not None else s.get("composer"),
            "lyricist": meta.get("lyricist") if meta.get("lyricist") is not None else s.get("lyricist"),
            "publisher": meta.get("publisher") if meta.get("publisher") is not None else s.get("publisher"),
            "comment": meta.get("comment") if meta.get("comment") is not None else s.get("comment"),
            "bitrate": meta.get("bitrate") if meta.get("bitrate") is not None else s.get("bitrate"),
            "codec": meta.get("codec") if meta.get("codec") is not None else s.get("codec"),
            "modification_time": meta.get("modification_time") if meta.get("modification_time") is not None else s.get("modification_time"),
            "file_path": file_path,
            "file_url": f"/library/{file_path}",
            "cover_url": song_cover_url,
            "lyrics_url": lyrics_url,
            "file_exists": exists,
            "hash": s.get("sha256"),
            "matched": bool(s.get("matched") or meta.get("matched")),
            "match_source": meta.get("match_source") if meta.get("match_source") is not None else s.get("match_source"),
            "importTime": s.get("import_time"),
        })

    # 2. 扫描目录中未在清单内的额外音频文件（用户手动放入）
    if os.path.exists(get_library_path()):
        audio_exts = (".mp3", ".flac", ".ogg", ".oga", ".opus", ".m4a", ".m4b",
                      ".mp4", ".wav", ".wave", ".aiff", ".aif", ".wma", ".ape", ".wv")
        for artist_name in sorted(os.listdir(get_library_path())):
            artist_path = os.path.join(get_library_path(), artist_name)
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
                    g = ensure_group(meta.get("album_artist") or artist_name, album_name)
                    description = read_album_description(os.path.join(METADATA_DIR, artist_name, album_name))
                    if description is not None and g["description"] is None:
                        g["description"] = description
                    # 封面优先从 data/picture 读取
                    data_cover = find_cover_in_dir(os.path.join(PICTURE_DIR, artist_name, album_name))
                    if data_cover and not g["cover_url"]:
                        g["cover_url"] = f"/data/picture/{artist_name}/{album_name}/{data_cover}"
                    g["songs"].append({
                        "title": meta.get("title") or base,
                        "artist": meta.get("artist") or artist_name,
                        "album": meta.get("album") or album_name,
                        "album_artist": meta.get("album_artist"),
                        "genre": meta.get("genre"),
                        "duration": meta.get("duration"),
                        "trackNo": meta.get("trackNo"),
                        "discNo": meta.get("discNo"),
                        "year": meta.get("year"),
                        "composer": meta.get("composer"),
                        "lyricist": meta.get("lyricist"),
                        "publisher": meta.get("publisher"),
                        "comment": meta.get("comment"),
                        "bitrate": meta.get("bitrate"),
                        "codec": meta.get("codec"),
                        "modification_time": meta.get("modification_time"),
                        "file_path": rel_path,
                        "file_url": f"/library/{rel_path}",
                        "cover_url": f"/data/picture/{artist_name}/{album_name}/{data_cover}" if data_cover else None,
                        "file_exists": True,
                        "matched": bool(meta.get("matched")),
                        "match_source": meta.get("match_source"),
                    })

    # 3. 同步仅有资料信息的专辑。导入“专辑信息”而不导入音乐文件时，
    #    metadata / picture 仍应在资料库中形成可查看的专辑。
    if os.path.isdir(METADATA_DIR):
        for artist_dir in sorted(os.listdir(METADATA_DIR)):
            artist_path = os.path.join(METADATA_DIR, artist_dir)
            if not os.path.isdir(artist_path):
                continue
            for album_dir in sorted(os.listdir(artist_path)):
                album_path = os.path.join(artist_path, album_dir)
                if not os.path.isdir(album_path):
                    continue

                canonical_artist, canonical_album = artist_dir, album_dir
                has_track_metadata = False
                # 歌曲元信息保留原始名称，优先用它避免文件夹名被清理后的显示差异。
                for metadata_file in sorted(os.listdir(album_path)):
                    if not metadata_file.lower().endswith(".json") or metadata_file == "album.json":
                        continue
                    try:
                        with open(os.path.join(album_path, metadata_file), "r", encoding="utf-8") as mf:
                            metadata = json.load(mf)
                        has_track_metadata = True
                        canonical_artist = metadata.get("album_artist") or metadata.get("artist") or canonical_artist
                        canonical_album = metadata.get("album") or canonical_album
                        break
                    except Exception:
                        continue

                # 仅剩 album.json 的目录是外部删除歌曲后留下的孤立简介，
                # 不能将其重新生成为空专辑；已有清单分组则仍允许补充简介/封面。
                has_existing_group = canonical_artist in groups and canonical_album in groups[canonical_artist]
                if not has_track_metadata and not has_existing_group:
                    continue
                g = ensure_group(canonical_artist, canonical_album)
                description = read_album_description(album_path)
                if description is not None and g["description"] is None:
                    g["description"] = description
                if not g["cover_url"]:
                    cover = find_cover_in_dir(os.path.join(PICTURE_DIR, artist_dir, album_dir))
                    if cover:
                        g["cover_url"] = f"/data/picture/{artist_dir}/{album_dir}/{cover}"
                g["import_time"] = max(g.get("import_time", 0), int(os.path.getmtime(album_path) * 1000))

    # 4. 组装结果
    result = []
    for artist, albums_map in sorted(groups.items()):
        albums_list = []
        for album, data in sorted(albums_map.items()):
            data["songs"].sort(key=lambda s: s.get("trackNo") or 9999)
            albums_list.append({
                "album": album,
                "songs": data["songs"],
                "cover_url": data["cover_url"],
                "description": data.get("description"),
                "import_time": data.get("import_time"),
            })
        result.append({"artist": artist, "albums": albums_list})

    return result


@router.delete("/delete")
def delete_music(artist: str, album: str, title: str, to_trash: str = "0"):
    """删除指定歌曲（含备份），并清理空的专辑 / 艺人目录。
    to_trash=1 时音乐文件移入项目 trash 文件夹而非永久删除。
    """
    to_trash = to_trash == "1"
    if not artist or not album or not title:
        return {"status": "error", "msg": "指定 artist/album/title"}

    san_artist = sanitize_name(artist) or artist
    san_album = sanitize_name(album) or album
    album_dir = os.path.join(get_library_path(), san_artist, san_album)

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

    # 定位音频文件
    audio_path = None
    if target_path:
        audio_path = os.path.join(get_library_path(), target_path)
    elif os.path.exists(album_dir):
        for f in os.listdir(album_dir):
            base = os.path.splitext(f)[0]
            if base == title or base == title.replace(" ", "_"):
                audio_path = os.path.join(album_dir, f)
                break

    # 回收站模式：音频移入 trash 文件夹失败则中止删除（保留文件，避免永久删除）
    if to_trash and audio_path and os.path.exists(audio_path) and not _send_to_trash(audio_path):
        return {"status": "error", "msg": "移入 trash 文件夹失败（文件可能被占用），已保留文件"}

    # 删除音频（回收站已移入或永久删除）+ 同目录伴随 .json/.lrc
    if audio_path:
        _remove_file(audio_path, to_trash)
        base_no_ext = os.path.splitext(audio_path)[0]
        for ext in (".json", ".lrc"):
            _remove_file(base_no_ext + ext, to_trash)

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
        full = os.path.normpath(os.path.join(get_library_path(), p))
        if not full.startswith(get_library_path()):
            result[p] = False
            continue
        result[p] = os.path.exists(full)
    return {"exists": result}


@router.post("/open")
def open_music_file(payload: dict = Body(...)):
    """用系统默认程序（本地播放器）打开资料库中的音乐文件。
    仅本机运行场景有效：后端与浏览器同机，os.startfile 作用于用户本机。
    """
    file_path = payload.get("file_path") if isinstance(payload, dict) else None
    if not file_path:
        return {"status": "error", "msg": "缺少 file_path"}
    lib = os.path.normpath(get_library_path())
    full = os.path.normpath(os.path.join(lib, file_path))
    if full != lib and not full.startswith(lib + os.sep):
        return {"status": "error", "msg": "无效路径"}
    if not os.path.isfile(full):
        return {"status": "error", "msg": "文件不存在"}
    try:
        if sys.platform.startswith("win"):
            os.startfile(full)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", full])
        else:
            subprocess.Popen(["xdg-open", full])
    except Exception as e:
        return {"status": "error", "msg": str(e)}
    return {"status": "ok"}
