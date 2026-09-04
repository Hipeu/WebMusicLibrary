import { useState } from "react";
import {
  FaMusic,
  FaCompactDisc,
  FaUser,
  FaListUl,
  FaHeart,
  FaHeadphones,
  FaFolder,
  FaSearch,
  FaPenFancy,
  FaFeatherAlt,
  FaTags,
  FaVideo,
} from "react-icons/fa";

/* ================================================================
   🎯 Sidebar — 音乐资料库侧边栏
   功能：导航 + 播放列表管理
   ================================================================ */
export default function Sidebar({
  activeNav,
  onNavChange,
  playlists,
  onOpenPlaylistMenu,
  onRenamePlaylist,
  showMoreCategories,
  categoryVisibility = {},
}) {
  const [editingPlaylist, setEditingPlaylist] = useState(null);
  const [editName, setEditName] = useState("");

  // ---------- 确认重命名 ----------
  function handleRenameConfirm(id) {
    if (editName.trim()) {
      onRenamePlaylist(id, editName.trim());
    }
    setEditingPlaylist(null);
  }

  // ---------- 导航项 ----------
  const navItems = [
    { id: "search", label: "搜索", icon: <FaSearch /> },
    { id: "library", label: "资料库", icon: <FaMusic /> },
    { id: "albums", label: "专辑", icon: <FaCompactDisc /> },
    { id: "artists", label: "艺人", icon: <FaUser /> },
    { id: "songs", label: "歌曲", icon: <FaListUl /> },
    ...(showMoreCategories && categoryVisibility.composer ? [{ id: "composer", label: "作曲者", icon: <FaPenFancy /> }] : []),
    ...(showMoreCategories && categoryVisibility.lyricist ? [{ id: "lyricist", label: "作词者", icon: <FaFeatherAlt /> }] : []),
    ...(showMoreCategories && categoryVisibility.genre ? [{ id: "genres", label: "流派", icon: <FaTags /> }] : []),
    ...(showMoreCategories && categoryVisibility.video ? [{ id: "videos", label: "视频", icon: <FaVideo /> }] : []),
  ];

  // 播放列表图标映射
  const playlistIcon = (id) => {
    if (id === "liked") return <FaHeart />;
    if (id === "recent") return <FaHeadphones />;
    return <FaListUl />;
  };

  return (
    <div style={styles.sidebar} className="app-sidebar">
      {/* ===== 顶部导航 ===== */}
      <div style={{ ...styles.section, ...styles.navigationSection }} className="sidebar-navigation-section">
        {navItems.map((item) => (
          <div
            key={item.id}
            className="sidebar-item"
            style={{
              ...styles.item,
              ...(activeNav === item.id ? styles.itemActive : {}),
            }}
            onClick={() => onNavChange(item.id)}
            title={item.label}
          >
            <span
              className="sidebar-label"
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
      <div style={{ ...styles.section, ...styles.playlistSection }} className="sidebar-playlists-section">
        <div className="sidebar-section-title" style={styles.sectionTitle}>播放列表</div>

        {/* 全部播放列表 */}
        <div
          className="sidebar-item"
          style={{
            ...styles.item,
            ...(activeNav === "playlists" ? styles.itemActive : {}),
          }}
          onClick={() => onNavChange("playlists")}
          title="全部播放列表"
        >
          <span className="sidebar-playlist-thumb" style={{ ...styles.playlistThumb, ...(activeNav === "playlists" ? styles.playlistThumbActive : {}) }}>
            <FaFolder />
          </span>
          <span className="sidebar-label" style={{ ...styles.label, ...(activeNav === "playlists" ? styles.labelActive : {}) }}>
            全部播放列表
          </span>
        </div>

        {/* 系统播放列表固定显示；只有显式置顶的自定义播放列表才显示在分割线下。 */}
        {playlists.filter((pl) => pl.id === "liked" || pl.id === "recent").map((pl) => (
          <>
            <div
              key={pl.id}
              className="sidebar-item"
              style={{
                ...styles.item,
                ...(activeNav === pl.id ? styles.itemActive : {}),
              }}
              onClick={() => onNavChange(pl.id)}
              title={pl.name}
            >
            <span
              className="sidebar-playlist-thumb"
              style={{
                ...styles.playlistThumb,
                ...(activeNav === pl.id ? styles.playlistThumbActive : {}),
              }}
            >
              {playlistIcon(pl.id)}
              {pl.coverURL && (
                <img
                  src={pl.coverURL}
                  alt=""
                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              )}
            </span>

            {editingPlaylist === pl.id ? (
              <input
                className="sidebar-edit-input"
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
                className="sidebar-label"
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
                className="sidebar-more-btn"
                style={styles.moreBtn}
                onClick={(e) => onOpenPlaylistMenu?.(e, pl)}
                title="更多操作"
              >
                ···
              </span>
            )}
          </div>
          </>
        ))}

        <div className="sidebar-section-divider" style={styles.sectionDivider} />

        {playlists.filter((pl) => pl.id !== "liked" && pl.id !== "recent" && pl.pinned).map((pl) => (
          <div
            key={pl.id}
            className="sidebar-item"
            style={{ ...styles.item, ...(activeNav === pl.id ? styles.itemActive : {}) }}
            onClick={() => onNavChange(pl.id)}
            title={pl.name}
          >
            <span style={{ ...styles.playlistThumb, ...(activeNav === pl.id ? styles.playlistThumbActive : {}) }}>
              {playlistIcon(pl.id)}
              {(pl.coverURL || pl.songs?.[0]?.coverURL) && <img src={pl.coverURL || pl.songs[0].coverURL} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
            </span>
            {editingPlaylist === pl.id ? (
              <input className="sidebar-edit-input" style={styles.editInput} value={editName} onChange={(e) => setEditName(e.target.value)} onBlur={() => handleRenameConfirm(pl.id)} onKeyDown={(e) => { if (e.key === "Enter") handleRenameConfirm(pl.id); if (e.key === "Escape") setEditingPlaylist(null); }} autoFocus onClick={(e) => e.stopPropagation()} />
            ) : (
              <span className="sidebar-label" style={{ ...styles.label, ...(activeNav === pl.id ? styles.labelActive : {}), flex: 1 }}>{pl.name}</span>
            )}
            <span className="sidebar-more-btn" style={styles.moreBtn} onClick={(e) => onOpenPlaylistMenu?.(e, pl)} title="更多操作">···</span>
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
    boxSizing: "border-box",
    background: "#f9fafb",
    borderRight: "1px solid #e5e7eb",
    padding: "20px 12px 120px",
    display: "flex",
    flexDirection: "column",
    gap: "20px",
    fontFamily: "'Segoe UI', sans-serif",
    overflowY: "auto",
    overflowX: "hidden",
  },

  section: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  navigationSection: {
    flexShrink: 0,
  },
  playlistSection: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    overflowX: "hidden",
    paddingRight: "5px",
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
  sectionDivider: {
    height: "1px",
    background: "#e5e7eb",
    margin: "6px 8px",
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

  // 播放列表缩略图：等比例（正方形）专辑卡片样式
  playlistThumb: {
    position: "relative",
    width: "34px",
    height: "34px",
    borderRadius: "8px",
    border: "1px solid #e5e7eb",
    background: "#f3f4f6",
    color: "#6b7280",
    fontSize: "15px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    overflow: "hidden",
  },
  playlistThumbActive: {
    borderColor: "#e94560",
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
  moreBtn: {
    fontSize: "18px",
    lineHeight: 1,
    letterSpacing: "2px",
    color: "#9ca3af",
    cursor: "pointer",
    padding: "4px 8px",
    borderRadius: "6px",
    transition: "color 0.15s, background 0.15s",
    opacity: 0,
    flexShrink: 0,
  },
};
