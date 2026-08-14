import asyncio
import json
import os
import threading

import aiohttp
from fastapi import APIRouter, Body

from routers.musicload import load_manifest, save_manifest
from routers.Artists import load_artists, save_artists, sanitize_name as sanitize_artist_name
from services.library_config import get_library_path
from services.metadata_service import write_metadata, parse_metadata
from services.match import MusicMatcher, parse_lyric_credits

router = APIRouter(prefix="/api/match")

# 备份目录：data/metadata / data/picture / data/artists_img（与其它路由一致）
BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
METADATA_DIR = os.path.join(DATA_DIR, "metadata")
PICTURE_DIR = os.path.join(DATA_DIR, "picture")
LYRICS_DIR = os.path.join(DATA_DIR, "Lyrics")
ARTISTS_IMG_DIR = os.path.join(DATA_DIR, "artists_img")

# 全部匹配进度（后台线程更新）
_match_state = {
    "running": False,
    "done": 0,
    "total": 0,
    "matched": 0,
    "failed": 0,
    "skipped": 0,
    "current": None,
    "log": [],
    "error": None,
    "cancel": False,
    "was_cancelled": False,
}

SOURCE_LABELS = {"qq": "QQ音乐", "itunes": "iTunes"}


def _reset_state(total):
    _match_state.update(
        running=True, done=0, total=total, matched=0,
        failed=0, skipped=0, current=None, log=[], error=None,
        cancel=False, was_cancelled=False,
    )


def _log(kind, message):
    _match_state["log"].append({"kind": kind, "message": message})
    if len(_match_state["log"]) > 300:
        _match_state["log"] = _match_state["log"][-300:]


# ================================================================
# 单曲匹配 / 艺人写真
# ================================================================

@router.post("/song")
async def match_song(payload: dict = Body(...)):
    """按 歌名+艺人 匹配：QQ音乐（主）→ iTunes（兜底）→ MusicBrainz（作曲/作词）

    config: {sources:{qq,itunes,musicbrainz}, fields:{...}, lyric_credits_fallback}
    可选 file_path：传入时用该歌本地歌词做 credits 兜底（QQ 歌词不可用时）
    """
    song_name = (payload.get("song_name") or "").strip()
    artist_name = (payload.get("artist_name") or "").strip()
    if not song_name or not artist_name:
        return {"error": "缺少 song_name 或 artist_name"}
    file_path = payload.get("file_path")
    local_lyrics = None
    if file_path:
        manifest = load_manifest()
        entry = manifest.get(file_path) or {}
        local_lyrics = _read_local_lyrics(file_path, entry)
    matcher = MusicMatcher()
    return await matcher.match_song(
        song_name, artist_name,
        sources=payload.get("sources"),
        fields=payload.get("fields"),
        lyric_credits_fallback=bool(payload.get("lyric_credits_fallback")),
        local_lyrics=local_lyrics,
    )


@router.post("/lyric")
async def match_lyric(payload: dict = Body(...)):
    """在线歌词多源匹配：返回 [{source, source_label, song_name, artist, album, lyric}]"""
    song_name = (payload.get("song_name") or "").strip()
    artist_name = (payload.get("artist_name") or "").strip()
    if not song_name or not artist_name:
        return {"error": "缺少 song_name 或 artist_name"}
    matcher = MusicMatcher()
    return {
        "status": "ok",
        "results": await matcher.match_lyric_standalone(
            song_name, artist_name, sources=payload.get("sources")
        ),
    }


@router.post("/artist")
async def match_artist(payload: dict = Body(...)):
    """按艺人名返回 500x500 写真 URL（简介后续接入 QQ 音乐 wiki）"""
    artist_name = (payload.get("artist_name") or "").strip()
    if not artist_name:
        return {"error": "缺少 artist_name"}
    matcher = MusicMatcher()
    return await matcher.match_artist(artist_name)


# ================================================================
# 写回
# ================================================================

COVER_EXT_MAP = {
    "image/jpeg": ".jpg", "image/jpg": ".jpg",
    "image/png": ".png", "image/webp": ".webp",
}


def _update_entry_meta(artist, album, title_base, fields, force=False):
    """更新 data/metadata/{artist}/{album}/{title}.json（force=True 时覆盖已有字段）"""
    meta_dir = os.path.join(METADATA_DIR, artist, album)
    path = os.path.join(meta_dir, f"{title_base}.json")
    m = {}
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                m = json.load(f)
        except Exception:
            m = {}
    changed = False
    for k, v in fields.items():
        if v and (force or not m.get(k)):
            m[k] = v
            changed = True
    if not changed:
        return
    try:
        os.makedirs(meta_dir, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(m, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def _update_manifest(file_path, fields, force=False):
    """更新 manifest 中该歌曲条目（force=True 时覆盖已有字段）"""
    manifest = load_manifest()
    if file_path not in manifest:
        return
    changed = False
    for k, v in fields.items():
        if v and (force or not manifest[file_path].get(k)):
            manifest[file_path][k] = v
            changed = True
    if changed:
        save_manifest(manifest)


def _save_cover_file(artist, album, title_base, cover_data, cover_mime):
    """保存单曲封面到 data/picture/{artist}/{album}/cover_{title}.{ext}，返回相对路径"""
    if not cover_data:
        return None
    ext = COVER_EXT_MAP.get(cover_mime, ".jpg")
    dest_dir = os.path.join(PICTURE_DIR, artist, album)
    fname = f"cover_{title_base}{ext}"
    try:
        os.makedirs(dest_dir, exist_ok=True)
        with open(os.path.join(dest_dir, fname), "wb") as f:
            f.write(cover_data)
        return f"picture/{artist}/{album}/{fname}"
    except Exception:
        return None


def _save_lyric_file(artist, album, title_base, text):
    """保存歌词到 data/Lyrics/{artist}/{album}/{title}.lrc，返回相对路径"""
    if not text:
        return None
    dest_dir = os.path.join(LYRICS_DIR, artist, album)
    try:
        os.makedirs(dest_dir, exist_ok=True)
        with open(os.path.join(dest_dir, f"{title_base}.lrc"), "w", encoding="utf-8") as f:
            f.write(text)
        return f"Lyrics/{artist}/{album}/{title_base}.lrc"
    except Exception:
        return None


def _write_song_metadata(file_path, entry, result, cover_data, cover_mime, lyric_text=None, fields=None):
    """将匹配到的信息写回文件标签 + data 备份 + manifest（只填空缺，尊重 fields 开关）。

    文件内已存在的信息不参与匹配（只写缺失字段）；成功写回后打 matched 标记。
    """
    all_fields = {"title", "artist", "album", "year", "track_disc", "genre", "album_artist",
                  "composer", "lyricist", "lyric", "publisher", "arranger", "producer"}
    fields = fields or {k: True for k in all_fields}

    def _f(k):
        return bool(fields.get(k, True))

    abs_path = os.path.join(get_library_path(), file_path)
    if not os.path.exists(abs_path):
        return False, "音乐文件不存在"

    artist = entry.get("artist") or "Various Artists"
    album = entry.get("album") or "Unknown Album"
    title_base = os.path.splitext(os.path.basename(file_path))[0]

    composer = ", ".join(result.get("composers") or []) or None
    lyricist = ", ".join(result.get("lyricists") or []) or None
    arranger = result.get("arranger") if _f("arranger") else None
    producer = result.get("producer") if _f("producer") else None
    year = result.get("year") if _f("year") else None
    genre = result.get("genre") if _f("genre") else None
    album_name = result.get("album") if _f("album") else None
    album_artist = result.get("album_artist") if _f("album_artist") else None
    track_no = result.get("trackNo") if _f("track_disc") else None
    disc_no = result.get("discNo") if _f("track_disc") else None
    title = result.get("song_name") if _f("title") else None
    artist_name = result.get("artist") if _f("artist") else None
    publisher = result.get("publisher") if _f("publisher") else None

    # 只写入缺失字段
    tag_meta = {}
    if _f("title") and not entry.get("title") and title:
        tag_meta["title"] = title
    if _f("artist") and not entry.get("artist") and artist_name:
        tag_meta["artist"] = artist_name
    if _f("composer") and not entry.get("composer") and composer:
        tag_meta["composer"] = composer
    if _f("lyricist") and not entry.get("lyricist") and lyricist:
        tag_meta["lyricist"] = lyricist
    if _f("album") and not entry.get("album") and album_name:
        tag_meta["album"] = album_name
    if _f("album_artist") and not entry.get("album_artist") and album_artist:
        tag_meta["album_artist"] = album_artist
    if _f("year") and not entry.get("year") and year:
        tag_meta["year"] = year
    if _f("genre") and not entry.get("genre") and genre:
        tag_meta["genre"] = genre
    if _f("track_disc") and not entry.get("trackNo") and track_no is not None:
        tag_meta["trackNo"] = int(track_no)
    if _f("track_disc") and not entry.get("discNo") and disc_no is not None:
        tag_meta["discNo"] = int(disc_no)
    if _f("publisher") and not entry.get("publisher") and publisher:
        tag_meta["publisher"] = publisher

    # 歌词：仅当字段启用 且 歌曲原本无歌词文件时写回
    def _lyric_file_exists():
        lp = entry.get("lyrics_path")
        if lp and os.path.exists(os.path.join(DATA_DIR, lp)):
            return True
        return os.path.exists(os.path.join(LYRICS_DIR, artist, album, f"{title_base}.lrc"))

    has_lyric = bool(lyric_text) and _f("lyric") and not _lyric_file_exists()

    has_new_fields = (
        bool(tag_meta)
        or (arranger and not entry.get("arranger"))
        or (producer and not entry.get("producer"))
        or has_lyric
    )

    # 匹配到源但尚未记录时也允许写回（仅记录来源，不写文件标签）
    new_match_source = bool(result.get("source")) and not entry.get("match_source")

    if not has_new_fields and not cover_data and not new_match_source:
        return False, "没有需要写入的信息"

    # 1. 写入文件内部标签（含封面与歌词）
    if tag_meta or cover_data or has_lyric:
        try:
            write_metadata(
                abs_path, tag_meta,
                cover_data=cover_data, cover_mime=cover_mime,
                lyrics=lyric_text if has_lyric else None,
            )
        except Exception:
            return False, "写入文件标签失败"

    # 2. 封面（每首独立文件）保存到 data/picture
    cover_path = None
    if cover_data:
        cover_path = _save_cover_file(artist, album, title_base, cover_data, cover_mime)

    # 3. 歌词保存到 data/Lyrics
    lyrics_path = None
    if has_lyric:
        lyrics_path = _save_lyric_file(artist, album, title_base, lyric_text)

    # 4. data/metadata JSON + manifest
    json_fields = {
        "composer": composer, "lyricist": lyricist,
        "arranger": arranger, "producer": producer,
        "year": year, "genre": genre,
        "album_artist": album_artist,
        "trackNo": track_no, "discNo": disc_no,
        "publisher": publisher,
    }
    if _f("title") and title:
        json_fields["title"] = title
    if _f("artist") and artist_name:
        json_fields["artist"] = artist_name
    _update_entry_meta(artist, album, title_base, json_fields)
    _update_manifest(file_path, json_fields)
    # 封面 / 歌词 / 匹配标记：强制覆盖
    if cover_path:
        _update_entry_meta(artist, album, title_base, {"cover_path": cover_path}, force=True)
        _update_manifest(file_path, {"cover_path": cover_path}, force=True)
    if lyrics_path:
        _update_entry_meta(artist, album, title_base, {"lyrics_path": lyrics_path}, force=True)
        _update_manifest(file_path, {"lyrics_path": lyrics_path}, force=True)
    _update_entry_meta(artist, album, title_base, {"matched": True}, force=True)
    _update_manifest(file_path, {"matched": True}, force=True)
    # 匹配源：每次匹配以最新结果为准（强制覆盖）
    if result.get("source"):
        _update_entry_meta(artist, album, title_base, {"match_source": result["source"]}, force=True)
        _update_manifest(file_path, {"match_source": result["source"]}, force=True)
    return True, None


def _write_artist_avatar(name, cover_data, cover_mime):
    """保存歌手写真到 data/artists_img/{name}/cover.{ext} 并更新 artists.json cover_url"""
    if not cover_data:
        return False
    safe = sanitize_artist_name(name) or "unknown"
    ext = COVER_EXT_MAP.get(cover_mime, ".jpg")
    dest_dir = os.path.join(ARTISTS_IMG_DIR, safe)
    try:
        os.makedirs(dest_dir, exist_ok=True)
        for f in os.listdir(dest_dir):
            try:
                os.remove(os.path.join(dest_dir, f))
            except Exception:
                pass
        with open(os.path.join(dest_dir, f"cover{ext}"), "wb") as f:
            f.write(cover_data)
    except Exception:
        return False
    artists = load_artists()
    rec = artists.get(name) or {}
    rec["cover_url"] = f"/data/artists_img/{safe}/cover{ext}"
    artists[name] = rec
    return save_artists(artists)


# ================================================================
# 全部匹配（后台线程 + 进度轮询）
# ================================================================

def _read_local_lyrics(file_path, entry=None):
    """读取歌曲本地歌词用于 credits 兜底：优先 data/Lyrics 备份，其次文件内嵌歌词"""
    entry = entry or {}
    lp = entry.get("lyrics_path")
    if lp:
        p = os.path.join(DATA_DIR, lp)
        if os.path.exists(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    return f.read()
            except Exception:
                pass
    abs_path = os.path.join(get_library_path(), file_path)
    if os.path.exists(abs_path):
        try:
            meta = parse_metadata(abs_path)
            return meta.get("lyrics") or None
        except Exception:
            pass
    return None


def _missing_credits(result, fields=None):
    """标记已启用且仍缺失的 credits 字段（仅作曲/作词/发布者），供 LRC 保底阶段使用"""
    def f(k):
        return bool((fields or {}).get(k, True))
    missing = set()
    if f("composer") and not result.get("composers"):
        missing.add("composer")
    if f("lyricist") and not result.get("lyricists"):
        missing.add("lyricist")
    if f("publisher") and not result.get("publisher"):
        missing.add("publisher")
    return missing


async def _match_all_async(matcher, songs, artist_list, config=None):
    """核心协程：阶段 A 联网匹配写回并标记缺 credits 的歌曲；
    阶段 B 对标记歌曲做本地 LRC 保底（正在补充剩余信息）；最后艺人写真"""
    config = config or {}
    async with aiohttp.ClientSession(timeout=matcher._timeout) as session:
        done = 0
        cancelled = False
        need_lrc = []  # [(file_path, entry, missing_fields)]

        # ============ 阶段 A：联网匹配 ============
        for file_path, entry in songs:
            if _match_state["cancel"]:
                cancelled = True
                _match_state["was_cancelled"] = True
                _log("skip", f"已取消匹配（已处理 {done}/{_match_state['total']}）")
                break
            _match_state["current"] = f"歌曲：{entry.get('title')} - {entry.get('artist')}"
            try:
                result = await matcher.get_song_metadata(
                    session, entry.get("title"), entry.get("artist"),
                    sources=config.get("sources"),
                    fields=config.get("fields"),
                    lyric_credits_fallback=False,  # 阶段 A 只联网，LRC 保底统一放阶段 B
                )
            except Exception as e:
                _match_state["failed"] += 1
                _log("error", f"歌曲 {entry.get('title')} - {entry.get('artist')}：{e}")
                done += 1
                _match_state["done"] = done
                continue

            if result.get("error"):
                # 若后续 LRC 保底会尝试补全，则暂不计 skip（成败由阶段 B 决定）
                will_lrc = bool(config.get("lyric_credits_fallback")) and bool(
                    _missing_credits(result, config.get("fields"))
                )
                if not will_lrc:
                    _match_state["skipped"] += 1
                    _log("skip", f"歌曲 {entry.get('title')} - {entry.get('artist')}：{result['error']}")
            else:
                cover_data, cover_mime = await matcher.download_image(session, result.get("cover_url"))
                ok, err = await asyncio.to_thread(
                    _write_song_metadata, file_path, entry, result, cover_data, cover_mime,
                    result.get("lyric"), config.get("fields"),
                )
                if ok:
                    composers = ", ".join(result.get("composers") or []) or "—"
                    lyricists = ", ".join(result.get("lyricists") or []) or "—"
                    extra = []
                    if result.get("arranger"):
                        extra.append(f"编曲 {result['arranger']}")
                    if result.get("producer"):
                        extra.append(f"制作人 {result['producer']}")
                    if result.get("year"):
                        extra.append(f"{result['year']}年")
                    if result.get("genre"):
                        extra.append(result["genre"])
                    if result.get("trackNo") is not None:
                        extra.append(f"音轨 {result['trackNo']}")
                    if result.get("discNo") is not None:
                        extra.append(f"碟 {result['discNo']}")
                    if result.get("cover_url") and cover_data:
                        extra.append("封面")
                    if result.get("lyric"):
                        extra.append("歌词")
                    source_label = SOURCE_LABELS.get(result.get("source")) or "未知"
                    _match_state["matched"] += 1
                    _log("ok", f"歌曲 {result.get('song_name') or entry.get('title')} 通过 {source_label} 匹配成功：作曲 {composers} / 作词 {lyricists}"
                         + (f"（{'，'.join(extra)}）" if extra else ""))
                else:
                    _match_state["failed"] += 1
                    _log("error", f"歌曲 {entry.get('title')}：{err or '写入失败'}")

            # 标记仍缺 作曲/作词/发布者 的歌曲 → 阶段 B 做本地 LRC 保底
            if bool(config.get("lyric_credits_fallback")):
                missing = _missing_credits(result, config.get("fields"))
                if missing:
                    need_lrc.append((file_path, entry, missing, bool(result.get("error"))))
            done += 1
            _match_state["done"] = done

        # ============ 阶段 B：本地 LRC 保底（正在补充剩余信息） ============
        if need_lrc and not cancelled:
            _match_state["total"] += len(need_lrc)
            for file_path, entry, missing, phase_a_errored in need_lrc:
                if _match_state["cancel"]:
                    cancelled = True
                    _match_state["was_cancelled"] = True
                    _log("skip", f"已取消匹配（已处理 {done}/{_match_state['total']}）")
                    break
                _match_state["current"] = f"正在补充剩余信息：{entry.get('title')} - {entry.get('artist')}"
                local = _read_local_lyrics(file_path, entry)
                credits = parse_lyric_credits(local) if local else {}
                patch = {}
                if "composer" in missing and credits.get("composer"):
                    patch["composers"] = [c.strip() for c in credits["composer"].split("/") if c.strip()]
                if "lyricist" in missing and credits.get("lyricist"):
                    patch["lyricists"] = [l.strip() for l in credits["lyricist"].split("/") if l.strip()]
                if "publisher" in missing and credits.get("publisher"):
                    pub = credits["publisher"]
                    if not pub.startswith("℗"):
                        year = entry.get("year")
                        if year:
                            pub = f"℗ {year} {pub}"
                    patch["publisher"] = pub
                if patch:
                    # 阶段 A 可能已写入部分字段，重载 manifest entry 只补真缺失项
                    fresh_entry = load_manifest().get(file_path) or entry
                    ok, err = await asyncio.to_thread(
                        _write_song_metadata, file_path, fresh_entry, patch, None, None, None,
                        config.get("fields"),
                    )
                    if ok:
                        filled_parts = []
                        if "composer" in missing and patch.get("composers"):
                            filled_parts.append("作曲")
                        if "lyricist" in missing and patch.get("lyricists"):
                            filled_parts.append("作词")
                        if "publisher" in missing and patch.get("publisher"):
                            filled_parts.append("发布者")
                        _match_state["matched"] += 1
                        _log("ok", f"歌曲 {entry.get('title')} LRC 保底补充：{'、'.join(filled_parts)}")
                    else:
                        _match_state["failed"] += 1
                        _log("error", f"歌曲 {entry.get('title')}：LRC 保底写入失败（{err or '无信息'}）")
                elif phase_a_errored:
                    # 联网阶段未命中且 LRC 也无可补信息 → 计为跳过
                    _match_state["skipped"] += 1
                    _log("skip", f"歌曲 {entry.get('title')}：联网与 LRC 保底均未找到信息")
                done += 1
                _match_state["done"] = done

        if not cancelled:
            for name in artist_list:
                if _match_state["cancel"]:
                    cancelled = True
                    _match_state["was_cancelled"] = True
                    _log("skip", f"已取消匹配（已处理 {done}/{_match_state['total']}）")
                    break
                _match_state["current"] = f"艺人：{name}"
                try:
                    info = await matcher.get_artist_avatar(session, name)
                except Exception as e:
                    _match_state["failed"] += 1
                    _log("error", f"艺人 {name}：{e}")
                    done += 1
                    _match_state["done"] = done
                    continue

                if info.get("avatar_url"):
                    data, mime = await matcher.download_image(session, info["avatar_url"])
                    ok = await asyncio.to_thread(_write_artist_avatar, name, data, mime)
                    if ok:
                        _match_state["matched"] += 1
                        _log("ok", f"艺人 {name} 通过 QQ音乐 匹配成功：写真已保存")
                    else:
                        _match_state["failed"] += 1
                        _log("error", f"艺人 {name}：写真保存失败")
                else:
                    _match_state["skipped"] += 1
                    _log("skip", f"艺人 {name}：未找到写真")
                done += 1
                _match_state["done"] = done

        _match_state["current"] = None


def _match_all_worker(matcher, songs, artist_list, config):
    try:
        _reset_state(len(songs) + len(artist_list))
        asyncio.run(_match_all_async(matcher, songs, artist_list, config))
    except Exception as e:
        _match_state["error"] = str(e)
        _log("error", f"全部匹配异常：{e}")
    finally:
        _match_state["running"] = False
        _match_state["cancel"] = False
        _match_state["current"] = None


@router.post("/all")
def match_all(payload: dict = Body(...)):
    """遍历资料库：为缺少信息的歌曲补全并写回，为缺少封面的艺人补写真。
    立即返回，前端通过 /api/match/all/progress 轮询。
    """
    if _match_state["running"]:
        return {"status": "error", "msg": "已有匹配任务进行中"}

    config = {
        "match_song": payload.get("match_song", True),
        "match_artist": payload.get("match_artist", True),
        "sources": payload.get("sources"),
        "fields": payload.get("fields"),
        "skip_matched": payload.get("skip_matched", True),
        "lyric_credits_fallback": bool(payload.get("lyric_credits_fallback")),
    }

    # 1. 收集需要匹配的歌曲
    manifest = load_manifest()
    songs = []
    for file_path, entry in manifest.items():
        title = entry.get("title")
        artist = entry.get("artist")
        if not title or not artist:
            continue
        if not config["match_song"]:
            continue
        # 跳过已匹配的音乐（开关开启时）
        if config["skip_matched"] and entry.get("matched"):
            continue
        songs.append((file_path, entry))

    # 2. 收集需要写真且无封面的艺人
    artist_list = []
    if config["match_artist"]:
        artists = set()
        for file_path, entry in manifest.items():
            for key in ("artist", "album_artist"):
                name = entry.get(key)
                if name:
                    artists.add(name)
        artist_records = load_artists()
        for name in sorted(artists):
            rec = artist_records.get(name) or {}
            if rec.get("cover_url"):
                continue
            artist_list.append(name)

    total = len(songs) + len(artist_list)
    if total == 0:
        return {"status": "done", "total": 0, "msg": "没有需要匹配的歌曲或艺人"}

    matcher = MusicMatcher()
    t = threading.Thread(
        target=_match_all_worker, args=(matcher, songs, artist_list, config), daemon=True
    )
    t.start()

    return {"status": "started", "total": total, "songs": len(songs), "artists": len(artist_list)}


@router.post("/all/cancel")
def match_all_cancel():
    """请求取消进行中的全部匹配（处理完当前项后停止）"""
    if not _match_state["running"]:
        return {"status": "error", "msg": "当前没有进行中的匹配任务"}
    _match_state["cancel"] = True
    return {"status": "cancelling"}


@router.get("/all/progress")
def match_all_progress():
    """返回全部匹配进度"""
    st = dict(_match_state)
    st["log"] = list(_match_state["log"])
    st["cancelled"] = _match_state.get("was_cancelled", False)
    if st["running"]:
        st["status"] = "matching"
    elif st["error"]:
        st["status"] = "error"
    else:
        st["status"] = "done"
    return st
