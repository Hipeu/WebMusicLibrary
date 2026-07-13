/* ================================================================
   🎛️ PlayerControls — 底部播放控制条
   功能：进度条 + 歌曲信息 + 播放/暂停/切歌 + 音量控制
   从 MusicPlayer 中独立出来的模块
   ================================================================ */
export default function PlayerControls({
  currentSong,
  currentAlbum,
  currentTime,
  duration,
  volume,
  isPlaying,
  progress,
  showDetail,
  onTogglePlay,
  onPrevTrack,
  onNextTrack,
  onSeek,
  onVolumeChange,
  onShowDetail,
  formatTime,
}) {
  return (
    <footer style={styles.bottomBar}>
      {/* 进度条 */}
      <div style={styles.progressWrapper}>
        <input
          type="range"
          min="0"
          max="100"
          step="0.1"
          value={progress}
          onChange={onSeek}
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
          onClick={() => currentSong && onShowDetail()}
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
          <button onClick={onPrevTrack} className="ctrl-btn" style={styles.controlBtn} disabled={!currentAlbum}>⏮</button>
          <button onClick={onTogglePlay} className="ctrl-btn" style={{ ...styles.controlBtn, ...styles.playBtn }} disabled={!currentSong}>
            {isPlaying ? "⏸" : "▶"}
          </button>
          <button onClick={onNextTrack} className="ctrl-btn" style={styles.controlBtn} disabled={!currentAlbum}>⏭</button>
          <span style={styles.time}>{formatTime(duration)}</span>
        </div>

        {/* 右侧：音量 */}
        <div style={styles.volumeArea}>
          <span style={{ fontSize: "16px" }}>
            {volume === 0 ? "🔇" : volume < 0.5 ? "🔉" : "🔊"}
          </span>
          <input type="range" min="0" max="1" step="0.01" value={volume} onChange={onVolumeChange} style={styles.volumeSlider} />
        </div>
      </div>
    </footer>
  );
}

/* ================================================================
   🎨 样式
   ================================================================ */
const styles = {
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
};
