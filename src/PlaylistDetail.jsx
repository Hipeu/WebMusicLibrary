import { useState, useRef } from "react";
import { FaPlay, FaPause, FaArrowLeft, FaEdit } from "react-icons/fa";
import PlayingAnimation from "./PlayingAnimation";

/* ================================================================
   📋 PlaylistDetail — 播放列表详情页
   布局与 AlbumDetail 一致，但：
   - 播放全部按钮旁有「编辑」按钮
   - 封面、标题、描述均可编辑
   ================================================================ */
export default function PlaylistDetail({
  playlist,
  playlists,
  onUpdatePlaylist,
  currentSongIndex,
  isPlaying,
  onPlayAll,
  onPlaySong,
  onBack,
}) {
  const [editing, setEditing] = useState(false);
  const [editCover, setEditCover] = useState(null); // base64
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const coverInputRef = useRef(null);

  if (!playlist) return null;

  // ---------- 进入编辑模式 ----------
  function openEdit() {
    setEditCover(null);
    setEditTitle(playlist.name || "");
    setEditDesc(playlist.description || "");
    setEditing(true);
  }

  // ---------- 取消编辑 ----------
  function cancelEdit() {
    setEditing(false);
  }

  // ---------- 保存编辑 ----------
  function saveEdit() {
    const updated = {
      ...playlist,
      name: editTitle.trim() || playlist.name,
      description: editDesc.trim(),
    };
    if (editCover) {
      updated.coverURL = editCover;
    }
    onUpdatePlaylist(playlist.id, updated);
    setEditing(false);
  }

  // ---------- 选择封面图片 ----------
  function handleCoverSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setEditCover(ev.target.result);
    };
    reader.readAsDataURL(file);
  }

  // ---------- 获取播放列表的歌曲 ----------
  const songs = playlist.songs || [];

  return (
    <div style={styles.container}>
      <button style={styles.backBtn} onClick={onBack} title="返回">
        <FaArrowLeft size={18} />
      </button>

            {/* 上半部分：左=封面 | 右=信息 */}
      <div style={styles.topSection}>
        {/* 左：封面（独立） */}
        <div style={styles.coverColumn}>
          <div style={styles.coverWrapper}>
            {editing && editCover ? (
              <img src={editCover} alt="封面" style={styles.cover} />
            ) : playlist.coverURL ? (
              <img src={playlist.coverURL} alt={playlist.name} style={styles.cover} />
            ) : (
              <div style={styles.coverPlaceholder}>
                <span style={styles.coverPlaceholderIcon}>📋</span>
              </div>
            )}
            {editing && (
              <div style={styles.coverEditOverlay} onClick={() => coverInputRef.current?.click()}>
                <span style={styles.coverEditText}>更换封面</span>
              </div>
            )}
            <input
              ref={coverInputRef}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={handleCoverSelect}
            />
          </div>
        </div>

        {/* 右：信息区（独立，可自由增删） */}
        <div style={styles.infoColumn}>
          {editing ? (
            <>
              <input
                style={styles.editTitleInput}
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="播放列表标题"
                autoFocus
              />
              <textarea
                style={styles.editDescInput}
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder="添加描述…"
                rows={3}
              />
              <div style={styles.editActions}>
                <button style={styles.saveBtn} onClick={saveEdit}>
                  保存
                </button>
                <button style={styles.cancelBtn} onClick={cancelEdit}>
                  取消
                </button>
              </div>
            </>
          ) : (
            <>
              <h1 style={styles.playlistTitle}>{playlist.name}</h1>
              {playlist.description && (
                <p style={styles.playlistDesc}>{playlist.description}</p>
              )}
              <p style={styles.playlistMeta}>
                {songs.length > 0 ? `${songs.length} 首歌曲` : "暂无歌曲"}
              </p>
              <div style={styles.actionRow}>
                <button style={styles.playButton} onClick={onPlayAll}>
                  {isPlaying ? (
                    <FaPause size={16} />
                  ) : (
                    <FaPlay size={16} />
                  )}
                </button>
                <button style={styles.editButton} onClick={openEdit}>
                  <FaEdit size={16} /> 编辑
                </button>
              </div>
            </>
          )}
        </div>
      </div>

            {/* 下半部分：歌曲列表 */}
      <div style={{
        ...styles.bottomSection,
        overflow: songs.length === 0 ? "hidden" : undefined,
      }}>
        {songs.length === 0 ? (
          <div style={styles.emptySongs}>
            <span style={styles.emptyIcon}>🎵</span>
            <p style={styles.emptyText}>播放列表为空</p>
            <p style={styles.emptyHint}>从资料库中添加歌曲到本播放列表</p>
          </div>
        ) : (
          <div style={styles.songList}>
            {songs.map((song, idx) => {
              const isActive = idx === currentSongIndex;
              return (
                <div
                  key={idx}
                  style={{
                    ...styles.songItem,
                    ...(isActive ? styles.songItemActive : {}),
                  }}
                  onClick={() => onPlaySong(idx)}
                  className="detail-song-item"
                >
                  <span style={styles.songIndex}>
                    {isActive && isPlaying ? (
                      <PlayingAnimation />
                    ) : (
                      String(idx + 1).padStart(2, "0")
                    )}
                  </span>

                  <div style={styles.songInfo}>
                    <span style={{
                      ...styles.songTitle,
                      ...(isActive ? styles.songTitleActive : {}),
                    }}>
                      {song.title}
                    </span>
                    <span style={styles.songArtist}>{song.artist}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================
   🎨 样式
   ================================================================ */
const styles = {
        container: {
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      background: "#ffffff",
      color: "#1f2937",
      fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
      position: "relative",
      overflowY: "auto",
    },

  backBtn: {
    position: "absolute",
    top: "20px",
    left: "24px",
    zIndex: 10,
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    border: "1px solid #e5e7eb",
    background: "#f3f4f6",
    color: "#374151",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backdropFilter: "blur(8px)",
    transition: "background 0.2s, transform 0.15s",
  },

                topSection: {
    flex: "0 0 40%",
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "65px",
    padding: "80px 60px 20px 200px",
    minHeight: 0,
  },

  // 左列：封面（固定宽高，不受右侧影响）
  coverColumn: {
    flex: "0 0 260px",
    alignSelf: "flex-start",
  },
  coverWrapper: {
    width: "260px",
    height: "260px",
    borderRadius: "12px",
    overflow: "hidden",
    boxShadow: "0 16px 48px rgba(0,0,0,0.5), 0 0 30px rgba(233,69,96,0.08)",
    position: "relative",
  },
  cover: {
    width: "100%", height: "100%", objectFit: "cover", display: "block",
  },
  coverPlaceholder: {
    width: "100%", height: "100%", display: "flex",
    alignItems: "center", justifyContent: "center",
    background: "#e5e7eb",
  },
  coverPlaceholderIcon: { fontSize: "64px", opacity: 0.3 },
  coverEditOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "48px",
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    transition: "background 0.2s",
  },
  coverEditText: {
    color: "#fff",
    fontSize: "13px",
    fontWeight: 500,
  },

  // 右列：信息区（纵向排列，后续可自由新增内容）
    infoColumn: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    minWidth: 0,
    alignSelf: "center",
    marginTop:"85px"
  },
  playlistTitle: {
    fontSize: "32px", fontWeight: 700, color: "#1f2937",
    margin: 0, lineHeight: 1.2,
  },
  playlistDesc: {
    fontSize: "14px", color: "#6b7280", margin: 0, lineHeight: 1.5,
  },
  playlistMeta: {
    fontSize: "14px", color: "#6b7280", margin: 0,
  },

  actionRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    marginTop: "8px",
  },
    playButton: {
    width: "48px",
    height: "48px",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(135deg, #e94560, #c73e52)",
    border: "none",
    cursor: "pointer",
    boxShadow: "0 6px 20px rgba(233,69,96,0.35)",
    flexShrink: 0,
    color: "#fff",
    fontSize: "16px",
  },
  editButton: {
    display: "inline-flex", alignItems: "center", gap: "8px",
    padding: "12px 24px", borderRadius: "28px",
    border: "1px solid #d1d5db",
    background: "#ffffff",
    color: "#374151", fontSize: "14px", fontWeight: 500,
    cursor: "pointer",
    transition: "background 0.2s, border-color 0.2s",
    width: "fit-content",
  },

  // 编辑模式样式
  editTitleInput: {
    fontSize: "24px", fontWeight: 700, color: "#1f2937",
    padding: "8px 12px",
    border: "1px solid #d1d5db",
    borderRadius: "8px",
    outline: "none",
    background: "#f9fafb",
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box",
  },
  editDescInput: {
    fontSize: "14px", color: "#374151",
    padding: "8px 12px",
    border: "1px solid #d1d5db",
    borderRadius: "8px",
    outline: "none",
    background: "#f9fafb",
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box",
    resize: "vertical",
    minHeight: "60px",
    lineHeight: 1.5,
  },
  editActions: {
    display: "flex", gap: "10px", marginTop: "4px",
  },
  saveBtn: {
    padding: "8px 24px",
    borderRadius: "20px",
    border: "none",
    background: "linear-gradient(135deg, #e94560, #c73e52)",
    color: "#fff",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  cancelBtn: {
    padding: "8px 24px",
    borderRadius: "20px",
    border: "1px solid #d1d5db",
    background: "#ffffff",
    color: "#374151",
    fontSize: "14px",
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "inherit",
  },

        bottomSection: {
    flex: 1, padding: "90px 170px 120px",
    display: "flex", flexDirection: "column", minHeight: 0, overflow: "visible",
  },

  songList: {
    flex: 1, display: "flex", flexDirection: "column",
    gap: "2px", paddingRight: "4px",
  },
  songItem: {
    display: "flex", alignItems: "center", gap: "14px",
    padding: "10px 14px", borderRadius: "10px",
    cursor: "pointer", transition: "background 0.2s",
  },
  songItemActive: {
    background: "rgba(233,69,96,0.12)",
    border: "1px solid rgba(233,69,96,0.25)",
  },
  songIndex: {
    fontSize: "13px", color: "#6b7280",
    fontVariantNumeric: "tabular-nums",
    minWidth: "28px", textAlign: "center", flexShrink: 0,
  },
  songInfo: {
    flex: 1, display: "flex", flexDirection: "column", gap: "2px", overflow: "hidden",
  },
  songTitle: {
    fontSize: "14px", fontWeight: 500, color: "#1f2937",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  songTitleActive: { color: "#1f2937", fontWeight: 600 },
  songArtist: {
    fontSize: "12px", color: "#6b7280",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },

  // 空状态
  emptySongs: {
    display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", gap: "8px", padding: "60px 20px",
  },
  emptyIcon: { fontSize: "48px", opacity: 0.3 },
  emptyText: { fontSize: "16px", color: "#374151", fontWeight: 500, margin: 0 },
  emptyHint: { fontSize: "13px", color: "#6b7280", margin: 0 },
};
