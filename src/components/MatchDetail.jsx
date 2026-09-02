import { useState } from "react";
import { FaTimes } from "react-icons/fa";

/* ================================================================
   🎯 MatchDetail — 匹配详情独立窗口
   统计 + 日志（全部 / 不成功筛选）+ 运行中取消按钮
   ================================================================ */
export default function MatchDetail({ data, initialFilter = "all", onCancel, onClose }) {
  const [filter, setFilter] = useState(initialFilter);

  if (!data) return null;

  const log = Array.isArray(data.log) ? data.log : [];
  const running = !!data.running;
  const shownLog = log.filter((item) => filter === "all" || item.kind !== "ok");

  const logIcon = (kind) => (kind === "ok" ? "✓" : kind === "skip" ? "↷" : "✕");

  const statusLabel = data.cancelled
    ? "已取消"
    : running
      ? "匹配中"
      : data.status === "error"
        ? "异常结束"
        : "已完成";

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.window} className="match-detail-window" onClick={(e) => e.stopPropagation()}>
        <button className="match-detail-close" style={styles.closeBtn} onClick={onClose} title="关闭">
          <FaTimes size={16} />
        </button>

        {/* 标题 + 状态 */}
        <div className="match-detail-header" style={styles.header}>
          <h3 style={styles.title}>匹配详情</h3>
          <span className={`match-detail-status${running ? " is-running" : ""}`} style={{ ...styles.status, ...(running ? styles.statusRunning : {}) }}>
            {statusLabel}
          </span>
        </div>

        {/* 统计 */}
        <div className="match-detail-stats" style={styles.statsRow}>
          <span style={styles.stat}>已完成 <b>{data.done || 0}/{data.total || 0}</b></span>
          <span style={styles.statOk}>成功 {data.matched || 0}</span>
          <span style={styles.statFail}>失败 {data.failed || 0}</span>
          <span style={styles.statSkip}>跳过 {data.skipped || 0}</span>
        </div>

        {/* 工具栏：筛选 + 取消 */}
        <div style={styles.toolbar}>
          <div className="match-detail-filters" style={styles.filterGroup}>
            {(["all", "failed"]).map((f) => (
              <button
                key={f}
                className={filter === f ? "is-active" : ""}
                style={{ ...styles.filterBtn, ...(filter === f ? styles.filterBtnActive : {}) }}
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "全部" : "不成功"}
              </button>
            ))}
          </div>
          {running && (
            <button className="match-detail-cancel" style={styles.cancelBtn} onClick={onCancel}>
              取消
            </button>
          )}
        </div>

        {/* 日志 */}
        <div className="match-detail-log" style={styles.logBox}>
          {shownLog.length === 0 ? (
            <p style={styles.empty}>暂无日志</p>
          ) : (
            shownLog.map((item, i) => (
              <div key={i} style={styles.logItem}>
                <span
                  style={{
                    ...styles.logIcon,
                    ...(item.kind === "ok"
                      ? styles.logIconOk
                      : item.kind === "skip"
                        ? styles.logIconSkip
                        : styles.logIconFail),
                  }}
                >
                  {logIcon(item.kind)}
                </span>
                <span className="match-detail-log-text" style={styles.logText}>{item.message}</span>
              </div>
            ))
          )}
        </div>
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
    zIndex: 1200,
    fontFamily: "'Segoe UI', sans-serif",
  },
  window: {
    position: "relative",
    width: "640px",
    maxWidth: "92vw",
    height: "560px",
    maxHeight: "85vh",
    background: "#ffffff",
    borderRadius: "14px",
    boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
    display: "flex",
    flexDirection: "column",
    padding: "24px 26px 18px",
  },
  closeBtn: {
    position: "absolute",
    top: "14px",
    right: "14px",
    zIndex: 10,
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
  header: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    marginBottom: "12px",
  },
  title: {
    fontSize: "20px",
    fontWeight: 700,
    color: "#1f2937",
    margin: 0,
  },
  status: {
    fontSize: "12px",
    fontWeight: 600,
    padding: "3px 12px",
    borderRadius: "12px",
    background: "#f3f4f6",
    color: "#6b7280",
  },
  statusRunning: {
    background: "rgba(233,69,96,0.12)",
    color: "#e94560",
  },
  statsRow: {
    display: "flex",
    gap: "18px",
    flexWrap: "wrap",
    padding: "12px 14px",
    borderRadius: "10px",
    border: "1px solid #f3f4f6",
    background: "#fafafa",
    fontSize: "13px",
    color: "#6b7280",
  },
  statOk: { color: "#16a34a" },
  statFail: { color: "#e94560" },
  statSkip: { color: "#9ca3af" },
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    margin: "14px 0 8px",
  },
  filterGroup: {
    display: "flex",
    gap: "2px",
    padding: "3px",
    borderRadius: "18px",
    background: "#f3f4f6",
  },
  filterBtn: {
    padding: "5px 16px",
    borderRadius: "16px",
    border: "none",
    background: "transparent",
    color: "#6b7280",
    fontSize: "13px",
    cursor: "pointer",
    fontFamily: "inherit",
  },
  filterBtnActive: {
    background: "#e94560",
    color: "#ffffff",
  },
  cancelBtn: {
    padding: "6px 18px",
    borderRadius: "16px",
    border: "1px solid #d1d5db",
    background: "#ffffff",
    color: "#374151",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  logBox: {
    flex: 1,
    overflowY: "auto",
    border: "1px solid #e5e7eb",
    borderRadius: "10px",
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  empty: {
    fontSize: "13px",
    color: "#9ca3af",
    textAlign: "center",
    margin: "20px 0",
  },
  logItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
    fontSize: "13px",
    lineHeight: 1.5,
  },
  logIcon: {
    flexShrink: 0,
    width: "17px",
    height: "17px",
    borderRadius: "50%",
    fontSize: "10px",
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#ffffff",
    marginTop: "2px",
  },
  logIconOk: { background: "#16a34a" },
  logIconSkip: { background: "#9ca3af" },
  logIconFail: { background: "#e94560" },
  logText: {
    color: "#4b5563",
    wordBreak: "break-word",
  },
};
