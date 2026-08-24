import { useEffect, useRef, useState } from "react";
import { FaPlay, FaPause, FaArrowLeft, FaEdit, FaEllipsisH, FaHeart, FaPlus, FaStepForward, FaClock, FaCompactDisc, FaUser, FaTrash, FaInfoCircle, FaTimes, FaMusic, FaExclamationCircle, FaSearch, FaSort } from "react-icons/fa";
import PlayingAnimation from "../components/PlayingAnimation";
import { songPlayable } from "../utils/formatCheck";
import useCoverColor from "../components/CoverColor";
import AlbumDescriptionModal from "../components/AlbumDescriptionModal";

/* ================================================================
   📋 PlaylistDetail — 播放列表详情页
   布局与 AlbumDetail 一致：
   - 播放全部按钮旁有「编辑」按钮（点击打开编辑弹窗，liked/recent 不显示）
   - liked/recent 封面使用首歌封面 + 取色覆盖 + 右下角标题
   - 歌曲列表支持搜索（按标题）
   ================================================================ */
export default function PlaylistDetail({
  playlist,
  playlists,
  setPlaylists,
  onEditPlaylist,
  onDeletePlaylist,
  currentSongIndex,
  isPlaying,
  onPlayAll,
  onPlaySong,
  onBack,
  onPlayNext,
  onPlayLater,
  onOpenAlbum,
  onOpenArtist,
  onRemoveFromPlaylist,
  onDeleteSong,
  onEditInfo,
  missingSongs,
  onMissingSongClick,
}) {
  const [menuSongIdx, setMenuSongIdx] = useState(null);
  const [panelSong, setPanelSong] = useState(null);
  const [panelSearch, setPanelSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [playlistActionOpen, setPlaylistActionOpen] = useState(false);
  const [descriptionOverflow, setDescriptionOverflow] = useState(false);
  const [showDescriptionModal, setShowDescriptionModal] = useState(false);
  const [filterMode, setFilterMode] = useState(null); // null | "name" | "artist" | "year" | "added"
  const [filterDir, setFilterDir] = useState("asc"); // "asc" | "desc"
  const searchInputRef = useRef(null);
  const descriptionRef = useRef(null);

  // ---------- 获取播放列表的歌曲 ----------
  const songs = playlist?.songs || [];

  // 封面：优先 playlist.coverURL，否则用第一首歌封面
  const firstSongCover = songs[0]?.coverURL || null;
  const coverSrc = playlist?.coverURL || firstSongCover || null;
  // liked/recent 始终启用封面样式；其他播放列表由 coverStyle 开关控制
  const coverStyleEnabled = playlist?.id === "liked" || playlist?.id === "recent" || !!playlist?.coverStyle;
  const palette = useCoverColor(coverSrc || null);
  const themeSwatch = palette?.Vibrant || palette?.Muted || palette?.DarkVibrant || palette?.LightVibrant || null;
  const themeColor = themeSwatch ? themeSwatch.hex : null;
  const coverGlowStyle = themeColor ? { background: themeColor, filter: "blur(60px)" } : {};
  const description = typeof playlist?.description === "string" ? playlist.description.trim() : "";

  useEffect(() => {
    const element = descriptionRef.current;
    if (!element || !description) { setDescriptionOverflow(false); return undefined; }
    const measure = () => setDescriptionOverflow(element.scrollHeight > element.clientHeight + 1);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [description]);

  // 保留原始索引，避免搜索或排序后按展示索引播放到错误歌曲。
  // “我喜欢”默认按最新喜欢排序，其余播放列表默认保持添加顺序。
  const sortedSongs = (() => {
    const arr = songs.map((song, sourceIndex) => ({ song, sourceIndex }));
    if (!filterMode) return playlist?.id === "liked" ? arr.reverse() : arr;
    const dir = filterDir === "asc" ? 1 : -1;
    if (filterMode === "added") {
      // 添加顺序：正序 = 原顺序，倒序 = 逆序
      return dir === 1 ? arr : arr.reverse();
    }
    arr.sort((a, b) => {
      let cmp = 0;
      if (filterMode === "name") cmp = (a.song.title || "").localeCompare(b.song.title || "", "zh-CN");
      else if (filterMode === "artist") cmp = (a.song.artist || "").localeCompare(b.song.artist || "", "zh-CN");
      else if (filterMode === "year") cmp = ((a.song.year || 0) - (b.song.year || 0));
      return cmp * dir;
    });
    return arr;
  })();

  // 搜索：先按排序规则排列，再按标题过滤
  const filteredSongs = searchText.trim()
    ? sortedSongs.filter(({ song }) => (song.title || "").toLowerCase().includes(searchText.trim().toLowerCase()))
    : sortedSongs;

  function handleFilterPick(mode) {
    if (filterMode === mode) {
      setFilterDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setFilterMode(mode);
      setFilterDir("asc");
    }
  }
  const filterArrow = (mode) => (filterMode === mode ? (filterDir === "asc" ? " ↑" : " ↓") : "");

  // 搜索框：无输入内容离开收起；有输入内容不收起
  function handleSearchBlur() {
    if (!searchText.trim()) {
      setSearchOpen(false);
    }
  }
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  if (!playlist) return null;

  return (
    <div style={styles.container} className="playlist-detail-page">
      <button style={styles.backBtn} onClick={onBack} title="返回">
        <FaArrowLeft size={18} />
      </button>

            {/* 上半部分：左=封面 | 右=信息 */}
      <div style={{ ...styles.topSection, ...(description ? styles.topSectionWithDescription : {}) }}>
        {/* 左：封面（独立） */}
        <div style={styles.coverColumn}>
          {themeColor && coverStyleEnabled && <div style={{ ...styles.coverGlowLayer, ...coverGlowStyle }} />}
          <div style={styles.coverWrapper}>
            <div style={styles.coverPlaceholder}>
              <span style={styles.coverPlaceholderIcon}>
                {playlist.id === "liked" ? "❤️" : playlist.id === "recent" ? "🕐" : "📋"}
              </span>
            </div>
            {coverSrc && (
              <img
                src={coverSrc}
                alt={playlist.name}
                onError={(e) => { e.currentTarget.style.display = "none"; }}
                style={{ ...styles.cover, position: "absolute", inset: 0 }}
              />
            )}
            {coverStyleEnabled && coverSrc && themeColor && (
              <div style={{ ...styles.coverOverlay, background: themeColor }} />
            )}
            {coverStyleEnabled && coverSrc && (
              <div style={styles.coverTitleOverlay}>
                <span style={styles.coverTitle}>{playlist.name}</span>
              </div>
            )}
          </div>
        </div>

        {/* 右：信息区（独立，可自由增删） */}
        <div style={{ ...styles.infoColumn, ...(description ? styles.infoColumnWithDescription : {}) }}>
          <h1 style={styles.playlistTitle}>{playlist.name}</h1>
          {description && (
            <button type="button" style={styles.descriptionButton} onClick={() => setShowDescriptionModal(true)} title="查看播放列表详情">
              <span ref={descriptionRef} style={styles.descriptionText}>{description}</span>
              {descriptionOverflow && <span style={styles.descriptionHint}>更多</span>}
            </button>
          )}
          <p style={styles.playlistMeta}>
            {songs.length > 0 ? `${songs.length} 首歌曲` : "暂无歌曲"}
          </p>
          <div style={styles.actionRow}>
            <button
              style={{
                ...styles.playButton,
                ...(themeColor ? { background: themeColor, boxShadow: `0 6px 20px ${themeColor}55` } : {}),
              }}
              onClick={() => onPlayAll?.(playlist.id === "liked")}
            >
              {isPlaying ? (
                <FaPause size={16} />
              ) : (
                <FaPlay size={16} />
              )}
            </button>
            {playlist.id !== "liked" && playlist.id !== "recent" && (
              <div style={styles.playlistActionMenu}>
                <button
                  className="song-action-btn"
                  style={{ ...styles.songActionBtn, opacity: 1 }}
                  onClick={() => setPlaylistActionOpen((open) => !open)}
                  title="更多操作"
                >
                  <FaEllipsisH size={17} />
                </button>
                {playlistActionOpen && (
                  <>
                    <div style={styles.menuOverlay} onClick={() => setPlaylistActionOpen(false)} />
                    <div style={{ ...styles.songDropdown, top: "calc(100% + 6px)", right: 0 }}>
                      <button className="song-dropdown-item" style={styles.dropdownItem} onClick={() => { onEditPlaylist?.(playlist); setPlaylistActionOpen(false); }}>
                        <FaEdit size={14} style={{ marginRight: "10px" }} />
                        编辑
                      </button>
                      <button className="song-dropdown-item" style={{ ...styles.dropdownItem, color: "#e94560" }} onClick={() => { onDeletePlaylist?.(playlist.id); setPlaylistActionOpen(false); }}>
                        <FaTrash size={14} style={{ marginRight: "10px" }} />
                        删除
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showDescriptionModal && <AlbumDescriptionModal
        playlist={{ ...playlist, coverURL: coverSrc }}
        isPlaying={isPlaying}
        themeColor={themeColor}
        onPlayPlaylist={() => onPlayAll?.(playlist.id === "liked")}
        onClose={() => setShowDescriptionModal(false)}
      />}

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
            {/* 搜索栏：有音乐才显示，点击展开，无输入离开收起 */}
            <div style={styles.searchBar}>
              {searchOpen ? (
                <input
                  ref={searchInputRef}
                  style={styles.searchInput}
                  placeholder="搜索歌曲"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  onBlur={handleSearchBlur}
                  onKeyDown={(e) => { if (e.key === "Escape") { setSearchText(""); setSearchOpen(false); } }}
                />
              ) : (
                <button style={styles.searchBtn} onClick={() => setSearchOpen(true)} title="搜索歌曲">
                  <FaSearch size={14} />
                </button>
              )}
              <div style={{ position: "relative" }}>
                <button style={{ ...styles.searchBtn, marginLeft: "8px" }} onClick={() => setFilterOpen((v) => !v)} title="过滤排序">
                  <FaSort size={14} />
                </button>
                {filterOpen && (
                  <>
                    <div style={styles.filterOverlay} onClick={() => setFilterOpen(false)} />
                    <div style={styles.filterMenu}>
                      <button style={styles.filterItem} onClick={() => handleFilterPick("name")}>按名称（A-Z）{filterArrow("name")}</button>
                      <button style={styles.filterItem} onClick={() => handleFilterPick("artist")}>按艺人（A-Z）{filterArrow("artist")}</button>
                      <button style={styles.filterItem} onClick={() => handleFilterPick("year")}>按时间（专辑年份）{filterArrow("year")}</button>
                      <button style={styles.filterItem} onClick={() => handleFilterPick("added")}>按添加顺序{filterArrow("added")}</button>
                    </div>
                  </>
                )}
              </div>
            </div>
            {filteredSongs.length === 0 && searchText.trim() ? (
              <div style={styles.searchEmpty}>
                <p style={styles.emptyText}>未找到匹配的歌曲</p>
              </div>
            ) : (
              filteredSongs.map(({ song, sourceIndex }) => {
              const isActive = sourceIndex === currentSongIndex;
              const isMenuOpen = menuSongIdx === sourceIndex;
              const isMissing = song.file_path && missingSongs?.has(song.file_path);
              return (
                <div
                  key={song.file_path || song.url || sourceIndex}
                  style={{
                    ...styles.songItem,
                    ...(isActive ? styles.songItemActive : {}),
                  }}
                  onClick={() => {
                    setMenuSongIdx(null);
                    if (isMissing) {
                      onMissingSongClick?.(song);
                    } else {
                      onPlaySong(sourceIndex);
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
                        <span style={{ width: "10px", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                          {(playlists || []).find((p) => p.id === "liked")?.songs?.some((s) => s.url === song.url) && (
                            <FaHeart size={9} style={{ color: "#e94560", flexShrink: 0 }} />
                          )}
                        </span>
                        <span style={{ position: "relative", width: "36px", height: "36px", borderRadius: "4px", display: "inline-flex", alignItems: "center", justifyContent: "center", background: "#e5e7eb", color: "#9ca3af", fontSize: "14px" }}>
                          <FaMusic size={14} />
                          {song.coverURL && (
                            <img
                              src={song.coverURL}
                              alt=""
                              onError={(e) => { e.currentTarget.style.display = "none"; }}
                              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", borderRadius: "4px", objectFit: "cover", display: "block" }}
                            />
                          )}
                        </span>
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
                      onClick={(e) => { e.stopPropagation(); setMenuSongIdx(isMenuOpen ? null : sourceIndex); }}
                      title="更多操作"
                    >
                      <FaEllipsisH size={14} />
                    </button>
                    {isMenuOpen && (
                      <>
                        <div style={styles.menuOverlay} onClick={(e) => { e.stopPropagation(); setMenuSongIdx(null); }} />
                        <div style={styles.songDropdown} onClick={(e) => e.stopPropagation()}>
                          <button className="song-dropdown-item" style={styles.dropdownItem} onClick={() => { onOpenAlbum?.(song); setMenuSongIdx(null); }}>
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
              })
            )}
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
      gap: "5px",
      background: "#ffffff",
      color: "#1f2937",
      fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
      position: "relative",
      overflowY: "auto",
    },

  backBtn: {
    // 与 AlbumDetail 保持相同的容器内定位，随详情页显示但不脱离页面边界。
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
  topSectionWithDescription: { alignItems: "center", gap: "56px" },

  // 左列：封面（固定宽高，不受右侧影响）
  coverColumn: {
    flex: "0 0 300px",
    alignSelf: "flex-start",
    position: "relative",
  },
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
    width: "300px",
    height: "300px",
    borderRadius: "12px",
    overflow: "hidden",
    boxShadow: "0 16px 48px rgba(0,0,0,0.5), 0 0 30px rgba(233,69,96,0.08)",
    position: "relative",
    zIndex: 1,
  },
  cover: {
    width: "100%", height: "100%", objectFit: "cover", display: "block",
  },
  coverOverlay: {
    position: "absolute", inset: 0, zIndex: 2, opacity: 0.35, pointerEvents: "none",
  },
  coverTitleOverlay: {
    position: "absolute", right: "12px", bottom: "12px", left: "12px", zIndex: 3,
    display: "flex", justifyContent: "flex-end",
  },
  coverTitle: {
    color: "#ffffff", fontSize: "25px", fontWeight: 600, textShadow: "0 1px 6px rgba(0,0,0,0.6)",
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  },
  coverPlaceholder: {
    width: "100%", height: "100%", display: "flex",
    alignItems: "center", justifyContent: "center",
    background: "#e5e7eb",
  },
  coverPlaceholderIcon: { fontSize: "64px", opacity: 0.3 },

  // 右列：信息区（纵向排列，后续可自由新增内容）
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
  infoColumnWithDescription: { top: 0, left: 0, width: "min(520px, 100%)", maxWidth: "100%" },
  playlistTitle: {
    fontSize: "32px", fontWeight: 700, color: "#1f2937",
    margin: 0, lineHeight: 1.2,
  },
  descriptionButton: { display: "block", width: "100%", maxWidth: "100%", boxSizing: "border-box", padding: 0, margin: "14px 0 4px", overflow: "hidden", border: "none", background: "transparent", color: "#6b7280", textAlign: "left", cursor: "pointer", font: "inherit" },
  descriptionText: { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 3, width: "100%", maxWidth: "100%", overflow: "hidden", overflowWrap: "anywhere", wordBreak: "break-word", lineHeight: 1.7, fontSize: "13px", whiteSpace: "pre-wrap" },
  descriptionHint: { display: "inline-block", marginTop: "4px", color: "#e94560", fontSize: "12px" },
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

        bottomSection: {
    flex: "0 0 auto", padding: "60px 170px 120px",
    display: "flex", flexDirection: "column", minHeight: 0, overflow: "visible",
  },

  songList: {
    flex: 1, display: "flex", flexDirection: "column",
    gap: "2px", paddingRight: "4px",
  },
  searchBar: {
    display: "flex", justifyContent: "flex-end", marginBottom: "6px",
  },
  searchBtn: {
    width: "34px", height: "34px", borderRadius: "50%",
    border: "1px solid #e5e7eb", background: "#f3f4f6",
    color: "#6b7280", cursor: "pointer", display: "flex",
    alignItems: "center", justifyContent: "center",
  },
  searchInput: {
    width: "220px", padding: "7px 12px", borderRadius: "16px",
    border: "1px solid #e5e7eb", background: "#f9fafb",
    fontSize: "13px", color: "#1f2937", outline: "none", fontFamily: "inherit",
  },
  searchEmpty: {
    padding: "30px 0", textAlign: "center",
  },
  filterOverlay: {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 999, background: "transparent",
  },
  filterMenu: {
    position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 1000,
    minWidth: "180px", padding: "6px", borderRadius: "10px",
    background: "#ffffff", boxShadow: "0 12px 40px rgba(0,0,0,0.18)",
    border: "1px solid #e5e7eb",
  },
  filterItem: {
    display: "block", width: "100%", textAlign: "left",
    padding: "8px 12px", borderRadius: "6px",
    border: "none", background: "transparent", cursor: "pointer",
    fontSize: "13px", color: "#374151", fontFamily: "inherit",
    whiteSpace: "nowrap",
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
  playlistActionMenu: { position: "relative", flexShrink: 0 },
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
