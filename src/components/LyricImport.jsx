import { useState, useRef } from "react";
import { FaTimes, FaCloudDownloadAlt, FaPaste, FaFileImport } from "react-icons/fa";
import { matchLyric } from "../services/api";

/* ================================================================
   📄 LyricImport — 歌词获取界面
   在线匹配（多源） / 手动导入（文件 + 复制粘贴）
   ================================================================ */
export default function LyricImport({ song_name, artist_name, onUseLyric, onClose }) {
  const [tab, setTab] = useState("online");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");
  const [pasteText, setPasteText] = useState("");
  const fileRef = useRef(null);

  async function handleOnlineSearch() {
    setLoading(true);
    setError("");
    try {
      const res = await matchLyric({ song_name, artist_name });
      setResults(res?.results || []);
      if (!res?.results?.length) setError("未找到在线歌词");
    } catch {
      setError("在线歌词获取失败，请确认后端已启动");
    } finally {
      setLoading(false);
    }
  }

  function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text === "string") {
        setPasteText(text);
        setTab("manual");
      }
    };
    reader.readAsText(file, "utf-8");
    e.target.value = "";
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.window} onClick={(e) => e.stopPropagation()}>
        <button style={styles.closeBtn} onClick={onClose} title="关闭">
          <FaTimes size={16} />
        </button>
        <h3 style={styles.title}>导入歌词</h3>
        <p style={styles.subtitle}>
          {song_name} · {artist_name}
        </p>

        {/* Tab 切换 */}
        <div style={styles.tabBar}>
          <button style={{ ...styles.tabBtn, ...(tab === "online" ? styles.tabBtnActive : {}) }} onClick={() => setTab("online")}>
            <FaCloudDownloadAlt size={13} style={{ marginRight: 6 }} /> 在线匹配
          </button>
          <button style={{ ...styles.tabBtn, ...(tab === "manual" ? styles.tabBtnActive : {}) }} onClick={() => setTab("manual")}>
            <FaPaste size={13} style={{ marginRight: 6 }} /> 手动导入
          </button>
        </div>

        {tab === "online" ? (
          <div style={styles.body}>
            <button style={styles.searchBtn} onClick={handleOnlineSearch} disabled={loading}>
              {loading ? "搜索中…" : "在线搜索歌词"}
            </button>
            {error && <p style={styles.error}>{error}</p>}
            <div style={styles.resultList}>
              {results.map((r, i) => (
                <div key={i} style={styles.resultItem}>
                  <div style={styles.resultHead}>
                    <span style={styles.sourceBadge}>{r.source_label || r.source}</span>
                    <span style={styles.resultMeta}>{r.song_name} · {r.artist}{r.album ? ` · ${r.album}` : ""}</span>
                  </div>
                  <pre style={styles.lyricPreview}>{(r.lyric || "").slice(0, 400)}</pre>
                  <button
                    style={styles.useBtn}
                    onClick={() => { onUseLyric?.(r.lyric); onClose(); }}
                  >
                    使用此歌词
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={styles.body}>
            <div style={styles.toolbar}>
              <button style={styles.fileBtn} onClick={() => fileRef.current?.click()}>
                <FaFileImport size={13} style={{ marginRight: 6 }} /> 导入文件（.lrc / .txt）
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".lrc,text/plain"
                style={{ display: "none" }}
                onChange={handleFileSelect}
              />
            </div>
            <textarea
              style={styles.textarea}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="粘贴歌词内容（支持 .lrc 时间轴或纯文本）"
              spellCheck={false}
            />
            <div style={styles.footer}>
              <button
                style={styles.useBtn}
                disabled={!pasteText.trim()}
                onClick={() => { onUseLyric?.(pasteText); onClose(); }}
              >
                使用此歌词
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1100,
    fontFamily: "'Segoe UI', sans-serif",
  },
  window: {
    position: "relative",
    width: "560px",
    maxWidth: "92vw",
    maxHeight: "82vh",
    background: "#ffffff",
    borderRadius: "14px",
    boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
    display: "flex",
    flexDirection: "column",
    padding: "22px 24px 18px",
  },
  closeBtn: {
    position: "absolute",
    top: "14px",
    right: "14px",
    width: "32px",
    height: "32px",
    borderRadius: "50%",
    border: "none",
    background: "#f3f4f6",
    color: "#6b7280",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "inherit",
  },
  title: {
    fontSize: "20px",
    fontWeight: 700,
    color: "#1f2937",
    margin: 0,
  },
  subtitle: {
    fontSize: "13px",
    color: "#6b7280",
    margin: "4px 0 14px",
  },
  tabBar: {
    display: "flex",
    gap: "2px",
    padding: "4px",
    borderRadius: "20px",
    background: "#f3f4f6",
    alignSelf: "flex-start",
    marginBottom: "14px",
  },
  tabBtn: {
    display: "inline-flex",
    alignItems: "center",
    padding: "6px 16px",
    borderRadius: "18px",
    border: "none",
    background: "transparent",
    color: "#6b7280",
    fontSize: "13px",
    cursor: "pointer",
    fontFamily: "inherit",
  },
  tabBtnActive: {
    background: "#e94560",
    color: "#ffffff",
  },
  body: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    minHeight: "240px",
  },
  searchBtn: {
    alignSelf: "flex-start",
    padding: "8px 20px",
    borderRadius: "18px",
    border: "none",
    background: "#e94560",
    color: "#ffffff",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  error: {
    fontSize: "13px",
    color: "#e94560",
    margin: 0,
  },
  resultList: {
    flex: 1,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  resultItem: {
    border: "1px solid #e5e7eb",
    borderRadius: "10px",
    padding: "12px 14px",
    background: "#fafafa",
  },
  resultHead: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "6px",
  },
  sourceBadge: {
    fontSize: "11px",
    fontWeight: 700,
    color: "#e94560",
    padding: "2px 10px",
    borderRadius: "10px",
    background: "rgba(233,69,96,0.1)",
    flexShrink: 0,
  },
  resultMeta: {
    fontSize: "12px",
    color: "#6b7280",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  lyricPreview: {
    fontSize: "12px",
    lineHeight: 1.6,
    color: "#4b5563",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    maxHeight: "160px",
    overflowY: "auto",
    margin: "0 0 10px",
    fontFamily: "'Segoe UI', sans-serif",
    background: "#ffffff",
    border: "1px solid #f3f4f6",
    borderRadius: "8px",
    padding: "8px 10px",
  },
  useBtn: {
    padding: "6px 18px",
    borderRadius: "16px",
    border: "1px solid #e94560",
    background: "#ffffff",
    color: "#e94560",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
  },
  fileBtn: {
    display: "inline-flex",
    alignItems: "center",
    padding: "7px 18px",
    borderRadius: "18px",
    border: "1px solid #d1d5db",
    background: "#ffffff",
    color: "#374151",
    fontSize: "13px",
    cursor: "pointer",
    fontFamily: "inherit",
  },
  textarea: {
    flex: 1,
    minHeight: "220px",
    padding: "12px",
    borderRadius: "8px",
    border: "1px solid #e5e7eb",
    background: "#f9fafb",
    fontSize: "13px",
    lineHeight: 1.7,
    color: "#1f2937",
    fontFamily: "'Segoe UI', sans-serif",
    resize: "vertical",
    outline: "none",
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
  },
};
