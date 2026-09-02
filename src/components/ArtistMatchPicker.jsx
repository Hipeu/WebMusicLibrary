import { useState } from "react";
import { FaTimes } from "react-icons/fa";
import { matchArtistCandidates, matchArtistCandidateDetails } from "../services/api";

export default function ArtistMatchPicker({ artistName, onPick, onClose }) {
  const [source, setSource] = useState("all");
  const [cache, setCache] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const activeResults = cache[source] || [];
  const sources = source === "all"
    ? { qq: true, netease: true }
    : { qq: source === "qq", netease: source === "netease" };

  async function search() {
    setLoading(true);
    setError("");
    try {
      const result = await matchArtistCandidates({ artist_name: artistName, sources });
      setCache((prev) => ({ ...prev, [source]: result?.results || [] }));
      if (!result?.results?.length) setError("未找到艺人结果");
    } catch {
      setError("匹配失败，请确认后端与音乐 API 已启动");
    } finally {
      setLoading(false);
    }
  }

  async function pick(candidate) {
    try {
      const details = await matchArtistCandidateDetails(candidate);
      onPick?.({ ...candidate, ...(details?.status === "ok" ? details : {}) });
    } catch {
      onPick?.(candidate);
    }
    onClose?.();
  }

  return (
    <div className="artist-match-overlay" style={styles.overlay} onClick={onClose}>
      <div className="artist-match-dialog" style={styles.dialog} onClick={(event) => event.stopPropagation()}>
        <button type="button" className="artist-match-close" style={styles.closeButton} onClick={onClose} title="关闭">
          <FaTimes size={16} />
        </button>
        <h3 style={styles.title}>匹配艺人</h3>
        <p style={styles.subtitle}>{artistName}</p>
        <div className="artist-match-sources" style={styles.sourceRow}>
          {[['all', '全部'], ['qq', 'QQ音乐'], ['netease', '网易云音乐']].map(([key, label]) => (
            <button
              type="button"
              key={key}
              className={source === key ? "is-active" : ""}
              style={{ ...styles.sourceButton, ...(source === key ? styles.sourceButtonActive : {}) }}
              onClick={() => setSource(key)}
            >
              {label}
            </button>
          ))}
          <button type="button" className="artist-match-search" style={styles.searchButton} onClick={search} disabled={loading}>
            {loading ? "搜索中…" : "搜索"}
          </button>
        </div>
        {error && <p style={styles.error}>{error}</p>}
        <div style={styles.grid}>
          {activeResults.map((candidate) => (
            <button type="button" className="artist-match-card" key={`${candidate.source}-${candidate.singermid || candidate.artist_id}`} style={styles.card} onClick={() => pick(candidate)}>
              <div className="artist-match-avatar" style={styles.avatarWrap}>
                {candidate.avatar_url ? <img src={candidate.avatar_url} alt="" style={styles.avatar} /> : <span style={styles.placeholder}>🎤</span>}
              </div>
              <span style={styles.name}>{candidate.name}</span>
              <span style={styles.sourceLabel}>{candidate.source_label}</span>
            </button>
          ))}
          {!loading && !activeResults.length && !error && <p style={styles.empty}>选择来源后点击“搜索”</p>}
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: { position: "fixed", inset: 0, zIndex: 1250, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", background: "rgba(15,23,42,0.58)", backdropFilter: "blur(4px)" },
  dialog: { position: "relative", width: "620px", maxWidth: "94vw", maxHeight: "86vh", overflowY: "auto", padding: "24px", borderRadius: "16px", background: "#fff", boxShadow: "0 20px 70px rgba(0,0,0,0.28)", fontFamily: "'Segoe UI', system-ui, sans-serif" },
  closeButton: { position: "absolute", top: "14px", right: "14px", width: "32px", height: "32px", border: "none", borderRadius: "50%", background: "#f3f4f6", color: "#6b7280", cursor: "pointer" },
  title: { margin: 0, color: "#1f2937", fontSize: "20px" },
  subtitle: { margin: "5px 0 16px", color: "#6b7280", fontSize: "13px" },
  sourceRow: { display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" },
  sourceButton: { padding: "7px 16px", border: "1px solid #d1d5db", borderRadius: "18px", background: "#fff", color: "#6b7280", cursor: "pointer", fontFamily: "inherit" },
  sourceButtonActive: { borderColor: "#e94560", background: "#e94560", color: "#fff" },
  searchButton: { padding: "8px 18px", border: "none", borderRadius: "18px", background: "#e94560", color: "#fff", cursor: "pointer", fontFamily: "inherit" },
  error: { margin: "12px 0 0", color: "#e94560", fontSize: "13px" },
  grid: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "14px", marginTop: "18px" },
  card: { minWidth: 0, padding: "14px 10px", border: "1px solid #e5e7eb", borderRadius: "12px", background: "#fff", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: "7px", fontFamily: "inherit" },
  avatarWrap: { width: "92px", height: "92px", overflow: "hidden", borderRadius: "50%", background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center" },
  avatar: { width: "100%", height: "100%", objectFit: "cover" },
  placeholder: { fontSize: "30px", opacity: 0.5 },
  name: { maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#374151", fontSize: "14px", fontWeight: 600 },
  sourceLabel: { color: "#9ca3af", fontSize: "11px" },
  empty: { gridColumn: "1 / -1", margin: 0, padding: "28px 0", textAlign: "center", color: "#9ca3af", fontSize: "13px" },
};
