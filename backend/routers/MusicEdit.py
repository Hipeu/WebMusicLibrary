import os
import json
import shutil
import re
import time
from fastapi import APIRouter, UploadFile, File, Form
from services.metadata_service import parse_metadata, write_metadata

router = APIRouter(prefix="/api/music")

MUSIC_LIBRARY = os.path.join(os.path.expanduser("~"), "Music", "Music_Library")
MANIFEST_FILE = os.path.join(MUSIC_LIBRARY, ".manifest.json")

# 备份目录：封面 / 歌词 / 元信息
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
PICTURE_DIR = os.path.join(DATA_DIR, "picture")
LYRICS_DIR = os.path.join(DATA_DIR, "Lyrics")
METADATA_DIR = os.path.join(DATA_DIR, "metadata")

TEXT_FIELDS = ("title", "artist", "album", "album_artist", "genre", "year", "trackNo",
               "composer", "lyricist", "publisher", "comment")

COVER_EXT_MAP = {
    "image/jpeg": ".jpg", "image/jpg": ".jpg",
    "image/png": ".png", "image/webp": ".webp",
}

AUDIO_EXTS = (".mp3", ".flac", ".ogg", ".oga", ".opus", ".m4a", ".m4b",
              ".mp4", ".wav", ".wave", ".aiff", ".aif", ".wma", ".ape", ".wv")


def load_manifest():
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
    if not name or str(name).strip() == "":
        return None
    cleaned = re.sub(r'[<>:"/\\|?*]', "", str(name))
    return cleaned.strip() or None


def _remove_empty_dirs(path):
    """自底向上清理空目录"""
    while path and os.path.isdir(path):
        try:
            os.rmdir(path)
        except Exception:
            break
        parent = os.path.dirname(path)
        if parent == path:
            break
        path = parent


def _album_has_audio_files(artist, album):
    """音乐库中该专辑文件夹是否还残留音频文件（判断专辑是否已被清空）"""
    album_dir = os.path.join(MUSIC_LIBRARY, artist, album)
    if not os.path.isdir(album_dir):
        return False
    for f in os.listdir(album_dir):
        if os.path.splitext(f)[1].lower() in AUDIO_EXTS:
            return True
    return False


def move_song_artifacts(old_artist, old_album, old_title,
                        new_artist, new_album, new_title):
    """将歌曲的备份文件（元信息 / 歌词 / 封面）从旧目录迁移到新目录。

    - 元信息 json 与歌词 lrc 按歌曲名移动 / 改名
    - 封面属于专辑：仅当旧专辑已无其他歌曲时才随歌迁移，
      避免多曲专辑中单曲移动导致整张专辑封面消失
    """
    if old_artist == new_artist and old_album == new_album and old_title == new_title:
        return

    # 音频文件已在 edit 中移动完成，此时旧专辑文件夹是否还有音频即代表是否清空
    album_vacated = not _album_has_audio_files(old_artist, old_album)

    for base in (PICTURE_DIR, LYRICS_DIR, METADATA_DIR):
        old_dir = os.path.join(base, old_artist, old_album)
        new_dir = os.path.join(base, new_artist, new_album)
        if not os.path.isdir(old_dir):
            continue

        files = os.listdir(old_dir)
        song_files = [f for f in files if os.path.splitext(f)[0] == old_title]
        covers = [f for f in files if f.startswith("cover")]

        # 迁移 / 改名该歌曲的 json、lrc
        for f in song_files:
            ext = os.path.splitext(f)[1]
            src = os.path.join(old_dir, f)
            dest = os.path.join(new_dir, f"{new_title}{ext}")
            if src == dest:
                continue
            os.makedirs(new_dir, exist_ok=True)
            try:
                shutil.move(src, dest)
            except Exception:
                pass

        # 封面：仅在旧专辑整体清空时才随歌迁移（封面属于专辑，不属于单曲）
        if old_dir != new_dir and album_vacated:
            for f in covers:
                os.makedirs(new_dir, exist_ok=True)
                try:
                    shutil.move(os.path.join(old_dir, f), os.path.join(new_dir, f))
                except Exception:
                    pass

        # 清理旧目录
        if os.path.isdir(old_dir) and not os.listdir(old_dir):
            _remove_empty_dirs(old_dir)


def find_cover_in_dir(dir_path):
    if not os.path.isdir(dir_path):
        return None
    for f in sorted(os.listdir(dir_path)):
        if f.startswith("cover") and os.path.splitext(f)[1].lower() in (".jpg", ".jpeg", ".png", ".webp"):
            return f
    return None


@router.get("/lyrics")
def get_lyrics(file_path: str):
    """获取歌曲歌词：优先读取 data/Lyrics 备份，否则直接解析文件内嵌歌词"""
    file_path = file_path.replace("\\", "/")
    manifest = load_manifest()
    entry = manifest.get(file_path)
    if entry:
        lyrics_path = entry.get("lyrics_path")
        if lyrics_path and os.path.exists(os.path.join(DATA_DIR, lyrics_path)):
            try:
                with open(os.path.join(DATA_DIR, lyrics_path), "r", encoding="utf-8") as f:
                    return {"status": "ok", "lyrics": f.read()}
            except Exception:
                pass
    abs_path = os.path.join(MUSIC_LIBRARY, file_path)
    if os.path.exists(abs_path):
        meta = parse_metadata(abs_path)
        if meta.get("lyrics"):
            return {"status": "ok", "lyrics": meta["lyrics"]}
    return {"status": "ok", "lyrics": None}


@router.post("/edit")
async def edit_music(
    file_path: str = Form(...),
    title: str = Form(None),
    artist: str = Form(None),
    album: str = Form(None),
    album_artist: str = Form(None),
    genre: str = Form(None),
    year: str = Form(None),
    trackNo: str = Form(None),
    composer: str = Form(None),
    lyricist: str = Form(None),
    publisher: str = Form(None),
    comment: str = Form(None),
    lyrics: str = Form(None),
    cover: UploadFile = File(None),
):
    """编辑歌曲元信息：同时写入音频文件内部标签 + data 备份 JSON + manifest。

    支持修改 title/artist/album/album_artist/genre/year/trackNo/composer/lyricist/
    publisher/comment、内嵌歌词与封面；artist/album/title 变化时物理移动文件。
    """
    file_path = file_path.replace("\\", "/")

    manifest = load_manifest()
    entry = manifest.get(file_path)
    if not entry:
        return {"status": "error", "msg": f"歌曲不存在: {file_path}"}

    old_abs = os.path.join(MUSIC_LIBRARY, file_path)
    if not os.path.exists(old_abs):
        return {"status": "error", "msg": "音乐文件不存在于库中"}

    # ---- 读取当前元信息（data JSON 优先，manifest 兜底） ----
    cur = {}
    metadata_path = entry.get("metadata_path")
    if metadata_path and os.path.exists(os.path.join(DATA_DIR, metadata_path)):
        try:
            with open(os.path.join(DATA_DIR, metadata_path), "r", encoding="utf-8") as mf:
                cur = json.load(mf)
        except Exception:
            cur = {}
    for k in TEXT_FIELDS:
        if cur.get(k) is None:
            cur[k] = entry.get(k)

    old_artist = sanitize_name(entry.get("artist")) or "Various Artists"
    old_album = sanitize_name(entry.get("album")) or "Unknown Album"
    old_title = os.path.splitext(os.path.basename(file_path))[0]
    ext = os.path.splitext(file_path)[1] or os.path.splitext(os.path.basename(old_abs))[1]

    # ---- 合并新值（空字符串视为保留原值） ----
    provided = {"title": title, "artist": artist, "album": album,
                "genre": genre, "year": year,
                "composer": composer, "lyricist": lyricist,
                "publisher": publisher, "comment": comment}
    for k, v in provided.items():
        if v is not None and str(v).strip() != "":
            cur[k] = v

    # 专辑艺人：显式传空/空白串则清除为 None
    clear_fields = set()
    if album_artist is not None:
        if str(album_artist).strip() == "":
            cur["album_artist"] = None
            clear_fields.add("album_artist")
        else:
            cur["album_artist"] = str(album_artist)

    # 音轨号：显式传空串则清除为 None（与音乐文件内无编号一致）；否则转 int
    if trackNo is not None:
        if str(trackNo).strip() == "":
            cur["trackNo"] = None
            clear_fields.add("trackNo")
        else:
            try:
                cur["trackNo"] = int(trackNo)
            except Exception:
                cur["trackNo"] = None
    elif cur.get("trackNo") is not None and str(cur["trackNo"]).strip() != "":
        try:
            cur["trackNo"] = int(cur["trackNo"])
        except Exception:
            cur["trackNo"] = None

    new_title = sanitize_name(cur.get("title")) or old_title
    new_artist = sanitize_name(cur.get("artist")) or old_artist
    new_album = sanitize_name(cur.get("album")) or old_album
    new_rel = f"{new_artist}/{new_album}/{new_title}{ext}"

    # ---- 写入音频文件内部标签 ----
    tag_meta = {}
    for k in TEXT_FIELDS:
        if cur.get(k) is not None:
            tag_meta[k] = cur[k]
    cover_data = None
    cover_mime = None
    if cover is not None and cover.filename:
        cover_data = await cover.read()
        cover_mime = cover.content_type

    write_metadata(old_abs, tag_meta, cover_data=cover_data, cover_mime=cover_mime, lyrics=lyrics, clear_fields=clear_fields or None)

    # ---- 物理移动音频文件 ----
    if new_rel != file_path:
        new_abs = os.path.join(MUSIC_LIBRARY, new_rel)
        os.makedirs(os.path.dirname(new_abs), exist_ok=True)
        try:
            shutil.move(old_abs, new_abs)
        except Exception:
            return {"status": "error", "msg": "移动音乐文件失败"}
        _remove_empty_dirs(os.path.dirname(old_abs))

    # ---- 迁移 data 备份（json / lrc / cover） ----
    move_song_artifacts(old_artist, old_album, old_title, new_artist, new_album, new_title)

    # ---- 封面：新上传则写入新专辑目录 ----
    if cover_data:
        cover_ext = COVER_EXT_MAP.get(cover_mime, ".jpg")
        new_cover_dir = os.path.join(PICTURE_DIR, new_artist, new_album)
        os.makedirs(new_cover_dir, exist_ok=True)
        cover_path = os.path.join(new_cover_dir, f"cover{cover_ext}")
        try:
            with open(cover_path, "wb") as f:
                f.write(cover_data)
        except Exception:
            pass

    cover_file = find_cover_in_dir(os.path.join(PICTURE_DIR, new_artist, new_album))
    new_cover_rel = f"picture/{new_artist}/{new_album}/{cover_file}" if cover_file else None

    # ---- 歌词：新提供则写入 data/Lyrics ----
    if lyrics is not None:
        lrc_dir = os.path.join(LYRICS_DIR, new_artist, new_album)
        os.makedirs(lrc_dir, exist_ok=True)
        try:
            with open(os.path.join(lrc_dir, f"{new_title}.lrc"), "w", encoding="utf-8") as f:
                f.write(lyrics)
        except Exception:
            pass

    # ---- 写入 data/metadata JSON ----
    meta_dir = os.path.join(METADATA_DIR, new_artist, new_album)
    os.makedirs(meta_dir, exist_ok=True)
    json_data = {
        "title": new_title,
        "artist": new_artist,
        "album": new_album,
        "album_artist": cur.get("album_artist"),
        "year": cur.get("year"),
        "genre": cur.get("genre"),
        "trackNo": cur.get("trackNo"),
        "composer": cur.get("composer"),
        "lyricist": cur.get("lyricist"),
        "publisher": cur.get("publisher"),
        "comment": cur.get("comment"),
        "duration": cur.get("duration"),
        "bitrate": cur.get("bitrate"),
        "codec": cur.get("codec"),
        "cover_path": new_cover_rel,
        "modification_time": int(time.time() * 1000),
    }
    try:
        with open(os.path.join(meta_dir, f"{new_title}.json"), "w", encoding="utf-8") as f:
            json.dump(json_data, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

    # ---- 更新 manifest ----
    new_entry = {
        "title": new_title,
        "artist": new_artist,
        "album": new_album,
        "album_artist": json_data["album_artist"],
        "genre": json_data["genre"],
        "year": json_data["year"],
        "duration": json_data["duration"],
        "trackNo": json_data["trackNo"],
        "composer": json_data["composer"],
        "lyricist": json_data["lyricist"],
        "publisher": json_data["publisher"],
        "comment": json_data["comment"],
        "bitrate": json_data["bitrate"],
        "codec": json_data["codec"],
        "file_path": new_rel,
        "cover_path": new_cover_rel,
        "metadata_path": f"metadata/{new_artist}/{new_album}/{new_title}.json",
        "lyrics_path": f"Lyrics/{new_artist}/{new_album}/{new_title}.lrc",
        "modification_time": json_data["modification_time"],
    }
    del manifest[file_path]
    manifest[new_rel] = new_entry
    save_manifest(manifest)

    return {
        "status": "ok",
        "song": {
            "title": new_title,
            "artist": new_artist,
            "album": new_album,
            "album_artist": json_data["album_artist"],
            "genre": json_data["genre"],
            "year": json_data["year"],
            "trackNo": json_data["trackNo"],
            "composer": json_data["composer"],
            "lyricist": json_data["lyricist"],
            "publisher": json_data["publisher"],
            "comment": json_data["comment"],
            "file_path": new_rel,
            "file_url": f"/library/{new_rel}",
            "cover_url": f"/data/{new_cover_rel}" if new_cover_rel else None,
            "lyrics_url": f"/data/Lyrics/{new_artist}/{new_album}/{new_title}.lrc",
            "modification_time": json_data["modification_time"],
        },
    }
