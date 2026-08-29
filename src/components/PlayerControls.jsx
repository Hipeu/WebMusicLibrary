/* ================================================================
   🎛️ PlayerControls — 底部播放控制条
   功能：进度条 + 歌曲信息 + 播放/暂停/切歌 + 音量控制
   从 MusicPlayer 中独立出来的模块
   ================================================================ */
import { FaRedo, FaRandom, FaStepBackward, FaStepForward, FaPlay, FaPause, FaVolumeMute, FaVolumeDown, FaVolumeUp } from "react-icons/fa";

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
  playMode,
  onPlayModeChange,
}) {
  return (
    <footer style={styles.bottomBar} className="app-player-bar">
      {/* 进度条 */}
      <div style={styles.progressWrapper}>
        <input
          type="range"
          min="0"
          max="100"
          step="0.1"
          value={progress}
          onChange={onSeek}
          className="player-range player-progress-range"
          style={{
            ...styles.progressBar,
            background: `linear-gradient(to right, #e94560 ${progress}%, var(--player-range-track, #d1d5db) ${progress}%)`,
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
          {!showDetail && currentSong && (
            <div style={styles.miniCoverWrapper}>
              <div style={styles.miniCoverPlaceholder}>
                <span style={styles.miniCoverIcon}>🎵</span>
              </div>
              {(currentAlbum?.coverURL || currentSong?.coverURL) && (
                <img
                  src={currentAlbum?.coverURL || currentSong?.coverURL}
                  alt={currentAlbum?.title || currentSong?.title}
                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                  style={{ ...styles.miniCover, position: "absolute", inset: 0 }}
                />
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
          <button onClick={onPrevTrack} className="ctrl-btn" style={styles.controlBtn} title="上一首" disabled={!currentAlbum}><FaStepBackward size={14} /></button>
          <button onClick={onTogglePlay} className="ctrl-btn" style={{ ...styles.controlBtn, ...styles.playBtn }} disabled={!currentSong}>
            {isPlaying ? <FaPause size={16} /> : <FaPlay size={16} style={{ marginLeft: "2px" }} />}
          </button>
          <button onClick={onNextTrack} className="ctrl-btn" style={styles.controlBtn} title="下一首" disabled={!currentAlbum}><FaStepForward size={14} /></button>
          <span style={styles.time}>{formatTime(duration)}</span>
        </div>

        {/* 右侧：播放模式 + 音量 */}
        <div style={styles.volumeArea}>
          <button
            className={`player-mode-btn${playMode === "loop" || playMode === "loop-one" ? " is-active" : ""}`}
            style={{
              ...styles.modeBtn,
              ...((playMode === "loop" || playMode === "loop-one") ? styles.modeBtnActive : {}),
              position: "relative",
            }}
            onClick={() => {
              if (playMode === "loop") onPlayModeChange?.("loop-one");
              else if (playMode === "loop-one") onPlayModeChange?.("sequential");
              else onPlayModeChange?.("loop");
            }}
            title={playMode === "loop-one" ? "单曲循环" : "列表循环"}
          >
            <FaRedo size={13} />
            {playMode === "loop-one" && <span style={styles.loopOneBadge}>1</span>}
          </button>
          <button
            className={`player-mode-btn${playMode === "shuffle" ? " is-active" : ""}`}
            style={{
              ...styles.modeBtn,
              ...(playMode === "shuffle" ? styles.modeBtnActive : {}),
            }}
            onClick={() => onPlayModeChange?.(playMode === "shuffle" ? "sequential" : "shuffle")}
            title="随机播放"
          >
            <FaRandom size={13} />
          </button>
          <span style={styles.volumeIcon} title="音量">
            {volume === 0 ? <FaVolumeMute /> : volume < 0.5 ? <FaVolumeDown /> : <FaVolumeUp />}
          </span>
          <input className="player-range player-volume-range" type="range" min="0" max="1" step="0.01" value={volume} onChange={onVolumeChange} style={{ ...styles.volumeSlider, "--volume-percent": `${volume * 100}%` }} />
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
    position: "relative",
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
    width: "34px", height: "34px", borderRadius: "6px",
    border: "none",
    background: "transparent",
    color: "#374151", fontSize: "14px", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  playBtn: {
    width: "42px", height: "42px", fontSize: "18px",
    background: "transparent",
    boxShadow: "none",
    border: "none", color: "#374151",
  },
  time: {
    fontSize: "11px", color: "#6b7280",
    fontVariantNumeric: "tabular-nums",
    minWidth: "36px", textAlign: "center",
  },
  volumeArea: {
    display: "flex", alignItems: "center", gap: "6px",
    flex: "0 0 150px", justifyContent: "flex-end",
  },
  volumeIcon: { width: "20px", color: "#6b7280", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" },
  modeBtn: {
    background: "none", border: "none", cursor: "pointer",
    width: "30px", height: "30px", borderRadius: "6px",
    display: "flex", alignItems: "center", justifyContent: "center",
    color: "#9ca3af", fontFamily: "inherit",
    transition: "all 0.2s", position: "relative",
  },
  modeBtnActive: {
    background: "transparent", color: "#4b5563",
  },
  loopOneBadge: {
    position: "absolute", top: "-3px", right: "-3px",
    background: "#6b7280", color: "#fff",
    fontSize: "9px", fontWeight: 700,
    width: "14px", height: "14px",
    borderRadius: "50%",
    display: "flex", alignItems: "center", justifyContent: "center",
    lineHeight: 1,
  },
  volumeSlider: {
    width: "80px", height: "4px", appearance: "none",
    outline: "none", borderRadius: "2px",
    background: "#d1d5db", cursor: "pointer",
  },
};
