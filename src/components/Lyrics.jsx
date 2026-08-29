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
export default function Lyrics({ lyricsData, currentTime, onSeek, activeColor = "#e94560" }) {
  const scrollRef = useRef(null);
  // 用户最近一次手动滚动时间（毫秒）；此段时间内自动滚动不回拽
  const lastUserScrollRef = useRef(0);
  // 滚动停止后回到当前时间轴位置的定时器
  const returnTimerRef = useRef(null);
  // 滚动条仅在交互时可见，避免常驻轨道干扰歌词阅读。
  const hideScrollbarTimerRef = useRef(null);
  function showScrollbar() {
    const el = scrollRef.current;
    if (!el) return;
    el.classList.add("lyrics-scroll-visible");
    if (hideScrollbarTimerRef.current) clearTimeout(hideScrollbarTimerRef.current);
    hideScrollbarTimerRef.current = setTimeout(() => {
      el.classList.remove("lyrics-scroll-visible");
    }, 800);
  }

  function handlePointerEnter() {
    showScrollbar();
  }

  function handlePointerLeave() {
    if (hideScrollbarTimerRef.current) clearTimeout(hideScrollbarTimerRef.current);
    const el = scrollRef.current;
    hideScrollbarTimerRef.current = setTimeout(() => el?.classList.remove("lyrics-scroll-visible"), 800);
  }

  // 当前行高亮色（跟随封面发光色；默认 #e94560），背景为同色 8% 透明度
  const activeBg = activeColor.length === 7 ? `${activeColor}14` : "rgba(233,69,96,0.08)";

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

  // 滚动到指定歌词行（居中）
  function scrollToActive() {
    const el = scrollRef.current;
    if (!el) return;
    const activeEl = el.querySelector(".lyrics-active-line");
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  // 用户手动滚动：记录时间、短暂显示滚动条、6s 无滚动后自动回位
  function handleScroll() {
    lastUserScrollRef.current = Date.now();
    showScrollbar();
    if (returnTimerRef.current) clearTimeout(returnTimerRef.current);
    returnTimerRef.current = setTimeout(() => {
      // 播放中：即使歌词行未变化也回到当前时间轴位置
      if (lyricsData?.type === "timed" && currentIndex >= 0) {
        lastUserScrollRef.current = 0;
        scrollToActive();
      }
    }, 6000);
  }

  // 自动滚动到高亮行（用户最近 2.5s 内手动滚动过则不回拽）
  useEffect(() => {
    if (lyricsData?.type !== "timed" || currentIndex < 0 || !scrollRef.current)
      return;
    if (Date.now() - lastUserScrollRef.current < 6000) return;
    scrollToActive();
  }, [currentIndex, lyricsData]);

  // 卸载时清理定时器
  useEffect(() => {
    return () => {
      if (returnTimerRef.current) clearTimeout(returnTimerRef.current);
      if (hideScrollbarTimerRef.current) clearTimeout(hideScrollbarTimerRef.current);
    };
  }, []);

    // ========== 有时间轴渲染 ==========
  if (lyricsData?.type === "timed") {
    return (
      <div ref={scrollRef} className="lyrics-scroll" style={styles.container} onScroll={handleScroll} onPointerEnter={handlePointerEnter} onPointerLeave={handlePointerLeave}>
        {lyricsData.lines.map((line, i) => (
                    <p
            key={i}
            className={i === currentIndex ? "lyrics-active-line" : ""}
            style={{
              ...styles.line,
              ...(i === currentIndex ? styles.activeLine : {}),
              ...(i === currentIndex ? { color: activeColor, background: activeBg } : {}),
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
      <div ref={scrollRef} className="lyrics-scroll" style={styles.container} onScroll={handleScroll} onPointerEnter={handlePointerEnter} onPointerLeave={handlePointerLeave}>
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
  },  pastLine: {
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

