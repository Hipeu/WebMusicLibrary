import { useState } from "react";
import { FaTimes } from "react-icons/fa";
import { matchSongCandidates, matchSongCandidateDetails, fetchCoverProxy } from "../services/api";

/* ================================================================
   🎯 MatchResultPicker — 单曲匹配多结果选择
   源选择（全部/QQ/网易/iTunes）+ 独立搜索按钮 + 分页结果
   选中候选 → onPick(candidate) 填充编辑表单
   ================================================================ */
export default function MatchResultPicker({ song_name, artist_name, file_path, onPick, onClose }) {
  const [sourceSel, setSourceSel] = useState("all"); // "all" | "qq" | "netease" | "itunes"
  const [loading, setLoading] = useState(false); // 初次搜索
  const [fetchingMore, setFetchingMore] = useState(false); // 翻页超出缓存按需加载
  const [cache, setCache] = useState({}); // 当前弹窗生命周期内按源缓存
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [searchMode, setSearchMode] = useState("all"); // 本次实际搜索的源模式（徽标显示依据）

  const PAGE_SIZE = 3; // 单页展示 3 条
  const CACHE_INIT = 12; // 首次缓存 12 条
  const activeCache = cache[sourceSel] || { results: [], total: 0 };
  const totalPages = Math.max(1, Math.ceil(activeCache.total / PAGE_SIZE));
  // 当前页在缓存内的切片；超出缓存的部分展示「正在加载」
  const displayed = activeCache.results.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageOutOfCache = (page - 1) * PAGE_SIZE >= activeCache.results.length;

  function buildSources() {
    if (sourceSel === "qq") return { qq: true, netease: false, itunes: false };
    if (sourceSel === "netease") return { qq: false, netease: true, itunes: false };
    if (sourceSel === "itunes") return { qq: false, netease: false, itunes: true };
    return { qq: true, netease: true, itunes: true };
  }

  async function fetchResults(offset, limit) {
    return await matchSongCandidates({
      song_name,
      artist_name,
      file_path,
      sources: buildSources(),
      offset,
      limit,
      lyric_credits_fallback: localStorage.getItem("match-lyric-fallback") === "1",
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
      if (!res?.results?.length) setError("未找到匹配结果");
    } catch {
      setError("匹配失败，请确认后端已启动");
    } finally {
      setLoading(false);
    }
  }

  // 翻页：缓存内本地切换；超出缓存按需加载该页
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
        if (!more.length) setError("未找到更多匹配结果");
      } catch {
        setError("加载失败，请确认后端已启动");
      } finally {
        setFetchingMore(false);
      }
    }
  }

  function selectSource(k) {
    // 切换源仅改选中，保留上次搜索结果（点「搜索」才用新源重新查询）
    setSourceSel(k);
    setSearchMode(k);
    setPage(1);
  }

  // 选中候选：有封面则经后端同源代理下载为 Blob，随 onPick 传给编辑表单
  async function handlePick(r) {
    let coverFile = null;
    const fieldKeys = ["title", "artist", "album", "year", "track_disc", "genre", "album_artist", "description", "composer", "lyricist", "lyric", "publisher", "arranger", "producer"];
    const fields = Object.fromEntries(fieldKeys.map((key) => [key, localStorage.getItem(`match-field-${key}`) !== "0"]));
    const [blob, details] = await Promise.all([
      r.cover_url ? fetchCoverProxy(r.cover_url) : null,
      matchSongCandidateDetails({
        candidate: r,
        fields,
        lyric_credits_fallback: localStorage.getItem("match-lyric-fallback") === "1",
      }),
    ]);
    if (blob) {
      coverFile = new File([blob], "cover.jpg", { type: blob.type || "image/jpeg" });
    }
    onPick?.({ ...r, ...(details?.status === "ok" ? details : {}) }, coverFile);
    onClose();
  }

  return (
    <div className="match-result-picker-overlay" style={styles.overlay} onClick={onClose}>
      <div className="match-result-picker-dialog" style={styles.window} onClick={(e) => e.stopPropagation()}>
        <button className="dialog-close-btn" style={styles.closeBtn} onClick={onClose} title="关闭">
          <FaTimes size={16} />
        </button>
        <h3 className="picker-dialog-title" style={styles.title}>匹配结果</h3>
        <p className="picker-dialog-subtitle" style={styles.subtitle}>
          {song_name} · {artist_name}
        </p>

        {/* 源选择 + 独立搜索按钮 */}
        <div className="picker-search-row" style={styles.searchRow}>
          {[["all", "全部"], ["qq", "QQ音乐"], ["netease", "网易云音乐"], ["itunes", "iTunes"]].map(([k, label]) => (
            <button
              key={k}
              className={`picker-source-chip${sourceSel === k ? " is-selected" : ""}`}
              style={{ ...styles.srcChip, ...(sourceSel === k ? styles.srcChipActive : {}) }}
              onClick={() => selectSource(k)}
            >
              {label}
            </button>
          ))}
          <button className="picker-search-btn" style={styles.searchBtn} onClick={handleSearch} disabled={loading}>
            {loading ? "搜索中…" : "搜索"}
          </button>
        </div>

        {error && <p className="picker-error" style={styles.error}>{error}</p>}

        <div className="picker-result-list" style={styles.resultList}>
          {loading ? (
            <p style={styles.emptyHint}>搜索中…</p>
          ) : fetchingMore && pageOutOfCache ? (
            <p style={styles.emptyHint}>正在加载…</p>
          ) : (
            displayed.map((r, i) => (
              <div key={i} className="picker-result-item" style={styles.resultItem}>
                {/* 封面缩略图（正方形，高度随卡片） */}
                <div style={styles.coverBox}>
                  {r.cover_url ? (
                    <img src={r.cover_url} alt="" style={styles.coverImg} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                  ) : null}
                </div>
                {/* 右侧信息 */}
                <div style={styles.cardMain}>
                  <div style={styles.titleRow}>
                    <span style={styles.resultTitle}>{r.song_name}</span>
                    {searchMode === "all" && (
                      <span style={styles.sourceBadge}>{r.source_label || r.source}</span>
                    )}
                  </div>
                  {(r.album || r.year) && (
                    <div style={styles.albumLine}>
                      {[r.album, r.year ? `${r.year}年` : ""].filter(Boolean).join(" · ")}
                    </div>
                  )}
                  {r.artist && <div style={styles.artistLine}>{r.artist}</div>}
                  {r.composers?.length > 0 && (
                    <div style={styles.creditsLine}>作曲：{r.composers.join(", ")}</div>
                  )}
                  {r.lyricists?.length > 0 && (
                    <div style={styles.creditsLine}>作词：{r.lyricists.join(", ")}</div>
                  )}
                  <div style={styles.footerRow}>
                    <button className="picker-use-btn" style={styles.useBtn} onClick={() => handlePick(r)}>
                      使用此信息
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
          {!loading && activeCache.results.length === 0 && !error && (
            <p style={styles.emptyHint}>选择源后点击「搜索」获取匹配结果</p>
          )}
        </div>

        {/* 分页控件 */}
        {totalPages > 1 && (
          <div style={styles.pager}>
            <button className="picker-pager-btn" style={styles.pagerBtn} disabled={page <= 1 || loading || fetchingMore} onClick={() => goToPage(page - 1)}>
              ‹
            </button>
            <span style={styles.pagerInfo}>共 {totalPages} 页结果 · 第 {page} 页</span>
            <button className="picker-pager-btn" style={styles.pagerBtn} disabled={page >= totalPages || loading || fetchingMore} onClick={() => goToPage(page + 1)}>
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
    width: "640px",
    maxWidth: "92vw",
    maxHeight: "86vh",
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
  resultList: {
    flex: 1,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    minHeight: "200px",
  },
  resultItem: {
    display: "flex",
    alignItems: "stretch",
    gap: "12px",
    border: "1px solid #e5e7eb",
    borderRadius: "10px",
    padding: "10px 14px 10px 8px",
    background: "#fafafa",
  },
  coverBox: {
    position: "relative",
    width: "auto",
    height: "auto",
    aspectRatio: "1 / 1",
    alignSelf: "stretch",
    borderRadius: "8px",
    overflow: "hidden",
    flexShrink: 0,
    background: "#e5e7eb",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  coverImg: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "contain",
    display: "block",
  },
  cardMain: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: "3px",
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "2px",
  },
  sourceBadge: {
    flexShrink: 0,
    fontSize: "11px",
    fontWeight: 700,
    color: "#e94560",
    padding: "2px 10px",
    borderRadius: "10px",
    background: "rgba(233,69,96,0.1)",
  },
  resultTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: "15px",
    fontWeight: 600,
    color: "#1f2937",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  albumLine: {
    fontSize: "13px",
    color: "#6b7280",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  artistLine: {
    fontSize: "13px",
    color: "#6b7280",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  creditsLine: {
    fontSize: "13px",
    color: "#4b5563",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  footerRow: {
    display: "flex",
    justifyContent: "flex-end",
    marginTop: "6px",
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
  emptyHint: {
    fontSize: "13px",
    color: "#9ca3af",
    textAlign: "center",
    margin: "40px 0",
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
