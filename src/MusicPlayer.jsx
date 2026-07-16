import { useState, useRef, useEffect } from "react";
import { FaChevronDown } from "react-icons/fa";
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
}) {
    const [showDetail, setShowDetail] = useState(false);
  const [lyricsData, setLyricsData] = useState(null); // { type: 'timed'|'plain', lines: [...] }
  const lrcInputRef = useRef(null);

    // 当前专辑 & 当前歌曲（支持专辑和播放列表两种来源）
    const currentAlbum = albums.find((a) => a.id === currentAlbumId) || null;
    const currentPlaylist = currentPlaylistId ? playlists.find((p) => p.id === currentPlaylistId) : null;
    // 源歌曲列表（不包含 queue）
    const sourceSongs = currentAlbum?.songs || currentPlaylist?.songs || [];
    // 完整歌曲列表 = 源列表 + 播放队列
    const allSongs = [...sourceSongs, ...playQueue];
    // 当前歌曲：先看 sourceSongs 范围内，再看 playQueue 范围内
    const currentSong = currentAlbum?.songs?.[currentSongIndex]
      || currentPlaylist?.songs?.[currentSongIndex]
      || playQueue[currentSongIndex - sourceSongs.length] || null;
    // 用于展示的专辑/播放列表信息（播放详情页使用）
    // 如果是播放队列单曲（currentAlbumId == null），从歌曲信息构造展示信息
    const displayAlbum = currentAlbum
      || (currentPlaylist ? {
        ...currentPlaylist,
        title: currentPlaylist.name,
        artist: "播放列表",
      } : null)
      || (playQueue.length > 0 && playQueue[0] ? (() => {
        const firstSong = playQueue[0];
        // 查找这首歌所属的专辑获取封面
        const foundAlbum = albums.find((a) =>
          a.songs.some((s) => s.url === firstSong.url || s.title === firstSong.title)
        );
        if (foundAlbum) {
          return {
            ...foundAlbum,
            title: "播放队列",
            artist: firstSong.artist || "未知艺术家",
          };
        }
        return {
          title: "播放队列",
          artist: firstSong.artist || "未知艺术家",
          coverURL: firstSong.coverURL || null,
        };
      })() : null);
  const queueCount = playQueue.length;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  // ---------- 格式化时间 ----------
  function formatTime(seconds) {
    if (isNaN(seconds)) return "00:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
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
    // 重置 input 以便重复选择同文件
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
      // 如果当前播放的是 queue 中的歌（索引 >= sourceSongs.length），播完后从 queue 中移除
      if (currentSongIndex >= sourceSongs.length && setPlayQueue) {
        // 当前是 queue 歌曲，播完后移除它
        const queueIdx = currentSongIndex - sourceSongs.length;
        setPlayQueue((prev) => prev.filter((_, i) => i !== queueIdx));
        // 移除后 nextIndex-1 对应原来 queue 中的下一首
        if (nextIndex - 1 < allSongs.length - 1) {
          setCurrentSongIndex(nextIndex);
        } else {
          // queue 中的歌全播完了
          if (sourceSongs.length > 0) {
            // 回到源列表最后一首的下一个（循环到开头）
            setCurrentSongIndex((currentSongIndex + 1) % sourceSongs.length);
          } else {
            setCurrentSongIndex(0);
          }
        }
      } else if (nextIndex < allSongs.length) {
        setCurrentSongIndex(nextIndex);
      } else {
        // 播完所有，回到开头
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
    // 用 ref 记录当前实际播放的歌曲 url，避免队列插入导致重新加载
    const prevSongUrlRef = useRef(null);
    useEffect(() => {
    if (!currentSong) return;
    // 如果歌曲 url 没变，说明只是队列变化，不需要重新加载
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
      {/* 底部播放控制条（已独立到 PlayerControls 组件）                    */}
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
            {/* 左侧：大方形封面 */}
            <div style={styles.detailCoverWrapper}>
              {displayAlbum.coverURL ? (
                <img src={displayAlbum.coverURL} alt={displayAlbum.title} style={styles.detailCover} />
              ) : (
                <div style={styles.detailCoverPlaceholder}>
                  <span style={styles.detailCoverPlaceholderIcon}>🎵</span>
                </div>
              )}
              <p style={styles.detailAlbumTitle}>{displayAlbum.title}</p>
              <p style={styles.detailAlbumArtist}>{displayAlbum.artist}</p>

                            {/* 专辑/播放列表 歌曲列表（含播放队列） */}
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
            </div>

                        {/* 右侧：歌词区域 */}
            <div style={styles.detailLyricsArea}>
              <div style={styles.detailLyricsHeader}>
                <span style={styles.detailLyricsTitle}>歌词</span>
                <span style={styles.detailNowPlayingName}>{currentSong.title}</span>
              </div>

              {/* 导入歌词按钮 */}
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
    justifyContent: "center", gap: "60px",
    padding: "80px 60px 120px", overflow: "hidden",
  },
  detailCoverWrapper: {
    flex: "0 0 380px", display: "flex",
    flexDirection: "column", alignItems: "center", gap: "16px",
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
  detailAlbumTitle: {
        fontSize: "22px", fontWeight: 700, color: "#1f2937",
    margin: 0, textAlign: "center",
  },
  detailAlbumArtist: {
    fontSize: "15px", color: "#6b7280", margin: 0, textAlign: "center",
  },
  detailSongList: {
    width: "100%", marginTop: "12px",
    maxHeight: "200px", overflowY: "auto",
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
  detailLyricsArea: {
    flex: 1, maxWidth: "520px", display: "flex",
    flexDirection: "column", height: "100%", minHeight: 0,
  },
  detailLyricsHeader: {
    marginBottom: "20px", paddingBottom: "16px",
    borderBottom: "1px solid #e5e7eb",
  },
  detailLyricsTitle: {
    fontSize: "12px", color: "#6b7280",
    letterSpacing: "3px", textTransform: "uppercase",
    display: "block", marginBottom: "6px",
  },
  detailNowPlayingName: { fontSize: "20px", fontWeight: 600, color: "#1f2937" },
  detailLyricsContent: {
    flex: 1, overflowY: "auto", paddingRight: "8px", lineHeight: 2,
  },
      lyricsLine: {
    fontSize: "15px", color: "#9ca3af", margin: 0, lineHeight: 1.8,
  },
  lyricsPlaceholder: {
    fontSize: "13px", color: "#6b7280", fontStyle: "italic",
    margin: 0, lineHeight: 2,
  },
  lyricsToolbar: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "16px",
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
