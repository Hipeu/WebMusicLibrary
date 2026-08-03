import { FaPlay, FaPause } from "react-icons/fa";

/* ================================================================
   🎵 CoverPlayButton — 封面上的播放/暂停按钮
   悬停时显示，点击切换播放/暂停，
   非当前专辑显示为播放按钮，点击开始播放
   ================================================================ */
export default function CoverPlayButton({
  isActive,      // 是否是当前播放的专辑
  isPlaying,     // 是否正在播放
  onTogglePlay,  // 点击触发的回调
}) {
  // 非当前专辑 → 显示播放按钮（打开详情页用）
  // 当前专辑且正在播放 → 悬停显示暂停按钮
  // 当前专辑且已暂停 → 悬停显示播放按钮

  const showPauseIcon = isActive && isPlaying;

  return (
    <div
      className="cover-play-btn"
      title={showPauseIcon ? "暂停" : "播放"}
      onClick={(e) => {
        e.stopPropagation(); // 阻止冒泡到卡片打开详情页
        onTogglePlay();
      }}
      style={styles.wrapper}
    >
      <div className="cover-play-btn-inner" style={styles.iconCircle}>
        {showPauseIcon ? (
          <FaPause size={16} style={styles.icon} />
        ) : (
          <FaPlay size={14} style={{ ...styles.icon, marginLeft: "3px" }} />
        )}
      </div>
    </div>
  );
}

const styles = {
  wrapper: {
    position: "absolute",
    bottom: "12px",
    right: "12px",
    zIndex: 5,
    opacity: 0,
    transition: "opacity 0.2s ease, transform 0.2s ease",
    transform: "scale(0.9)",
    cursor: "pointer",
  },
  iconCircle: {
    width: "42px",
    height: "42px",
    borderRadius: "50%",
    background: "linear-gradient(135deg, #e94560, #c73e52)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 4px 16px rgba(233,69,96,0.5)",
    transition: "transform 0.15s ease, box-shadow 0.15s ease",
  },
  icon: {
    color: "#fff",
  },
};
