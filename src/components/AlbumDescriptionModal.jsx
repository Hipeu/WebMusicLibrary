import { FaPause, FaPlay, FaTimes } from "react-icons/fa";
import { isPlaceholderPublisher } from "../utils/formatCheck";

export default function AlbumDescriptionModal({ album, isPlaying, themeColor, onPlayAlbum, onClose }) {
  if (!album) return null;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.dialog} onClick={(event) => event.stopPropagation()}>
        <button type="button" style={styles.closeButton} onClick={onClose} title="关闭">
          <FaTimes size={16} />
        </button>

        <div
          style={{
            ...styles.header,
            ...(themeColor ? {
              background: `linear-gradient(135deg, #f8fafc, ${themeColor}18)`,
            } : {}),
          }}
        >
          <div style={styles.coverWrap}>
            {album.coverURL ? (
              <img src={album.coverURL} alt={album.title} style={styles.cover} />
            ) : (
              <div style={styles.coverPlaceholder}>🎶</div>
            )}
          </div>
          <div style={styles.headerInfo}>
            <h2 style={styles.title}>{album.title}</h2>
            <p style={styles.artist}>{album.artist || "未知艺人"}</p>
            <p style={styles.meta}>
              {album.year ? `${album.year}年` : "未知年份"}
              {album.genre ? ` · ${album.genre}` : ""}
            </p>
            {album.publisher && !isPlaceholderPublisher(album.publisher) && <p style={styles.publisher}>{album.publisher}</p>}
            <button
              type="button"
              style={{
                ...styles.playButton,
                ...(themeColor ? {
                  background: themeColor,
                  boxShadow: `0 6px 20px ${themeColor}55`,
                } : {}),
              }}
              onClick={onPlayAlbum}
              title={isPlaying ? "暂停" : "播放"}
              aria-label={isPlaying ? "暂停" : "播放"}
            >
              {isPlaying ? <FaPause size={16} /> : <FaPlay size={16} />}
            </button>
          </div>
        </div>

        <div style={styles.body}>
          <h3 style={styles.sectionTitle}>专辑简介</h3>
          <p style={styles.description}>{album.description || "暂无简介"}</p>

        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed", inset: 0, zIndex: 1300,
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: "24px", background: "rgba(15, 23, 42, 0.62)",
    backdropFilter: "blur(5px)",
  },
  dialog: {
    position: "relative", width: "720px", maxWidth: "100%", maxHeight: "88vh",
    display: "flex", flexDirection: "column", overflow: "hidden",
    borderRadius: "18px", background: "#ffffff",
    boxShadow: "0 24px 80px rgba(0,0,0,0.28)",
    fontFamily: "'Segoe UI', system-ui, sans-serif",
  },
  closeButton: {
    position: "absolute", top: "16px", right: "16px", zIndex: 2,
    width: "34px", height: "34px", border: "none", borderRadius: "50%",
    display: "flex", alignItems: "center", justifyContent: "center",
    background: "rgba(255,255,255,0.86)", color: "#6b7280", cursor: "pointer",
  },
  header: {
    display: "flex", gap: "22px", padding: "28px 30px 24px",
    background: "linear-gradient(135deg, #f8fafc, #fff1f2)",
  },
  coverWrap: {
    width: "170px", height: "170px", flexShrink: 0, overflow: "hidden",
    borderRadius: "12px", boxShadow: "0 12px 28px rgba(15,23,42,0.18)",
  },
  cover: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  coverPlaceholder: {
    width: "100%", height: "100%", display: "flex", alignItems: "center",
    justifyContent: "center", background: "#e5e7eb", fontSize: "42px", opacity: 0.6,
  },
  headerInfo: { minWidth: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center" },
  title: { margin: 0, color: "#1f2937", fontSize: "27px", lineHeight: 1.25 },
  artist: { margin: "10px 0 0", color: "#4b5563", fontSize: "16px" },
  meta: { margin: "8px 0 0", color: "#6b7280", fontSize: "13px" },
  publisher: { margin: "8px 0 0", color: "#9ca3af", fontSize: "12px" },
  playButton: {
    width: "48px", height: "48px", display: "flex", alignItems: "center",
    justifyContent: "center", marginTop: "16px", padding: 0,
    border: "none", borderRadius: "50%", background: "linear-gradient(135deg, #e94560, #c73e52)",
    boxShadow: "0 6px 20px rgba(233,69,96,0.35)", color: "#fff", cursor: "pointer",
  },
  body: { overflowY: "auto", padding: "24px 30px 30px" },
  sectionTitle: { margin: 0, color: "#374151", fontSize: "14px", fontWeight: 700 },
  description: { margin: "10px 0 24px", color: "#4b5563", fontSize: "14px", lineHeight: 1.8, whiteSpace: "pre-wrap" },
};
