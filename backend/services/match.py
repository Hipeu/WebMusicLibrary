import asyncio
import logging
import os
import re
import time
import urllib.parse

import aiohttp
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)
from thefuzz import fuzz

logger = logging.getLogger("match")

# MusicBrainz 速率限制：每秒 1 次请求
MB_RATE_INTERVAL = 1.0
# QQ 请求限速（秒），避免高频请求被封
QQ_RATE_INTERVAL = 0.3
# 模糊匹配判定成功的相似度阈值
MATCH_THRESHOLD = 85
# 单首歌最多解析的 Work 数量（控制请求数）
MAX_MB_WORKS = 3

MB_BASE = "https://musicbrainz.org/ws/2"
# qq-music-api 本地服务（与 npm start 一并启动，默认端口 3200）
QQ_API_BASE = os.environ.get("QQ_MUSIC_API_BASE", "http://localhost:3200")
ITUNES_SEARCH = "https://itunes.apple.com/search"

# QQ CDN 高清图规则（已实测：T002 专辑封面带 _1 后缀；T001 歌手写真不带）
QQ_COVER_URL = "https://y.qq.com/music/photo_new/T002R500x500M000{albummid}_1.jpg"
QQ_AVATAR_URL = "https://y.qq.com/music/photo_new/T001R500x500M000{singermid}.jpg"


class RateLimitError(Exception):
    """用于触发 tenacity 重试的 429/503 信号"""


class PermanentError(Exception):
    """永久性 HTTP 错误（4xx 等），不应重试"""


# ================================================================
# 歌词词曲作者解析引擎
# ================================================================

_TS_PREFIX_RE = re.compile(r"^(\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+")
_LRC_TAG_RE = re.compile(r"^\[(?:ti|ar|al|by|offset|length|re|ve):[^\]]*\]", re.I)

# 一行内若后接其它标签（如 "作词：A 作曲：B"），截断到下一标签前
_LABEL_SPLIT_RE = re.compile(r"\s+(?:作词|作詞|作曲|编曲|編曲|制作人)\s*[:：]")


def _clean_credit_value(value):
    value = _LABEL_SPLIT_RE.split(value or "", maxsplit=1)[0]
    value = re.sub(r"\s+", " ", value).strip(" \t，,。；;、/")
    return value or None


def parse_lyric_credits(text):
    """从纯文本 / LRC 歌词中解析 作词 / 作曲 / 编曲 / 制作人 / 发布者。

    支持：
      - LRC 时间戳前缀 [mm:ss.xx] / [mm:ss]
      - 全称 作词/作曲/编曲/制作人 与繁体 作詞/編曲
      - 英文 Lyrics by / Composed by（作曲、作词；多名字以 / 分隔）
      - 简写 词/曲（仅头部区域，避免正文误匹配）
      - 合并标签 作词/作曲：周杰伦
      - 发布者：SP / OP / 版权 / 出品 / Published by（优先级 SP → OP → 版权 → 出品 → Published by）

    返回 {lyricist, composer, arranger, producer, publisher}
    """
    credits = {"lyricist": None, "composer": None, "arranger": None, "producer": None, "publisher": None}
    if not text:
        return credits

    full = [
        ("lyricist", re.compile(r"^(?:作词|作詞|Lyrics by)\s*[:：]\s*(.+)$", re.I)),
        ("composer", re.compile(r"^(?:作曲|Composed by)\s*[:：]\s*(.+)$", re.I)),
        ("arranger", re.compile(r"^(?:编曲|編曲)\s*[:：]\s*(.+)$")),
        ("producer", re.compile(r"^制作人\s*[:：]\s*(.+)$")),
    ]
    short = [
        ("lyricist", re.compile(r"^词\s*[:：]\s*(.+)$")),
        ("composer", re.compile(r"^曲\s*[:：]\s*(.+)$")),
    ]
    combined = re.compile(r"^(?:作词|作詞)/(?:作曲)\s*[:：]\s*(.+)$")
    combined_short = re.compile(r"^词/曲\s*[:：]\s*(.+)$")
    # 发布者：SP / OP / 版权 / 出品 / Published by，优先级 SP → OP → 版权 → 出品 → Published by
    publisher_patterns = [
        re.compile(r"^SP\s*[:：]\s*(.+)$", re.I),
        re.compile(r"^OP\s*[:：]\s*(.+)$", re.I),
        re.compile(r"^版权\s*[:：]\s*(.+)$"),
        re.compile(r"^出品\s*[:：]\s*(.+)$"),
        re.compile(r"^Published by\s*[:：]\s*(.+)$", re.I),
    ]

    found = set()
    content_lines = 0
    for raw in text.splitlines():
        line = _TS_PREFIX_RE.sub("", raw).strip()
        if _LRC_TAG_RE.match(line) or not line:
            continue
        content_lines += 1

        # 合并标签 作词/作曲：X
        m = combined.match(line)
        if m:
            v = _clean_credit_value(m.group(1))
            if v:
                credits["lyricist"] = v
                credits["composer"] = v
                found.update(("lyricist", "composer"))
            continue
        m = combined_short.match(line)
        if m and content_lines <= 8:
            v = _clean_credit_value(m.group(1))
            if v:
                credits["lyricist"] = v
                credits["composer"] = v
                found.update(("lyricist", "composer"))
            continue

        # 全称标签
        for key, pat in full:
            if key in found:
                continue
            m = pat.match(line)
            if m:
                v = _clean_credit_value(m.group(1))
                if v:
                    credits[key] = v
                    found.add(key)
                break
        else:
            # 简写 词/曲：仅头部区域
            if content_lines <= 8:
                for key, pat in short:
                    if key in found:
                        continue
                    m = pat.match(line)
                    if m:
                        v = _clean_credit_value(m.group(1))
                        if v:
                            credits[key] = v
                            found.add(key)
                        break

        if len(found) >= 4 or content_lines > 12:
            break

    # 独立扫描发布者（SP → OP → 版权 → 出品，命中即停）
    def _scan_publisher(pat):
        for raw in text.splitlines():
            line = _TS_PREFIX_RE.sub("", raw).strip()
            if not line:
                continue
            m = pat.match(line)
            if m:
                v = _clean_credit_value(m.group(1))
                if v:
                    return v
        return None

    for pat in publisher_patterns:
        credits["publisher"] = _scan_publisher(pat)
        if credits["publisher"]:
            break

    return credits


class MusicMatcher:
    def __init__(self, timeout=10, qq_api_base=None):
        # MusicBrainz 要求必须提供 User-Agent，否则会被封禁 IP
        self.mb_headers = {
            "User-Agent": "MusicMatchAgent/1.0 ( your-email@example.com )",
            "Accept": "application/json",
        }
        self.qq_api_base = (qq_api_base or QQ_API_BASE).rstrip("/")
        self._timeout = aiohttp.ClientTimeout(total=timeout)
        # MusicBrainz 限速：锁 + 上次请求时间
        self._mb_lock = asyncio.Lock()
        self._last_mb_req = 0.0
        # QQ 限速：锁 + 上次请求时间
        self._qq_lock = asyncio.Lock()
        self._last_qq_req = 0.0

    # ================================================================
    # 网络请求基础（含重试与限速）
    # ================================================================

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=6),
        retry=retry_if_exception_type(
            (RateLimitError, asyncio.TimeoutError, aiohttp.ClientConnectionError)
        ),
        reraise=True,
    )
    async def _fetch_json(self, session, url, headers=None, params=None):
        """发起 GET 请求并解析 JSON；超时 / 连接错误 / 429 / 5xx 自动重试"""
        async with session.get(url, headers=headers, params=params) as resp:
            if resp.status in (429, 503):
                raise RateLimitError(f"Too Many Requests: {url}")
            if resp.status >= 500:
                raise aiohttp.ClientConnectionError(f"Server error {resp.status}: {url}")
            if resp.status >= 400:
                raise PermanentError(f"HTTP {resp.status}: {url}")
            try:
                return await resp.json(content_type=None)
            except Exception as e:
                raise aiohttp.ClientError(f"JSON 解析失败: {url}: {e}")

    async def _api_get(self, session, url, params=None):
        return await self._fetch_json(session, url, params=params)

    async def _qq_get(self, session, path, params=None):
        """QQ 请求：带限速（避免高频被封）"""
        url = f"{self.qq_api_base}/{path}"
        async with self._qq_lock:
            now = time.monotonic()
            wait = self._last_qq_req + QQ_RATE_INTERVAL - now
            if wait > 0:
                await asyncio.sleep(wait)
            try:
                return await self._api_get(session, url, params=params)
            finally:
                self._last_qq_req = time.monotonic()

    async def _mb_get(self, session, path, params=None):
        """MusicBrainz 请求：保证两次请求间隔 >= 1 秒"""
        params = dict(params or {})
        params.setdefault("fmt", "json")
        async with self._mb_lock:
            now = time.monotonic()
            wait = self._last_mb_req + MB_RATE_INTERVAL - now
            if wait > 0:
                await asyncio.sleep(wait)
            url = f"{MB_BASE}/{path}"
            try:
                return await self._fetch_json(
                    session, url, headers=self.mb_headers, params=params
                )
            finally:
                self._last_mb_req = time.monotonic()

    # ================================================================
    # 模糊匹配
    # ================================================================

    @staticmethod
    def _pick_best(items, song_name, artist_name, title_key="title", artist_key="artist"):
        """对候选列表做相似度打分，返回 (item, score) 或 (None, best_score)。

        - 歌名：token_set_ratio + partial_ratio 取高者
        - 艺人：partial_ratio
        - 综合：歌名权重 0.6 + 艺人 0.4；score >= 85 判定匹配成功
        """
        best, best_score = None, 0.0
        for it in items or []:
            title = it.get(title_key) or ""
            title_score = max(
                fuzz.token_set_ratio(title, song_name),
                fuzz.partial_ratio(title, song_name),
            )
            artist = it.get(artist_key) or ""
            artist_score = fuzz.partial_ratio(artist, artist_name)
            score = title_score * 0.6 + artist_score * 0.4
            if score > best_score:
                best, best_score = it, score
        if best_score >= MATCH_THRESHOLD:
            return best, best_score
        return None, best_score

    @staticmethod
    def _credit_name(recording):
        credit = recording.get("artist-credit") or []
        return credit[0].get("name", "未知") if credit else "未知"

    @staticmethod
    def _itunes_cover_url(url):
        """iTunes artworkUrl100 → 放大到 500x500"""
        if not url:
            return None
        return url.replace("100x100bb", "500x500bb")

    # ================================================================
    # QQ 音乐（qq-music-api 本地服务）
    # ================================================================

    async def qq_search(self, session, keyword, limit=10):
        """搜索歌曲，返回标准化候选列表（含音轨号/碟号/年份）"""
        data = await self._qq_get(
            session, "getSearchByKey", params={"key": keyword, "limit": limit, "page": 1}
        )
        response = data.get("response") if isinstance(data, dict) else data
        if isinstance(response, str):
            return []
        song = (response.get("data") or {}).get("song") or {}
        items = []
        for it in song.get("list") or []:
            singers = it.get("singer") or [{}]
            year = None
            pubtime = it.get("pubtime")
            if pubtime:
                try:
                    year = str(time.strftime("%Y", time.localtime(int(pubtime))))
                except Exception:
                    year = None
            belong_cd = it.get("belongCD")
            # belongCD 为 0 或无 → 一律回退第 0 碟（Disc 1）
            try:
                disc_no = int(belong_cd) + 1 if belong_cd is not None and str(belong_cd).strip() != "" else 1
            except Exception:
                disc_no = 1
            items.append({
                "title": it.get("songname"),
                "artist": singers[0].get("name"),
                "album": it.get("albumname"),
                "albummid": it.get("albummid"),
                "songmid": it.get("songmid"),
                "singermid": singers[0].get("mid"),
                "trackNo": it.get("cdIdx") or None,
                "discNo": disc_no,
                "year": year,
            })
        return items

    async def qq_lyric(self, session, songmid):
        """获取歌词纯文本（base64 已由服务端解码，可能为 LRC 格式）"""
        data = await self._qq_get(session, "getLyric", params={"songmid": songmid})
        response = data.get("response") if isinstance(data, dict) else data
        if isinstance(response, str):
            return None
        return response.get("lyric")

    async def qq_album_info(self, session, albummid):
        """获取专辑信息：专辑艺人 singername / 流派 genre / 年份 aDate"""
        if not albummid:
            return None
        try:
            data = await self._qq_get(session, "getAlbumInfo", params={"albummid": albummid})
        except Exception as e:
            logger.warning("QQ 专辑信息失败 %s: %s", albummid, e)
            return None
        response = data.get("response") if isinstance(data, dict) else data
        if isinstance(response, str):
            return None
        adata = (response.get("data") or {}) if isinstance(response, dict) else {}
        if not isinstance(adata, dict):
            return None
        year = None
        a_date = adata.get("aDate")
        if a_date:
            m = re.match(r"(\d{4})", str(a_date))
            if m:
                year = m.group(1)
        return {
            "album_artist": adata.get("singername"),
            "genre": adata.get("genre"),
            "year": year,
            "name": adata.get("name"),
        }

    async def itunes_search(self, session, song_name, artist_name):
        """iTunes 兜底搜索，返回标准化候选列表（含年代/流派/封面）"""
        term = f"{song_name} {artist_name}".strip()
        data = await self._api_get(
            session, ITUNES_SEARCH,
            params={"term": term, "entity": "song", "limit": "25"},
        )
        items = []
        for r in data.get("results") or []:
            items.append({
                "title": r.get("trackName"),
                "artist": r.get("artistName"),
                "album": r.get("collectionName"),
                "album_artist": r.get("collectionArtistName") or r.get("artistName"),
                "year": (r.get("releaseDate") or "")[:4],
                "genre": r.get("primaryGenreName"),
                "cover_url": self._itunes_cover_url(r.get("artworkUrl100")),
            })
        return items

    async def download_image(self, session, url):
        """下载图片，返回 (bytes, mime)"""
        if not url:
            return None, None
        try:
            async with session.get(url, timeout=self._timeout) as resp:
                if resp.status != 200:
                    logger.warning("图片下载失败 %s: HTTP %s", url, resp.status)
                    return None, None
                mime = resp.headers.get("Content-Type", "image/jpeg")
                return await resp.read(), mime
        except Exception as e:
            logger.warning("图片下载失败 %s: %s", url, e)
            return None, None

    # ================================================================
    # MusicBrainz 作曲 / 作词（Work 节点解析）
    # ================================================================

    async def musicbrainz_credits(self, session, song_name, artist_name):
        """从 MusicBrainz 抓取作曲 / 作词（外文曲目效果好），失败返回 {"error": ...}"""
        try:
            def norm(recordings):
                return [
                    {"title": r.get("title"), "artist": self._credit_name(r), "_rec": r}
                    for r in recordings or []
                ]

            best = None
            # 1. 歌名 + 艺人 精确组合
            query = f'recording:"{song_name}" AND artist:"{artist_name}"'
            data = await self._mb_get(
                session, "recording",
                params={"query": query, "inc": "artist-credits+releases+work-rels", "limit": "25"},
            )
            best = self._pick_best(norm(data.get("recordings")), song_name, artist_name)[0]

            # 2. 仅按歌名宽泛搜索
            if best is None:
                loose = await self._mb_get(
                    session, "recording",
                    params={"query": f'"{song_name}"', "inc": "artist-credits+releases", "limit": "25"},
                )
                best = self._pick_best(norm(loose.get("recordings")), song_name, artist_name)[0]

            # 3. 仅按艺人搜索
            if best is None:
                by_artist = await self._mb_get(
                    session, "recording",
                    params={"query": f'artist:"{artist_name}"', "inc": "artist-credits+releases", "limit": "25"},
                )
                best = self._pick_best(norm(by_artist.get("recordings")), song_name, artist_name)[0]

            if best is None:
                return {"error": "not found"}

            recording = best["_rec"]
            recording_id = recording["id"]

            # 提取关联 Work
            work_ids = [
                rel["work"]["id"]
                for rel in (recording.get("relations") or [])
                if rel.get("target-type") == "work" and rel.get("work", {}).get("id")
            ]
            if not work_ids:
                rel_data = await self._mb_get(
                    session, f"recording/{recording_id}", params={"inc": "work-rels"}
                )
                work_ids = [
                    rel["work"]["id"]
                    for rel in (rel_data.get("relations") or [])
                    if rel.get("target-type") == "work" and rel.get("work", {}).get("id")
                ]

            composers, lyricists = [], []
            for work_id in work_ids[:MAX_MB_WORKS]:
                try:
                    wdata = await self._mb_get(
                        session, f"work/{work_id}", params={"inc": "artist-rels"}
                    )
                except Exception as e:
                    logger.warning("Work 请求失败 %s: %s", work_id, e)
                    continue
                for rel in wdata.get("relations") or []:
                    if rel.get("target-type") != "artist":
                        continue
                    name = (rel.get("artist") or {}).get("name")
                    if not name:
                        continue
                    rtype = rel.get("type", "")
                    if rtype == "composer" and name not in composers:
                        composers.append(name)
                    elif rtype == "lyricist" and name not in lyricists:
                        lyricists.append(name)

            return {
                "composers": composers,
                "lyricists": lyricists,
                "song_name": recording.get("title"),
                "artist": self._credit_name(recording),
            }
        except (RateLimitError, PermanentError, aiohttp.ClientError, asyncio.TimeoutError) as e:
            logger.warning("MusicBrainz 匹配失败 %s - %s: %s", song_name, artist_name, e)
            return {"error": str(e)}

    # ================================================================
    # 主入口：合并 QQ / iTunes / MusicBrainz 匹配结果
    # ================================================================

    async def get_song_metadata(self, session, song_name, artist_name, sources=None, fields=None, lyric_credits_fallback=False, local_lyrics=None):
        """按 歌名+艺人 匹配：QQ音乐（主）→ iTunes（兜底）→ MusicBrainz（作曲/作词）。

        - sources: {qq, itunes, musicbrainz} 布尔，控制调用哪些源
        - fields:  各元信息字段开关，控制收集哪些字段（封面/写真始终收集）
        - lyric_credits_fallback: 其它源未匹配到 作曲/作词/编曲/制作人/发布者 时，用歌词兜底
        - local_lyrics: 歌曲本地歌词（data/Lyrics 备份或内嵌），QQ 歌词不可用时用于 credits 兜底
        """
        logger.info("正在匹配歌曲: %s - %s", song_name, artist_name)

        all_fields = {"title", "artist", "album", "year", "track_disc", "genre",
                      "album_artist", "composer", "lyricist", "lyric",
                      "publisher", "arranger", "producer"}
        all_sources = {"qq", "itunes", "musicbrainz"}
        fields = fields or {k: True for k in all_fields}
        sources = sources or {k: True for k in all_sources}

        def _f(k):
            return bool(fields.get(k, True))

        def _s(k):
            return bool(sources.get(k, True))

        result = {
            "song_name": song_name,
            "artist": artist_name,
            "album": None,
            "album_artist": None,
            "year": None,
            "genre": None,
            "trackNo": None,
            "discNo": None,
            "lyric": None,
            "publisher": None,
            "cover_url": None,
            "avatar_url": None,
            "composers": [],
            "lyricists": [],
            "arranger": None,
            "producer": None,
            "source": None,
        }

        # 1. QQ 音乐主搜索
        qq_item = None
        lyric_text = None
        if _s("qq"):
            try:
                candidates = await self.qq_search(session, f"{song_name} {artist_name}")
                qq_item = self._pick_best(candidates, song_name, artist_name)[0]
            except Exception as e:
                logger.warning("QQ 搜索失败 %s - %s: %s", song_name, artist_name, e)

        # 2. iTunes 兜底搜索（同时用于补年代/流派）
        itunes_item = None
        if _s("itunes"):
            try:
                it_results = await self.itunes_search(session, song_name, artist_name)
                itunes_item = self._pick_best(it_results, song_name, artist_name)[0]
            except Exception as e:
                logger.warning("iTunes 搜索失败 %s - %s: %s", song_name, artist_name, e)

        if qq_item:
            result.update(
                song_name=qq_item.get("title") or song_name if _f("title") else song_name,
                artist=qq_item.get("artist") or artist_name if _f("artist") else artist_name,
                album=qq_item.get("album") if _f("album") else None,
                album_artist=qq_item.get("artist") if _f("album_artist") else None,
                trackNo=qq_item.get("trackNo") if _f("track_disc") else None,
                discNo=qq_item.get("discNo") if _f("track_disc") else None,
                year=qq_item.get("year") if _f("year") else None,
                cover_url=QQ_COVER_URL.format(albummid=qq_item["albummid"]) if qq_item.get("albummid") else None,
                avatar_url=QQ_AVATAR_URL.format(singermid=qq_item["singermid"]) if qq_item.get("singermid") else None,
                source="qq",
            )
            # 歌词全文（字段启用 或 需要歌词兜底时拉取）
            if qq_item.get("songmid") and (_f("lyric") or lyric_credits_fallback):
                try:
                    lyric_text = await self.qq_lyric(session, qq_item["songmid"])
                    if _f("lyric"):
                        result["lyric"] = lyric_text or None
                except Exception as e:
                    logger.warning("QQ 歌词失败 %s: %s", qq_item["songmid"], e)
            # 专辑信息：专辑艺人 / 流派 / 年份（任一启用才请求）
            if _f("album_artist") or _f("genre") or _f("year"):
                album_info = await self.qq_album_info(session, qq_item.get("albummid"))
                if album_info:
                    if _f("album_artist") and not result["album_artist"]:
                        result["album_artist"] = album_info.get("album_artist")
                    if _f("genre") and not result["genre"]:
                        result["genre"] = album_info.get("genre")
                    if _f("year") and not result["year"]:
                        result["year"] = album_info.get("year")

        if itunes_item and not qq_item:
            result.update(
                song_name=itunes_item.get("title") or song_name if _f("title") else song_name,
                artist=itunes_item.get("artist") or artist_name if _f("artist") else artist_name,
                album=itunes_item.get("album") if _f("album") else None,
                album_artist=itunes_item.get("album_artist") if _f("album_artist") else None,
                year=itunes_item.get("year") if _f("year") else None,
                genre=itunes_item.get("genre") if _f("genre") else None,
                cover_url=itunes_item.get("cover_url"),
                source="itunes",
            )
        elif itunes_item and qq_item:
            # QQ 已命中：用 iTunes 补年代/流派/封面兜底
            if _f("year") and not result["year"]:
                result["year"] = itunes_item.get("year")
            if _f("genre") and not result["genre"]:
                result["genre"] = itunes_item.get("genre")
            if not result["cover_url"]:
                result["cover_url"] = itunes_item.get("cover_url")

        if qq_item is None and itunes_item is None:
            # 仍有 MusicBrainz 信用路径或 LRC 保底可补 作曲/作词/发布者 时，不提前报错
            has_mb_credits = _s("musicbrainz") and (_f("composer") or _f("lyricist"))
            has_lrc_credits = (
                lyric_credits_fallback
                and (_f("composer") or _f("lyricist") or _f("publisher"))
                and bool(local_lyrics or lyric_text)
            )
            if not has_mb_credits and not has_lrc_credits:
                result["error"] = f"在 QQ音乐 / iTunes 中未找到该歌曲（{song_name} - {artist_name}）"
                return result

        # 3. MusicBrainz 兜底作曲 / 作词
        if _s("musicbrainz") and (_f("composer") or _f("lyricist")):
            mb = await self.musicbrainz_credits(session, song_name, artist_name)
            if _f("composer"):
                for c in mb.get("composers") or []:
                    if c and c not in result["composers"]:
                        result["composers"].append(c)
            if _f("lyricist"):
                for l in mb.get("lyricists") or []:
                    if l and l not in result["lyricists"]:
                        result["lyricists"].append(l)

        # 本地歌词兜底：QQ 歌词不可用时用歌曲自身 LRC（data/Lyrics 备份或内嵌），仅用于 credits 提取
        if not lyric_text and local_lyrics:
            lyric_text = local_lyrics

        # 4. 歌词兜底：其它源未匹配到 作曲/作词/发布者 时尝试（仅补这三项）
        if lyric_credits_fallback and lyric_text:
            credits = parse_lyric_credits(lyric_text)
            if _f("composer") and not result["composers"] and credits["composer"]:
                result["composers"] = [c.strip() for c in credits["composer"].split("/") if c.strip()]
            if _f("lyricist") and not result["lyricists"] and credits["lyricist"]:
                result["lyricists"] = [l.strip() for l in credits["lyricist"].split("/") if l.strip()]
            if _f("publisher") and not result["publisher"] and credits["publisher"]:
                pub = credits["publisher"]
                # 匹配到发布者时随匹配结果直接携带 ℗ 年份（编辑预填属单独功能，不干预）
                if result.get("year") and not pub.startswith("℗"):
                    pub = f"℗ {result['year']} {pub}"
                result["publisher"] = pub

        if not result.get("source") and qq_item is None and itunes_item is None:
            result["source"] = "musicbrainz"
        return result

    async def match_lyric(self, session, song_name, artist_name, sources=None):
        """在线歌词多源匹配：返回 [{source, source_label, song_name, artist, album, lyric}]"""
        results = []
        if sources is None or sources.get("qq", True):
            try:
                candidates = await self.qq_search(session, f"{song_name} {artist_name}")
                best = self._pick_best(candidates, song_name, artist_name)[0]
                if best and best.get("songmid"):
                    lyric = await self.qq_lyric(session, best["songmid"])
                    if lyric:
                        results.append({
                            "source": "qq",
                            "source_label": "QQ音乐",
                            "song_name": best.get("title"),
                            "artist": best.get("artist"),
                            "album": best.get("album"),
                            "lyric": lyric,
                        })
            except Exception as e:
                logger.warning("在线歌词失败 %s - %s: %s", song_name, artist_name, e)
        return results

    # ================================================================
    # 艺人写真（简介后续再接 QQ 音乐 wiki）
    # ================================================================

    async def get_artist_avatar(self, session, artist_name):
        """通过 QQ 搜索歌手，返回 500x500 写真 URL（singermid 规则）"""
        try:
            candidates = await self.qq_search(session, artist_name)
            best = self._pick_best(
                candidates, artist_name, artist_name, title_key="artist", artist_key="artist"
            )[0]
            if best and best.get("singermid"):
                return {
                    "singermid": best["singermid"],
                    "avatar_url": QQ_AVATAR_URL.format(singermid=best["singermid"]),
                }
        except Exception as e:
            logger.warning("QQ 歌手写真失败 %s: %s", artist_name, e)
        return {"singermid": None, "avatar_url": None}

    # ================================================================
    # 独立会话便捷入口
    # ================================================================

    async def match_song(self, song_name, artist_name, sources=None, fields=None, lyric_credits_fallback=False, local_lyrics=None):
        async with aiohttp.ClientSession(timeout=self._timeout) as session:
            return await self.get_song_metadata(
                session, song_name, artist_name,
                sources=sources, fields=fields,
                lyric_credits_fallback=lyric_credits_fallback,
                local_lyrics=local_lyrics,
            )

    async def match_lyric_standalone(self, song_name, artist_name, sources=None):
        async with aiohttp.ClientSession(timeout=self._timeout) as session:
            return await self.match_lyric(session, song_name, artist_name, sources=sources)

    async def match_artist(self, artist_name):
        async with aiohttp.ClientSession(timeout=self._timeout) as session:
            return await self.get_artist_avatar(session, artist_name)
