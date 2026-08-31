import { startTransition, useState, useRef, useEffect, useCallback } from "react";
import { FiPlus } from "react-icons/fi";
import { FaEllipsisH, FaCompactDisc, FaUser, FaHeart, FaStepForward, FaClock, FaPlus, FaArrowUp, FaTrash, FaMusic, FaInfoCircle, FaCog, FaPlay, FaExclamationCircle, FaCheckCircle, FaTimes, FaBell, FaStar, FaVideo, FaObjectGroup } from "react-icons/fa";
import { readMetadata } from "../utils/MetadataReader";
import { splitArtists, joinArtists, albumBelongsToArtist, collectAllArtists, isPrimaryAlbum } from "../utils/artistSplit";
import { uploadMusic, restoreMissingMusic, getMusicList, getAssetUrl, deleteMusic, deleteAlbum, checkMusicFiles, updateMusicMetadata, updateAlbumDescription, matchSong, getLyrics, getPlaylists, savePlaylists, resetAll, getResetProgress, openMusicFile, getArtists, saveArtist, deleteArtist, getMatchAllProgress, cancelMatchAll, getSettings, saveAppSettings, getDataJob, getDataExportDownloadUrl, cancelDataJob, startSmartJob, getSmartJob, cancelSmartJob, getSmartProviders, getVideos, uploadVideo, addWebVideo, updateVideo, updateVideoCover, deleteVideo, openVideoFile } from "../services/api";
import { saveSongToIndex, removeSongFromIndex, loadMusicIndex } from "../utils/musicIndex";
import { normalizePlaylists, loadPlaylistCache, savePlaylistCache } from "../utils/playlistStore";
import { isUnplayableCodec, songPlayable, isPlaceholderPublisher } from "../utils/formatCheck";
import { clearPlayCounts } from "../utils/playCount";
import { normalizeSongRef, primarySongRef, refMatchesSong, videoMatchesSong } from "../utils/videoAssociations";
import MusicPlayer from "../components/MusicPlayer";
import AlbumDetail from "./AlbumDetail";
import ArtistsDetail from "./ArtistsDetail";
import PlaylistDetail from "./PlaylistDetail";
import ArtistEdit from "./ArtistEdit";
import Search, { SearchResults } from "../components/Search";
import CoverPlayButton from "../components/CoverPlayButton";
import PlayingAnimation from "../components/PlayingAnimation";
import useCoverColor from "../components/CoverColor";
import MusicEdit from "./MusicEdit";
import DetailErrorBoundary from "../components/DetailErrorBoundary";
import Sidebar from "../components/LibrarySidebar";
import Settings, { applyTheme } from "../components/Settings";
import MatchDetail from "../components/MatchDetail";
import MetadataBrowser from "../components/MetadataBrowser";
import VideoLibrary from "../components/VideoLibrary";
import VideoDetail from "../components/VideoDetail";
import "../styles/music-library.css";


/* ======================================================
   工具函数：专辑 / 歌曲构建与合并
   ====================================================== */

// 支持的音频扩展名（用于过滤非音乐文件）
const MUSIC_EXTS = [
  ".mp3", ".flac", ".ogg", ".oga", ".opus", ".m4a", ".m4b",
  ".mp4", ".wav", ".wave", ".aiff", ".aif", ".wma", ".ape", ".wv",
];
function isMusicFile(name) {
  if (!name) return false;
  const ext = name.split(".").pop().toLowerCase();
  return MUSIC_EXTS.includes(`.${ext}`);
}

/* 播放列表卡片：应用首歌封面 + 取色覆盖 + 右下角标题（不含光晕） */
function PlaylistCard({ pl, onOpen, onMenu, order }) {
  const cover = pl.coverURL || pl.songs?.[0]?.coverURL || null;
  const styleEnabled = pl.id === "liked" || pl.id === "recent" || !!pl.coverStyle;
  const palette = useCoverColor(styleEnabled && cover ? cover : null);
  const themeSwatch = palette?.Vibrant || palette?.Muted || palette?.DarkVibrant || palette?.LightVibrant || null;
  const themeColor = themeSwatch ? themeSwatch.hex : null;
  return (
    <div className="album-card" style={{ ...styles.libraryCard, order }} onClick={() => onOpen(pl.id)}>
      <div style={styles.coverWrapper}>
        <div style={styles.playlistCoverPlaceholder}>
          {pl.id === "liked" ? "❤️" : pl.id === "recent" ? "🕐" : "📋"}
        </div>
        {cover && (
          <img src={cover} alt={pl.name} onError={(e) => { e.currentTarget.style.display = "none"; }} style={{ ...styles.coverImage, position: "absolute", inset: 0 }} />
        )}
        {styleEnabled && cover && themeColor && (
          <div style={{ ...styles.playlistCardOverlay, background: themeColor }} />
        )}
        {styleEnabled && cover && (
          <div style={styles.playlistCardTitleOverlay}>
            <span style={styles.playlistCardTitle}>{pl.name}</span>
          </div>
        )}
      </div>
      <div style={styles.albumTitleRow}>
        <p style={styles.albumTitle}>{pl.name}</p>
        <button className="album-menu-btn" style={styles.albumMenuBtnInline} onClick={(e) => onMenu(e, pl)} title="更多操作">
          <span style={styles.albumMenuDotsInline}>···</span>
        </button>
      </div>
      <p style={styles.albumArtist}>{pl.songs?.length || 0} 首歌曲</p>
    </div>
  );
}

/** 归一化歌曲身份键（title|artist|album），用于判断"同一首" */
function songDupKey(title, artist, album) {
  return [artist, album, title].map((s) => String(s || "").trim().toLowerCase()).join("|");
}

/** 计算文件 SHA-256（hex 字符串）；失败返回 null */
async function fileSha256(file) {
  try {
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/** 当前时间戳（模块级包装，避免在组件函数内直接调用 Date.now） */
function nowTs() {
  return Date.now();
}

/** 删除行为：是否移入回收站（设置-编辑开关，默认永久删除） */
function deleteToTrashEnabled() {
  return localStorage.getItem("delete-to-trash") === "1";
}

/** 通知时间显示：HH:MM */
function formatNotifTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 生成本地专辑 id（模块级包装，避免在组件函数内直接调用 Date.now/Math.random） */
function newAlbumId() {
  return Date.now().toString() + Math.random().toString(36).slice(2, 6);
}

function buildAlbumsFromIndex(index) {
  const albumMap = new Map();
  Object.entries(index).forEach(([file_path, s]) => {
    const title = s.album || "未知专辑";
    // 专辑归属键：专辑艺人 + 专辑名（无专辑艺人回退为曲目艺人），与后端 /list 一致
    const key = `${s.album_artist || s.artist || "未知艺术家"}|${title}`;
    // 规范化封面路径（兼容旧数据：可能缺少 picture/ 前缀）
    const coverPath = s.cover_path
      ? (s.cover_path.startsWith("picture/") ? s.cover_path : `picture/${s.cover_path}`)
      : null;
    if (!albumMap.has(key)) {
      albumMap.set(key, {
        id: `server-${s.album_artist || s.artist || "未知艺术家"}-${title}`,
        title,
        artist: s.album_artist || s.artist || "未知艺术家",
        album_artist: s.album_artist || null,
        year: s.year || null,
        genre: s.genre || null,
        publisher: s.publisher || null,
        coverURL: coverPath ? getAssetUrl(`/data/${coverPath}`) : null,
        importTime: s.importTime || Date.now(),
        songs: [],
      });
    }
    albumMap.get(key).songs.push({
      title: s.title,
      artist: s.artist || "未知艺术家",
      album: s.album || title,
      album_artist: s.album_artist,
      genre: s.genre,
      duration: s.duration,
      url: getAssetUrl(`/library/${file_path}`),
      file_path,
      coverURL: coverPath ? getAssetUrl(`/data/${coverPath}`) : null,
      trackNo: s.trackNo,
      discNo: s.discNo,
      composer: s.composer,
      lyricist: s.lyricist,
      publisher: s.publisher,
      comment: s.comment,
      bitrate: s.bitrate,
      codec: s.codec,
      year: s.year,
      importTime: s.importTime || Date.now(),
      modification_time: s.modification_time,
      hash: s.hash || null,
      matched: !!s.matched,
      match_source: s.match_source || null,
    });
  });
  return Array.from(albumMap.values()).map((a) => ({
    ...a,
    matched: (a.songs || []).some((sg) => sg.matched),
  }));
}

function buildAlbumsFromServer(data) {
  const loadedAlbums = [];
  for (const artistEntry of data || []) {
    for (const albumEntry of artistEntry.albums || []) {
      const albumId = `server-${artistEntry.artist}-${albumEntry.album}`;
      const albumCover = getAssetUrl(albumEntry.cover_url);
      const songs = (albumEntry.songs || []).map((s) => ({
        title: s.title,
        artist: s.artist || artistEntry.artist,
        album: s.album || albumEntry.album,
        album_artist: s.album_artist,
        genre: s.genre,
        duration: s.duration,
        url: getAssetUrl(s.file_url),
        file_path: s.file_path,
        coverURL: getAssetUrl(s.cover_url) || albumCover,
        trackNo: s.trackNo,
        discNo: s.discNo,
        composer: s.composer,
        lyricist: s.lyricist,
        publisher: s.publisher,
        comment: s.comment,
        bitrate: s.bitrate,
        codec: s.codec,
        year: s.year,
        importTime: s.importTime ?? Date.now(),
        modification_time: s.modification_time,
        hash: s.hash || null,
        matched: !!s.matched,
        match_source: s.match_source || null,
      }));
      const firstSong = songs[0];
      const songTimes = songs.map((x) => x.importTime).filter(Boolean);
      loadedAlbums.push({
        id: albumId,
        title: albumEntry.album,
        artist: artistEntry.artist,
        album_artist: firstSong?.album_artist || null,
        year: firstSong?.year || null,
        genre: firstSong?.genre || null,
        publisher: firstSong?.publisher || null,
        // 专辑封面取第一首歌封面（回退专辑封面）
         coverURL: firstSong?.coverURL || albumCover,
         description: albumEntry.description || "",
        // 专辑匹配状态：任一首已匹配即视为已匹配
        matched: songs.some((sg) => sg.matched),
        // 专辑最近添加时间 = 专辑内最新导入歌曲的时间；追加歌曲后应重新靠前。
        importTime: songTimes.length ? Math.max(...songTimes) : (albumEntry.import_time || Date.now()),
        songs,
      });
    }
  }
  return loadedAlbums;
}

function mergeAlbumsByTitle(prev, newAlbums) {
  // 合并键 = 专辑艺人 + 专辑名，避免同名不同专辑艺人的专辑被错误合并
  const keyOf = (a) => `${a.album_artist || a.artist || ""}|${a.title}`;
  const merged = new Map();
  for (const a of prev) merged.set(keyOf(a), { ...a, songs: [...a.songs] });
  for (const a of newAlbums) {
    const k = keyOf(a);
    if (merged.has(k)) {
      const existing = merged.get(k);
      const existingPaths = new Set(existing.songs.map((s) => s.file_path).filter(Boolean));
      for (const s of a.songs) {
        if (!s.file_path || !existingPaths.has(s.file_path)) {
          existing.songs.push(s);
        }
      }
       if (!existing.coverURL && a.coverURL) existing.coverURL = a.coverURL;
       if (!existing.description && a.description) existing.description = a.description;
    } else {
      merged.set(k, { ...a, songs: [...a.songs] });
    }
  }
  // 保留仅导入专辑资料（无音乐文件）的专辑，以便仍可查看封面和简介。
  return Array.from(merged.values());
}

/** 用服务端最新专辑重建资料库：按「专辑艺人|专辑名」去重，服务端优先；
 *  丢弃已被服务端覆盖的同 key 本地专辑（真正仅本地的保留），避免残留旧信息 / 重复专辑卡片 */
function mergeServerAlbums(prev, serverAlbums) {
  const keyOf = (a) => `${a.album_artist || a.artist || ""}|${a.title}`;
  const serverKeys = new Set(serverAlbums.map(keyOf));
  const keptLocal = prev.filter((a) => !serverKeys.has(keyOf(a)));
  return [...keptLocal.map((a) => ({ ...a, songs: [...a.songs] })), ...serverAlbums];
}

/** 根据编辑返回的歌曲信息构建本地索引条目（保留 duration/bitrate 等只读字段） */
function buildIndexSong(original, updated) {
  let cover_path = original?.cover_path || null;
  if (updated.cover_url) {
    const p = updated.cover_url.replace(/^\/data\//, "");
    if (p) cover_path = p;
  }
  return {
    ...(original || {}),
    ...updated,
    file_path: updated.file_path,
    album_artist: updated.album_artist !== undefined ? updated.album_artist : original?.album_artist,
    cover_path,
    coverURL: getAssetUrl(updated.cover_url),
    url: getAssetUrl(updated.file_url),
    importTime: original?.importTime ?? Date.now(),
  };
}

const DEFAULT_PLAYLISTS = [
  { id: "liked", name: "我喜欢的音乐", songs: [], description: "" },
  { id: "recent", name: "最近播放", songs: [], description: "最近播放的歌曲" },
];

// 主题是当前浏览器偏好；其余设置由后端同步到所有浏览器。
const APP_SETTING_KEYS = [
  "artist-keep-empty", "artist-hide-empty", "edit-publisher-copyright",
  "delete-to-trash", "edit-auto-organize-collab", "import-skip-unplayable",
  "library-display-name", "library-show-more-categories",
  "library-category-composer", "library-category-lyricist", "library-category-genre", "library-category-video",
  "player-volume",
  "match-skip-matched", "match-lyric-fallback", "match-overwrite", "match-rate",
  ...["title", "artist", "album", "year", "track_disc", "genre", "album_artist", "description", "composer", "lyricist", "lyric", "publisher", "arranger", "producer"].map((key) => `match-field-${key}`),
  ...["qq", "netease", "itunes", "musicbrainz"].map((key) => `match-source-${key}`),
];

function collectAppSettings() {
  return Object.fromEntries(APP_SETTING_KEYS
    .map((key) => [key, localStorage.getItem(key)])
    .filter(([, value]) => value !== null));
}

function normalizeStoredVolume(value, fallback = 0.3) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

/** 保证 liked / recent 始终存在 */
function ensureDefaultPlaylists(playlists) {
  const ids = new Set((playlists || []).map((p) => p.id));
  const base = [...(playlists || [])];
  if (!ids.has("liked")) base.push({ id: "liked", name: "我喜欢的音乐", songs: [], description: "" });
  if (!ids.has("recent")) base.push({ id: "recent", name: "最近播放", songs: [], description: "最近播放的歌曲" });
  return base;
}


/* ======================================================
   🎵 MusicLibrary — 音乐资料库主应用
   功能：侧边栏导航 | 顶部功能条 | 按视图切换内容区
         资料库 / 专辑 / 艺人 / 歌曲 四个视图
   播放相关由 MusicPlayer 组件处理
   ====================================================== */
export default function MusicLibrary() {
  // ---------- 专辑 & 歌曲状态 ----------
  const [albums, setAlbums] = useState([]);
  const [filterText, setFilterText] = useState("");

  // ---------- 播放器状态（与 MusicPlayer 共享） ----------
  const [currentAlbumId, setCurrentAlbumId] = useState(null);
  const [currentSongIndex, setCurrentSongIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => normalizeStoredVolume(localStorage.getItem("player-volume")));
  const volumeSettingsHydratedRef = useRef(false);
  const audioRef = useRef(null);
  const fileInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const reimportInputRef = useRef(null);
  // ---------- 懒加载（无限滚动）：主内容区为滚动容器，初始 40 条 ----------
  const [visibleCount, setVisibleCount] = useState(40);
  const mainAreaRef = useRef(null);
  const sentinelRef = useRef(null);
  // 歌曲列表使用独立批次，避免与专辑/资料库的分页状态互相影响。
  const [songVisibleCount, setSongVisibleCount] = useState(30);
  const [isLoadingMoreSongs, setIsLoadingMoreSongs] = useState(false);
  const songSentinelRef = useRef(null);
  const songLoadPendingRef = useRef(false);
  // 编辑当前播放歌曲被移动时的无缝续播恢复点 { newUrl, time, playing }
  const editRestoreRef = useRef(null);
  // ---------- 统一通知（活动） ----------
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [leavingNotifId, setLeavingNotifId] = useState(null);
  const [hoveredNotifId, setHoveredNotifId] = useState(null);
  const notifIdRef = useRef(0);
  const importNotifIdRef = useRef(null);
  const matchNotifIdRef = useRef(null);
  const albumMatchNotifIdRef = useRef(null);
  // 匹配轮询按需：仅匹配进行中才轮询
  const matchPollRef = useRef(null);
  const matchActiveRef = useRef(false);
  const [showActivity, setShowActivity] = useState(false);
  const [activityLeaving, setActivityLeaving] = useState(false);
  const importCancelledRef = useRef(false);
  const importAbortRef = useRef(null);
  const [isDragOver, setIsDragOver] = useState(false); // 拖拽文件悬浮在可导入区域
  const dragExcludedRef = useRef(false); // 当前是否悬浮在排除区（侧栏/顶栏/底部播放条）
  const [importPending, setImportPending] = useState(null); // 不可播放格式导入确认 { entries, unplayable, unplayableSkippedList, duplicateSkippedList, skippedNonMusic }
  const [importConfirm, setImportConfirm] = useState(null); // 一致性确认 { item, context }
  const [reimportMismatch, setReimportMismatch] = useState(null); // 查找恢复不一致 { file, meta, target, choice }
  const [importRememberChoice, setImportRememberChoice] = useState(false); // 确认弹窗「后续都默认此操作」复选
  const importUnplayableChoiceRef = useRef(null); // 会话级记忆："continue" | "cancel" | null（刷新失效）
  const [importSkipDetail, setImportSkipDetail] = useState(null); // 导入结果详情 { duplicate, unplayable }
  const [unplayableDialogSong, setUnplayableDialogSong] = useState(null); // 播放被拦截的歌曲
  const [resetting, setResetting] = useState(false); // 是否正在重置资料库
  const [resetProgress, setResetProgress] = useState({ done: 0, total: 0 }); // 重置进度 { done, total }
  const [dataCancelConfirm, setDataCancelConfirm] = useState(null); // { jobId, kind, notificationId }
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false);
  const [showSmartPlaylist, setShowSmartPlaylist] = useState(false);
  const [smartPlaylistName, setSmartPlaylistName] = useState("");
  const [smartPlaylistPrompt, setSmartPlaylistPrompt] = useState("");
  const [smartAvailable, setSmartAvailable] = useState(false);
  const [smartProviderName, setSmartProviderName] = useState("智能体");
  const [showSettings, setShowSettings] = useState(false);
  const [newPlaylistCover, setNewPlaylistCover] = useState(null);
  const [newPlaylistCoverRemoved, setNewPlaylistCoverRemoved] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [newPlaylistDesc, setNewPlaylistDesc] = useState("");
  const [newPlaylistCoverStyle, setNewPlaylistCoverStyle] = useState(false);
  const [showCoverMenu, setShowCoverMenu] = useState(false);
  const [editingPlaylistId, setEditingPlaylistId] = useState(null); // null=新建，有值=编辑该播放列表
  const [playlistSuggestion, setPlaylistSuggestion] = useState(null); // { playlistId, description }
  const coverInputRef = useRef(null);
  const smartJobActiveRef = useRef(false);
  const [panelTarget, setPanelTarget] = useState(null); // {type:"song",data} | {type:"album",data}
  const [panelSearch, setPanelSearch] = useState("");

        // ---------- 专辑详情页状态 ----------
  const [detailAlbumId, setDetailAlbumId] = useState(null);
  const [detailVideoId, setDetailVideoId] = useState(null);
  const [editVideoOnOpenId, setEditVideoOnOpenId] = useState(null);
  const [deleteVideoConfirm, setDeleteVideoConfirm] = useState(null);
  const [videos, setVideos] = useState([]);
  const [relatedVideoScope, setRelatedVideoScope] = useState(null);
  const [showWebVideoDialog, setShowWebVideoDialog] = useState(false);
  const [webVideoUrl, setWebVideoUrl] = useState("");
  const [webVideoSubmitting, setWebVideoSubmitting] = useState(false);
  // 多层返回栈：记录每次进入详情页前的来源，返回时逐层恢复
  const [navStack, setNavStack] = useState([]);

        // ---------- 播放列表详情页状态 ----------
        const [detailPlaylistId, setDetailPlaylistId] = useState(null);
        const [currentPlaylistId, setCurrentPlaylistId] = useState(null);

        // ---------- 艺人详情页状态 ----------
        const [detailArtistName, setDetailArtistName] = useState(null);
  const [artistRecords, setArtistRecords] = useState({}); // { 艺人名: { cover_url, bio, genres } }
  const [libraryTitle, setLibraryTitle] = useState(() => localStorage.getItem("library-display-name") || "音乐资料库");
  const [showMoreCategories, setShowMoreCategories] = useState(() => localStorage.getItem("library-show-more-categories") === "true");
  const [categoryVisibility, setCategoryVisibility] = useState(() => ({
    composer: localStorage.getItem("library-category-composer") !== "false",
    lyricist: localStorage.getItem("library-category-lyricist") !== "false",
    genre: localStorage.getItem("library-category-genre") !== "false",
    video: localStorage.getItem("library-category-video") === "true",
  }));
  const [metadataRoute, setMetadataRoute] = useState({ type: null, selected: null, view: "list" });
  const [hideEmptyArtists, setHideEmptyArtists] = useState(
    () => localStorage.getItem("artist-hide-empty") !== "false"
  );
  const [artistEditTarget, setArtistEditTarget] = useState(null); // { artist, record, albums }
  const [missingSongs, setMissingSongs] = useState(new Set());
  const [missingDialogSong, setMissingDialogSong] = useState(null);

    // ---------- 侧边栏导航 ----------
    const [activeNav, setActiveNav] = useState("library");

    // ---------- 播放列表（与侧边栏共享） ----------
    const [playlists, setPlaylists] = useState(() => {
      // 优先读本地缓存实现首屏秒出，否则用默认
      const cached = loadPlaylistCache();
      return ensureDefaultPlaylists(cached && cached.length > 0 ? cached : DEFAULT_PLAYLISTS);
    });
    // 仅在服务端播放列表已加载后才允许写回，避免新浏览器的空缓存覆盖云端数据。
    const [playlistsHydrated, setPlaylistsHydrated] = useState(false);

                // ---------- 播放队列（插播/稍后播放） ----------
        const [playQueue, setPlayQueue] = useState([]); // 额外播放队列，插播插入到下一首，稍后播放追加到末尾

        // 当前专辑 & 当前歌曲
  const currentAlbum = albums.find((a) => a.id === currentAlbumId) || null;
  const currentPlaylistFound = playlists.find((p) => p.id === currentPlaylistId) || null;
  const sourceSongsCount = currentAlbum?.songs?.length || currentPlaylistFound?.songs?.length || 0;
  const currentSong = currentAlbum?.songs?.[currentSongIndex]
    || currentPlaylistFound?.songs?.[currentSongIndex]
    || playQueue[currentSongIndex - sourceSongsCount]
    || null;

  function handleSmartProvidersChanged(providers) {
    const provider = (providers || []).find((item) => item.is_default && item.connected && item.enabled);
    setSmartAvailable(!!provider);
    setSmartProviderName(provider?.name || "智能体");
  }

  useEffect(() => {
    getSmartProviders().then((res) => handleSmartProvidersChanged(res.providers)).catch(() => handleSmartProvidersChanged([]));
  }, []);

  // ---------- 播放列表操作 ----------
  function handleCreatePlaylistWithDetails() {
    if (!newPlaylistName.trim()) { showToast("请输入播放列表名称", "warning"); return; }
    const newId = "pl_" + Date.now();
    const pl = {
      id: newId,
      name: newPlaylistName.trim(),
      songs: [],
      description: newPlaylistDesc.trim(),
      pinned: false,
      createdAt: Date.now(),
    };
    if (newPlaylistCover) pl.coverURL = newPlaylistCover;
    pl.coverStyle = newPlaylistCoverStyle;
    setPlaylists((prev) => [...prev, pl]);
    setShowCreatePlaylist(false);
    setNewPlaylistCover(null);
    setNewPlaylistCoverRemoved(false);
    setNewPlaylistName("");
    setNewPlaylistDesc("");
    setNewPlaylistCoverStyle(false);
    setShowCoverMenu(false);
  }

  // ---------- 打开新建播放列表弹窗（复位为新建模式） ----------
  function handleOpenCreatePlaylist() {
    setEditingPlaylistId(null);
    setNewPlaylistCover(null);
    setNewPlaylistCoverRemoved(false);
    setNewPlaylistName("");
    setNewPlaylistDesc("");
    setNewPlaylistCoverStyle(false);
    setShowCoverMenu(false);
    setShowCreatePlaylist(true);
  }

  // ---------- 打开编辑播放列表弹窗（复用新建弹窗，预填当前内容） ----------
  function handleOpenPlaylistEdit(playlist) {
    if (!playlist) return;
    setNewPlaylistName(playlist.name || "");
    setNewPlaylistDesc(playlist.description || "");
    setNewPlaylistCover(playlist.coverURL || null);
    setNewPlaylistCoverRemoved(false);
    setNewPlaylistCoverStyle(!!playlist.coverStyle);
    setShowCoverMenu(false);
    setEditingPlaylistId(playlist.id);
    setShowCreatePlaylist(true);
  }

  // ---------- 关闭弹窗（复位） ----------
  function handleCloseCreatePlaylist() {
    setShowCreatePlaylist(false);
    setEditingPlaylistId(null);
    setNewPlaylistCover(null);
    setNewPlaylistCoverRemoved(false);
    setNewPlaylistName("");
    setNewPlaylistDesc("");
    setNewPlaylistCoverStyle(false);
    setShowCoverMenu(false);
  }

  // ---------- 弹窗提交：编辑则更新，新建则创建 ----------
  function handlePlaylistFormSubmit() {
    if (!newPlaylistName.trim()) { showToast("请输入播放列表名称", "warning"); return; }
    if (editingPlaylistId) {
      const target = playlists.find((p) => p.id === editingPlaylistId);
      if (target) {
        const updated = {
          ...target,
          name: newPlaylistName.trim(),
          description: newPlaylistDesc.trim(),
          coverStyle: newPlaylistCoverStyle,
        };
        if (newPlaylistCoverRemoved) delete updated.coverURL;
        else if (newPlaylistCover) updated.coverURL = newPlaylistCover;
        handleUpdatePlaylist(editingPlaylistId, updated);
      }
      handleCloseCreatePlaylist();
    } else {
      handleCreatePlaylistWithDetails();
    }
  }

  function handleDeletePlaylist(id) {
    const next = playlists.filter((p) => p.id !== id);
    setPlaylists(next);
    // 删除当前详情或播放来源时，先退出这些状态，避免子组件接收到已删除的播放列表。
    if (detailPlaylistId === id) {
      setDetailPlaylistId(null);
      setActiveNav("playlists");
    }
    if (currentPlaylistId === id) {
      setIsPlaying(false);
      setCurrentPlaylistId(null);
      setCurrentSongIndex(0);
      setPlayQueue([]);
    }
    setNavStack((prev) => prev.filter((frame) => !(frame.kind === "playlist" && frame.id === id)));
    // 立即持久化，避免渲染异常或刷新落在防抖写入之前时恢复已删除的歌单。
    savePlaylistCache(next);
    if (playlistsHydrated) savePlaylists(normalizePlaylists(next)).catch(() => {});
  }

  function startSmartPlaylist() {
    if (smartJobActiveRef.current) { showToast("上个智能生成尚未结束", "info"); return; }
    const catalog = albums.flatMap((album) => (album.songs || []).map((song) => ({ id: song.file_path || song.url, title: song.title, artist: song.artist, album: song.album, year: song.year, genre: song.genre }))).filter((song) => song.id).slice(0, 2000);
    if (!smartPlaylistPrompt.trim() || catalog.length === 0) { showToast("请输入描述词，且资料库至少需要一首歌曲", "warning"); return; }
    smartJobActiveRef.current = true;
    setShowSmartPlaylist(false);
    const notifId = addNotification({ kind: "smart_progress", title: "正在生成智能歌单", content: `正在向 ${smartProviderName} 发送请求`, ongoing: true });
    startSmartJob("playlist", { name: smartPlaylistName.trim(), prompt: smartPlaylistPrompt.trim(), catalog }).then(({ job_id }) => {
      updateNotification(notifId, { action: { label: "取消", onClick: () => cancelSmartJob(job_id) } });
      const poll = async () => {
        try {
          const job = await getSmartJob(job_id);
          if (job.status === "queued" || job.status === "running") {
            updateNotification(notifId, { content: job.message || `正在接收 ${smartProviderName} 数据` });
            return setTimeout(poll, 700);
          }
          if (job.status === "done") {
            const ids = new Set(job.result?.song_ids || []);
            const songs = albums.flatMap((album) => album.songs || []).filter((song) => ids.has(song.file_path || song.url));
            setPlaylists((prev) => [...prev, { id: `pl_${Date.now()}`, name: smartPlaylistName.trim() || "智能歌单", description: job.result?.description || "", songs, pinned: false, createdAt: Date.now(), coverStyle: true, smart: true }]);
            updateNotification(notifId, { ongoing: false, action: null, kind: "success", title: "智能歌单生成完成", content: `已加入 ${songs.length} 首歌曲` });
          } else updateNotification(notifId, { ongoing: false, action: null, kind: "warning", title: job.status === "cancelled" ? "已取消智能生成" : "智能歌单生成失败", content: job.error || job.message });
          smartJobActiveRef.current = false;
        } catch {
          smartJobActiveRef.current = false;
          updateNotification(notifId, { ongoing: false, action: null, kind: "warning", title: "智能歌单生成失败", content: "无法读取生成结果" });
        }
      }; poll();
    }).catch(() => { smartJobActiveRef.current = false; updateNotification(notifId, { ongoing: false, kind: "warning", title: "智能歌单生成失败", content: "请检查智能供应商连接" }); });
  }

  // 所有智能生成都走同一套活动通知与可取消任务；结果只回填编辑表单，仍需用户确认保存。
  function startSmartSuggestion(kind, payload, onDone) {
    if (smartJobActiveRef.current) { showToast("上个智能生成尚未结束", "info"); return; }
    smartJobActiveRef.current = true;
    const label = kind === "album_suggestion" ? "专辑信息" : "歌曲信息";
    const notifId = addNotification({ kind: "smart_progress", title: `正在生成${label}建议`, content: `正在向 ${smartProviderName} 发送请求`, ongoing: true });
    startSmartJob(kind, payload).then(({ job_id }) => {
      updateNotification(notifId, { action: { label: "取消", onClick: () => cancelSmartJob(job_id) } });
      const poll = async () => {
        try {
          const job = await getSmartJob(job_id);
          if (job.status === "queued" || job.status === "running") {
            updateNotification(notifId, { content: job.message || `正在接收 ${smartProviderName} 数据` });
            return setTimeout(poll, 700);
          }
          if (job.status === "done") {
            const notification = onDone?.(job.result || {}) || {};
            updateNotification(notifId, { ongoing: false, action: notification.action || null, kind: "success", title: notification.title || `${label}建议已生成`, content: notification.content || "请选择建议内容后再保存" });
          } else {
            updateNotification(notifId, { ongoing: false, action: null, kind: "warning", title: job.status === "cancelled" ? "已取消智能生成" : "智能生成失败", content: job.error || job.message });
          }
          smartJobActiveRef.current = false;
        } catch {
          smartJobActiveRef.current = false;
          updateNotification(notifId, { ongoing: false, action: null, kind: "warning", title: "智能生成失败", content: "无法读取生成结果" });
        }
      };
      poll();
    }).catch(() => { smartJobActiveRef.current = false; updateNotification(notifId, { ongoing: false, kind: "warning", title: "智能生成失败", content: "请检查智能供应商连接" }); });
  }

  function generatePlaylistDescription() {
    const playlist = playlists.find((item) => item.id === editingPlaylistId);
    if (!playlist?.songs?.length) { showToast("请先创建播放列表并添加歌曲", "warning"); return; }
    const songs = playlist.songs.slice(0, 2000).map((song) => ({ title: song.title, artist: song.artist, album: song.album, year: song.year, genre: song.genre }));
    startSmartSuggestion("playlist_description", { name: newPlaylistName.trim() || playlist.name, songs }, (result) => {
      if (!result.description) return {};
      const suggestion = { playlistId: playlist.id, description: result.description };
      setPlaylistSuggestion(suggestion);
      return {
        title: "播放列表智能建议已生成",
        content: "",
        action: { label: "查看结果", onClick: () => { handleOpenPlaylistEdit(playlists.find((item) => item.id === playlist.id)); setPlaylistSuggestion(suggestion); } },
      };
    });
  }

    function handleRenamePlaylist(id, name) {
    setPlaylists((prev) =>
      prev.map((p) => (p.id === id ? { ...p, name } : p))
    );
  }

  // ---------- 更新播放列表（编辑封面/标题/描述） ----------
  function handleUpdatePlaylist(id, updated) {
    setPlaylists((prev) =>
      prev.map((p) => (p.id === id ? updated : p))
    );
  }

  // ---------- 统一通知（活动） ----------
  // 通知字段：{ id, kind, title, content, time, action?, ongoing, progress:{done,total}?, cover?, popup }
  // 规则：所有通知无 X；鼠标移入再移出即消失；非进行中 3.5s 自动消失；进行中不自动消失
  function addNotification({ kind = "info", title = "", content, action, ongoing = false, progress = null, cover = null, transient = false }) {
    const id = ++notifIdRef.current;
    setNotifications((prev) => [
      ...prev,
      { id, kind, title, content, action, ongoing, progress, cover, time: Date.now(), popup: true, transient },
    ]);
    // 瞬态通知（如「设置已保存」）不计入未读、不进活动盒子
    if (!transient) setUnreadCount((c) => c + 1);
    if (!ongoing) scheduleAutoDismiss(id);
    return id;
  }

  function updateNotification(id, patch) {
    setNotifications((prev) => prev.map((n) => {
      if (n.id !== id) return n;
      const next = { ...n, ...patch };
      if (n.ongoing && patch.ongoing === false) scheduleAutoDismiss(id);
      return next;
    }));
  }

  function scheduleAutoDismiss(id) {
    setTimeout(() => dismissNotificationAnim(id), 3500);
  }

  function dismissNotification(id) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, popup: false } : n)));
  }

  function dismissNotificationAnim(id) {
    if (leavingNotifId === id) return;
    setLeavingNotifId(id);
    setTimeout(() => {
      setLeavingNotifId(null);
      dismissNotification(id);
    }, 250);
  }

  // 兼容旧调用：统一写入活动通知
  function showToast(msg, type = "warning") {
    if (msg && typeof msg === "object") {
      addNotification({ kind: type, title: msg.title, content: msg.content, action: msg.action });
    } else {
      addNotification({ kind: type, title: msg || "" });
    }
  }

  // ---------- 活动面板开关 ----------
  function closeActivity() {
    if (activityLeaving) return;
    setActivityLeaving(true);
    setTimeout(() => {
      setActivityLeaving(false);
      setShowActivity(false);
    }, 280);
  }

  // 活动盒内「查看详情」：先关闭活动盒再打开匹配详情
  function openMatchDetailFromCard() {
    setActivityLeaving(false);
    setShowActivity(false);
    openMatchDetail("all");
  }

  // 专辑匹配独立进度（MusicEdit 上报）
  function handleAlbumMatchProgress({ status, done, total, message, skipped }) {
    if (status === "start") {
      albumMatchNotifIdRef.current = addNotification({
        kind: "progress_album_match", title: "正在匹配专辑", ongoing: true,
        progress: { done: 0, total }, content: null,
      });
    } else if (status === "update" && albumMatchNotifIdRef.current) {
      updateNotification(albumMatchNotifIdRef.current, { progress: { done, total } });
    } else if (status === "done" && albumMatchNotifIdRef.current) {
      updateNotification(albumMatchNotifIdRef.current, {
        ongoing: false, progress: null, popup: true,
        kind: (skipped || 0) > 0 ? "warning" : "success",
        title: "专辑匹配完成", content: message || `已匹配 ${done} 首歌曲`,
      });
    }
  }

  // ---------- 匹配轮询（按需：仅匹配进行中） ----------
  async function pollMatchProgress() {
    try {
      const res = await getMatchAllProgress();
      const status = res.status || "done";
      setMatchState({
        status,
        running: status === "matching",
        done: res.done || 0,
        total: res.total || 0,
        matched: res.matched || 0,
        failed: res.failed || 0,
        skipped: res.skipped || 0,
        current: res.current || null,
        error: res.error || null,
        log: res.log || [],
        cancelled: !!res.cancelled,
      });
      const prev = matchPrevStatusRef.current;
      matchPrevStatusRef.current = status;
      if (status === "matching" && prev !== "matching") {
        matchNotifIdRef.current = addNotification({
          kind: "progress_match", title: "正在匹配", ongoing: true,
          progress: { done: 0, total: res.total || 0 }, content: res.current || null,
        });
      } else if (status === "matching" && matchNotifIdRef.current) {
        updateNotification(matchNotifIdRef.current, {
          progress: { done: res.done || 0, total: res.total || 0 },
          content: res.current || null,
        });
      }
      if (prev === "matching" && status !== "matching") {
        handleMatchDone(res);
        stopMatchPoll();
      }
    } catch {
      // 后端不可用时静默
    }
  }

  function startMatchPoll() {
    if (matchPollRef.current) return;
    matchActiveRef.current = true;
    pollMatchProgress();
    matchPollRef.current = setInterval(pollMatchProgress, 1000);
  }

  function stopMatchPoll() {
    matchActiveRef.current = false;
    if (matchPollRef.current) {
      clearInterval(matchPollRef.current);
      matchPollRef.current = null;
    }
  }

  // 进度卡片（弹出区与活动面板共用）：导入可取消 / 匹配可查看详情 / 专辑纯进度
  const renderProgressCard = (n, { style, ...rest } = {}) => {
    const pct = n.progress && n.progress.total > 0
      ? Math.round((n.progress.done / n.progress.total) * 100)
      : 0;
    const container = { ...styles.toastNotify, ...styles.toastNotifyCard, ...styles.notifCard, ...(style || {}) };
    if (n.kind === "smart_progress") {
      return (
        <div style={container} {...rest}>
          <span style={styles.smartActivitySpinner} aria-label="智能体正在处理中" />
          <div style={styles.toastCardBody}>
            <p style={styles.importProgressTitle}>{n.title}</p>
            <p style={{ ...styles.matchProgressCurrent, margin: "5px 0 0" }}>{n.content || "智能体正在处理中"}</p>
          </div>
          {n.action && <button style={styles.importProgressCancel} onClick={n.action.onClick}>{n.action.label}</button>}
        </div>
      );
    }
    if (n.kind === "progress_import") {
      return (
        <div style={container} {...rest}>
          <p style={styles.importProgressTitle}>{n.title}</p>
          <div style={styles.importProgressRow}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
              <div style={styles.importProgressCover} className="notification-progress-cover">
                <span style={styles.importProgressCoverPlaceholder}><FaMusic size={15} /></span>
                {n.cover && (
                  <img src={n.cover} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} style={styles.importProgressCoverImg} />
                )}
              </div>
              <span style={styles.importProgressCount}>
                已导入：{n.progress?.done || 0}/{n.progress?.total || 0}
              </span>
            </div>
            <button style={styles.importProgressCancel} onClick={handleCancelImport}>取消</button>
          </div>
          <div style={{ ...styles.importProgressTrack, marginTop: "12px" }}>
            <div style={{ ...styles.importProgressFill, width: `${pct}%` }} />
          </div>
        </div>
      );
    }
    if (n.kind === "progress_album_match") {
      return (
        <div style={container} {...rest}>
          <p style={styles.importProgressTitle}>{n.title}</p>
          <div style={styles.importProgressRow}>
            <span style={styles.importProgressCount}>
              已匹配：{n.progress?.done || 0}/{n.progress?.total || 0}
            </span>
          </div>
          {n.content && <p style={styles.matchProgressCurrent}>{n.content}</p>}
          <div style={{ ...styles.importProgressTrack, marginTop: "12px" }}>
            <div style={{ ...styles.importProgressFill, width: `${pct}%` }} />
          </div>
        </div>
      );
    }
    if (n.kind === "progress_data") {
      return (
        <div style={container} {...rest}>
          <p style={styles.importProgressTitle}>{n.title}</p>
          <div style={styles.importProgressRow}>
            <span style={styles.importProgressCount}>{n.content || `已处理：${n.progress?.done || 0}/${n.progress?.total || 0}`}</span>
            {n.action?.jobId && <button style={styles.importProgressCancel} onClick={() => setDataCancelConfirm({ jobId: n.action.jobId, kind: n.action.kind, notificationId: n.id })}>取消</button>}
          </div>
          <div style={{ ...styles.importProgressTrack, marginTop: "12px" }}>
            <div style={{ ...styles.importProgressFill, width: `${pct}%` }} />
          </div>
        </div>
      );
    }
    if (n.kind === "progress_update") {
      return (
        <div style={container} {...rest}>
          <p style={styles.importProgressTitle}>{n.title}</p>
          <div style={styles.importProgressRow}>
            <span style={styles.importProgressCount}>已更新：{n.progress?.done || 0}/{n.progress?.total || 0}</span>
          </div>
          <div style={{ ...styles.importProgressTrack, marginTop: "12px" }}>
            <div style={{ ...styles.importProgressFill, width: `${pct}%` }} />
          </div>
        </div>
      );
    }
    return (
      <div style={container} {...rest}>
        <p style={styles.importProgressTitle}>{n.title}</p>
        <div style={styles.importProgressRow}>
          <span style={styles.importProgressCount}>
            已完成：{n.progress?.done || 0}/{n.progress?.total || 0}
          </span>
          <button style={styles.importProgressCancel} onClick={openMatchDetailFromCard}>查看详情</button>
        </div>
        {n.content && <p style={styles.matchProgressCurrent}>{n.content}</p>}
        <div style={{ ...styles.importProgressTrack, marginTop: "12px" }}>
          <div style={{ ...styles.importProgressFill, width: `${pct}%` }} />
        </div>
      </div>
    );
  };

  // ---------- 设置保存成功提示（瞬态：弹出即消失，不进活动盒子、不计未读） ----------
  function handleSettingsSaved() {
    addNotification({ kind: "success", title: "设置已保存", transient: true });
    saveAppSettings(collectAppSettings()).catch(() => {});
  }

  // ---------- 全部匹配完成：刷新专辑 / 艺人数据 + 匹配结束通知 ----------
  async function handleMatchDone(res) {
    if (res?.cancelled) {
      // 取消匹配：部分歌曲已写回，先刷新资料库数据（仅库内状态，不整页刷新）
      await refreshFromServer();
      if (matchNotifIdRef.current) {
        updateNotification(matchNotifIdRef.current, {
          kind: "warning", ongoing: false, progress: null, popup: true,
          title: "已取消匹配",
          content: `已匹配 ${res.matched || 0} 首歌曲`,
          action: { label: "查看详情", onClick: () => openMatchDetail("all") },
        });
      }
      return;
    }
    try {
      const data = await getMusicList();
      if (Array.isArray(data)) {
        const serverAlbums = buildAlbumsFromServer(data);
        // 整体替换服务端专辑（去重本地重复专辑），使匹配写入的信息同步显示
        setAlbums((prev) => mergeServerAlbums(prev, serverAlbums));
        // 同步本地索引（离线缓存保持一致）
        serverAlbums.forEach((a) =>
          (a.songs || []).forEach((s) => {
            if (!s.file_path) return;
            saveSongToIndex({
              title: s.title,
              artist: s.artist,
              album: s.album,
              album_artist: s.album_artist,
              year: s.year,
              genre: s.genre,
              trackNo: s.trackNo,
              discNo: s.discNo,
              composer: s.composer,
              lyricist: s.lyricist,
              publisher: s.publisher,
              comment: s.comment,
              duration: s.duration,
              bitrate: s.bitrate,
              codec: s.codec,
              file_path: s.file_path,
              cover_path: s.coverURL ? s.coverURL.replace(/^.*?\/data\//, "") : null,
              hash: s.hash,
              match_source: s.match_source,
              importTime: s.importTime ?? Date.now(),
              modification_time: s.modification_time,
            });
          })
        );
      }
    } catch (err) {
      console.warn("匹配后刷新音乐列表失败:", err);
    }
    try {
      const data = await getArtists();
      if (data && typeof data === "object") setArtistRecords(data);
    } catch (err) {
      console.warn("匹配后刷新艺人数据失败:", err);
    }
    const matched = res?.matched || 0;
    const skipped = res?.skipped || 0;
    const failed = res?.failed || 0;
    const hasFail = skipped + failed > 0;
    if (matchNotifIdRef.current) {
      updateNotification(matchNotifIdRef.current, {
        ongoing: false, progress: null, popup: true,
        kind: hasFail ? "warning" : "success",
        title: "匹配结束",
        content: hasFail
          ? `成功 ${matched} 条，失败 ${failed}，跳过 ${skipped}`
          : `成功写入 ${matched} 条信息`,
        action: hasFail
          ? { label: "查看详情", onClick: () => openMatchDetail("failed") }
          : undefined,
      });
    }
  }

  // ---------- 全部匹配：进度数据（供设置面板 / 详情窗口 / 进度通知使用） ----------
  const [matchState, setMatchState] = useState({
    status: "done", running: false, done: 0, total: 0,
    matched: 0, failed: 0, skipped: 0, current: null, error: null,
    log: [], cancelled: false,
  });
  const matchPrevStatusRef = useRef("done");
  const [showMatchDetail, setShowMatchDetail] = useState(false);
  const [matchDetailFilter, setMatchDetailFilter] = useState("all");

  function openMatchDetail(filter = "all") {
    setMatchDetailFilter(filter);
    setShowMatchDetail(true);
  }

  async function handleCancelMatch() {
    try {
      await cancelMatchAll();
    } catch (err) {
      console.warn("取消匹配失败:", err);
    }
  }

  // 挂载时一次性探测：若后端已有匹配在跑则启动轮询（兼容刷新后继续显示）
  useEffect(() => {
    (async () => {
      try {
        const res = await getMatchAllProgress();
        if ((res.status || "done") === "matching") startMatchPoll();
      } catch {
        // 后端不可用时静默
      }
    })();
    return () => stopMatchPoll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- 导入音频文件 ----------
  // 上传单个文件并构建条目（优先上传后端持久化，失败回退本地导入）
  async function buildEntryFromFile(f, meta, signal) {
    try {
      const res = await uploadMusic(f, signal);
      if (res.status === "ok") {
        const m = res.meta || {};
        const entry = {
          title: res.title,
          artist: res.artist || "未知艺术家",
          album: res.album || "未知专辑",
          album_artist: m.album_artist || null,
          year: m.year || null,
          genre: m.genre || null,
          duration: m.duration || null,
          url: getAssetUrl(res.file_path ? `/library/${res.file_path}` : null),
          file_path: res.file_path || null,
          coverURL: res.cover_url ? getAssetUrl(res.cover_url) : null,
          cover_path: (m && m.cover_path) || null,
          trackNo: m.trackNo || null,
          discNo: m.discNo || null,
          composer: m.composer || null,
          lyricist: m.lyricist || null,
          publisher: m.publisher || null,
          comment: m.comment || null,
          bitrate: m.bitrate || null,
          // 优先用前端解析的真实编码（ALAC 等浏览器不可播格式）
          codec: (meta && meta.codec) || m.codec || null,
          container: (meta && meta.container) || m.codec || null,
          importTime: nowTs(),
        };
        saveSongToIndex(entry);
        return entry;
      }
    } catch (err) {
      // 取消上传时重新抛出，不回落本地导入
      if (err && err.name === "AbortError") throw err;
      console.warn("后端上传失败，使用本地导入:", err);
    }
    const mm = meta || await readMetadata(f);
    return { ...mm, url: URL.createObjectURL(f) };
  }

  // 将找到的源文件写回缺失歌曲的既有路径，并保留匹配后的资料与关联关系。
  async function restoreMissingSong(file, target, signal) {
    const result = await restoreMissingMusic(target.file_path, file, signal);
    const restoredSong = buildIndexSong(target, result.song || {});
    if (!restoredSong.coverURL) restoredSong.coverURL = target.coverURL || null;
    saveSongToIndex(restoredSong);
    setAlbums((prev) => prev.map((album) => {
      const containsTarget = (album.songs || []).some((song) => song.file_path === target.file_path);
      if (!containsTarget) return album;
      return {
        ...album,
        coverURL: album.coverURL || restoredSong.coverURL || null,
        year: album.year || restoredSong.year || null,
        songs: album.songs.map((song) => song.file_path === target.file_path ? restoredSong : song),
      };
    }));
    setMissingSongs((prev) => {
      const next = new Set(prev);
      next.delete(target.file_path);
      return next;
    });
    await refreshFromServer({ replace: true });
    return restoredSong;
  }

  // 将条目按专辑分组并合并到 albums 状态
  function finishImport(entries) {
    const albumMap = new Map();
    for (const entry of entries) {
      const title = entry.album || "未知专辑";
      // 专辑归属键：专辑艺人 + 专辑名（无专辑艺人回退为曲目艺人）
      const key = `${entry.album_artist || entry.artist || "未知艺术家"}|${title}`;
      if (!albumMap.has(key)) {
        albumMap.set(key, {
          id: newAlbumId(),
          title,
          artist: entry.album_artist || entry.artist || "未知艺术家",
          album_artist: entry.album_artist || null,
          year: entry.year || null,
          genre: entry.genre || null,
          publisher: entry.publisher || null,
          coverURL: entry.coverURL,
          importTime: nowTs(),
          songs: [],
        });
      }
      const album = albumMap.get(key);
      album.songs.push({ ...entry });
      if (!album.coverURL && entry.coverURL) album.coverURL = entry.coverURL;
      if (!album.genre && entry.genre) album.genre = entry.genre;
    }
    const newAlbums = Array.from(albumMap.values());
    setAlbums((prev) => {
      const albumKey = (a) => `${a.album_artist || a.artist || "未知艺术家"}|${a.title}`;
      const merged = new Map();
      for (const a of prev) merged.set(albumKey(a), { ...a, songs: [...a.songs] });
      for (const a of newAlbums) {
        const k = albumKey(a);
        if (merged.has(k)) {
          const existing = merged.get(k);
          const existingUrls = new Set(existing.songs.map((s) => s.url));
          for (const s of a.songs) {
            if (!existingUrls.has(s.url)) existing.songs.push(s);
          }
          if (!existing.coverURL && a.coverURL) existing.coverURL = a.coverURL;
          if (!existing.year && a.year) existing.year = a.year;
          if ((existing.artist === "未知艺术家" || !existing.artist) && a.artist && a.artist !== "未知艺术家") existing.artist = a.artist;
          if (!existing.genre && a.genre) existing.genre = a.genre;
        } else {
          merged.set(k, { ...a, songs: [...a.songs] });
        }
      }
      return Array.from(merged.values());
    });
  }

  // 导入完成上报：合并进 albums，并将导入进度通知更新为「导入完成」
  function finishImportResult(entries, opts = {}) {
    const { duplicate = [], unplayable = [], nonMusic = 0, restored = 0 } = opts;
    finishImport(entries);
    const hasDup = duplicate.length > 0;
    const hasUnplayable = unplayable.length > 0;
    const parts = [];
    if (restored > 0) parts.push(`已恢复 ${restored} 首歌曲`);
    if (hasDup && hasUnplayable) parts.push("重复歌曲和无法播放歌曲已经跳过");
    else if (hasDup) parts.push("重复音乐已跳过");
    else if (hasUnplayable) parts.push("无法播放歌曲已跳过");
    if (nonMusic > 0) parts.push(`已忽略 ${nonMusic} 个非音乐文件`);
    const content = parts.join("；");
    const hasSkip = hasDup || hasUnplayable;

    // 更新导入进度通知为「导入完成」（非进行中 → 3.5s 后自动消失；有跳过时提供「查看详情」）
    if (importNotifIdRef.current) {
      updateNotification(importNotifIdRef.current, {
        ongoing: false, progress: null, cover: null, popup: true,
        kind: hasSkip ? "warning" : "success",
        title: "导入完成",
        content: hasSkip
          ? `已导入 ${entries.length} 首，${content}`
          : entries.length > 0
            ? `已导入 ${entries.length} 首歌曲`
            : content || "已添加到资料库",
        action: hasSkip
          ? { label: "查看详情", onClick: () => setImportSkipDetail({ duplicate, unplayable }) }
          : undefined,
      });
    } else if (entries.length > 0) {
      showToast({ title: "导入完成", content }, "success");
    }

    if (nonMusic > 0 && !hasSkip && entries.length === 0) showToast(`已忽略 ${nonMusic} 个非音乐文件`, "warning");
  }

  // 一致性确认继续后推进：导入该文件并处理下一项 / 收尾
  function advanceAfterConsistency(context, confirmedEntry) {
    const { entries, unplayable, unplayableSkippedList, duplicateSkippedList, skippedNonMusic, pendingFiles } = context;
    const newEntries = confirmedEntry ? [...entries, confirmedEntry] : entries;
    if (pendingFiles.length > 0) {
      const [item, ...rest] = pendingFiles;
      setImportConfirm({ item, context: { ...context, entries: newEntries, pendingFiles: rest } });
      return;
    }
    handleUnplayableStage({ entries: newEntries, unplayable, unplayableSkippedList, duplicateSkippedList, skippedNonMusic });
  }

  // 一致性确认弹窗：继续导入
  async function handleConsistencyConfirm() {
    const c = importConfirm;
    if (!c) return;
    const { item, context } = c;
    setImportConfirm(null);
    let entry = null;
    try {
      entry = await buildEntryFromFile(item.file, item.meta);
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
    advanceAfterConsistency(context, entry);
  }

  // 一致性确认弹窗：取消（跳过该文件）
  function handleConsistencyCancel() {
    const c = importConfirm;
    if (!c) return;
    setImportConfirm(null);
    advanceAfterConsistency(c.context, null);
  }

  // 处理不可播放确认阶段（一致性队列处理完毕后的收尾）
  function handleUnplayableStage(ctx) {
    const { entries, unplayable, unplayableSkippedList, duplicateSkippedList, skippedNonMusic } = ctx;
    if (unplayable.length > 0) {
      const choice = importUnplayableChoiceRef.current;
      if (choice === "continue") {
        // 会话内已记忆「继续」：直接导入全部
        (async () => {
          const extra = await Promise.all(unplayable.map((p) => buildEntryFromFile(p.file, p.meta)));
          finishImportResult([...entries, ...extra], { duplicate: duplicateSkippedList, unplayable: unplayableSkippedList, nonMusic: skippedNonMusic });
        })();
      } else if (choice === "cancel") {
        // 会话内已记忆「取消」：跳过不可播放，仅导入可播放的
        const skipped = [
          ...(unplayableSkippedList || []),
          ...unplayable.map((p) => ({
            title: p.meta?.title || p.file.name.replace(/\.[^/.]+$/, ""),
            artist: p.meta?.artist || "未知艺术家",
          })),
        ];
        finishImportResult(entries, { duplicate: duplicateSkippedList, unplayable: skipped, nonMusic: skippedNonMusic });
      } else {
        setImportRememberChoice(false);
        setImportPending({ entries, unplayable, unplayableSkippedList, duplicateSkippedList, skippedNonMusic });
      }
      return;
    }
    finishImportResult(entries, { duplicate: duplicateSkippedList, unplayable: unplayableSkippedList, nonMusic: skippedNonMusic });
  }

  // 判断导入文件与目标歌曲是否为同一首（元信息已匹配；哈希一致或目标无记录哈希视为同一首）
  async function isSameSong(file, target) {
    if (!target || !target.hash) return true;
    const h = await fileSha256(file);
    if (!h) return true;
    return h === target.hash;
  }

  // 打开本地播放器播放资料库中的音乐文件
  async function handleOpenLocalFile(filePath) {
    try {
      const res = await openMusicFile(filePath);
      if (res && res.status === "error") {
        showToast(res.msg || "打开文件失败", "warning");
      }
    } catch (err) {
      console.warn("打开本地文件失败:", err);
      showToast("打开文件失败", "warning");
    }
  }

  // 缺失歌曲「查找」：用户重新选择文件后导入（走一致性校验）
  async function handleReimportSelect(e) {
    const target = missingDialogSong;
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!target || files.length === 0) return;
    setMissingDialogSong(null);
    await processFiles(files, { reimportTarget: target });
  }

  async function handleImportFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    await processFiles(files);
  }

  // 导入音乐文件核心逻辑（文件选择 / 拖拽 / 查找重导入共用）
  async function processFiles(fileList, opts = {}) {
    const { reimportTarget = null } = opts;
    const selectedFiles = Array.from(fileList || []);
    if (selectedFiles.length === 0) return;

    // 过滤非音乐文件
    const musicFiles = [];
    let skippedNonMusic = 0;
    for (const f of selectedFiles) {
      if (isMusicFile(f.name)) musicFiles.push(f);
      else skippedNonMusic++;
    }

    // 重置导入状态
    importCancelledRef.current = false;
    const abort = new AbortController();
    importAbortRef.current = abort;
    if (musicFiles.length > 0) {
      importNotifIdRef.current = addNotification({
        kind: "progress_import", title: "正在导入", ongoing: true,
        progress: { done: 0, total: musicFiles.length }, cover: null,
      });
    }

    // 设置开关：开启时跳过不支持播放的格式（默认开启，不做任何导入）
    const skipUnplayable = localStorage.getItem("import-skip-unplayable") !== "false";

    // 构建已有歌曲的元信息索引（title|artist|album → song），供重复/一致性判断
    const existingByMeta = new Map();
    if (!reimportTarget) {
      albums.forEach((a) => (a.songs || []).forEach((s) => {
        const k = songDupKey(s.title, s.artist, s.album);
        if (k !== "||" && !existingByMeta.has(k)) existingByMeta.set(k, s);
      }));
    }

    // 解析编码，区分可播放 / 不可播放；做重复与一致性校验
    const entries = [];
    const unplayable = []; // 需要确认的不可播放文件
    const unplayableSkippedList = []; // 已跳过的不可播放文件（标题/艺人）
    const duplicateSkippedList = []; // 重复导入被跳过的文件（标题/艺人）
    const pendingFiles = []; // 需要一致性确认的文件 { file, meta, replace }
    let restoredCount = 0;
    let mismatchItem = null;
    let reimportFailed = false;
    let done = 0;
    for (const f of musicFiles) {
      if (importCancelledRef.current) break;
      let meta = null;
      try {
        meta = await readMetadata(f);
      } catch {
        // 解析失败按普通文件处理
      }
      if (importCancelledRef.current) break;
      if (importNotifIdRef.current) updateNotification(importNotifIdRef.current, { cover: meta?.coverURL || null });

      const mTitle = meta?.title || f.name.replace(/\.[^/.]+$/, "");
      const mArtist = meta?.artist || "";
      const mAlbum = meta?.album || "";
      const metaKey = songDupKey(mTitle, mArtist, mAlbum);

      // 查找缺失歌曲时，完全一致的来源直接写回原路径；不一致则由用户决定替换或新增。
      if (reimportTarget) {
        const targetKey = songDupKey(reimportTarget.title, reimportTarget.artist, reimportTarget.album);
        if (metaKey === targetKey) {
          try {
            await restoreMissingSong(f, reimportTarget, abort.signal);
            restoredCount++;
          } catch (err) {
            if (err && err.name === "AbortError") break;
            reimportFailed = true;
            finishReimportFailure(err?.message || "恢复缺失音乐失败");
          }
        } else {
          mismatchItem = { file: f, meta, target: reimportTarget };
        }
        done++;
        if (importNotifIdRef.current) updateNotification(importNotifIdRef.current, { progress: { done, total: musicFiles.length } });
        if (mismatchItem) break;
        continue;
      }

      // 确定比对目标 / 一致性类型
      let target;
      let replaceType = null; // "replace"（内容不一致，覆盖）| "new"（不同歌曲，仅新增）
      target = metaKey !== "||" ? existingByMeta.get(metaKey) : undefined;

      if (target) {
        // 元信息匹配 → 一致性校验（哈希）
        const same = await isSameSong(f, target);
        if (!same) {
          // 内容不一致 → 待确认（替换）
          pendingFiles.push({ file: f, meta, replace: true });
        } else {
          // 同一首 → 归位：缺失则恢复导入，已存在则静默跳过（记入重复列表）
          const isMissing = target.file_path && missingSongs.has(target.file_path);
          if (isMissing || reimportTarget) {
            try {
              entries.push(await buildEntryFromFile(f, meta, abort.signal));
            } catch (err) {
              if (err && err.name === "AbortError") break;
            }
          } else {
            duplicateSkippedList.push({ title: mTitle, artist: mArtist || "未知艺术家" });
          }
        }
        done++;
        if (importNotifIdRef.current) updateNotification(importNotifIdRef.current, { progress: { done, total: musicFiles.length } });
        continue;
      }

      if (replaceType === "new") {
        // 元信息不匹配（查找流程）→ 待确认（仅新增）
        pendingFiles.push({ file: f, meta, replace: false });
        done++;
        if (importNotifIdRef.current) updateNotification(importNotifIdRef.current, { progress: { done, total: musicFiles.length } });
        continue;
      }

      // 新歌：按可播放性处理
      if (meta && isUnplayableCodec(meta.codec || meta.container)) {
        if (skipUnplayable) {
          unplayableSkippedList.push({ title: mTitle, artist: mArtist || "未知艺术家" });
        } else {
          unplayable.push({ file: f, meta });
        }
      } else {
        try {
          entries.push(await buildEntryFromFile(f, meta, abort.signal));
        } catch (err) {
          // 取消上传 → 停止
          if (err && err.name === "AbortError") break;
        }
      }
      done++;
      if (importNotifIdRef.current) updateNotification(importNotifIdRef.current, { progress: { done, total: musicFiles.length } });
    }

    if (importCancelledRef.current) {
      // 取消：保留已导入部分，丢弃未处理的队列
      abort.abort();
      finishImportResult(entries, { duplicate: duplicateSkippedList, unplayable: unplayableSkippedList, nonMusic: skippedNonMusic });
      return;
    }

    if (mismatchItem) {
      setReimportMismatch({ ...mismatchItem, choice: "merge" });
      return;
    }

    if (reimportTarget) {
      if (reimportFailed) return;
      finishImportResult([], { duplicate: duplicateSkippedList, unplayable: unplayableSkippedList, nonMusic: skippedNonMusic, restored: restoredCount });
      return;
    }

    // 先处理一致性确认队列，再处理不可播放确认
    if (pendingFiles.length > 0) {
      const [item, ...rest] = pendingFiles;
      setImportConfirm({
        item,
        context: { entries, unplayable, unplayableSkippedList, duplicateSkippedList, skippedNonMusic, pendingFiles: rest },
      });
      return;
    }

    handleUnplayableStage({ entries, unplayable, unplayableSkippedList, duplicateSkippedList, skippedNonMusic });
  }

  // 取消导入：停止剩余文件，保留已导入的
  function handleCancelImport() {
    importCancelledRef.current = true;
    if (importAbortRef.current) {
      importAbortRef.current.abort();
    }
  }

  // ---------- 拖拽添加音乐 ----------
  function hasDragFiles(e) {
    return !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files"));
  }

  function isExcludedDropZone(el) {
    return !!(el && el.closest && el.closest(".app-sidebar, .app-topbar, .app-player-bar"));
  }

  function handleDragEnter(e) {
    if (!hasDragFiles(e)) return;
    if (isExcludedDropZone(e.target)) {
      dragExcludedRef.current = true;
      setIsDragOver(false);
      return;
    }
    dragExcludedRef.current = false;
    setIsDragOver(true);
  }

  function handleDragOver(e) {
    if (!hasDragFiles(e)) return;
    if (isExcludedDropZone(e.target)) {
      dragExcludedRef.current = true;
      setIsDragOver(false);
      return; // 排除区不 preventDefault → 不可投放
    }
    dragExcludedRef.current = false;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setIsDragOver(true);
  }

  function handleDrop(e) {
    e.preventDefault();
    setIsDragOver(false);
    const wasExcluded = dragExcludedRef.current;
    dragExcludedRef.current = false;
    if (wasExcluded) return;
    if (hasDragFiles(e)) {
      processFiles(e.dataTransfer.files);
    }
  }

  // 离开窗口（或拖拽取消）时隐藏拖拽遮罩：窗口级 dragleave 且 relatedTarget 为 null
  useEffect(() => {
    function onWindowDragLeave(e) {
      if (!e.relatedTarget) setIsDragOver(false);
    }
    function onWindowDrop() {
      setIsDragOver(false);
    }
    window.addEventListener("dragleave", onWindowDragLeave);
    window.addEventListener("drop", onWindowDrop);
    return () => {
      window.removeEventListener("dragleave", onWindowDragLeave);
      window.removeEventListener("drop", onWindowDrop);
    };
  }, []);

  // 不可播放格式：用户选择继续
  function handleUnplayableContinue() {
    const pending = importPending;
    setImportPending(null);
    if (!pending) return;
    (async () => {
      const extra = await Promise.all(pending.unplayable.map((p) => buildEntryFromFile(p.file, p.meta)));
      finishImportResult([...pending.entries, ...extra], {
        duplicate: pending.duplicateSkippedList || [],
        unplayable: pending.unplayableSkippedList || [],
        nonMusic: pending.skippedNonMusic || 0,
      });
    })();
  }

  // 不可播放格式：用户选择取消（跳过不可播放，仅导入可播放的）
  function handleUnplayableCancel() {
    const pending = importPending;
    setImportPending(null);
    if (!pending) return;
    const skipped = [
      ...(pending.unplayableSkippedList || []),
      ...pending.unplayable.map((p) => ({
        title: p.meta?.title || p.file.name.replace(/\.[^/.]+$/, ""),
        artist: p.meta?.artist || "未知艺术家",
      })),
    ];
    finishImportResult(pending.entries, {
      duplicate: pending.duplicateSkippedList || [],
      unplayable: skipped,
      nonMusic: pending.skippedNonMusic || 0,
    });
  }

        // ---------- 点击专辑卡片 — 打开专辑详情页 ----------
    function handleOpenAlbumDetail(albumId) {
      pushNavOrigin();
      setDetailAlbumId(albumId);
      setDetailArtistName(null);
      // 进入专辑详情：按需检测该专辑歌曲是否缺失
      const album = albums.find((a) => a.id === albumId);
      if (album) runFileCheck((album.songs || []).map((s) => s.file_path));
    }

        // ---------- 从卡片播放按钮播放/暂停 ----------
    function handleQuickPlay(albumId) {
      const album = albums.find((a) => a.id === albumId);
      if (!album || album.songs.length === 0) return;

      if (currentAlbumId === albumId) {
        // 同一专辑：切换播放/暂停
        togglePlay();
      } else {
        setCurrentPlaylistId(null); // 切换到专辑播放，清除播放列表来源
        setPlayQueue([]);
        setCurrentAlbumId(albumId);
        setCurrentSongIndex(0);
        setIsPlaying(true);
      }
    }

    // ---------- 从详情页播放整个专辑 ----------
  function handlePlayAlbumFromDetail() {
    const album = albums.find((a) => a.id === detailAlbumId);
    if (!album || album.songs.length === 0) return;

    // 跳过不可播放歌曲，从第一首可播放的开始
    const firstPlayable = album.songs.findIndex((s) => songPlayable(s));
    if (firstPlayable === -1) {
      setUnplayableDialogSong(album.songs[0]);
      return;
    }

    if (currentAlbumId === detailAlbumId) {
      // 同一专辑：切换播放/暂停
      togglePlay();
    } else {
      setCurrentPlaylistId(null); // 切换到专辑播放，清除播放列表来源
      setPlayQueue([]);
      setCurrentAlbumId(detailAlbumId);
      setCurrentSongIndex(firstPlayable);
      setIsPlaying(true);
    }
  }

  // ---------- 从详情页选择歌曲播放 ----------
  function handlePlaySongFromDetail(songIndex) {
    const album = albums.find((a) => a.id === detailAlbumId);
    const song = album?.songs?.[songIndex];
    if (song && !songPlayable(song)) { setUnplayableDialogSong(song); return; }
    setCurrentPlaylistId(null); // 切换到专辑播放，清除播放列表来源
    setPlayQueue([]);
    setCurrentAlbumId(detailAlbumId);
    setCurrentSongIndex(songIndex);
    setIsPlaying(true);
  }

    // ---------- 返回栈：记录当前视图，供返回恢复 ----------
  function pushNavOrigin() {
    setNavStack((prev) => {
      const frame = {
        kind: detailVideoId ? "video" : detailAlbumId ? "album" : detailPlaylistId ? "playlist" : detailArtistName ? "artist" : "nav",
        id: detailVideoId || detailAlbumId || detailPlaylistId || null,
        name: detailArtistName || null,
        activeNav,
        filterText,
      };
      return [...prev, frame].slice(-10);
    });
  }

  function popNavBack() {
    if (navStack.length === 0) return false;
    const frame = navStack[navStack.length - 1];
    setNavStack((prev) => prev.slice(0, -1));
    setDetailVideoId(null);
    if (frame.kind === "video") {
      setDetailVideoId(frame.id);
      setDetailAlbumId(null);
      setDetailPlaylistId(null);
      setDetailArtistName(null);
      setActiveNav(frame.activeNav || "videos");
    } else if (frame.kind === "album") {
      setDetailAlbumId(frame.id);
      setDetailPlaylistId(null);
      setDetailArtistName(null);
      setActiveNav(frame.activeNav || "library");
    } else if (frame.kind === "artist") {
      setDetailAlbumId(null);
      setDetailPlaylistId(null);
      setDetailArtistName(frame.name);
      setActiveNav("artists");
    } else if (frame.kind === "playlist") {
      setDetailAlbumId(null);
      setDetailArtistName(null);
      setDetailPlaylistId(frame.id);
      setActiveNav(frame.activeNav || "playlists");
    } else {
      setDetailAlbumId(null);
      setDetailPlaylistId(null);
      setDetailArtistName(null);
      setActiveNav(frame.activeNav || "library");
    }
    if (frame.activeNav === "search" && frame.filterText !== undefined) {
      setFilterText(frame.filterText);
    }
    return true;
  }

    // ---------- 关闭详情页 ----------
  function handleCloseDetail() {
    if (!popNavBack()) setDetailAlbumId(null);
  }

  // ---------- 打开播放列表详情 ----------
  function handleOpenPlaylistDetail(playlistId) {
    pushNavOrigin();
    setDetailPlaylistId(playlistId);
    // 进入播放列表详情：按需检测该播放列表歌曲是否缺失
    const pl = playlists.find((p) => p.id === playlistId);
    if (pl) runFileCheck((pl.songs || []).map((s) => s.file_path));
  }

  function finishReimportFailure(message) {
    if (importNotifIdRef.current) {
      updateNotification(importNotifIdRef.current, {
        ongoing: false, progress: null, cover: null, popup: true,
        kind: "warning", title: "导入失败", content: message,
      });
    } else {
      showToast(message, "warning");
    }
  }

  async function handleReimportMismatchConfirm() {
    const choice = reimportMismatch;
    if (!choice) return;
    setReimportMismatch(null);
    try {
      if (choice.choice === "merge") {
        await restoreMissingSong(choice.file, choice.target);
        finishImportResult([], { restored: 1 });
        return;
      }
      const skipUnplayable = localStorage.getItem("import-skip-unplayable") !== "false";
      if (choice.meta && isUnplayableCodec(choice.meta.codec || choice.meta.container) && skipUnplayable) {
        finishImportResult([], {
          unplayable: [{ title: choice.meta.title || choice.file.name.replace(/\.[^/.]+$/, ""), artist: choice.meta.artist || "未知艺术家" }],
        });
        return;
      }
      if (choice.meta && isUnplayableCodec(choice.meta.codec || choice.meta.container)) {
        setImportRememberChoice(false);
        setImportPending({ entries: [], unplayable: [{ file: choice.file, meta: choice.meta }], unplayableSkippedList: [], duplicateSkippedList: [], skippedNonMusic: 0 });
        return;
      }
      const entry = await buildEntryFromFile(choice.file, choice.meta);
      finishImportResult(entry ? [entry] : []);
    } catch (err) {
      finishReimportFailure(err?.message || "恢复缺失音乐失败");
    }
  }

  function handleOpenVideoDetail(videoId) {
    setEditVideoOnOpenId(null);
    pushNavOrigin();
    setDetailVideoId(videoId);
  }

  function handleOpenVideoEditor(videoId) {
    pushNavOrigin();
    setEditVideoOnOpenId(videoId);
    setDetailVideoId(videoId);
  }

  function handleCloseVideoDetail() {
    setEditVideoOnOpenId(null);
    setDetailVideoId(null);
    popNavBack();
  }

  function handleDataJobStarted({ kind, jobId }) {
    const notificationId = addNotification({ kind: "progress_data", title: kind === "export" ? "正在导出数据" : "正在导入数据", ongoing: true, progress: { done: 0, total: 0 }, content: "正在准备…", action: { jobId, kind } });
    const poll = async () => {
      try {
        const job = await getDataJob(jobId);
        updateNotification(notificationId, { progress: { done: job.done || 0, total: job.total || 0 }, content: job.message || "正在处理" });
        if (job.status === "queued" || job.status === "running") {
          updateNotification(notificationId, { action: job.cancellable === false ? null : { jobId, kind } });
          return setTimeout(poll, 400);
        }
        if (job.status === "done") {
          updateNotification(notificationId, { ongoing: false, kind: "success", action: null, title: kind === "export" ? "数据导出成功" : "数据导入成功", content: job.message || "操作已完成" });
          if (kind === "export") {
            const link = document.createElement("a");
            link.href = getDataExportDownloadUrl(jobId);
            link.click();
          } else {
            await refreshFromServer();
            const [nextPlaylists, nextArtists, nextSettings] = await Promise.all([getPlaylists(), getArtists(), getSettings()]);
            setPlaylists(ensureDefaultPlaylists(normalizePlaylists(nextPlaylists)));
            setArtistRecords(nextArtists || {});
            const importedSettings = nextSettings?.app_settings;
            if (importedSettings && typeof importedSettings === "object") {
              APP_SETTING_KEYS.forEach((key) => {
                if (importedSettings[key] !== undefined && importedSettings[key] !== null) localStorage.setItem(key, String(importedSettings[key]));
              });
              setHideEmptyArtists(localStorage.getItem("artist-hide-empty") !== "false");
              setVolume(normalizeStoredVolume(importedSettings["player-volume"]));
            }
          }
          return;
        }
        if (job.status === "cancelled") {
          updateNotification(notificationId, { ongoing: false, kind: "warning", action: null, title: kind === "export" ? "已取消导出" : "已取消导入", content: job.message || "操作已取消" });
          return;
        }
        updateNotification(notificationId, { ongoing: false, kind: "warning", action: null, title: kind === "export" ? "数据导出失败" : "数据导入失败", content: job.error || job.message || "请检查备份包后重试" });
      } catch {
        updateNotification(notificationId, { ongoing: false, kind: "warning", action: null, title: "数据任务失败", content: "无法获取任务进度" });
      }
    };
    poll();
  }

  async function handleConfirmCancelDataJob() {
    const target = dataCancelConfirm;
    if (!target) return;
    setDataCancelConfirm(null);
    try {
      const result = await cancelDataJob(target.jobId);
      if (result?.status === "locked") {
        updateNotification(target.notificationId, { action: null, content: result.msg || "当前阶段不能取消" });
      } else {
        updateNotification(target.notificationId, { action: null, content: "正在取消…" });
      }
    } catch {
      updateNotification(target.notificationId, { content: "取消请求失败，请稍后重试" });
    }
  }

  // 播放列表保存的是歌曲快照；优先用 file_path 定位其所属专辑，兼容旧快照再回退 URL/专辑名。
  function handleOpenAlbumFromPlaylistSong(song) {
    const albumKey = song.albumKey || `${song.album_artist || song.artist || ""}|${song.album || ""}`;
    const album = albums.find((item) => (item.songs || []).some((candidate) =>
      (song.file_path && candidate.file_path === song.file_path)
      || (!song.file_path && song.url && candidate.url === song.url)
    )) || albums.find((item) => `${item.album_artist || item.artist || ""}|${item.title || ""}` === albumKey)
      || albums.find((item) => item.title === song.album);
    if (album) handleOpenAlbumDetail(album.id);
  }

    // ---------- 关闭播放列表详情 ----------
    function handleClosePlaylistDetail() {
      if (!popNavBack()) setDetailPlaylistId(null);
    }

        // ---------- 点击艺人卡片 / 专辑详情页艺人链接 — 打开艺人详情页 ----------
    function handleOpenArtistDetail(artistName) {
      pushNavOrigin();
      setDetailAlbumId(null); // 关闭专辑详情页（如果是从专辑详情页跳转来的）
      setDetailPlaylistId(null); // 关闭播放列表详情页
      setDetailArtistName(artistName);
      setActiveNav("artists");
    }

        // ---------- 关闭艺人详情页 ----------
    function handleCloseArtistDetail() {
      if (!popNavBack()) setDetailArtistName(null);
    }

    // ---------- 打开艺人编辑 ----------
    function handleOpenArtistEdit(artistName) {
      setArtistEditTarget({
        artist: artistName,
        record: artistRecords[artistName] || {},
        albums: localStorage.getItem("edit-auto-organize-collab") !== "false"
          ? albums.filter((a) => albumBelongsToArtist(a, artistName))
          : albums.filter((a) => a.artist === artistName),
      });
    }

    // ---------- 艺人编辑保存 ----------
    function handleSaveArtist(updated) {
      if (!updated || !updated.name) return;
      setArtistEditTarget(null);
      setArtistRecords((prev) => ({ ...prev, [updated.name]: updated }));
    }

    // ---------- 移除空艺人（删除编辑记录，回到艺人栏） ----------
    function handleRemoveArtistRecord(name) {
      setArtistEditTarget(null);
      setArtistRecords((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      handleNavChange("artists");
    }

    // ---------- 删除歌曲/专辑后：处理空艺人（按开关保留或删除） ----------
    function syncArtistsAfterDelete(prevAlbums, nextAlbums) {
      const prevArtists = new Set(prevAlbums.map((a) => a.artist));
      const currArtists = new Set(nextAlbums.map((a) => a.artist));
      const emptied = Array.from(prevArtists).filter((n) => !currArtists.has(n));
      if (emptied.length === 0) return;
      const keep = localStorage.getItem("artist-keep-empty") !== "false";
      if (keep) {
        // 保留空艺人：无记录则建档
        setArtistRecords((prev) => {
          const next = { ...prev };
          emptied.forEach((n) => {
            if (!next[n]) next[n] = { cover_url: null, bio: "", genres: [] };
          });
          return next;
        });
        emptied.forEach((n) => saveArtist({ name: n, bio: "", genres: [] }).catch(() => {}));
      } else {
        // 自动删除空艺人
        setArtistRecords((prev) => {
          const next = { ...prev };
          emptied.forEach((n) => { delete next[n]; });
          return next;
        });
        emptied.forEach((n) => deleteArtist(n).catch(() => {}));
      }
    }

    // ---------- 从艺人详情页点击专辑卡片 — 打开专辑详情页 ----------
    function handleOpenAlbumFromArtist(albumId) {
      pushNavOrigin();
      setDetailAlbumId(albumId);
      // 关闭艺人详情页，进入专辑详情页
      setDetailArtistName(null);
    }

    // ---------- 从艺人详情页播放专辑 ----------
    function handlePlayAlbumFromArtist(albumId) {
      const album = albums.find((a) => a.id === albumId);
      if (!album || album.songs.length === 0) return;

      // 跳过不可播放歌曲，从第一首可播放的开始
      const firstPlayable = album.songs.findIndex((s) => songPlayable(s));
      if (firstPlayable === -1) {
        setUnplayableDialogSong(album.songs[0]);
        return;
      }

      if (currentAlbumId === albumId) {
        togglePlay();
      } else {
        setCurrentPlaylistId(null);
        setPlayQueue([]);
        setCurrentAlbumId(albumId);
        setCurrentSongIndex(firstPlayable);
        setIsPlaying(true);
      }
    }

    // ---------- 从艺人详情页选择歌曲播放 ----------
    function handlePlaySongFromArtist(albumId, songIndex) {
      const album = albums.find((a) => a.id === albumId);
      const song = album?.songs?.[songIndex];
      if (song && !songPlayable(song)) { setUnplayableDialogSong(song); return; }
      setCurrentPlaylistId(null);
      setPlayQueue([]);
      setCurrentAlbumId(albumId);
      setCurrentSongIndex(songIndex);
      setIsPlaying(true);
    }

    // ---------- 从搜索结果页选择歌曲播放 ----------
    function handlePlaySongFromSearch(albumId, songIndex) {
      const album = albums.find((a) => a.id === albumId);
      const song = album?.songs?.[songIndex];
      if (song && !songPlayable(song)) { setUnplayableDialogSong(song); return; }
      setCurrentPlaylistId(null);
      setPlayQueue([]);
      setCurrentAlbumId(albumId);
      setCurrentSongIndex(songIndex);
      setIsPlaying(true);
    }

    // ---------- 从专辑详情页删除歌曲 ----------
    function handleDeleteSongFromDetail(song, albumId) {
      setDeleteSongConfirm({ ...song, albumId });
    }

    // ---------- 从播放列表移除歌曲 ----------
    function handleRemoveFromPlaylist(playlistId, song) {
      setPlaylists((prev) =>
        prev.map((pl) =>
          pl.id === playlistId ? { ...pl, songs: pl.songs.filter((s) => s.url !== song.url) } : pl
        )
      );
    }

    // ---------- 从所有播放列表中移除匹配的歌曲（删除歌曲时同步清理，避免残留） ----------
    function removeSongsFromPlaylists(predicate) {
      setPlaylists((prev) =>
        prev.map((pl) => ({
          ...pl,
          songs: pl.songs.filter((s) => !predicate(s)),
        }))
      );
    }

                    // ---------- 导航切换 ----------
  function handleNavChange(val) {
    const metadataNavs = ["composer", "lyricist", "genres", "videos"];
    setDetailVideoId(null);
    setRelatedVideoScope(null);
    if (metadataNavs.includes(val) && val !== activeNav) {
      setMetadataRoute({ type: val, selected: null, view: "list" });
    } else if (!metadataNavs.includes(val)) {
      setMetadataRoute({ type: null, selected: null, view: "list" });
    }
    // 离开搜索模式时清空搜索词，避免全局过滤干扰其他视图
    if (activeNav === "search" && val !== "search") {
      setFilterText("");
    }
          const isPlaylist = playlists.some((p) => p.id === val);
    if (isPlaylist) {
      // 点击播放列表 → 关闭专辑详情（如果有），打开播放列表详情
      setDetailAlbumId(null);
      setDetailArtistName(null);
      handleOpenPlaylistDetail(val);
    } else {
      // 点击其他导航项 → 关闭播放列表详情（如果开着）和专辑详情/艺人详情
      setDetailPlaylistId(null);
      setDetailAlbumId(null);
      setDetailArtistName(null);
    }
    setActiveNav(val);
    // 切换导航时重置懒加载计数（避免旧视图的可见条数影响新视图）
    setVisibleCount(40);
    if (val === "songs") setSongVisibleCount(30);
    // 进入主视图（资料库/专辑/歌曲/播放列表）时按需全量检测缺失文件
    if (["library", "albums", "songs", "playlists"].includes(val)) {
      runFileCheck(allLibraryPaths());
    }
        // 切换导航时退出多选模式
    handleCancelSelect();
                // 切换导航时关闭单曲菜单和专辑菜单
    setContextMenu(null);
    setAlbumMenu(null);
    setPlaylistMenu(null);
  }

    // ---------- 从播放列表详情播放全部 ----------
  function handlePlayAllFromPlaylist(preferLatest = false) {
    const pl = playlists.find((p) => p.id === detailPlaylistId);
    if (!pl || !pl.songs || pl.songs.length === 0) return;

    // “我喜欢”默认新喜欢在前；播放全部也从当前展示的第一首可播放歌曲开始。
    let firstPlayable = pl.songs.findIndex((s) => songPlayable(s));
    if (preferLatest) {
      for (let index = pl.songs.length - 1; index >= 0; index -= 1) {
        if (songPlayable(pl.songs[index])) {
          firstPlayable = index;
          break;
        }
      }
    }
    if (firstPlayable === -1) {
      if (pl.songs.length > 0) setUnplayableDialogSong(pl.songs[0]);
      return;
    }

    if (currentPlaylistId === detailPlaylistId) {
      togglePlay();
    } else {
      setCurrentAlbumId(null); // 切换到播放列表播放，清除专辑来源
      setPlayQueue([]);
      setCurrentPlaylistId(detailPlaylistId);
      setCurrentSongIndex(firstPlayable);
      setIsPlaying(true);
    }
  }

  // ---------- 从播放列表详情选择歌曲播放 ----------
  function handlePlaySongFromPlaylist(songIndex) {
    const pl = playlists.find((p) => p.id === detailPlaylistId);
    const song = pl?.songs?.[songIndex];
    if (song && !songPlayable(song)) { setUnplayableDialogSong(song); return; }
    setCurrentAlbumId(null); // 切换到播放列表播放，清除专辑来源
    setPlayQueue([]);
    setCurrentPlaylistId(detailPlaylistId);
    setCurrentSongIndex(songIndex);
    setIsPlaying(true);
  }

    // 简单播放/暂停（给专辑卡片复用）
  function togglePlay() {
    if (!audioRef.current || !currentSong) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
    setIsPlaying(!isPlaying);
  }

    // ---------- 歌曲多选操作 ----------
        function handleCheckboxChange(songKey, e) {
      // 阻止事件冒泡，避免触发行点击播放
      if (e) e.stopPropagation();
      const nextSelected = new Set(selectedSongs);
      if (nextSelected.has(songKey)) {
        nextSelected.delete(songKey);
      } else {
        nextSelected.add(songKey);
      }
      setSelectedSongs(nextSelected);
      // 首次选中时进入多选模式
      if (nextSelected.size > 0 && !isSelecting) {
        setIsSelecting(true);
      }
      // 注意：即使全部取消选中，也不自动退出多选模式，让用户点"取消"才退出
    }

  function handleCancelSelect() {
    setIsSelecting(false);
    setSelectedSongs(new Set());
    setShowDeleteConfirm(false);
  }

    function handleRequestDelete() {
    setShowDeleteConfirm(true);
  }

  // ---------- 添加到播放列表 ----------
  function handleAddToPlaylist() {
    // 获取选中的所有歌曲
    const selectedSongList = [];
    albums.forEach((album) => {
      album.songs.forEach((song, idx) => {
        const key = `${album.id}-${idx}`;
        if (selectedSongs.has(key)) {
          selectedSongList.push(song);
        }
      });
    });
    if (selectedSongList.length === 0) return;

    // 添加到"我喜欢的音乐"播放列表
    setPlaylists((prev) =>
      prev.map((pl) => {
        if (pl.id === "liked") {
          const existingUrls = new Set(pl.songs.map((s) => s.url));
          const newSongs = selectedSongList.filter((s) => !existingUrls.has(s.url));
          return { ...pl, songs: [...pl.songs, ...newSongs] };
        }
        return pl;
      })
    );
    handleCancelSelect();
  }

  // ---------- 下一首播放 ----------
  function handlePlayNext() {
    // 获取选中的所有歌曲
    const selectedSongList = [];
    albums.forEach((album) => {
      album.songs.forEach((song, idx) => {
        const key = `${album.id}-${idx}`;
        if (selectedSongs.has(key)) {
          selectedSongList.push({ ...song, albumId: album.id });
        }
      });
    });
    if (selectedSongList.length === 0) return;

    // 直接播第一首选中的歌曲，后续歌曲插入当前播放队列之后（这里简化：直接播放第一首选中的）
    const firstSong = selectedSongList[0];
    if (firstSong) {
      setCurrentPlaylistId(null);
      setCurrentAlbumId(firstSong.albumId);
      const album = albums.find((a) => a.id === firstSong.albumId);
      if (album) {
        const songIdx = album.songs.findIndex(
          (s) => s.title === firstSong.title && s.url === firstSong.url
        );
        setCurrentSongIndex(songIdx >= 0 ? songIdx : 0);
      }
      setIsPlaying(true);
    }
    handleCancelSelect();
  }

  // ---------- 添加到播单 ----------
  function handleAddToQueue() {
    const selectedSongList = [];
    albums.forEach((album) => {
      album.songs.forEach((song, idx) => {
        const key = `${album.id}-${idx}`;
        if (selectedSongs.has(key)) {
          selectedSongList.push({ ...song, albumId: album.id });
        }
      });
    });
    if (selectedSongList.length === 0) return;

    // 将选中的歌曲追加到"最近播放"播放列表
    setPlaylists((prev) =>
      prev.map((pl) => {
        if (pl.id === "recent") {
          const existingUrls = new Set(pl.songs.map((s) => s.url));
          const newSongs = selectedSongList.filter((s) => !existingUrls.has(s.url));
          return { ...pl, songs: [...pl.songs, ...newSongs] };
        }
        return pl;
      })
    );
    handleCancelSelect();
  }

    function handleConfirmDelete() {
    // 先记录一下当前播放的歌曲是否在选中列表中
    let currentDeleted = false;
    if (currentAlbumId) {
      const currentKey = `${currentAlbumId}-${currentSongIndex}`;
      currentDeleted = selectedSongs.has(currentKey);
    }

    // 收集被删歌曲，用于后端 / 索引 / 播放列表清理
    const deletedSongs = [];
    const deletedUrls = new Set();
    const deletedPaths = new Set();
    albums.forEach((album) => {
      album.songs.forEach((song, idx) => {
        if (selectedSongs.has(`${album.id}-${idx}`)) {
          deletedSongs.push(song);
          if (song.url) deletedUrls.add(song.url);
          if (song.file_path) deletedPaths.add(song.file_path);
        }
      });
    });

    // 同步删除后端文件 + 本地索引（尽力而为）
    deletedSongs.forEach((s) => {
      (async () => {
        try {
          const res = await deleteMusic(s.file_path, deleteToTrashEnabled());
          if (res?.status === "error") showToast(res.msg || "删除失败", "warning");
        } catch (err) {
          console.warn("后端删除失败:", err);
        }
      })();
      if (s.file_path) {
        removeSongFromIndex(s.file_path);
      }
    });

    // 从所有播放列表中移除被删歌曲
    removeSongsFromPlaylists((s) => deletedUrls.has(s.url) || deletedPaths.has(s.file_path));

    // 计算被删空的专辑（基于当前 albums 状态，供后续清理播放来源）
    const removedAlbums = new Set();
    albums.forEach((album) => {
      const remaining = album.songs.filter((song, idx) => !selectedSongs.has(`${album.id}-${idx}`));
      if (remaining.length === 0) removedAlbums.add(album.id);
    });

    // 删除选中的歌曲（并移除被删空的专辑）
    const nextAlbums = albums
      .map((album) => ({
        ...album,
        songs: album.songs.filter((song, idx) => !selectedSongs.has(`${album.id}-${idx}`)),
      }))
      .filter((a) => a.songs.length > 0);
    setAlbums(nextAlbums);
    // 处理被删空专辑的艺人（保留/删除空艺人，按开关）
    syncArtistsAfterDelete(albums, nextAlbums);

        // 如果当前播放的歌曲被删除了，停止播放
    if (currentDeleted) {
      setIsPlaying(false);
    }
    // 如果当前播放的专辑被删空，清除播放来源
    if (currentAlbumId && removedAlbums.has(currentAlbumId)) {
      setCurrentAlbumId(null);
    }
    handleCancelSelect();
  }

  function handleConfirmDeleteSong() {
    if (!deleteSongConfirm) return;
    const albumId = deleteSongConfirm.albumId;
    const album = albums.find((a) => a.id === albumId);
    const isLastSong = album && album.songs.length <= 1;

    // 同步删除后端文件（尽力而为，失败不阻塞）
    (async () => {
      try {
        const res = await deleteMusic(deleteSongConfirm.file_path, deleteToTrashEnabled());
        if (res?.status === "error") showToast(res.msg || "删除失败", "warning");
      } catch (err) {
        console.warn("后端删除失败:", err);
      }
    })();
    // 从本地索引移除
    if (deleteSongConfirm.file_path) {
      removeSongFromIndex(deleteSongConfirm.file_path);
    }

    // 从所有播放列表中移除该歌曲（按 url / file_path 匹配）
    const delUrl = deleteSongConfirm.url;
    const delPath = deleteSongConfirm.file_path;
    removeSongsFromPlaylists((s) => (delUrl && s.url === delUrl) || (delPath && s.file_path === delPath));

    // 如果是最后一首歌 → 整张专辑删除
    if (isLastSong) {
      if (currentAlbumId === albumId) {
        setIsPlaying(false);
        setCurrentAlbumId(null);
      }
      setPlayQueue((prev) => prev.filter(s => s.albumId !== albumId));
      const nextAlbums = albums.filter((a) => a.id !== albumId);
      setAlbums(nextAlbums);
      setDetailAlbumId((prev) => prev === albumId ? null : prev);
      syncArtistsAfterDelete(albums, nextAlbums);
    } else {
      const nextAlbums = albums
        .map((a) => {
          if (a.id === albumId) {
            return { ...a, songs: a.songs.filter((s) => s.url !== deleteSongConfirm.url) };
          }
          return a;
        })
        .filter((a) => a.songs.length > 0);
      setAlbums(nextAlbums);
      if (currentSong?.url === deleteSongConfirm.url) {
        setIsPlaying(false);
      }
    }
    setDeleteSongConfirm(null);
  }

    // ---------- 格式化时长（秒 → mm:ss） ----------
  function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return "--:--";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  // ---------- 单曲菜单操作 ----------
  function handleOpenContextMenu(e, song) {
  e.stopPropagation();
  e.preventDefault();
  // 计算菜单位置，避免超出视口边界
  const menuWidth = 190; // 菜单预计宽度
  const menuHeight = 220; // 菜单预计高度
  let x = e.clientX;
  let y = e.clientY;
    
  // 如果右侧空间不足，菜单向左弹出
  if (x + menuWidth > window.innerWidth) {
    x = window.innerWidth - menuWidth - 8;
  }
  // 如果底部空间不足，菜单向上弹出
  if (y + menuHeight > window.innerHeight) {
    y = window.innerHeight - menuHeight - 8;
  }
    
  setContextMenu({ x, y, song });
  }

  function handleCloseContextMenu() {
    setContextMenu(null);
  }

    function handleContextMenuAction(action, song) {
    handleCloseContextMenu();
    if (!song) return;

    if (action === "album") {
      // 打开专辑详情
      handleOpenAlbumDetail(song.albumId);
    } else if (action === "artist") {
      // 打开艺人详情
      handleOpenArtistDetail(song.artist || "未知艺术家");
    } else if (action === "addToPlaylist") {
      // 添加到"我喜欢的音乐"
      setPlaylists((prev) =>
        prev.map((pl) => {
          if (pl.id === "liked") {
            const existingUrls = new Set(pl.songs.map((s) => s.url));
            if (!existingUrls.has(song.url)) {
              return { ...pl, songs: [...pl.songs, song] };
            }
          }
          return pl;
        })
      );
            } else if (action === "playNext") {
      // 插播：在当前正在播放的歌曲之后，插入要播的歌曲
      if (currentSong && !currentAlbumId && !currentPlaylistId && playQueue.length > 0) {
        // 当前正在播放 playQueue 中的歌曲：在 currentSongIndex 之后插入
        const insertAt = currentSongIndex + 1;
        setPlayQueue((prev) => {
          const newQueue = [...prev];
          newQueue.splice(insertAt, 0, song);
          // 如果插入位置在当前播放位置之前，需要调整 currentSongIndex
          return newQueue;
        });
        // 如果插入位置在当前播放位置之前或同一位置，当前索引需 +1
        // 由于 insertAt > currentSongIndex，索引不需要调整
      } else {
        // 普通模式：插入到队列最前面
        setPlayQueue((prev) => [song, ...prev]);
      }
      // 如果当前没有在播放，直接播放这首歌
      if (!currentSong) {
        setCurrentPlaylistId(null);
        setCurrentAlbumId(null);
        setPlayQueue([song]);
        setCurrentSongIndex(0);
        setIsPlaying(true);
      }
      } else if (action === "playLater") {
      // 稍后播放：追加到播放队列末尾
      setPlayQueue((prev) => [...prev, song]);
      // 如果当前没有在播放，直接播放这首歌
      if (!currentSong) {
        setCurrentPlaylistId(null);
        setCurrentAlbumId(null);
        setPlayQueue([song]);
        setCurrentSongIndex(0);
        setIsPlaying(true);
      }
    } else if (action === "deleteSong") {
      setDeleteSongConfirm(song);
    }
  }

  // ---------- 专辑操作菜单 ----------
  function handleOpenAlbumMenu(e, album) {
    e.stopPropagation();
    e.preventDefault();
    const menuWidth = 180;
    const menuHeight = 200;
    let x = e.clientX;
    let y = e.clientY;
    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth - 8;
    }
    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight - 8;
    }
    setAlbumMenu({ x, y, album });
  }

  function handleCloseAlbumMenu() {
    setAlbumMenu(null);
  }

  function handleAlbumMenuAction(action, album) {
    handleCloseAlbumMenu();
    if (!album) return;

    if (action === "playNext") {
      const songs = album.songs.map(s => ({ ...s, albumId: album.id }));
      if (songs.length === 0) return;
      if (currentSong && !currentAlbumId && !currentPlaylistId && playQueue.length > 0) {
        const insertAt = currentSongIndex + 1;
        setPlayQueue((prev) => { const nq = [...prev]; nq.splice(insertAt, 0, ...songs); return nq; });
      } else {
        setPlayQueue((prev) => [...songs, ...prev]);
      }
      if (!currentSong) {
        setCurrentPlaylistId(null); setCurrentAlbumId(null);
        setPlayQueue(songs); setCurrentSongIndex(0); setIsPlaying(true);
      }
    } else if (action === "playLater") {
      const songs = album.songs.map(s => ({ ...s, albumId: album.id }));
      if (songs.length === 0) return;
      setPlayQueue((prev) => [...prev, ...songs]);
      if (!currentSong) {
        setCurrentPlaylistId(null); setCurrentAlbumId(null);
        setPlayQueue(songs); setCurrentSongIndex(0); setIsPlaying(true);
      }
    } else if (action === "artist") {
      handleOpenArtistDetail(album.artist || "未知艺术家");
    } else if (action === "toggleFavorite") {
      handleToggleFavoriteAlbum(album.id);
    } else if (action === "addToPlaylist") {
      const songs = album.songs.map(s => ({ ...s, albumId: album.id }));
      setPlaylists((prev) =>
        prev.map((pl) => {
          if (pl.id !== "liked" && pl.id !== "recent") {
            const existingUrls = new Set(pl.songs.map((s) => s.url));
            const newSongs = songs.filter((s) => !existingUrls.has(s.url));
            if (newSongs.length > 0) return { ...pl, songs: [...pl.songs, ...newSongs] };
          }
          return pl;
        })
      );
    } else if (action === "delete") {
      setDeleteAlbumConfirm(album.id);
    }
  }

  function handleToggleFavoriteAlbum(albumId) {
    setFavoriteAlbums((prev) => {
      const next = new Set(prev);
      if (next.has(albumId)) next.delete(albumId);
      else next.add(albumId);
      return next;
    });
  }

  async function handleConfirmDeleteAlbum() {
    const albumId = deleteAlbumConfirm;
    if (!albumId) return;

    const album = albums.find((a) => a.id === albumId);

    // 后端统一删除整张专辑，空歌曲列表的残留卡片也能被清理。
    if (album) {
      try {
        const res = await deleteAlbum(album.artist, album.title, deleteToTrashEnabled());
        if (res?.status === "error") {
          showToast(res.msg || "删除失败", "warning");
          return;
        }
      } catch (err) {
        console.warn("后端删除专辑失败:", err);
        showToast("删除专辑失败，请稍后重试", "warning");
        return;
      }

      const urls = new Set();
      const paths = new Set();
      for (const s of album.songs || []) {
        if (s.file_path) {
          removeSongFromIndex(s.file_path);
          paths.add(s.file_path);
        }
        if (s.url) urls.add(s.url);
      }
      // 从所有播放列表中移除该专辑的歌曲
      removeSongsFromPlaylists((s) => urls.has(s.url) || paths.has(s.file_path));
    }

    // 如果正在播放该专辑，停止播放
    if (currentAlbumId === albumId) {
      setIsPlaying(false);
      setCurrentAlbumId(null);
    }
    // 从播放队列中移除该专辑的歌曲
    setPlayQueue((prev) => prev.filter(s => s.albumId !== albumId));
    // 删除专辑
    const nextAlbums = albums.filter((a) => a.id !== albumId);
    setAlbums(nextAlbums);
    syncArtistsAfterDelete(albums, nextAlbums);
    setDeleteAlbumConfirm(null);
    setDetailAlbumId((prev) => prev === albumId ? null : prev);
    await Promise.all([refreshFromServer({ replace: true }), refreshVideos()]);
  }

    function handleCancelDeleteAlbum() {
    setDeleteAlbumConfirm(null);
  }

  // ---------- 重置整个资料库（回到最初状态，后台线程 + 进度轮询） ----------
  async function handleResetData() {
    setShowSettings(false);
    setResetting(true);
    setResetProgress({ done: 0, total: 0 });
    try {
      await resetAll();
    } catch (err) {
      console.warn("重置后端失败:", err);
    }
    // 轮询后端重置进度，完成后清空前端状态
    const poll = async () => {
      let st = null;
      try {
        st = await getResetProgress();
      } catch (err) {
        console.warn("获取重置进度失败:", err);
      }
      if (st && st.running) {
        setResetProgress({ done: st.done || 0, total: st.total || 0 });
        setTimeout(poll, 500);
        return;
      }
      // 完成（或后端不可用）：清空本地缓存（含主题，什么都不保留）
      setResetting(false);
      localStorage.removeItem("music-library-index");
      localStorage.removeItem("music-playlists-v1");
      localStorage.removeItem("app-theme");
      clearPlayCounts();
      applyTheme("system");
      // 重置前端状态
      setAlbums([]);
      setPlaylists(DEFAULT_PLAYLISTS.map((p) => ({ ...p, songs: [] })));
      setPlayQueue([]);
      setCurrentAlbumId(null);
      setCurrentPlaylistId(null);
      setCurrentSongIndex(0);
      setIsPlaying(false);
      setMissingSongs(new Set());
      setDetailAlbumId(null);
      setDetailPlaylistId(null);
      setDetailArtistName(null);
      setArtistRecords({});
      showToast("重置资料库成功", "success");
    };
    poll();
  }

    // ---------- 编辑元信息 ----------
    async function handleOpenMusicEdit(target) {
      // 打开歌曲编辑时预取歌词（含文件内嵌歌词），便于在歌词 Tab 中查看 / 修改
      if (target.type === "song" && target.data?.file_path) {
        try {
          const res = await getLyrics(target.data.file_path);
          if (res?.status === "ok") {
            target = { ...target, data: { ...target.data, lyrics: res.lyrics || "" } };
          }
        } catch (err) {
          console.warn("获取歌词失败:", err);
        }
      }
      setEditTarget(target);
    }

    // 播放器多功能菜单「详细信息」→ 打开歌曲编辑器（自动定位所属专辑）
    function handleOpenEditFromPlayer(song) {
      if (!song) return;
      let albumId = song.albumId || null;
      if (!albumId) {
        const found = albums.find((a) =>
          (a.songs || []).some((s) => (s.file_path && s.file_path === song.file_path) || (s.url && s.url === song.url))
        );
        albumId = found?.id || null;
      }
      handleOpenMusicEdit({ type: "song", data: { ...song, albumId } });
    }

    async function refreshFromServer(options = {}) {
      try {
        const data = await getMusicList();
        if (!Array.isArray(data)) return [];
        const serverAlbums = buildAlbumsFromServer(data);
        setAlbums((prev) => options.replace ? serverAlbums : mergeServerAlbums(prev, serverAlbums));
        return serverAlbums;
      } catch (err) {
        console.warn("刷新服务端专辑失败:", err);
        if (options.replace) throw err;
        return [];
      }
    }

    async function refreshVideos() {
      try {
        const result = await getVideos();
        setVideos(Array.isArray(result) ? result.map((item) => ({ ...item, file_url: getAssetUrl(item.file_url), cover_url: getAssetUrl(item.cover_url) })) : []);
      } catch (err) { console.warn("刷新视频资料库失败:", err); }
    }

    async function handleVideoFiles(event) {
      const files = Array.from(event.target.files || []);
      event.target.value = "";
      for (const file of files) {
        try { await uploadVideo(file); } catch (err) { showToast(err?.message || "视频导入失败", "warning"); }
      }
      await refreshVideos();
      if (files.length) showToast(`已导入 ${files.length} 个视频`, "success");
    }

    function handleAddWebVideo() {
      setWebVideoUrl("");
      setShowWebVideoDialog(true);
    }

    async function handleSubmitWebVideo() {
      const url = webVideoUrl.trim();
      if (!url) return;
      setWebVideoSubmitting(true);
      try {
        const video = await addWebVideo(url);
        await refreshVideos();
        setShowWebVideoDialog(false);
        showToast(video.metadata_complete === false ? "视频已添加，但未能获取完整视频信息，可在编辑页补全" : "视频网站视频已添加", video.metadata_complete === false ? "warning" : "success");
      }
      catch { showToast("无法添加该视频网站视频，请检查链接", "warning"); }
      finally { setWebVideoSubmitting(false); }
    }

    async function handleSaveVideo(id, payload, coverFile) {
      try {
        let saved = await updateVideo(id, payload);
        if (coverFile) saved = await updateVideoCover(id, coverFile);
        setVideos((prev) => prev.map((video) => video.id === id ? { ...saved, file_url: getAssetUrl(saved.file_url), cover_url: getAssetUrl(saved.cover_url) } : video));
        await refreshVideos();
        showToast("视频信息已保存", "success");
      } catch (err) {
        showToast(err?.message || "视频信息保存失败", "warning");
        throw err;
      }
    }

    async function handleUpdateSongVideoLinks(song, selectedIds) {
      const songKey = primarySongRef(song);
      if (!songKey) return;
      try {
        await Promise.all((videos || []).map((video) => {
          const current = video.song_ids || [];
          const shouldLink = selectedIds.includes(video.id);
          const hasLink = videoMatchesSong(video, song);
          if (shouldLink === hasLink) return null;
          if (shouldLink) {
            const payload = { song_ids: [...current, songKey] };
            if (current.length === 0) {
              if (song?.title) payload.title = song.title;
              if (song?.artist) payload.artist = song.artist;
            }
            return updateVideo(video.id, payload);
          }
          return updateVideo(video.id, { song_ids: current.filter((ref) => !refMatchesSong(ref, song)) });
        }));
        await refreshVideos();
      } catch (err) {
        showToast(err?.message || "视频关联保存失败", "warning");
        throw err;
      }
    }

    async function handleUploadVideoFromEditor(file) {
      await uploadVideo(file);
      await refreshVideos();
    }

    function handleDeleteVideo(id) {
      setDeleteVideoConfirm(videos.find((video) => video.id === id) || { id, title: "该视频" });
    }

    async function handleConfirmDeleteVideo() {
      const target = deleteVideoConfirm;
      if (!target?.id) return;
      try {
        await deleteVideo(target.id);
        if (detailVideoId === target.id) setDetailVideoId(null);
        setEditVideoOnOpenId(null);
        setDeleteVideoConfirm(null);
        await refreshVideos();
        showToast("视频已删除", "success");
      } catch (err) {
        showToast(err?.message || "视频删除失败", "warning");
      }
    }

    useEffect(() => {
      const timer = setTimeout(() => { refreshVideos(); }, 0);
      return () => clearTimeout(timer);
    }, []);

    function handleAlbumMatchError() {
      setEditTarget(null);
      showToast("专辑匹配失败，请稍后重试", "warning");
    }

    function handleAlbumMatchSaved(albumId, oldSong, updatedSong) {
      if (!oldSong?.file_path || !updatedSong?.file_path) return;
      removeSongFromIndex(oldSong.file_path);
      const movedSong = buildIndexSong(oldSong, updatedSong);
      // 后端匹配可能会移动歌曲到新的「艺人/专辑」路径。索引已同步时，
      // 资料库内存状态也必须同步迁移，避免旧专辑卡片残留并与新卡片重复。
      if (!movedSong.coverURL) movedSong.coverURL = oldSong.coverURL || null;
      saveSongToIndex(movedSong);
      setAlbums((prev) => {
        const oldPath = oldSong.file_path;
        const newPath = movedSong.file_path;
        const targetArtist = movedSong.album_artist || movedSong.artist || "未知艺术家";
        const targetTitle = movedSong.album || "未知专辑";
        const targetKey = `${targetArtist}|${targetTitle}`;
        const albumKey = (album) => `${album.album_artist || album.artist || "未知艺术家"}|${album.title || "未知专辑"}`;
        let sourceAlbum = null;
        const next = [];

        for (const album of prev) {
          const songs = (album.songs || []).filter((song) => song.file_path !== oldPath && song.file_path !== newPath);
          if ((album.songs || []).some((song) => song.file_path === oldPath)) sourceAlbum = album;
          if (songs.length > 0) next.push({ ...album, songs });
        }

        const targetIndex = next.findIndex((album) => albumKey(album) === targetKey);
        const targetAlbum = targetIndex >= 0 ? next[targetIndex] : null;
        const mergedTarget = {
          ...(targetAlbum || sourceAlbum || {}),
          id: targetAlbum?.id || `server-${targetArtist}-${targetTitle}`,
          title: targetTitle,
          artist: targetArtist,
          album_artist: movedSong.album_artist || null,
          year: movedSong.year || targetAlbum?.year || sourceAlbum?.year || null,
          genre: movedSong.genre || targetAlbum?.genre || sourceAlbum?.genre || null,
          publisher: movedSong.publisher || targetAlbum?.publisher || sourceAlbum?.publisher || null,
          coverURL: movedSong.coverURL || targetAlbum?.coverURL || sourceAlbum?.coverURL || null,
          description: targetAlbum?.description || sourceAlbum?.description || "",
          importTime: targetAlbum?.importTime || sourceAlbum?.importTime || movedSong.importTime || nowTs(),
          matched: true,
          songs: [...(targetAlbum?.songs || []), movedSong],
        };
        if (targetIndex >= 0) next[targetIndex] = mergedTarget;
        else next.push(mergedTarget);
        return next;
      });
      if (detailAlbumId === albumId) {
        const nextAlbumId = `server-${updatedSong.album_artist || updatedSong.artist || "未知艺术家"}-${updatedSong.album || "未知专辑"}`;
        setDetailAlbumId(nextAlbumId);
      }
    }

    // ---------- 后台专辑匹配（用户可关闭编辑器自由浏览） ----------
    // 只跟随编辑弹窗发起时选择的源（config.sources），前后端一致
    async function runBackgroundAlbumMatch(album, { config, selectedAlbum } = {}) {
      const songs = album?.songs || [];
      if (songs.length === 0) return;
      const cfg = config || {
        sources: { qq: true, netease: true, itunes: true, musicbrainz: true },
        fields: {},
        lyric_credits_fallback: false,
      };
      // 专辑候选的简介在选择阶段已取回；后台逐曲匹配会立即关闭编辑器，
      // 因此需要在这里单独持久化，不能依赖编辑表单的“保存”按钮。
      if (selectedAlbum?.description && String(selectedAlbum.description).trim()) {
        try {
          await updateAlbumDescription({
            artist: selectedAlbum.album_artist || album.album_artist || album.artist,
            album: selectedAlbum.album || album.title,
            description: selectedAlbum.description,
          });
        } catch {
          // 简介保存失败不阻塞歌曲匹配，结束刷新时会保留原有专辑信息。
        }
      }
      handleAlbumMatchProgress({ status: "start", total: songs.length });
      let doneCount = 0, okCount = 0, skipCount = 0;
      for (const song of songs) {
        if (song.file_path) {
          const selectedSources = selectedAlbum?.source
            ? { qq: selectedAlbum.source === "qq", netease: selectedAlbum.source === "netease", itunes: selectedAlbum.source === "itunes", musicbrainz: false }
            : cfg.sources;
          try {
            const res = await matchSong({ song_name: song.title, artist_name: song.artist, file_path: song.file_path || "", ...cfg, sources: selectedSources });
            if (res && !res.error) {
              const payload = {};
              if (!song.composer && res.composers?.length) payload.composer = res.composers.join(", ");
              if (!song.lyricist && res.lyricists?.length) payload.lyricist = res.lyricists.join(", ");
              if (selectedAlbum?.album) payload.album = selectedAlbum.album;
              else if (!song.album && res.album) payload.album = res.album;
              if (selectedAlbum?.album_artist) {
                payload.artist = selectedAlbum.album_artist;
                payload.album_artist = selectedAlbum.album_artist;
              } else if (!song.album_artist && res.album_artist) payload.album_artist = res.album_artist;
              if (selectedAlbum?.year) payload.year = selectedAlbum.year;
              else if (!song.year && res.year) payload.year = res.year;
              if (selectedAlbum?.genre) payload.genre = selectedAlbum.genre;
              else if (!song.genre && res.genre) payload.genre = res.genre;
              if (song.trackNo == null && res.trackNo != null) payload.trackNo = res.trackNo;
              if (song.discNo == null && res.discNo != null) payload.discNo = res.discNo;
              if (!song.publisher && res.publisher) payload.publisher = res.publisher;
              if (!song.arranger && res.arranger) payload.arranger = res.arranger;
              if (!song.producer && res.producer) payload.producer = res.producer;
              if (!song.lyrics && res.lyric) payload.lyrics = res.lyric;
              const saveRes = await updateMusicMetadata({
                file_path: song.file_path,
                ...payload,
                matched: "1",
                match_source: res.source,
              });
              if (saveRes?.status === "ok") okCount++;
              else skipCount++;
              if (saveRes?.status === "ok") {
                handleAlbumMatchSaved(album.id, song, {
                  ...saveRes.song,
                  matched: true,
                  match_source: res.source || null,
                });
              }
            } else {
              skipCount++;
            }
          } catch {
            skipCount++;
          }
        } else {
          skipCount++;
        }
        doneCount++;
        handleAlbumMatchProgress({ status: "update", done: doneCount, total: songs.length });
      }
      const doneMessage = skipCount > 0
        ? `匹配成功 ${okCount} 首，跳过 ${skipCount} 首`
        : `匹配成功 ${okCount} 首`;
      handleAlbumMatchProgress({ status: "done", done: doneCount, total: songs.length, message: doneMessage, skipped: skipCount });
      try {
        await refreshFromServer();
      } catch {
        // 后台刷新失败不阻塞
      }
    }

    // ---------- 按需检测缺失文件（不再全局轮询） ----------
    // opts.onProgress(done, total)：提供时按每块 100 条分块调用并回报进度（供更新资料库进度条）
    async function runFileCheck(paths, opts = {}) {
      const uniq = Array.from(new Set((paths || []).filter(Boolean)));
      if (uniq.length === 0) return;
      const hasProgress = typeof opts.onProgress === "function";
      const BATCH = 100;
      const batchCount = Math.ceil(uniq.length / BATCH);
      const missing = new Set();
      try {
        if (!hasProgress) {
          // 无进度需求：保持单次批量调用（导航切换等触发，低开销）
          const res = await checkMusicFiles(uniq);
          Object.entries(res.exists || {}).forEach(([p, exists]) => {
            if (!exists) missing.add(p);
          });
        } else {
          for (let i = 0; i < batchCount; i++) {
            const batch = uniq.slice(i * BATCH, (i + 1) * BATCH);
            const res = await checkMusicFiles(batch);
            Object.entries(res.exists || {}).forEach(([p, exists]) => {
              if (!exists) missing.add(p);
            });
            opts.onProgress(i + 1, batchCount);
          }
        }
        setMissingSongs((prev) => {
          const keep = new Set([...prev].filter((p) => !uniq.includes(p)));
          missing.forEach((p) => keep.add(p));
          return keep;
        });
      } catch (err) {
        console.warn("文件存在性检测失败:", err);
        if (hasProgress) opts.onProgress(batchCount, batchCount);
      }
    }

    function allLibraryPaths() {
      const paths = [];
      const seen = new Set();
      albums.forEach((a) =>
        (a.songs || []).forEach((s) => {
          if (s.file_path && !seen.has(s.file_path)) {
            seen.add(s.file_path);
            paths.push(s.file_path);
          }
        })
      );
      return paths;
    }

    // ---------- 更新资料库：刷新专辑 + 全量检测缺失标记（带进度条） ----------
    async function handleRefreshLibrary() {
      const paths = allLibraryPaths();
      const batchCount = Math.ceil(paths.length / 100);
      const total = paths.length > 0 ? batchCount + 1 : 1; // 列表刷新算 1 步
      let notifId = null;
      try {
        notifId = addNotification({
          kind: "progress_update", title: "正在更新资料库", ongoing: true,
          progress: { done: 0, total }, content: null,
        });
        await refreshFromServer();
        updateNotification(notifId, { progress: { done: 1, total } });
        if (paths.length > 0) {
          await runFileCheck(paths, {
            onProgress: (done) => updateNotification(notifId, { progress: { done: done + 1, total } }),
          });
        }
        updateNotification(notifId, {
          ongoing: false, progress: null, popup: true, kind: "success",
          title: "资料库已更新", content: null,
        });
      } catch (err) {
        console.warn("更新资料库失败:", err);
        if (notifId) {
          updateNotification(notifId, {
            ongoing: false, progress: null, popup: true, kind: "warning",
            title: "更新资料库失败", content: null,
          });
        } else {
          showToast("更新资料库失败", "warning");
        }
      }
    }

    async function handleSaveEdit(target, form, editCoverFile, matched, matchSource) {
      const removedPaths = [];
      const addedSongs = [];
      let albumDescriptionSaved = false;
      try {
        // 用于导航策略：找到所属专辑，判定是单曲专辑还是多曲专辑
        const album = target.type === "song"
          ? albums.find((a) => a.id === target.data.albumId)
          : (target.type === "album" ? target.data : null);
const isSingleSong = album ? (album.songs || []).length === 1 : false;
        const albumAlbumArtist = album?.album_artist;
        const origArtist = target.data?.artist;
        const origAlbumArtist = target.data?.album_artist;
        // 自动整理合作艺人：开启时把多位艺人统一为 "A & B & C"
        const organizeArtists = (value) => {
          if (value === undefined || value === null) return value;
          if (localStorage.getItem("edit-auto-organize-collab") === "false") return value;
          const joined = joinArtists(splitArtists(String(value)));
          return joined === "" ? value : joined;
        };
        // 发布者：仅 ℗+年份 占位前缀视为无发布者，清空写入
        const resolvePublisher = (value) => {
          if (value === undefined || value === null) return undefined;
          const s = String(value);
          if (s.trim() === "" || isPlaceholderPublisher(s)) return " ";
          return s;
        };

        if (target.type === "album") {
          const albumData = target.data;
          const descriptionRes = await updateAlbumDescription({
            artist: organizeArtists(form.artist) || form.artist,
            album: form.title,
            description: form.description || "",
          });
          albumDescriptionSaved = descriptionRes?.status === "ok";
          const rawAlbumArtist = form.album_artist !== undefined && form.album_artist !== null ? String(form.album_artist) : undefined;
          const common = {
            artist: organizeArtists(form.artist) || undefined,
            album_artist: rawAlbumArtist === undefined
              ? undefined
              : (rawAlbumArtist.trim() === "" ? " " : organizeArtists(rawAlbumArtist)),
            genre: form.genre || undefined,
            year: form.year ? String(form.year) : undefined,
             publisher: resolvePublisher(form.publisher),
             description: form.description !== undefined ? form.description : undefined,
             ...(editCoverFile ? { cover: editCoverFile } : {}),
          };
          for (const song of albumData.songs || []) {
            if (!song.file_path) continue;
            const res = await updateMusicMetadata({
              file_path: song.file_path,
              album: form.title || undefined,
              ...common,
            });
            if (res?.status === "ok" && res.song) {
              removedPaths.push(song.file_path);
              addedSongs.push(buildIndexSong(song, res.song));
            }
          }
        } else if (target.type === "song") {
          const res = await updateMusicMetadata({
            file_path: target.data.file_path,
            title: form.title || undefined,
            artist: organizeArtists(form.artist) || undefined,
            album: form.album || undefined,
            album_artist: (() => {
              if (form.album_artist === undefined || form.album_artist === null) return undefined;
              const raw = String(form.album_artist);
              return raw.trim() === "" ? " " : organizeArtists(raw);
            })(),
            genre: form.genre || undefined,
            year: form.year ? String(form.year) : undefined,
            trackNo:
              form.trackNo !== undefined && form.trackNo !== null
                ? (String(form.trackNo).trim() === "" ? " " : String(form.trackNo))
                : undefined,
            discNo:
              form.discNo !== undefined && form.discNo !== null
                ? (String(form.discNo).trim() === "" ? " " : String(form.discNo))
                : undefined,
            composer: form.composer || undefined,
            lyricist: form.lyricist || undefined,
            publisher: resolvePublisher(form.publisher),
            comment: form.comment || undefined,
            lyrics: form.lyrics || undefined,
            ...(matched ? { matched: "1" } : {}),
            ...(matchSource ? { match_source: matchSource } : {}),
            ...(editCoverFile ? { cover: editCoverFile } : {}),
          });
          if (res?.status === "ok" && res.song) {
            removedPaths.push(target.data.file_path);
            addedSongs.push(buildIndexSong(target.data, res.song));
          }
        }

        if (removedPaths.length > 0 || albumDescriptionSaved) {
          removedPaths.forEach((p) => removeSongFromIndex(p));
          addedSongs.forEach((s) => saveSongToIndex(s));

          // ---- 无缝播放：当前播放歌曲若被物理移动（URL 变化），切换到独立播放源并记录恢复点 ----
          const movedIdx = currentSong?.file_path ? removedPaths.indexOf(currentSong.file_path) : -1;
          const movedSong = movedIdx >= 0 ? addedSongs[movedIdx] : null;
          if (movedIdx >= 0 && movedSong?.file_path && movedSong.file_path !== currentSong.file_path) {
            setCurrentAlbumId(null);
            setCurrentPlaylistId(null);
            setPlayQueue([movedSong]);
            setCurrentSongIndex(0);
            editRestoreRef.current = { newUrl: movedSong.url, time: currentTime, playing: isPlaying };
          }

          const refreshedAlbums = await refreshFromServer();
          if (target.type === "album" && detailAlbumId === target.data.id) {
            const refreshedAlbum = refreshedAlbums.find((item) =>
              item.title === (form.title || target.data.title)
              && (item.artist === (form.artist || target.data.artist)
                || item.album_artist === (form.album_artist || target.data.album_artist))
            );
            if (refreshedAlbum) setDetailAlbumId(refreshedAlbum.id);
          }

          // 标题/艺人/专辑被改名会导致后端物理移动文件（file_path 变化），
          // 同步各播放列表中的旧快照，避免残留旧信息
          const movedByPath = new Map();
          const movedByUrl = new Map();
          removedPaths.forEach((oldPath, i) => {
            const newSong = addedSongs[i];
            if (!newSong || !newSong.file_path || newSong.file_path === oldPath) return;
            movedByPath.set(oldPath, newSong);
            movedByUrl.set(getAssetUrl(`/library/${oldPath}`), newSong);
          });
          if (movedByPath.size > 0) {
            setPlaylists((prev) =>
              prev.map((pl) => {
                let changed = false;
                const songs = (pl.songs || []).map((s) => {
                  const live = (s.file_path && movedByPath.get(s.file_path))
                    || (!s.file_path && s.url && movedByUrl.get(s.url));
                  if (live) {
                    changed = true;
                    return live;
                  }
                  return s;
                });
                return changed ? { ...pl, songs } : pl;
              })
            );

            const replacements = new Map(Array.from(movedByPath.entries()).map(([oldPath, newSong]) => [normalizeSongRef(oldPath), primarySongRef(newSong)]));
            const videoUpdates = (videos || []).map((video) => {
              let changed = false;
              const nextIds = (video.song_ids || []).map((ref) => {
                const replacement = replacements.get(normalizeSongRef(ref));
                if (!replacement) return ref;
                changed = true;
                return replacement;
              });
              return changed ? updateVideo(video.id, { song_ids: Array.from(new Set(nextIds)) }) : null;
            }).filter(Boolean);
            if (videoUpdates.length > 0) {
              try {
                await Promise.all(videoUpdates);
                await refreshVideos();
              } catch (err) {
                showToast(err?.message || "音乐路径已更新，但视频关联同步失败", "warning");
              }
            }
          }

          // ---- 导航策略 ----
          let navigateHome = false;
          if (target.type === "song") {
            const artistChanged = origArtist !== form.artist;
            const albumArtistChanged = origAlbumArtist !== form.album_artist;

            if (isSingleSong) {
              // 单曲专辑：改艺人 / 专辑艺人 → 返回资料库；改歌名 → 留在原位
              if (artistChanged || albumArtistChanged) navigateHome = true;
            } else {
              // 多曲专辑单曲编辑：仅当专辑艺人与该专辑不一致时搬家 → 返回资料库
              if (albumArtistChanged && form.album_artist && form.album_artist !== albumAlbumArtist) {
                navigateHome = true;
              }
            }
          }

          if (navigateHome) {
            setDetailAlbumId(null);
            setDetailArtistName(null);
            setDetailPlaylistId(null);
            setActiveNav("library");
          }
        }
      } catch (err) {
        console.warn("保存元信息失败:", err);
      }
    }

  // ---------- 播放列表操作菜单 ----------
  function handleOpenPlaylistMenu(e, playlist) {
    e.stopPropagation();
    e.preventDefault();
    const menuWidth = 180;
    const menuHeight = 200;
    let x = e.clientX;
    let y = e.clientY;
    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth - 8;
    }
    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight - 8;
    }
    setPlaylistMenu({ x, y, playlist });
  }

  function handleClosePlaylistMenu() {
    setPlaylistMenu(null);
  }

  function handlePlaylistMenuAction(action, playlist) {
    handleClosePlaylistMenu();
    if (!playlist) return;

    if (action === "pin") {
      setPlaylists((prev) => prev.map((p) => (
        p.id === playlist.id ? { ...p, pinned: !p.pinned } : p
      )));
    } else if (action === "play") {
      const songs = (playlist.songs || []).map(s => ({ ...s, albumId: playlist.id }));
      if (songs.length === 0) return;
      if (currentPlaylistId === playlist.id) {
        togglePlay();
      } else {
        setCurrentAlbumId(null);
        setCurrentPlaylistId(playlist.id);
        setPlayQueue([]);
        setCurrentSongIndex(0);
        setIsPlaying(true);
      }
    } else if (action === "edit") {
      handleOpenPlaylistEdit(playlist);
    } else if (action === "playNext") {
      const songs = playlist.songs.map(s => ({ ...s, albumId: playlist.id }));
      if (songs.length === 0) return;
      if (currentSong && !currentAlbumId && !currentPlaylistId && playQueue.length > 0) {
        const insertAt = currentSongIndex + 1;
        setPlayQueue((prev) => {
          const newQueue = [...prev];
          newQueue.splice(insertAt, 0, ...songs);
          return newQueue;
        });
      } else {
        setPlayQueue((prev) => [...songs, ...prev]);
      }
      if (!currentSong) {
        setCurrentAlbumId(null);
        setCurrentPlaylistId(null);
        setPlayQueue(songs);
        setCurrentSongIndex(0);
        setIsPlaying(true);
      }
    } else if (action === "playLater") {
      const songs = playlist.songs.map(s => ({ ...s, albumId: playlist.id }));
      if (songs.length === 0) return;
      setPlayQueue((prev) => [...prev, ...songs]);
      if (!currentSong) {
        setCurrentAlbumId(null);
        setCurrentPlaylistId(null);
        setPlayQueue(songs);
        setCurrentSongIndex(0);
        setIsPlaying(true);
      }
    } else if (action === "delete") {
      setDeletePlaylistConfirm(playlist.id);
    }
  }

  function handleConfirmDeletePlaylist() {
    const playlistId = deletePlaylistConfirm;
    if (!playlistId) return;
    handleDeletePlaylist(playlistId);
    setDeletePlaylistConfirm(null);
  }

  function handleCancelDeletePlaylist() {
    setDeletePlaylistConfirm(null);
  }

  // ---------- 过滤专辑 ----------
  const filteredAlbums = albums.filter((a) => {
    if (!filterText) return true;
    const t = filterText.toLowerCase();
        return (
      a.title.toLowerCase().includes(t) ||
      a.artist.toLowerCase().includes(t) ||
      (a.genre && a.genre.toLowerCase().includes(t))
    );
  });

    // ---------- 播放历史记录（用于"最近播放"排序） ----------
  const [playHistory, setPlayHistory] = useState([]); // 专辑 id 数组，最新播放在前
  // 当播放的专辑变化时记录
  const prevAlbumIdRef = useRef(null);
  useEffect(() => {
    // 应用已保存的主题（深色/浅色/跟随系统）
    const savedTheme = localStorage.getItem("app-theme") || "light";
    applyTheme(savedTheme);

    // 跟随系统：监听系统主题变化并实时更新
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemThemeChange = () => {
      const current = localStorage.getItem("app-theme") || "light";
      if (current === "system") {
        applyTheme("system");
      }
    };
    mediaQuery.addEventListener("change", handleSystemThemeChange);
    return () => mediaQuery.removeEventListener("change", handleSystemThemeChange);
  }, []);

  // 启动时以服务端设置为准，并把旧版 localStorage 设置迁移到服务端一次。
  useEffect(() => {
    let cancelled = false;
    getSettings().then((data) => {
      if (cancelled) return;
      const remote = data?.app_settings;
      if (remote && typeof remote === "object" && Object.keys(remote).length > 0) {
        APP_SETTING_KEYS.forEach((key) => {
          if (remote[key] !== undefined && remote[key] !== null) localStorage.setItem(key, String(remote[key]));
        });
        setLibraryTitle(localStorage.getItem("library-display-name") || "音乐资料库");
        setShowMoreCategories(localStorage.getItem("library-show-more-categories") === "true");
        setCategoryVisibility({
          composer: localStorage.getItem("library-category-composer") !== "false",
          lyricist: localStorage.getItem("library-category-lyricist") !== "false",
          genre: localStorage.getItem("library-category-genre") !== "false",
          video: localStorage.getItem("library-category-video") === "true",
        });
        setHideEmptyArtists(localStorage.getItem("artist-hide-empty") !== "false");
        setVolume(normalizeStoredVolume(remote["player-volume"], normalizeStoredVolume(localStorage.getItem("player-volume"))));
      } else {
        const legacy = collectAppSettings();
        if (Object.keys(legacy).length > 0) saveAppSettings(legacy).catch(() => {});
      }
      volumeSettingsHydratedRef.current = true;
    }).catch(() => { volumeSettingsHydratedRef.current = true; });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!volumeSettingsHydratedRef.current) return undefined;
    const normalized = normalizeStoredVolume(volume);
    localStorage.setItem("player-volume", String(normalized));
    const timer = window.setTimeout(() => {
      saveAppSettings({ "player-volume": String(normalized) }).catch(() => {});
    }, 300);
    return () => window.clearTimeout(timer);
  }, [volume]);

  // ---------- 启动时加载已导入的音乐（本地索引优先，后端用于校验缺失） ----------
  useEffect(() => {
    // 1. 从本地索引构建专辑（即使服务未启动也能展示已导入内容）
    const index = loadMusicIndex();
    const idxEntries = Object.entries(index);
    if (idxEntries.length > 0) {
      const idxAlbums = buildAlbumsFromIndex(index);
      startTransition(() => setAlbums((prev) => mergeAlbumsByTitle(prev, idxAlbums)));
    }

    // 2. 后端可用时：刷新已存在歌曲的 URL / 封面，并检测缺失文件
    async function reconcile() {
      try {
        const data = await getMusicList();
        if (Array.isArray(data)) {
          const serverAlbums = buildAlbumsFromServer(data);
          // 服务端为权威数据源：成功连接后直接替换本地离线索引的临时内容，
          // 防止不同浏览器留下已删除或过期的专辑/歌曲。
          setAlbums(serverAlbums);

          // 从清单响应中收集缺失文件（file_exists=false）
          const missingFromServer = new Set();
          data.forEach((artistEntry) =>
            (artistEntry.albums || []).forEach((albumEntry) =>
              (albumEntry.songs || []).forEach((s) => {
                if (s.file_exists === false && s.file_path) missingFromServer.add(s.file_path);
              })
            )
          );
          setMissingSongs(missingFromServer);
        }

        // 额外用 checkMusicFiles 校验本地索引中的路径（兼容未在清单中的情况）
        const paths = Object.keys(index);
        if (paths.length > 0) {
          const res = await checkMusicFiles(paths);
          const missing = new Set();
          Object.entries(res.exists || {}).forEach(([p, exists]) => {
            if (!exists) missing.add(p);
          });
          if (missing.size > 0) {
            setMissingSongs((prev) => new Set([...prev, ...missing]));
          }
        }
      } catch (err) {
        console.warn("后端不可用，仅展示本地索引歌曲:", err);
      }
    }
    reconcile();
  }, []);

  // ---------- 懒加载：监听 sentinel 进入主内容区视口时追加 40 条 ----------
  useEffect(() => {
    const container = mainAreaRef.current;
    const sentinel = sentinelRef.current;
    if (!container || !sentinel) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisibleCount((c) => c + 40);
        }
      },
      { root: container, rootMargin: "300px" }
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [activeNav]);

  // ---------- 播放列表：后端为唯一权威数据源；本地缓存只用于离线首屏回退 ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const server = await getPlaylists();
        if (cancelled) return;
        if (!Array.isArray(server)) return;
        // 即使服务端为空，也不能用当前浏览器的旧缓存反向覆盖它；
        // 只补齐内置列表，随后由下方受 hydration 保护的保存逻辑统一初始化。
        const canonical = ensureDefaultPlaylists(server);
        startTransition(() => setPlaylists(canonical));
        savePlaylistCache(canonical);
        setPlaylistsHydrated(true);
      } catch {
      // 后端不可用：保持本地缓存，但绝不把它自动写回，避免服务恢复时产生覆盖。
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ---------- 艺人数据：从后端加载存储的艺人记录 ----------
  useEffect(() => {
    let cancelled = false;
    getArtists()
      .then((data) => {
        if (cancelled) return;
        if (data && typeof data === "object") setArtistRecords(data);
      })
      .catch(() => {
        // 后端不可用：艺人仅由专辑派生
      });
    return () => { cancelled = true; };
  }, []);

  // ---------- 播放列表：防抖双写（localStorage 缓存 + 后端文件） ----------
  useEffect(() => {
    if (!playlistsHydrated) return undefined;
    const t = setTimeout(() => {
      savePlaylistCache(playlists);
      savePlaylists(normalizePlaylists(playlists)).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [playlists, playlistsHydrated]);

  // ---------- 播放列表：专辑就绪后，用 file_path 把快照替换为最新歌曲对象 ----------
  useEffect(() => {
    const lookup = new Map();
    for (const a of albums) {
      for (const s of a.songs || []) {
        if (s.file_path && !lookup.has(s.file_path)) lookup.set(s.file_path, s);
      }
    }
    startTransition(() => {
      setPlaylists((prev) =>
        prev.map((pl) => {
          let changed = false;
          const songs = (pl.songs || []).map((s) => {
            const live = s.file_path ? lookup.get(s.file_path) : null;
            if (live && (s.url !== live.url || s.title !== live.title)) {
              changed = true;
              return live;
            }
            return s;
          });
          return changed ? { ...pl, songs } : pl;
        })
      );
    });
  }, [albums]);

  useEffect(() => {
    if (currentAlbumId && isPlaying && currentAlbumId !== prevAlbumIdRef.current) {
      prevAlbumIdRef.current = currentAlbumId;
      setPlayHistory((prev) => {
        const filtered = prev.filter((id) => id !== currentAlbumId);
        return [currentAlbumId, ...filtered];
      });
    }
  }, [currentAlbumId, isPlaying]);

  // ---------- 分类排序（资料库视图） ----------
  const [librarySortMode, setLibrarySortMode] = useState("recent_add"); // "recent_add" | "recent_play" | "time" | "album" | "playlist"

  // ---------- 全部播放列表排序 ----------
  const [playlistSortMode, setPlaylistSortMode] = useState("recent_create"); // "recent_create" | "create_time" | "a-z"
  const [playlistTimeDir, setPlaylistTimeDir] = useState("desc"); // "desc" | "asc"
  const sortedPlaylists = [...playlists].sort((a, b) => {
    const getTime = (pl) => {
      return Number(pl.createdAt) || parseInt(String(pl.id || "").replace("pl_", "")) || 0;
    };
    switch (playlistSortMode) {
      case "a-z":
        return a.name.localeCompare(b.name, "zh-CN");
      case "create_time": {
        const diff = getTime(a) - getTime(b);
        return playlistTimeDir === "desc" ? -diff : diff;
      }
      case "recent_create":
      default:
        return getTime(b) - getTime(a);
    }
  });

  // 构造"最近播放"排序用的顺序映射
  const playHistoryOrder = useCallback(() => {
    const order = new Map();
    playHistory.forEach((id, idx) => order.set(id, idx));
    return order;
  }, [playHistory]);

    // 资料库视图：对过滤后的专辑排序
  const librarySortedAlbums = [...filteredAlbums].sort((a, b) => {
    switch (librarySortMode) {
      case "recent_play": {
        const orderMap = playHistoryOrder();
        const idxA = orderMap.has(a.id) ? orderMap.get(a.id) : Infinity;
        const idxB = orderMap.has(b.id) ? orderMap.get(b.id) : Infinity;
        return idxA - idxB;
      }
      case "time": {
        // 按年份降序（最新的年份在前），无年份的排最后
        const yearA = a.year || 0;
        const yearB = b.year || 0;
        return yearB - yearA;
      }
      case "album":
        return a.title.localeCompare(b.title, "zh-CN");
      case "playlist":
        // 按歌曲数量降序排
        return (b.songs?.length || 0) - (a.songs?.length || 0);
      case "recent_add":
      default:
        // 按导入时间降序，最新导入的在前（立即展示新导入的音乐）
        return (b.importTime || 0) - (a.importTime || 0);
    }
  });

  // 资料库中的专辑和播放列表必须共用一条排序序列，不能先渲染全部专辑再追加播放列表。
  const libraryItems = [
    ...librarySortedAlbums.map((album) => ({ type: "album", item: album, sortTime: album.importTime || 0 })),
    ...playlists.map((playlist) => ({
      type: "playlist",
      item: playlist,
      sortTime: Number(playlist.createdAt) || parseInt(String(playlist.id || "").replace("pl_", "")) || 0,
    })),
  ].filter(({ type }) => librarySortMode !== "album" || type === "album").sort((a, b) => {
    if (librarySortMode === "recent_add") return b.sortTime - a.sortTime;
    if (librarySortMode === "time") return (b.item.year || 0) - (a.item.year || 0);
    if (librarySortMode === "album") return (a.item.title || a.item.name || "").localeCompare(b.item.title || b.item.name || "", "zh-CN");
    if (librarySortMode === "recent_play") return a.type === b.type ? 0 : (a.type === "album" ? -1 : 1);
    return 0;
  });
  const libraryItemOrder = new Map(libraryItems.map(({ type, item }, index) => [`${type}:${item.id}`, index]));

        // ---------- 歌曲视图排序 ----------
    const [songFilters, setSongFilters] = useState(new Set(["recent_add"])); // 多选过滤标签
    const [songTimeDir, setSongTimeDir] = useState("desc"); // "desc" | "asc"
    const [albumFilters, setAlbumFilters] = useState(new Set(["recent_add"]));
    const [albumTimeDir, setAlbumTimeDir] = useState("desc");

    // 哨兵会随异步数据和批次重新挂载，因此依赖当前数据与可见数量重新绑定。
    useEffect(() => {
      if (activeNav !== "songs") return undefined;
      const container = mainAreaRef.current;
      const sentinel = songSentinelRef.current;
      if (!container || !sentinel) return undefined;

      const observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting) || songLoadPendingRef.current) return;
        songLoadPendingRef.current = true;
        setIsLoadingMoreSongs(true);
        startTransition(() => setSongVisibleCount((count) => count + 30));
        window.setTimeout(() => {
          songLoadPendingRef.current = false;
          setIsLoadingMoreSongs(false);
        }, 120);
      }, {
        root: container,
        rootMargin: "0px 0px 500px 0px",
      });

      observer.observe(sentinel);
      return () => observer.disconnect();
    }, [activeNav, albums, songVisibleCount, songFilters, songTimeDir]);

        // ---------- 歌曲多选状态 ----------
        const [selectedSongs, setSelectedSongs] = useState(new Set()); // 存储选中的歌曲key（"albumId-index"）
        const [isSelecting, setIsSelecting] = useState(false); // 是否处于多选模式
        const [showDeleteConfirm, setShowDeleteConfirm] = useState(false); // 是否显示删除确认浮窗
        const [deleteSongConfirm, setDeleteSongConfirm] = useState(null); // 单曲删除确认

                // ---------- 单曲菜单状态 ----------
    const [contextMenu, setContextMenu] = useState(null); // { x, y, song } 或 null

                // ---------- 专辑操作菜单状态 ----------
        const [albumMenu, setAlbumMenu] = useState(null); // { x, y, album } 或 null
        const [deleteAlbumConfirm, setDeleteAlbumConfirm] = useState(null); // 要删除的专辑id或null
        const [favoriteAlbums, setFavoriteAlbums] = useState(new Set()); // 收藏的专辑id集合

        // ---------- 播放列表操作菜单状态 ----------
        const [playlistMenu, setPlaylistMenu] = useState(null); // { x, y, playlist } 或 null
        const [deletePlaylistConfirm, setDeletePlaylistConfirm] = useState(null); // 要删除的播放列表id或null

        // ---------- 编辑元信息 ----------
        const [editTarget, setEditTarget] = useState(null); // { type: "album"|"song", data } 或 null

        // ---------- 文件缺失检测 ----------
        // 判断专辑是否全部缺失
        const isAlbumAllMissing = (album) =>
          (album?.songs || []).length > 0 &&
          album.songs.every((s) => s.file_path && missingSongs.has(s.file_path));

    // ---------- 艺人视图排序 ----------
    const [artistSortMode, setArtistSortMode] = useState("a-z"); // "a-z" | "z-a"

    // ---------- 专辑视图排序 ----------
    const [sortMode] = useState("recent_add"); // "recent_add" | "new_to_old" | "old_to_new"

  // 按分类对过滤后的专辑排序
  const sortedAlbums = [...filteredAlbums].sort((a, b) => {
    if (sortMode === "new_to_old") {
      // 从新到旧：按年份降序，无年份排最后
      const yearA = a.year || 0;
      const yearB = b.year || 0;
      return yearB - yearA;
    }
    if (sortMode === "old_to_new") {
      // 从旧到新：按年份升序，无年份排最后
      const yearA = a.year || 9999;
      const yearB = b.year || 9999;
      return yearA - yearB;
    }
    // "recent_add" — 按导入时间降序，最新导入的在前
    return (b.importTime || 0) - (a.importTime || 0);
  });

      // ---------- 渲染 ----------
  return (
    <div
      style={styles.container}
      className="app-root"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
            

            {/* ============================================================ */}
            {/* ① 侧边栏 + 主内容区（左右布局）                          */}
            {/* ============================================================ */}
            <div style={styles.bodyLayout}>
                                                        {/* 侧边栏 */}
                            <Sidebar
                              activeNav={activeNav}
                              onNavChange={handleNavChange}
                              playlists={playlists}
                              onOpenPlaylistMenu={handleOpenPlaylistMenu}
                              onRenamePlaylist={handleRenamePlaylist}
                              showMoreCategories={showMoreCategories}
                              categoryVisibility={categoryVisibility}
                            />

              {/* 右侧主区域 */}
              <div style={styles.rightArea}>
                {/* 顶部功能条 */}
                <header style={styles.topBar} className="app-topbar">
                  {/* 左侧：LOGO / 标题 */}
                  <div style={styles.logoArea}>
                    <span style={styles.logoIcon}>🎵</span>
                    <h1 style={styles.logoTitle}>{libraryTitle}</h1>
                  </div>

                  {/* 右侧：通知、设置、添加 */}
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginLeft: "auto" }}>
                  {/* 通知按钮 */}
                  <button
                    className="topbar-secondary-btn"
                    style={{ ...styles.secondaryTopBtn, position: "relative" }}
                    onClick={() => { setShowActivity(true); setUnreadCount(0); }}
                    title="通知"
                  >
                    <FaBell size={18} />
                    {unreadCount > 0 && (
                      <span style={styles.bellBadge}>{unreadCount}</span>
                    )}
                  </button>
                  {/* 设置按钮 */}
                  <button
                    className="topbar-secondary-btn"
                    style={styles.secondaryTopBtn}
                    onClick={() => setShowSettings(true)}
                    title="设置"
                  >
                    <FaCog size={18} />
                  </button>
                  <div style={{ position: "relative" }}>
                    <button
                      className="upload-btn"
                      style={styles.importBtn}
                      onClick={() => setShowImportMenu(!showImportMenu)}
                      title="添加"
                    >
                      <FiPlus size={18} />
                    </button>
                    {showImportMenu && (
                      <>
                        <div style={styles.menuOverlay} onClick={() => setShowImportMenu(false)} />
                        <div style={styles.importDropdown}>
                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => { setShowImportMenu(false); fileInputRef.current?.click(); }}><FaMusic size={14} style={{ marginRight: "10px" }} /><span>添加歌曲</span></div>
                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => { setShowImportMenu(false); videoInputRef.current?.click(); }}><FaVideo size={14} style={{ marginRight: "10px" }} /><span>添加视频</span></div>
                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => { setShowImportMenu(false); handleAddWebVideo(); }}><FaVideo size={14} style={{ marginRight: "10px" }} /><span>关联视频网站视频</span></div>
                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => { setShowImportMenu(false); handleOpenCreatePlaylist(); }}><FaPlus size={14} style={{ marginRight: "10px" }} /><span>新建播放列表</span></div>
                          {smartAvailable && <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => { setShowImportMenu(false); setSmartPlaylistName(""); setSmartPlaylistPrompt(""); setShowSmartPlaylist(true); }}><FaStar size={14} style={{ marginRight: "10px", color: "#e94560" }} /><span>智能歌单</span></div>}
                        </div>
                      </>
                    )}
                    <input ref={fileInputRef} type="file" accept="audio/*" multiple onChange={handleImportFiles} style={{ display: "none" }} />
                    <input ref={videoInputRef} type="file" accept="video/*,.mkv,.avi,.flv,.wmv" multiple onChange={handleVideoFiles} style={{ display: "none" }} />
                    <input ref={coverInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = (ev) => { setNewPlaylistCover(ev.target.result); setNewPlaylistCoverRemoved(false); }; reader.readAsDataURL(file); }} />
                  </div>
                  </div>

                </header>

                                {/* ============================================================ */}
                {/* ② 中间内容区 — 按导航切换视图                            */}
                {/* ============================================================ */}
                                {detailVideoId ? (
                  <VideoDetail
                    video={videos.find((item) => item.id === detailVideoId)}
                    initialEditing={editVideoOnOpenId === detailVideoId}
                    songs={albums.flatMap((album) => album.songs || [])}
                    albums={albums}
                    playlists={playlists}
                    onBack={relatedVideoScope ? () => setDetailVideoId(null) : handleCloseVideoDetail}
                    onSave={handleSaveVideo}
                    onDelete={handleDeleteVideo}
                    onOpenLocal={openVideoFile}
                    onOpenAlbum={(albumId) => {
                      setDetailVideoId(null);
                      setRelatedVideoScope(null);
                      handleOpenAlbumDetail(albumId);
                    }}
                    onOpenPlaylist={(playlistId) => {
                      setDetailVideoId(null);
                      setRelatedVideoScope(null);
                      handleOpenPlaylistDetail(playlistId);
                    }}
                  />
                ) : relatedVideoScope ? (
                  <VideoLibrary
                    videos={videos.filter((video) => relatedVideoScope.videoIds.includes(video.id))}
                    albums={albums}
                    title={relatedVideoScope.title}
                    onOpen={(id) => { setEditVideoOnOpenId(null); setDetailVideoId(id); }}
                    onEdit={(id) => { setEditVideoOnOpenId(id); setDetailVideoId(id); }}
                    onDelete={handleDeleteVideo}
                    onBack={() => setRelatedVideoScope(null)}
                  />
                ) : detailAlbumId ? (
                  /* ----- 专辑详情页（从专辑网格点进去） ----- */
                   <div style={styles.detailPageArea}>
                     <DetailErrorBoundary
                       key={detailAlbumId}
                       onRecover={() => {
                         setDetailAlbumId(null);
                         setDetailArtistName(null);
                         setActiveNav("library");
                       }}
                     >
                                           <AlbumDetail
                      album={albums.find((a) => a.id === detailAlbumId)}
                      playlists={playlists}
                      setPlaylists={setPlaylists}
                      missingSongs={missingSongs}
                      onMissingSongClick={(song) => setMissingDialogSong(song)}
                      currentSongIndex={
                        detailAlbumId === currentAlbumId ? currentSongIndex : -1
                      }
                      isPlaying={detailAlbumId === currentAlbumId && isPlaying}
                      onPlayAlbum={handlePlayAlbumFromDetail}
                      onPlaySong={handlePlaySongFromDetail}
                      onBack={handleCloseDetail}
                      onOpenArtist={handleOpenArtistDetail}
                      onPlayNext={(song) => {
                        setPlayQueue((prev) => [song, ...prev]);
                        if (!currentSong) {
                          setCurrentAlbumId(detailAlbumId);
                          setCurrentSongIndex(0);
                          setIsPlaying(true);
                        }
                      }}
                      onPlayLater={(song) => {
                        setPlayQueue((prev) => [...prev, song]);
                        if (!currentSong) {
                          setCurrentAlbumId(detailAlbumId);
                          setCurrentSongIndex(0);
                          setIsPlaying(true);
                        }
                      }}
                      onDeleteAlbum={(id) => { setDeleteAlbumConfirm(id); }}
                      onEditInfo={handleOpenMusicEdit}
                      onDeleteSong={handleDeleteSongFromDetail}
                      artistRecords={artistRecords}
                      videos={videos}
                      onOpenVideo={handleOpenVideoDetail}
                      onMoreVideos={(videoIds) => setRelatedVideoScope({ title: `${albums.find((item) => item.id === detailAlbumId)?.title || "专辑"} · 关联视频`, videoIds })}
                     />
                     </DetailErrorBoundary>
                   </div>
                ) : detailPlaylistId ? (
                  /* ----- 播放列表详情页（从侧边栏/资料库卡片点进去） ----- */
                  <div style={styles.detailPageArea}>
                    <PlaylistDetail
                      playlist={playlists.find((p) => p.id === detailPlaylistId)}
                      playlists={playlists}
                      onEditPlaylist={handleOpenPlaylistEdit}
                      missingSongs={missingSongs}
                      onMissingSongClick={(song) => setMissingDialogSong(song)}
                      currentSongIndex={
                        detailPlaylistId === currentPlaylistId ? currentSongIndex : -1
                      }
                      isPlaying={detailPlaylistId === currentPlaylistId && isPlaying}
                      onPlayAll={handlePlayAllFromPlaylist}
                      onPlaySong={handlePlaySongFromPlaylist}
                      onBack={handleClosePlaylistDetail}
                      onOpenAlbum={handleOpenAlbumFromPlaylistSong}
                      onOpenArtist={handleOpenArtistDetail}
                      onDeletePlaylist={(id) => setDeletePlaylistConfirm(id)}
                      setPlaylists={setPlaylists}
                      onPlayNext={(song) => {
                        setPlayQueue((prev) => [song, ...prev]);
                        if (!currentSong) {
                          setCurrentPlaylistId(detailPlaylistId);
                          setCurrentSongIndex(0);
                          setIsPlaying(true);
                        }
                      }}
                      onPlayLater={(song) => {
                        setPlayQueue((prev) => [...prev, song]);
                        if (!currentSong) {
                          setCurrentPlaylistId(detailPlaylistId);
                          setCurrentSongIndex(0);
                          setIsPlaying(true);
                        }
                      }}
                      onRemoveFromPlaylist={handleRemoveFromPlaylist}
                      onDeleteSong={(song) => setDeleteSongConfirm({ ...song, albumId: song.albumId })}
                      onEditInfo={handleOpenMusicEdit}
                      videos={videos}
                      librarySongs={albums.flatMap((album) => album.songs || [])}
                      onOpenVideo={handleOpenVideoDetail}
                      onMoreVideos={(videoIds) => setRelatedVideoScope({ title: `${playlists.find((item) => item.id === detailPlaylistId)?.name || "播放列表"} · 关联视频`, videoIds })}
                    />
                  </div>
                ) : activeNav === "search" ? (
                  /* ================================================================ */
                  /* 搜索结果页                                                        */
                  /* ================================================================ */
                  <main style={{ ...styles.mainArea, padding: "28px 32px", display: "flex", flexDirection: "column" }}>
                    <div style={{ width: "min(520px, 100%)", alignSelf: "center", marginBottom: "24px" }}>
                      <Search
                        filterText={filterText}
                        setFilterText={setFilterText}
                        activeNav={activeNav}
                        onNavChange={handleNavChange}
                      />
                    </div>
                    <SearchResults
                      filterText={filterText}
                      setFilterText={setFilterText}
                      albums={albums}
                      playlists={playlists}
                      artistRecords={artistRecords}
                      onPlaySong={handlePlaySongFromSearch}
                      onOpenAlbum={handleOpenAlbumDetail}
                      onOpenArtist={handleOpenArtistDetail}
                      onOpenPlaylist={handleOpenPlaylistDetail}
                      onNavChange={handleNavChange}
                      currentSongIndex={currentSongIndex}
                      currentAlbumId={currentAlbumId}
                      isPlaying={isPlaying}
                      togglePlay={togglePlay}
                    />
                  </main>
                ) : activeNav === "videos" ? (
                  <VideoLibrary videos={videos} albums={albums} onOpen={handleOpenVideoDetail} onEdit={handleOpenVideoEditor} onDelete={handleDeleteVideo} />
                ) : ["composer", "lyricist", "genres"].includes(activeNav) ? (
                  <MetadataBrowser
                    type={activeNav === "genres" ? "genre" : activeNav}
                    albums={albums}
                    artistRecords={artistRecords}
                    selected={metadataRoute.type === activeNav ? metadataRoute.selected : null}
                    view={metadataRoute.type === activeNav ? metadataRoute.view : "list"}
                    onRouteChange={(selected, view = "list") => setMetadataRoute({ type: activeNav, selected, view })}
                    onOpenAlbum={handleOpenAlbumDetail}
                    onOpenArtist={handleOpenArtistDetail}
                  />
                ) : activeNav === "albums" ? (
                  /* ================================================================ */
                  /* 专辑视图                                                         */
                  /* ================================================================ */
                                    <main style={styles.mainArea} ref={mainAreaRef}>
                    <div style={styles.sortBar}>
                      {["recent_add", "favorite", "time", "matched", "unmatched"].map((tag) => {
                        const label =
                          tag === "recent_add" ? "最近添加"
                            : tag === "favorite" ? "已喜爱"
                              : tag === "time" ? "时间"
                                : tag === "matched" ? "已匹配"
                                  : "未匹配";
                        const isActive = albumFilters.has(tag);
                        const isTime = tag === "time";
                        return (
                          <button
                            key={tag}
                            style={{
                              ...styles.sortBtn,
                              ...(isActive ? styles.sortBtnActive : {}),
                            }}
                            onClick={() => {
                              if (isTime) {
                                if (isActive) {
                                  setAlbumTimeDir((d) => (d === "desc" ? "asc" : "desc"));
                                } else {
                                  setAlbumFilters((prev) => new Set([...prev, tag]));
                                }
                              } else {
                                setAlbumFilters((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(tag)) {
                                    next.delete(tag);
                                  } else {
                                    if (tag === "matched") next.delete("unmatched");
                                    if (tag === "unmatched") next.delete("matched");
                                    next.add(tag);
                                  }
                                  if (next.size === 0) next.add("recent_add");
                                  return next;
                                });
                              }
                            }}
                          >
                            {isTime && isActive ? (albumTimeDir === "desc" ? "从新到旧" : "从旧到新") : label}
                          </button>
                        );
                      })}
                      {albumFilters.size > 1 && (
                        <button
                          style={styles.cancelFilterBtn}
                          onClick={() => setAlbumFilters(new Set(["recent_add"]))}
                        >
                          取消
                        </button>
                      )}
                    </div>
                    {(() => {
                      let filtered = sortedAlbums;
                      if (albumFilters.has("favorite")) {
                        filtered = filtered.filter((a) => favoriteAlbums.has(a.id));
                      }
                      if (albumFilters.has("matched")) {
                        filtered = filtered.filter((a) => a.matched);
                      }
                      if (albumFilters.has("unmatched")) {
                        filtered = filtered.filter((a) => !a.matched);
                      }
                      const sorted = [...filtered].sort((a, b) => {
                        if (albumFilters.has("time")) {
                          const diff = albumTimeDir === "desc"
                            ? (b.year || 0) - (a.year || 0)
                            : (a.year || 9999) - (b.year || 9999);
                          if (diff !== 0) return diff;
                        }
                        return b.id.localeCompare(a.id);
                      });
                      return sorted.length === 0 ? (
                      <div style={styles.emptyState}>
                        <span style={styles.emptyIcon}>📀</span>
                        <p style={styles.emptyText}>还没有导入任何专辑</p>
                        <p style={styles.emptyHint}>点击右上角「导入音乐」按钮添加你的音乐文件</p>
                      </div>
                    ) : (
                      <>
                      <div style={styles.albumGrid}>
                        {sorted.slice(0, visibleCount).map((album) => {
                          const isActive = album.id === currentAlbumId;
                          return (
                            <div
                              key={album.id}
                              className="album-card"
                              style={{
                                ...styles.albumCard,
                                ...(isActive ? styles.albumCardActive : {}),
                              }}
                              onClick={() => handleOpenAlbumDetail(album.id)}
                            >
                              <div style={styles.coverWrapper}>
                                <div style={styles.coverPlaceholder}>
                                  <span style={styles.coverPlaceholderIcon}>🎶</span>
                                </div>
                                {album.coverURL && (
                                  <img
                                    src={album.coverURL}
                                    alt={album.title}
                                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                                    style={{ ...styles.coverImage, position: "absolute", inset: 0 }}
                                  />
                                )}
                                                                <CoverPlayButton
                                  isActive={album.id === currentAlbumId}
                                  isPlaying={isPlaying}
                                  onTogglePlay={() => handleQuickPlay(album.id)}
                                />
                                {album.id === currentAlbumId && (
                                  <div style={styles.playingBadge}>▶ 正在播放</div>
                                )}
                                {isAlbumAllMissing(album) && <div style={styles.albumCoverMissingOverlay} />}
                                                            </div>
                              <div style={styles.albumTitleRow}>
                                <p style={styles.albumTitle}>{album.title}</p>
                                <button
                                  className="album-menu-btn"
                                  style={styles.albumMenuBtnInline}
                                  onClick={(e) => handleOpenAlbumMenu(e, album)}
                                  title="更多操作"
                                >
                                  <span style={styles.albumMenuDotsInline}>···</span>
                                </button>
                              </div>
                              <p style={styles.albumArtist}>{album.artist}</p>
                            </div>
                          );
                        })}
                      </div>
                      <div ref={sentinelRef} style={{ height: 1 }} />
                      </>
                    )}
                  )()}
                    {/* 专辑操作菜单 */}
                    {albumMenu && (
                      <>
                        <div style={styles.contextOverlay} onClick={handleCloseAlbumMenu} />
                        <div
                          style={{
                            ...styles.contextMenu,
                            left: albumMenu.x,
                            top: albumMenu.y,
                          }}
                        >
                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handleAlbumMenuAction("artist", albumMenu.album)}>
                            <FaUser size={14} style={{ marginRight: "10px" }} />
                            <span>转至艺人</span>
                          </div>
                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handleAlbumMenuAction("toggleFavorite", albumMenu.album)}>
                            <FaHeart size={14} style={{ marginRight: "10px", color: favoriteAlbums.has(albumMenu.album.id) ? "#e94560" : undefined }} />
                            <span>{favoriteAlbums.has(albumMenu.album.id) ? "取消喜欢" : "喜欢"}</span>
                          </div>
                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => {
                            handleCloseAlbumMenu();
                            setPanelTarget({ type: "album", data: albumMenu.album });
                            setPanelSearch("");
                          }}>
                            <FaPlus size={14} style={{ marginRight: "10px" }} />
                            <span>添加到播放列表</span>
                          </div>
                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handleAlbumMenuAction("playNext", albumMenu.album)}>
                            <FaStepForward size={14} style={{ marginRight: "10px" }} />
                            <span>插播</span>
                          </div>
                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handleAlbumMenuAction("playLater", albumMenu.album)}>
                            <FaClock size={14} style={{ marginRight: "10px" }} />
                            <span>稍后播放</span>
                          </div>
                          <div style={styles.contextMenuDivider} />
                          <div className="context-menu-item" style={{ ...styles.contextMenuItem, color: "#e94560" }} onClick={() => handleAlbumMenuAction("delete", albumMenu.album)}>
                            <FaTrash size={14} style={{ marginRight: "10px" }} />
                            <span>删除</span>
                          </div>
                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => { handleCloseAlbumMenu(); handleOpenMusicEdit({ type: "album", data: albumMenu.album }); }}>
                            <FaInfoCircle size={14} style={{ marginRight: "10px" }} />
                            <span>更多信息</span>
                          </div>
                        </div>
                      </>
                    )}
                  </main>
                                ) : activeNav === "artists" && !detailArtistName ? (
                  /* ================================================================ */
                  /* 艺人视图（列表页）                                               */
                  /* ================================================================ */
                                    <main style={styles.mainArea}>
                    <div style={styles.sortBar}>
                      <select
                        style={styles.sortSelect}
                        value={artistSortMode}
                        onChange={(e) => setArtistSortMode(e.target.value)}
                      >
                        <option value="a-z">A-Z</option>
                        <option value="z-a">Z-A</option>
                      </select>
                    </div>
                    {albums.length === 0 ? (
                      <div style={styles.emptyState}>
                        <span style={styles.emptyIcon}>🎤</span>
                        <p style={styles.emptyText}>还没有导入任何音乐</p>
                      </div>
                    ) : (
                      <div style={styles.artistGrid}>
{(() => {
                          // 艺人列表 = 存储的记录 ∪ 专辑派生艺人（保留无音乐的艺人）
                          // 自动整理合作艺人开启时：拆分合作艺人为独立艺人；关闭时：完整字符串作为一个艺人
                          const autoOrganize = localStorage.getItem("edit-auto-organize-collab") !== "false";
                          const uniqueArtists = autoOrganize
                            ? collectAllArtists(albums, artistRecords)
                            : Array.from(new Set([...albums.map((a) => a.artist), ...Object.keys(artistRecords)]));
                          const belongs = (artist) => autoOrganize
                            ? albums.some((a) => albumBelongsToArtist(a, artist))
                            : albums.some((a) => a.artist === artist);
                          return uniqueArtists
                            .filter((artist) => !hideEmptyArtists || belongs(artist))
                            .sort((a, b) => {
                              if (artistSortMode === "z-a") {
                                return b.localeCompare(a, "zh-CN");
                              }
                              return a.localeCompare(b, "zh-CN");
                            }).map((artist) => {
                            const artistAlbums = autoOrganize
                              ? albums.filter((a) => albumBelongsToArtist(a, artist))
                              : albums.filter((a) => a.artist === artist);
                            const primaryAlbums = artistAlbums.filter((a) => isPrimaryAlbum(a, artist));
                            // 头像：优先艺人照片，其次取该艺人专辑中一张有封面的封面作头像
                            const record = artistRecords[artist] || {};
                            const artistCover = record.cover_url
                              ? getAssetUrl(record.cover_url)
                              : (artistAlbums.find((a) => a.coverURL)?.coverURL || null);
                            const countText = autoOrganize
                              ? (primaryAlbums.length > 0 ? `${primaryAlbums.length} 个专辑` : "")
                              : `${artistAlbums.length} 个专辑`;
                            return (
                              <div key={artist} style={styles.artistCard} onClick={() => handleOpenArtistDetail(artist)}>
                                <div style={styles.artistAvatar}>
                                  <span style={styles.artistAvatarIcon}>👤</span>
                                  {artistCover && (
                                    <img
                                      src={artistCover}
                                      alt=""
                                      onError={(e) => { e.currentTarget.style.display = "none"; }}
                                      style={styles.artistAvatarImg}
                                    />
                                  )}
                                </div>
                                <p style={styles.artistName}>{artist}</p>
                                <p style={styles.artistAlbumCount}>{countText}</p>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    )}
                                    </main>
                ) : activeNav === "artists" && detailArtistName ? (
                  /* ----- 艺人详情页（从艺人卡片点进去） ----- */
                  <div style={styles.detailPageArea}>
<ArtistsDetail
        artist={detailArtistName}
        albums={localStorage.getItem("edit-auto-organize-collab") !== "false"
          ? albums.filter((a) => albumBelongsToArtist(a, detailArtistName))
          : albums.filter((a) => a.artist === detailArtistName)}
        record={artistRecords[detailArtistName] || {}}
                      currentAlbumId={currentAlbumId}
                      currentSongIndex={currentSongIndex}
                      isPlaying={isPlaying}
                      onPlayAlbum={handlePlayAlbumFromArtist}
                      onPlaySong={handlePlaySongFromArtist}
                      onBack={handleCloseArtistDetail}
                      onOpenAlbum={handleOpenAlbumFromArtist}
                      onEditArtist={handleOpenArtistEdit}
                    />
                  </div>
                                ) : activeNav === "songs" ? (
                                  /* ================================================================ */
                                  /* 歌曲视图（平坦列表，显示所有专辑的所有歌曲）                   */
                                  /* ================================================================ */
                                                                                                                                        <main style={styles.mainArea} ref={mainAreaRef} className={isSelecting ? "multi-select-active" : ""}>
                                    {isSelecting ? (
                                      /* ----- 多选模式：固定在页面顶部，不随滚动移动 ----- */
                                      <div style={styles.multiSelectBarSticky}>
                                        <div style={styles.multiSelectLeft}>
                                          <span style={styles.multiSelectInfo}>
                                            已选择 {selectedSongs.size} 个
                                          </span>
                                          <button
                                            style={styles.actionBtn}
                                            onClick={handleAddToPlaylist}
                                          >
                                            添加到播放列表
                                          </button>
                                          <button
                                            style={styles.actionBtn}
                                            onClick={handlePlayNext}
                                          >
                                            下一个播放
                                          </button>
                                          <button
                                            style={styles.actionBtn}
                                            onClick={handleAddToQueue}
                                          >
                                            添加到播单
                                          </button>
                                        </div>
                                        <div style={styles.multiSelectRight}>
                                          <button
                                            style={styles.deleteBtn}
                                            onClick={handleRequestDelete}
                                          >
                                            删除
                                          </button>
                                          <button
                                            style={styles.cancelSelectBtn}
                                            onClick={handleCancelSelect}
                                          >
                                            取消
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      /* ----- 正常模式：分类按钮 ----- */
                                      <div style={styles.sortBar}>
                                        {["recent_add", "favorite", "album", "time", "matched", "unmatched"].map((tag) => {
                                          const label =
                                            tag === "recent_add" ? "最近添加"
                                              : tag === "favorite" ? "已喜爱"
                                                : tag === "album" ? "专辑"
                                                  : tag === "time" ? "时间"
                                                    : tag === "matched" ? "已匹配"
                                                      : "未匹配";
                                          const isActive = songFilters.has(tag);
                                          const isTime = tag === "time";
                                          return (
                                            <button
                                              key={tag}
                                              style={{
                                                ...styles.sortBtn,
                                                ...(isActive ? styles.sortBtnActive : {}),
                                              }}
                                              onClick={() => {
                                                setSongVisibleCount(30);
                                                setIsLoadingMoreSongs(false);
                                                songLoadPendingRef.current = false;
                                                if (isTime) {
                                                  if (isActive) {
                                                    setSongTimeDir((d) => (d === "desc" ? "asc" : "desc"));
                                                  } else {
                                                    setSongFilters((prev) => new Set([...prev, tag]));
                                                  }
                                                } else {
                                                  setSongFilters((prev) => {
                                                    const next = new Set(prev);
                                                    if (next.has(tag)) {
                                                      next.delete(tag);
                                                    } else {
                                                      if (tag === "matched") next.delete("unmatched");
                                                      if (tag === "unmatched") next.delete("matched");
                                                      next.add(tag);
                                                    }
                                                    if (next.size === 0) next.add("recent_add");
                                                    return next;
                                                  });
                                                }
                                              }}
                                            >
                                              {isTime && isActive ? (songTimeDir === "desc" ? "从新到旧" : "从旧到新") : label}
                                            </button>
                                          );
                                        })}
                                        {songFilters.size > 1 && (
                                          <button
                                            style={styles.cancelFilterBtn}
                                            onClick={() => {
                                              setSongVisibleCount(30);
                                              setIsLoadingMoreSongs(false);
                                              songLoadPendingRef.current = false;
                                              setSongFilters(new Set(["recent_add"]));
                                            }}
                                          >
                                            取消
                                          </button>
                                        )}
                                      </div>
                                    )}
                    {(() => {
                      const allSongs = albums.flatMap((album) =>
                        album.songs.map((song) => ({ ...song, albumTitle: album.title, albumId: album.id, albumYear: album.year }))
                      );
                      if (allSongs.length === 0) {
                        return (
                          <div style={styles.emptyState}>
                            <span style={styles.emptyIcon}>🎵</span>
                            <p style={styles.emptyText}>还没有导入任何歌曲</p>
                          </div>
                        );
                      }
                      // 多选过滤 + 排序（优先级：时间 > 专辑 > 最近添加）
                      let filteredSongs = [...allSongs];
                      if (songFilters.has("favorite")) {
                        const likedUrls = new Set((playlists.find((p) => p.id === "liked")?.songs || []).map((s) => s.url));
                        filteredSongs = filteredSongs.filter((s) => likedUrls.has(s.url));
                      }
                      if (songFilters.has("matched")) {
                        filteredSongs = filteredSongs.filter((s) => s.matched);
                      }
                      if (songFilters.has("unmatched")) {
                        filteredSongs = filteredSongs.filter((s) => !s.matched);
                      }
                      const sortedSongs = [...filteredSongs].sort((a, b) => {
                        if (songFilters.has("time")) {
                          const yearA = a.albumYear || (songTimeDir === "desc" ? 0 : 9999);
                          const yearB = b.albumYear || (songTimeDir === "desc" ? 0 : 9999);
                          const diff = songTimeDir === "desc" ? yearB - yearA : yearA - yearB;
                          if (diff !== 0) return diff;
                        }
                        if (songFilters.has("album")) {
                          const cmp = (a.albumTitle || "").localeCompare(b.albumTitle || "", "zh-CN");
                          if (cmp !== 0) return cmp;
                        }
                        return b.id?.localeCompare?.(a.id || "") || 0;
                      });
                                            return (
                        <>
                        <div style={styles.songTable}>
                          {/* 表头 */}
                                                    <div style={styles.songTableHeader}>
                            <div style={styles.songColCheck}></div>
                            <div style={styles.songColTitle}>名称</div>
                            <div style={styles.songColArtist}>艺人</div>
                            <div style={styles.songColYear}>年份</div>
                            <div style={styles.songColAlbum}>专辑名</div>
                            <div style={styles.songColDuration}>时长</div>
                            <div style={styles.songColMenu}></div>
                          </div>
                                                    {/* 歌曲行 */}
                           {sortedSongs.slice(0, songVisibleCount).map((song, idx) => {
                            const isActive = !!currentSong && (
                              (song.file_path && currentSong.file_path === song.file_path)
                              || (!song.file_path && song.url && currentSong.url === song.url)
                            );
                            const albumLocalIdx = albums.find((a) => a.id === song.albumId)?.songs.findIndex((s) => s.url === song.url) ?? idx;
                            const songKey = `${song.albumId}-${albumLocalIdx}`;
                            const isChecked = selectedSongs.has(songKey);
                            const isMissing = song.file_path && missingSongs.has(song.file_path);
                            return (
                                                            <div
                                key={`${song.albumId}-${idx}`}
                                className={`song-table-row${isActive ? " song-row-active" : ""}${isChecked ? " is-checked" : ""}${isMissing ? " song-row-missing" : ""}`}
                                style={{
                                  ...styles.songTableRow,
                                  ...(isActive ? styles.songTableRowActive : {}),
                                  ...(isChecked ? styles.songTableRowChecked : {}),
                                }}
                                                                onClick={(e) => {
                                                                    if (isSelecting) {
                                                                      // 多选模式下，点击行切换复选框
                                                                      handleCheckboxChange(songKey, e);
                                                                    } else if (isMissing) {
                                                                      setMissingDialogSong(song);
                                                                    } else if (!songPlayable(song)) {
                                                                      setUnplayableDialogSong(song);
                                                                    } else {
                                                                      // 歌曲视图：只播放当前这一首，不自动切歌
                                                                      setCurrentAlbumId(null);
                                                                      setCurrentPlaylistId(null);
                                                                      setPlayQueue([song]);
                                                                      setCurrentSongIndex(0);
                                                                      setIsPlaying(true);
                                                                    }
                                }}
                              >
                                                                <div style={styles.songColCheck}>
                                  {isActive && isPlaying && !isSelecting ? (
                                    <PlayingAnimation />
                                  ) : (
                                    <input
                                      type="checkbox"
                                      className="song-checkbox"
                                      style={styles.songCheckbox}
                                      checked={isChecked}
                                      onChange={(e) => handleCheckboxChange(songKey, e)}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  )}
                                </div>
                                                                <div style={styles.songColTitle}>
                                                                  <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                                                                    {!songPlayable(song) && (
                                                                      <FaExclamationCircle size={13} title="该格式无法播放" style={{ color: "#f59e0b", flexShrink: 0 }} />
                                                                    )}
                                                                    <div style={styles.songCoverThumb}>
                                                                      {(() => {
                                                                        const album = albums.find((a) => a.id === song.albumId);
                                                                        return (
                                                                          <>
                                                                            <span style={styles.songCoverThumbPlaceholder}>🎶</span>
                                                                            {album?.coverURL && (
                                                                              <img
                                                                                src={album.coverURL}
                                                                                alt=""
                                                                                onError={(e) => { e.currentTarget.style.display = "none"; }}
                                                                                style={{ ...styles.songCoverThumbImg, position: "absolute", inset: 0 }}
                                                                              />
                                                                            )}
                                                                          </>
                                                                        );
                                                                      })()}
                                                                    </div>
                                                                     <span style={{
                                                                       ...styles.songCellTitle,
                                                                       ...(isActive ? styles.songCellTitleActive : {}),
                                                                       ...(isMissing ? styles.songCellTextMissing : {}),
                                                                       minWidth: 0,
                                                                     }}>
                                                                       {song.title}
                                                                     </span>
                                                                  </div>
                                                                </div>
                                <div style={styles.songColArtist}>
                                  <span
                                    style={{
                                      ...styles.songCellText,
                                      ...styles.clickableCellText,
                                      ...(isMissing ? styles.songCellTextMissing : {}),
                                    }}
                                    onClick={(e) => { e.stopPropagation(); handleOpenArtistDetail(song.artist || "未知艺术家"); }}
                                  >
                                    {song.artist || "未知"}
                                  </span>
                                </div>
                                <div style={styles.songColYear}>
                                  <span style={styles.songCellText}>{song.albumYear ? `${song.albumYear}年` : "—"}</span>
                                </div>
                                                                <div style={styles.songColAlbum}>
                                  <span
                                    style={{ ...styles.songCellText, ...styles.clickableCellText }}
                                    onClick={(e) => { e.stopPropagation(); handleOpenAlbumDetail(song.albumId); }}
                                  >
                                    {song.albumTitle}
                                  </span>
                                </div>
                                <div style={styles.songColDuration}>
                                  <span style={styles.songCellText}>{formatDuration(song.duration)}</span>
                                </div>
                                                                <div style={styles.songColMenu}>
                                  <button
                                    style={styles.songMenuBtn}
                                    className="song-menu-btn"
                                    onClick={(e) => handleOpenContextMenu(e, song)}
                                    title="更多操作"
                                  >
                                    <FaEllipsisH size={14} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        {sortedSongs.length > songVisibleCount && (
                          <div ref={songSentinelRef} className="song-lazy-sentinel" aria-live="polite">
                            {isLoadingMoreSongs ? "正在加载…" : ""}
                          </div>
                        )}
                        </>);
                    })()}

                    {/* 单曲操作菜单 */}
                    {contextMenu && (
                      <>
                        <div style={styles.contextOverlay} onClick={handleCloseContextMenu} />
                        <div
                          style={{
                            ...styles.contextMenu,
                            left: contextMenu.x,
                            top: contextMenu.y,
                          }}
                        >
                                                    <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handleContextMenuAction("album", contextMenu.song)}>
                            <FaCompactDisc size={14} style={{ marginRight: "10px", flexShrink: 0 }} />
                            <span>专辑</span>
                          </div>
                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handleContextMenuAction("artist", contextMenu.song)}>
                            <FaUser size={14} style={{ marginRight: "10px", flexShrink: 0 }} />
                            <span>艺人</span>
                          </div>
                          <div style={styles.contextMenuDivider} />
                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handleContextMenuAction("addToPlaylist", contextMenu.song)}>
                            <FaHeart size={14} style={{ marginRight: "10px", flexShrink: 0 }} />
                            <span>喜欢</span>
                          </div>
                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => {
                            handleCloseContextMenu();
                            setPanelTarget({ type: "song", data: contextMenu.song });
                            setPanelSearch("");
                          }}>
                            <FaPlus size={14} style={{ marginRight: "10px", flexShrink: 0 }} />
                            <span>添加到播放列表</span>
                          </div>
                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handleContextMenuAction("playNext", contextMenu.song)}>
                            <FaStepForward size={14} style={{ marginRight: "10px", flexShrink: 0 }} />
                            <span>插播</span>
                          </div>
                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handleContextMenuAction("playLater", contextMenu.song)}>
                            <FaClock size={14} style={{ marginRight: "10px", flexShrink: 0 }} />
                            <span>稍后播放</span>
                          </div>
                          <div style={styles.contextMenuDivider} />
                          <div className="context-menu-item" style={{ ...styles.contextMenuItem, color: "#e94560" }} onClick={() => handleContextMenuAction("deleteSong", contextMenu.song)}>
                            <FaTrash size={14} style={{ marginRight: "10px", flexShrink: 0 }} />
                            <span>删除</span>
                          </div>
                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => { handleCloseContextMenu(); handleOpenMusicEdit({ type: "song", data: { ...contextMenu.song, albumId: contextMenu.song.albumId } }); }}>
                            <FaInfoCircle size={14} style={{ marginRight: "10px", flexShrink: 0 }} />
                            <span>更多信息</span>
                          </div>
                        </div>
                      </>
                    )}

                    {/* 删除确认浮窗（多选） */}
                    {showDeleteConfirm && (
                      <div style={styles.overlay} onClick={handleCancelSelect}>
                        <div style={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
                          <h3 style={styles.confirmTitle}>确认删除</h3>
                          <div style={styles.confirmDivider} />
                          <p style={styles.confirmText}>
                            确定要删除选中的 {selectedSongs.size} 首歌曲吗？此操作不可撤销。
                          </p>
                          <div style={styles.confirmActions}>
                            <button style={styles.confirmDeleteBtn} onClick={handleConfirmDelete}>
                              确认删除
                            </button>
                             <button style={styles.confirmCancelBtn} onClick={handleCancelSelect}>
                               取消
                             </button>
                           </div>
                         </div>
                       </div>
                     )}
                  </main>
                                ) : activeNav === "playlists" ? (
                                  /* ================================================================ */
                                  /* 全部播放列表视图                                                */
                                  /* ================================================================ */
                                  <main style={styles.mainArea}>
                                    <div style={styles.playlistHeader}>
                                      <h2 style={styles.playlistHeaderTitle}>全部播放列表</h2>
                                    </div>
                                    <div style={styles.sortBar}>
                                      {[
                                        { id: "recent_create", label: "最近创建" },
                                        { id: "create_time", label: "创建时间" },
                                        { id: "a-z", label: "A-Z" },
                                      ].map((opt) => (
                                        <button
                                          key={opt.id}
                                          style={{
                                            ...styles.sortBtn,
                                            ...(playlistSortMode === opt.id ? styles.sortBtnActive : {}),
                                          }}
                                          onClick={() => {
                                            if (opt.id === "create_time") {
                                              if (playlistSortMode === "create_time") {
                                                setPlaylistTimeDir((d) => (d === "desc" ? "asc" : "desc"));
                                              } else {
                                                setPlaylistSortMode("create_time");
                                              }
                                            } else {
                                              setPlaylistSortMode(opt.id);
                                            }
                                          }}
                                        >
                                          {opt.label}
                                        </button>
                                      ))}
                                    </div>
                                    {sortedPlaylists.length === 0 ? (
                                      <div style={styles.emptyState}>
                                        <span style={styles.emptyIcon}>📋</span>
                                        <p style={styles.emptyText}>还没有任何播放列表</p>
                                      </div>
                                    ) : (
                                      <div style={styles.libraryGrid}>
                                        {sortedPlaylists.map((pl) => (
                                          <PlaylistCard
                                            key={pl.id}
                                            pl={pl}
                                            onOpen={handleOpenPlaylistDetail}
                                            onMenu={handleOpenPlaylistMenu}
                                          />
                                        ))}
                                      </div>
                                    )}
                                  </main>
                                ) : (
                                  /* ================================================================ */
                                  /* 资料库视图（默认）— 可排序的专辑卡片 + 播放列表卡片混合排列    */
                                  /* ================================================================ */
                                  <main style={styles.mainArea} ref={mainAreaRef}>
                                    <div style={styles.sortBar}>
                                      {/* 下拉选框：最近添加 / 最近播放 */}
                                      <select
                                        style={styles.sortSelect}
                                        value={librarySortMode === "recent_add" || librarySortMode === "recent_play" ? librarySortMode : "recent_add"}
                                        onChange={(e) => setLibrarySortMode(e.target.value)}
                                      >
                                        <option value="recent_add">最近添加</option>
                                        <option value="recent_play">最近播放</option>
                                      </select>
                                      {/* 按钮：时间 / 专辑 / 播放列表 */}
                                      <button
                                        style={{
                                          ...styles.sortBtn,
                                          ...(librarySortMode === "time" ? styles.sortBtnActive : {}),
                                        }}
                                        onClick={() => setLibrarySortMode("time")}
                                      >
                                        时间
                                      </button>
                                      <button
                                        style={{
                                          ...styles.sortBtn,
                                          ...(librarySortMode === "album" ? styles.sortBtnActive : {}),
                                        }}
                                        onClick={() => setLibrarySortMode("album")}
                                      >
                                        专辑
                                      </button>
                                    </div>

                                    {libraryItems.length === 0 ? (
                                      <div style={styles.emptyState}>
                                        <span style={styles.emptyIcon}>📀</span>
                                        <p style={styles.emptyText}>还没有导入任何专辑</p>
                                        <p style={styles.emptyHint}>点击右上角「导入音乐」按钮添加你的音乐文件</p>
                                      </div>
                                    ) : (
                                      <>
                                      <div style={styles.libraryGrid}>
                                        {/* 专辑卡片 */}
                                        {librarySortedAlbums.slice(0, visibleCount).map((album) => {
                                          const isActive = album.id === currentAlbumId;
                                          return (
                                            <div
                                              key={album.id}
                                              className="album-card"
                                              style={{
                                                ...styles.libraryCard,
                                                order: libraryItemOrder.get(`album:${album.id}`),
                                                ...(isActive ? styles.albumCardActive : {}),
                                              }}
                                              onClick={() => handleOpenAlbumDetail(album.id)}
                                            >
                                              <div style={styles.coverWrapper}>
                                                <div style={styles.coverPlaceholder}>
                                                  <span style={styles.coverPlaceholderIcon}>🎶</span>
                                                </div>
                                                {album.coverURL && (
                                                  <img
                                                    src={album.coverURL}
                                                    alt={album.title}
                                                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                                                    style={{ ...styles.coverImage, position: "absolute", inset: 0 }}
                                                  />
                                                )}
                                                <CoverPlayButton
                                                  isActive={album.id === currentAlbumId}
                                                  isPlaying={isPlaying}
                                                  onTogglePlay={() => handleQuickPlay(album.id)}
                                                />
                                                {album.id === currentAlbumId && (
                                                  <div style={styles.playingBadge}>▶ 正在播放</div>
                                                )}
                                                {isAlbumAllMissing(album) && <div style={styles.albumCoverMissingOverlay} />}
                                              </div>
                                              <div style={styles.albumTitleRow}>
                                                <p style={styles.albumTitle}>{album.title}</p>
                                                <button
                                                  className="album-menu-btn"
                                                  style={styles.albumMenuBtnInline}
                                                  onClick={(e) => handleOpenAlbumMenu(e, album)}
                                                  title="更多操作"
                                                >
                                                  <span style={styles.albumMenuDotsInline}>···</span>
                                                </button>
                                              </div>
                                              <p style={styles.albumArtist}>{album.artist}</p>
                                            </div>
                                          );
                                        })}
                                                                 {/* 播放列表卡片 */}
                                                                {librarySortMode !== "album" && playlists.map((pl) => (
                                          <PlaylistCard
                                            key={pl.id}
                                            pl={pl}
                                            order={libraryItemOrder.get(`playlist:${pl.id}`)}
                                            onOpen={handleOpenPlaylistDetail}
                                            onMenu={handleOpenPlaylistMenu}
                                          />
                                          ))}
                                        </div>
                                       <div ref={sentinelRef} style={{ height: 1 }} />
                                       </>
                                     )}

                                     {/* 专辑操作菜单 */}
                                    {albumMenu && (
                                      <>
                                        <div style={styles.contextOverlay} onClick={handleCloseAlbumMenu} />
                                        <div
                                          style={{
                                            ...styles.contextMenu,
                                            left: albumMenu.x,
                                            top: albumMenu.y,
                                          }}
                                        >
                                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handleAlbumMenuAction("artist", albumMenu.album)}>
                                            <FaUser size={14} style={{ marginRight: "10px" }} />
                                            <span>转至艺人</span>
                                          </div>
                                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handleAlbumMenuAction("toggleFavorite", albumMenu.album)}>
                                            <FaHeart size={14} style={{ marginRight: "10px", color: favoriteAlbums.has(albumMenu.album.id) ? "#e94560" : undefined }} />
                                            <span>{favoriteAlbums.has(albumMenu.album.id) ? "取消喜欢" : "喜欢"}</span>
                                          </div>
                                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => {
                                            handleCloseAlbumMenu();
                                            setPanelTarget({ type: "album", data: albumMenu.album });
                                            setPanelSearch("");
                                          }}>
                                            <FaPlus size={14} style={{ marginRight: "10px" }} />
                                            <span>添加到播放列表</span>
                                          </div>
                                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handleAlbumMenuAction("playNext", albumMenu.album)}>
                                            <FaStepForward size={14} style={{ marginRight: "10px" }} />
                                            <span>插播</span>
                                          </div>
                                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handleAlbumMenuAction("playLater", albumMenu.album)}>
                                            <FaClock size={14} style={{ marginRight: "10px" }} />
                                            <span>稍后播放</span>
                                          </div>
                                          <div style={styles.contextMenuDivider} />
                                          <div className="context-menu-item" style={{ ...styles.contextMenuItem, color: "#e94560" }} onClick={() => handleAlbumMenuAction("delete", albumMenu.album)}>
                                            <FaTrash size={14} style={{ marginRight: "10px" }} />
                                            <span>删除</span>
                                          </div>
                                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => { handleCloseAlbumMenu(); handleOpenMusicEdit({ type: "album", data: albumMenu.album }); }}>
                                            <FaInfoCircle size={14} style={{ marginRight: "10px" }} />
                                            <span>更多信息</span>
                                          </div>
                                        </div>
                                      </>
                                    )}


                  </main>
                )}
              </div>
            </div>

      {/* ===== 播放列表操作菜单（全局渲染，任意视图可用） ===== */}
      {playlistMenu && (
        <>
          <div style={styles.contextOverlay} onClick={handleClosePlaylistMenu} />
          <div
            style={{
              ...styles.contextMenu,
              left: playlistMenu.x,
              top: playlistMenu.y,
            }}
          >
            <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handlePlaylistMenuAction("play", playlistMenu.playlist)}>
              <FaPlay size={14} style={{ marginRight: "10px" }} />
              <span>播放</span>
            </div>
            {playlistMenu.playlist.id !== "liked" && playlistMenu.playlist.id !== "recent" && (
              <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handlePlaylistMenuAction("pin", playlistMenu.playlist)}>
                <FaArrowUp size={14} style={{ marginRight: "10px" }} />
                <span>{playlistMenu.playlist.pinned ? "取消置顶" : "置顶"}</span>
              </div>
            )}
            <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handlePlaylistMenuAction("playNext", playlistMenu.playlist)}>
              <FaStepForward size={14} style={{ marginRight: "10px" }} />
              <span>插播</span>
            </div>
            <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handlePlaylistMenuAction("playLater", playlistMenu.playlist)}>
              <FaClock size={14} style={{ marginRight: "10px" }} />
              <span>稍后播放</span>
            </div>
            <div style={styles.contextMenuDivider} />
            {playlistMenu.playlist.id !== "liked" && playlistMenu.playlist.id !== "recent" && (
              <>
                <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handlePlaylistMenuAction("edit", playlistMenu.playlist)}>
                  <FaInfoCircle size={14} style={{ marginRight: "10px" }} />
                  <span>编辑信息</span>
                </div>
                <div className="context-menu-item" style={{ ...styles.contextMenuItem, color: "#e94560" }} onClick={() => handlePlaylistMenuAction("delete", playlistMenu.playlist)}>
                  <FaTrash size={14} style={{ marginRight: "10px" }} />
                  <span>删除</span>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ===== 播放列表删除确认浮窗（全局渲染） ===== */}
      {deletePlaylistConfirm && (
        <div style={styles.overlay} onClick={handleCancelDeletePlaylist}>
          <div style={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.confirmTitle}>确认删除</h3>
            <div style={styles.confirmDivider} />
            <p style={styles.confirmText}>
              确定要删除播放列表「{playlists.find(p => p.id === deletePlaylistConfirm)?.name}」吗？此操作不可撤销。
            </p>
            <div style={styles.confirmActions}>
              <button style={styles.confirmDeleteBtn} onClick={handleConfirmDeletePlaylist}>
                确认删除
              </button>
              <button style={styles.confirmCancelBtn} onClick={handleCancelDeletePlaylist}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 数据导入/导出取消确认 ===== */}
      {dataCancelConfirm && (
        <div style={{ ...styles.overlay, zIndex: 1500 }} onClick={() => setDataCancelConfirm(null)}>
          <div style={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.confirmTitle}>确认取消</h3>
            <div style={styles.confirmDivider} />
            <p style={styles.confirmText}>
              确定要取消{dataCancelConfirm.kind === "export" ? "导出" : "导入"}数据吗？
              {dataCancelConfirm.kind === "import" ? " 合并导入中已经完成的内容将会保留。" : ""}
            </p>
            <div style={styles.confirmActions}>
              <button style={styles.confirmDeleteBtn} onClick={handleConfirmCancelDataJob}>确认取消</button>
              <button style={styles.confirmCancelBtn} onClick={() => setDataCancelConfirm(null)}>继续执行</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 新建 / 编辑播放列表对话框 ===== */}
      {showCreatePlaylist && (
        <div style={styles.overlay} onClick={handleCloseCreatePlaylist}>
          <div style={{ ...styles.confirmDialog, ...styles.playlistDialog }} className="create-dialog" onClick={(e) => { e.stopPropagation(); setShowCoverMenu(false); }}>
            <div style={styles.playlistDialogHeader}><h3 style={styles.createDialogTitle}>{editingPlaylistId ? "编辑播放列表" : "新建播放列表"}</h3><button style={styles.playlistDialogClose} onClick={handleCloseCreatePlaylist} title="关闭"><FaTimes /></button></div>
            <div style={styles.playlistDialogBody}>
              <div style={styles.createCoverSection}>
                {newPlaylistCover ? <div style={styles.coverMenuWrap}><img src={newPlaylistCover} alt="封面" style={styles.createCover} /><button type="button" style={styles.coverMenuButton} title="封面操作" onClick={(e) => { e.stopPropagation(); setShowCoverMenu((value) => !value); }}><FaEllipsisH /></button>{showCoverMenu && <div style={styles.coverMenu} onClick={(e) => e.stopPropagation()}><button type="button" style={styles.coverMenuItem} onClick={() => { setShowCoverMenu(false); coverInputRef.current?.click(); }}>更换封面</button><button type="button" style={{ ...styles.coverMenuItem, color: "#ef233c" }} onClick={() => { setNewPlaylistCover(null); setNewPlaylistCoverRemoved(true); setShowCoverMenu(false); }}>移除封面</button></div>}</div> : <button type="button" style={styles.createCoverPlaceholder} onClick={() => coverInputRef.current?.click()}><FiPlus size={54} /><span style={styles.createCoverHint}>添加</span></button>}
              </div>
              <div style={styles.playlistFields}>
                <label style={styles.playlistFieldLabel}>播放列表名称</label><input style={{ ...styles.createInput, marginBottom: "22px" }} placeholder="请输入播放列表名称" value={newPlaylistName} onChange={(e) => setNewPlaylistName(e.target.value)} autoFocus />
                <label style={styles.playlistFieldLabel}>播放列表简介</label>
                <div style={styles.playlistDescriptionWrap}><textarea style={{ ...styles.createTextarea, minHeight: "360px", resize: "none" }} placeholder="简介（可选）" value={newPlaylistDesc} onChange={(e) => setNewPlaylistDesc(e.target.value)} />{smartAvailable && editingPlaylistId && <button type="button" style={styles.playlistAiButton} onClick={generatePlaylistDescription} title="AI 生成简介"><FaStar /></button>}</div>
                {playlistSuggestion?.playlistId === editingPlaylistId && <div style={styles.playlistSuggestion}><p>AI 建议</p><div>{playlistSuggestion.description}</div><div style={styles.suggestionActions}><button type="button" style={styles.confirmCancelBtn} onClick={() => setPlaylistSuggestion(null)}>不采用</button><button type="button" style={styles.confirmDeleteBtn} onClick={() => { setNewPlaylistDesc(playlistSuggestion.description); setPlaylistSuggestion(null); }}>采用建议</button></div></div>}
                <label style={styles.createToggleRow}><span style={styles.createToggleText}>封面样式</span><button type="button" aria-label="切换封面样式" style={{ ...styles.createToggleSwitch, ...(newPlaylistCoverStyle ? styles.createToggleSwitchOn : {}) }} onClick={() => setNewPlaylistCoverStyle((v) => !v)}><div style={{ ...styles.createToggleKnob, ...(newPlaylistCoverStyle ? styles.createToggleKnobOn : {}) }} /></button></label>
              </div>
            </div>
            <div style={styles.playlistDialogActions}><button style={styles.confirmCancelBtn} onClick={handleCloseCreatePlaylist}>取消</button><button style={{ ...styles.confirmDeleteBtn, ...(!newPlaylistName.trim() ? styles.confirmBtnDisabled : {}) }} onClick={handlePlaylistFormSubmit} disabled={!newPlaylistName.trim()}>保存</button></div>
          </div>
        </div>
      )}

      {showSmartPlaylist && (
        <div style={styles.overlay} onClick={() => setShowSmartPlaylist(false)}>
          <div style={{ ...styles.createDialog, ...styles.confirmDialog }} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.createDialogTitle}>智能歌单</h3>
            <input style={styles.createInput} placeholder="播放列表名称" value={smartPlaylistName} onChange={(e) => setSmartPlaylistName(e.target.value)} autoFocus />
            <textarea style={styles.createTextarea} placeholder="描述词，例如：适合深夜放松的电子音乐" value={smartPlaylistPrompt} onChange={(e) => setSmartPlaylistPrompt(e.target.value)} rows={4} />
            <p style={{ margin: "0", color: "#6b7280", fontSize: "12px" }}>将向默认智能供应商发送最多 2,000 首本地曲目的文字元信息，不会发送音频或图片。</p>
            <div style={styles.createActions}><button style={styles.confirmDeleteBtn} onClick={startSmartPlaylist}>生成歌单</button><button style={styles.confirmCancelBtn} onClick={() => setShowSmartPlaylist(false)}>取消</button></div>
          </div>
        </div>
      )}

      {/* ===== 添加到播放列表浮窗 ===== */}
      {panelTarget && (
        <div style={styles.overlay} onClick={() => setPanelTarget(null)}>
          <div style={styles.playlistPanel} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.panelTitle}>添加到播放列表</h3>
            <input
              style={styles.panelSearch}
              placeholder="搜索播放列表…"
              value={panelSearch}
              onChange={(e) => setPanelSearch(e.target.value)}
              autoFocus
            />
            <div style={styles.panelList}>
              {(() => {
                const items = panelTarget.type === "album"
                  ? (panelTarget.data.songs || []).map((s) => ({ ...s, albumId: panelTarget.data.id }))
                  : [panelTarget.data];
                const userPls = playlists.filter((p) => p.id !== "recent");
                const searched = panelSearch
                  ? userPls.filter((p) => p.name.toLowerCase().includes(panelSearch.toLowerCase()))
                  : userPls;
                const sorted = [...searched].sort((a, b) => b.id.localeCompare(a.id));
                return sorted.map((pl) => {
                  const existingUrls = new Set(pl.songs.map((s) => s.url));
                  const newItems = items.filter((s) => !existingUrls.has(s.url));
                  const allExist = newItems.length === 0;
                  return (
                    <button
                      key={pl.id}
                      style={styles.panelItem}
                      onClick={() => {
                        if (newItems.length > 0) {
                          setPlaylists((prev) =>
                            prev.map((p) =>
                              p.id === pl.id ? { ...p, songs: [...p.songs, ...newItems] } : p
                            )
                          );
                        }
                        setPanelTarget(null);
                      }}
                    >
                      <span style={styles.panelItemIcon}>{pl.id === "liked" ? <FaHeart size={16} /> : "📋"}</span>
                      <span style={styles.panelItemName}>{pl.name}</span>
                      {allExist && <span style={styles.panelItemTag}>已添加</span>}
                      <span style={styles.panelItemCount}>{pl.songs.length} 首</span>
                    </button>
                  );
                });
              })()}
              {playlists.filter((p) => p.id !== "recent").length === 0 && (
                <p style={styles.panelEmpty}>暂无播放列表</p>
              )}
              {panelSearch && playlists.filter((p) => p.id !== "recent").length > 0 && !playlists.some((p) => p.id !== "recent" && p.name.toLowerCase().includes(panelSearch.toLowerCase())) && (
                <p style={styles.panelEmpty}>未找到匹配的播放列表</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* ③ 播放控制器（底部播放条 + 播放详情页）                     */}
      {/* ============================================================ */}
                                                <MusicPlayer
        albums={albums}
        artistRecords={artistRecords}
        playlists={playlists}
        setPlaylists={setPlaylists}
        currentAlbumId={currentAlbumId}
        currentPlaylistId={currentPlaylistId}
        setCurrentAlbumId={setCurrentAlbumId}
        currentSongIndex={currentSongIndex}
        setCurrentSongIndex={setCurrentSongIndex}
        isPlaying={isPlaying}
        setIsPlaying={setIsPlaying}
        currentTime={currentTime}
        setCurrentTime={setCurrentTime}
        duration={duration}
        setDuration={setDuration}
        volume={volume}
        setVolume={setVolume}
        audioRef={audioRef}
        playQueue={playQueue}
        setPlayQueue={setPlayQueue}
        onNavigateToAlbum={handleOpenAlbumDetail}
        onNavigateToArtist={handleOpenArtistDetail}
        onNavigateToPlaylist={handleOpenPlaylistDetail}
        onUnplayableSong={(song) => setUnplayableDialogSong(song)}
        onOpenEdit={handleOpenEditFromPlayer}
        editRestoreRef={editRestoreRef}
      />

<MusicEdit
        key={editTarget ? `${editTarget.type}-${editTarget.data?.file_path || editTarget.data?.id || ""}` : "none"}
        target={editTarget}
        albums={albums}
        artistRecords={artistRecords}
        onClose={() => setEditTarget(null)}
        onSave={handleSaveEdit}
        onRefresh={refreshFromServer}
        onAlbumMatchProgress={handleAlbumMatchProgress}
        onAlbumMatchSaved={handleAlbumMatchSaved}
        onMatchError={handleAlbumMatchError}
        onBackgroundAlbumMatch={runBackgroundAlbumMatch}
        onSmartSuggestion={smartAvailable ? startSmartSuggestion : null}
        smartAvailable={smartAvailable}
        videos={videos}
        onUpdateVideoLinks={handleUpdateSongVideoLinks}
        onUploadVideoFile={handleUploadVideoFromEditor}
        onAddWebVideo={handleAddWebVideo}
      />

      {artistEditTarget && (
        <ArtistEdit
          key={artistEditTarget.artist}
          artist={artistEditTarget.artist}
          record={artistEditTarget.record}
          albums={artistEditTarget.albums}
          onClose={() => setArtistEditTarget(null)}
          onSaved={handleSaveArtist}
          onRemoved={handleRemoveArtistRecord}
        />
      )}

      <Settings
        show={showSettings}
        onClose={() => setShowSettings(false)}
        onReset={handleResetData}
        onSettingsSaved={handleSettingsSaved}
        onLibraryNameChange={setLibraryTitle}
        onMoreCategoriesChange={setShowMoreCategories}
        onCategoryVisibilityChange={setCategoryVisibility}
        matchState={matchState}
        onOpenMatchDetail={() => openMatchDetail("all")}
        onMatchStarted={startMatchPoll}
        onRefreshLibrary={handleRefreshLibrary}
  onMatchNothing={() => showToast("无内容可匹配", "info")}
onArtistVisibilityChange={(value) => {
  setHideEmptyArtists(value);
  const autoOrganize = localStorage.getItem("edit-auto-organize-collab") !== "false";
  const belongs = autoOrganize
    ? albums.some((a) => albumBelongsToArtist(a, detailArtistName))
    : albums.some((a) => a.artist === detailArtistName);
  if (value && detailArtistName && !belongs) {
    setDetailArtistName(null);
  }
}}
        onDataJobStarted={handleDataJobStarted}
        onSmartProvidersChanged={handleSmartProvidersChanged}
      />

      {/* ===== 匹配详情独立窗口 ===== */}
      {showMatchDetail && (
        <MatchDetail
          data={matchState}
          initialFilter={matchDetailFilter}
          onCancel={handleCancelMatch}
          onClose={() => setShowMatchDetail(false)}
        />
      )}

      {/* ===== 拖拽添加音乐遮罩（仅可导入区域显示；常驻 DOM，通过透明度显隐） ===== */}
      <div
        style={{
          ...styles.dragOverlay,
          opacity: isDragOver ? 1 : 0,
          visibility: isDragOver ? "visible" : "hidden",
        }}
        className="drag-drop-overlay"
      >
        <div style={styles.dragOverlayBox}>
          <FaMusic size={36} style={{ opacity: 0.7 }} />
          <span style={styles.dragOverlayText}>拖拽至此处添加</span>
        </div>
      </div>

      {/* ===== 缺失歌曲「查找」重导入的文件选择器 ===== */}
      <input
        ref={reimportInputRef}
        type="file"
        accept="audio/*"
        style={{ display: "none" }}
        onChange={handleReimportSelect}
      />

      {/* ===== 右上角通知堆叠（统一通知） ===== */}
      {notifications.some((n) => n.popup) && (
        <div style={styles.notifyStack} className="notification-stack">
          {notifications.filter((n) => n.popup).map((n) => {
            const leaving = n.id === leavingNotifId;
            const anim = leaving
              ? { animation: "fadeOut 0.25s ease forwards" }
              : { animation: "slideInRight 0.25s ease" };
            const hoverProps = {
              onMouseEnter: () => setHoveredNotifId(n.id),
              onMouseLeave: () => {
                if (hoveredNotifId === n.id) dismissNotificationAnim(n.id);
                setHoveredNotifId(null);
              },
            };

            if (n.kind === "progress_import" || n.kind === "progress_match" || n.kind === "progress_album_match" || n.kind === "progress_update" || n.kind === "progress_data" || n.kind === "smart_progress") {
              return renderProgressCard(n, { key: n.id, className: "notification-card notification-progress-card", style: anim, ...hoverProps });
            }

            // toast 类通知
            const isSuccess = n.kind === "success";
            const isInfo = n.kind === "info";
            return (
              <div
                key={n.id}
                className={`notification-card notification-toast${isSuccess ? " is-success" : ""}${isInfo ? " is-info" : ""}${n.transient ? " is-transient" : ""}`}
                style={{
                  ...styles.toastNotify,
                  position: "static",
                  ...(n.content || n.action ? styles.toastNotifyCard : {}),
                  ...(isSuccess ? styles.toastNotifySuccess : {}),
                  ...(isInfo ? styles.toastNotifyInfo : {}),
                  ...anim,
                }}
                {...hoverProps}
              >
                {isSuccess ? (
                  <FaCheckCircle size={20} style={{ color: "#ffffff", flexShrink: 0 }} />
                ) : isInfo ? (
                  <FaInfoCircle size={20} style={{ color: "#ffffff", flexShrink: 0 }} />
                ) : (
                  <FaExclamationCircle size={20} style={{ color: "#f59e0b", flexShrink: 0 }} />
                )}
                <div style={styles.toastCardBody}>
                  <p style={{ ...styles.toastCardTitle, ...(isSuccess ? styles.toastCardTitleSuccess : {}), ...(isInfo ? styles.toastCardTitleSuccess : {}) }}>{n.title}</p>
                  {n.content && (
                    <p style={{ ...styles.toastCardContent, ...(isSuccess ? styles.toastCardContentSuccess : {}), ...(isInfo ? styles.toastCardContentSuccess : {}) }}>{n.content}</p>
                  )}
                </div>
                {n.action && (
                  <button style={isSuccess || isInfo ? styles.toastCardActionSuccess : styles.toastCardAction} onClick={n.action.onClick}>
                    {n.action.label}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ===== 活动面板（铃铛入口） ===== */}
      {showActivity && (
        <>
          <div
            className="activity-backdrop"
            style={{
              ...styles.activityBackdrop,
              ...(activityLeaving ? { animation: "fadeOutDim 0.28s ease forwards" } : { animation: "fadeInDim 0.28s ease" }),
            }}
            onClick={closeActivity}
          />
          <div
            className="activity-panel"
            style={{
              ...styles.activityPanel,
              ...(activityLeaving ? { animation: "slideOutPanelRight 0.28s ease forwards" } : { animation: "slideInPanelRight 0.28s ease" }),
            }}
          >
            <div style={styles.activityHeader} className="activity-header">
              <h3 style={styles.activityTitle}>活动</h3>
              {/* 关闭按钮在上，「全部已读」在下（右对齐）；无可见消息时隐藏 */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "16px" }}>
                <button style={styles.activityClose} onClick={closeActivity} title="关闭">
                  <FaTimes size={16} />
                </button>
                {notifications.some((n) => !n.transient) && (
                  <button
                    style={styles.activityReadAllBtn}
                    onClick={() => { setNotifications([]); setUnreadCount(0); }}
                    title="全部已读"
                  >
                    全部已读
                  </button>
                )}
              </div>
            </div>
            <div style={styles.activityList} className="activity-list">
              {(() => {
                // 瞬态通知（设置已保存等）不进入活动盒子
                const visible = notifications.filter((n) => !n.transient);
                const sorted = [...visible].sort((a, b) => {
                  if (a.ongoing !== b.ongoing) return a.ongoing ? -1 : 1;
                  return b.time - a.time;
                });
                if (sorted.length === 0) {
                  return <p style={styles.activityEmpty}>暂无活动</p>;
                }
                return sorted.map((n) => {
                  // 进行中的进度卡片：复用弹出区卡片（含取消 / 查看详情 / 专辑进度 / 更新资料库）
                  if (n.ongoing && (n.kind === "progress_import" || n.kind === "progress_match" || n.kind === "progress_album_match" || n.kind === "progress_update" || n.kind === "progress_data" || n.kind === "smart_progress")) {
                    return renderProgressCard(n, { key: n.id, className: "activity-progress-card", style: { width: "100%", maxWidth: "none" } });
                  }
                  const pct = n.progress && n.progress.total > 0
                    ? Math.round((n.progress.done / n.progress.total) * 100)
                    : 0;
                  const iconStyle =
                    n.kind === "success" ? styles.activityItemIconSuccess
                      : n.kind === "warning" ? styles.activityItemIconWarn
                        : n.kind === "error" ? styles.activityItemIconErr
                          : n.kind.startsWith("progress") ? styles.activityItemIconRun
                            : styles.activityItemIconInfo;
                  const iconText =
                    n.kind === "success" ? "✓"
                      : n.kind === "warning" ? "!"
                        : n.kind === "error" ? "✕"
                          : n.kind.startsWith("progress") ? "▶"
                            : "•";
                  return (
                    <div key={n.id} style={styles.activityItem} className="activity-item">
                      <span style={{ ...styles.activityItemIcon, ...iconStyle }}>{iconText}</span>
                      <div style={styles.activityBody}>
                        <p style={styles.activityItemTitle}>{n.title}</p>
                        {n.content && <p style={styles.activityItemContent}>{n.content}</p>}
                        {n.ongoing && n.progress && (
                          <div style={styles.activityTrack}>
                            <div style={{ ...styles.activityFill, width: `${pct}%` }} />
                          </div>
                        )}
                        {n.action && (
                          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "6px" }}>
                            <button
                              style={styles.activityActionBtn}
                              onClick={() => {
                                setActivityLeaving(false);
                                setShowActivity(false);
                                n.action.onClick();
                              }}
                            >
                              {n.action.label}
                            </button>
                          </div>
                        )}
                      </div>
                      <span style={styles.activityTime}>{formatNotifTime(n.time)}</span>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </>
      )}

      {/* ===== 不受支持格式导入确认浮窗 ===== */}
      {importPending && (
        <div style={styles.overlay}>
          <div style={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.confirmTitle}>该内容不受支持</h3>
            <div style={styles.confirmDivider} />
            <p style={styles.confirmText}>该内容可以继续添加至资料库但无法播放，还要继续吗？</p>
            <label style={styles.importCheckboxRow}>
              <input
                type="checkbox"
                style={styles.importCheckbox}
                checked={importRememberChoice}
                onChange={(e) => setImportRememberChoice(e.target.checked)}
              />
              <span style={styles.importCheckboxLabel}>后续都默认此操作</span>
            </label>
            <div style={styles.confirmActions}>
              <button
                style={styles.confirmDeleteBtn}
                onClick={() => {
                  if (importRememberChoice) importUnplayableChoiceRef.current = "continue";
                  handleUnplayableContinue();
                }}
              >
                继续
              </button>
              <button
                style={styles.confirmCancelBtn}
                onClick={() => {
                  if (importRememberChoice) importUnplayableChoiceRef.current = "cancel";
                  handleUnplayableCancel();
                }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 重置进度对话框（居中，不可取消） ===== */}
      {resetting && (
        <div style={styles.resetOverlay}>
          <div style={styles.resetProgressBox} onClick={(e) => e.stopPropagation()}>
            <div style={styles.resetProgressBody}>
              <h3 style={styles.resetProgressTitle}>正在重置资料库</h3>
              <div style={styles.confirmDivider} />
              <p style={styles.resetProgressWarn}>重置完成前请不要关闭窗口</p>
              <div style={styles.resetProgressCountRow}>
                <span style={styles.resetProgressCount}>
                  已重置：{resetProgress.done}/{resetProgress.total}
                </span>
                <span style={styles.resetProgressPct}>
                  {resetProgress.total > 0 ? Math.round((resetProgress.done / resetProgress.total) * 100) : 0}%
                </span>
              </div>
            </div>
            <div style={styles.resetProgressTrack}>
              <div
                style={{
                  ...styles.resetProgressFill,
                  width: `${resetProgress.total > 0 ? Math.round((resetProgress.done / resetProgress.total) * 100) : 0}%`,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ===== 导入结果详情浮窗（被跳过的无法播放 / 重复歌曲） ===== */}
      {importSkipDetail && (
        <div style={styles.overlay} onClick={() => setImportSkipDetail(null)}>
          <div style={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.confirmTitle}>导入结果</h3>
            <div style={styles.confirmDivider} />
            {importSkipDetail.unplayable.length > 0 && (
              <>
                <p style={styles.confirmText}>无法播放歌曲：</p>
                <div style={styles.importUnplayableList}>
                  {importSkipDetail.unplayable.map((s, i) => (
                    <div key={i} style={styles.importUnplayableRow}>
                      <span style={styles.importUnplayableTitle}>{s.title}</span>
                      <span style={styles.importUnplayableArtist}>{s.artist}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            {importSkipDetail.duplicate.length > 0 && (
              <>
                <p style={styles.confirmText}>重复添加歌曲：</p>
                <div style={styles.importUnplayableList}>
                  {importSkipDetail.duplicate.map((s, i) => (
                    <div key={i} style={styles.importUnplayableRow}>
                      <span style={styles.importUnplayableTitle}>{s.title}</span>
                      <span style={styles.importUnplayableArtist}>{s.artist}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div style={styles.confirmActions}>
              <button style={styles.confirmCancelBtn} onClick={() => setImportSkipDetail(null)}>
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 缺失歌曲查找：源文件不一致时选择替换或新增 ===== */}
      {reimportMismatch && (
        <div style={styles.overlay}>
          <div style={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.confirmTitle}>继续导入</h3>
            <div style={styles.confirmDivider} />
            <p style={styles.confirmText}>导入的内容与源文件不一致，接下来要怎么做？</p>
            <div style={{ display: "grid", gap: "10px", margin: "18px 0 22px" }}>
              {[
                { id: "merge", icon: FaObjectGroup, title: "将添加项目与资料库项目合并" },
                { id: "add", icon: FaPlus, title: "将音乐新加入到库中" },
              ].map(({ id, icon: Icon, title }) => {
                const selected = reimportMismatch.choice === id;
                return <button
                  type="button"
                  key={id}
                  onClick={() => setReimportMismatch((current) => current ? { ...current, choice: id } : current)}
                  style={{ position: "relative", display: "flex", alignItems: "center", gap: "10px", minHeight: "54px", padding: "12px 14px", border: selected ? "1px solid #e94560" : "1px solid #e5e7eb", borderRadius: "10px", background: selected ? "#fff6f7" : "#fff", color: "#374151", font: "inherit", textAlign: "left", cursor: "pointer", overflow: "hidden" }}
                >
                  <span style={{ width: "15px", color: "#e94560", fontWeight: 700 }}>{selected ? "✔" : ""}</span>
                  <Icon size={17} color={selected ? "#e94560" : "#6b7280"} />
                  <span>{title}</span>
                  {selected && <span style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "3px", background: "#e94560" }} />}
                </button>;
              })}
            </div>
            <div style={styles.confirmActions}>
              <button style={styles.confirmDeleteBtn} onClick={handleReimportMismatchConfirm}>确认</button>
              <button
                style={styles.confirmCancelBtn}
                onClick={() => {
                  setReimportMismatch(null);
                  if (importNotifIdRef.current) updateNotification(importNotifIdRef.current, { ongoing: false, progress: null, cover: null, popup: true, kind: "info", title: "已取消导入", content: null });
                }}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 导入一致性确认浮窗（内容不一致 / 不同歌曲） ===== */}
      {importConfirm && (
        <div style={styles.overlay}>
          <div style={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.confirmTitle}>继续导入？</h3>
            <div style={styles.confirmDivider} />
            <p style={styles.confirmText}>
              {importConfirm.item.replace
                ? "导入的内容与源文件不一致，继续导入会替换源文件的信息"
                : "导入的内容与源文件不一致，继续导入仅会新增项目"}
            </p>
            <div style={styles.confirmActions}>
              <button style={styles.confirmDeleteBtn} onClick={handleConsistencyConfirm}>继续导入</button>
              <button style={styles.confirmCancelBtn} onClick={handleConsistencyCancel}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 播放不可播放格式提示浮窗 ===== */}
      {unplayableDialogSong && (
        <div style={styles.overlay} onClick={() => setUnplayableDialogSong(null)}>
          <div style={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.confirmTitle}>此格式浏览器不支持</h3>
            <div style={styles.confirmDivider} />
            <p style={styles.confirmText}>无法在播放器中播放，可以尝试直接打开文件</p>
            <div style={styles.confirmActions}>
              {unplayableDialogSong.file_path && (
                <button
                  style={styles.confirmDeleteBtn}
                  onClick={() => handleOpenLocalFile(unplayableDialogSong.file_path)}
                >
                  打开
                </button>
              )}
              <button style={styles.confirmCancelBtn} onClick={() => setUnplayableDialogSong(null)}>确定</button>
            </div>
          </div>
        </div>
      )}

      {/* 缺失文件提示浮窗 */}
      {missingDialogSong && (
        <div style={styles.overlay} onClick={() => setMissingDialogSong(null)}>
          <div style={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.confirmTitle}>项目不可用</h3>
            <div style={styles.confirmDivider} />
            <p style={styles.confirmText}>该歌曲已经被删除或移动至其他地方，是否要查找这首音乐？</p>
            <div style={styles.confirmActions}>
              <button style={styles.confirmDeleteBtn} onClick={() => reimportInputRef.current?.click()}>查找</button>
              <button style={styles.confirmCancelBtn} onClick={() => setMissingDialogSong(null)}>确定</button>
            </div>
          </div>
        </div>
      )}

      {showWebVideoDialog && (
        <div style={styles.overlay} onClick={() => !webVideoSubmitting && setShowWebVideoDialog(false)}>
          <div className="web-video-dialog" onClick={(e) => e.stopPropagation()}>
            <button className="web-video-dialog-close" type="button" onClick={() => setShowWebVideoDialog(false)} disabled={webVideoSubmitting}><FaTimes /></button>
            <h3>关联视频网站视频</h3>
            <p>支持哔哩哔哩和 YouTube 视频链接</p>
            <label>视频网址<input autoFocus type="url" value={webVideoUrl} placeholder="粘贴视频链接" onChange={(e) => setWebVideoUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleSubmitWebVideo(); }} /></label>
            <div className="web-video-dialog-actions"><button type="button" onClick={() => setShowWebVideoDialog(false)} disabled={webVideoSubmitting}>取消</button><button type="button" className="save" onClick={handleSubmitWebVideo} disabled={!webVideoUrl.trim() || webVideoSubmitting}>{webVideoSubmitting ? "正在添加…" : "添加"}</button></div>
          </div>
        </div>
      )}

      {deleteVideoConfirm && (
        <div style={styles.overlay} onClick={() => setDeleteVideoConfirm(null)}>
          <div style={styles.confirmDialog} onClick={(event) => event.stopPropagation()}>
            <h3 style={styles.confirmTitle}>确认删除</h3>
            <div style={styles.confirmDivider} />
            <p style={styles.confirmText}>确定要删除视频「{deleteVideoConfirm.title || "未命名视频"}」吗？此操作不可撤销。</p>
            <div style={styles.confirmActions}>
              <button style={styles.confirmDeleteBtn} onClick={handleConfirmDeleteVideo}>确认删除</button>
              <button style={styles.confirmCancelBtn} onClick={() => setDeleteVideoConfirm(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 单曲删除确认浮窗 */}
      {deleteSongConfirm && (
        <div style={styles.overlay} onClick={() => setDeleteSongConfirm(null)}>
          <div style={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.confirmTitle}>确认删除</h3>
            <div style={styles.confirmDivider} />
            <p style={styles.confirmText}>确定要删除歌曲「{deleteSongConfirm.title}」吗？此操作不可撤销。</p>
            <div style={styles.confirmActions}>
              <button style={styles.confirmDeleteBtn} onClick={handleConfirmDeleteSong}>确认删除</button>
              <button style={styles.confirmCancelBtn} onClick={() => setDeleteSongConfirm(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 专辑删除确认浮窗 */}
      {deleteAlbumConfirm && (
        <div style={styles.overlay} onClick={handleCancelDeleteAlbum}>
          <div style={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.confirmTitle}>确认删除</h3>
            <div style={styles.confirmDivider} />
            <p style={styles.confirmText}>
              确定要删除专辑「{albums.find(a => a.id === deleteAlbumConfirm)?.title}」吗？此操作不可撤销。
            </p>
            <div style={styles.confirmActions}>
              <button style={styles.confirmDeleteBtn} onClick={handleConfirmDeleteAlbum}>确认删除</button>
              <button style={styles.confirmCancelBtn} onClick={handleCancelDeleteAlbum}>取消</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ======================================================
   🎨 样式
   ====================================================== */
const styles = {
    container: {
    width: "100%", height: "100vh", display: "flex", flexDirection: "column",
        background: "#ffffff",
    color: "#1f2937", overflow: "hidden",
    fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
  },

  // 侧边栏 + 主内容左右布局
  bodyLayout: {
    flex: 1,
    display: "flex",
    flexDirection: "row",
    overflow: "hidden",
  },

  // 右侧主区域（包含顶部栏 + 内容区）
  rightArea: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    minWidth: 0,
  },

  // 顶部功能条
  topBar: {
    display: "flex", alignItems: "center", gap: "16px",
    padding: "12px 28px",
        background: "#f9fafb",
    borderBottom: "1px solid #e5e7eb",
    flexShrink: 0, zIndex: 10, flexWrap: "wrap",
  },
  logoArea: { display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 },
  logoIcon: { fontSize: "24px" },
  logoTitle: {
        fontSize: "18px", fontWeight: 700, color: "#1f2937",
    letterSpacing: "0.5px", margin: 0,
  },
  searchArea: {
    display: "flex", alignItems: "center",
        background: "#f3f4f6", borderRadius: "24px",
    padding: "6px 14px", flex: "1 1 280px", maxWidth: "400px",
    border: "1px solid #e5e7eb", transition: "border-color 0.2s",
  },
  searchIcon: { fontSize: "14px", marginRight: "8px", opacity: 0.5 },
  searchInput: {
        flex: 1, background: "transparent", border: "none",
    outline: "none", color: "#1f2937", fontSize: "14px", fontFamily: "inherit",
  },
  clearBtn: {
    fontSize: "14px", cursor: "pointer", opacity: 0.5,
    padding: "2px", transition: "opacity 0.2s",
  },
  importBtn: {
    display: "flex", alignItems: "center", justifyContent: "center",
    width: "40px", height: "40px", padding: 0,
    borderRadius: "50%", border: "none",
    background: "linear-gradient(135deg, #e94560, #c73e52)",
    color: "#fff", fontSize: "18px",
    cursor: "pointer", boxShadow: "0 4px 15px rgba(233,69,96,0.3)", flexShrink: 0,
    transition: "transform 0.2s, box-shadow 0.2s",
  },
  secondaryTopBtn: {
    display: "flex", alignItems: "center", justifyContent: "center",
    width: "40px", height: "40px", padding: 0,
    borderRadius: "50%", border: "none",
    background: "transparent", color: "#6b7280", fontSize: "18px",
    cursor: "pointer", flexShrink: 0,
    transition: "background 0.2s, color 0.2s, transform 0.2s",
  },
  importDropdown: {
    position: "absolute", right: 0, top: "calc(100% + 4px)",
    zIndex: 1000, minWidth: "170px", padding: "6px",
    borderRadius: "12px", background: "#ffffff",
    boxShadow: "0 8px 30px rgba(0,0,0,0.15)",
    border: "1px solid #e5e7eb",
  },
  stats: { fontSize: "12px", color: "#6b7280", whiteSpace: "nowrap", flexShrink: 0 },

    // 中间内容区
  mainArea: { flex: 1, overflowY: "auto", padding: "28px 28px 160px" },
  // 专辑详情页容器
  detailPageArea: { flex: 1, overflow: "hidden", padding: "0 0 120px" },

  // 空状态
  emptyState: {
    display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", height: "100%", minHeight: "300px", gap: "12px",
  },
  emptyIcon: { fontSize: "56px", opacity: 0.3 },
  emptyText: { fontSize: "18px", color: "#374151", fontWeight: 500, margin: 0 },
  emptyHint: { fontSize: "14px", color: "#6b7280", margin: 0 },

    // 分类按钮栏
  sortBar: {
    display: "flex", alignItems: "center", gap: "10px",
    marginBottom: "20px", flexWrap: "wrap",
  },
  sortLabel: {
    fontSize: "13px", color: "#6b7280", fontWeight: 500,
  },
  sortBtn: {
    padding: "6px 18px", borderRadius: "20px", border: "1px solid #d1d5db",
    background: "#ffffff", color: "#374151", fontSize: "13px", fontWeight: 500,
    cursor: "pointer", transition: "all 0.2s",
    fontFamily: "inherit",
  },
    sortBtnActive: {
    background: "#e94560", color: "#fff", borderColor: "#e94560",
    boxShadow: "0 2px 12px rgba(233,69,96,0.3)",
  },
  sortSelect: {
    padding: "6px 14px", borderRadius: "20px", border: "1px solid #d1d5db",
    background: "#ffffff", color: "#374151", fontSize: "13px", fontWeight: 500,
    cursor: "pointer", fontFamily: "inherit", outline: "none",
    transition: "all 0.2s",
  },

  // 专辑网格
  albumGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
    gap: "24px",
  },
  albumCard: {
        borderRadius: "12px", overflow: "hidden",
    background: "#ffffff",
    border: "1px solid #e5e7eb",
  },
  albumCardActive: {
    border: "2px solid #e94560", boxShadow: "0 0 20px rgba(233,69,96,0.2)",
  },

  // 封面
  coverWrapper: {
    position: "relative", width: "100%", aspectRatio: "1 / 1",
    overflow: "hidden", background: "#f3f4f6",
  },
  coverImage: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  albumCoverMissingOverlay: {
    position: "absolute",
    inset: 0,
    background: "rgba(128,128,128,0.55)",
    zIndex: 2,
    pointerEvents: "none",
  },
  coverPlaceholder: {
    width: "100%", height: "100%", display: "flex",
    alignItems: "center", justifyContent: "center",
    background: "#e5e7eb",
  },
  coverPlaceholderIcon: { fontSize: "40px", opacity: 0.4 },
  playingBadge: {
    position: "absolute", top: "8px", left: "8px", padding: "3px 10px",
    borderRadius: "12px",     background: "#e94560", color: "#fff",
    fontSize: "11px", fontWeight: 600, letterSpacing: "0.3px",
    backdropFilter: "blur(4px)",
  },
  songCount: {
    position: "absolute", bottom: "8px", right: "8px", padding: "2px 10px",
    borderRadius: "10px",     background: "rgba(0,0,0,0.7)", color: "#fff",
    fontSize: "11px", fontWeight: 500, backdropFilter: "blur(4px)",
  },
        albumTitle: {
    fontSize: "14px", fontWeight: 600, color: "#1f2937",
    margin: 0, overflow: "hidden",
    textOverflow: "ellipsis", whiteSpace: "nowrap",
    flex: 1, minWidth: 0,
  },
    albumArtist: {
    fontSize: "12px", color: "#6b7280",
    margin: "0 12px 12px 12px", overflow: "hidden",
    textOverflow: "ellipsis", whiteSpace: "nowrap",
  },

  // ---- 页面标题 ----
  pageTitle: {
    fontSize: "22px", fontWeight: 700, color: "#1f2937",
    margin: "0 0 20px",
  },

    // ---- 资料库网格 ----
  libraryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
    gap: "24px",
  },
  playlistHeader: {
    display: "flex",
    alignItems: "center",
    marginBottom: "24px",
  },
  playlistHeaderTitle: {
    fontSize: "22px",
    fontWeight: 700,
    color: "#1f2937",
    margin: 0,
  },
  libraryCard: {
    borderRadius: "12px", overflow: "hidden",
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    cursor: "pointer",
  },
  playlistCoverPlaceholder: {
    width: "100%", height: "100%",
    display: "flex", alignItems: "center", justifyContent: "center",
    background: "linear-gradient(135deg, #f9fafb, #f3f4f6)",
    fontSize: "48px",
  },
  playlistCardOverlay: {
    position: "absolute", inset: 0, zIndex: 2, opacity: 0.35, pointerEvents: "none",
  },
  playlistCardTitleOverlay: {
    position: "absolute", right: "8px", bottom: "8px", left: "8px", zIndex: 3,
    display: "flex", justifyContent: "flex-end",
  },
  playlistCardTitle: {
    color: "#ffffff", fontSize: "25px", fontWeight: 600, textShadow: "0 1px 6px rgba(0,0,0,0.6)",
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  },

  // ---- 艺人视图 ----
  artistGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
    gap: "20px",
  },
  artistCard: {
    display: "flex", flexDirection: "column", alignItems: "center",
    gap: "8px", padding: "20px 12px",
    borderRadius: "12px", border: "1px solid #e5e7eb",
    background: "#ffffff", cursor: "pointer",
    transition: "transform 0.2s, box-shadow 0.2s",
  },
  artistAvatar: {
    position: "relative",
    width: "80px", height: "80px", borderRadius: "50%",
    background: "#f3f4f6", display: "flex",
    alignItems: "center", justifyContent: "center",
    fontSize: "36px",
    overflow: "hidden",
  },
  artistAvatarIcon: { opacity: 0.5 },
  artistAvatarImg: {
    position: "absolute", inset: 0,
    width: "100%", height: "100%",
    borderRadius: "50%", objectFit: "cover", display: "block",
  },
  artistName: {
    fontSize: "15px", fontWeight: 600, color: "#1f2937",
    margin: 0, textAlign: "center",
  },
  artistAlbumCount: {
    fontSize: "12px", color: "#6b7280", margin: 0,
  },

    // ---- 歌曲表格视图 ----
  songTable: {
    display: "flex", flexDirection: "column", gap: "2px",
    borderTop: "1px solid #e5e7eb",
  },
  songTableHeader: {
    display: "flex", alignItems: "center", gap: "0",
    padding: "10px 14px", borderBottom: "1px solid #e5e7eb",
    fontSize: "12px", fontWeight: 600, color: "#6b7280",
    letterSpacing: "0.5px", textTransform: "uppercase",
  },
    songTableRow: {
    display: "flex", alignItems: "center", gap: "0",
    padding: "6px 10px", borderRadius: "10px", boxSizing: "border-box",
    cursor: "pointer", transition: "background 0.15s",
  },
    songTableRowActive: {
    background: "rgba(233,69,96,0.12)",
    border: "1px solid rgba(233,69,96,0.25)",
  },
    // 列宽定义
            songColCheck: { width: "36px", flexShrink: 0, display: "flex", alignItems: "center" },
  songColTitle: { flex: "2 1 0", minWidth: 0, paddingRight: "8px", overflow: "hidden" },
  songColArtist: { flex: "1 1 0", minWidth: 0, paddingRight: "8px", overflow: "hidden" },
  songColYear: { width: "60px", flexShrink: 0, paddingRight: "8px" },
  songColAlbum: { flex: "1 1 0", minWidth: 0, overflow: "hidden", paddingRight: "8px" },
  songColDuration: { width: "60px", flexShrink: 0, textAlign: "right", paddingRight: "4px" },
  songColMenu: { width: "40px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" },
    // 单元格样式
  songCheckbox: {
    width: "16px", height: "16px", cursor: "pointer",
    accentColor: "#e94560",
  },
  songCoverThumb: {
    position: "relative",
    width: "32px", height: "32px", borderRadius: "4px",
    overflow: "hidden", flexShrink: 0,
    background: "#f3f4f6",
  },
  songCoverThumbImg: {
    width: "100%", height: "100%", objectFit: "cover", display: "block",
  },
  songCoverThumbPlaceholder: {
    display: "flex", alignItems: "center", justifyContent: "center",
    width: "100%", height: "100%", fontSize: "14px", opacity: 0.4,
  },
  songCellTitle: {
    fontSize: "14px", fontWeight: 500, color: "#1f2937",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  songCellTitleActive: { color: "#1f2937", fontWeight: 600 },
  songCellText: {
    fontSize: "13px", color: "#6b7280",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  songCellTextMissing: { color: "#9ca3af" },
  clickableCellText: {
    color: "#e94560",
    cursor: "pointer",
    fontWeight: 500,
    transition: "color 0.15s",
  },
        songPlayingIndicator: {
    fontSize: "12px", color: "#e94560", fontWeight: 600,
  },

    // ---- 单曲操作按钮 ---- 
  songMenuBtn: {
    width: "32px", height: "32px", borderRadius: "50%",
    border: "none", background: "transparent",
    cursor: "pointer", display: "flex", alignItems: "center",
    justifyContent: "center", opacity: 0,
    transition: "all 0.15s",
    color: "#6b7280", flexShrink: 0,
  },
    songMenuDots: {
    fontSize: "18px", fontWeight: 700, lineHeight: 1,
    letterSpacing: "2px", marginTop: "-2px",
  },

    // ---- 专辑名右侧操作按钮 ----
        albumTitleRow: {
      display: "flex",
      alignItems: "center",
      gap: "4px",
      margin: "10px 12px 2px",
    },
        albumMenuBtnInline: {
          flexShrink: 0,
          width: "32px",
          height: "32px",
          borderRadius: "50%",
          border: "none",
          background: "transparent",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#9ca3af",
        },
        albumMenuDotsInline: {
          fontSize: "18px",
          fontWeight: 700,
          lineHeight: 1,
          letterSpacing: "2px",
          marginTop: "-2px",
        },

  // ---- 单曲操作菜单 ---- 
  contextOverlay: {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 999, background: "transparent",
  },
  contextMenu: {
    position: "fixed", zIndex: 1000,
    minWidth: "180px", padding: "6px", borderRadius: "12px",
    background: "#ffffff", boxShadow: "0 8px 30px rgba(0,0,0,0.15)",
    border: "1px solid #e5e7eb",
  },
  contextMenuItem: {
    display: "flex", alignItems: "center", gap: "10px",
    padding: "8px 14px", borderRadius: "8px",
    fontSize: "13px", color: "#374151", fontWeight: 500,
    cursor: "pointer", transition: "background 0.15s",
  },
  contextMenuIcon: {
    fontSize: "14px", width: "20px", textAlign: "center",
  },
  contextMenuDivider: {
    height: "1px", background: "#e5e7eb",
    margin: "4px 8px",
  },

    // ---- 多选模式样式 ----
  multiSelectBarSticky: {
    position: "sticky", top: 0, zIndex: 50,
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "12px 16px", marginBottom: "16px",
    background: "#ffffff", border: "1px solid #e5e7eb",
    borderRadius: "12px", boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
    gap: "12px", flexWrap: "wrap",
  },
  multiSelectLeft: {
    display: "flex", alignItems: "center", gap: "8px",
    flexWrap: "wrap",
  },
  multiSelectRight: {
    display: "flex", alignItems: "center", gap: "8px",
    flexWrap: "wrap",
    marginLeft: "auto",
  },
  multiSelectInfo: {
    fontSize: "14px", color: "#1f2937", fontWeight: 600,
    marginRight: "4px", whiteSpace: "nowrap",
  },
  actionBtn: {
    padding: "6px 16px", borderRadius: "20px", border: "1px solid #d1d5db",
    background: "#f9fafb", color: "#374151",
    fontSize: "13px", fontWeight: 500, cursor: "pointer",
    fontFamily: "inherit", whiteSpace: "nowrap",
    transition: "all 0.2s",
  },
  deleteBtn: {
    padding: "6px 20px", borderRadius: "20px", border: "none",
    background: "#e94560", color: "#fff",
    fontSize: "13px", fontWeight: 600, cursor: "pointer",
    fontFamily: "inherit", whiteSpace: "nowrap",
    transition: "all 0.2s",
  },
  cancelSelectBtn: {
    padding: "6px 20px", borderRadius: "20px",
    border: "1px solid #d1d5db", background: "#ffffff",
    color: "#374151", fontSize: "13px", fontWeight: 500,
    cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
    transition: "all 0.2s",
  },
  // ===== 添加到播放列表面板 =====
  playlistPanel: {
    width: "360px", maxHeight: "70vh",
    background: "#1a1a2e", borderRadius: "16px",
    padding: "24px", display: "flex", flexDirection: "column",
    gap: "12px", boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
    overflow: "hidden",
  },
  panelTitle: {
    fontSize: "18px", fontWeight: 700, color: "#ffffff", margin: 0,
  },
  panelSearch: {
    padding: "10px 14px", borderRadius: "10px",
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.08)",
    color: "#e0e0e0", fontSize: "14px", outline: "none",
    fontFamily: "inherit", width: "100%", boxSizing: "border-box",
  },
  panelList: {
    display: "flex", flexDirection: "column",
    gap: "6px", overflowY: "auto", maxHeight: "60vh",
  },
  panelItem: {
    display: "flex", alignItems: "center", gap: "10px",
    padding: "12px 14px", border: "none", borderRadius: "10px",
    background: "rgba(255,255,255,0.06)", color: "#e0e0e0",
    fontSize: "14px", cursor: "pointer", fontFamily: "inherit",
    textAlign: "left", width: "100%", transition: "background 0.2s",
  },
  panelItemIcon: { fontSize: "18px", flexShrink: 0 },
  panelItemName: { flex: 1, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  panelItemTag: { fontSize: "11px", color: "#10b981", fontWeight: 600, flexShrink: 0 },
  panelItemCount: { fontSize: "12px", color: "#9ca3af", flexShrink: 0 },
  panelEmpty: { color: "#6b7280", fontSize: "14px", textAlign: "center", padding: "24px 0", margin: 0 },

  cancelFilterBtn: {
    padding: "4px 14px", borderRadius: "16px",
    border: "1px solid #e94560", background: "#fff",
    color: "#e94560", fontSize: "12px", fontWeight: 500,
    cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
    marginLeft: "auto",
  },
  songTableRowChecked: {
    background: "rgba(233,69,96,0.06)",
    border: "1px solid rgba(233,69,96,0.15)",
  },

  // ---- 删除确认浮窗 ----
  overlay: {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
    background: "rgba(0,0,0,0.4)", zIndex: 1000,
    display: "flex", alignItems: "center", justifyContent: "center",
    backdropFilter: "blur(4px)",
  },
  // 拖拽添加音乐遮罩
  dragOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 900,
    background: "rgba(233,69,96,0.12)",
    pointerEvents: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "opacity 0.15s ease",
  },
  dragOverlayBox: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "14px",
    padding: "40px 60px",
    borderRadius: "18px",
    border: "3px dashed #e94560",
    background: "rgba(255,255,255,0.9)",
    color: "#e94560",
    boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
  },
  dragOverlayText: {
    fontSize: "18px",
    fontWeight: 600,
  },
  // 导入进度卡片（右上角）
  importProgress: {
    position: "fixed",
    top: "76px",
    right: "24px",
    zIndex: 1500,
    width: "360px",
    background: "#ffffff",
    borderRadius: "14px",
    boxShadow: "0 8px 30px rgba(0,0,0,0.18)",
    border: "1px solid #f3f4f6",
    overflow: "hidden",
  },
  importProgressBody: {
    padding: "17px 22px 20px",
  },
  importProgressTitle: {
    margin: "0 0 10px",
    fontSize: "17px",
    fontWeight: 600,
    color: "#1f2937",
  },
  importProgressRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  importProgressCount: {
    fontSize: "15px",
    color: "#6b7280",
  },
  importProgressCover: {
    position: "relative",
    width: "38px",
    height: "38px",
    borderRadius: "7px",
    overflow: "hidden",
    background: "#f3f4f6",
    color: "#9ca3af",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  importProgressCoverPlaceholder: {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  importProgressCoverImg: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  importProgressCancel: {
    padding: "5px 17px",
    borderRadius: "18px",
    border: "1px solid #d1d5db",
    background: "#ffffff",
    color: "#374151",
    fontSize: "14px",
    cursor: "pointer",
    fontFamily: "inherit",
  },
  // 右上角弹窗通用关闭按钮
  popupCloseBtn: {
    position: "absolute",
    top: "12px",
    right: "12px",
    zIndex: 2,
    width: "26px",
    height: "26px",
    borderRadius: "50%",
    border: "none",
    background: "#f3f4f6",
    color: "#9ca3af",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "inherit",
  },
  toastCloseBtn: {
    position: "absolute",
    top: "10px",
    right: "10px",
    zIndex: 2,
    width: "24px",
    height: "24px",
    borderRadius: "50%",
    border: "none",
    background: "rgba(255,255,255,0.35)",
    color: "inherit",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "inherit",
  },
  // ===== 统一通知堆叠（右上角弹出区） =====
  notifyStack: {
    position: "fixed",
    top: "76px",
    right: "24px",
    zIndex: 1500,
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    maxHeight: "calc(100vh - 96px)",
    overflow: "hidden",
    alignItems: "flex-end",
  },
  // 进度卡片统一为通知卡片容器（列布局 + 固定宽度）
  notifCard: {
    position: "static",
    flexDirection: "column",
    alignItems: "stretch",
    width: "360px",
    boxSizing: "border-box",
  },
  // ===== 顶栏铃铛徽标 =====
  bellBadge: {
    position: "absolute",
    top: "-4px",
    right: "-4px",
    minWidth: "16px",
    height: "16px",
    padding: "0 4px",
    borderRadius: "8px",
    background: "#e94560",
    color: "#ffffff",
    fontSize: "10px",
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
  },
  // ===== 活动面板 =====
  // 背景遮罩：全屏（含顶部栏）逐渐变暗
  activityBackdrop: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(0,0,0,0.35)",
    zIndex: 1400,
  },
  // 面板：右侧向左约 30% 宽度，从右滑入（覆盖顶部栏）
  activityPanel: {
    position: "fixed",
    top: 0,
    right: 0,
    bottom: 0,
    width: "30%",
    minWidth: "320px",
    maxWidth: "520px",
    background: "#ffffff",
    boxShadow: "-8px 0 30px rgba(0,0,0,0.15)",
    zIndex: 1401,
    display: "flex",
    flexDirection: "column",
  },
  activityHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 24px",
    borderBottom: "1px solid #e5e7eb",
    flexShrink: 0,
  },
  activityTitle: {
    fontSize: "20px",
    fontWeight: 700,
    color: "#1f2937",
    margin: 0,
  },
  activityClose: {
    width: "34px",
    height: "34px",
    borderRadius: "50%",
    border: "none",
    background: "#f3f4f6",
    color: "#6b7280",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "inherit",
  },
  activityReadAllBtn: {
    padding: "5px 14px",
    borderRadius: "14px",
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    color: "#6b7280",
    fontSize: "12px",
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "all 0.15s",
  },
  activityList: {
    flex: 1,
    overflowY: "auto",
    padding: "16px 24px 40px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  activityEmpty: {
    fontSize: "14px",
    color: "#9ca3af",
    textAlign: "center",
    margin: "40px 0",
  },
  activityItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: "12px",
    padding: "12px 14px",
    borderRadius: "12px",
    border: "1px solid #e5e7eb",
    background: "#ffffff",
  },
  activityItemIcon: {
    flexShrink: 0,
    width: "22px",
    height: "22px",
    borderRadius: "50%",
    fontSize: "12px",
    fontWeight: 700,
    color: "#ffffff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginTop: "1px",
  },
  activityItemIconSuccess: { background: "#16a34a" },
  activityItemIconWarn: { background: "#f59e0b" },
  activityItemIconErr: { background: "#e94560" },
  activityItemIconRun: { background: "#e94560" },
  activityItemIconInfo: { background: "#9ca3af" },
  activityBody: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "3px",
  },
  activityItemTitle: {
    fontSize: "14px",
    fontWeight: 600,
    color: "#1f2937",
    margin: 0,
  },
  activityItemContent: {
    fontSize: "13px",
    color: "#6b7280",
    lineHeight: 1.5,
    margin: 0,
    wordBreak: "break-word",
  },
  activityTrack: {
    height: "5px",
    borderRadius: "3px",
    background: "#e5e7eb",
    overflow: "hidden",
    marginTop: "4px",
  },
  activityFill: {
    height: "100%",
    background: "#e94560",
    transition: "width 0.25s ease",
  },
  activityTime: {
    flexShrink: 0,
    fontSize: "11px",
    color: "#9ca3af",
    marginTop: "2px",
  },
  activityActionBtn: {
    padding: "5px 14px",
    borderRadius: "14px",
    border: "1px solid #e94560",
    background: "#ffffff",
    color: "#e94560",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  smartActivitySpinner: { width: "20px", height: "20px", border: "3px solid #f8c5cf", borderTopColor: "#e94560", borderRadius: "50%", animation: "smartActivitySpin 0.8s linear infinite", flexShrink: 0 },
  // 红色进度条（紧贴卡片底边，满 = 到右侧）
  importProgressTrack: {
    height: "6px",
    width: "100%",
    background: "#f3f4f6",
  },
  importProgressFill: {
    height: "100%",
    background: "#e94560",
    transition: "width 0.25s ease",
  },
  // 匹配进度卡片当前项（与导入卡片同布局）
  matchProgressCurrent: {
    margin: "8px 0 0",
    fontSize: "13px",
    color: "#6b7280",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  // 右上角通知（添加音乐功能条下方）
  toastNotify: {
    position: "fixed",
    top: "76px",
    right: "24px",
    zIndex: 1500,
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "17px 26px",
    borderRadius: "14px",
    background: "#ffffff",
    color: "#374151",
    fontSize: "18px",
    fontWeight: 500,
    border: "1px solid #e5e7eb",
  },
  toastNotifySuccess: {
    background: "#22c55e",
    color: "#ffffff",
    border: "1px solid #22c55e",
  },
  toastNotifyInfo: {
    background: "#3b82f6",
    color: "#ffffff",
    border: "1px solid #3b82f6",
  },
  // 标题+内容+按钮的卡片式通知
  toastNotifyCard: {
    alignItems: "flex-start",
    gap: "12px",
    padding: "16px 18px",
    minWidth: "320px",
    maxWidth: "380px",
  },
  toastCardBody: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "3px",
  },
  toastCardTitle: {
    fontSize: "16px",
    fontWeight: 600,
    color: "#1f2937",
    margin: 0,
  },
  toastCardContent: {
    fontSize: "13px",
    color: "#6b7280",
    margin: 0,
    lineHeight: 1.5,
  },
  toastCardAction: {
    flexShrink: 0,
    padding: "6px 16px",
    borderRadius: "16px",
    border: "1px solid #e94560",
    background: "#ffffff",
    color: "#e94560",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "all 0.2s",
  },
  // 绿色成功卡片：标题/内容白字，按钮白底绿字
  toastCardTitleSuccess: { color: "#ffffff" },
  toastCardContentSuccess: { color: "rgba(255,255,255,0.92)" },
  toastCardActionSuccess: {
    flexShrink: 0,
    padding: "6px 16px",
    borderRadius: "16px",
    border: "1px solid #ffffff",
    background: "#ffffff",
    color: "#16a34a",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "all 0.2s",
  },
  // 导入确认弹窗复选
  importCheckboxRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    margin: "0 0 10px",
    cursor: "pointer",
    userSelect: "none",
  },
  importCheckbox: {
    width: "16px",
    height: "16px",
    cursor: "pointer",
    accentColor: "#e94560",
    margin: 0,
  },
  importCheckboxLabel: {
    fontSize: "13px",
    color: "#374151",
  },
  // 已导入但不可播放歌曲列表
  importUnplayableList: {
    maxHeight: "240px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    margin: "4px 0 14px",
    padding: "10px 12px",
    borderRadius: "10px",
    border: "1px solid #f3f4f6",
    background: "#fafafa",
  },
  importUnplayableRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    padding: "6px 4px",
    borderBottom: "1px solid #f3f4f6",
  },
  importUnplayableTitle: {
    fontSize: "13px",
    fontWeight: 500,
    color: "#1f2937",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
    minWidth: 0,
  },
  importUnplayableArtist: {
    fontSize: "12px",
    color: "#6b7280",
    flexShrink: 0,
    maxWidth: "120px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  // 重置进度对话框（居中，不可取消）
  resetOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1600,
    fontFamily: "'Segoe UI', sans-serif",
  },
  resetProgressBox: {
    width: "400px",
    background: "#ffffff",
    borderRadius: "14px",
    boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    overflow: "hidden",
  },
  resetProgressBody: {
    padding: "26px 28px 20px",
  },
  resetProgressTitle: {
    fontSize: "20px",
    fontWeight: 700,
    color: "#1f2937",
    margin: "0",
    textAlign: "left",
  },
  resetProgressWarn: {
    fontSize: "14px",
    color: "#e94560",
    lineHeight: 1.6,
    margin: "0 0 18px",
  },
  resetProgressCountRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "0",
  },
  resetProgressCount: {
    fontSize: "14px",
    color: "#6b7280",
  },
  resetProgressPct: {
    fontSize: "14px",
    fontWeight: 600,
    color: "#374151",
  },
  resetProgressTrack: {
    height: "6px",
    width: "100%",
    background: "#f3f4f6",
    marginTop: "0",
  },
  resetProgressFill: {
    height: "100%",
    background: "#e94560",
    transition: "width 0.25s ease",
  },
  confirmDialog: {
    width: "420px", padding: "28px 30px 22px", borderRadius: "14px",
    background: "#ffffff", boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
    display: "flex", flexDirection: "column", alignItems: "stretch",
    gap: "10px",
  },
  createDialog: {
    gap: "16px", alignItems: "stretch", width: "400px",
  },
  playlistDialog: { gap: "16px", alignItems: "stretch", width: "min(920px, calc(100vw - 32px))", padding: "0 0 18px", maxHeight: "calc(100vh - 32px)", overflowY: "auto" },
  playlistDialogHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 24px", borderBottom: "1px solid #e5e7eb" },
  playlistDialogClose: { border: "none", background: "transparent", color: "#374151", cursor: "pointer", fontSize: "22px", padding: "2px" },
  playlistDialogBody: { display: "grid", gridTemplateColumns: "260px minmax(0, 1fr)", gap: "36px", padding: "16px 32px 0" },
  playlistFields: { display: "flex", flexDirection: "column", minWidth: 0 },
  playlistFieldLabel: { margin: "0 0 7px", color: "#374151", fontSize: "14px", fontWeight: 600 },
  createDialogTitle: {
    fontSize: "20px", fontWeight: 700, color: "#1f2937",
    margin: 0, textAlign: "center",
  },
  createCoverSection: {
    display: "flex", flexDirection: "column", alignItems: "center", gap: "8px",
  },
  createCover: {
    width: "260px", height: "260px", borderRadius: "14px",
    objectFit: "cover", display: "block",
  },
  createCoverPlaceholder: {
    width: "260px", height: "260px", borderRadius: "14px",
    background: "#f3f4f6", display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", gap: "8px",
    cursor: "pointer", border: "2px dashed #e94560", color: "#e94560", fontFamily: "inherit",
  },
  createCoverHint: { fontSize: "14px", color: "#e94560", fontWeight: 600 },
  coverActions: { display: "flex", gap: "10px", justifyContent: "center" },
  coverMenuWrap: { position: "relative", width: "260px", height: "260px" },
  coverMenuButton: { position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "44px", height: "44px", borderRadius: "50%", border: "none", background: "#e94560", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 3px 12px rgba(233,69,96,0.35)" },
  coverMenu: { position: "absolute", zIndex: 3, top: "calc(50% + 30px)", left: "50%", transform: "translateX(-50%)", minWidth: "120px", padding: "6px", borderRadius: "10px", background: "#fff", border: "1px solid #e5e7eb", boxShadow: "0 8px 24px rgba(0,0,0,0.16)" },
  coverMenuItem: { width: "100%", padding: "8px 10px", border: "none", borderRadius: "6px", background: "transparent", color: "#374151", textAlign: "left", cursor: "pointer", fontFamily: "inherit", fontSize: "13px" },
  createCoverChangeBtn: {
    background: "none", border: "none", color: "#e94560",
    fontSize: "13px", fontWeight: 500, cursor: "pointer",
    fontFamily: "inherit",
  },
  createCoverRemoveBtn: { background: "none", border: "none", color: "#ef233c", fontSize: "13px", fontWeight: 500, cursor: "pointer", fontFamily: "inherit" },
  createInput: {
    padding: "10px 14px", borderRadius: "10px",
    border: "1px solid #d1d5db", outline: "none",
    fontSize: "14px", fontFamily: "inherit", width: "100%",
    boxSizing: "border-box",
  },
  createTextarea: {
    padding: "10px 14px", borderRadius: "10px",
    border: "1px solid #d1d5db", outline: "none",
    fontSize: "14px", fontFamily: "inherit", width: "100%",
    boxSizing: "border-box", resize: "vertical",
    lineHeight: 1.5,
  },
  playlistDescriptionWrap: { position: "relative", marginBottom: "12px" },
  playlistAiButton: { position: "absolute", right: "10px", bottom: "12px", width: "34px", height: "34px", borderRadius: "9px", border: "1px solid #d1d5db", background: "#fff", color: "#e94560", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },
  playlistSuggestion: { margin: "-3px 0 12px", padding: "12px", borderRadius: "10px", background: "#fff5f6", border: "1px solid #fecdd3", color: "#374151", fontSize: "13px", lineHeight: 1.6, whiteSpace: "pre-wrap" },
  suggestionActions: { display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "10px" },
  createToggleRow: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    width: "100%", cursor: "pointer", marginTop: "4px",
  },
  createToggleText: { fontSize: "13px", color: "#374151", fontWeight: 500 },
  createToggleSwitch: {
    width: "40px", height: "22px", borderRadius: "11px",
    border: "none", background: "#d1d5db", padding: "2px",
    cursor: "pointer", position: "relative", transition: "background 0.2s",
  },
  createToggleSwitchOn: { background: "#e94560" },
  createToggleKnob: {
    width: "18px", height: "18px", borderRadius: "50%",
    background: "#ffffff", boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
    position: "absolute", top: "2px", left: "2px",
    transition: "transform 0.2s",
  },
  createToggleKnobOn: { transform: "translateX(18px)" },
  createActions: {
    display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: "4px",
  },
  confirmTitle: {
    fontSize: "20px", fontWeight: 700, color: "#1f2937",
    margin: 0, textAlign: "left",
  },
  confirmDivider: {
    height: "1px",
    background: "#e5e7eb",
    margin: "6px 0 4px",
    width: "100%",
  },
  confirmText: {
    fontSize: "14px", color: "#6b7280", textAlign: "left",
    margin: "6px 0 10px", lineHeight: 1.5,
  },
  confirmActions: {
    display: "flex", gap: "12px", marginTop: "4px", justifyContent: "flex-end",
  },
  confirmDeleteBtn: {
    padding: "10px 28px", borderRadius: "20px", border: "none",
    background: "#e94560", color: "#fff",
    fontSize: "14px", fontWeight: 600, cursor: "pointer",
    fontFamily: "inherit",
    transition: "all 0.2s",
  },
  playlistDialogActions: { display: "flex", gap: "10px", justifyContent: "flex-end", margin: "2px 64px 0 0" },
  confirmBtnDisabled: { opacity: 0.45, cursor: "not-allowed" },
  confirmCancelBtn: {
    padding: "10px 28px", borderRadius: "20px",
    border: "1px solid #d1d5db", background: "#ffffff",
    color: "#374151", fontSize: "14px", fontWeight: 500,
    cursor: "pointer", fontFamily: "inherit",
    transition: "all 0.2s",
  },

  // ---- 资料库-播放列表概览 ----
  playlistOverview: {
    display: "flex", gap: "16px", flexWrap: "wrap",
  },
  playlistCard: {
    display: "flex", alignItems: "center", gap: "12px",
    padding: "16px 20px", borderRadius: "12px",
    border: "1px solid #e5e7eb", background: "#ffffff",
    cursor: "pointer", minWidth: "200px",
    transition: "transform 0.2s, box-shadow 0.2s",
  },
  playlistCardIcon: { fontSize: "24px" },
  playlistCardName: {
    fontSize: "14px", fontWeight: 600, color: "#1f2937", flex: 1,
  },
  playlistCardCount: {
    fontSize: "12px", color: "#6b7280",
  },
};
