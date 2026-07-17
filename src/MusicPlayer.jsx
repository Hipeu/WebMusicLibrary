import { useState, useRef, useEffect } from "react";
import { FaChevronDown, FaList, FaMusic } from "react-icons/fa";
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
}) {
  const [showDetail, setShowDetail] = useState(false);
  const [lyricsData, setLyricsData] = useState(null);
  const lrcInputRef = useRef(null);
  const [detailTab, setDetailTab] = useState("songs"); // "songs" | "lyrics"
  const [tabTransition, setTabTransition] = useState(false);

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
      // 2. 如果当前有播放列表且在列表歌曲范围内，用播放列表
      if (currentPlaylist && currentSongIndex < (currentPlaylist.songs?.length || 0)) {
        return {
          ...currentPlaylist,
          title: currentPlaylist.name,
          artist: "播放列表",
        };
      }
      // 3. 从所有专辑中查找当前歌曲所属的专辑
      const foundAlbum = albums.find((a) =>
        a.songs.some((s) => s.url === currentSong.url || s.title === currentSong.title)
      );
      if (foundAlbum) {
        return foundAlbum;
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
  }, [currentAlbumId, currentPlaylistId, currentSongIndex, currentSong?.url]);

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
                      {/* ===== 左侧：封面 + 歌曲信息 ===== */}
                      <div style={styles.leftPanel}>
                        {/* 封面图片容器 */}
                        <div style={styles.coverContainer}>
                          {displayAlbum.coverURL ? (
                            <img src={displayAlbum.coverURL} alt={displayAlbum.title} style={styles.detailCover} />
                          ) : (
                            <div style={styles.detailCoverPlaceholder}>
                              <span style={styles.detailCoverPlaceholderIcon}>🎵</span>
                            </div>
                          )}
                        </div>

                                                {/* 歌曲信息 */}
                        <div style={styles.songInfoArea}>
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
                            style={styles.clickableLink}
                            onClick={(e) => {
                              e.stopPropagation();
                              // 从所有专辑中查找匹配的专辑
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
                      </div>

                                            {/* ===== 右侧：胶囊按钮 + 功能区域 ===== */}
                      <div style={styles.rightPanel}>
                        {/* 胶囊按钮 — 在功能区域上方 */}
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

                        {/* 过渡动画包装器 */}
                        <div
                          style={{
                            ...styles.tabContentWrapper,
                            opacity: tabTransition ? 0 : 1,
                            transform: tabTransition ? "translateY(12px)" : "translateY(0)",
                          }}
                        >
                          {/* ----- 歌曲列表 Tab ----- */}
                          {detailTab === "songs" && (
                            <div style={styles.detailSongList}>
                              <p style={styles.detailSongListLabel}>
                                歌曲列表{playQueue.length > 0 ? ` (+${playQueue.length} 待播)` : ""}
                              </p>
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

                          {/* ----- 歌词 Tab ----- */}
                          {detailTab === "lyrics" && (
                            <div style={styles.detailLyricsArea}>
                              {/* 导入歌词工具栏 */}
                              <div style={styles.lyricsToolbar}>
                                <button
                                  style={styles.importLrcBtn}
                                  onClick={() => lrcInputRef.current?.click()}
                                >
                                  📄 导入歌词
                                </button>
                                {lyricsData?.type === "timed" && (
                                  <span style={styles.lyricsBadge}>⏱ 时间轴</span>
                                )}
                                {lyricsData?.type === "plain" && (
                                  <span style={styles.lyricsBadge}>📝 纯文本</span>
                                )}
                                <input
                                  ref={lrcInputRef}
                                  type="file"
                                  accept=".lrc,.txt"
                                  style={{ display: "none" }}
                                  onChange={handleImportLRC}
                                />
                              </div>

                              {/* 歌词内容 */}
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
    flex: 1, display: "flex", alignItems: "center",
    justifyContent: "center", gap: "100px",
    padding: "80px 60px 120px", overflow: "hidden",
  },

    // ===== 左右分栏布局 =====
  leftPanel: {
    flex: "0 0 380px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "20px",
  },
  rightPanel: {
    flex: 1,
    maxWidth: "520px",
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
    paddingTop: "20px",
  },
  coverContainer: {
    position: "relative",
    width: "380px",
    height: "380px",
    borderRadius: "16px",
    overflow: "hidden",
    flexShrink: 0,
  },
  detailCover: {
    width: "380px", height: "380px", borderRadius: "16px",
    objectFit: "cover", display: "block",
    boxShadow: "0 20px 60px rgba(0,0,0,0.5), 0 0 40px rgba(233,69,96,0.1)",
  },
  detailCoverPlaceholder: {
    width: "380px", height: "380px", borderRadius: "16px",
    display: "flex", alignItems: "center", justifyContent: "center",
    background: "#f3f4f6",
    boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
  },
  detailCoverPlaceholderIcon: { fontSize: "80px", opacity: 0.3 },

    // ===== 胶囊按钮（外层包裹） =====
  capsuleOuterWrapper: {
    width: "100%",
    display: "flex",
    justifyContent: "center",
    marginBottom: "50px",
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

  // ===== 左侧歌曲信息 =====
  songInfoArea: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "6px",
    textAlign: "center",
    width: "100%",
  },
    detailNowPlayingName: {
    fontSize: "20px", fontWeight: 700, color: "#1f2937",
    margin: 0, textAlign: "center",
  },
    clickableLink: {
    fontSize: "14px",
    color: "#e94560",
    margin: 0,
    textAlign: "center",
    cursor: "pointer",
    transition: "color 0.15s",
    fontWeight: 500,
  },

  // ===== 右侧内容包装 =====
    tabContentWrapper: {
    width: "100%",
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
    transition: "opacity 0.25s ease, transform 0.25s ease",
  },

    // ===== 右侧 - 歌曲列表 =====
    detailSongList: {
    width: "100%",
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    paddingRight: "4px",
  },
  detailSongListLabel: {
    fontSize: "11px", color: "#6b7280",
    letterSpacing: "2px", textTransform: "uppercase",
    marginBottom: "8px", paddingLeft: "4px",
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
      flex: 1,
      minHeight: 0,
      maxHeight: "430px",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    },
  lyricsToolbar: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "12px",
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
  lyricsBadge: {
    fontSize: "11px",
    color: "#6b7280",
    background: "#f3f4f6",
    padding: "3px 10px",
    borderRadius: "12px",
    border: "1px solid #e5e7eb",
  },
};