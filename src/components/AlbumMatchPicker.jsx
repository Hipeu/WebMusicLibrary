import { useState } from "react";
import { FaTimes } from "react-icons/fa";
import { matchAlbumCandidates, fetchCoverProxy, fetchDescription } from "../services/api";

/* ================================================================
   💿 AlbumMatchPicker — 专辑匹配多结果选择（网格 3×2）
   源选择（全部/网易/iTunes）+ 独立搜索按钮 + 分页
   选择封面 = 选择该专辑版本 → onPick(albumCandidate, coverFile)
   ================================================================ */
export default function AlbumMatchPicker({ album_name, artist_name, onPick, onClose }) {
  const [sourceSel, setSourceSel] = useState("all"); // "all" | "netease" | "itunes"
  const [loading, setLoading] = useState(false);
  const [fetchingMore, setFetchingMore] = useState(false);
  const [cache, setCache] = useState({});
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [searchMode, setSearchMode] = useState("all"); // 本次实际搜索的源模式（徽标显示依据）

  const PAGE_SIZE = 6; // 单页 3 列 × 2 行
  const CACHE_INIT = 12;
  const activeCache = cache[sourceSel] || { results: [], total: 0 };
  const totalPages = Math.max(1, Math.ceil(activeCache.total / PAGE_SIZE));
  const displayed = activeCache.results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageOutOfCache = (page - 1) * PAGE_SIZE >= activeCache.results.length;

  function buildSources() {
    if (sourceSel === "qq") return { qq: true, netease: false, itunes: false };
    if (sourceSel === "netease") return { qq: false, netease: true, itunes: false };
    if (sourceSel === "itunes") return { qq: false, netease: false, itunes: true };
    return { qq: true, netease: true, itunes: true };
  }

  async function fetchResults(offset, limit) {
    return await matchAlbumCandidates({
      album_name,
      artist_name,
      sources: buildSources(),
      offset,
      limit,
    });
  }

  async function handleSearch() {
    setLoading(true);
    setError("");
    setSearchMode(sourceSel);
    try {
      const res = await fetchResults(0, CACHE_INIT);
      setCache((prev) => ({ ...prev, [sourceSel]: { results: res?.results || [], total: res?.total || 0 } }));
      setPage(1);
      if (!res?.results?.length) setError("未找到专辑结果");
    } catch {
      setError("匹配失败，请确认后端已启动");
    } finally {
      setLoading(false);
    }
  }

  async function goToPage(target) {
    if (target < 1 || target > totalPages) return;
    setPage(target);
    const startIdx = (target - 1) * PAGE_SIZE;
    if (startIdx >= activeCache.results.length) {
      setFetchingMore(true);
      setError("");
      try {
        const res = await fetchResults(startIdx, PAGE_SIZE);
        const more = res?.results || [];
        setCache((prev) => {
          const current = prev[sourceSel] || { results: [], total: 0 };
          const arr = [...current.results];
          more.forEach((item, i) => { arr[startIdx + i] = item; });
          return { ...prev, [sourceSel]: { results: arr, total: res?.total || current.total } };
        });
        if (!more.length) setError("未找到更多专辑结果");
      } catch {
        setError("加载失败，请确认后端已启动");
      } finally {
        setFetchingMore(false);
      }
    }
  }

  function selectSource(k) {
    setSourceSel(k);
    setSearchMode(k);
    setPage(1);
  }

  // 选择封面 = 选择该专辑版本；有封面经代理下载为 Blob 随 onPick 传递
  async function handlePick(r) {
    let coverFile = null;
    let description = null;
    if (r.cover_url) {
      const blob = await fetchCoverProxy(r.cover_url);
      if (blob) {
        coverFile = new File([blob], "cover.jpg", { type: blob.type || "image/jpeg" });
      }
    }
    const sourceId = r.source === "qq" ? r.albummid : r.ncm_id;
    if (sourceId && (r.source === "qq" || r.source === "netease")) {
      try {
        const detail = await fetchDescription({ source: r.source, kind: "album", id: sourceId });
        description = detail?.description || null;
      } catch {
        description = null;
      }
    }
    onPick?.({ ...r, description }, coverFile);
    onClose();
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.window} onClick={(e) => e.stopPropagation()}>
        <button style={styles.closeBtn} onClick={onClose} title="关闭">
          <FaTimes size={16} />
        </button>
        <h3 style={styles.title}>匹配专辑</h3>
        <p style={styles.subtitle}>
          {album_name} · {artist_name}
        </p>

        {/* 源选择 + 独立搜索按钮 */}
        <div style={styles.searchRow}>
          {[["all", "全部"], ["qq", "QQ音乐"], ["netease", "网易云音乐"], ["itunes", "iTunes"]].map(([k, label]) => (
            <button
              key={k}
              style={{ ...styles.srcChip, ...(sourceSel === k ? styles.srcChipActive : {}) }}
              onClick={() => selectSource(k)}
            >
              {label}
            </button>
          ))}
          <button style={styles.searchBtn} onClick={handleSearch} disabled={loading}>
            {loading ? "搜索中…" : "搜索"}
          </button>
        </div>

        {error && <p style={styles.error}>{error}</p>}

        {/* 专辑网格：3 列 × 2 行 */}
        <div style={styles.albumGrid}>
          {loading ? (
            <p style={styles.emptyHint}>搜索中…</p>
          ) : fetchingMore && pageOutOfCache ? (
            <p style={styles.emptyHint}>正在加载…</p>
          ) : (
            displayed.map((r, i) => (
              <div key={i} style={styles.albumCard} onClick={() => handlePick(r)}>
                <div style={styles.albumCover}>
                  {r.cover_url ? (
                    <img src={r.cover_url} alt="" style={styles.albumCoverImg} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                  ) : null}
                  {searchMode === "all" && (
                    <span style={styles.sourceBadge}>{r.source_label || r.source}</span>
                  )}
                </div>
                <div style={styles.albumName}>{r.album}</div>
                <div style={styles.albumArtist}>
                  {[r.album_artist, r.year ? `${r.year}年` : ""].filter(Boolean).join(" · ")}
                </div>
              </div>
            ))
          )}
          {!loading && activeCache.results.length === 0 && !error && (
            <p style={styles.emptyHint}>选择源后点击「搜索」获取专辑结果</p>
          )}
        </div>

        {/* 分页控件 */}
        {totalPages > 1 && (
          <div style={styles.pager}>
            <button style={styles.pagerBtn} disabled={page <= 1 || loading || fetchingMore} onClick={() => goToPage(page - 1)}>
              ‹
            </button>
            <span style={styles.pagerInfo}>共 {totalPages} 页结果 · 第 {page} 页</span>
            <button style={styles.pagerBtn} disabled={page >= totalPages || loading || fetchingMore} onClick={() => goToPage(page + 1)}>
              ›
            </button>
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
    zIndex: 1200,
    fontFamily: "'Segoe UI', sans-serif",
  },
  window: {
    position: "relative",
    width: "680px",
    maxWidth: "92vw",
    maxHeight: "88vh",
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
  searchRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
    marginBottom: "12px",
  },
  srcChip: {
    padding: "6px 18px",
    borderRadius: "18px",
    border: "1px solid #d1d5db",
    background: "#ffffff",
    color: "#6b7280",
    fontSize: "13px",
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "all 0.15s",
  },
  srcChipActive: {
    background: "#e94560",
    borderColor: "#e94560",
    color: "#ffffff",
  },
  searchBtn: {
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
    margin: "0 0 8px",
  },
  albumGrid: {
    flex: 1,
    overflowY: "auto",
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "14px",
    minHeight: "200px",
    alignContent: "start",
  },
  albumCard: {
    cursor: "pointer",
    border: "1px solid #e5e7eb",
    borderRadius: "10px",
    overflow: "hidden",
    background: "#fafafa",
    transition: "box-shadow 0.15s, transform 0.15s",
  },
  albumCover: {
    position: "relative",
    aspectRatio: "1 / 1",
    background: "#e5e7eb",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  albumCoverImg: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  sourceBadge: {
    position: "absolute",
    top: "6px",
    right: "6px",
    fontSize: "10px",
    fontWeight: 700,
    color: "#ffffff",
    padding: "2px 8px",
    borderRadius: "10px",
    background: "rgba(233,69,96,0.9)",
    zIndex: 2,
  },
  albumName: {
    fontSize: "13px",
    fontWeight: 600,
    color: "#1f2937",
    margin: "8px 10px 2px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  albumArtist: {
    fontSize: "12px",
    color: "#6b7280",
    margin: "0 10px 8px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  emptyHint: {
    fontSize: "13px",
    color: "#9ca3af",
    textAlign: "center",
    margin: "40px 0",
    gridColumn: "1 / -1",
  },
  pager: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    flexShrink: 0,
    marginTop: "12px",
  },
  pagerBtn: {
    width: "30px",
    height: "30px",
    borderRadius: "50%",
    border: "1px solid #d1d5db",
    background: "#ffffff",
    color: "#374151",
    fontSize: "16px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "inherit",
    transition: "all 0.15s",
  },
  pagerInfo: {
    fontSize: "13px",
    color: "#6b7280",
  },
};
