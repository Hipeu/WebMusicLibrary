import { useEffect, useRef, useState } from "react";
import { FaPlay, FaPause, FaArrowLeft, FaEllipsisH, FaHeart, FaStepForward, FaClock, FaPlus, FaTrash, FaInfoCircle, FaExclamationCircle } from "react-icons/fa";
import PlayingAnimation from "../components/PlayingAnimation";
import useCoverColor from "../components/CoverColor";
import { songPlayable } from "../utils/formatCheck";
import { getAssetUrl } from "../services/api";
import AlbumDescriptionModal from "../components/AlbumDescriptionModal";

/* ================================================================
   📀 AlbumDetail — 专辑详情页
   布局：上半部分（~50%）= 封面+信息+播放按钮
         下半部分（~50%）= 歌曲列表
   ================================================================ */
export default function AlbumDetail({
  album,
  playlists,
  setPlaylists,
  currentSongIndex,
  isPlaying,
  onPlayAlbum,
  onPlaySong,
  onBack,
  onOpenArtist,
  onPlayNext,
  onPlayLater,
  onDeleteAlbum,
  onEditInfo,
  onDeleteSong,
  missingSongs,
  onMissingSongClick,
  artistRecords,
}) {
  const [menuSongIdx, setMenuSongIdx] = useState(null);
  const [panelSong, setPanelSong] = useState(null);
  const [panelSearch, setPanelSearch] = useState("");
  const [showAlbumMenu, setShowAlbumMenu] = useState(false);
  const [descriptionOverflow, setDescriptionOverflow] = useState(false);
  const [showDescriptionModal, setShowDescriptionModal] = useState(false);
  const descriptionRef = useRef(null);

  const palette = useCoverColor(album?.coverURL || null);

  if (!album) return null;

  const yearText = album.year ? `${album.year}` : "未知年份";
  const genreText = album.genre || null;
  const description = typeof album.description === "string" ? album.description.trim() : "";

  useEffect(() => {
    const element = descriptionRef.current;
    if (!element || !description) {
      setDescriptionOverflow(false);
      return undefined;
    }
    const measure = () => setDescriptionOverflow(element.scrollHeight > element.clientHeight + 1);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [description]);

  // 艺人头像：仅当匹配到艺人封面时显示
  const artistAvatarUrl = artistRecords?.[album.artist]?.cover_url
    ? getAssetUrl(artistRecords[album.artist].cover_url)
    : null;

  // 从封面提取动态主题色（用于封面光晕）
  const themeSwatch = palette?.Vibrant || palette?.Muted || palette?.DarkVibrant || palette?.LightVibrant || null;
  const themeColor = themeSwatch ? themeSwatch.hex : null;
  // 整张专辑是否全部缺失
  const albumAllMissing = (album.songs || []).length > 0 &&
    (album.songs || []).every((s) => s.file_path && missingSongs?.has(s.file_path));
  // 仅围绕封面：模糊实心方块向外扩散，颜色逐渐消失
  const coverGlowStyle = themeColor
    ? {
        background: themeColor,
        filter: "blur(60px)",
      }
    : {};

  function closeMenu() { setMenuSongIdx(null); }

  return (
    <div style={styles.container} className="album-detail-page">
      <button style={styles.backBtn} onClick={onBack} title="返回">
        <FaArrowLeft size={18} />
      </button>

            {/* 上半部分：左=封面 | 右=信息 */}
      <div
        style={{ ...styles.topSection, ...(description ? styles.topSectionWithDescription : {}) }}
        className="album-top"
      >
        {/* 左：封面图（独立，不受右侧影响） */}
        <div style={styles.coverColumn}>
          {themeColor && <div style={{ ...styles.coverGlowLayer, ...coverGlowStyle }} />}
          <div style={styles.coverWrapper}>
            <div style={styles.coverPlaceholder}>
              <span style={styles.coverPlaceholderIcon}>🎶</span>
            </div>
            {album.coverURL && (
              <img
                src={album.coverURL}
                alt={album.title}
                onError={(e) => { e.currentTarget.style.display = "none"; }}
                style={{ ...styles.cover, position: "absolute", inset: 0 }}
              />
            )}
            {albumAllMissing && <div style={styles.coverMissingOverlay} />}
          </div>
        </div>

        {/* 右：信息区（独立，可自由增删内容） */}
        <div style={{ ...styles.infoColumn, ...(description ? styles.infoColumnWithDescription : {}) }}>
          <h1 style={styles.albumTitle}>{album.title}</h1>
          <p style={styles.albumArtist}>
            {artistAvatarUrl && (
              <img src={artistAvatarUrl} alt="" style={styles.artistAvatar} onError={(e) => { e.currentTarget.style.display = "none"; }} />
            )}
            {onOpenArtist ? (
              <span
                style={styles.artistLink}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenArtist(album.artist);
                }}
                title="查看艺人详情"
              >
                {album.artist}
              </span>
            ) : (
              album.artist
            )}
          </p>
          <p style={styles.albumYear}>
            {yearText}年
            {genreText && <><span style={styles.yearGenreSep}>·</span><span style={styles.albumGenre}>{genreText}</span></>}
          </p>
          {description && (
            <button
              type="button"
              style={styles.descriptionButton}
              onClick={() => setShowDescriptionModal(true)}
              title="查看专辑详情"
            >
              <span ref={descriptionRef} style={styles.descriptionText}>
                {description}
              </span>
              {descriptionOverflow && <span style={styles.descriptionHint}>更多</span>}
            </button>
          )}
                    <div style={styles.actionRow}>
                      <button
                        style={{
                          ...styles.playButton,
                          ...(themeColor ? {
                            background: themeColor,
                            boxShadow: `0 6px 20px ${themeColor}55`,
                          } : {}),
                        }}
                        onClick={onPlayAlbum}
                      >
                        {isPlaying ? (
                          <FaPause size={16} /> 
                        ) : (
                          <FaPlay size={16} />
                        )}
                      </button>
                      <div style={{ position: "relative" }}>
                        <button
                          style={styles.menuTriggerBtn}
                          onClick={() => setShowAlbumMenu((v) => !v)}
                          title="更多"
                        >
                          <FaEllipsisH size={16} />
                        </button>
                        {showAlbumMenu && (
                          <>
                            <div style={styles.menuOverlay} onClick={() => setShowAlbumMenu(false)} />
                            <div style={styles.albumDropdown}>
                              <button
                                className="song-dropdown-item"
                                style={styles.dropdownItem}
                                onClick={() => { setShowAlbumMenu(false); onDeleteAlbum?.(album.id); }}
                              >
                                <FaTrash size={13} style={{ marginRight: "10px", color: "#e94560" }} />
                                <span style={{ color: "#e94560" }}>删除</span>
                              </button>
                              <button
                                className="song-dropdown-item"
                                style={styles.dropdownItem}
                                onClick={() => { setShowAlbumMenu(false); onEditInfo?.({ type: "album", data: album }); }}
                              >
                                <FaInfoCircle size={13} style={{ marginRight: "10px" }} />
                                <span>更多信息</span>
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
        </div>
      </div>


      {/* 下半部分：歌曲列表 */}
      <div style={styles.bottomSection} className="album-bottom">
        <div style={styles.songList}>
          {(() => {
            // 按碟号 + 音轨号排序（无碟号视为第 1 碟，无音轨号排最后）
            const sorted = album.songs
              .map((s, i) => ({ song: s, originalIndex: i }))
              .sort((a, b) => {
                const da = a.song.discNo ?? 1;
                const db = b.song.discNo ?? 1;
                if (da !== db) return da - db;
                const ta = a.song.trackNo ?? 9999;
                const tb = b.song.trackNo ?? 9999;
                return ta - tb;
              });
            const likedUrls = (playlists || []).find((p) => p.id === "liked")?.songs?.map((s) => s.url) || [];
            const discs = [...new Set(sorted.map(({ song }) => song.discNo ?? 1))].sort((a, b) => a - b);
            const multiDisc = discs.length > 1;
            const displayNumber = (song, fallbackIdx) => (song.trackNo != null ? song.trackNo : fallbackIdx);
            const renderSong = ({ song, originalIndex }, displayIndex) => {
              const isActive = originalIndex === currentSongIndex;
              const isMenuOpen = menuSongIdx === originalIndex;
              const isLiked = likedUrls.includes(song.url);
              const isMissing = song.file_path && missingSongs?.has(song.file_path);
              return (
                <div
                  key={originalIndex}
                  style={{
                    ...styles.songItem,
                    ...(isActive ? styles.songItemActive : {}),
                  }}
                  onClick={() => {
                    closeMenu();
                    if (isMissing) {
                      onMissingSongClick?.(song);
                    } else {
                      onPlaySong(originalIndex);
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
                        {!songPlayable(song) && (
                          <FaExclamationCircle size={12} title="该格式无法播放" style={{ color: "#f59e0b", flexShrink: 0 }} />
                        )}
                        <span style={{ width: "12px", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                          {isLiked && <FaHeart size={10} style={{ color: "#e94560", flexShrink: 0 }} />}
                        </span>
                        {String(displayIndex).padStart(2, "0")}
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
                    onClick={(e) => { e.stopPropagation(); setMenuSongIdx(isMenuOpen ? null : originalIndex); }}
                    title="更多操作"
                  >
                    <FaEllipsisH size={14} />
                  </button>
                  {isMenuOpen && (
                    <>
                      <div style={styles.menuOverlay} onClick={(e) => { e.stopPropagation(); closeMenu(); }} />
                      <div style={styles.songDropdown} onClick={(e) => e.stopPropagation()}>
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
                          closeMenu();
                        }}>
                          <FaHeart size={13} style={{ marginRight: "10px", color: (playlists || []).find((p) => p.id === "liked")?.songs?.some((s) => s.url === song.url) ? "#e94560" : undefined }} />
                          {(playlists || []).find((p) => p.id === "liked")?.songs?.some((s) => s.url === song.url) ? "取消喜欢" : "喜欢"}
                        </button>
                        <button className="song-dropdown-item" style={styles.dropdownItem} onClick={() => {
                          setPanelSong(song);
                          setPanelSearch("");
                          closeMenu();
                        }}>
                          <FaPlus size={13} style={{ marginRight: "10px" }} />
                          添加到播放列表
                        </button>
                        <button className="song-dropdown-item" style={styles.dropdownItem} onClick={() => { onPlayNext?.(song, album.id, originalIndex); closeMenu(); }}>
                          <FaStepForward size={13} style={{ marginRight: "10px" }} />
                          插播
                        </button>
                        <button className="song-dropdown-item" style={styles.dropdownItem} onClick={() => { onPlayLater?.(song, album.id, originalIndex); closeMenu(); }}>
                          <FaClock size={13} style={{ marginRight: "10px" }} />
                          稍后播放
                        </button>
                        <div style={styles.menuDivider} />
                        <button className="song-dropdown-item" style={styles.dropdownItem} onClick={() => { onDeleteSong?.(song, album.id); closeMenu(); }}>
                          <FaTrash size={13} style={{ marginRight: "10px", color: "#e94560" }} />
                          <span style={{ color: "#e94560" }}>删除</span>
                        </button>
                        <button className="song-dropdown-item" style={styles.dropdownItem} onClick={() => { onEditInfo?.({ type: "song", data: { ...song, albumId: album.id } }); closeMenu(); }}>
                          <FaInfoCircle size={13} style={{ marginRight: "10px" }} />
                          <span>更多信息</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
            };
            if (!multiDisc) {
              // 单碟（或无碟信息）：保持原有展示
              return sorted.map((item) => renderSong(item, displayNumber(item.song, item.originalIndex + 1)));
            }
            // 多碟：按碟分组展示
            return discs.map((disc) => (
              <div key={disc} style={styles.discGroup}>
                <div style={styles.discHeader}>Disc {String(disc).padStart(2, "0")}</div>
                {sorted
                  .filter(({ song }) => (song.discNo ?? 1) === disc)
                  .map((item, i) => renderSong(item, displayNumber(item.song, i + 1)))}
              </div>
            ));
          })()}
          <div style={styles.songListHeader}>
            <div style={styles.dividerLine} />
            <div style={styles.songMetaRow}>
              {album.publisher && (
                <span style={styles.songMetaText}>{album.publisher}</span>
              )}
              <span style={styles.songCount}>{album.songs.length} 首</span>
            </div>
          </div>
        </div>
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
      {showDescriptionModal && (
        <AlbumDescriptionModal
          album={album}
          isPlaying={isPlaying}
          themeColor={themeColor}
          onPlayAlbum={onPlayAlbum}
          onClose={() => setShowDescriptionModal(false)}
        />
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
      gap: "5px",
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
    flex: "0 0 auto",
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "65px",
    padding: "80px 60px 20px 210px",
    minHeight: 0,
  },
  topSectionWithDescription: {
    alignItems: "center",
    gap: "56px",
  },

    // 左列：封面（固定宽高，不受右侧影响）
    coverColumn: {
      flex: "0 0 300px",
      alignSelf: "flex-start",
      position: "relative",
    },
    // 封面光晕层（模糊实心方块向外扩散）
    coverGlowLayer: {
      position: "absolute",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      width: "260px",
      height: "260px",
      borderRadius: "12px",
      opacity: 0.9,
      pointerEvents: "none",
      zIndex: 0,
      animation: "glowFadeIn 0.8s ease",
    },
    coverWrapper: {
      position: "relative",
      zIndex: 1,
      width: "300px",
      height: "300px",
      borderRadius: "12px",
      overflow: "hidden",
      boxShadow: "0 16px 48px rgba(0,0,0,0.5), 0 0 30px rgba(233,69,96,0.08)",
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

    // 右列：信息区（纵向排列，后续新增内容直接往里加）
infoColumn: {
  display: "flex",
  flexDirection: "column",
  gap: "15px",
  minWidth: 0,
  alignSelf: "flex-start",
  position: "relative",
  top: "90px",     
  left: "5px",    
},
  infoColumnWithDescription: {
    top: 0,
    left: 0,
    width: "min(520px, 100%)",
    maxWidth: "100%",
  },
  albumTitle: {
        fontSize: "32px", fontWeight: 700, color: "#1f2937",
    margin: 0, lineHeight: 1.2,
  },
    albumArtist: {
    fontSize: "18px", color: "#6b7280", margin: 0, fontWeight: 400,
    display: "flex", alignItems: "center", gap: "8px",
  },
  artistAvatar: {
    width: "28px", height: "28px", borderRadius: "50%",
    objectFit: "cover", flexShrink: 0,
    border: "1px solid #e5e7eb",
  },
  artistLink: {
    color: "#e94560",
    cursor: "pointer",
    fontWeight: 500,
    textDecoration: "none",
    transition: "color 0.2s",
    borderBottom: "1px solid transparent",
  },
        albumYear: {
    fontSize: "14px", color: "#6b7280", margin: 0,
    display: "flex", alignItems: "center", gap: "6px",
  },
  yearGenreSep: {
    color: "#d1d5db",
  },
    albumGenre: {
    fontSize: "13px", color: "#6b7280",
    padding: "1px 10px",
    borderRadius: "10px",
    background: "#f3f4f6",
    border: "1px solid #e5e7eb",
  },

  actionRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    marginTop: "8px",
  },
  descriptionButton: {
    display: "block", width: "100%", maxWidth: "100%", boxSizing: "border-box",
    padding: 0, margin: "14px 0 4px", overflow: "hidden",
    border: "none", background: "transparent", color: "#6b7280",
    textAlign: "left", cursor: "pointer", font: "inherit",
  },
  descriptionText: {
    display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 3,
    width: "100%", maxWidth: "100%", overflow: "hidden", overflowWrap: "anywhere",
    wordBreak: "break-word", lineHeight: 1.7, fontSize: "13px", whiteSpace: "pre-wrap",
  },
  descriptionHint: {
    display: "inline-block", marginTop: "4px", color: "#e94560", fontSize: "12px",
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

  menuTriggerBtn: {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    border: "1px solid #e5e7eb",
    background: "#f3f4f6",
    color: "#6b7280",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background 0.2s",
  },

  albumDropdown: {
    position: "absolute", right: 0, top: "100%",
    zIndex: 1000, minWidth: "160px", padding: "6px",
    borderRadius: "10px", background: "#ffffff",
    boxShadow: "0 8px 30px rgba(0,0,0,0.15)",
    border: "1px solid #e5e7eb",
  },

    bottomSection: {
    flex: "0 0 auto", padding: "60px 170px 120px",
    display: "flex", flexDirection: "column", minHeight: 0, overflow: "visible",
  },
    songListHeader: {
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

  songListTitle: {
    fontSize: "14px", fontWeight: 600, color: "#6b7280",
    letterSpacing: "1px", textTransform: "uppercase",
  },
  songCount: { fontSize: "13px", color: "#6b7280" },
  songMetaRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap",
  },
  songMetaText: { fontSize: "13px", color: "#6b7280" },

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
  discGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  discHeader: {
    fontSize: "14px",
    fontWeight: 600,
    color: "#6b7280",
    letterSpacing: "1px",
    margin: "14px 0 6px",
    paddingLeft: "6px",
  },
  songIndex: {
    fontSize: "13px", color: "#6b7280",
    fontVariantNumeric: "tabular-nums",
    minWidth: "42px", textAlign: "center", flexShrink: 0,
  },
  playingIcon: { fontSize: "14px" },
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
  coverMissingOverlay: {
    position: "absolute",
    inset: 0,
    background: "rgba(128,128,128,0.55)",
    zIndex: 2,
    pointerEvents: "none",
  },
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
    position: "absolute", right: 0, top: "100%",
    zIndex: 1000, minWidth: "160px", padding: "6px",
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
    nowPlayingBadge: {
    fontSize: "11px", color: "#e94560", fontWeight: 500,
    flexShrink: 0, padding: "2px 10px", borderRadius: "12px",
    background: "rgba(233,69,96,0.1)",
  },

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


