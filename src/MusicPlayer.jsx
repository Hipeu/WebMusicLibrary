import { useState, useRef, useEffect } from "react";
import { FaChevronDown } from "react-icons/fa";
import Lyrics from "./Lyrics";
import { parseLRC } from "./LyricsParser";

/* ================================================================
   🎵 MusicPlayer — 播放控制器
   功能：底部播放条 + 全屏播放详情页
   通过 props 接收 Library 的状态和 setter 进行联动
   ================================================================ */
export default function MusicPlayer({
  albums,
  currentAlbumId,
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
}) {
    const [showDetail, setShowDetail] = useState(false);
  const [lyricsData, setLyricsData] = useState(null); // { type: 'timed'|'plain', lines: [...] }
  const lrcInputRef = useRef(null);

  // 当前专辑 & 当前歌曲
  const currentAlbum = albums.find((a) => a.id === currentAlbumId) || null;
  const currentSong = currentAlbum?.songs?.[currentSongIndex] || null;
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
    if (!currentAlbum || currentAlbum.songs.length === 0) return;
    const newIndex =
      (currentSongIndex - 1 + currentAlbum.songs.length) %
      currentAlbum.songs.length;
    setCurrentSongIndex(newIndex);
    setLyricsData(null); // 切歌清空歌词
    setIsPlaying(true);
  }

  function nextTrack() {
    if (!currentAlbum || currentAlbum.songs.length === 0) return;
    const newIndex = (currentSongIndex + 1) % currentAlbum.songs.length;
    setCurrentSongIndex(newIndex);
    setLyricsData(null); // 切歌清空歌词
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
    if (currentAlbum && currentAlbum.songs.length > 1) {
      nextTrack();
    } else {
      setIsPlaying(false);
      setCurrentTime(0);
    }
  }

    // 切换歌曲时重置 audio 并清空歌词
  useEffect(() => {
    setLyricsData(null);
    if (audioRef.current && currentSong) {
      audioRef.current.load();
      if (isPlaying) {
        audioRef.current.play().catch(() => setIsPlaying(false));
      }
    }
  }, [currentAlbumId, currentSongIndex]);

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
      {/* 底部播放控制条                                                   */}
      {/* ================================================================ */}
      <footer style={styles.bottomBar}>
        {/* 进度条 */}
        <div style={styles.progressWrapper}>
          <input
            type="range"
            min="0"
            max="100"
            step="0.1"
            value={progress}
            onChange={handleSeek}
            style={{
              ...styles.progressBar,
              background: `linear-gradient(to right, #e94560 ${progress}%, #d1d5db ${progress}%)`,
            }}
          />
        </div>

        <div style={styles.controlsRow}>
          {/* 左侧：小封面（详情页隐藏）+ 歌曲信息 */}
          <div
            style={styles.nowPlayingLeft}
            onClick={() => currentSong && setShowDetail(true)}
            title={currentSong ? "点击查看播放详情" : ""}
          >
            {!showDetail && currentSong && currentAlbum && (
              <div style={styles.miniCoverWrapper}>
                {currentAlbum.coverURL ? (
                  <img
                    src={currentAlbum.coverURL}
                    alt={currentAlbum.title}
                    style={styles.miniCover}
                  />
                ) : (
                  <div style={styles.miniCoverPlaceholder}>
                    <span style={styles.miniCoverIcon}>🎵</span>
                  </div>
                )}
              </div>
            )}
            <div style={styles.nowPlayingInfo}>
              {currentSong ? (
                <>
                  <p style={styles.nowPlayingTitle}>{currentSong.title}</p>
                  <p style={styles.nowPlayingArtist}>{currentSong.artist}</p>
                </>
              ) : (
                <p style={styles.nowPlayingEmpty}>未选择歌曲</p>
              )}
            </div>
          </div>

          {/* 中间：控制按钮 */}
          <div style={styles.controls}>
            <span style={styles.time}>{formatTime(currentTime)}</span>
            <button onClick={prevTrack} className="ctrl-btn" style={styles.controlBtn} disabled={!currentAlbum}>⏮</button>
            <button onClick={togglePlay} className="ctrl-btn" style={{ ...styles.controlBtn, ...styles.playBtn }} disabled={!currentSong}>
              {isPlaying ? "⏸" : "▶"}
            </button>
            <button onClick={nextTrack} className="ctrl-btn" style={styles.controlBtn} disabled={!currentAlbum}>⏭</button>
            <span style={styles.time}>{formatTime(duration)}</span>
          </div>

          {/* 右侧：音量 */}
          <div style={styles.volumeArea}>
            <span style={{ fontSize: "16px" }}>
              {volume === 0 ? "🔇" : volume < 0.5 ? "🔉" : "🔊"}
            </span>
            <input type="range" min="0" max="1" step="0.01" value={volume} onChange={handleVolumeChange} style={styles.volumeSlider} />
          </div>
        </div>
      </footer>

      {/* ================================================================ */}
      {/* 播放详情页 — 全屏弹窗                                           */}
      {/* ================================================================ */}
      {showDetail && currentAlbum && currentSong && (
        <div style={styles.detailOverlay}>
                    <button className="detail-back-btn" style={styles.detailBackBtn} onClick={() => setShowDetail(false)}>
            <FaChevronDown />
          </button>

          <div style={styles.detailContent}>
            {/* 左侧：大方形封面 */}
            <div style={styles.detailCoverWrapper}>
              {currentAlbum.coverURL ? (
                <img src={currentAlbum.coverURL} alt={currentAlbum.title} style={styles.detailCover} />
              ) : (
                <div style={styles.detailCoverPlaceholder}>
                  <span style={styles.detailCoverPlaceholderIcon}>🎵</span>
                </div>
              )}
              <p style={styles.detailAlbumTitle}>{currentAlbum.title}</p>
              <p style={styles.detailAlbumArtist}>{currentAlbum.artist}</p>

              {/* 专辑歌曲列表 */}
              <div style={styles.detailSongList}>
                <p style={styles.detailSongListLabel}>歌曲列表</p>
                {currentAlbum.songs.map((song, idx) => (
                  <div
                    key={idx}
                    className="detail-song-item"
                    style={{
                      ...styles.detailSongItem,
                      ...(idx === currentSongIndex ? styles.detailSongItemActive : {}),
                    }}
                    onClick={() => { setCurrentSongIndex(idx); setIsPlaying(true); }}
                  >
                    <span style={styles.detailSongIdx}>{String(idx + 1).padStart(2, "0")}</span>
                    <div style={{ flex: 1, overflow: "hidden" }}>
                      <p style={styles.detailSongName}>{song.title}</p>
                      <p style={styles.detailSongArtist}>{song.artist}</p>
                    </div>
                    {idx === currentSongIndex && (
                      <span style={styles.detailPlayingIndicator}>{isPlaying ? "▶" : "⏸"}</span>
                    )}
                  </div>
                ))}
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
  // ===== 底部播放控制条 =====
  bottomBar: {
    position: "fixed",
    bottom: 0,
    left: 0,
    right: 0,
        background: "#ffffff",
    backdropFilter: "blur(24px)",
    WebkitBackdropFilter: "blur(24px)",
    borderTop: "1px solid #e5e7eb",
    padding: "6px 24px 12px",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    zIndex: 300,
  },
  progressWrapper: { width: "100%", padding: "0 4px" },
  progressBar: {
    width: "100%", height: "4px", appearance: "none",
    outline: "none", borderRadius: "2px", cursor: "pointer",
  },
  controlsRow: {
    display: "flex", alignItems: "center",
    justifyContent: "space-between", gap: "16px",
  },
  nowPlayingLeft: {
    display: "flex", alignItems: "center", gap: "10px",
    flex: "0 0 240px", overflow: "hidden", cursor: "pointer",
  },
  nowPlayingInfo: { flex: 1, overflow: "hidden", minWidth: 0 },
  nowPlayingTitle: {
    fontSize: "13px", fontWeight: 600, color: "#1f2937",
    margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  nowPlayingArtist: {
    fontSize: "11px", color: "#6b7280",
    margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  nowPlayingEmpty: { fontSize: "13px", color: "#4b5563", margin: 0 },
  miniCoverWrapper: {
    width: "42px", height: "42px", borderRadius: "6px",
    overflow: "hidden", flexShrink: 0, cursor: "pointer",
    transition: "transform 0.2s, box-shadow 0.2s",
    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
  },
  miniCover: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  miniCoverPlaceholder: {
    width: "100%", height: "100%",
        background: "#e5e7eb",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  miniCoverIcon: { fontSize: "18px", opacity: 0.4 },
  controls: { display: "flex", alignItems: "center", gap: "12px" },
    controlBtn: {
    width: "34px", height: "34px", borderRadius: "50%",
    border: "1px solid #d1d5db",
    background: "#ffffff",
    color: "#374151", fontSize: "14px", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  playBtn: {
    width: "42px", height: "42px", fontSize: "18px",
    background: "linear-gradient(135deg, #e94560, #c73e52)",
    boxShadow: "0 4px 15px rgba(233,69,96,0.3)",
    border: "none", color: "#fff",
  },
  time: {
    fontSize: "11px", color: "#6b7280",
    fontVariantNumeric: "tabular-nums",
    minWidth: "36px", textAlign: "center",
  },
  volumeArea: {
    display: "flex", alignItems: "center", gap: "8px",
    flex: "0 0 150px", justifyContent: "flex-end",
  },
  volumeSlider: {
    width: "80px", height: "4px", appearance: "none",
    outline: "none", borderRadius: "2px",
    background: "#d1d5db", cursor: "pointer",
  },

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
