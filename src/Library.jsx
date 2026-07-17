import { useState, useRef, useEffect, useCallback } from "react";
import { FiPlus } from "react-icons/fi";
import { readMetadata } from "./MetadataReader";
import MusicPlayer from "./MusicPlayer";
import AlbumDetail from "./AlbumDetail";
import ArtistsDetail from "./ArtistsDetail";
import PlaylistDetail from "./PlaylistDetail";
import CoverPlayButton from "./CoverPlayButton";
import Sidebar from "./LibrarySidebar";
import "./music-library.css";

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

    // 读取所有文件的元数据
    const entries = await Promise.all(
      selectedFiles.map(async (f) => {
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
            coverURL: entry.coverURL,
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

                    // ---------- 导航切换 ----------
  function handleNavChange(val) {
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
      // 插播：将专辑所有歌曲插入到下一首
      const songs = album.songs.map(s => ({ ...s, albumId: album.id }));
      if (songs.length === 0) return;
      
      if (currentSong && !currentAlbumId && !currentPlaylistId && playQueue.length > 0) {
        // 正在播放队列歌曲，在下一首位置插入
        const insertAt = currentSongIndex + 1;
        setPlayQueue((prev) => {
          const newQueue = [...prev];
          newQueue.splice(insertAt, 0, ...songs);
          return newQueue;
        });
      } else {
        // 普通模式：插入到队列最前面
        setPlayQueue((prev) => [...songs, ...prev]);
      }
      // 如果当前没有在播放，直接播放第一首
      if (!currentSong) {
        setCurrentPlaylistId(null);
        setCurrentAlbumId(null);
        setPlayQueue(songs);
        setCurrentSongIndex(0);
        setIsPlaying(true);
      }
    } else if (action === "playLater") {
      // 稍后播放：追加到播放队列末尾
      const songs = album.songs.map(s => ({ ...s, albumId: album.id }));
      if (songs.length === 0) return;
      
      setPlayQueue((prev) => [...prev, ...songs]);
      // 如果当前没有在播放，直接播放第一首
      if (!currentSong) {
        setCurrentPlaylistId(null);
        setCurrentAlbumId(null);
        setPlayQueue(songs);
        setCurrentSongIndex(0);
        setIsPlaying(true);
      }
    } else if (action === "artist") {
      // 专辑艺人：跳转至艺人详情页
      handleOpenArtistDetail(album.artist || "未知艺术家");
    } else if (action === "delete") {
      // 删除：弹出警告弹窗
      setDeleteAlbumConfirm(album.id);
    }
  }

  function handleConfirmDeleteAlbum() {
    const albumId = deleteAlbumConfirm;
    if (!albumId) return;
    
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
  }

    function handleCancelDeleteAlbum() {
    setDeleteAlbumConfirm(null);
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

    if (action === "playNext") {
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
    const [songSortMode, setSongSortMode] = useState("album"); // "album" | "time" | "artist"

        // ---------- 歌曲多选状态 ----------
        const [selectedSongs, setSelectedSongs] = useState(new Set()); // 存储选中的歌曲key（"albumId-index"）
        const [isSelecting, setIsSelecting] = useState(false); // 是否处于多选模式
        const [showDeleteConfirm, setShowDeleteConfirm] = useState(false); // 是否显示删除确认浮窗

                // ---------- 单曲菜单状态 ----------
    const [contextMenu, setContextMenu] = useState(null); // { x, y, song } 或 null

                // ---------- 专辑操作菜单状态 ----------
        const [albumMenu, setAlbumMenu] = useState(null); // { x, y, album } 或 null
        const [deleteAlbumConfirm, setDeleteAlbumConfirm] = useState(null); // 要删除的专辑id或null

        // ---------- 播放列表操作菜单状态 ----------
        const [playlistMenu, setPlaylistMenu] = useState(null); // { x, y, playlist } 或 null
        const [deletePlaylistConfirm, setDeletePlaylistConfirm] = useState(null); // 要删除的播放列表id或null

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
    <div style={styles.container}>
            

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
                            />

              {/* 右侧主区域 */}
              <div style={styles.rightArea}>
                {/* 顶部功能条 */}
                <header style={styles.topBar}>
                  {/* 左侧：LOGO / 标题 */}
                  <div style={styles.logoArea}>
                    <span style={styles.logoIcon}>🎵</span>
                    <h1 style={styles.logoTitle}>音乐资料库</h1>
                  </div>

                  {/* 中间：搜索框 */}
                  <div style={styles.searchArea}>
                    <span style={styles.searchIcon}>🔍</span>
                    <input
                      style={styles.searchInput}
                      type="text"
                      placeholder="搜索专辑或艺人…"
                      value={filterText}
                      onChange={(e) => setFilterText(e.target.value)}
                    />
                    {filterText && (
                      <span
                        style={styles.clearBtn}
                        onClick={() => setFilterText("")}
                      >
                        ✕
                      </span>
                    )}
                  </div>

                  {/* 右侧：导入按钮 */}
                  <button
                    className="upload-btn"
                    style={styles.importBtn}
                    onClick={() => fileInputRef.current?.click()}
                    title="导入音乐"
                  >
                    <FiPlus size={18} />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*"
                    multiple
                    onChange={handleImportFiles}
                    style={{ display: "none" }}
                  />

                  {/* 专辑统计 */}
                  <span style={styles.stats}>
                    {albums.length} 个专辑
                  </span>
                </header>

                                {/* ============================================================ */}
                {/* ② 中间内容区 — 按导航切换视图                            */}
                {/* ============================================================ */}
                                {detailAlbumId ? (
                  /* ----- 专辑详情页（从专辑网格点进去） ----- */
                  <div style={styles.detailPageArea}>
                                        <AlbumDetail
                      album={albums.find((a) => a.id === detailAlbumId)}
                      currentSongIndex={
                        detailAlbumId === currentAlbumId ? currentSongIndex : -1
                      }
                      isPlaying={detailAlbumId === currentAlbumId && isPlaying}
                      onPlayAlbum={handlePlayAlbumFromDetail}
                      onPlaySong={handlePlaySongFromDetail}
                      onBack={handleCloseDetail}
                      onOpenArtist={handleOpenArtistDetail}
                    />
                  </div>
                ) : detailPlaylistId ? (
                  /* ----- 播放列表详情页（从侧边栏/资料库卡片点进去） ----- */
                  <div style={styles.detailPageArea}>
                    <PlaylistDetail
                      playlist={playlists.find((p) => p.id === detailPlaylistId)}
                      playlists={playlists}
                      onUpdatePlaylist={handleUpdatePlaylist}
                      currentSongIndex={
                        detailPlaylistId === currentPlaylistId ? currentSongIndex : -1
                      }
                      isPlaying={detailPlaylistId === currentPlaylistId && isPlaying}
                      onPlayAll={handlePlayAllFromPlaylist}
                      onPlaySong={handlePlaySongFromPlaylist}
                      onBack={handleClosePlaylistDetail}
                    />
                  </div>
                ) : activeNav === "albums" ? (
                  /* ================================================================ */
                  /* 专辑视图                                                         */
                  /* ================================================================ */
                                    <main style={styles.mainArea}>
                    <div style={styles.sortBar}>
                      <span style={styles.sortLabel}>分类：</span>
                      <button
                        style={{
                          ...styles.sortBtn,
                          ...(sortMode === "recent_add" ? styles.sortBtnActive : {}),
                        }}
                        onClick={() => setSortMode("recent_add")}
                      >
                        最近添加
                      </button>
                      <button
                        style={{
                          ...styles.sortBtn,
                          ...(sortMode === "new_to_old" ? styles.sortBtnActive : {}),
                        }}
                        onClick={() => setSortMode("new_to_old")}
                      >
                        从新到旧
                      </button>
                      <button
                        style={{
                          ...styles.sortBtn,
                          ...(sortMode === "old_to_new" ? styles.sortBtnActive : {}),
                        }}
                        onClick={() => setSortMode("old_to_new")}
                      >
                        从旧到新
                      </button>
                    </div>

                    {sortedAlbums.length === 0 ? (
                      <div style={styles.emptyState}>
                        <span style={styles.emptyIcon}>📀</span>
                        <p style={styles.emptyText}>还没有导入任何专辑</p>
                        <p style={styles.emptyHint}>点击右上角「导入音乐」按钮添加你的音乐文件</p>
                      </div>
                    ) : (
                      <div style={styles.albumGrid}>
                        {sortedAlbums.map((album) => {
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
                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handleAlbumMenuAction("playNext", albumMenu.album)}>
                            <span style={styles.contextMenuIcon}>⏭</span>
                            <span>插播</span>
                          </div>
                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handleAlbumMenuAction("playLater", albumMenu.album)}>
                            <span style={styles.contextMenuIcon}>📋</span>
                            <span>稍后播放</span>
                          </div>
                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handleAlbumMenuAction("artist", albumMenu.album)}>
                            <span style={styles.contextMenuIcon}>👤</span>
                            <span>专辑艺人</span>
                          </div>
                          <div style={styles.contextMenuDivider} />
                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handleAlbumMenuAction("delete", albumMenu.album)}>
                            <span style={styles.contextMenuIcon}>🗑️</span>
                            <span>删除</span>
                          </div>
                        </div>
                      </>
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
                            <button style={styles.confirmDeleteBtn} onClick={handleConfirmDeleteAlbum}>
                              确认删除
                            </button>
                            <button style={styles.confirmCancelBtn} onClick={handleCancelDeleteAlbum}>
                              取消
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </main>
                                ) : activeNav === "artists" && !detailArtistName ? (
                  /* ================================================================ */
                  /* 艺人视图（列表页）                                               */
                  /* ================================================================ */
                                    <main style={styles.mainArea}>
                    <div style={styles.sortBar}>
                      <span style={styles.sortLabel}>排序：</span>
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
                                        <span style={styles.sortLabel}>分类：</span>
                                        <button
                                          style={{
                                            ...styles.sortBtn,
                                            ...(songSortMode === "album" ? styles.sortBtnActive : {}),
                                          }}
                                          onClick={() => setSongSortMode("album")}
                                        >
                                          专辑
                                        </button>
                                        <button
                                          style={{
                                            ...styles.sortBtn,
                                            ...(songSortMode === "time" ? styles.sortBtnActive : {}),
                                          }}
                                          onClick={() => setSongSortMode("time")}
                                        >
                                          时间
                                        </button>
                                        <button
                                          style={{
                                            ...styles.sortBtn,
                                            ...(songSortMode === "artist" ? styles.sortBtnActive : {}),
                                          }}
                                          onClick={() => setSongSortMode("artist")}
                                        >
                                          艺人
                                        </button>
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
                      // 排序
                      const sortedSongs = [...allSongs].sort((a, b) => {
                        if (songSortMode === "time") {
                          // 按专辑年份降序，无年份排最后
                          const yearA = a.albumYear || 0;
                          const yearB = b.albumYear || 0;
                          return yearB - yearA;
                        }
                        if (songSortMode === "artist") {
                          // 按艺人名称排序
                          return (a.artist || "").localeCompare(b.artist || "", "zh-CN");
                        }
                        // "album" — 按专辑名排序
                        return (a.albumTitle || "").localeCompare(b.albumTitle || "", "zh-CN");
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
                            const songKey = getSongKey(song, idx);
                            const isChecked = selectedSongs.has(songKey);
                            return (
                                                            <div
                                key={`${song.albumId}-${idx}`}
                                className={`song-table-row${isActive ? " song-row-active" : ""}${isChecked ? " is-checked" : ""}`}
                                style={{
                                  ...styles.songTableRow,
                                  ...(isActive ? styles.songTableRowActive : {}),
                                  ...(isChecked ? styles.songTableRowChecked : {}),
                                }}
                                                                onClick={(e) => {
                                                                    if (isSelecting) {
                                                                      // 多选模式下，点击行切换复选框
                                                                      handleCheckboxChange(songKey, e);
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
                                                                      minWidth: 0,
                                                                    }}>
                                                                      {song.title}
                                                                    </span>
                                                                  </div>
                                                                </div>
                                <div style={styles.songColArtist}>
                                  <span style={styles.songCellText}>{song.artist || "未知"}</span>
                                </div>
                                <div style={styles.songColYear}>
                                  <span style={styles.songCellText}>{song.albumYear ? `${song.albumYear}年` : "—"}</span>
                                </div>
                                                                <div style={styles.songColAlbum}>
                                  <span style={styles.songCellText}>{song.albumTitle}</span>
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
                                    <span style={styles.songMenuDots}>···</span>
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
                            <span style={styles.contextMenuIcon}>💿</span>
                            <span>专辑</span>
                          </div>
                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handleContextMenuAction("artist", contextMenu.song)}>
                            <span style={styles.contextMenuIcon}>👤</span>
                            <span>艺人</span>
                          </div>
                          <div style={styles.contextMenuDivider} />
                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handleContextMenuAction("addToPlaylist", contextMenu.song)}>
                            <span style={styles.contextMenuIcon}>❤️</span>
                            <span>添加到播放列表</span>
                          </div>
                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handleContextMenuAction("playNext", contextMenu.song)}>
                            <span style={styles.contextMenuIcon}>⏭</span>
                            <span>插播</span>
                          </div>
                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handleContextMenuAction("playLater", contextMenu.song)}>
                            <span style={styles.contextMenuIcon}>📋</span>
                            <span>稍后播放</span>
                          </div>
                        </div>
                      </>
                    )}

                    {/* 删除确认浮窗 */}
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
                                ) : (
                                  /* ================================================================ */
                                  /* 资料库视图（默认）— 可排序的专辑卡片 + 播放列表卡片混合排列    */
                                  /* ================================================================ */
                                  <main style={styles.mainArea}>
                                    <div style={styles.sortBar}>
                                      <span style={styles.sortLabel}>排序：</span>
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
                                      <button
                                        style={{
                                          ...styles.sortBtn,
                                          ...(librarySortMode === "playlist" ? styles.sortBtnActive : {}),
                                        }}
                                        onClick={() => setLibrarySortMode("playlist")}
                                      >
                                        播放列表
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
                                                  {pl.id === "liked" ? "❤️" : pl.id === "recent" ? "🎧" : "📋"}
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
                                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handleAlbumMenuAction("playNext", albumMenu.album)}>
                                            <span style={styles.contextMenuIcon}>⏭</span>
                                            <span>插播</span>
                                          </div>
                                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handleAlbumMenuAction("playLater", albumMenu.album)}>
                                            <span style={styles.contextMenuIcon}>📋</span>
                                            <span>稍后播放</span>
                                          </div>
                                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handleAlbumMenuAction("artist", albumMenu.album)}>
                                            <span style={styles.contextMenuIcon}>👤</span>
                                            <span>专辑艺人</span>
                                          </div>
                                          <div style={styles.contextMenuDivider} />
                                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handleAlbumMenuAction("delete", albumMenu.album)}>
                                            <span style={styles.contextMenuIcon}>🗑️</span>
                                            <span>删除</span>
                                          </div>
                                        </div>
                                      </>
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
                                            <button style={styles.confirmDeleteBtn} onClick={handleConfirmDeleteAlbum}>
                                              确认删除
                                            </button>
                                            <button style={styles.confirmCancelBtn} onClick={handleCancelDeleteAlbum}>
                                              取消
                                            </button>
                                          </div>
                                        </div>
                                      </div>
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
                                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handlePlaylistMenuAction("playNext", playlistMenu.playlist)}>
                                            <span style={styles.contextMenuIcon}>⏭</span>
                                            <span>插播</span>
                                          </div>
                                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handlePlaylistMenuAction("playLater", playlistMenu.playlist)}>
                                            <span style={styles.contextMenuIcon}>📋</span>
                                            <span>稍后播放</span>
                                          </div>
                                          <div style={styles.contextMenuDivider} />
                                          <div className="context-menu-item" style={styles.contextMenuItem} onClick={() => handlePlaylistMenuAction("delete", playlistMenu.playlist)}>
                                            <span style={styles.contextMenuIcon}>🗑️</span>
                                            <span>删除</span>
                                          </div>
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

      {/* ============================================================ */}
      {/* ③ 播放控制器（底部播放条 + 播放详情页）                     */}
      {/* ============================================================ */}
                                                <MusicPlayer
        albums={albums}
        playlists={playlists}
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
      />
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
    marginLeft: "auto",
    transition: "transform 0.2s, box-shadow 0.2s",
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
