import { useState } from "react";
import { FaArrowLeft, FaPen, FaChevronRight } from "react-icons/fa";
import CoverPlayButton from "../components/CoverPlayButton";
import { getAssetUrl } from "../services/api";
import { loadPlayCounts, songPlayKey } from "../utils/playCount";
import { splitArtists, isLiveAlbum, isPrimaryAlbum } from "../utils/artistSplit";
import ExplicitTitle from "../components/ExplicitTitle";

function normalizeCoverPosition(position) {
  const clamp = (value) => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 50));
  return { x: clamp(Number(position?.x ?? 50)), y: clamp(Number(position?.y ?? 50)) };
}

/* ================================================================
   🎤 ArtistsDetail — 艺人详情页
   布局：
     ① 顶部：艺人照片（长方形铺满横幅）
     ② 新入库（未播放过的歌曲，按入库时间从新到旧，一排）
     ③ 歌曲（3×3 网格，按播放次数 → 最近导入时间；> 查看全部）
     ④ 专辑（一排横向卡片，按年份；查看全部专辑入口）
     ⑤ 底部：艺人简介（仅在有内容时显示）
   ================================================================ */
export default function ArtistsDetail({
  artist,
  albums,
  record,
  currentAlbumId,
  currentSongIndex,
  isPlaying,
  onPlayAlbum,
  onPlaySong,
  onBack,
  onOpenAlbum,
  onEditArtist,
}) {
  const [bannerImgError, setBannerImgError] = useState(false);
  const [subView, setSubView] = useState(null); // null | "songs" | "albums"（全部歌曲 / 全部专辑子页）
if (!artist) return null;

  // 自动整理合作艺人：开启时分类为 专辑/合作音乐/现场；关闭时维持单列表
  const autoOrganize = localStorage.getItem("edit-auto-organize-collab") !== "false";

  // 按年份排序专辑（降序：从新到旧）
  const sortedAlbums = [...albums].sort((a, b) => {
    const yearA = a.year || 0;
    const yearB = b.year || 0;
    return yearB - yearA;
  });

  // 分类（仅自动整理开启时）
  const primaryAlbums = autoOrganize ? sortedAlbums.filter((a) => isPrimaryAlbum(a, artist)) : [];
  const collabAlbums = autoOrganize ? sortedAlbums.filter((a) => !isLiveAlbum(a) && !isPrimaryAlbum(a, artist)) : [];
  const liveAlbums = autoOrganize ? sortedAlbums.filter((a) => isLiveAlbum(a)) : [];
  // 分类后的全部专辑（供歌曲/新入库使用）
  const categorizedAlbums = autoOrganize ? [...primaryAlbums, ...collabAlbums, ...liveAlbums] : albums;

  // 新入库：专辑按最近添加排序（专辑内歌曲最大 importTime，兜底专辑 importTime）
  const newArrivalAlbums = [...categorizedAlbums].sort((a, b) => {
    const importOf = (album) =>
      Math.max(
        album.importTime || 0,
        ...(album.songs || []).map((s) => s.importTime || 0)
      );
    return importOf(b) - importOf(a);
  });

  // 艺人形象照：优先使用存储的艺人照片
  const artistCover = record?.cover_url ? getAssetUrl(record.cover_url) : null;
  const coverPosition = normalizeCoverPosition(record?.cover_position);
  const showBanner = !!artistCover && !bannerImgError;
  const songCount = categorizedAlbums.reduce((sum, a) => sum + (a.songs?.length || 0), 0);

  // 相关流派：优先用艺人编辑里保存的流派，否则自动抓取歌曲 genre 去重
  const genres = (record?.genres && record.genres.length > 0)
    ? record.genres
    : (() => {
        const set = new Set();
        albums.forEach((a) => (a.songs || []).forEach((s) => { if (s.genre) set.add(s.genre); }));
        return Array.from(set);
      })();

  // 全部歌曲（带播放次数 / 导入时间）：自动整理时仅保留该艺人演唱的歌曲
  const counts = loadPlayCounts();
  const allSongs = categorizedAlbums.flatMap((a) =>
    (a.songs || [])
      .filter((s) => !autoOrganize || splitArtists(s.artist).includes(artist))
      .map((s, idx) => ({
        ...s,
        albumId: a.id,
        songIndex: idx,
        playCount: counts[songPlayKey(s)] || 0,
        importTime: s.importTime || 0,
      }))
  );

  // 歌曲排序：播放次数降序 → 最近导入时间降序
  const sortedSongs = [...allSongs].sort(
    (a, b) => (b.playCount - a.playCount) || (b.importTime - a.importTime)
  );
  // 3×3 网格最多展示 9 首
  const topSongs = sortedSongs.slice(0, 9);

  // 播放歌曲
  function playSong(song) {
    onPlaySong && onPlaySong(song.albumId, song.songIndex);
  }

  return (
    <div style={styles.container} className="artist-detail-page">
      {subView === "songs" ? (
        <div style={styles.subPage}>
          <button className="detail-back-btn" style={styles.subBackBtn} onClick={() => setSubView(null)} title="返回">
            <FaArrowLeft size={18} />
          </button>
          <h1 style={styles.subTitle}>全部歌曲</h1>
          <div style={styles.subSongGrid}>
            {sortedSongs.map((song) => {
              const isActive = song.albumId === currentAlbumId && song.songIndex === currentSongIndex;
              return (
                <div
                  key={`${song.albumId}-${song.songIndex}`}
                  className="artist-song-card"
                  style={{
                    ...styles.songCell,
                    ...(isActive ? styles.songCellActive : {}),
                  }}
                  onClick={() => playSong(song)}
                >
                  <div style={styles.songCellCover}>
                    <span style={styles.songCellCoverIcon}>🎶</span>
                    {song.coverURL && (
                      <img
                        src={song.coverURL}
                        alt=""
                        onError={(e) => { e.currentTarget.style.display = "none"; }}
                        style={styles.songCellCoverImg}
                      />
                    )}
                  </div>
                  <div style={styles.songCellText}>
                    <p style={styles.songCellTitle}><ExplicitTitle>{song.title}</ExplicitTitle></p>
                    <p style={styles.songCellAlbum}>{song.album}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : subView === "albums" ? (
        <div style={styles.subPage}>
          <button className="detail-back-btn" style={styles.subBackBtn} onClick={() => setSubView(null)} title="返回">
            <FaArrowLeft size={18} />
          </button>
          <h1 style={styles.subTitle}>全部专辑</h1>
          <div style={styles.subAlbumGrid}>
            {sortedAlbums.map((album) => (
              <div
                key={album.id}
                className="album-card"
                style={{ ...styles.albumCard, width: "100%" }}
                onClick={() => { setSubView(null); onOpenAlbum && onOpenAlbum(album.id); }}
              >
                <div style={styles.albumCardCoverWrapper}>
                  <div style={styles.albumCardCoverPlaceholder}>
                    <span style={styles.albumCardCoverIcon}>🎶</span>
                  </div>
                  {album.coverURL && (
                    <img
                      src={album.coverURL}
                      alt={album.title}
                      onError={(e) => { e.currentTarget.style.display = "none"; }}
                      style={{ ...styles.albumCardCover, position: "absolute", inset: 0 }}
                    />
                  )}
                </div>
                <p style={styles.albumCardTitle}><ExplicitTitle>{album.title}</ExplicitTitle></p>
                <p style={styles.albumCardYear}>
                  {album.year ? `${album.year}` : "未知年份"}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
      {/* 返回按钮 */}
      <button className="detail-back-btn" style={styles.backBtn} onClick={onBack} title="返回">
        <FaArrowLeft size={18} />
      </button>

      {/* ============================================================ */}
      {/* ① 顶部：艺人形象照横幅（无形象照时只显示名字，位置上移）    */}
      {/* ============================================================ */}
      {showBanner ? (
        <div style={styles.bannerSection}>
          <div style={styles.bannerImageWrapper}>
            <img
              src={artistCover}
              alt={artist}
              style={{ ...styles.bannerImage, objectPosition: `${coverPosition.x}% ${coverPosition.y}%` }}
              onError={() => setBannerImgError(true)}
            />
            {/* 渐变遮罩，让文字更清晰 */}
            <div style={styles.bannerOverlay} />
          </div>
          {/* 艺人在横幅上的名字 */}
          <div style={styles.bannerInfo}>
            <div style={styles.nameRow}>
              <h1 style={styles.artistName}>{artist}</h1>
              {onEditArtist && (
                <button className="artist-detail-edit-btn" style={styles.editBtn} onClick={() => onEditArtist(artist)} title="编辑艺人">
                  <FaPen size={14} />
                </button>
              )}
            </div>
            <p style={styles.artistStats}>{albums.length} 个专辑 · {songCount} 首歌曲</p>
          </div>
        </div>
      ) : (
        <div className="artist-compact-header" style={styles.compactHeader}>
          <div style={styles.nameRow}>
            <h1 style={styles.compactName}>{artist}</h1>
            {onEditArtist && (
              <button className="artist-detail-edit-btn" style={styles.editBtnCompact} onClick={() => onEditArtist(artist)} title="编辑艺人">
                <FaPen size={14} />
              </button>
            )}
          </div>
          <p style={styles.compactStats}>{albums.length} 个专辑 · {songCount} 首歌曲</p>
        </div>
      )}

      {/* ============================================================ */}
      {/* ② 新入库：最近添加的专辑，一排横向滚动                    */}
      {/* ============================================================ */}
      {newArrivalAlbums.length > 0 && (
        <div style={styles.blockSection}>
          <div style={styles.titleRow}>
            <h2 style={styles.sectionTitle}>新入库</h2>
          </div>
          <div style={styles.hScrollRow}>
            {newArrivalAlbums.map((album) => (
              <div
                key={album.id}
                className="album-card"
                style={styles.albumCard}
                onClick={() => onOpenAlbum && onOpenAlbum(album.id)}
              >
                <div style={styles.albumCardCoverWrapper}>
                  <div style={styles.albumCardCoverPlaceholder}>
                    <span style={styles.albumCardCoverIcon}>🎶</span>
                  </div>
                  {album.coverURL && (
                    <img
                      src={album.coverURL}
                      alt={album.title}
                      onError={(e) => { e.currentTarget.style.display = "none"; }}
                      style={{ ...styles.albumCardCover, position: "absolute", inset: 0 }}
                    />
                  )}
                </div>
                <p style={styles.albumCardTitle}>{album.title}</p>
                <p style={styles.albumCardYear}>
                  {album.year ? `${album.year}` : "未知年份"}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* ③ 歌曲：3×3 网格 + 「>」查看全部                          */}
      {/* ============================================================ */}
      {allSongs.length > 0 && (
        <div style={styles.blockSection}>
          <div style={styles.titleRow}>
            <h2 style={styles.sectionTitle}>歌曲</h2>
            {allSongs.length > 9 && (
              <button style={styles.moreBtn} onClick={() => setSubView("songs")} title="查看全部歌曲">
                <FaChevronRight size={13} />
              </button>
            )}
          </div>
          <div style={styles.songGrid}>
            {topSongs.map((song) => {
              const isActive = song.albumId === currentAlbumId && song.songIndex === currentSongIndex;
              return (
                <div
                  key={`${song.albumId}-${song.songIndex}`}
                  className="artist-song-card"
                  style={{
                    ...styles.songCell,
                    ...(isActive ? styles.songCellActive : {}),
                  }}
                  onClick={() => playSong(song)}
                >
                  <div style={styles.songCellCover}>
                    <span style={styles.songCellCoverIcon}>🎶</span>
                    {song.coverURL && (
                      <img
                        src={song.coverURL}
                        alt=""
                        onError={(e) => { e.currentTarget.style.display = "none"; }}
                        style={styles.songCellCoverImg}
                      />
                    )}
                  </div>
                  <div style={styles.songCellText}>
                    <p style={styles.songCellTitle}><ExplicitTitle>{song.title}</ExplicitTitle></p>
                    <p style={styles.songCellAlbum}>{song.album}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* ④ 专辑 / 合作音乐 / 现场：一排横向卡片 + 查看全部入口 */}
      {/* ============================================================ */}
      {!autoOrganize ? (
        <div style={styles.blockSection}>
          <div style={styles.titleRow}>
            <h2 style={styles.sectionTitle}>专辑</h2>
            {sortedAlbums.length > 0 && (
              <button style={styles.moreBtn} onClick={() => setSubView("albums")} title="查看全部专辑">
                <FaChevronRight size={13} />
              </button>
            )}
          </div>
          {sortedAlbums.length === 0 ? (
            <div style={styles.emptyState}>
              <span style={styles.emptyIcon}>📀</span>
              <p style={styles.emptyText}>该艺人暂无专辑</p>
            </div>
          ) : (
            <div style={styles.hScrollRow}>
              {sortedAlbums.map((album) => {
                const isActive = album.id === currentAlbumId;
                return (
                  <div
                    key={album.id}
                    className="album-card"
                    style={{
                      ...styles.albumCard,
                      ...(isActive ? styles.albumCardActive : {}),
                    }}
                    onClick={() => onOpenAlbum && onOpenAlbum(album.id)}
                  >
                    <div style={styles.albumCardCoverWrapper}>
                      <div style={styles.albumCardCoverPlaceholder}>
                        <span style={styles.albumCardCoverIcon}>🎶</span>
                      </div>
                      {album.coverURL && (
                        <img
                          src={album.coverURL}
                          alt={album.title}
                          onError={(e) => { e.currentTarget.style.display = "none"; }}
                          style={{ ...styles.albumCardCover, position: "absolute", inset: 0 }}
                        />
                      )}
                      <CoverPlayButton
                        isActive={isActive}
                        isPlaying={isPlaying}
                        onTogglePlay={(e) => {
                          e.stopPropagation();
                          onPlayAlbum && onPlayAlbum(album.id);
                        }}
                      />
                      {isActive && (
                        <div style={styles.playingBadge}>▶</div>
                      )}
                    </div>
                    <p style={styles.albumCardTitle}><ExplicitTitle>{album.title}</ExplicitTitle></p>
                    <p style={styles.albumCardYear}>
                      {album.year ? `${album.year}` : "未知年份"}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <>
          {primaryAlbums.length > 0 && (
            <div style={styles.blockSection}>
              <div style={styles.titleRow}>
                <h2 style={styles.sectionTitle}>专辑</h2>
              </div>
              <div style={styles.hScrollRow}>
                {primaryAlbums.map((album) => (
                  <div key={album.id} className="album-card" style={styles.albumCard} onClick={() => onOpenAlbum && onOpenAlbum(album.id)}>
                    <div style={styles.albumCardCoverWrapper}>
                      <div style={styles.albumCardCoverPlaceholder}>
                        <span style={styles.albumCardCoverIcon}>🎶</span>
                      </div>
                      {album.coverURL && (
                        <img src={album.coverURL} alt={album.title} onError={(e) => { e.currentTarget.style.display = "none"; }} style={{ ...styles.albumCardCover, position: "absolute", inset: 0 }} />
                      )}
                      <CoverPlayButton isActive={album.id === currentAlbumId} isPlaying={isPlaying} onTogglePlay={(e) => { e.stopPropagation(); onPlayAlbum && onPlayAlbum(album.id); }} />
                    </div>
                    <p style={styles.albumCardTitle}><ExplicitTitle>{album.title}</ExplicitTitle></p>
                    <p style={styles.albumCardYear}>{album.year ? `${album.year}` : "未知年份"}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {collabAlbums.length > 0 && (
            <div style={styles.blockSection}>
              <div style={styles.titleRow}>
                <h2 style={styles.sectionTitle}>合作音乐</h2>
              </div>
              <div style={styles.hScrollRow}>
                {collabAlbums.map((album) => (
                  <div key={album.id} className="album-card" style={styles.albumCard} onClick={() => onOpenAlbum && onOpenAlbum(album.id)}>
                    <div style={styles.albumCardCoverWrapper}>
                      <div style={styles.albumCardCoverPlaceholder}>
                        <span style={styles.albumCardCoverIcon}>🎶</span>
                      </div>
                      {album.coverURL && (
                        <img src={album.coverURL} alt={album.title} onError={(e) => { e.currentTarget.style.display = "none"; }} style={{ ...styles.albumCardCover, position: "absolute", inset: 0 }} />
                      )}
                      <CoverPlayButton isActive={album.id === currentAlbumId} isPlaying={isPlaying} onTogglePlay={(e) => { e.stopPropagation(); onPlayAlbum && onPlayAlbum(album.id); }} />
                    </div>
                    <p style={styles.albumCardTitle}><ExplicitTitle>{album.title}</ExplicitTitle></p>
                    <p style={styles.albumCardYear}>{album.year ? `${album.year}` : "未知年份"}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {liveAlbums.length > 0 && (
            <div style={styles.blockSection}>
              <div style={styles.titleRow}>
                <h2 style={styles.sectionTitle}>现场</h2>
              </div>
              <div style={styles.hScrollRow}>
                {liveAlbums.map((album) => (
                  <div key={album.id} className="album-card" style={styles.albumCard} onClick={() => onOpenAlbum && onOpenAlbum(album.id)}>
                    <div style={styles.albumCardCoverWrapper}>
                      <div style={styles.albumCardCoverPlaceholder}>
                        <span style={styles.albumCardCoverIcon}>🎶</span>
                      </div>
                      {album.coverURL && (
                        <img src={album.coverURL} alt={album.title} onError={(e) => { e.currentTarget.style.display = "none"; }} style={{ ...styles.albumCardCover, position: "absolute", inset: 0 }} />
                      )}
                      <CoverPlayButton isActive={album.id === currentAlbumId} isPlaying={isPlaying} onTogglePlay={(e) => { e.stopPropagation(); onPlayAlbum && onPlayAlbum(album.id); }} />
                    </div>
                    <p style={styles.albumCardTitle}>{album.title}</p>
                    <p style={styles.albumCardYear}>{album.year ? `${album.year}` : "未知年份"}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {primaryAlbums.length === 0 && collabAlbums.length === 0 && liveAlbums.length === 0 && (
            <div style={styles.emptyState}>
              <span style={styles.emptyIcon}>📀</span>
              <p style={styles.emptyText}>该艺人暂无专辑</p>
            </div>
          )}
        </>
      )}

      {/* ============================================================ */}
      {/* ⑤ 底部：艺人简介（仅在有内容时显示）                       */}
      {/* ============================================================ */}
      {record?.bio ? (
        <div className="artist-info-section" style={styles.infoSection}>
          <h2 style={styles.sectionTitle}>艺人简介</h2>
          <div style={styles.bioText}>{record.bio}</div>
        </div>
      ) : null}

      {/* ============================================================ */}
      {/* ⑥ 相关流派（艺人编辑里的流派信息）                         */}
      {/* ============================================================ */}
      {genres.length > 0 && (
        <div className="artist-info-section" style={styles.infoSection}>
          <h2 style={styles.sectionTitle}>相关流派</h2>
          <div style={styles.genreList}>
            {genres.map((g) => (
              <span key={g} style={styles.genreChip}>{g}</span>
            ))}
          </div>
        </div>
      )}

      {/* 底部留白 */}
      <div style={{ height: 120, flexShrink: 0 }} />

        </>
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

  // ---------- 返回按钮 ----------
  backBtn: {
    position: "absolute",
    top: "20px",
    left: "24px",
    zIndex: 20,
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    border: "1px solid rgba(255,255,255,0.3)",
    background: "rgba(0,0,0,0.4)",
    color: "#ffffff",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backdropFilter: "blur(8px)",
    transition: "background 0.2s, transform 0.15s",
  },

  // ================================================================
  // ① 顶部：艺人照片横幅
  // ================================================================
  bannerSection: {
    position: "relative",
    width: "100%",
    height: "320px",
    flexShrink: 0,
    overflow: "hidden",
  },
  bannerImageWrapper: {
    width: "100%",
    height: "100%",
    position: "relative",
    overflow: "hidden",
    background: "#e5e7eb",
  },
  bannerImage: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: "center",
    display: "block",
  },
  // 无形象照时的紧凑头部
  compactHeader: {
    padding: "72px 48px 8px",
    flexShrink: 0,
  },
  nameRow: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
  },
  compactName: {
    fontSize: "34px",
    fontWeight: 800,
    color: "#1f2937",
    margin: 0,
  },
  compactStats: {
    fontSize: "14px",
    color: "#6b7280",
    margin: "6px 0 0",
  },
  editBtn: {
    flexShrink: 0,
    width: "38px",
    height: "38px",
    borderRadius: "50%",
    border: "1px solid rgba(255,255,255,0.5)",
    background: "rgba(0,0,0,0.3)",
    color: "#ffffff",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background 0.2s",
  },
  editBtnCompact: {
    flexShrink: 0,
    width: "38px",
    height: "38px",
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
  bannerOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "60%",
    background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)",
    pointerEvents: "none",
  },
  bannerInfo: {
    position: "absolute",
    bottom: "30px",
    left: "40px",
    zIndex: 10,
  },
  artistName: {
    fontSize: "42px",
    fontWeight: 800,
    color: "#ffffff",
    margin: 0,
    textShadow: "0 2px 16px rgba(0,0,0,0.5)",
    lineHeight: 1.2,
  },
  artistStats: {
    fontSize: "15px",
    color: "rgba(255,255,255,0.85)",
    margin: "8px 0 0 0",
    fontWeight: 400,
    textShadow: "0 1px 8px rgba(0,0,0,0.4)",
  },

  // ================================================================
  // 通用区块
  // ================================================================
  blockSection: {
    padding: "28px 48px 0",
    flexShrink: 0,
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "16px",
  },
  sectionTitle: {
    fontSize: "22px",
    fontWeight: 700,
    color: "#1f2937",
    margin: 0,
  },
  moreBtn: {
    flexShrink: 0,
    width: "32px",
    height: "32px",
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

  // 横向滚动行（新入库 / 专辑）
  hScrollRow: {
    display: "flex",
    gap: "12px",
    overflowX: "auto",
    paddingBottom: "8px",
  },

  // ================================================================
  // ③ 歌曲：3×3 网格
  // ================================================================
  songGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "12px",
  },
  songCell: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "10px 14px",
    minHeight: "64px",
    borderRadius: "10px",
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    cursor: "pointer",
    overflow: "hidden",
    transition: "background 0.15s, border-color 0.15s",
  },
  songCellActive: {
    background: "rgba(233,69,96,0.12)",
    border: "1px solid rgba(233,69,96,0.25)",
  },
  songCellCover: {
    position: "relative",
    width: "40px",
    height: "40px",
    borderRadius: "6px",
    overflow: "hidden",
    flexShrink: 0,
    background: "#e5e7eb",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  songCellCoverIcon: { fontSize: "16px", opacity: 0.4 },
  songCellCoverImg: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  songCellText: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
  },
  songCellTitle: {
    fontSize: "14px",
    fontWeight: 600,
    color: "#1f2937",
    margin: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  songCellAlbum: {
    fontSize: "12px",
    color: "#6b7280",
    margin: "3px 0 0",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  // ================================================================
  // ④ 专辑：一排横向卡片
  // ================================================================
  albumCard: {
    flexShrink: 0,
    width: "170px",
    borderRadius: "12px",
    overflow: "hidden",
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    cursor: "pointer",
  },
  albumCardActive: {
    border: "2px solid #e94560",
    boxShadow: "0 0 20px rgba(233,69,96,0.2)",
  },
  albumCardCoverWrapper: {
    position: "relative",
    width: "100%",
    aspectRatio: "1 / 1",
    overflow: "hidden",
    background: "#f3f4f6",
  },
  albumCardCover: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  albumCardCoverPlaceholder: {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#e5e7eb",
  },
  albumCardCoverIcon: { fontSize: "32px", opacity: 0.4 },
  playingBadge: {
    position: "absolute",
    top: "6px",
    left: "6px",
    width: "24px",
    height: "24px",
    borderRadius: "12px",
    background: "#e94560",
    color: "#fff",
    fontSize: "11px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backdropFilter: "blur(4px)",
  },
  albumCardTitle: {
    fontSize: "15px",
    fontWeight: 600,
    color: "#1f2937",
    margin: "10px 12px 3px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  albumCardYear: {
    fontSize: "14px",
    color: "#6b7280",
    fontWeight: 500,
    margin: "0 12px 12px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "40px 20px",
    gap: "12px",
  },
  emptyIcon: { fontSize: "48px", opacity: 0.3 },
  emptyText: { fontSize: "16px", color: "#6b7280", margin: 0 },

  // ================================================================
  // ⑤ 艺人简介
  // ================================================================
  infoSection: {
    padding: "28px 48px 28px",
    flexShrink: 0,
  },
  bioText: {
    fontSize: "14px",
    lineHeight: 1.8,
    color: "#4b5563",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  genreList: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    marginTop: "12px",
  },
  genreChip: {
    display: "inline-flex",
    alignItems: "center",
    padding: "6px 16px",
    borderRadius: "18px",
    border: "1px solid #e5e7eb",
    background: "#f3f4f6",
    color: "#374151",
    fontSize: "13px",
    fontWeight: 500,
  },

  // ================================================================
  // 子页面（全部歌曲 / 全部专辑）
  // ================================================================
  subPage: {
    display: "flex",
    flexDirection: "column",
    minHeight: "100%",
    position: "relative",
  },
  subBackBtn: {
    position: "absolute",
    top: "20px",
    left: "24px",
    zIndex: 20,
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    color: "#374151",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
    transition: "background 0.2s, transform 0.15s",
  },
  subTitle: {
    fontSize: "26px",
    fontWeight: 700,
    color: "#1f2937",
    margin: "0 0 24px",
    padding: "72px 48px 0",
  },
  subSongGrid: {
    padding: "0 48px 80px",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
    gap: "12px",
  },
  subAlbumGrid: {
    padding: "0 48px 80px",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
    gap: "20px",
  },
};
