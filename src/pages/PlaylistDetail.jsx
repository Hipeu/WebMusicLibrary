import { useState, useRef } from "react";
import { FaPlay, FaPause, FaArrowLeft, FaEdit, FaEllipsisH, FaHeart, FaPlus, FaStepForward, FaClock, FaCompactDisc, FaUser, FaTrash, FaInfoCircle, FaTimes, FaMusic } from "react-icons/fa";
import PlayingAnimation from "../components/PlayingAnimation";

/* ================================================================
   📋 PlaylistDetail — 播放列表详情页
   布局与 AlbumDetail 一致，但：
   - 播放全部按钮旁有「编辑」按钮
   - 封面、标题、描述均可编辑
   ================================================================ */
export default function PlaylistDetail({
  playlist,
  playlists,
  setPlaylists,
  onUpdatePlaylist,
  currentSongIndex,
  isPlaying,
  onPlayAll,
  onPlaySong,
  onBack,
  onPlayNext,
  onPlayLater,
  onOpenArtist,
  onRemoveFromPlaylist,
  onDeleteSong,
  onEditInfo,
  missingSongs,
  onMissingSongClick,
}) {
  const [editing, setEditing] = useState(false);
  const [editCover, setEditCover] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const coverInputRef = useRef(null);
  const [menuSongIdx, setMenuSongIdx] = useState(null);
  const [panelSong, setPanelSong] = useState(null);
  const [panelSearch, setPanelSearch] = useState("");

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
    <div style={styles.container} className="playlist-detail-page">
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
                <span style={styles.coverPlaceholderIcon}>
                  {playlist.id === "liked" ? "❤️" : playlist.id === "recent" ? "🕐" : "📋"}
                </span>
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
              const isMenuOpen = menuSongIdx === idx;
              const isMissing = song.file_path && missingSongs?.has(song.file_path);
              return (
                <div
                  key={idx}
                  style={{
                    ...styles.songItem,
                    ...(isActive ? styles.songItemActive : {}),
                  }}
                  onClick={() => {
                    setMenuSongIdx(null);
                    if (isMissing) {
                      onMissingSongClick?.(song);
                    } else {
                      onPlaySong(idx);
                    }
                  }}
                  className="detail-song-item"
                  onMouseLeave={() => isMenuOpen && setMenuSongIdx(null)}
                >
                  <span style={styles.songIndex}>
                    {isActive && isPlaying ? (
                      <PlayingAnimation />
                    ) : (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                        <span style={{ width: "10px", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                          {(playlists || []).find((p) => p.id === "liked")?.songs?.some((s) => s.url === song.url) && (
                            <FaHeart size={9} style={{ color: "#e94560", flexShrink: 0 }} />
                          )}
                        </span>
                        {song.coverURL ? (
                          <img src={song.coverURL} alt="" style={{ width: "36px", height: "36px", borderRadius: "4px", objectFit: "cover", display: "block" }} />
                        ) : (
                          <span style={{ width: "36px", height: "36px", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center", background: "#e5e7eb", color: "#9ca3af", fontSize: "14px" }}><FaMusic size={14} /></span>
                        )}
                      </span>
                    )}
                  </span>

                  <div style={styles.songInfo}>
                    <span
                      className="detail-song-title"
                      style={{
                        ...styles.songTitle,
                        ...(isActive ? styles.songTitleActive : {}),
                        ...(isMissing ? styles.songTitleMissing : {}),
                      }}
                    >
                      {song.title}
                    </span>
                    <span
                      className="detail-song-artist"
                      style={{
                        ...styles.songArtist,
                        ...(isMissing ? styles.songArtistMissing : {}),
                      }}
                    >
                      {song.artist}
                    </span>
                  </div>

                  <div style={styles.songActions}>
                    <button
                      className="song-action-btn"
                      style={styles.songActionBtn}
                      onClick={(e) => { e.stopPropagation(); setMenuSongIdx(isMenuOpen ? null : idx); }}
                      title="更多操作"
                    >
                      <FaEllipsisH size={14} />
                    </button>
                    {isMenuOpen && (
                      <>
                        <div style={styles.menuOverlay} onClick={(e) => { e.stopPropagation(); setMenuSongIdx(null); }} />
                        <div style={styles.songDropdown} onClick={(e) => e.stopPropagation()}>
                          <button className="song-dropdown-item" style={styles.dropdownItem} onClick={() => { setMenuSongIdx(null); }}>
                            <FaCompactDisc size={14} style={{ marginRight: "10px" }} />
                            专辑
                          </button>
                          <button className="song-dropdown-item" style={styles.dropdownItem} onClick={() => {
                            if (onOpenArtist) { onOpenArtist(song.artist); }
                            setMenuSongIdx(null);
                          }}>
                            <FaUser size={14} style={{ marginRight: "10px" }} />
                            艺人
                          </button>
                          <div style={styles.menuDivider} />
                          <button className="song-dropdown-item" style={styles.dropdownItem} onClick={() => {
                            if (setPlaylists) {
                              setPlaylists((prev) =>
                                prev.map((pl) => {
                                  if (pl.id === "liked") {
                                    const existingUrls = new Set(pl.songs.map((s) => s.url));
                                    if (existingUrls.has(song.url)) {
                                      return { ...pl, songs: pl.songs.filter((s) => s.url !== song.url) };
                                    }
                                    return { ...pl, songs: [...pl.songs, song] };
                                  }
                                  return pl;
                                })
                              );
                            }
                            setMenuSongIdx(null);
                          }}>
                            <FaHeart size={13} style={{ marginRight: "10px", color: (playlists || []).find((p) => p.id === "liked")?.songs?.some((s) => s.url === song.url) ? "#e94560" : undefined }} />
                            {(playlists || []).find((p) => p.id === "liked")?.songs?.some((s) => s.url === song.url) ? "取消喜欢" : "喜欢"}
                          </button>
                          <button className="song-dropdown-item" style={styles.dropdownItem} onClick={() => {
                            setPanelSong(song);
                            setPanelSearch("");
                            setMenuSongIdx(null);
                          }}>
                            <FaPlus size={13} style={{ marginRight: "10px" }} />
                            添加到播放列表
                          </button>
                          <button className="song-dropdown-item" style={styles.dropdownItem} onClick={() => { onPlayNext?.(song); setMenuSongIdx(null); }}>
                            <FaStepForward size={13} style={{ marginRight: "10px" }} />
                            插播
                          </button>
                          <button className="song-dropdown-item" style={styles.dropdownItem} onClick={() => { onPlayLater?.(song); setMenuSongIdx(null); }}>
                            <FaClock size={13} style={{ marginRight: "10px" }} />
                            稍后播放
                          </button>
                          <div style={styles.menuDivider} />
                          <button className="song-dropdown-item" style={styles.dropdownItem} onClick={() => { onRemoveFromPlaylist?.(playlist.id, song); setMenuSongIdx(null); }}>
                            <FaTimes size={13} style={{ marginRight: "10px", color: "#e94560" }} />
                            <span style={{ color: "#e94560" }}>从播放列表删除</span>
                          </button>
                          <button className="song-dropdown-item" style={styles.dropdownItem} onClick={() => { onDeleteSong?.(song, playlist.id); setMenuSongIdx(null); }}>
                            <FaTrash size={13} style={{ marginRight: "10px", color: "#e94560" }} />
                            <span style={{ color: "#e94560" }}>删除</span>
                          </button>
                          <button className="song-dropdown-item" style={styles.dropdownItem} onClick={() => { onEditInfo?.({ type: "song", data: { ...song, albumId: song.albumId } }); setMenuSongIdx(null); }}>
                            <FaInfoCircle size={13} style={{ marginRight: "10px" }} />
                            <span>更多信息</span>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          <div style={styles.songListFooter}>
            <div style={styles.dividerLine} />
            <span style={styles.songCount}>{songs.length} 首</span>
          </div>
          </div>
        )}
      </div>

      {/* ===== 添加到播放列表浮窗 ===== */}
      {panelSong && (
        <div style={styles.panelOverlay} onClick={() => setPanelSong(null)}>
          <div style={styles.playlistPanel} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.panelTitle}>添加到播放列表</h3>
            <input
              style={styles.panelSearch}
              placeholder="搜索播放列表…"
              value={panelSearch}
              onChange={(e) => setPanelSearch(e.target.value)}
              autoFocus
            />
            <div style={styles.panelList}>
              {(() => {
                const userPlaylists = (playlists || []).filter((p) => p.id !== "recent");
                const searched = panelSearch
                  ? userPlaylists.filter((p) => p.name.toLowerCase().includes(panelSearch.toLowerCase()))
                  : userPlaylists;
                const sorted = [...searched].sort((a, b) => {
                  const aHas = a.songs.some((s) => s.url === panelSong.url) ? 1 : 0;
                  const bHas = b.songs.some((s) => s.url === panelSong.url) ? 1 : 0;
                  if (aHas !== bHas) return bHas - aHas;
                  return b.id.localeCompare(a.id);
                });
                return sorted.map((pl) => {
                  const isAlready = pl.songs.some((s) => s.url === panelSong.url);
                  return (
                    <button
                      key={pl.id}
                      style={styles.panelItem}
                      onClick={() => {
                        if (setPlaylists) {
                          setPlaylists((prev) =>
                            prev.map((p) =>
                              p.id === pl.id
                                ? { ...p, songs: p.songs.some((s) => s.url === panelSong.url) ? p.songs : [...p.songs, panelSong] }
                                : p
                            )
                          );
                        }
                        setPanelSong(null);
                      }}
                    >
                      <span style={styles.panelItemIcon}>{pl.id === "liked" ? <FaHeart size={16} /> : "📋"}</span>
                      <span style={styles.panelItemName}>{pl.name}</span>
                      {isAlready && <span style={styles.panelItemTag}>已添加</span>}
                      <span style={styles.panelItemCount}>{pl.songs.length} 首</span>
                    </button>
                  );
                });
              })()}
              {(playlists || []).filter((p) => p.id !== "recent").length === 0 && (
                <p style={styles.panelEmpty}>暂无播放列表</p>
              )}
              {panelSearch && (playlists || []).filter((p) => p.id !== "recent").length > 0 && !(playlists || []).some((p) => p.id !== "recent" && p.name.toLowerCase().includes(panelSearch.toLowerCase())) && (
                <p style={styles.panelEmpty}>未找到匹配的播放列表</p>
              )}
            </div>
          </div>
        </div>
      )}
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
    flex: 1, padding: "130px 170px 120px",
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
    position: "relative",
  },
  songItemActive: {
    background: "rgba(233,69,96,0.12)",
    border: "1px solid rgba(233,69,96,0.25)",
  },
  songIndex: {
    minWidth: "40px", textAlign: "center", flexShrink: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  songInfo: {
    flex: 1, display: "flex", flexDirection: "column", gap: "2px", overflow: "hidden",
  },
  songTitle: {
    fontSize: "14px", fontWeight: 500, color: "#1f2937",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  songTitleActive: { color: "#1f2937", fontWeight: 600 },
  songTitleMissing: { color: "#9ca3af" },
  songArtist: {
    fontSize: "12px", color: "#6b7280",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  songArtistMissing: { color: "#b0b7c3" },
  songActions: {
    position: "relative",
    flexShrink: 0,
    marginLeft: "8px",
  },
  songActionBtn: {
    background: "none", border: "none", cursor: "pointer",
    width: "32px", height: "32px", borderRadius: "50%",
    display: "flex", alignItems: "center", justifyContent: "center",
    color: "#9ca3af", opacity: 0,
    transition: "opacity 0.15s, background 0.15s",
  },
  menuOverlay: {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 999, background: "transparent",
  },
  songDropdown: {
    position: "absolute", left: "100%", top: 0,
    zIndex: 1000, minWidth: "180px", padding: "6px",
    borderRadius: "10px", background: "#ffffff",
    boxShadow: "0 8px 30px rgba(0,0,0,0.15)",
    border: "1px solid #e5e7eb",
  },
  dropdownItem: {
    display: "flex", alignItems: "center",
    padding: "8px 14px", borderRadius: "8px",
    border: "none", background: "none",
    fontSize: "13px", color: "#374151", fontWeight: 500,
    cursor: "pointer", width: "100%", textAlign: "left",
    fontFamily: "inherit", whiteSpace: "nowrap",
    transition: "background 0.15s",
  },
  menuDivider: {
    height: "1px", background: "#e5e7eb",
    margin: "4px 8px",
  },
  songListFooter: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "6px",
    marginTop: "10px",
    paddingTop: "10px",
    flexShrink: 0,
  },
  dividerLine: {
    width: "250px",
    height: "2px",
    borderRadius: "2px",
    background: "#d1d5db",
    flexShrink: 0,
  },
  songCount: { fontSize: "13px", color: "#6b7280" },

  // 空状态
  emptySongs: {
    display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", gap: "8px", padding: "60px 20px",
  },
  emptyIcon: { fontSize: "48px", opacity: 0.3 },
  emptyText: { fontSize: "16px", color: "#374151", fontWeight: 500, margin: 0 },
  emptyHint: { fontSize: "13px", color: "#6b7280", margin: 0 },

  // ===== 播放列表面板 =====
  panelOverlay: {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
    background: "rgba(0,0,0,0.6)", zIndex: 1000,
    display: "flex", alignItems: "center", justifyContent: "center",
    backdropFilter: "blur(4px)",
  },
  playlistPanel: {
    width: "360px", maxHeight: "70vh",
    background: "#1a1a2e", borderRadius: "16px",
    padding: "24px", display: "flex", flexDirection: "column",
    gap: "12px", boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
    overflow: "hidden",
  },
  panelTitle: {
    fontSize: "18px", fontWeight: 700, color: "#ffffff", margin: 0,
  },
  panelSearch: {
    padding: "10px 14px", borderRadius: "10px",
    border: "1px solid rgba(255,255,255,0.15)",
    background: "rgba(255,255,255,0.08)",
    color: "#e0e0e0", fontSize: "14px", outline: "none",
    fontFamily: "inherit", width: "100%", boxSizing: "border-box",
  },
  panelList: {
    display: "flex", flexDirection: "column",
    gap: "6px", overflowY: "auto", maxHeight: "60vh",
  },
  panelItem: {
    display: "flex", alignItems: "center", gap: "10px",
    padding: "12px 14px", border: "none", borderRadius: "10px",
    background: "rgba(255,255,255,0.06)", color: "#e0e0e0",
    fontSize: "14px", cursor: "pointer", fontFamily: "inherit",
    textAlign: "left", width: "100%", transition: "background 0.2s",
  },
  panelItemIcon: { fontSize: "18px", flexShrink: 0 },
  panelItemName: { flex: 1, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  panelItemTag: { fontSize: "11px", color: "#10b981", fontWeight: 600, flexShrink: 0 },
  panelItemCount: { fontSize: "12px", color: "#9ca3af", flexShrink: 0 },
  panelEmpty: { color: "#6b7280", fontSize: "14px", textAlign: "center", padding: "24px 0", margin: 0 },
};
