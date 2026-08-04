import os
import re
from mutagen import File
from mutagen.mp3 import MP3
from mutagen.flac import FLAC, Picture
from mutagen.oggvorbis import OggVorbis
from mutagen.oggopus import OggOpus
from mutagen.oggflac import OggFLAC
from mutagen.mp4 import MP4, MP4Cover
from mutagen.wave import WAVE
from mutagen.aiff import AIFF
from mutagen.asf import ASF
from mutagen.id3 import ID3, APIC, USLT, TIT2, TPE1, TPE2, TALB, TCON, TCOM, TEXT, TPUB, COMM, TDRC, TRCK


def _first(val):
    """从 MP4 / Vorbis 的列表值中取第一个字符串"""
    if val is None:
        return None
    if isinstance(val, list):
        return str(val[0]) if val else None
    return str(val) if val else None


def _get_vorbis(tags, key):
    """从 Vorbis 注释（FLAC / OGG）安全取值"""
    if not tags:
        return None
    try:
        return _first(tags.get(key))
    except Exception:
        return None


def _get_id3(tags, key):
    """从 ID3 标签（MP3）安全取值"""
    if not tags:
        return None
    try:
        frame = tags.get(key)
    except Exception:
        return None
    return str(frame) if frame else None


def _get_mp4(tags, key):
    """从 MP4Tags 安全取值"""
    if not tags:
        return None
    try:
        return _first(tags.get(key))
    except Exception:
        return None


def _get_asf(tags, key):
    """从 ASF（WMA）标签安全取值"""
    if not tags:
        return None
    try:
        return _first(tags.get(key))
    except Exception:
        return None


def _get_wav_info(tags, key):
    """从 WAV INFO chunk 安全取值"""
    if not tags:
        return None
    try:
        return _first(tags.get(key))
    except Exception:
        return None


def _extract_year_mp4(tags):
    raw = _get_mp4(tags, "\xa9day")
    if raw:
        m = re.match(r"(\d{4})", raw)
        if m:
            return m.group(1)
    return None


def _extract_track_mp4(tags):
    """MP4 音轨号：trkn 是 (track, total) 元组列表"""
    if not tags:
        return None
    try:
        val = tags.get("trkn")
        if isinstance(val, list) and val:
            trk = val[0]
            if isinstance(trk, tuple) and trk:
                return int(trk[0])
    except Exception:
        pass
    return None


def _extract_year_id3_or_vorbis(tags, is_id3):
    if is_id3:
        raw = _get_id3(tags, "TDRC") or _get_id3(tags, "TYER") or _get_id3(tags, "TDRL")
    else:
        raw = _get_vorbis(tags, "date") or _get_vorbis(tags, "year")
    if not raw:
        return None
    m = re.match(r"(\d{4})", str(raw))
    return m.group(1) if m else None


def _extract_track_id3_or_vorbis(tags, is_id3):
    if is_id3:
        raw = _get_id3(tags, "TRCK")
    else:
        raw = _get_vorbis(tags, "tracknumber") or _get_vorbis(tags, "track")
    if not raw:
        return None
    m = re.match(r"(\d+)", str(raw))
    return int(m.group(1)) if m else None


def _extract_cover(audio):
    """提取封面：支持 MP3-APIC / FLAC-pictures / MP4-covr"""
    try:
        if isinstance(audio, MP3) and audio.tags:
            for tag in audio.tags.values():
                if isinstance(tag, APIC):
                    return {"data": tag.data, "mime": tag.mime}
        elif isinstance(audio, MP4) and audio.tags:
            covr = audio.tags.get("covr")
            if isinstance(covr, list) and covr:
                cover = covr[0]
                from mutagen.mp4 import MP4Cover
                if isinstance(cover, MP4Cover):
                    mime = "image/jpeg" if cover.imageformat == MP4Cover.FORMAT_JPEG else "image/png"
                    return {"data": bytes(cover), "mime": mime}
        elif hasattr(audio, "pictures") and audio.pictures:
            pic = audio.pictures[0]
            return {"data": pic.data, "mime": pic.mime}
    except Exception:
        pass
    return None


def _extract_lyrics(audio):
    """提取歌词：支持 MP3-USLT / MP4-lyr / Vorbis-lyrics"""
    try:
        if isinstance(audio, MP3) and audio.tags:
            for tag in audio.tags.values():
                if isinstance(tag, USLT):
                    return tag.text
        elif isinstance(audio, MP4) and audio.tags:
            return _get_mp4(audio.tags, "\xa9lyr")
        elif hasattr(audio, "tags") and audio.tags:
            return _get_vorbis(audio.tags, "lyrics") or _get_vorbis(audio.tags, "unsyncedlyrics")
    except Exception:
        pass
    return None


def _detect_and_extract(audio):
    """根据音频类型提取文本标签字段"""
    meta = {
        "title": None, "artist": None, "album": None, "genre": None,
        "composer": None, "lyricist": None, "publisher": None, "comment": None,
        "year": None, "trackNo": None, "album_artist": None,
    }

    # 1. MP3 → ID3
    if isinstance(audio, MP3):
        tags = audio.tags
        meta["title"] = _get_id3(tags, "TIT2")
        meta["artist"] = _get_id3(tags, "TPE1")
        meta["album_artist"] = _get_id3(tags, "TPE2")
        meta["album"] = _get_id3(tags, "TALB")
        meta["genre"] = _get_id3(tags, "TCON")
        meta["composer"] = _get_id3(tags, "TCOM")
        meta["lyricist"] = _get_id3(tags, "TEXT")
        meta["publisher"] = _get_id3(tags, "TPUB")
        meta["comment"] = _get_id3(tags, "COMM")
        meta["year"] = _extract_year_id3_or_vorbis(tags, True)
        meta["trackNo"] = _extract_track_id3_or_vorbis(tags, True)

    # 2. M4A / MP4 → MP4Tags (iTunes atoms)
    elif isinstance(audio, MP4):
        tags = audio.tags
        meta["title"] = _get_mp4(tags, "\xa9nam")
        meta["artist"] = _get_mp4(tags, "\xa9ART")
        meta["album_artist"] = _get_mp4(tags, "aART")
        meta["album"] = _get_mp4(tags, "\xa9alb")
        meta["genre"] = _get_mp4(tags, "\xa9gen")
        meta["composer"] = _get_mp4(tags, "\xa9wrt")
        meta["lyricist"] = _get_mp4(tags, "\xa9wrt") or None
        meta["publisher"] = _get_mp4(tags, "cprt")
        meta["comment"] = _get_mp4(tags, "\xa9cmt")
        meta["year"] = _extract_year_mp4(tags)
        meta["trackNo"] = _extract_track_mp4(tags)

    # 3. FLAC / OGG (Vorbis comments)
    elif isinstance(audio, (FLAC, OggVorbis, OggOpus, OggFLAC)):
        tags = getattr(audio, "tags", None)
        meta["title"] = _get_vorbis(tags, "title")
        meta["artist"] = _get_vorbis(tags, "artist")
        meta["album_artist"] = _get_vorbis(tags, "albumartist")
        meta["album"] = _get_vorbis(tags, "album")
        meta["genre"] = _get_vorbis(tags, "genre")
        meta["composer"] = _get_vorbis(tags, "composer")
        meta["lyricist"] = _get_vorbis(tags, "lyricist")
        meta["publisher"] = _get_vorbis(tags, "publisher") or _get_vorbis(tags, "label")
        meta["comment"] = _get_vorbis(tags, "comment")
        meta["year"] = _extract_year_id3_or_vorbis(tags, False)
        meta["trackNo"] = _extract_track_id3_or_vorbis(tags, False)

    # 4. WAV → INFO chunk
    elif isinstance(audio, WAVE):
        tags = getattr(audio, "info", None) or getattr(audio, "tags", None)
        meta["title"] = _get_wav_info(tags, "INAM")
        meta["artist"] = _get_wav_info(tags, "IART")
        meta["album"] = _get_wav_info(tags, "IPRD")
        meta["genre"] = _get_wav_info(tags, "IGNR")
        meta["comment"] = _get_wav_info(tags, "ICMT")
        raw_year = _get_wav_info(tags, "ICRD")
        if raw_year:
            m = re.match(r"(\d{4})", raw_year)
            if m:
                meta["year"] = m.group(1)

    # 5. AIFF → 也使用 ID3
    elif isinstance(audio, AIFF):
        tags = audio.tags
        meta["title"] = _get_id3(tags, "TIT2")
        meta["artist"] = _get_id3(tags, "TPE1")
        meta["album_artist"] = _get_id3(tags, "TPE2")
        meta["album"] = _get_id3(tags, "TALB")
        meta["genre"] = _get_id3(tags, "TCON")
        meta["composer"] = _get_id3(tags, "TCOM")
        meta["comment"] = _get_id3(tags, "COMM")
        meta["year"] = _extract_year_id3_or_vorbis(tags, True)
        meta["trackNo"] = _extract_track_id3_or_vorbis(tags, True)

    # 6. WMA (ASF)
    elif isinstance(audio, ASF):
        tags = audio.tags
        meta["title"] = _get_asf(tags, "Title")
        meta["artist"] = _get_asf(tags, "Author")
        meta["album_artist"] = _get_asf(tags, "WM/AlbumArtist")
        meta["album"] = _get_asf(tags, "WM/AlbumTitle")
        meta["genre"] = _get_asf(tags, "WM/Genre")
        meta["composer"] = _get_asf(tags, "WM/Composer")
        meta["comment"] = _get_asf(tags, "Description")
        raw_year = _get_asf(tags, "WM/Year")
        if raw_year:
            m = re.match(r"(\d{4})", raw_year)
            if m:
                meta["year"] = m.group(1)
        raw_trk = _get_asf(tags, "WM/TrackNumber")
        if raw_trk:
            m = re.match(r"(\d+)", raw_trk)
            if m:
                meta["trackNo"] = int(m.group(1))

    return meta


def parse_metadata(file_path):
    """解析音频文件元信息，兼容 MP3 / M4A / FLAC / OGG / WAV / WMA / AIFF 等格式

    返回字段：title, artist, album, year, genre, trackNo, composer,
              lyricist, publisher, comment, duration, bitrate, codec,
              lyrics, cover_data, cover_mime
    """
    meta = {
        "title": None, "artist": None, "album": None, "album_artist": None,
        "year": None, "genre": None, "trackNo": None,
        "composer": None, "lyricist": None, "publisher": None,
        "comment": None, "duration": None, "bitrate": None,
        "codec": None, "lyrics": None, "cover_data": None, "cover_mime": None,
    }

    try:
        audio = File(file_path)
    except Exception:
        return meta

    if audio is None:
        return meta

    # 格式 / 时长 / 码率
    ext = os.path.splitext(file_path)[1].lower()
    codec_map = {
        ".mp3": "MPEG", ".flac": "FLAC", ".ogg": "Ogg Vorbis",
        ".oga": "Ogg Vorbis", ".opus": "Opus", ".m4a": "AAC",
        ".mp4": "AAC", ".wav": "WAV", ".wave": "WAV",
        ".aiff": "AIFF", ".aif": "AIFF", ".wma": "WMA",
        ".ape": "APE", ".wv": "WavPack", ".m4b": "AAC",
    }
    meta["codec"] = codec_map.get(ext, ext.replace(".", "").upper() or None)

    if hasattr(audio, "info"):
        try:
            if hasattr(audio.info, "length") and audio.info.length:
                meta["duration"] = round(audio.info.length, 1)
            if hasattr(audio.info, "bitrate") and audio.info.bitrate:
                meta["bitrate"] = audio.info.bitrate
        except Exception:
            pass

    # 文本标签
    extracted = _detect_and_extract(audio)
    meta.update(extracted)

    # 封面 / 歌词
    cover = _extract_cover(audio)
    if cover:
        meta["cover_data"] = cover["data"]
        meta["cover_mime"] = cover["mime"]
    meta["lyrics"] = _extract_lyrics(audio)

    return meta


# ================================================================
# 写入元信息（编辑）
# ================================================================

ID3_MAPPING = {
    "title": TIT2, "artist": TPE1, "album_artist": TPE2, "album": TALB, "genre": TCON,
    "composer": TCOM, "lyricist": TEXT, "publisher": TPUB,
}

VORBIS_MAPPING = {
    "title": "title", "artist": "artist", "album_artist": "albumartist",
    "album": "album", "genre": "genre",
    "composer": "composer", "lyricist": "lyricist", "publisher": "publisher",
    "comment": "comment", "year": "date", "trackNo": "tracknumber",
}

ASF_MAPPING = {
    "title": "Title", "artist": "Author", "album_artist": "WM/AlbumArtist",
    "album": "WM/AlbumTitle",
    "genre": "WM/Genre", "composer": "WM/Composer", "comment": "Description",
    "year": "WM/Year", "trackNo": "WM/TrackNumber",
}

MP4_MAPPING = {
    "title": "\xa9nam", "artist": "\xa9ART", "album_artist": "aART",
    "album": "\xa9alb",
    "genre": "\xa9gen", "composer": "\xa9wrt", "comment": "\xa9cmt",
    "publisher": "cprt", "year": "\xa9day",
}


def _set_id3_frame(tags, cls, value):
    """写入一个 ID3 帧（先删除同名帧再添加）"""
    name = cls.__name__
    try:
        tags.delall(name)
    except Exception:
        pass
    tags.add(cls(encoding=3, text=[str(value)]))


def _write_id3(audio, meta, cover_data, cover_mime, lyrics, clear_fields=None):
    tags = audio.tags
    if tags is None:
        audio.add_tags()
        tags = audio.tags
    for key, cls in ID3_MAPPING.items():
        if meta.get(key) is not None:
            _set_id3_frame(tags, cls, meta[key])
    if meta.get("year") is not None:
        _set_id3_frame(tags, TDRC, meta["year"])
    if clear_fields and "trackNo" in clear_fields:
        try:
            tags.delall("TRCK")
        except Exception:
            pass
    elif meta.get("trackNo") is not None:
        _set_id3_frame(tags, TRCK, int(meta["trackNo"]))
    if clear_fields and "album_artist" in clear_fields:
        try:
            tags.delall("TPE2")
        except Exception:
            pass
    if lyrics is not None:
        try:
            tags.delall("USLT")
        except Exception:
            pass
        tags.add(USLT(encoding=3, lang="eng", desc="", text=str(lyrics)))
    if cover_data is not None:
        try:
            tags.delall("APIC")
        except Exception:
            pass
        tags.add(APIC(encoding=3, mime=cover_mime or "image/jpeg", type=3, desc="cover", data=cover_data))
    audio.save()


def _write_vorbis(audio, meta, cover_data, cover_mime, lyrics, clear_fields=None):
    tags = audio.tags
    if tags is None:
        audio.add_tags()
        tags = audio.tags
    for key, vkey in VORBIS_MAPPING.items():
        if meta.get(key) is not None:
            tags[vkey] = [str(meta[key])]
    if clear_fields and "trackNo" in clear_fields:
        for k in ("tracknumber", "track"):
            try:
                tags.pop(k, None)
            except Exception:
                pass
    if clear_fields and "album_artist" in clear_fields:
        try:
            tags.pop("albumartist", None)
        except Exception:
            pass
    if lyrics is not None:
        tags["lyrics"] = [str(lyrics)]
    if cover_data is not None and isinstance(audio, FLAC):
        pic = Picture()
        pic.type = 3
        pic.mime = cover_mime or "image/jpeg"
        pic.data = cover_data
        try:
            audio.clear_pictures()
        except Exception:
            pass
        audio.add_picture(pic)
    audio.save()


def _write_mp4(audio, meta, cover_data, cover_mime, lyrics, clear_fields=None):
    tags = audio.tags
    if tags is None:
        audio.add_tags()
        tags = audio.tags
    for key, atom in MP4_MAPPING.items():
        if meta.get(key) is not None:
            tags[atom] = [str(meta[key])]
    if clear_fields and "trackNo" in clear_fields:
        try:
            tags.pop("trkn", None)
        except Exception:
            pass
    elif meta.get("trackNo") is not None:
        try:
            total = tags["trkn"][0][1]
        except Exception:
            total = 0
        tags["trkn"] = [(int(meta["trackNo"]), total)]
    if clear_fields and "album_artist" in clear_fields:
        try:
            tags.pop("aART", None)
        except Exception:
            pass
    if lyrics is not None:
        tags["\xa9lyr"] = [str(lyrics)]
    if cover_data is not None:
        fmt = MP4Cover.FORMAT_PNG if (cover_mime or "").startswith("image/png") else MP4Cover.FORMAT_JPEG
        tags["covr"] = [MP4Cover(cover_data, imageformat=fmt)]
    audio.save()


def _write_asf(audio, meta, cover_data, cover_mime, lyrics, clear_fields=None):
    tags = audio.tags
    if tags is None:
        audio.add_tags()
        tags = audio.tags
    for key, akey in ASF_MAPPING.items():
        if meta.get(key) is not None:
            tags[akey] = [str(meta[key])]
    if clear_fields and "trackNo" in clear_fields:
        try:
            del tags["WM/TrackNumber"]
        except Exception:
            pass
    if clear_fields and "album_artist" in clear_fields:
        try:
            del tags["WM/AlbumArtist"]
        except Exception:
            pass
    if lyrics is not None:
        tags["Lyrics"] = [str(lyrics)]
    audio.save()


def write_metadata(file_path, meta=None, cover_data=None, cover_mime=None, lyrics=None, clear_fields=None):
    """将元信息写入音频文件内部标签（编辑保存用）

    参数：
      meta         — dict，可含 title/artist/album/genre/year/trackNo/composer/
                      lyricist/publisher/comment；值为 None 的字段跳过不写入
      cover_data   — 封面二进制（可选，传入则写入内嵌封面）
      cover_mime   — 封面 MIME（可选）
      lyrics       — 歌词文本（可选，传入则写入内嵌歌词）
      clear_fields — 需从文件标签中删除的字段名集合（如 {"trackNo"}），
                     传入后对应字段会被移除而非写入

    支持：MP3/AIFF(ID3)、M4A/MP4、FLAC/OGG/Opus(Vorbis)、WMA(ASF)。
    其他格式尽力而为，失败返回 False。
    """
    if not os.path.exists(file_path):
        return False
    try:
        audio = File(file_path)
    except Exception:
        return False
    if audio is None:
        return False

    meta = meta or {}
    try:
        if isinstance(audio, MP4):
            _write_mp4(audio, meta, cover_data, cover_mime, lyrics, clear_fields)
        elif isinstance(audio, (FLAC, OggVorbis, OggOpus, OggFLAC)):
            _write_vorbis(audio, meta, cover_data, cover_mime, lyrics, clear_fields)
        elif isinstance(audio, (MP3, AIFF, WAVE)):
            _write_id3(audio, meta, cover_data, cover_mime, lyrics, clear_fields)
        elif isinstance(audio, ASF):
            _write_asf(audio, meta, cover_data, cover_mime, lyrics, clear_fields)
        else:
            return False
        return True
    except Exception:
        return False
