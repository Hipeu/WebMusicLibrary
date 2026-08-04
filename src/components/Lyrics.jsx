import { useRef, useEffect } from "react";

/**
 * Lyrics 组件
 * 支持两种模式：
 *   1. timed  —— 有时间轴，根据 currentTime 高亮当前行（已播放过的行变暗）
 *   2. plain  —— 无时间轴，纯文本可滚动显示
 *
 * Props:
 *   lyricsData  — { type: 'timed' | 'plain', lines: [...] }
 *   currentTime — 当前播放时间（秒），仅 timed 模式使用
 */
export default function Lyrics({ lyricsData, currentTime, onSeek }) {
  const scrollRef = useRef(null);

    // timed 模式：找到当前应该高亮的行
  const currentIndex =
    lyricsData?.type === "timed"
      ? lyricsData.lines.findIndex(
          (line, i) =>
            currentTime >= line.time &&
            (i === lyricsData.lines.length - 1 ||
              currentTime < lyricsData.lines[i + 1].time)
        )
      : -1;

  // 自动滚动到高亮行
  useEffect(() => {
    if (lyricsData?.type !== "timed" || currentIndex < 0 || !scrollRef.current)
      return;
    const activeEl = scrollRef.current.querySelector(".lyrics-active-line");
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [currentIndex, lyricsData]);

    // ========== 有时间轴渲染 ==========
  if (lyricsData?.type === "timed") {
    return (
      <div ref={scrollRef} style={styles.container}>
        {lyricsData.lines.map((line, i) => (
                    <p
            key={i}
            className={i === currentIndex ? "lyrics-active-line" : ""}
            style={{
              ...styles.line,
              ...(i === currentIndex ? styles.activeLine : {}),
              ...(i < currentIndex ? styles.pastLine : {}),
              cursor: "pointer",
            }}
            onClick={() => onSeek?.(line.time)}
            title="点击跳转到该时间"
          >
            {line.content}
          </p>
        ))}
      </div>
    );
  }

  // ========== 无时间轴（纯文本）渲染 ==========
  if (lyricsData?.type === "plain") {
    return (
      <div ref={scrollRef} style={styles.container}>
        {lyricsData.lines.length > 0 ? (
          lyricsData.lines.map((line, i) => (
            <p key={i} style={styles.plainLine}>
              {line}
            </p>
          ))
        ) : (
          <p style={styles.emptyHint}>暂无歌词</p>
        )}
      </div>
    );
  }

  // ========== 无数据 ==========
  return (
    <div style={styles.container}>
      <p style={styles.emptyHint}>暂无歌词，可导入 .lrc 文件</p>
    </div>
  );
}

/* ================================================================
   🎨 样式
   ================================================================ */
const styles = {
  container: {
    flex: 1,
    overflowY: "auto",
    paddingRight: "8px",
    lineHeight: 2,
  },
  line: {
        fontSize: "15px",
    color: "#4b5563",
    margin: "0 0 4px 0",
    lineHeight: 1.8,
    transition: "color 0.3s ease, transform 0.2s ease",
    padding: "6px 12px",
    borderRadius: "6px",
  },
  activeLine: {
    color: "#e94560",
    fontWeight: 700,
    fontSize: "17px",
    transform: "scale(1.02)",
    background: "rgba(233,69,96,0.08)",
  },
  pastLine: {
    color: "#9ca3af",
    fontSize: "14px",
  },
  plainLine: {
    fontSize: "15px",
    color: "#374151",
    margin: "0 0 4px 0",
    lineHeight: 1.8,
    padding: "2px 12px",
  },
  emptyHint: {
    fontSize: "14px",
    color: "#6b7280",
    fontStyle: "italic",
    textAlign: "center",
    marginTop: "40px",
  },
};

