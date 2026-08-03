import { useState, useRef, useEffect, useCallback } from "react";
import { FiPlus } from "react-icons/fi";
import { FaEllipsisH, FaCompactDisc, FaUser, FaHeart, FaStepForward, FaClock, FaPlus, FaSortAmountDown, FaArrowUp, FaTrash, FaMusic, FaInfoCircle, FaCog } from "react-icons/fa";
import { readMetadata } from "../utils/MetadataReader";
import { uploadMusic, getMusicList, getAssetUrl, deleteMusic, checkMusicFiles } from "../services/api";
import { saveSongToIndex, removeSongFromIndex, loadMusicIndex } from "../utils/musicIndex";
import MusicPlayer from "../components/MusicPlayer";
import AlbumDetail from "./AlbumDetail";
import ArtistsDetail from "./ArtistsDetail";
import PlaylistDetail from "./PlaylistDetail";
import { SearchResults } from "../components/Search";
import CoverPlayButton from "../components/CoverPlayButton";
import MusicEdit from "./MusicEdit";
import Sidebar from "../components/LibrarySidebar";
import Settings, { applyTheme } from "../components/Settings";
import "../styles/music-library.css";


/* ======================================================
   工具函数：专辑 / 歌曲构建与合并
   ====================================================== */
function buildAlbumsFromIndex(index) {
  const albumMap = new Map();
  Object.entries(index).forEach(([file_path, s]) => {
    const key = s.album || "未知专辑";
    // 规范化封面路径（兼容旧数据：可能缺少 picture/ 前缀）
    const coverPath = s.cover_path
      ? (s.cover_path.startsWith("picture/") ? s.cover_path : `picture/${s.cover_path}`)
      : null;
    if (!albumMap.has(key)) {
      albumMap.set(key, {
        id: `server-${s.artist || "未知艺术家"}-${key}`,
        title: key,
        artist: s.artist || "未知艺术家",
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
      album: s.album || key,
      genre: s.genre,
      duration: s.duration,
      url: getAssetUrl(`/library/${file_path}`),
      file_path,
      coverURL: coverPath ? getAssetUrl(`/data/${coverPath}`) : null,
      trackNo: s.trackNo,
      composer: s.composer,
      lyricist: s.lyricist,
      publisher: s.publisher,
      comment: s.comment,
      bitrate: s.bitrate,
      codec: s.codec,
      year: s.year,
      importTime: s.importTime || Date.now(),
    });
  });
  return Array.from(albumMap.values());
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
        genre: s.genre,
        duration: s.duration,
        url: getAssetUrl(s.file_url),
        file_path: s.file_path,
        coverURL: getAssetUrl(s.cover_url) || albumCover,
        trackNo: s.trackNo,
        composer: s.composer,
        lyricist: s.lyricist,
        publisher: s.publisher,
        comment: s.comment,
        bitrate: s.bitrate,
        codec: s.codec,
        year: s.year,
        importTime: Date.now(),
      }));
      if (songs.length === 0) continue;
      loadedAlbums.push({
        id: albumId,
        title: albumEntry.album,
        artist: artistEntry.artist,
        year: songs[0].year || null,
        genre: songs[0].genre || null,
        publisher: songs[0].publisher || null,
        coverURL: albumCover,
        importTime: Date.now(),
        songs,
      });
    }
  }
  return loadedAlbums;
}

function mergeAlbumsByTitle(prev, newAlbums) {
  const merged = new Map();
  for (const a of prev) merged.set(a.title, { ...a, songs: [...a.songs] });
  for (const a of newAlbums) {
    if (merged.has(a.title)) {
      const existing = merged.get(a.title);
      const existingPaths = new Set(existing.songs.map((s) => s.file_path).filter(Boolean));
      for (const s of a.songs) {
        if (!s.file_path || !existingPaths.has(s.file_path)) {
          existing.songs.push(s);
        }
      }
      if (!existing.coverURL && a.coverURL) existing.coverURL = a.coverURL;
    } else {
      merged.set(a.title, { ...a, songs: [...a.songs] });
    }
  }
  return Array.from(merged.values());
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
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [newPlaylistCover, setNewPlaylistCover] = useState(null);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [newPlaylistDesc, setNewPlaylistDesc] = useState("");
  const coverInputRef = useRef(null);
  const [panelTarget, setPanelTarget] = useState(null); // {type:"song",data} | {type:"album",data}
  const [panelSearch, setPanelSearch] = useState("");

        // ---------- 专辑详情页状态 ----------
  const [detailAlbumId, setDetailAlbumId] = useState(null);

        // ---------- 播放列表详情页状态 ----------
        const [detailPlaylistId, setDetailPlaylistId] = useState(null);
        const [currentPlaylistId, setCurrentPlaylistId] = useState(null);

        // ---------- 艺人详情页状态 ----------
        const [detailArtistName, setDetailArtistName] = useState(null);

    // ---------- 侧边栏导航 ----------
    const [activeNav, setActiveNav] = useState("library");

    // ---------- 播放列表（与侧边栏共享） ----------
    const [playlists, setPlaylists] = useState([
    { id: "liked", name: "我喜欢的音乐", songs: [], description: "" },
    { id: "recent", name: "最近播放", songs: [], description: "最近播放的歌曲" },
  ]);

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

  // ---------- 导入音频文件 ----------
  async function handleImportFiles(e) {
    const selectedFiles = Array.from(e.target.files);
    if (selectedFiles.length === 0) return;

    // 读取所有文件的元数据（优先上传到后端持久化，失败则回退本地导入）
    const entries = await Promise.all(
      selectedFiles.map(async (f) => {
        try {
          const res = await uploadMusic(f);
          if (res.status === "ok") {
            const m = res.meta || {};
            const entry = {
              title: res.title,
              artist: res.artist || "未知艺术家",
              album: res.album || "未知专辑",
              year: m.year || null,
              genre: m.genre || null,
              duration: m.duration || null,
              url: getAssetUrl(res.file_path ? `/library/${res.file_path}` : null),
              file_path: res.file_path || null,
              coverURL: res.cover_url ? getAssetUrl(res.cover_url) : null,
              cover_path: (m && m.cover_path) || null,
              trackNo: m.trackNo || null,
              composer: m.composer || null,
              lyricist: m.lyricist || null,
              publisher: m.publisher || null,
              comment: m.comment || null,
              bitrate: m.bitrate || null,
              codec: m.codec || null,
              container: m.codec || null,
              importTime: Date.now(),
            };
            // 写入本地索引，保证服务未启动时也能展示
            saveSongToIndex(entry);
            return entry;
          }
        } catch (err) {
          console.warn("后端上传失败，使用本地导入:", err);
        }
        // 后端不可用 → 本地导入（blob URL）
        const meta = await readMetadata(f);
        return {
          ...meta,
          url: URL.createObjectURL(f),
        };
      })
    );

    // 按专辑名分组
    const albumMap = new Map();
    for (const entry of entries) {
      const key = entry.album || "未知专辑";
      if (!albumMap.has(key)) {
        albumMap.set(key, {
                        id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
            title: key,
            artist: entry.artist || "未知艺术家",
            year: entry.year || null,
            genre: entry.genre || null,
            publisher: entry.publisher || null,
            coverURL: entry.coverURL,
            importTime: Date.now(),
            songs: [],
          });
      }
            const album = albumMap.get(key);
      album.songs.push({
        title: entry.title,
        artist: entry.artist,
        album: entry.album,
        genre: entry.genre,
        duration: entry.duration,
        url: entry.url,
        coverURL: entry.coverURL,
        trackNo: entry.trackNo,
        composer: entry.composer,
        lyricist: entry.lyricist,
        publisher: entry.publisher,
        comment: entry.comment,
        bitrate: entry.bitrate,
        codec: entry.codec,
        container: entry.container,
        creationTime: entry.creationTime,
        modificationTime: entry.modificationTime,
        importTime: entry.importTime,
      });
      // 如果封面还没设置，用第一首歌的封面
      if (!album.coverURL && entry.coverURL) {
        album.coverURL = entry.coverURL;
      }
      // 如果流派还没设置，用第一首歌的流派
      if (!album.genre && entry.genre) {
        album.genre = entry.genre;
      }
    }

    const newAlbums = Array.from(albumMap.values());

        setAlbums((prev) => {
      // 合并到已有专辑中（按专辑名匹配）
      const merged = new Map();
      for (const a of prev) {
        merged.set(a.title, { ...a, songs: [...a.songs] });
      }
      for (const a of newAlbums) {
        if (merged.has(a.title)) {
          const existing = merged.get(a.title);
          // 合并歌曲，去重
          const existingUrls = new Set(existing.songs.map((s) => s.url));
          for (const s of a.songs) {
            if (!existingUrls.has(s.url)) {
              existing.songs.push(s);
            }
          }
          // 补全封面：已有专辑没有封面时用新专辑的
          if (!existing.coverURL && a.coverURL) {
            existing.coverURL = a.coverURL;
          }
          // 补全年份：已有专辑没有年份时用新专辑的
          if (!existing.year && a.year) {
            existing.year = a.year;
          }
                    // 补全艺人：已有专辑是未知时用新专辑的
          if ((existing.artist === "未知艺术家" || !existing.artist) && a.artist && a.artist !== "未知艺术家") {
            existing.artist = a.artist;
          }
          // 补全流派：已有专辑没有流派时用新专辑的
          if (!existing.genre && a.genre) {
            existing.genre = a.genre;
          }
        } else {
          merged.set(a.title, { ...a, songs: [...a.songs] });
        }
      }
      return Array.from(merged.values());
    });
  }

        // ---------- 点击专辑卡片 — 打开专辑详情页 ----------
    function handleOpenAlbumDetail(albumId) {
      setDetailAlbumId(albumId);
      setDetailArtistName(null);
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
        setCurrentAlbumId(albumId);
        setCurrentSongIndex(0);
        setIsPlaying(true);
      }
    }

    // ---------- 从详情页播放整个专辑 ----------
  function handlePlayAlbumFromDetail() {
    const album = albums.find((a) => a.id === detailAlbumId);
    if (!album || album.songs.length === 0) return;

    if (currentAlbumId === detailAlbumId) {
      // 同一专辑：切换播放/暂停
      togglePlay();
    } else {
      setCurrentPlaylistId(null); // 切换到专辑播放，清除播放列表来源
      setCurrentAlbumId(detailAlbumId);
      setCurrentSongIndex(0);
      setIsPlaying(true);
    }
  }

  // ---------- 从详情页选择歌曲播放 ----------
  function handlePlaySongFromDetail(songIndex) {
    setCurrentPlaylistId(null); // 切换到专辑播放，清除播放列表来源
    setCurrentAlbumId(detailAlbumId);
    setCurrentSongIndex(songIndex);
    setIsPlaying(true);
  }

    // ---------- 关闭详情页 ----------
  function handleCloseDetail() {
    setDetailAlbumId(null);
  }

  // ---------- 打开播放列表详情 ----------
  function handleOpenPlaylistDetail(playlistId) {
    setDetailPlaylistId(playlistId);
  }

    // ---------- 关闭播放列表详情 ----------
    function handleClosePlaylistDetail() {
      setDetailPlaylistId(null);
    }

        // ---------- 点击艺人卡片 / 专辑详情页艺人链接 — 打开艺人详情页 ----------
    function handleOpenArtistDetail(artistName) {
      setDetailAlbumId(null); // 关闭专辑详情页（如果是从专辑详情页跳转来的）
      setDetailPlaylistId(null); // 关闭播放列表详情页
      setDetailArtistName(artistName);
      setActiveNav("artists");
    }

        // ---------- 关闭艺人详情页 ----------
    function handleCloseArtistDetail() {
      setDetailArtistName(null);
    }

    // ---------- 从艺人详情页点击专辑卡片 — 打开专辑详情页 ----------
    function handleOpenAlbumFromArtist(albumId) {
      setDetailAlbumId(albumId);
      // 关闭艺人详情页，进入专辑详情页
      setDetailArtistName(null);
    }

    // ---------- 从艺人详情页播放专辑 ----------
    function handlePlayAlbumFromArtist(albumId) {
      const album = albums.find((a) => a.id === albumId);
      if (!album || album.songs.length === 0) return;

      if (currentAlbumId === albumId) {
        togglePlay();
      } else {
        setCurrentPlaylistId(null);
        setCurrentAlbumId(albumId);
        setCurrentSongIndex(0);
        setIsPlaying(true);
      }
    }

    // ---------- 从艺人详情页选择歌曲播放 ----------
    function handlePlaySongFromArtist(albumId, songIndex) {
      setCurrentPlaylistId(null);
      setCurrentAlbumId(albumId);
      setCurrentSongIndex(songIndex);
      setIsPlaying(true);
    }

    // ---------- 从搜索结果页选择歌曲播放 ----------
    function handlePlaySongFromSearch(albumId, songIndex) {
      setCurrentPlaylistId(null);
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

    if (currentPlaylistId === detailPlaylistId) {
      togglePlay();
    } else {
      setCurrentAlbumId(null); // 切换到播放列表播放，清除专辑来源
      setCurrentPlaylistId(detailPlaylistId);
      setCurrentSongIndex(0);
      setIsPlaying(true);
    }
  }

  // ---------- 从播放列表详情选择歌曲播放 ----------
  function handlePlaySongFromPlaylist(songIndex) {
    setCurrentAlbumId(null); // 切换到播放列表播放，清除专辑来源
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
  function getSongKey(song, idx) {
    return `${song.albumId}-${idx}`;
  }

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

    // 删除选中的歌曲
    setAlbums((prev) => {
      return prev.map((album) => {
        const updatedSongs = album.songs.filter((song, idx) => {
          const key = `${album.id}-${idx}`;
          return !selectedSongs.has(key);
        });
        return { ...album, songs: updatedSongs };
      });
    });

        // 如果当前播放的歌曲被删除了，停止播放
    if (currentDeleted) {
      setIsPlaying(false);
    }
    handleCancelSelect();
  }

  function handleConfirmDeleteSong() {
    if (!deleteSongConfirm) return;
    const albumId = deleteSongConfirm.albumId;
    const album = albums.find((a) => a.id === albumId);
    const isLastSong = album && album.songs.length <= 1;

    // 同步删除后端文件（尽力而为，失败不阻塞）
    try {
      deleteMusic(deleteSongConfirm.artist, deleteSongConfirm.album, deleteSongConfirm.title);
    } catch (err) {
      console.warn("后端删除失败:", err);
    }
    // 从本地索引移除
    if (deleteSongConfirm.file_path) {
      removeSongFromIndex(deleteSongConfirm.file_path);
    }

    // 如果是最后一首歌 → 整张专辑删除
    if (isLastSong) {
      if (currentAlbumId === albumId) {
        setIsPlaying(false);
        setCurrentAlbumId(null);
      }
      setPlayQueue((prev) => prev.filter(s => s.albumId !== albumId));
      setAlbums((prev) => prev.filter(a => a.id !== albumId));
      setDetailAlbumId((prev) => prev === albumId ? null : prev);
    } else {
      setAlbums((prev) =>
        prev.map((a) => {
          if (a.id === albumId) {
            return { ...a, songs: a.songs.filter((s) => s.url !== deleteSongConfirm.url) };
          }
          return a;
        })
      );
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
      setDetailAlbumId(song.albumId);
      setDetailArtistName(null);
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
      for (const s of album.songs) {
        try {
          deleteMusic(s.artist, s.album, s.title);
        } catch (err) {
          console.warn("后端删除失败:", err);
        }
        if (s.file_path) {
          removeSongFromIndex(s.file_path);
        }
      }
    }

    // 如果正在播放该专辑，停止播放
    if (currentAlbumId === albumId) {
      setIsPlaying(false);
      setCurrentAlbumId(null);
    }
    // 从播放队列中移除该专辑的歌曲
    setPlayQueue((prev) => prev.filter(s => s.albumId !== albumId));
    // 删除专辑
    setAlbums((prev) => prev.filter(a => a.id !== albumId));
    setDeleteAlbumConfirm(null);
    setDetailAlbumId((prev) => prev === albumId ? null : prev);
  }

    function handleCancelDeleteAlbum() {
    setDeleteAlbumConfirm(null);
  }

    // ---------- 编辑元信息 ----------
    function handleOpenMusicEdit(target) {
      setEditTarget(target);
    }

    function handleSaveEdit(target, form, editCover) {
      if (target.type === "album") {
        setAlbums((prev) =>
          prev.map((a) =>
            a.id === target.data.id
              ? { ...a, title: form.title, artist: form.artist, year: form.year ? parseInt(form.year) : null, genre: form.genre, publisher: form.publisher, ...(editCover ? { coverURL: editCover } : {}) }
              : a
          )
        );
      } else if (target.type === "song") {
        setAlbums((prev) =>
          prev.map((a) => ({
            ...a,
            songs: a.songs.map((s) =>
              s.url === target.data.url && a.id === target.data.albumId
                ? { ...s, title: form.title, artist: form.artist, album: form.album, genre: form.genre, trackNo: form.trackNo, composer: form.composer, lyricist: form.lyricist, publisher: form.publisher, comment: form.comment, ...(editCover ? { coverURL: editCover } : {}) }
                : s
            ),
          }))
        );
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
      setAlbums((prev) => mergeAlbumsByTitle(prev, idxAlbums));
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

  // ---------- 定期检测缺失的音乐文件（用户可能在资源管理器删除） ----------
  useEffect(() => {
    let timer;
    async function checkMissing() {
      // 收集所有带 file_path 的歌曲
      const paths = [];
      const seen = new Set();
      albums.forEach((a) =>
        a.songs.forEach((s) => {
          if (s.file_path && !seen.has(s.file_path)) {
            seen.add(s.file_path);
            paths.push(s.file_path);
          }
        })
      );
      if (paths.length === 0) return;
      try {
        const res = await checkMusicFiles(paths);
        const missing = new Set();
        Object.entries(res.exists || {}).forEach(([p, exists]) => {
          if (!exists) missing.add(p);
        });
        setMissingSongs(missing);
      } catch (err) {
        // 后端不可用时不标记缺失
        console.warn("文件存在性检测失败:", err);
      }
    }
    checkMissing();
    timer = setInterval(checkMissing, 10000);
    return () => clearInterval(timer);
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
        // 按 id（含时间戳）降序，最新的在前
        return b.id.localeCompare(a.id);
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
        const [missingSongs, setMissingSongs] = useState(new Set()); // 缺失歌曲的 file_path 集合
        const [missingDialogSong, setMissingDialogSong] = useState(null); // 点击缺失歌曲时弹出的提示
        // 判断专辑是否全部缺失
        const isAlbumAllMissing = (album) =>
          (album?.songs || []).length > 0 &&
          album.songs.every((s) => s.file_path && missingSongs.has(s.file_path));

    // ---------- 艺人视图排序 ----------
    const [artistSortMode, setArtistSortMode] = useState("a-z"); // "a-z" | "z-a"

    // ---------- 专辑视图排序 ----------
    const [sortMode, setSortMode] = useState("recent_add"); // "recent_add" | "new_to_old" | "old_to_new"

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
    // "recent_add" — 按 id（含时间戳）降序，最新的在前
    return b.id.localeCompare(a.id);
  });

      // ---------- 渲染 ----------
  return (
    <div style={styles.container} className="app-root">
            

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
                              onDeletePlaylist={handleDeletePlaylist}
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
                            <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => { setShowImportMenu(false); setShowCreatePlaylist(true); }}>
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
                    />
                  </div>
                ) : detailPlaylistId ? (
                  /* ----- 播放列表详情页（从侧边栏/资料库卡片点进去） ----- */
                  <div style={styles.detailPageArea}>
                    <PlaylistDetail
                      playlist={playlists.find((p) => p.id === detailPlaylistId)}
                      playlists={playlists}
                      onUpdatePlaylist={handleUpdatePlaylist}
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
                      onPlaySong={handlePlaySongFromSearch}
                      onOpenAlbum={(id) => { setDetailAlbumId(id); setDetailPlaylistId(null); setDetailArtistName(null); }}
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
                                    <main style={styles.mainArea}>
                    <div style={styles.sortBar}>
                      {["recent_add", "favorite", "time"].map((tag) => {
                        const label = tag === "recent_add" ? "最近添加" : tag === "favorite" ? "已喜爱" : "时间";
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
                      <div style={styles.albumGrid}>
                        {sorted.map((album) => {
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
                                {album.coverURL ? (
                                  <img src={album.coverURL} alt={album.title} style={styles.coverImage} />
                                ) : (
                                  <div style={styles.coverPlaceholder}>
                                    <span style={styles.coverPlaceholderIcon}>🎶</span>
                                  </div>
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
                          const uniqueArtists = Array.from(new Set(albums.map((a) => a.artist)));
                          return [...uniqueArtists].sort((a, b) => {
                            if (artistSortMode === "z-a") {
                              return b.localeCompare(a, "zh-CN");
                            }
                            return a.localeCompare(b, "zh-CN");
                          }).map((artist) => {
                            const artistAlbums = albums.filter((a) => a.artist === artist);
                            return (
                              <div key={artist} style={styles.artistCard} onClick={() => handleOpenArtistDetail(artist)}>
                                <div style={styles.artistAvatar}>
                                  <span style={styles.artistAvatarIcon}>👤</span>
                                </div>
                                <p style={styles.artistName}>{artist}</p>
                                <p style={styles.artistAlbumCount}>{artistAlbums.length} 个专辑</p>
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
                      albums={albums.filter((a) => a.artist === detailArtistName)}
                      currentAlbumId={currentAlbumId}
                      currentSongIndex={currentSongIndex}
                      isPlaying={isPlaying}
                      onPlayAlbum={handlePlayAlbumFromArtist}
                      onPlaySong={handlePlaySongFromArtist}
                      onBack={handleCloseArtistDetail}
                      onOpenAlbum={handleOpenAlbumFromArtist}
                    />
                  </div>
                                ) : activeNav === "songs" ? (
                                  /* ================================================================ */
                                  /* 歌曲视图（平坦列表，显示所有专辑的所有歌曲）                   */
                                  /* ================================================================ */
                                                                                                                                        <main style={styles.mainArea} className={isSelecting ? "multi-select-active" : ""}>
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
                                        {["recent_add", "favorite", "album", "time"].map((tag) => {
                                          const label = tag === "recent_add" ? "最近添加" : tag === "favorite" ? "已喜爱" : tag === "album" ? "专辑" : "时间";
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
                           {sortedSongs.map((song, idx) => {
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
                                                                    <div style={styles.songCoverThumb}>
                                                                      {(() => {
                                                                        const album = albums.find((a) => a.id === song.albumId);
                                                                        return album?.coverURL ? (
                                                                          <img src={album.coverURL} alt="" style={styles.songCoverThumbImg} />
                                                                        ) : (
                                                                          <span style={styles.songCoverThumbPlaceholder}>🎶</span>
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
                                            );
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
                          <div style={styles.confirmIcon}>⚠️</div>
                          <h3 style={styles.confirmTitle}>确认删除</h3>
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
                                              {pl.coverURL ? (
                                                <img src={pl.coverURL} alt={pl.name} style={styles.coverImage} />
                                              ) : (
                                                <div style={styles.playlistCoverPlaceholder}>
                                                  {pl.id === "liked" ? "❤️" : pl.id === "recent" ? "🕐" : "📋"}
                                                </div>
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
                                  <main style={styles.mainArea}>
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
                                      <div style={styles.libraryGrid}>
                                        {/* 专辑卡片 */}
                                        {librarySortedAlbums.map((album) => {
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
                                                {album.coverURL ? (
                                                  <img src={album.coverURL} alt={album.title} style={styles.coverImage} />
                                                ) : (
                                                  <div style={styles.coverPlaceholder}>
                                                    <span style={styles.coverPlaceholderIcon}>🎶</span>
                                                  </div>
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
                                              {pl.coverURL ? (
                                                <img src={pl.coverURL} alt={pl.name} style={styles.coverImage} />
                                              ) : (
                                                <div style={styles.playlistCoverPlaceholder}>
                                                  {pl.id === "liked" ? "❤️" : pl.id === "recent" ? "🕐" : "📋"}
                                                </div>
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



                                    {/* 播放列表操作菜单 */}
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
                                          {playlistMenu.playlist.id !== "liked" && playlistMenu.playlist.id !== "recent" && (
                                            <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handlePlaylistMenuAction("delete", playlistMenu.playlist)}>
                                              <FaTrash size={14} style={{ marginRight: "10px" }} />
                                              <span>删除</span>
                                            </div>
                                          )}
                                        </div>
                                      </>
                                    )}

                                    {/* 播放列表删除确认浮窗 */}
                                    {deletePlaylistConfirm && (
                                      <div style={styles.overlay} onClick={handleCancelDeletePlaylist}>
                                        <div style={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
                                          <div style={styles.confirmIcon}>⚠️</div>
                                          <h3 style={styles.confirmTitle}>确认删除</h3>
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
                  </main>
                )}
              </div>
            </div>

      {/* ===== 新建播放列表对话框 ===== */}
      {showCreatePlaylist && (
        <div style={styles.overlay} onClick={() => setShowCreatePlaylist(false)}>
          <div style={{ ...styles.createDialog, ...styles.confirmDialog }} className="create-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.createDialogTitle}>新建播放列表</h3>
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
              <button style={styles.confirmDeleteBtn} onClick={handleCreatePlaylistWithDetails}>
                创建
              </button>
              <button style={styles.confirmCancelBtn} onClick={() => setShowCreatePlaylist(false)}>
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
        onNavigateToAlbum={(albumId) => {
          setDetailAlbumId(albumId);
          setDetailArtistName(null);
        }}
        onNavigateToArtist={(artistName) => {
          setDetailAlbumId(null);
          setDetailPlaylistId(null);
          setDetailArtistName(artistName);
          setActiveNav("artists");
        }}
        onNavigateToPlaylist={(playlistId) => {
          setDetailAlbumId(null);
          setDetailArtistName(null);
          handleOpenPlaylistDetail(playlistId);
        }}
      />

      <MusicEdit
        target={editTarget}
        onClose={() => setEditTarget(null)}
        onSave={handleSaveEdit}
      />

      <Settings show={showSettings} onClose={() => setShowSettings(false)} />

      {/* 缺失文件提示浮窗 */}
      {missingDialogSong && (
        <div style={styles.overlay} onClick={() => setMissingDialogSong(null)}>
          <div style={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
            <div style={styles.confirmIcon}>⚠️</div>
            <h3 style={styles.confirmTitle}>项目不可用</h3>
            <p style={styles.confirmText}>该歌曲已经被删除或移动至其他地方，是否要查找这首音乐？</p>
            <div style={styles.confirmActions}>
              <button style={styles.confirmDeleteBtn} onClick={() => setMissingDialogSong(null)}>查找</button>
              <button style={styles.confirmCancelBtn} onClick={() => setMissingDialogSong(null)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 单曲删除确认浮窗 */}
      {deleteSongConfirm && (
        <div style={styles.overlay} onClick={() => setDeleteSongConfirm(null)}>
          <div style={styles.confirmDialog} onClick={(e) => e.stopPropagation()}>
            <div style={styles.confirmIcon}>⚠️</div>
            <h3 style={styles.confirmTitle}>确认删除</h3>
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
            <div style={styles.confirmIcon}>⚠️</div>
            <h3 style={styles.confirmTitle}>确认删除</h3>
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
    width: "80px", height: "80px", borderRadius: "50%",
    background: "#f3f4f6", display: "flex",
    alignItems: "center", justifyContent: "center",
    fontSize: "36px",
  },
  artistAvatarIcon: { opacity: 0.5 },
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
  songCellTextMissing: { color: "#9ca3af", textDecoration: "line-through" },
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
  confirmDialog: {
    width: "380px", padding: "32px", borderRadius: "16px",
    background: "#ffffff", boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
    display: "flex", flexDirection: "column", alignItems: "center",
    gap: "12px",
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
  confirmIcon: {
    fontSize: "48px",
  },
  confirmTitle: {
    fontSize: "20px", fontWeight: 700, color: "#1f2937",
    margin: 0,
  },
  confirmText: {
    fontSize: "14px", color: "#6b7280", textAlign: "center",
    margin: "4px 0 8px", lineHeight: 1.5,
  },
  confirmActions: {
    display: "flex", gap: "12px", marginTop: "4px",
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
