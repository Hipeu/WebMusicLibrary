import os
import json
import shutil
import re
import hashlib
import subprocess
import sys
import logging
import time
from fastapi import APIRouter, UploadFile, File, Form, Body, HTTPException
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
VIDEO_MANIFEST_PATH = os.path.join(DATA_DIR, "videos", "videos.json")


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


def remove_backup_artifacts(artist, album, filename_base, remove_cover=True):
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
        # 封面属于专辑；同专辑仍有歌曲时保留，避免删除一首影响其他歌曲。
        if remove_cover:
            for f in os.listdir(dest):
                if f.startswith("cover"):
                    try:
                        os.remove(os.path.join(dest, f))
                    except Exception:
                        pass
        song_jsons = [f for f in os.listdir(dest) if f.endswith(".json") and f != "album.json"]
        if remove_cover and not song_jsons:
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


def _is_within(path, root):
    """确认规范化后的 path 位于 root 内，避免清理接口被路径穿越利用。"""
    normalized_path = os.path.normcase(os.path.normpath(path))
    normalized_root = os.path.normcase(os.path.normpath(root))
    return normalized_path != normalized_root and normalized_path.startswith(normalized_root + os.sep)


def _remove_data_file(relative_path):
    """删除 data 目录内由清单记录的单个关联文件。"""
    if not relative_path:
        return
    full_path = os.path.normpath(os.path.join(DATA_DIR, relative_path))
    if not _is_within(full_path, DATA_DIR):
        return
    try:
        if os.path.isfile(full_path):
            os.remove(full_path)
    except OSError:
        pass


def _prune_empty_dirs(path, root):
    """仅在指定 data 子树内自底向上清理空目录。"""
    root = os.path.normpath(root)
    path = os.path.normpath(path)
    while _is_within(path, root) and os.path.isdir(path):
        try:
            os.rmdir(path)
        except OSError:
            break
        path = os.path.dirname(path)


def _remove_song_video_links(file_path):
    """保留视频本身，只移除指向被删歌曲精确路径的关联。"""
    if not os.path.isfile(VIDEO_MANIFEST_PATH):
        return
    try:
        with open(VIDEO_MANIFEST_PATH, "r", encoding="utf-8") as source:
            videos = json.load(source)
        if not isinstance(videos, list):
            return
        normalized_path = file_path.replace("\\", "/")
        changed = False
        for video in videos:
            song_ids = video.get("song_ids") or []
            next_ids = [song_id for song_id in song_ids if str(song_id).replace("\\", "/") != normalized_path]
            if len(next_ids) != len(song_ids):
                video["song_ids"] = next_ids
                changed = True
        if changed:
            with open(VIDEO_MANIFEST_PATH, "w", encoding="utf-8") as target:
                json.dump(videos, target, ensure_ascii=False, indent=2)
    except (OSError, json.JSONDecodeError):
        logger.warning("清理视频关联失败：%s", file_path, exc_info=True)


def _entry_storage_location(entry):
    """返回歌曲实际存储所用的艺人、专辑目录名。"""
    return (
        sanitize_name(entry.get("artist")) or "Various Artists",
        sanitize_name(entry.get("album")) or "Unknown Album",
    )


def _remove_song_entry(file_path, entry, manifest, to_trash):
    """清理一个清单条目及其所有歌曲级关联文件；成功时从 manifest 移除。"""
    library = os.path.normpath(get_library_path())
    audio_path = os.path.normpath(os.path.join(library, file_path))
    if not _is_within(audio_path, library):
        return False, "无效路径"

    # 回收站模式先移动音频，失败时整首歌曲保持不动。
    if to_trash and os.path.isfile(audio_path) and not _send_to_trash(audio_path):
        return False, "移入 trash 文件夹失败（文件可能被占用），已保留文件"

    if os.path.isfile(audio_path):
        _remove_file(audio_path, to_trash)
    base_no_ext = os.path.splitext(audio_path)[0]
    for ext in (".json", ".lrc"):
        _remove_file(base_no_ext + ext, to_trash)

    artist, album = _entry_storage_location(entry)
    title_base = os.path.splitext(os.path.basename(file_path))[0]
    has_other_album_tracks = any(
        key != file_path and _entry_storage_location(item) == (artist, album)
        for key, item in manifest.items()
    )

    # 清单内路径优先，兼容旧记录缺少路径时再按文件名清理。
    _remove_data_file(entry.get("metadata_path"))
    _remove_data_file(entry.get("lyrics_path"))
    remove_backup_artifacts(artist, album, title_base, remove_cover=not has_other_album_tracks)
    for relative_path in (entry.get("metadata_path"), entry.get("lyrics_path"), entry.get("cover_path")):
        if relative_path:
            _prune_empty_dirs(os.path.dirname(os.path.join(DATA_DIR, relative_path)), DATA_DIR)

    album_dir = os.path.join(library, artist, album)
    if os.path.isdir(album_dir):
        files = os.listdir(album_dir)
        if files and all(name.startswith("cover") for name in files):
            for name in files:
                _remove_file(os.path.join(album_dir, name), to_trash)
        _prune_empty_dirs(album_dir, library)

    manifest.pop(file_path, None)
    _remove_song_video_links(file_path)
    return True, None


def _remove_album_data_dir(base_dir, artist, album):
    """删除一个用户明确指定专辑的数据目录，不触及其他专辑。"""
    target = os.path.normpath(os.path.join(base_dir, artist, album))
    if not _is_within(target, base_dir) or not os.path.isdir(target):
        return
    try:
        shutil.rmtree(target)
    except OSError:
        logger.warning("清理专辑残留目录失败：%s", target, exc_info=True)
        return
    _prune_empty_dirs(os.path.dirname(target), base_dir)


def _metadata_dirs_for_album(artist, album):
    """解析歌曲 metadata，找出以目标专辑艺人展示的残留实际目录。"""
    matches = {(artist, album)}
    if not os.path.isdir(METADATA_DIR):
        return matches
    for artist_dir in os.listdir(METADATA_DIR):
        artist_path = os.path.join(METADATA_DIR, artist_dir)
        if not os.path.isdir(artist_path):
            continue
        for album_dir in os.listdir(artist_path):
            album_path = os.path.join(artist_path, album_dir)
            if not os.path.isdir(album_path):
                continue
            for name in os.listdir(album_path):
                if not name.endswith(".json") or name == "album.json":
                    continue
                try:
                    with open(os.path.join(album_path, name), "r", encoding="utf-8") as source:
                        metadata = json.load(source)
                except (OSError, json.JSONDecodeError):
                    continue
                metadata_artist = sanitize_name(metadata.get("album_artist") or metadata.get("artist"))
                metadata_album = sanitize_name(metadata.get("album"))
                if metadata_artist == artist and metadata_album == album:
                    matches.add((artist_dir, album_dir))
                    break
    return matches


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


@router.post("/restore")
async def restore_missing_music(file_path: str = Form(...), file: UploadFile = File(...)):
    """将用户找到的源文件恢复到既有缺失歌曲的原始路径，保留已匹配资料。"""
    file_path = (file_path or "").replace("\\", "/").lstrip("/")
    manifest = load_manifest()
    entry = manifest.get(file_path)
    if not entry:
        raise HTTPException(status_code=404, detail="缺失歌曲记录不存在")

    library = os.path.normpath(get_library_path())
    destination = os.path.normpath(os.path.join(library, file_path))
    if destination == library or not destination.startswith(library + os.sep):
        raise HTTPException(status_code=400, detail="无效的歌曲路径")
    if os.path.exists(destination):
        raise HTTPException(status_code=409, detail="目标歌曲已存在，无法覆盖")

    os.makedirs(os.path.dirname(destination), exist_ok=True)
    temp_destination = f"{destination}.restore-{int(time.time() * 1000)}"
    try:
        with open(temp_destination, "wb") as output:
            shutil.copyfileobj(file.file, output)
        os.replace(temp_destination, destination)
    except Exception:
        try:
            if os.path.exists(temp_destination):
                os.remove(temp_destination)
        except OSError:
            pass
        raise HTTPException(status_code=500, detail="恢复音乐文件失败")

    modified_time = int(time.time() * 1000)
    entry = {**entry, "file_path": file_path, "sha256": _file_sha256(destination), "modification_time": modified_time}
    manifest[file_path] = entry
    save_manifest(manifest)

    metadata_path = entry.get("metadata_path")
    if metadata_path:
        metadata_file = os.path.join(DATA_DIR, metadata_path)
        try:
            with open(metadata_file, "r", encoding="utf-8") as source:
                metadata = json.load(source)
            metadata["modification_time"] = modified_time
            with open(metadata_file, "w", encoding="utf-8") as output:
                json.dump(metadata, output, ensure_ascii=False, indent=2)
        except Exception:
            pass

    cover_path = entry.get("cover_path")
    lyrics_path = entry.get("lyrics_path")
    return {
        "status": "ok",
        "song": {
            "title": entry.get("title"), "artist": entry.get("artist"), "album": entry.get("album"),
            "album_artist": entry.get("album_artist"), "genre": entry.get("genre"), "year": entry.get("year"),
            "duration": entry.get("duration"), "trackNo": entry.get("trackNo"), "discNo": entry.get("discNo"),
            "composer": entry.get("composer"), "lyricist": entry.get("lyricist"), "publisher": entry.get("publisher"),
            "comment": entry.get("comment"), "bitrate": entry.get("bitrate"), "codec": entry.get("codec"),
            "file_path": file_path, "file_url": f"/library/{file_path}",
            "cover_url": f"/data/{cover_path}" if cover_path and os.path.exists(os.path.join(DATA_DIR, cover_path)) else None,
            "lyrics_url": f"/data/{lyrics_path}" if lyrics_path and os.path.exists(os.path.join(DATA_DIR, lyrics_path)) else None,
            "hash": entry.get("sha256"), "matched": bool(entry.get("matched")),
            "match_source": entry.get("match_source"), "importTime": entry.get("import_time"),
            "modification_time": modified_time,
        },
    }


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

    # 同名或已缺失的清单记录必须保留独立路径，不能覆盖另一个版本。
    manifest = load_manifest()
    title_base = sanitize_name(title) or "unknown"
    ext = os.path.splitext(file.filename)[1]
    suffix_index = 0
    while True:
        safe_title = title_base if suffix_index == 0 else f"{title_base} ({suffix_index})"
        final_filename = f"{safe_title}{ext}"
        final_path = os.path.join(album_dir, final_filename)
        candidate_rel = final_path.replace(get_library_path(), "").replace("\\", "/").lstrip("/")
        if not os.path.exists(final_path) and candidate_rel not in manifest:
            break
        suffix_index += 1

    # 移动音频文件
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
def delete_music(file_path: str, to_trash: str = "0"):
    """按精确 file_path 删除指定歌曲及其关联资料。
    to_trash=1 时音乐文件移入项目 trash 文件夹而非永久删除。
    """
    to_trash = to_trash == "1"
    file_path = (file_path or "").replace("\\", "/").lstrip("/")
    if not file_path:
        return {"status": "error", "msg": "缺少 file_path"}
    manifest = load_manifest()
    entry = manifest.get(file_path)
    if not entry:
        return {"status": "error", "msg": "歌曲不存在"}
    removed, message = _remove_song_entry(file_path, entry, manifest, to_trash)
    if not removed:
        return {"status": "error", "msg": message or "删除失败"}
    save_manifest(manifest)
    return {"status": "ok"}


@router.delete("/album")
def delete_album(artist: str, album: str, to_trash: str = "0"):
    """删除指定专辑的歌曲和残留资料；空专辑卡片也可通过此接口清理。"""
    artist = sanitize_name(artist)
    album = sanitize_name(album)
    if not artist or not album:
        return {"status": "error", "msg": "缺少有效的专辑艺人或专辑名"}

    to_trash = to_trash == "1"
    manifest = load_manifest()
    matching_paths = [
        file_path for file_path, entry in manifest.items()
        if (sanitize_name(entry.get("album_artist")) or sanitize_name(entry.get("artist")) or "Various Artists") == artist
        and (sanitize_name(entry.get("album")) or "Unknown Album") == album
    ]
    data_locations = _metadata_dirs_for_album(artist, album)
    data_locations.update(_entry_storage_location(manifest[file_path]) for file_path in matching_paths)
    failures = []
    for file_path in matching_paths:
        entry = manifest.get(file_path)
        if not entry:
            continue
        removed, message = _remove_song_entry(file_path, entry, manifest, to_trash)
        if not removed:
            failures.append(f"{file_path}: {message or '删除失败'}")
    save_manifest(manifest)

    # 即使没有清单歌曲，也按用户确认的专辑路径清除 metadata / 歌词 / 封面残留。
    if not failures:
        # 某些歌曲可能共享实际资料目录但归属到不同专辑艺人卡片；仍有清单歌曲时不清空共享目录。
        removable_locations = {
            location for location in data_locations
            if not any(_entry_storage_location(entry) == location for entry in manifest.values())
        }
        for data_artist, data_album in removable_locations:
            for base_dir in (PICTURE_DIR, LYRICS_DIR, METADATA_DIR):
                _remove_album_data_dir(base_dir, data_artist, data_album)

    if failures:
        return {"status": "error", "msg": "；".join(failures)}
    return {"status": "ok", "deleted": len(matching_paths)}


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
