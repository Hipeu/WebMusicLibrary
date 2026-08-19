import { startTransition, useState, useRef, useEffect, useCallback } from "react";
import { FiPlus } from "react-icons/fi";
import { FaEllipsisH, FaCompactDisc, FaUser, FaHeart, FaStepForward, FaClock, FaPlus, FaArrowUp, FaTrash, FaMusic, FaInfoCircle, FaCog, FaPlay, FaExclamationCircle, FaCheckCircle, FaTimes, FaBell } from "react-icons/fa";
import { readMetadata } from "../utils/MetadataReader";
import { splitArtists, joinArtists, albumBelongsToArtist, collectAllArtists, isPrimaryAlbum } from "../utils/artistSplit";
import { uploadMusic, getMusicList, getAssetUrl, deleteMusic, checkMusicFiles, updateMusicMetadata, updateAlbumDescription, matchSong, getLyrics, getPlaylists, savePlaylists, resetAll, getResetProgress, openMusicFile, getArtists, saveArtist, deleteArtist, getMatchAllProgress, cancelMatchAll } from "../services/api";
import { saveSongToIndex, removeSongFromIndex, loadMusicIndex } from "../utils/musicIndex";
import { normalizePlaylists, loadPlaylistCache, savePlaylistCache } from "../utils/playlistStore";
import { isUnplayableCodec, songPlayable, isPlaceholderPublisher } from "../utils/formatCheck";
import { clearPlayCounts } from "../utils/playCount";
import MusicPlayer from "../components/MusicPlayer";
import AlbumDetail from "./AlbumDetail";
import ArtistsDetail from "./ArtistsDetail";
import PlaylistDetail from "./PlaylistDetail";
import ArtistEdit from "./ArtistEdit";
import { SearchResults } from "../components/Search";
import CoverPlayButton from "../components/CoverPlayButton";
import MusicEdit from "./MusicEdit";
import DetailErrorBoundary from "../components/DetailErrorBoundary";
import Sidebar from "../components/LibrarySidebar";
import Settings, { applyTheme } from "../components/Settings";
import MatchDetail from "../components/MatchDetail";
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
      if (songs.length === 0) continue;
      const firstSong = songs[0];
      const songTimes = songs.map((x) => x.importTime).filter(Boolean);
      loadedAlbums.push({
        id: albumId,
        title: albumEntry.album,
        artist: artistEntry.artist,
        album_artist: firstSong.album_artist || null,
        year: firstSong.year || null,
        genre: firstSong.genre || null,
        publisher: firstSong.publisher || null,
        // 专辑封面取第一首歌封面（回退专辑封面）
         coverURL: firstSong.coverURL || albumCover,
         description: albumEntry.description || "",
        // 专辑匹配状态：任一首已匹配即视为已匹配
        matched: songs.some((sg) => sg.matched),
        // 专辑导入时间 = 该专辑歌曲最早导入时间（保持「最近添加」排序稳定）
        importTime: songTimes.length ? Math.min(...songTimes) : Date.now(),
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
  // 兜底：过滤空专辑（防止残留空专辑卡片）
  return Array.from(merged.values()).filter((a) => a.songs.length > 0);
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
  const [volume, setVolume] = useState(1);
  const audioRef = useRef(null);
  const fileInputRef = useRef(null);
  const reimportInputRef = useRef(null);
  // ---------- 懒加载（无限滚动）：主内容区为滚动容器，初始 40 条 ----------
  const [visibleCount, setVisibleCount] = useState(40);
  const mainAreaRef = useRef(null);
  const sentinelRef = useRef(null);
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
  const [importRememberChoice, setImportRememberChoice] = useState(false); // 确认弹窗「后续都默认此操作」复选
  const importUnplayableChoiceRef = useRef(null); // 会话级记忆："continue" | "cancel" | null（刷新失效）
  const [importSkipDetail, setImportSkipDetail] = useState(null); // 导入结果详情 { duplicate, unplayable }
  const [unplayableDialogSong, setUnplayableDialogSong] = useState(null); // 播放被拦截的歌曲
  const [resetting, setResetting] = useState(false); // 是否正在重置资料库
  const [resetProgress, setResetProgress] = useState({ done: 0, total: 0 }); // 重置进度 { done, total }
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [newPlaylistCover, setNewPlaylistCover] = useState(null);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [newPlaylistDesc, setNewPlaylistDesc] = useState("");
  const [editingPlaylistId, setEditingPlaylistId] = useState(null); // null=新建，有值=编辑该播放列表
  const coverInputRef = useRef(null);
  const [panelTarget, setPanelTarget] = useState(null); // {type:"song",data} | {type:"album",data}
  const [panelSearch, setPanelSearch] = useState("");

        // ---------- 专辑详情页状态 ----------
  const [detailAlbumId, setDetailAlbumId] = useState(null);
  // 多层返回栈：记录每次进入详情页前的来源，返回时逐层恢复
  const [navStack, setNavStack] = useState([]);

        // ---------- 播放列表详情页状态 ----------
        const [detailPlaylistId, setDetailPlaylistId] = useState(null);
        const [currentPlaylistId, setCurrentPlaylistId] = useState(null);

        // ---------- 艺人详情页状态 ----------
        const [detailArtistName, setDetailArtistName] = useState(null);
  const [artistRecords, setArtistRecords] = useState({}); // { 艺人名: { cover_url, bio, genres } }
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

  // ---------- 播放列表操作 ----------
    function handleCreatePlaylist(newId) {
    setPlaylists((prev) => [
      ...prev,
      { id: newId, name: "新建播放列表", songs: [], description: "" },
    ]);
  }

  function handleCreatePlaylistWithDetails() {
    const newId = "pl_" + Date.now();
    const pl = {
      id: newId,
      name: newPlaylistName.trim() || "新建播放列表",
      songs: [],
      description: newPlaylistDesc.trim(),
    };
    if (newPlaylistCover) pl.coverURL = newPlaylistCover;
    setPlaylists((prev) => [...prev, pl]);
    setShowCreatePlaylist(false);
    setNewPlaylistCover(null);
    setNewPlaylistName("");
    setNewPlaylistDesc("");
  }

  // ---------- 打开新建播放列表弹窗（复位为新建模式） ----------
  function handleOpenCreatePlaylist() {
    setEditingPlaylistId(null);
    setNewPlaylistCover(null);
    setNewPlaylistName("");
    setNewPlaylistDesc("");
    setShowCreatePlaylist(true);
  }

  // ---------- 打开编辑播放列表弹窗（复用新建弹窗，预填当前内容） ----------
  function handleOpenPlaylistEdit(playlist) {
    if (!playlist) return;
    setNewPlaylistName(playlist.name || "");
    setNewPlaylistDesc(playlist.description || "");
    setNewPlaylistCover(playlist.coverURL || null);
    setEditingPlaylistId(playlist.id);
    setShowCreatePlaylist(true);
  }

  // ---------- 关闭弹窗（复位） ----------
  function handleCloseCreatePlaylist() {
    setShowCreatePlaylist(false);
    setEditingPlaylistId(null);
    setNewPlaylistCover(null);
    setNewPlaylistName("");
    setNewPlaylistDesc("");
  }

  // ---------- 弹窗提交：编辑则更新，新建则创建 ----------
  function handlePlaylistFormSubmit() {
    if (editingPlaylistId) {
      const target = playlists.find((p) => p.id === editingPlaylistId);
      if (target) {
        const updated = {
          ...target,
          name: newPlaylistName.trim() || target.name,
          description: newPlaylistDesc.trim(),
        };
        if (newPlaylistCover) updated.coverURL = newPlaylistCover;
        handleUpdatePlaylist(editingPlaylistId, updated);
      }
      handleCloseCreatePlaylist();
    } else {
      handleCreatePlaylistWithDetails();
    }
  }

  function handleDeletePlaylist(id) {
    setPlaylists((prev) => prev.filter((p) => p.id !== id));
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
    if (n.kind === "progress_import") {
      return (
        <div style={container} {...rest}>
          <p style={styles.importProgressTitle}>{n.title}</p>
          <div style={styles.importProgressRow}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
              <div style={styles.importProgressCover}>
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
    if (n.kind === "progress_update") {
      return (
        <div style={container} {...rest}>
          <p style={styles.importProgressTitle}>{n.title}</p>
          <div style={styles.importProgressRow}>
            <span style={styles.importProgressCount}>
              已更新：{n.progress?.done || 0}/{n.progress?.total || 0}
            </span>
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
    const { duplicate = [], unplayable = [], nonMusic = 0 } = opts;
    finishImport(entries);
    const hasDup = duplicate.length > 0;
    const hasUnplayable = unplayable.length > 0;
    const parts = [];
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

      // 确定比对目标 / 一致性类型
      let target;
      let replaceType = null; // "replace"（内容不一致，覆盖）| "new"（不同歌曲，仅新增）
      if (reimportTarget) {
        // 查找重导入：目标为指定的缺失歌曲
        if (metaKey === songDupKey(reimportTarget.title, reimportTarget.artist, reimportTarget.album)) {
          target = reimportTarget;
        } else {
          replaceType = "new";
        }
      } else {
        target = metaKey !== "||" ? existingByMeta.get(metaKey) : undefined;
      }

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
        kind: detailAlbumId ? "album" : detailPlaylistId ? "playlist" : detailArtistName ? "artist" : "nav",
        id: detailAlbumId || detailPlaylistId || null,
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
    if (frame.kind === "album") {
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
  function handlePlayAllFromPlaylist() {
    const pl = playlists.find((p) => p.id === detailPlaylistId);
    if (!pl || !pl.songs || pl.songs.length === 0) return;

    // 跳过不可播放歌曲，从第一首可播放的开始
    const firstPlayable = pl.songs.findIndex((s) => songPlayable(s));
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
          const res = await deleteMusic(s.artist, s.album, s.title, deleteToTrashEnabled());
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
        const res = await deleteMusic(deleteSongConfirm.artist, deleteSongConfirm.album, deleteSongConfirm.title, deleteToTrashEnabled());
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

  function handleConfirmDeleteAlbum() {
    const albumId = deleteAlbumConfirm;
    if (!albumId) return;

    const album = albums.find((a) => a.id === albumId);

    // 同步删除后端的专辑内所有歌曲（尽力而为）
    if (album) {
      const urls = new Set();
      const paths = new Set();
      for (const s of album.songs) {
        if (s.file_path) {
          removeSongFromIndex(s.file_path);
          paths.add(s.file_path);
        }
        if (s.url) urls.add(s.url);
        (async () => {
          try {
            const res = await deleteMusic(s.artist, s.album, s.title, deleteToTrashEnabled());
            if (res?.status === "error") showToast(res.msg || "删除失败", "warning");
          } catch (err) {
            console.warn("后端删除失败:", err);
          }
        })();
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

    function handleAlbumMatchError() {
      setEditTarget(null);
      showToast("专辑匹配失败，请稍后重试", "warning");
    }

    function handleAlbumMatchSaved(albumId, oldSong, updatedSong) {
      if (!oldSong?.file_path || !updatedSong?.file_path) return;
      removeSongFromIndex(oldSong.file_path);
      saveSongToIndex(buildIndexSong(oldSong, updatedSong));
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
      setPlaylists((prev) => {
        const idx = prev.findIndex((p) => p.id === playlist.id);
        if (idx <= 0) return prev;
        const arr = [...prev];
        const [item] = arr.splice(idx, 1);
        arr.splice(1, 0, item);
        return arr;
      });
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
    // 兜底：跳过空专辑
    if (!a.songs || a.songs.length === 0) return false;
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
    const savedTheme = localStorage.getItem("app-theme") || "system";
    applyTheme(savedTheme);

    // 跟随系统：监听系统主题变化并实时更新
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemThemeChange = () => {
      const current = localStorage.getItem("app-theme") || "system";
      if (current === "system") {
        applyTheme("system");
      }
    };
    mediaQuery.addEventListener("change", handleSystemThemeChange);
    return () => mediaQuery.removeEventListener("change", handleSystemThemeChange);
  }, []);

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
          setAlbums((prev) => mergeAlbumsByTitle(prev, serverAlbums));

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

  // ---------- 播放列表：后端合并（后端为准，空则用本地缓存做种子） ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const server = await getPlaylists();
        if (cancelled) return;
        if (Array.isArray(server) && server.length > 0) {
          // 后端有数据 → 以它为准，并同步本地缓存
           startTransition(() => setPlaylists(ensureDefaultPlaylists(server)));
          savePlaylistCache(server);
        } else {
          // 后端空 → 把本地缓存的播放列表推上去作为种子
          setPlaylists((prev) => {
            if (prev.length > 0) savePlaylists(normalizePlaylists(prev)).catch(() => {});
            return prev;
          });
        }
      } catch {
        // 后端不可用：保持本地缓存
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
    const t = setTimeout(() => {
      savePlaylistCache(playlists);
      savePlaylists(normalizePlaylists(playlists)).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [playlists]);

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
  const [playlistSortMode, setPlaylistSortMode] = useState("recent_add"); // "recent_add" | "recent_create" | "create_time" | "a-z"
  const [playlistTimeDir, setPlaylistTimeDir] = useState("desc"); // "desc" | "asc"
  const sortedPlaylists = [...playlists].sort((a, b) => {
    const getTime = (pl) => {
      const ts = parseInt(pl.id.replace("pl_", "")) || 0;
      return ts;
    };
    switch (playlistSortMode) {
      case "a-z":
        return a.name.localeCompare(b.name, "zh-CN");
      case "create_time": {
        const diff = getTime(a) - getTime(b);
        return playlistTimeDir === "desc" ? -diff : diff;
      }
      case "recent_create":
      case "recent_add":
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

        // ---------- 歌曲视图排序 ----------
    const [songFilters, setSongFilters] = useState(new Set(["recent_add"])); // 多选过滤标签
    const [songTimeDir, setSongTimeDir] = useState("desc"); // "desc" | "asc"
    const [albumFilters, setAlbumFilters] = useState(new Set(["recent_add"]));
    const [albumTimeDir, setAlbumTimeDir] = useState("desc");

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
                              onCreatePlaylist={handleCreatePlaylist}
                              onOpenPlaylistMenu={handleOpenPlaylistMenu}
                              onRenamePlaylist={handleRenamePlaylist}
                              filterText={filterText}
                              setFilterText={setFilterText}
                            />

              {/* 右侧主区域 */}
              <div style={styles.rightArea}>
                {/* 顶部功能条 */}
                <header style={styles.topBar} className="app-topbar">
                  {/* 左侧：LOGO / 标题 */}
                  <div style={styles.logoArea}>
                    <span style={styles.logoIcon}>🎵</span>
                    <h1 style={styles.logoTitle}>音乐资料库</h1>
                  </div>

                  {/* 右侧：导入按钮 + 设置按钮 */}
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginLeft: "auto" }}>
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
                            <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => { setShowImportMenu(false); fileInputRef.current?.click(); }}>
                              <FaMusic size={14} style={{ marginRight: "10px" }} />
                              <span>添加歌曲</span>
                            </div>
                            <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => { setShowImportMenu(false); handleOpenCreatePlaylist(); }}>
                              <FaPlus size={14} style={{ marginRight: "10px" }} />
                              <span>新建播放列表</span>
                            </div>
                          </div>
                        </>
                      )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="audio/*"
                      multiple
                      onChange={handleImportFiles}
                      style={{ display: "none" }}
                    />
                    <input
                      ref={coverInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (ev) => setNewPlaylistCover(ev.target.result);
                        reader.readAsDataURL(file);
                      }}
                    />
                  </div>
                  {/* 活动（铃铛）按钮 */}
                  <button
                    className="upload-btn"
                    style={{ ...styles.importBtn, position: "relative" }}
                    onClick={() => { setShowActivity(true); setUnreadCount(0); }}
                    title="活动"
                  >
                    <FaBell size={18} />
                    {unreadCount > 0 && (
                      <span style={styles.bellBadge}>{unreadCount}</span>
                    )}
                  </button>
                  {/* 设置按钮 */}
                  <button
                    className="upload-btn"
                    style={styles.importBtn}
                    onClick={() => setShowSettings(true)}
                    title="设置"
                  >
                    <FaCog size={18} />
                  </button>
                  </div>

                </header>

                                {/* ============================================================ */}
                {/* ② 中间内容区 — 按导航切换视图                            */}
                {/* ============================================================ */}
                                {detailAlbumId ? (
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
                      onOpenArtist={handleOpenArtistDetail}
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
                    />
                  </div>
                ) : activeNav === "search" ? (
                  /* ================================================================ */
                  /* 搜索结果页                                                        */
                  /* ================================================================ */
                  <main style={{ ...styles.mainArea, padding: "28px 32px", display: "flex", flexDirection: "column" }}>
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
                                  if (next.has(tag)) next.delete(tag); else next.add(tag);
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
                                                if (isTime) {
                                                  if (isActive) {
                                                    setSongTimeDir((d) => (d === "desc" ? "asc" : "desc"));
                                                  } else {
                                                    setSongFilters((prev) => new Set([...prev, tag]));
                                                  }
                                                } else {
                                                  setSongFilters((prev) => {
                                                    const next = new Set(prev);
                                                    if (next.has(tag)) next.delete(tag); else next.add(tag);
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
                                            onClick={() => setSongFilters(new Set(["recent_add"]))}
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
                           {sortedSongs.slice(0, visibleCount).map((song, idx) => {
                            const isActive = currentAlbumId === song.albumId && currentSongIndex === albums.find((a) => a.id === song.albumId)?.songs.findIndex((s) => s.title === song.title && s.url === song.url);
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
                                  <input
                                    type="checkbox"
                                    className="song-checkbox"
                                    style={styles.songCheckbox}
                                    checked={isChecked}
                                    onChange={(e) => handleCheckboxChange(songKey, e)}
                                    onClick={(e) => e.stopPropagation()}
                                  />
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
                        <div ref={sentinelRef} style={{ height: 1 }} />
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
                                      <span style={styles.sortLabel}>排序：</span>
                                      {[
                                        { id: "recent_add", label: "最近添加" },
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
                                          <div
                                            key={pl.id}
                                            className="album-card"
                                            style={styles.libraryCard}
                                            onClick={() => handleOpenPlaylistDetail(pl.id)}
                                          >
                                            <div style={styles.coverWrapper}>
                                              <div style={styles.playlistCoverPlaceholder}>
                                                {pl.id === "liked" ? "❤️" : pl.id === "recent" ? "🕐" : "📋"}
                                              </div>
                                              {pl.coverURL && (
                                                <img
                                                  src={pl.coverURL}
                                                  alt={pl.name}
                                                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                                                  style={{ ...styles.coverImage, position: "absolute", inset: 0 }}
                                                />
                                              )}
                                            </div>
                                            <div style={styles.albumTitleRow}>
                                              <p style={styles.albumTitle}>{pl.name}</p>
                                              <button
                                                className="album-menu-btn"
                                                style={styles.albumMenuBtnInline}
                                                onClick={(e) => handleOpenPlaylistMenu(e, pl)}
                                                title="更多操作"
                                              >
                                                <span style={styles.albumMenuDotsInline}>···</span>
                                              </button>
                                            </div>
                                            <p style={styles.albumArtist}>{pl.songs?.length || 0} 首歌曲</p>
                                          </div>
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

                                    {librarySortedAlbums.length === 0 && playlists.length === 0 ? (
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
                                                                {playlists.map((pl) => (
                                          <div
                                            key={pl.id}
                                            className="album-card"
                                            style={styles.libraryCard}
                                            onClick={() => handleOpenPlaylistDetail(pl.id)}
                                          >
                                            <div style={styles.coverWrapper}>
                                              <div style={styles.playlistCoverPlaceholder}>
                                                {pl.id === "liked" ? "❤️" : pl.id === "recent" ? "🕐" : "📋"}
                                              </div>
                                              {pl.coverURL && (
                                                <img
                                                  src={pl.coverURL}
                                                  alt={pl.name}
                                                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                                                  style={{ ...styles.coverImage, position: "absolute", inset: 0 }}
                                                />
                                              )}
                                            </div>
                                            <div style={styles.albumTitleRow}>
                                              <p style={styles.albumTitle}>{pl.name}</p>
                                              <button
                                                className="album-menu-btn"
                                                style={styles.albumMenuBtnInline}
                                                onClick={(e) => handleOpenPlaylistMenu(e, pl)}
                                                title="更多操作"
                                              >
                                                <span style={styles.albumMenuDotsInline}>···</span>
                                              </button>
                                            </div>
                                             <p style={styles.albumArtist}>播放列表</p>
                                           </div>
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
            <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handlePlaylistMenuAction("pin", playlistMenu.playlist)}>
              <FaArrowUp size={14} style={{ marginRight: "10px" }} />
              <span>置顶</span>
            </div>
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

      {/* ===== 新建 / 编辑播放列表对话框 ===== */}
      {showCreatePlaylist && (
        <div style={styles.overlay}>
          <div style={{ ...styles.createDialog, ...styles.confirmDialog }} className="create-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.createDialogTitle}>{editingPlaylistId ? "编辑播放列表" : "新建播放列表"}</h3>
            <div style={styles.createCoverSection}>
              {newPlaylistCover ? (
                <img src={newPlaylistCover} alt="封面" style={styles.createCover} />
              ) : (
                <div style={styles.createCoverPlaceholder} onClick={() => coverInputRef.current?.click()}>
                  <span style={{ fontSize: "32px", opacity: 0.3 }}>📋</span>
                  <span style={styles.createCoverHint}>点击设置封面</span>
                </div>
              )}
              {newPlaylistCover && (
                <button style={styles.createCoverChangeBtn} onClick={() => coverInputRef.current?.click()}>
                  更换封面
                </button>
              )}
            </div>
            <input
              style={styles.createInput}
              placeholder="播放列表名称"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              autoFocus
            />
            <textarea
              style={styles.createTextarea}
              placeholder="简介（可选）"
              value={newPlaylistDesc}
              onChange={(e) => setNewPlaylistDesc(e.target.value)}
              rows={3}
            />
            <div style={styles.createActions}>
              <button style={styles.confirmDeleteBtn} onClick={handlePlaylistFormSubmit}>
                {editingPlaylistId ? "保存" : "创建"}
              </button>
              <button style={styles.confirmCancelBtn} onClick={handleCloseCreatePlaylist}>
                取消
              </button>
            </div>
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
        <div style={styles.notifyStack}>
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

            if (n.kind === "progress_import" || n.kind === "progress_match" || n.kind === "progress_album_match" || n.kind === "progress_update") {
              return renderProgressCard(n, { key: n.id, style: anim, ...hoverProps });
            }

            // toast 类通知
            const isSuccess = n.kind === "success";
            const isInfo = n.kind === "info";
            return (
              <div
                key={n.id}
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
            style={{
              ...styles.activityBackdrop,
              ...(activityLeaving ? { animation: "fadeOutDim 0.28s ease forwards" } : { animation: "fadeInDim 0.28s ease" }),
            }}
            onClick={closeActivity}
          />
          <div
            style={{
              ...styles.activityPanel,
              ...(activityLeaving ? { animation: "slideOutPanelRight 0.28s ease forwards" } : { animation: "slideInPanelRight 0.28s ease" }),
            }}
          >
            <div style={styles.activityHeader}>
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
            <div style={styles.activityList}>
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
                  if (n.ongoing && (n.kind === "progress_import" || n.kind === "progress_match" || n.kind === "progress_album_match" || n.kind === "progress_update")) {
                    return renderProgressCard(n, { key: n.id, style: { width: "100%", maxWidth: "none" } });
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
                    <div key={n.id} style={styles.activityItem}>
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
    padding: "6px 10px", borderRadius: "8px",
    cursor: "pointer", transition: "background 0.15s",
  },
    songTableRowActive: {
    border: "1px solid rgba(233,69,96,0.2)",
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
  songCellTitleActive: { color: "#e94560", fontWeight: 600 },
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
  createDialogTitle: {
    fontSize: "20px", fontWeight: 700, color: "#1f2937",
    margin: 0, textAlign: "center",
  },
  createCoverSection: {
    display: "flex", flexDirection: "column", alignItems: "center", gap: "8px",
  },
  createCover: {
    width: "200px", height: "200px", borderRadius: "12px",
    objectFit: "cover", display: "block",
  },
  createCoverPlaceholder: {
    width: "200px", height: "200px", borderRadius: "12px",
    background: "#f3f4f6", display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", gap: "8px",
    cursor: "pointer", border: "2px dashed #d1d5db",
  },
  createCoverHint: {
    fontSize: "12px", color: "#9ca3af",
  },
  createCoverChangeBtn: {
    background: "none", border: "none", color: "#e94560",
    fontSize: "13px", fontWeight: 500, cursor: "pointer",
    fontFamily: "inherit",
  },
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
