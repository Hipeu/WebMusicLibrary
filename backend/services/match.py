import asyncio
import html
import json
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
# 匹配速率档位：快速=各源最高速率（0 不额外等待）/ 标准=1.5s / 低速=3s
RATE_WAIT = {"fast": 0, "normal": 1.5, "slow": 3.0}
# 模糊匹配判定成功的相似度阈值
MATCH_THRESHOLD = 85
# 单首歌最多解析的 Work 数量（控制请求数）
MAX_MB_WORKS = 3

MB_BASE = "https://musicbrainz.org/ws/2"
# qq-music-api 本地服务（与 npm start 一并启动，默认端口 3200）
QQ_API_BASE = os.environ.get("QQ_MUSIC_API_BASE", "http://localhost:3200")
# 网易云音乐 api-enhanced 本地服务（默认端口 3000）
NCM_API_BASE = os.environ.get("NCM_MUSIC_API_BASE", "http://localhost:3000")
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


def _clean_desc(text):
    """清理艺人/专辑简介：反转义 HTML 实体，行内换行折叠为空格，保留段落空行。"""
    if not text:
        return None
    text = html.unescape(str(text))
    text = re.sub(r"\r\n|\r|\f\v", "\n", text)
    # 行内换行（单个 \n，前后都不是换行）替换为空格
    text = re.sub(r"(?<!\n)\n(?!\n)", " ", text)
    # 合并连续空行为单个段落空行
    text = re.sub(r"\n{2,}", "\n\n", text)
    # 折叠多余空格
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" ?\n ?", "\n", text)
    text = text.strip()
    return text or None


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
    def __init__(self, timeout=10, qq_api_base=None, ncm_api_base=None, rate="normal"):
        # MusicBrainz 要求必须提供 User-Agent，否则会被封禁 IP
        self.mb_headers = {
            "User-Agent": "MusicMatchAgent/1.0 ( your-email@example.com )",
            "Accept": "application/json",
        }
        self.qq_api_base = (qq_api_base or QQ_API_BASE).rstrip("/")
        self.ncm_api_base = (ncm_api_base or NCM_API_BASE).rstrip("/")
        self._timeout = aiohttp.ClientTimeout(total=timeout)
        # 匹配速率控制：快速=各源最高速率（不额外等待）/ 标准=1.5s / 低速=3s
        self.rate_wait = RATE_WAIT.get(rate, RATE_WAIT["normal"])
        self._rate_lock = asyncio.Lock()
        self._last_rate_req = 0.0
        # MusicBrainz 限速：锁 + 上次请求时间
        self._mb_lock = asyncio.Lock()
        self._last_mb_req = 0.0
        # QQ 限速：锁 + 上次请求时间
        self._qq_lock = asyncio.Lock()
        self._last_qq_req = 0.0

    # ================================================================
    # 网络请求基础（含重试与限速）
    # ================================================================

    async def _rate_limit(self):
        """匹配速率控制：标准/低速时统一限制各源请求间隔；快速不额外等待"""
        if self.rate_wait <= 0:
            return
        async with self._rate_lock:
            now = time.monotonic()
            wait = self._last_rate_req + self.rate_wait - now
            if wait > 0:
                await asyncio.sleep(wait)
            self._last_rate_req = time.monotonic()

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
        await self._rate_limit()
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

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=6),
        retry=retry_if_exception_type((RateLimitError, asyncio.TimeoutError, aiohttp.ClientConnectionError)),
        reraise=True,
    )
    async def _fetch_text(self, session, url, headers=None, params=None):
        """发起 GET 请求并返回原始文本，用于 QQ XML 简介接口。"""
        await self._rate_limit()
        async with session.get(url, headers=headers, params=params) as resp:
            if resp.status in (429, 503):
                raise RateLimitError(f"Too Many Requests: {url}")
            if resp.status >= 500:
                raise aiohttp.ClientConnectionError(f"Server error {resp.status}: {url}")
            if resp.status >= 400:
                raise PermanentError(f"HTTP {resp.status}: {url}")
            return await resp.text()

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

    async def _qq_get_text(self, session, path, params=None):
        """QQ 原始文本请求，保留 XML 内容不经过 JSON 解析。"""
        url = f"{self.qq_api_base}/{path}"
        async with self._qq_lock:
            now = time.monotonic()
            wait = self._last_qq_req + QQ_RATE_INTERVAL - now
            if wait > 0:
                await asyncio.sleep(wait)
            try:
                return await self._fetch_text(session, url, params=params)
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

    async def qq_search_artists(self, session, artist_name, limit=10):
        """QQ 艺人直达搜索，返回 singermid、名称和头像。"""
        data = await self._qq_get(
            session,
            "getSearchByKey",
            params={"key": artist_name, "catZhida": 2, "limit": limit, "page": 1},
        )
        response = data.get("response") if isinstance(data, dict) else data
        zhida = ((response or {}).get("data") or {}).get("zhida") or {}
        items = []
        direct = zhida.get("zhida_singer") or {}
        if direct.get("singerMID"):
            items.append({
                "name": direct.get("singerName") or artist_name,
                "singermid": direct.get("singerMID"),
                "avatar_url": QQ_AVATAR_URL.format(singermid=direct["singerMID"]),
            })
        for item in ((zhida.get("singer") or {}).get("item") or []):
            mid = item.get("mid")
            if mid:
                items.append({
                    "name": item.get("name"),
                    "singermid": mid,
                    "avatar_url": QQ_AVATAR_URL.format(singermid=mid),
                })
        unique = {}
        for item in items:
            unique[item["singermid"]] = item
        return list(unique.values())

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
            "description": adata.get("desc") or adata.get("albumdesc"),
        }

    async def qq_singer_desc(self, session, singermid):
        """获取 QQ 歌手简介；该接口返回 XML 包装，只提取 <desc> 内容，避免把错误码当正文。"""
        if not singermid:
            return None
        try:
            response = await self._qq_get_text(session, "getSingerDesc", params={"singermid": singermid})
            if not response:
                return None
            # 代理返回 {"response":"<xml>"} 的 JSON 文本，先解析出 XML 原文，
            # 否则 desc 里的换行会以字面 \n（反斜杠+n）残留。
            try:
                payload = json.loads(response)
                if isinstance(payload, dict) and isinstance(payload.get("response"), str):
                    response = payload["response"]
            except Exception:
                pass
            match = re.search(r"<desc[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</desc>", response, re.S)
            if not match:
                return None
            return _clean_desc(match.group(1))
        except Exception as e:
            logger.warning("QQ 歌手简介失败 %s: %s", singermid, e)
            return None

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

    async def qq_search_album(self, session, keyword, limit=30):
        """QQ 专辑候选：歌曲搜索 → 按专辑分组推导（QQ 无独立专辑接口返回，此方式 best-effort）"""
        data = await self._qq_get(session, "getSearchByKey", {"key": keyword, "limit": limit, "page": 1})
        response = data.get("response") if isinstance(data, dict) else data
        if isinstance(response, str):
            return []
        song = (response.get("data") or {}).get("song") or {}
        albums = {}
        for it in song.get("list") or []:
            albumname = it.get("albumname")
            albummid = it.get("albummid")
            if not albumname or not albummid:
                continue
            singers = it.get("singer") or []
            singer_names = ", ".join(s.get("name") for s in singers if s.get("name"))
            year = None
            pub = it.get("pubtime")
            if pub:
                try:
                    year = str(time.strftime("%Y", time.localtime(int(pub))))
                except Exception:
                    year = None
            if albummid not in albums:
                albums[albummid] = {
                    "album": albumname,
                    "album_artist": singer_names,
                    "albummid": albummid,
                    "year": year,
                    "genre": None,
                    "cover_url": QQ_COVER_URL.format(albummid=albummid) if albummid else None,
                }
        return list(albums.values())

    # ================================================================
    # 网易云音乐（api-enhanced 本地服务）
    # ================================================================

    async def _ncm_get(self, session, path, params=None):
        """GET 请求网易云本地服务"""
        url = f"{self.ncm_api_base}/{path}"
        return await self._api_get(session, url, params=params)

    async def ncm_search(self, session, song_name, artist_name, limit=10):
        """网易云搜索，返回标准化候选列表（ar/al 短字段）"""
        data = await self._ncm_get(
            session, "cloudsearch",
            {"keywords": f"{song_name} {artist_name}", "type": 1, "limit": limit},
        )
        songs = ((data.get("result") or {}).get("songs")) or []
        items = []
        for it in songs:
            ar = it.get("ar") or []
            al = it.get("al") or {}
            year = None
            pub = it.get("publishTime")
            if pub:
                try:
                    year = str(time.strftime("%Y", time.localtime(int(pub) / 1000)))
                except Exception:
                    year = None
            pic = al.get("picUrl")
            cover = f"{pic}?param=500y500" if pic else None
            items.append({
                "title": it.get("name"),
                "artist": ar[0].get("name") if ar else None,
                "album": al.get("name"),
                "album_artist": ar[0].get("name") if ar else None,
                "year": year,
                "cover_url": cover,
                "ncm_id": it.get("id"),
            })
        return items

    async def ncm_lyric(self, session, ncm_id):
        """网易云歌词纯文本（LRC 格式）"""
        data = await self._ncm_get(session, "lyric", {"id": ncm_id})
        return (data.get("lrc") or {}).get("lyric")

    async def ncm_song_creators(self, session, ncm_id):
        """网易云歌曲创作者：作曲/作词/编曲/制作人（songCreatorsRoleVos）"""
        data = await self._ncm_get(session, "song/creators", {"id": ncm_id})
        vos = ((data.get("data") or {}).get("songCreatorsRoleVos")) or []
        out = {"composers": [], "lyricists": [], "arranger": None, "producer": None}
        role_map = {"作曲": "composers", "作词": "lyricists", "编曲": "arranger", "制作人": "producer"}
        for v in vos:
            key = role_map.get(v.get("roleName"))
            if not key:
                continue
            names = [c.get("artistName") for c in (v.get("creatorMetaVOS") or []) if c.get("artistName")]
            if key in ("composers", "lyricists"):
                for n in names:
                    if n and n not in out[key]:
                        out[key].append(n)
            else:
                out[key] = ", ".join(names) if names else None
        return out

    async def ncm_artist_desc(self, session, artist_id):
        """获取网易云歌手介绍。"""
        if not artist_id:
            return None
        try:
            data = await self._ncm_get(session, "artist/desc", {"id": artist_id})
            candidates = [
                data.get("briefDesc"),
                data.get("desc"),
                "\n".join(item.get("txt", "") for item in (data.get("introduction") or []) if item.get("txt")),
                (data.get("data") or {}).get("briefDesc") if isinstance(data.get("data"), dict) else None,
                (data.get("data") or {}).get("desc") if isinstance(data.get("data"), dict) else None,
            ]
            for value in candidates:
                cleaned = _clean_desc(value)
                if cleaned:
                    return cleaned
            return None
        except Exception as e:
            logger.warning("网易云艺人简介失败 %s: %s", artist_id, e)
            return None

    async def ncm_album_description(self, session, album_id):
        """获取网易云专辑简介。"""
        if not album_id:
            return None
        try:
            data = await self._ncm_get(session, "album", {"id": album_id})
            album = data.get("album") or (data.get("data") or {}).get("album") or data.get("data") or {}
            if isinstance(album, dict):
                return album.get("description") or album.get("briefDesc")
        except Exception as e:
            logger.warning("网易云专辑简介失败 %s: %s", album_id, e)
        return None

    async def ncm_search_artists(self, session, artist_name, limit=10):
        """网易云艺人搜索。"""
        data = await self._ncm_get(session, "cloudsearch", {
            "keywords": artist_name, "type": 100, "limit": limit, "offset": 0,
        })
        artists = ((data.get("result") or {}).get("artists")) or []
        def _hd(url):
            if not url:
                return None
            return f"{url}?param=500y500" if "param=" not in url else url
        return [{
            "name": item.get("name"),
            "artist_id": item.get("id"),
            "avatar_url": _hd(item.get("picUrl") or item.get("img1v1Url")),
            "aliases": item.get("alias") or item.get("alia") or [],
        } for item in artists if item.get("id")]

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

    async def get_song_metadata(self, session, song_name, artist_name, sources=None, fields=None, lyric_credits_fallback=False, local_lyrics=None, album_cache=None):
        """按 歌名+艺人 匹配：QQ音乐（主）→ 网易云 → iTunes（兜底）→ MusicBrainz（作曲/作词）。

        - sources: {qq, netease, itunes, musicbrainz} 布尔，控制调用哪些源
        - fields:  各元信息字段开关，控制收集哪些字段（封面/写真始终收集）
        - lyric_credits_fallback: 其它源未匹配到 作曲/作词/编曲/制作人/发布者 时，用歌词兜底
        - local_lyrics: 歌曲本地歌词（data/Lyrics 备份或内嵌），QQ 歌词不可用时用于 credits 兜底
        """
        logger.info("正在匹配歌曲: %s - %s", song_name, artist_name)

        all_fields = {"title", "artist", "album", "year", "track_disc", "genre",
                      "album_artist", "composer", "lyricist", "lyric",
                      "publisher", "arranger", "producer"}
        all_sources = {"qq", "netease", "itunes", "musicbrainz"}
        fields = fields or {k: True for k in all_fields}
        sources = sources or {k: True for k in all_sources}
        album_cache = album_cache if album_cache is not None else {}

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
            "description": None,
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

        # 1. 按设置并行搜索启用的源；源之间没有依赖，不再串行等待。
        search_jobs = []
        if _s("qq"):
            search_jobs.append(("qq", self.qq_search(session, f"{song_name} {artist_name}")))
        if _s("netease"):
            search_jobs.append(("netease", self.ncm_search(session, song_name, artist_name)))
        if _s("itunes"):
            search_jobs.append(("itunes", self.itunes_search(session, song_name, artist_name)))

        search_results = await asyncio.gather(
            *(job for _, job in search_jobs), return_exceptions=True
        )
        qq_item = None
        ncm_item = None
        itunes_item = None
        for (source, _), candidates in zip(search_jobs, search_results):
            if isinstance(candidates, Exception):
                logger.warning("%s 搜索失败 %s - %s: %s", source, song_name, artist_name, candidates)
                continue
            best = self._pick_best(candidates, song_name, artist_name)[0]
            if source == "qq":
                qq_item = best
            elif source == "netease":
                ncm_item = best
            else:
                itunes_item = best

        lyric_text = None

        # 2. 命中后的歌词、专辑信息和创作者并行请求；简介不在单曲匹配阶段处理。
        detail_jobs = []
        if qq_item:
            if qq_item.get("songmid") and (_f("lyric") or lyric_credits_fallback):
                detail_jobs.append(("qq_lyric", self.qq_lyric(session, qq_item["songmid"])))
            albummid = qq_item.get("albummid")
            if albummid and (_f("album_artist") or _f("genre") or _f("year") or _f("description")):
                cache_key = f"qq_{albummid}"
                if cache_key not in album_cache:
                    detail_jobs.append(("qq_album_info", self.qq_album_info(session, albummid)))
        if not qq_item and ncm_item and ncm_item.get("ncm_id"):
            ncm_id = ncm_item["ncm_id"]
            if _f("lyric") or lyric_credits_fallback:
                detail_jobs.append(("ncm_lyric", self.ncm_lyric(session, ncm_id)))
            if _f("composer") or _f("lyricist") or _f("arranger") or _f("producer"):
                detail_jobs.append(("ncm_creators", self.ncm_song_creators(session, ncm_id)))
            if _f("description"):
                detail_jobs.append(("ncm_desc", self.ncm_album_description(session, ncm_id)))

        detail_results = await asyncio.gather(
            *(job for _, job in detail_jobs), return_exceptions=True
        )
        details = {}
        for (detail_type, _), value in zip(detail_jobs, detail_results):
            if isinstance(value, Exception):
                logger.warning("歌曲详情请求失败 %s - %s: %s", detail_type, song_name, value)
                continue
            details[detail_type] = value
            if detail_type == "qq_album_info" and qq_item and qq_item.get("albummid"):
                album_cache[f"qq_{qq_item['albummid']}"] = value

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
            lyric_text = details.get("qq_lyric")
            if _f("lyric"):
                result["lyric"] = lyric_text or None
            album_info = album_cache.get(f"qq_{qq_item.get('albummid')}")
            if album_info:
                if _f("album_artist") and not result["album_artist"]:
                    result["album_artist"] = album_info.get("album_artist")
                if _f("genre") and not result["genre"]:
                    result["genre"] = album_info.get("genre")
                if _f("year") and not result["year"]:
                    result["year"] = album_info.get("year")
                if _f("description") and not result.get("description"):
                    result["description"] = album_info.get("description")

        if not qq_item and ncm_item:
            result.update(
                song_name=ncm_item.get("title") or song_name if _f("title") else song_name,
                artist=ncm_item.get("artist") or artist_name if _f("artist") else artist_name,
                album=ncm_item.get("album") if _f("album") else None,
                album_artist=ncm_item.get("album_artist") if _f("album_artist") else None,
                year=ncm_item.get("year") if _f("year") else None,
                cover_url=ncm_item.get("cover_url"),
                source="netease",
            )
            lyric_text = details.get("ncm_lyric")
            if _f("lyric"):
                result["lyric"] = lyric_text or None
            creators = details.get("ncm_creators") or {}
            if _f("composer"):
                result["composers"] = [c for c in creators.get("composers") or [] if c]
            if _f("lyricist"):
                result["lyricists"] = [l for l in creators.get("lyricists") or [] if l]
            if _f("arranger"):
                result["arranger"] = creators.get("arranger")
            if _f("producer"):
                result["producer"] = creators.get("producer")
            if _f("description"):
                result["description"] = details.get("ncm_desc") or None

        if itunes_item and not qq_item and not ncm_item:
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
        elif qq_item:
            # QQ 已命中：用 网易云 / iTunes 补年份/流派/封面兜底
            if ncm_item:
                if _f("year") and not result["year"]:
                    result["year"] = ncm_item.get("year")
                if not result["cover_url"]:
                    result["cover_url"] = ncm_item.get("cover_url")
            if itunes_item:
                if _f("year") and not result["year"]:
                    result["year"] = itunes_item.get("year")
                if _f("genre") and not result["genre"]:
                    result["genre"] = itunes_item.get("genre")
                if not result["cover_url"]:
                    result["cover_url"] = itunes_item.get("cover_url")

        if qq_item is None and ncm_item is None and itunes_item is None:
            # 仍有 MusicBrainz 信用路径或 LRC 保底可补 作曲/作词/发布者 时，不提前报错
            has_mb_credits = _s("musicbrainz") and (_f("composer") or _f("lyricist"))
            has_lrc_credits = (
                lyric_credits_fallback
                and (_f("composer") or _f("lyricist") or _f("publisher"))
                and bool(local_lyrics or lyric_text)
            )
            if not has_mb_credits and not has_lrc_credits:
                result["error"] = f"在 QQ音乐 / 网易云 / iTunes 中未找到该歌曲（{song_name} - {artist_name}）"
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

        if not result.get("source") and qq_item is None and ncm_item is None and itunes_item is None:
            result["source"] = "musicbrainz"
        return result

    @staticmethod
    def _score_candidate(cand, song_name, artist_name, title_key="title", artist_key="artist"):
        """候选相似度打分（歌名 0.6 + 艺人 0.4），用于多结果排序（最佳靠前）"""
        title = cand.get(title_key) or ""
        artist = cand.get(artist_key) or ""
        title_score = max(
            fuzz.token_set_ratio(title, song_name),
            fuzz.partial_ratio(title, song_name),
        ) if title else 0
        artist_score = fuzz.partial_ratio(artist, artist_name) if artist else 0
        return title_score * 0.6 + artist_score * 0.4

    async def match_lyric(self, session, song_name, artist_name, sources=None, offset=0, limit=6):
        """在线歌词多源匹配（分页，最佳靠前）：返回 {total, results:[{source, source_label, song_name, artist, album, lyric}]}"""
        all_cands = []  # (score, source, cand)
        if sources is None or sources.get("qq", True):
            try:
                candidates = await self.qq_search(session, f"{song_name} {artist_name}", limit=30)
                for c in candidates:
                    all_cands.append((self._score_candidate(c, song_name, artist_name), "qq", c))
            except Exception as e:
                logger.warning("QQ 在线歌词搜索失败 %s - %s: %s", song_name, artist_name, e)
        if sources is None or sources.get("netease", True):
            try:
                candidates = await self.ncm_search(session, song_name, artist_name, limit=30)
                for c in candidates:
                    all_cands.append((self._score_candidate(c, song_name, artist_name), "netease", c))
            except Exception as e:
                logger.warning("网易云在线歌词搜索失败 %s - %s: %s", song_name, artist_name, e)

        all_cands.sort(key=lambda x: x[0], reverse=True)
        total = len(all_cands)
        page = all_cands[offset:offset + limit]

        results = []
        for _score, src, cand in page:
            try:
                if src == "qq":
                    mid = cand.get("songmid")
                    lyric = await self.qq_lyric(session, mid) if mid else None
                else:
                    nid = cand.get("ncm_id")
                    lyric = await self.ncm_lyric(session, nid) if nid else None
                if not lyric:
                    continue
                results.append({
                    "source": "qq" if src == "qq" else "netease",
                    "source_label": "QQ音乐" if src == "qq" else "网易云音乐",
                    "song_name": cand.get("title"),
                    "artist": cand.get("artist"),
                    "album": cand.get("album"),
                    "lyric": lyric,
                })
            except Exception as e:
                logger.warning("在线歌词获取失败 %s: %s", src, e)
        return {"total": total, "results": results}

    async def match_song_candidates(self, session, song_name, artist_name, sources=None, offset=0, limit=6,
                                    fields=None, lyric_credits_fallback=False, local_lyrics=None):
        """单曲匹配多候选（分页，数据较多优先）：返回 {total, results:[{source, source_label, song_name, artist,
        album, album_artist, year, genre, trackNo, discNo, cover_url, composers, lyricists, arranger, producer, publisher}]}"""
        all_fields = {"title", "artist", "album", "year", "track_disc", "genre",
                      "album_artist", "composer", "lyricist", "lyric",
                      "publisher", "arranger", "producer"}
        fields = fields or {k: True for k in all_fields}

        def _f(k):
            return bool(fields.get(k, True))

        # 1. 搜索各源 → 候选（带 source）
        cands = []  # (source, item)
        if sources is None or sources.get("qq", True):
            try:
                for it in await self.qq_search(session, f"{song_name} {artist_name}", limit=30):
                    cands.append(("qq", it))
            except Exception as e:
                logger.warning("QQ 候选搜索失败 %s - %s: %s", song_name, artist_name, e)
        if sources is None or sources.get("netease", True):
            try:
                for it in await self.ncm_search(session, song_name, artist_name, limit=30):
                    cands.append(("netease", it))
            except Exception as e:
                logger.warning("网易云候选搜索失败 %s - %s: %s", song_name, artist_name, e)
        if sources is None or sources.get("itunes", True):
            try:
                for it in await self.itunes_search(session, song_name, artist_name):
                    cands.append(("itunes", it))
            except Exception as e:
                logger.warning("iTunes 候选搜索失败 %s - %s: %s", song_name, artist_name, e)

        # 2. 排序：相似度为主 + 数据量为辅（score + 数据量*2，最佳匹配靠前、数据多的浮上来）
        scored = []
        for src, it in cands:
            score = self._score_candidate(it, song_name, artist_name)
            dc = sum(1 for k in ("album", "album_artist", "year", "genre", "trackNo", "discNo", "cover_url") if it.get(k))
            if not (it.get("album") or it.get("year") or it.get("cover_url")):
                continue  # 仅标题/艺人，无可用数据
            scored.append((score, dc, src, it))
        scored.sort(key=lambda x: x[0] + x[1] * 2, reverse=True)

        total = len(scored)
        page = scored[offset:offset + limit]

        # 3. 共享 credits：MusicBrainz + LRC 保底跑一次，填到缺 credits 的候选
        shared_composers, shared_lyricists = [], []
        if _f("composer") or _f("lyricist"):
            try:
                mb = await self.musicbrainz_credits(session, song_name, artist_name)
                shared_composers = mb.get("composers") or []
                shared_lyricists = mb.get("lyricists") or []
            except Exception as e:
                logger.warning("MB credits 失败 %s - %s: %s", song_name, artist_name, e)
        shared_publisher_raw = None
        if lyric_credits_fallback and local_lyrics:
            cr = parse_lyric_credits(local_lyrics)
            if not shared_composers and cr.get("composer"):
                shared_composers = [c.strip() for c in cr["composer"].split("/") if c.strip()]
            if not shared_lyricists and cr.get("lyricist"):
                shared_lyricists = [l.strip() for l in cr["lyricist"].split("/") if l.strip()]
            if _f("publisher") and not shared_publisher_raw and cr.get("publisher"):
                shared_publisher_raw = cr["publisher"]

        SOURCE_LABELS_MAP = {"qq": "QQ音乐", "netease": "网易云音乐", "itunes": "iTunes"}

        # 4. 组装每个候选（含增强）
        results = []
        for _score, _dc, src, it in page:
            r = {
                "source": src,
                "source_label": SOURCE_LABELS_MAP.get(src, src),
                "song_name": it.get("title"),
                "artist": it.get("artist"),
                "album": it.get("album") if _f("album") else None,
                "album_artist": it.get("album_artist") if _f("album_artist") else None,
                "year": it.get("year") if _f("year") else None,
                "genre": it.get("genre") if _f("genre") else None,
                "trackNo": it.get("trackNo") if _f("track_disc") else None,
                "discNo": it.get("discNo") if _f("track_disc") else None,
                "cover_url": None,
                "lyric": None,
                "composers": [], "lyricists": [], "arranger": None, "producer": None,
                "publisher": None,
            }
            try:
                if src == "qq":
                    r["cover_url"] = QQ_COVER_URL.format(albummid=it["albummid"]) if it.get("albummid") else None
                    if it.get("albummid") and (_f("album_artist") or _f("genre") or _f("year")):
                        ai = await self.qq_album_info(session, it["albummid"])
                        if ai:
                            if _f("album_artist") and not r["album_artist"]:
                                r["album_artist"] = ai.get("album_artist")
                            if _f("genre") and not r["genre"]:
                                r["genre"] = ai.get("genre")
                            if _f("year") and not r["year"]:
                                r["year"] = ai.get("year")
                elif src == "netease":
                    r["cover_url"] = it.get("cover_url")
                    if it.get("ncm_id") and (_f("composer") or _f("lyricist") or _f("arranger") or _f("producer")):
                        try:
                            cr = await self.ncm_song_creators(session, it["ncm_id"])
                            if _f("composer"):
                                r["composers"] = list(cr.get("composers") or [])
                            if _f("lyricist"):
                                r["lyricists"] = list(cr.get("lyricists") or [])
                            if _f("arranger") and cr.get("arranger"):
                                r["arranger"] = cr["arranger"]
                            if _f("producer") and cr.get("producer"):
                                r["producer"] = cr["producer"]
                        except Exception as e:
                            logger.warning("网易云创作者失败 %s: %s", it.get("ncm_id"), e)
                elif src == "itunes":
                    r["cover_url"] = it.get("cover_url")
            except Exception as e:
                logger.warning("候选增强失败 %s: %s", src, e)

            # 在线歌词：拉取该候选歌词并解析 credits（B 方案：恢复在线歌词保底 + 携带歌词）
            lyric_text = None
            try:
                if src == "qq" and it.get("songmid"):
                    lyric_text = await self.qq_lyric(session, it["songmid"])
                elif src == "netease" and it.get("ncm_id"):
                    lyric_text = await self.ncm_lyric(session, it["ncm_id"])
            except Exception as e:
                logger.warning("候选歌词失败 %s: %s", src, e)
            if lyric_text:
                if _f("lyric"):
                    r["lyric"] = lyric_text
                if lyric_credits_fallback:
                    cr = parse_lyric_credits(lyric_text)
                    if _f("composer") and not r["composers"] and cr.get("composer"):
                        r["composers"] = [c.strip() for c in cr["composer"].split("/") if c.strip()]
                    if _f("lyricist") and not r["lyricists"] and cr.get("lyricist"):
                        r["lyricists"] = [l.strip() for l in cr["lyricist"].split("/") if l.strip()]
                    if _f("publisher") and not r["publisher"] and cr.get("publisher"):
                        pub = cr["publisher"]
                        if r.get("year") and not pub.startswith("℗"):
                            pub = f"℗ {r['year']} {pub}"
                        r["publisher"] = pub

            # 共享 credits 填充缺失
            if _f("composer") and not r["composers"]:
                r["composers"] = list(shared_composers)
            if _f("lyricist") and not r["lyricists"]:
                r["lyricists"] = list(shared_lyricists)
            if _f("publisher") and not r["publisher"] and shared_publisher_raw:
                pub = shared_publisher_raw
                if r.get("year") and not pub.startswith("℗"):
                    pub = f"℗ {r['year']} {pub}"
                r["publisher"] = pub
            results.append(r)

        return {"total": total, "results": results}

    async def match_album_candidates(self, session, album_name, artist_name, sources=None, offset=0, limit=6, fields=None):
        """专辑匹配多候选（分页）：返回 {total, results:[{source, source_label, album, album_artist, year, genre, cover_url}]}"""
        all_fields = {"title", "artist", "album", "year", "track_disc", "genre",
                      "album_artist", "composer", "lyricist", "lyric",
                      "publisher", "arranger", "producer"}
        fields = fields or {k: True for k in all_fields}

        def _f(k):
            return bool(fields.get(k, True))

        cands = []  # (source, item)

        # 网易云：两搜合并（仅专辑名 / 专辑名+艺人），按 (专辑, 专辑艺人) 去重
        if sources is None or sources.get("netease", True):
            seen = set()
            for keyword in (album_name, f"{album_name} {artist_name}".strip()):
                try:
                    data = await self._ncm_get(
                        session, "cloudsearch",
                        {"keywords": keyword, "type": 10, "limit": 30},
                    )
                    for it in ((data.get("result") or {}).get("albums")) or []:
                        ar = it.get("artists") or []
                        year = None
                        pub = it.get("publishTime")
                        if pub:
                            try:
                                year = str(time.strftime("%Y", time.localtime(int(pub) / 1000)))
                            except Exception:
                                year = None
                        pic = it.get("picUrl")
                        cover = f"{pic}?param=500y500" if pic else None
                        a_name = it.get("name")
                        a_artist = ar[0].get("name") if ar else None
                        key = (a_name, a_artist)
                        if key in seen:
                            continue
                        seen.add(key)
                        cands.append(("netease", {
                            "album": a_name, "album_artist": a_artist,
                            "ncm_id": it.get("id"),
                            "year": year, "genre": None, "cover_url": cover,
                        }))
                except Exception as e:
                    logger.warning("网易云专辑搜索失败 %s - %s: %s", keyword, artist_name, e)
        # QQ：两搜合并（歌曲搜索按专辑分组推导），按 (专辑, 专辑艺人) 去重
        if sources is None or sources.get("qq", True):
            seen = set()
            for keyword in (album_name, f"{album_name} {artist_name}".strip()):
                try:
                    for it in await self.qq_search_album(session, keyword):
                        key = (it.get("album"), it.get("album_artist"))
                        if key in seen:
                            continue
                        seen.add(key)
                        cands.append(("qq", it))
                except Exception as e:
                    logger.warning("QQ 专辑搜索失败 %s - %s: %s", keyword, artist_name, e)
        # iTunes：单搜（专辑名+艺人），不参与两搜合并
        if sources is None or sources.get("itunes", True):
            try:
                term = f"{album_name} {artist_name}".strip()
                data = await self._api_get(
                    session, ITUNES_SEARCH,
                    params={"term": term, "entity": "album", "limit": "25"},
                )
                for r in data.get("results") or []:
                    cands.append(("itunes", {
                        "album": r.get("collectionName"),
                        "album_artist": r.get("artistName"),
                        "year": (r.get("releaseDate") or "")[:4],
                        "genre": r.get("primaryGenreName"),
                        "cover_url": self._itunes_cover_url(r.get("artworkUrl100")),
                    }))
            except Exception as e:
                logger.warning("iTunes 专辑搜索失败 %s - %s: %s", album_name, artist_name, e)

        # 排序：专辑名/艺人类似度 + 数据量；过滤无封面/年份
        scored = []
        for src, it in cands:
            score = self._score_candidate(it, album_name, artist_name, title_key="album", artist_key="album_artist")
            dc = sum(1 for k in ("year", "genre", "cover_url") if it.get(k))
            if not (it.get("cover_url") or it.get("year")):
                continue
            scored.append((score, dc, src, it))
        scored.sort(key=lambda x: x[0] + x[1] * 2, reverse=True)

        total = len(scored)
        page = scored[offset:offset + limit]
        SOURCE_LABELS_MAP = {"qq": "QQ音乐", "netease": "网易云音乐", "itunes": "iTunes"}
        results = []
        for _score, _dc, src, it in page:
            results.append({
                "source": src,
                "source_label": SOURCE_LABELS_MAP.get(src, src),
                "album": it.get("album") if _f("album") else None,
                "album_artist": it.get("album_artist") if _f("album_artist") else None,
                "year": it.get("year") if _f("year") else None,
                "genre": it.get("genre") if _f("genre") else None,
                "cover_url": it.get("cover_url"),
                "albummid": it.get("albummid"),
                "ncm_id": it.get("ncm_id"),
            })
        return {"total": total, "results": results}

    # ================================================================
    # 艺人写真（简介后续再接 QQ 音乐 wiki）
    # ================================================================

    async def get_artist_avatar(self, session, artist_name, sources=None):
        """艺人写真与简介：按源选择，QQ 优先，失败再网易云，返回 source。"""
        sources = sources or {}
        use_qq = sources.get("qq", True)
        use_netease = sources.get("netease", True)
        if not use_qq and not use_netease:
            return {"singermid": None, "artist_id": None, "avatar_url": None, "bio": None, "source": None}
        if use_qq:
            try:
                candidates = await self.qq_search_artists(session, artist_name, limit=5)
                best = self._pick_best(
                    candidates, artist_name, artist_name, title_key="name", artist_key="name"
                )[0]
                if best and best.get("singermid"):
                    return {
                        "singermid": best["singermid"],
                        "artist_id": None,
                        "avatar_url": QQ_AVATAR_URL.format(singermid=best["singermid"]),
                        "bio": await self.qq_singer_desc(session, best["singermid"]),
                        "source": "qq",
                    }
            except Exception as e:
                logger.warning("QQ 歌手写真失败 %s: %s", artist_name, e)
        if use_netease:
            try:
                candidates = await self.match_artist_candidates(
                    session, artist_name, sources={"qq": False, "netease": True}, limit=5
                )
                for candidate in candidates:
                    avatar_url = candidate.get("avatar_url")
                    bio = await self.ncm_artist_desc(session, candidate.get("artist_id"))
                    if avatar_url or bio:
                        return {
                            "singermid": None,
                            "artist_id": candidate.get("artist_id"),
                            "avatar_url": avatar_url,
                            "bio": bio,
                            "source": "netease",
                        }
            except Exception as e:
                logger.warning("网易云歌手写真失败 %s: %s", artist_name, e)
        return {"singermid": None, "artist_id": None, "avatar_url": None, "bio": None, "source": None}

    async def match_artist_bio(self, session, artist_name, sources=None):
        """艺人简介：按源选择，QQ 优先，失败则网易云，都失败返回空。"""
        info = await self.get_artist_avatar(session, artist_name, sources)
        if info.get("bio"):
            return {
                "bio": info["bio"],
                "bio_source": info.get("source"),
                "bio_source_id": info.get("singermid") or info.get("artist_id"),
            }
        return {"bio": None, "bio_source": None, "bio_source_id": None}

    async def match_artist_candidates(self, session, artist_name, sources=None, limit=10):
        """并行搜索 QQ/网易艺人候选，仅返回候选基础信息。"""
        jobs = []
        if sources is None or sources.get("qq", True):
            jobs.append(("qq", self.qq_search_artists(session, artist_name, limit)))
        if sources is None or sources.get("netease", True):
            jobs.append(("netease", self.ncm_search_artists(session, artist_name, limit)))
        responses = await asyncio.gather(*(job for _, job in jobs), return_exceptions=True)
        results = []
        labels = {"qq": "QQ音乐", "netease": "网易云音乐"}
        for (source, _), response in zip(jobs, responses):
            if isinstance(response, Exception):
                logger.warning("%s 艺人搜索失败 %s: %s", source, artist_name, response)
                continue
            for item in response or []:
                item["source"] = source
                item["source_label"] = labels[source]
                results.append(item)
        results.sort(key=lambda item: fuzz.partial_ratio(item.get("name") or "", artist_name), reverse=True)
        return results[:limit]

    async def match_artist_candidate_details(self, session, candidate):
        """获取选中艺人候选的简介和头像。"""
        if candidate.get("source") == "qq":
            bio = await self.qq_singer_desc(session, candidate.get("singermid"))
        else:
            bio = await self.ncm_artist_desc(session, candidate.get("artist_id"))
        return {"bio": bio, "avatar_url": candidate.get("avatar_url")}

    # ================================================================
    # 独立会话便捷入口
    # ================================================================

    async def match_song_candidates_fast(self, session, song_name, artist_name, sources=None, offset=0, limit=6, fields=None):
        """快速候选搜索：并行搜索，只返回基础候选和来源 ID。"""
        jobs = []
        if sources is None or sources.get("qq", True):
            jobs.append(("qq", self.qq_search(session, f"{song_name} {artist_name}", limit=30)))
        if sources is None or sources.get("netease", True):
            jobs.append(("netease", self.ncm_search(session, song_name, artist_name, limit=30)))
        if sources is None or sources.get("itunes", True):
            jobs.append(("itunes", self.itunes_search(session, song_name, artist_name)))
        responses = await asyncio.gather(*(job for _, job in jobs), return_exceptions=True)
        scored = []
        for (source, _), response in zip(jobs, responses):
            if isinstance(response, Exception):
                logger.warning("%s 候选搜索失败 %s: %s", source, song_name, response)
                continue
            for item in response or []:
                score = self._score_candidate(item, song_name, artist_name)
                if not (item.get("album") or item.get("year") or item.get("cover_url")):
                    continue
                detail_count = sum(1 for key in ("album", "album_artist", "year", "genre", "trackNo", "discNo", "cover_url") if item.get(key))
                scored.append((score, detail_count, source, item))
        scored.sort(key=lambda value: value[0] + value[1] * 2, reverse=True)
        page = scored[offset:offset + limit]
        labels = {"qq": "QQ音乐", "netease": "网易云音乐", "itunes": "iTunes"}
        results = []
        for _score, _details, source, item in page:
            results.append({
                "source": source,
                "source_label": labels.get(source, source),
                "song_name": item.get("title"),
                "artist": item.get("artist"),
                "album": item.get("album"),
                "album_artist": item.get("album_artist"),
                "year": item.get("year"),
                "genre": item.get("genre"),
                "trackNo": item.get("trackNo"),
                "discNo": item.get("discNo"),
                "cover_url": QQ_COVER_URL.format(albummid=item["albummid"]) if source == "qq" and item.get("albummid") else item.get("cover_url"),
                "songmid": item.get("songmid"),
                "albummid": item.get("albummid"),
                "ncm_id": item.get("ncm_id"),
            })
        return {"total": len(scored), "results": results}

    async def match_song_candidate_details(self, session, candidate, fields=None, lyric_credits_fallback=False):
        """获取选中歌曲候选的详情，详情请求并行执行。"""
        fields = fields or {}
        source = candidate.get("source")
        jobs = []
        if source == "qq":
            if candidate.get("songmid") and (fields.get("lyric", True) or lyric_credits_fallback):
                jobs.append(("lyric", self.qq_lyric(session, candidate["songmid"])))
            if candidate.get("albummid") and any(fields.get(key, True) for key in ("album_artist", "genre", "year")):
                jobs.append(("album_info", self.qq_album_info(session, candidate["albummid"])))
        elif source == "netease" and candidate.get("ncm_id"):
            if fields.get("lyric", True) or lyric_credits_fallback:
                jobs.append(("lyric", self.ncm_lyric(session, candidate["ncm_id"])))
            if any(fields.get(key, True) for key in ("composer", "lyricist", "arranger", "producer")):
                jobs.append(("creators", self.ncm_song_creators(session, candidate["ncm_id"])))
        values = await asyncio.gather(*(job for _, job in jobs), return_exceptions=True)
        result = {}
        for (kind, _), value in zip(jobs, values):
            if isinstance(value, Exception):
                logger.warning("候选详情失败 %s: %s", kind, value)
                continue
            if kind == "lyric":
                result["lyric"] = value
            elif kind == "album_info" and value:
                result.update({"album_artist": value.get("album_artist"), "genre": value.get("genre"), "year": value.get("year")})
            elif kind == "creators" and value:
                result.update({"composers": value.get("composers") or [], "lyricists": value.get("lyricists") or [], "arranger": value.get("arranger"), "producer": value.get("producer")})
        return result

    async def match_song(self, song_name, artist_name, sources=None, fields=None, lyric_credits_fallback=False, local_lyrics=None):
        async with aiohttp.ClientSession(timeout=self._timeout) as session:
            return await self.get_song_metadata(
                session, song_name, artist_name,
                sources=sources, fields=fields,
                lyric_credits_fallback=lyric_credits_fallback,
                local_lyrics=local_lyrics,
            )

    async def match_lyric_standalone(self, song_name, artist_name, sources=None, offset=0, limit=6):
        async with aiohttp.ClientSession(timeout=self._timeout) as session:
            return await self.match_lyric(
                session, song_name, artist_name,
                sources=sources, offset=offset, limit=limit,
            )

    async def match_song_candidates_standalone(self, song_name, artist_name, sources=None, offset=0, limit=6,
                                               fields=None, lyric_credits_fallback=False, local_lyrics=None):
        async with aiohttp.ClientSession(timeout=self._timeout) as session:
            return await self.match_song_candidates_fast(
                session, song_name, artist_name,
                sources=sources, offset=offset, limit=limit,
                fields=fields,
            )

    async def match_album_candidates_standalone(self, album_name, artist_name, sources=None, offset=0, limit=6, fields=None):
        async with aiohttp.ClientSession(timeout=self._timeout) as session:
            return await self.match_album_candidates(
                session, album_name, artist_name,
                sources=sources, offset=offset, limit=limit, fields=fields,
            )

    async def match_artist(self, artist_name):
        async with aiohttp.ClientSession(timeout=self._timeout) as session:
            return await self.get_artist_avatar(session, artist_name)
