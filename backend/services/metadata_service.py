import os
import re
from mutagen import File
from mutagen.mp3 import MP3
from mutagen.flac import FLAC
from mutagen.oggvorbis import OggVorbis
from mutagen.oggopus import OggOpus
from mutagen.oggflac import OggFLAC
from mutagen.mp4 import MP4
from mutagen.wave import WAVE
from mutagen.aiff import AIFF
from mutagen.asf import ASF
from mutagen.id3 import ID3, APIC, USLT


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
        "year": None, "trackNo": None,
    }

    # 1. MP3 → ID3
    if isinstance(audio, MP3):
        tags = audio.tags
        meta["title"] = _get_id3(tags, "TIT2")
        meta["artist"] = _get_id3(tags, "TPE1")
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
        meta["artist"] = _get_mp4(tags, "\xa9ART") or _get_mp4(tags, "aART")
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
        "title": None, "artist": None, "album": None,
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
