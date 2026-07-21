import { useState, useRef, useEffect } from "react";
import { FaChevronDown, FaList, FaMusic, FaHeart, FaRegHeart, FaEllipsisH, FaInfoCircle, FaPlus, FaCompactDisc, FaUser, FaStepForward, FaRedo, FaRandom } from "react-icons/fa";
import Lyrics from "./Lyrics";
import { parseLRC } from "./LyricsParser";
import PlayerControls from "./PlayerControls";

/* ================================================================
   🎵 MusicPlayer — 播放控制器
   功能：底部播放条 + 全屏播放详情页
   通过 props 接收 Library 的状态和 setter 进行联动
   ================================================================ */
export default function MusicPlayer({
  albums,
  playlists,
  setPlaylists,
  currentAlbumId,
  currentPlaylistId,
  setCurrentAlbumId,
  currentSongIndex,
  setCurrentSongIndex,
  isPlaying,
  setIsPlaying,
  currentTime,
  setCurrentTime,
  duration,
  setDuration,
  volume,
  setVolume,
  audioRef,
  playQueue = [],
  setPlayQueue,
  onNavigateToAlbum,
  onNavigateToArtist,
  onNavigateToPlaylist,
}) {
    const [showDetail, setShowDetail] = useState(false);
  const [lyricsData, setLyricsData] = useState(null);
  const lrcInputRef = useRef(null);
  const [detailTab, setDetailTab] = useState("songs"); // "songs" | "lyrics"
  const [tabTransition, setTabTransition] = useState(false);
    const [isFavorited, setIsFavorited] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);
  const [playMode, setPlayMode] = useState("sequential"); // "sequential" | "loop" | "shuffle"
  const [showPlaylistPanel, setShowPlaylistPanel] = useState(false);
  const [playlistSearch, setPlaylistSearch] = useState("");

  // 当前专辑 & 当前歌曲
  const currentAlbum = albums.find((a) => a.id === currentAlbumId) || null;
  const currentPlaylist = currentPlaylistId ? playlists.find((p) => p.id === currentPlaylistId) : null;
  const sourceSongs = currentAlbum?.songs || currentPlaylist?.songs || [];
  const allSongs = [...sourceSongs, ...playQueue];
  const currentSong = currentAlbum?.songs?.[currentSongIndex]
    || currentPlaylist?.songs?.[currentSongIndex]
    || playQueue[currentSongIndex - sourceSongs.length] || null;
    const displayAlbum = currentSong ? (() => {
      // 1. 如果当前有专辑且在专辑歌曲范围内，用该专辑
      if (currentAlbum && currentSongIndex < (currentAlbum.songs?.length || 0)) {
        return currentAlbum;
      }
      // 2. 优先从专辑中查找当前歌曲的原专辑（覆盖播放列表场景）
      const foundAlbum = albums.find((a) =>
        a.songs.some((s) => s.url === currentSong.url || s.title === currentSong.title)
      );
      if (foundAlbum) {
        return foundAlbum;
      }
      // 3. 如果当前有播放列表且在列表歌曲范围内，用播放列表（保留歌曲自身封面）
      if (currentPlaylist && currentSongIndex < (currentPlaylist.songs?.length || 0)) {
        return {
          ...currentPlaylist,
          title: currentPlaylist.name,
          artist: "播放列表",
          coverURL: currentSong.coverURL || currentPlaylist.coverURL || null,
        };
      }
      // 4. 用歌曲自身信息
      return {
        title: currentSong.album || "未知专辑",
        artist: currentSong.artist || "未知艺术家",
        coverURL: currentSong.coverURL || null,
      };
    })() : null;
  const queueCount = playQueue.length;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  function formatTime(seconds) {
    if (isNaN(seconds)) return "00:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }

  // ---------- 切换 Tab（带动画） ----------
  function switchTab(tab) {
    if (tab === detailTab) return;
    setTabTransition(true);
    setTimeout(() => {
      setDetailTab(tab);
      setTabTransition(false);
    }, 200);
  }

  // ---------- 导入 LRC 歌词 ----------
  function handleImportLRC(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result;
      if (typeof text === "string") {
        const parsed = parseLRC(text);
        setLyricsData(parsed);
      }
    };
    reader.readAsText(file, "utf-8");
    e.target.value = "";
  }

  // ---------- 播放控制 ----------
  function togglePlay() {
    if (!audioRef.current || !currentSong) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
    setIsPlaying(!isPlaying);
  }

  function prevTrack() {
    if (allSongs.length === 0) return;
    const newIndex = (currentSongIndex - 1 + allSongs.length) % allSongs.length;
    setCurrentSongIndex(newIndex);
    setLyricsData(null);
    setIsPlaying(true);
  }

  function nextTrack() {
    if (allSongs.length === 0) return;
    const nextIndex = currentSongIndex + 1;
    if (currentSongIndex >= sourceSongs.length && setPlayQueue) {
      const queueIdx = currentSongIndex - sourceSongs.length;
      setPlayQueue((prev) => prev.filter((_, i) => i !== queueIdx));
      if (nextIndex - 1 < allSongs.length - 1) {
        setCurrentSongIndex(nextIndex);
      } else {
        if (sourceSongs.length > 0) {
          setCurrentSongIndex((currentSongIndex + 1) % sourceSongs.length);
        } else {
          setCurrentSongIndex(0);
        }
      }
    } else if (nextIndex < allSongs.length) {
      setCurrentSongIndex(nextIndex);
    } else {
      setCurrentSongIndex(0);
    }
    setLyricsData(null);
    setIsPlaying(true);
  }

  function handleSeek(e) {
    if (!audioRef.current || !currentSong) return;
    const newTime = (e.target.value / 100) * duration;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  }

  function handleVolumeChange(e) {
    const v = parseFloat(e.target.value);
    setVolume(v);
    if (audioRef.current) {
      audioRef.current.volume = v;
    }
  }

  // ---------- 音频事件 ----------
  function handleLoadedMetadata() {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
    audioRef.current?.play().catch(() => setIsPlaying(false));
  }

  function handleTimeUpdate() {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  }

  function handleEnded() {
    if (allSongs.length > 1) {
      nextTrack();
    } else {
      setIsPlaying(false);
      setCurrentTime(0);
    }
  }

    // 切换歌曲时重置 audio 并清空歌词
  const prevSongUrlRef = useRef(null);
  useEffect(() => {
    if (!currentSong) return;
    if (currentSong.url === prevSongUrlRef.current) return;
    prevSongUrlRef.current = currentSong.url;

    setLyricsData(null);
    if (audioRef.current) {
      audioRef.current.load();
      if (isPlaying) {
        audioRef.current.play().catch(() => setIsPlaying(false));
      }
    }

    // 自动添加到最近播放（最新在前）
    if (setPlaylists) {
      setPlaylists((prev) =>
        prev.map((pl) => {
          if (pl.id === "recent") {
            const filtered = pl.songs.filter((s) => s.url !== currentSong.url);
            return { ...pl, songs: [currentSong, ...filtered] };
          }
          return pl;
        })
      );
    }
  }, [currentAlbumId, currentPlaylistId, currentSongIndex, currentSong?.url]);

    // 点击菜单外关闭
  useEffect(() => {
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false);
      }
    }
    if (showMenu) {
      document.addEventListener("mousedown", handleClick);
    }
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMenu]);

  // 同步喜爱状态
  useEffect(() => {
    if (currentSong && playlists) {
      const likedPlaylist = playlists.find((p) => p.id === "liked");
      if (likedPlaylist) {
        setIsFavorited(likedPlaylist.songs.some((s) => s.url === currentSong.url));
      }
    }
  }, [currentSong?.url, playlists]);

  // 处理喜爱切换
  function handleToggleFavorite() {
    if (!currentSong || !setPlaylists) return;
    const likedPlaylist = playlists.find((p) => p.id === "liked");
    if (likedPlaylist) {
      const isLiked = likedPlaylist.songs.some((s) => s.url === currentSong.url);
      if (isLiked) {
        setPlaylists((prev) =>
          prev.map((pl) =>
            pl.id === "liked"
              ? { ...pl, songs: pl.songs.filter((s) => s.url !== currentSong.url) }
              : pl
          )
        );
      } else {
        setPlaylists((prev) =>
          prev.map((pl) =>
            pl.id === "liked"
              ? { ...pl, songs: [...pl.songs, currentSong] }
              : pl
          )
        );
      }
      setIsFavorited(!isLiked);
    }
  }

  // 添加到指定播放列表
  function handleAddToSpecificPlaylist(playlistId) {
    if (!currentSong || !setPlaylists) return;
    const targetPlaylist = playlists.find((p) => p.id === playlistId);
    if (targetPlaylist) {
      const isAlready = targetPlaylist.songs.some((s) => s.url === currentSong.url);
      if (!isAlready) {
        setPlaylists((prev) =>
          prev.map((pl) =>
            pl.id === playlistId
              ? { ...pl, songs: [...pl.songs, currentSong] }
              : pl
          )
        );
      }
    }
    setShowPlaylistPanel(false);
  }

  return (
    <>
      {/* ===== 隐藏的 audio 元素 ===== */}
      {currentSong && (
        <audio
          ref={audioRef}
          src={currentSong.url}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onEnded={handleEnded}
          autoPlay={isPlaying}
        />
      )}

      {/* ================================================================ */}
      {/* 底部播放控制条                                                  */}
      {/* ================================================================ */}
      <PlayerControls
        currentSong={currentSong}
        currentAlbum={displayAlbum}
        currentTime={currentTime}
        duration={duration}
        volume={volume}
        isPlaying={isPlaying}
        progress={progress}
        showDetail={showDetail}
        onTogglePlay={togglePlay}
        onPrevTrack={prevTrack}
        onNextTrack={nextTrack}
        onSeek={handleSeek}
        onVolumeChange={handleVolumeChange}
        onShowDetail={() => setShowDetail(true)}
        formatTime={formatTime}
      />

      {/* ================================================================ */}
      {/* 播放详情页 — 全屏弹窗                                           */}
      {/* ================================================================ */}
            {showDetail && displayAlbum && currentSong && (
              <div style={styles.detailOverlay}>
                <button className="detail-back-btn" style={styles.detailBackBtn} onClick={() => setShowDetail(false)}>
                  <FaChevronDown />
                </button>

                                                                <div style={styles.detailContent}>
                                  {/* ===== 左侧：封面 ===== */}
                                  <div style={styles.detailLeft}>
                                    <div style={styles.coverContainer}>
                                      {(displayAlbum.coverURL || currentSong?.coverURL) ? (
                                        <img src={displayAlbum.coverURL || currentSong?.coverURL} alt={displayAlbum.title} style={styles.detailCover} />
                                      ) : (
                                        <div style={styles.detailCoverPlaceholder}>
                                          <span style={styles.detailCoverPlaceholderIcon}>🎵</span>
                                        </div>
                                      )}
                                    </div>

                                    {/* 封面下方的操作按钮 */}
                                    <div style={styles.coverActions}>
                                                                            <button
                                        style={{
                                          ...styles.coverActionBtn,
                                          color: isFavorited ? "#e94560" : "#6b7280",
                                        }}
                                        onClick={handleToggleFavorite}
                                        title="喜爱"
                                      >
                                        {isFavorited ? <FaHeart size={18} /> : <FaRegHeart size={18} />}
                                      </button>
                                      <div style={{ position: "relative" }} ref={menuRef}>
                                        <button
                                          style={styles.coverActionBtn}
                                          onClick={() => setShowMenu(!showMenu)}
                                          title="更多"
                                        >
                                          <FaEllipsisH size={18} />
                                        </button>
                                                                                {showMenu && (
                                          <div style={styles.coverMenu}>
                                                                                        <button
                                              style={styles.coverMenuItem}
                                              onClick={() => { setShowMenu(false); setShowPlaylistPanel(true); }}
                                            >
                                              <FaPlus size={14} style={{ marginRight: "10px" }} />
                                              添加到播放列表
                                            </button>
                                            {currentPlaylist && (
                                              <button
                                                style={styles.coverMenuItem}
                                                onClick={() => {
                                                  setShowMenu(false);
                                                  setShowDetail(false);
                                                  onNavigateToPlaylist?.(currentPlaylist.id);
                                                }}
                                              >
                                                <FaList size={14} style={{ marginRight: "10px" }} />
                                                转至播放列表
                                              </button>
                                            )}
                                            <button
                                              style={styles.coverMenuItem}
                                              onClick={(e) => {
                                                setShowMenu(false);
                                                const found = albums.find((a) => a.title === displayAlbum?.title);
                                                if (onNavigateToAlbum && found?.id) {
                                                  setShowDetail(false);
                                                  onNavigateToAlbum(found.id);
                                                }
                                              }}
                                            >
                                              <FaCompactDisc size={14} style={{ marginRight: "10px" }} />
                                              转至专辑
                                            </button>
                                            <button
                                              style={styles.coverMenuItem}
                                              onClick={(e) => {
                                                setShowMenu(false);
                                                if (onNavigateToArtist && displayAlbum?.artist) {
                                                  setShowDetail(false);
                                                  onNavigateToArtist(displayAlbum.artist);
                                                }
                                              }}
                                            >
                                              <FaUser size={14} style={{ marginRight: "10px" }} />
                                              转至艺人
                                            </button>
                                            <button
                                              style={styles.coverMenuItem}
                                              onClick={() => { setShowMenu(false); }}
                                            >
                                              <FaInfoCircle size={14} style={{ marginRight: "10px" }} />
                                              详细信息
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                                                    {/* ===== 右侧：歌曲信息 + 功能区 + 胶囊 ===== */}
                                  <div style={styles.detailRight}>
                                    {/* 歌曲信息 */}
                                    <div style={styles.songInfoAside}>
                                      <p style={styles.detailNowPlayingName}>{currentSong.title}</p>
                                      <p
                                        style={styles.clickableLink}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (onNavigateToArtist && displayAlbum?.artist) {
                                            setShowDetail(false);
                                            onNavigateToArtist(displayAlbum.artist);
                                          }
                                        }}
                                      >
                                        {displayAlbum.artist}
                                      </p>
                                      <p
                                        style={styles.albumNameLink}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const found = albums.find((a) => a.title === displayAlbum?.title);
                                          if (onNavigateToAlbum && found?.id) {
                                            setShowDetail(false);
                                            onNavigateToAlbum(found.id);
                                          }
                                        }}
                                      >
                                        {displayAlbum.title}
                                      </p>
                                    </div>

                                    {/* 播放模式/工具栏（固定不滚动） */}
                                    {detailTab === "songs" && (
                                      <div style={styles.playModeBar}>
                                        <span style={styles.sourceLabel}>
                                          来自 {currentAlbum?.title || currentPlaylist?.name || "未知"}
                                        </span>
                                        <div style={{ flex: 1 }} />
                                        <button
                                          style={{
                                            ...styles.playModeBtn,
                                            ...(playMode === "sequential" ? styles.playModeBtnActive : {}),
                                          }}
                                          onClick={() => setPlayMode("sequential")}
                                          title="顺序播放"
                                        >
                                          <FaStepForward size={16} />
                                        </button>
                                        <button
                                          style={{
                                            ...styles.playModeBtn,
                                            ...(playMode === "loop" ? styles.playModeBtnActive : {}),
                                          }}
                                          onClick={() => setPlayMode("loop")}
                                          title="循环播放"
                                        >
                                          <FaRedo size={16} />
                                        </button>
                                        <button
                                          style={{
                                            ...styles.playModeBtn,
                                            ...(playMode === "shuffle" ? styles.playModeBtnActive : {}),
                                          }}
                                          onClick={() => setPlayMode("shuffle")}
                                          title="随机播放"
                                        >
                                          <FaRandom size={16} />
                                        </button>
                                      </div>
                                    )}
                                    {detailTab === "lyrics" && (
                                      <div style={styles.lyricsToolbar}>
                                        <button
                                          style={styles.importLrcBtn}
                                          onClick={() => lrcInputRef.current?.click()}
                                        >
                                          📄 导入歌词
                                        </button>
                                        <input
                                          ref={lrcInputRef}
                                          type="file"
                                          accept=".lrc,.txt"
                                          style={{ display: "none" }}
                                          onChange={handleImportLRC}
                                        />
                                      </div>
                                    )}

                                    {/* 可滚动的内容区 */}
                                    <div
                                      style={{
                                        ...styles.tabContentWrapper,
                                        opacity: tabTransition ? 0 : 1,
                                        transform: tabTransition ? "translateY(12px)" : "translateY(0)",
                                      }}
                                    >
                                      {detailTab === "songs" && (
                                        <div style={styles.detailSongList}>
                                          {allSongs.map((song, idx) => {
                                            const isQueueSong = idx >= sourceSongs.length;
                                            return (
                                              <div
                                                key={idx}
                                                className="detail-song-item"
                                                style={{
                                                  ...styles.detailSongItem,
                                                  ...(idx === currentSongIndex ? styles.detailSongItemActive : {}),
                                                  ...(isQueueSong ? styles.detailQueueSongItem : {}),
                                                }}
                                                onClick={() => { setCurrentSongIndex(idx); setIsPlaying(true); }}
                                              >
                                                <span style={styles.detailSongIdx}>{String(idx + 1).padStart(2, "0")}</span>
                                                <div style={{ flex: 1, overflow: "hidden" }}>
                                                  <p style={styles.detailSongName}>
                                                    {song.title}
                                                    {isQueueSong && <span style={styles.detailQueueTag}> 待播</span>}
                                                  </p>
                                                  <p style={styles.detailSongArtist}>{song.artist}</p>
                                                </div>
                                                {idx === currentSongIndex && (
                                                  <span style={styles.detailPlayingIndicator}>{isPlaying ? "▶" : "⏸"}</span>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}

                                      {detailTab === "lyrics" && (
                                        <div style={styles.detailLyricsArea}>
                                          <Lyrics
                                            lyricsData={lyricsData}
                                            currentTime={currentTime}
                                            onSeek={(time) => {
                                              if (audioRef.current) {
                                                audioRef.current.currentTime = time;
                                                setCurrentTime(time);
                                              }
                                            }}
                                          />
                                        </div>
                                      )}
                                    </div>

                                    {/* 底部胶囊 */}
                                    <div style={styles.capsuleOuterWrapper}>
                                      <div style={styles.capsuleOuter}>
                                        <button
                                          style={{
                                            ...styles.capsuleBtn,
                                            ...(detailTab === "songs" ? styles.capsuleBtnActive : {}),
                                          }}
                                          onClick={() => switchTab("songs")}
                                        >
                                          <FaList size={13} style={{ marginRight: "6px" }} />
                                          歌曲列表
                                        </button>
                                        <button
                                          style={{
                                            ...styles.capsuleBtn,
                                            ...(detailTab === "lyrics" ? styles.capsuleBtnActive : {}),
                                          }}
                                          onClick={() => switchTab("lyrics")}
                                        >
                                          <FaMusic size={13} style={{ marginRight: "6px" }} />
                                          歌词
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                                                </div>
        </div>
      )}

      {/* ===== 添加到播放列表浮窗 ===== */}
      {showPlaylistPanel && (
        <div style={styles.playlistPanelOverlay} onClick={() => setShowPlaylistPanel(false)}>
          <div style={styles.playlistPanel} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.playlistPanelTitle}>添加到播放列表</h3>
            <input
              style={styles.playlistPanelSearch}
              placeholder="搜索播放列表…"
              value={playlistSearch}
              onChange={(e) => setPlaylistSearch(e.target.value)}
              autoFocus
            />
            <div style={styles.playlistPanelList}>
              {(() => {
                const userPlaylists = playlists.filter((p) => p.id !== "recent");
                const searched = playlistSearch
                  ? userPlaylists.filter((p) => p.name.toLowerCase().includes(playlistSearch.toLowerCase()))
                  : userPlaylists;
                const sorted = [...searched].sort((a, b) => {
                  const aHas = a.songs.some((s) => s.url === currentSong?.url) ? 1 : 0;
                  const bHas = b.songs.some((s) => s.url === currentSong?.url) ? 1 : 0;
                  if (aHas !== bHas) return bHas - aHas;
                  return b.id.localeCompare(a.id);
                });
                return sorted.map((pl) => {
                  const isAlready = pl.songs.some((s) => s.url === currentSong?.url);
                  return (
                    <button
                      key={pl.id}
                      style={styles.playlistPanelItem}
                      onClick={() => handleAddToSpecificPlaylist(pl.id)}
                    >
                    <span style={styles.playlistPanelItemIcon}>{pl.id === "liked" ? <FaHeart size={16} /> : "📋"}</span>
                    <span style={styles.playlistPanelItemName}>{pl.name}</span>
                      {isAlready && <span style={styles.playlistPanelItemTag}>已添加</span>}
                      <span style={styles.playlistPanelItemCount}>{pl.songs.length} 首</span>
                    </button>
                  );
                });
              })()}
              {playlists.filter((p) => p.id !== "recent").length === 0 && (
                <p style={styles.playlistPanelEmpty}>暂无播放列表</p>
              )}
              {playlistSearch && playlists.filter((p) => p.id !== "recent").length > 0 && !playlists.some((p) => p.id !== "recent" && p.name.toLowerCase().includes(playlistSearch.toLowerCase())) && (
                <p style={styles.playlistPanelEmpty}>未找到匹配的播放列表</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ================================================================
   🎨 样式
   ================================================================ */
const styles = {
  // ===== 播放详情页样式 =====
  detailOverlay: {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 200,
    background: "#ffffff",
    display: "flex", flexDirection: "column",
    paddingBottom: 0, overflow: "hidden",
    animation: "fadeIn 0.3s ease",
  },
  detailBackBtn: {
    position: "absolute", top: "20px", left: "28px",
    background: "#f3f4f6",
    border: "1px solid #e5e7eb",
    color: "#374151", fontSize: "18px",
    width: "40px", height: "40px",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: 0, borderRadius: "50%", cursor: "pointer",
    zIndex: 210, transition: "background 0.2s, transform 0.15s",
  },
                                                                detailContent: {
    flex: 1,
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: "80px",
    padding: "60px 60px 100px",
    overflow: "hidden",
  },

    // ===== 左侧：封面 =====
  detailLeft: {
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "16px",
  },
  coverActions: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
  },
  coverActionBtn: {
    width: "44px",
    height: "44px",
    borderRadius: "50%",
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    transition: "all 0.2s",
    color: "#6b7280",
    boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
  },
    coverMenu: {
    position: "absolute",
    top: "50%",
    left: "calc(100% + 8px)",
    transform: "translateY(-50%)",
    background: "#ffffff",
    borderRadius: "12px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
    border: "1px solid #f3f4f6",
    padding: "6px 0",
    minWidth: "180px",
    zIndex: 500,
  },
  coverMenuItem: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    padding: "10px 18px",
    border: "none",
    background: "transparent",
    fontSize: "13px",
    color: "#374151",
    cursor: "pointer",
    transition: "background 0.15s",
    fontFamily: "inherit",
    textAlign: "left",
    gap: "2px",
  },

  // ===== 右侧：歌曲信息 + 功能区 + 胶囊 =====
  detailRight: {
    flex: 1,
    maxWidth: "520px",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    paddingTop: "8px",
  },
  songInfoAside: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    flexShrink: 0,
    marginBottom: "20px",
  },
    coverContainer: {
      position: "relative",
      width: "360px",
      height: "360px",
      borderRadius: "16px",
      overflow: "hidden",
      flexShrink: 0,
    },
    detailCover: {
      width: "360px", height: "360px", borderRadius: "16px",
      objectFit: "cover", display: "block",
      boxShadow: "0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(233,69,96,0.1)",
    },
    detailCoverPlaceholder: {
      width: "360px", height: "360px", borderRadius: "16px",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "#f3f4f6",
      boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
    },
    detailCoverPlaceholderIcon: { fontSize: "72px", opacity: 0.3 },

        // ===== 胶囊按钮（底部） =====
    capsuleOuterWrapper: {
    width: "100%",
    display: "flex",
    justifyContent: "center",
    paddingTop: "16px",
    flexShrink: 0,
  },
  capsuleOuter: {
    display: "flex",
    gap: "2px",
    padding: "4px",
    borderRadius: "28px",
    background: "rgba(0,0,0,0.08)",
    backdropFilter: "blur(4px)",
    WebkitBackdropFilter: "blur(4px)",
  },
  capsuleBtn: {
    display: "flex",
    alignItems: "center",
    padding: "8px 22px",
    borderRadius: "24px",
    border: "none",
    background: "transparent",
    color: "#6b7280",
    fontSize: "13px",
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.3s ease",
    fontFamily: "inherit",
    letterSpacing: "0.3px",
    whiteSpace: "nowrap",
  },
  capsuleBtnActive: {
    background: "#e94560",
    color: "#fff",
    boxShadow: "0 4px 16px rgba(233,69,96,0.4)",
  },

                // ===== 右侧 - 歌曲信息样式（并列于封面右侧） =====
  albumNameLink: {
    fontSize: "20px",
    color: "#e94560",
    margin: 0,
    cursor: "pointer",
    transition: "color 0.15s",
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  detailNowPlayingName: {
    fontSize: "30px", fontWeight: 700, color: "#1f2937",
    margin: 0,
  },
  clickableLink: {
    fontSize: "20px",
    color: "#e94560",
    margin: 0,
    cursor: "pointer",
    transition: "color 0.15s",
    fontWeight: 500,
  },

        // ===== 右侧内容包装 =====
    tabContentWrapper: {
    width: "100%",
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    transition: "opacity 0.25s ease, transform 0.25s ease",
    marginTop: "12px",
  },

        // ===== 右侧 - 播放模式栏（固定不滚动） =====
  playModeBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: "8px",
    flexShrink: 0,
  },
  sourceLabel: {
    fontSize: "12px",
    color: "#9ca3af",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "200px",
  },
  playModeBtn: {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    width: "34px",
    height: "34px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.2s",
    fontFamily: "inherit",
    borderRadius: "6px",
    color: "#9ca3af",
  },
  playModeBtnActive: {
    background: "#e94560",
    color: "#ffffff",
  },

    // ===== 右侧 - 歌曲列表 =====
        detailSongList: {
    width: "100%",
    minHeight: 0,
    paddingRight: "4px",
  },
  detailSongItem: {
    display: "flex", alignItems: "center", gap: "10px",
    padding: "8px 10px", borderRadius: "8px",
    cursor: "pointer", transition: "background 0.2s",
  },
  detailSongItemActive: {
    background: "rgba(233,69,96,0.15)",
    border: "1px solid rgba(233,69,96,0.3)",
  },
  detailSongIdx: {
    fontSize: "12px", color: "#6b7280",
    fontVariantNumeric: "tabular-nums",
    minWidth: "24px", textAlign: "right",
  },
  detailSongName: {
    fontSize: "13px", fontWeight: 500, color: "#1f2937",
    margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  detailSongArtist: {
    fontSize: "11px", color: "#6b7280",
    margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  detailPlayingIndicator: { fontSize: "14px", color: "#e94560", flexShrink: 0 },
  detailQueueSongItem: {
    opacity: 0.75,
    borderLeft: "3px solid #e94560",
  },
  detailQueueTag: {
    fontSize: "10px", color: "#e94560", fontWeight: 600, marginLeft: "4px",
  },

                // ===== 右侧 - 歌词区域 =====
    detailLyricsArea: {
      width: "100%",
      minHeight: 0,
      display: "flex",
      flexDirection: "column",
    },
    lyricsToolbar: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexShrink: 0,
  },
        importLrcBtn: {
    background: "rgba(233,69,96,0.15)",
    border: "1px solid rgba(233,69,96,0.3)",
    color: "#e94560",
    fontSize: "13px",
    fontWeight: 500,
    padding: "6px 16px",
    borderRadius: "20px",
    cursor: "pointer",
    transition: "background 0.2s",
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    fontFamily: "inherit",
  },

  // ===== 添加到播放列表浮窗 =====
  playlistPanelOverlay: {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
    background: "rgba(0,0,0,0.6)",
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backdropFilter: "blur(4px)",
  },
  playlistPanel: {
    width: "360px",
    maxHeight: "70vh",
    background: "#1a1a2e",
    borderRadius: "16px",
    padding: "24px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
    overflow: "hidden",
  },
  playlistPanelTitle: {
    fontSize: "18px",
    fontWeight: 700,
    color: "#ffffff",
    margin: 0,
  },
  playlistPanelSearch: {
    padding: "10px 14px",
    borderRadius: "10px",
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.08)",
    color: "#e0e0e0",
    fontSize: "14px",
    outline: "none",
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box",
  },
  playlistPanelList: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    overflowY: "auto",
    maxHeight: "60vh",
  },
  playlistPanelItem: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "12px 14px",
    border: "none",
    borderRadius: "10px",
    background: "rgba(255,255,255,0.06)",
    color: "#e0e0e0",
    fontSize: "14px",
    cursor: "pointer",
    transition: "background 0.2s",
    fontFamily: "inherit",
    textAlign: "left",
    width: "100%",
  },
  playlistPanelItemIcon: {
    fontSize: "18px",
    flexShrink: 0,
  },
  playlistPanelItemName: {
    flex: 1,
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  playlistPanelItemTag: {
    fontSize: "11px",
    color: "#10b981",
    fontWeight: 600,
    flexShrink: 0,
  },
  playlistPanelItemCount: {
    fontSize: "12px",
    color: "#9ca3af",
    flexShrink: 0,
  },
  playlistPanelEmpty: {
    color: "#6b7280",
    fontSize: "14px",
    textAlign: "center",
    padding: "24px 0",
    margin: 0,
  },
};