import { FaArrowLeft } from "react-icons/fa";
import CoverPlayButton from "./CoverPlayButton";

/* ================================================================
   🎤 ArtistsDetail — 艺人详情页
   布局：
     ① 顶部：艺人照片（长方形铺满横幅）
     ② 中部：专辑网格（按年份排序，和资料库一样的卡片样式）
     ③ 底部：艺人信息介绍模块（功能预留）
   ================================================================ */
export default function ArtistsDetail({
  artist,
  albums,
  currentAlbumId,
  currentSongIndex,
  isPlaying,
  onPlayAlbum,
  onPlaySong,
  onBack,
  onOpenAlbum,
}) {
  if (!artist) return null;

  // 按年份排序专辑（降序：从新到旧）
  const sortedAlbums = [...albums].sort((a, b) => {
    const yearA = a.year || 0;
    const yearB = b.year || 0;
    return yearB - yearA;
  });

  return (
    <div style={styles.container}>
      {/* 返回按钮 */}
      <button style={styles.backBtn} onClick={onBack} title="返回">
        <FaArrowLeft size={18} />
      </button>

      {/* ============================================================ */}
      {/* ① 顶部：艺人照片横幅                                       */}
      {/* ============================================================ */}
      <div style={styles.bannerSection}>
        <div style={styles.bannerImageWrapper}>
          <div style={styles.bannerPlaceholder}>
            <span style={styles.bannerIcon}>🎤</span>
          </div>
          {/* 渐变遮罩，让文字更清晰 */}
          <div style={styles.bannerOverlay} />
        </div>
        {/* 艺人在横幅上的名字 */}
        <div style={styles.bannerInfo}>
          <h1 style={styles.artistName}>{artist}</h1>
          <p style={styles.artistStats}>{albums.length} 个专辑 · {albums.reduce((sum, a) => sum + (a.songs?.length || 0), 0)} 首歌曲</p>
        </div>
      </div>

      {/* ============================================================ */}
      {/* ② 中部：专辑网格（和资料库一样的卡片样式）                 */}
      {/* ============================================================ */}
      <div style={styles.albumsSection}>
        <h2 style={styles.sectionTitle}>专辑作品</h2>

        {sortedAlbums.length === 0 ? (
          <div style={styles.emptyState}>
            <span style={styles.emptyIcon}>📀</span>
            <p style={styles.emptyText}>该艺人暂无专辑</p>
          </div>
        ) : (
          <div style={styles.albumGrid}>
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
                  <div style={styles.coverWrapper}>
                    {album.coverURL ? (
                      <img src={album.coverURL} alt={album.title} style={styles.coverImage} />
                    ) : (
                      <div style={styles.coverPlaceholder}>
                        <span style={styles.coverPlaceholderIcon}>🎶</span>
                      </div>
                    )}
                    <CoverPlayButton
                      isActive={isActive}
                      isPlaying={isPlaying}
                      onTogglePlay={(e) => {
                        e.stopPropagation();
                        onPlayAlbum(album.id);
                      }}
                    />
                    {isActive && (
                      <div style={styles.playingBadge}>▶ 正在播放</div>
                    )}
                  </div>
                                    <p style={styles.albumCardTitle}>{album.title}</p>
                  <p style={styles.albumCardYear}>
                    {album.year ? `${album.year}` : "未知年份"}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* ③ 底部：艺人信息介绍模块（功能预留）                       */}
      {/* ============================================================ */}
      <div style={styles.infoSection}>
        <h2 style={styles.sectionTitle}>艺人简介</h2>
        <div style={styles.infoPlaceholder}>
          <span style={styles.infoPlaceholderIcon}>📝</span>
          <p style={styles.infoPlaceholderText}>艺人简介功能即将上线</p>
          <p style={styles.infoPlaceholderHint}>敬请期待更多精彩内容</p>
        </div>
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
  },
  bannerPlaceholder: {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
  },
  bannerIcon: {
    fontSize: "100px",
    opacity: 0.3,
    color: "#ffffff",
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
  // ② 中部：专辑网格
  // ================================================================
  albumsSection: {
    padding: "36px 48px 20px",
    flexShrink: 0,
  },
  sectionTitle: {
    fontSize: "22px",
    fontWeight: 700,
    color: "#1f2937",
    margin: "0 0 24px 0",
  },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "60px 20px",
    gap: "12px",
  },
  emptyIcon: { fontSize: "48px", opacity: 0.3 },
  emptyText: { fontSize: "16px", color: "#6b7280", margin: 0 },

  // 网格布局 — 和资料库一致
  albumGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
    gap: "24px",
  },
  albumCard: {
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

  // 封面
  coverWrapper: {
    position: "relative",
    width: "100%",
    aspectRatio: "1 / 1",
    overflow: "hidden",
    background: "#f3f4f6",
  },
  coverImage: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  coverPlaceholder: {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#e5e7eb",
  },
  coverPlaceholderIcon: { fontSize: "40px", opacity: 0.4 },
  playingBadge: {
    position: "absolute",
    top: "8px",
    left: "8px",
    padding: "3px 10px",
    borderRadius: "12px",
    background: "#e94560",
    color: "#fff",
    fontSize: "11px",
    fontWeight: 600,
    letterSpacing: "0.3px",
    backdropFilter: "blur(4px)",
  },

    // 专辑卡片文字
  albumCardTitle: {
    fontSize: "15px",
    fontWeight: 600,
    color: "#1f2937",
    margin: "12px 12px 4px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  albumCardYear: {
    fontSize: "14px",
    color: "#6b7280",
    fontWeight: 500,
    margin: "0 12px 14px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  // ================================================================
  // ③ 底部：艺人信息介绍模块（功能预留）
  // ================================================================
  infoSection: {
    padding: "20px 48px 120px",
    flexShrink: 0,
  },
  infoPlaceholder: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "48px 20px",
    borderRadius: "16px",
    border: "2px dashed #e5e7eb",
    background: "#f9fafb",
    gap: "8px",
  },
  infoPlaceholderIcon: {
    fontSize: "40px",
    opacity: 0.3,
  },
  infoPlaceholderText: {
    fontSize: "16px",
    color: "#6b7280",
    margin: 0,
    fontWeight: 500,
  },
  infoPlaceholderHint: {
    fontSize: "13px",
    color: "#9ca3af",
    margin: 0,
  },
};
