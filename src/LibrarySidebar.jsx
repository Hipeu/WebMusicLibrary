import { useState } from "react";
import {
  FaMusic,
  FaCompactDisc,
  FaUser,
  FaListUl,
  FaPlus,
  FaTrash,
  FaHeart,
  FaHeadphones,
} from "react-icons/fa";

/* ================================================================
   🎯 Sidebar — 音乐资料库侧边栏
   功能：导航 + 播放列表管理
   ================================================================ */
import Search from "./Search";

export default function Sidebar({
  activeNav,
  onNavChange,
  playlists,
  onCreatePlaylist,
  onDeletePlaylist,
  onRenamePlaylist,
  filterText,
  setFilterText,
}) {
  const [editingPlaylist, setEditingPlaylist] = useState(null);
  const [editName, setEditName] = useState("");

  // ---------- 新建播放列表 ----------
  function handleCreatePlaylist() {
    const newId = "pl_" + Date.now();
    onCreatePlaylist(newId);
    setEditingPlaylist(newId);
    setEditName("新建播放列表");
  }

  // ---------- 删除播放列表 ----------
  function handleDeletePlaylist(id, e) {
    e.stopPropagation();
    onDeletePlaylist(id);
    if (editingPlaylist === id) {
      setEditingPlaylist(null);
    }
  }

  // ---------- 确认重命名 ----------
  function handleRenameConfirm(id) {
    if (editName.trim()) {
      onRenamePlaylist(id, editName.trim());
    }
    setEditingPlaylist(null);
  }

  // ---------- 导航项 ----------
  const navItems = [
    { id: "library", label: "资料库", icon: <FaMusic /> },
    { id: "albums", label: "专辑", icon: <FaCompactDisc /> },
    { id: "artists", label: "艺人", icon: <FaUser /> },
    { id: "songs", label: "歌曲", icon: <FaListUl /> },
  ];

  // 播放列表图标映射
  const playlistIcon = (id) => {
    if (id === "liked") return <FaHeart />;
    if (id === "recent") return <FaHeadphones />;
    return <FaListUl />;
  };

  return (
    <div style={styles.sidebar}>
      {/* ===== 搜索 ===== */}
      <div style={styles.searchSection}>
        <Search filterText={filterText} setFilterText={setFilterText} activeNav={activeNav} onNavChange={onNavChange} />
      </div>

      {/* ===== 顶部导航 ===== */}
      <div style={styles.section}>
        {navItems.map((item) => (
          <div
            key={item.id}
            className="sidebar-item"
            style={{
              ...styles.item,
              ...(activeNav === item.id ? styles.itemActive : {}),
            }}
            onClick={() => onNavChange(item.id)}
          >
            <span
              style={{
                ...styles.icon,
                ...(activeNav === item.id ? styles.iconActive : {}),
              }}
            >
              {item.icon}
            </span>
            <span
              style={{
                ...styles.label,
                ...(activeNav === item.id ? styles.labelActive : {}),
              }}
            >
              {item.label}
            </span>
          </div>
        ))}
      </div>

      {/* ===== 播放列表 ===== */}
      <div style={styles.section}>
        <div style={styles.sectionTitle}>播放列表</div>
        {playlists.map((pl) => (
          <div
            key={pl.id}
            className="sidebar-item"
            style={{
              ...styles.item,
              ...(activeNav === pl.id ? styles.itemActive : {}),
            }}
            onClick={() => onNavChange(pl.id)}
          >
            <span
              style={{
                ...styles.icon,
                ...(activeNav === pl.id ? styles.iconActive : {}),
              }}
            >
              {playlistIcon(pl.id)}
            </span>

            {editingPlaylist === pl.id ? (
              <input
                style={styles.editInput}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => handleRenameConfirm(pl.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameConfirm(pl.id);
                  if (e.key === "Escape") setEditingPlaylist(null);
                }}
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                style={{
                  ...styles.label,
                  ...(activeNav === pl.id ? styles.labelActive : {}),
                  flex: 1,
                }}
              >
                {pl.name}
              </span>
            )}

            {pl.id !== "liked" && pl.id !== "recent" && (
              <span
                className="sidebar-delete-btn"
                style={styles.deleteBtn}
                onClick={(e) => handleDeletePlaylist(pl.id, e)}
                title="删除播放列表"
              >
                <FaTrash size={10} />
              </span>
            )}
          </div>
        ))}

      </div>
    </div>
  );
}

/* ================================================================
   🎨 样式
   ================================================================ */
const styles = {
  sidebar: {
    width: "220px",
    flexShrink: 0,
    height: "100%",
    background: "#f9fafb",
    borderRight: "1px solid #e5e7eb",
    padding: "20px 12px",
    display: "flex",
    flexDirection: "column",
    gap: "20px",
    fontFamily: "'Segoe UI', sans-serif",
    overflowY: "auto",
    overflowX: "hidden",
  },

  searchSection: {
    marginBottom: "-8px",
  },

  section: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },

  sectionTitle: {
    fontSize: "11px",
    color: "#6b7280",
    marginBottom: "6px",
    marginTop: "4px",
    padding: "0 8px",
    textTransform: "uppercase",
    letterSpacing: "1.5px",
    fontWeight: 600,
  },

  item: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "8px 10px",
    borderRadius: "8px",
    cursor: "pointer",
    color: "#374151",
    transition: "background 0.15s, color 0.15s",
    userSelect: "none",
  },
  itemActive: {
    background: "rgba(233,69,96,0.12)",
    color: "#e94560",
  },

  icon: {
    fontSize: "15px",
    color: "#6b7280",
    flexShrink: 0,
    width: "20px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  iconActive: {
    color: "#e94560",
  },

  label: {
    fontSize: "13px",
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  labelActive: {
    color: "#e94560",
    fontWeight: 600,
  },

    editInput: {
    flex: 1,
    fontSize: "13px",
    padding: "2px 6px",
    border: "1px solid #e94560",
    borderRadius: "4px",
    outline: "none",
    background: "#ffffff",
    color: "#1f2937",
    fontFamily: "inherit",
  },
  deleteBtn: {
    fontSize: "10px",
    color: "#9ca3af",
    cursor: "pointer",
    padding: "4px",
    borderRadius: "4px",
    transition: "color 0.15s, background 0.15s",
    opacity: 0,
    flexShrink: 0,
  },
};
