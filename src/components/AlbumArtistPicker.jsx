import { FaTimes } from "react-icons/fa";

export default function AlbumArtistPicker({ artists, onPick, onClose }) {
  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.dialog} onClick={(event) => event.stopPropagation()}>
        <button type="button" style={styles.closeButton} onClick={onClose} title="关闭">
          <FaTimes size={16} />
        </button>
        <h3 style={styles.title}>前往</h3>
        <div style={styles.list}>
          {artists.map((item) => (
            <button
              type="button"
              key={item.name}
              style={styles.row}
              onClick={() => onPick(item.name)}
            >
              <span style={styles.avatarWrap}>
                {item.avatar ? (
                  <img src={item.avatar} alt="" style={styles.avatar} onError={(e) => { e.currentTarget.style.display = "none"; }} />
                ) : (
                  <span style={styles.avatarFallback}>🎤</span>
                )}
              </span>
              <span style={styles.name}>{item.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: { position: "fixed", inset: 0, zIndex: 1250, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", background: "rgba(15,23,42,0.58)", backdropFilter: "blur(4px)" },
  dialog: { position: "relative", width: "340px", maxWidth: "92vw", maxHeight: "80vh", overflowY: "auto", padding: "24px", borderRadius: "16px", background: "#fff", boxShadow: "0 20px 70px rgba(0,0,0,0.28)", fontFamily: "'Segoe UI', system-ui, sans-serif" },
  closeButton: { position: "absolute", top: "14px", right: "14px", width: "32px", height: "32px", border: "none", borderRadius: "50%", background: "#f3f4f6", color: "#6b7280", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" },
  title: { margin: "0 0 16px", color: "#1f2937", fontSize: "18px" },
  list: { display: "flex", flexDirection: "column", gap: "8px" },
  row: { display: "flex", alignItems: "center", gap: "12px", padding: "8px 10px", border: "1px solid #e5e7eb", borderRadius: "10px", background: "#fff", cursor: "pointer", fontFamily: "inherit", textAlign: "left", transition: "background 0.15s" },
  avatarWrap: { width: "44px", height: "44px", borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center" },
  avatar: { width: "100%", height: "100%", objectFit: "cover" },
  avatarFallback: { fontSize: "18px", opacity: 0.5 },
  name: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#374151", fontSize: "14px", fontWeight: 500 },
};