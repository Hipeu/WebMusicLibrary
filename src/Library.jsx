import { useState, useRef, useEffect, useCallback } from "react";
import { FiPlus } from "react-icons/fi";
import { readMetadata } from "./MetadataReader";
import MusicPlayer from "./MusicPlayer";
import AlbumDetail from "./AlbumDetail";
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

    // ---------- 侧边栏导航 ----------
    const [activeNav, setActiveNav] = useState("library");

    // ---------- 播放列表（与侧边栏共享） ----------
    const [playlists, setPlaylists] = useState([
    { id: "liked", name: "我喜欢的音乐", songs: [], description: "" },
    { id: "recent", name: "最近播放", songs: [], description: "最近播放的歌曲" },
  ]);

    // 当前专辑 & 当前歌曲
  const currentAlbum = albums.find((a) => a.id === currentAlbumId) || null;
  const currentSong = currentAlbum?.songs?.[currentSongIndex]
    || playlists.find((p) => p.id === currentPlaylistId)?.songs?.[currentSongIndex]
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

        // ---------- 导航切换 ----------
  function handleNavChange(val) {
        const isPlaylist = playlists.some((p) => p.id === val);
    if (isPlaylist) {
      // 点击播放列表 → 关闭专辑详情（如果有），打开播放列表详情
      setDetailAlbumId(null);
      handleOpenPlaylistDetail(val);
    } else {
      // 点击其他导航项 → 关闭播放列表详情（如果开着）和专辑详情
      setDetailPlaylistId(null);
      setDetailAlbumId(null);
    }
    setActiveNav(val);
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
                              <p style={styles.albumTitle}>{album.title}</p>
                              <p style={styles.albumArtist}>{album.artist}</p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </main>
                ) : activeNav === "artists" ? (
                  /* ================================================================ */
                  /* 艺人视图                                                         */
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
                              <div key={artist} style={styles.artistCard}>
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
                                ) : activeNav === "songs" ? (
                  /* ================================================================ */
                  /* 歌曲视图（平坦列表，显示所有专辑的所有歌曲）                   */
                  /* ================================================================ */
                  <main style={styles.mainArea}>
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
                        <div style={styles.songList}>
                          {sortedSongs.map((song, idx) => {
                            const isActive = currentAlbumId === song.albumId && currentSongIndex === albums.find((a) => a.id === song.albumId)?.songs.findIndex((s) => s.title === song.title && s.url === song.url);
                            return (
                              <div
                                key={`${song.albumId}-${idx}`}
                                style={{
                                  ...styles.songListItem,
                                  ...(isActive ? styles.songListItemActive : {}),
                                }}
                                                                onClick={() => {
                                  setCurrentPlaylistId(null); // 切换到专辑播放，清除播放列表来源
                                  setCurrentAlbumId(song.albumId);
                                  setCurrentSongIndex(albums.find((a) => a.id === song.albumId)?.songs.findIndex((s) => s.title === song.title && s.url === song.url) || 0);
                                  setIsPlaying(true);
                                }}
                              >
                                <span style={styles.songListIdx}>{String(idx + 1).padStart(2, "0")}</span>
                                <div style={styles.songListInfo}>
                                  <span style={styles.songListTitle}>{song.title}</span>
                                  <span style={styles.songListMeta}>{song.artist} · {song.albumTitle}</span>
                                </div>
                                {isActive && <span style={styles.songListPlaying}>▶</span>}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
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
                              <p style={styles.albumTitle}>{album.title}</p>
                              <p style={styles.albumArtist}>{album.artist}</p>
                            </div>
                          );
                        })}

                                                {/* 播放列表卡片 */}
                                                {playlists.map((pl) => (
                          <div
                            key={pl.id}
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
                            <p style={styles.albumTitle}>{pl.name}</p>
                            <p style={styles.albumArtist}>播放列表</p>
                          </div>
                        ))}
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
    margin: "10px 12px 2px", overflow: "hidden",
    textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  albumArtist: {
    fontSize: "12px", color: "#6b7280",
    margin: "0 12px 12px", overflow: "hidden",
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

  // ---- 歌曲列表视图 ----
  songList: {
    display: "flex", flexDirection: "column", gap: "2px",
  },
  songListItem: {
    display: "flex", alignItems: "center", gap: "12px",
    padding: "10px 14px", borderRadius: "8px",
    cursor: "pointer", transition: "background 0.15s",
  },
  songListItemActive: {
    background: "rgba(233,69,96,0.1)",
    border: "1px solid rgba(233,69,96,0.2)",
  },
  songListIdx: {
    fontSize: "12px", color: "#6b7280", fontVariantNumeric: "tabular-nums",
    minWidth: "24px", textAlign: "right", flexShrink: 0,
  },
  songListInfo: {
    flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", gap: "2px",
  },
  songListTitle: {
    fontSize: "14px", fontWeight: 500, color: "#1f2937",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  songListMeta: {
    fontSize: "12px", color: "#6b7280",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  songListPlaying: {
    fontSize: "12px", color: "#e94560", flexShrink: 0,
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
