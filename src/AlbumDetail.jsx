import { FaPlay, FaPause, FaArrowLeft, FaEdit } from "react-icons/fa";
import PlayingAnimation from "./PlayingAnimation";

/* ================================================================
   📀 AlbumDetail — 专辑详情页
   布局：上半部分（~50%）= 封面+信息+播放按钮
         下半部分（~50%）= 歌曲列表
   ================================================================ */
export default function AlbumDetail({
  album,
  currentSongIndex,
  isPlaying,
  onPlayAlbum,
  onPlaySong,
  onBack,
}) {
  if (!album) return null;

    const yearText = album.year ? `${album.year}` : "未知年份";
  const genreText = album.genre || null;

  return (
    <div style={styles.container}>
      <button style={styles.backBtn} onClick={onBack} title="返回">
        <FaArrowLeft size={18} />
      </button>

            {/* 上半部分：左=封面 | 右=信息 */}
      <div style={styles.topSection}>
        {/* 左：封面图（独立，不受右侧影响） */}
        <div style={styles.coverColumn}>
          <div style={styles.coverWrapper}>
            {album.coverURL ? (
              <img src={album.coverURL} alt={album.title} style={styles.cover} />
            ) : (
              <div style={styles.coverPlaceholder}>
                <span style={styles.coverPlaceholderIcon}>🎶</span>
              </div>
            )}
          </div>
        </div>

        {/* 右：信息区（独立，可自由增删内容） */}
        <div style={styles.infoColumn}>
          <h1 style={styles.albumTitle}>{album.title}</h1>
          <p style={styles.albumArtist}>{album.artist}</p>
                    <p style={styles.albumYear}>
            {yearText}年
            {genreText && <><span style={styles.yearGenreSep}>·</span><span style={styles.albumGenre}>{genreText}</span></>}
          </p>
                    <div style={styles.actionRow}>
                      <button style={styles.playButton} onClick={onPlayAlbum}>
                        {isPlaying ? (
                          <FaPause size={16} /> 
                        ) : (
                          <FaPlay size={16} />
                        )}
                      </button>
                      <button style={styles.editButton} title="编辑专辑信息">
                        <FaEdit size={16} /> 编辑
                      </button>
                    </div>
        </div>
      </div>


      {/* 下半部分：歌曲列表 */}
      <div style={styles.bottomSection}>
        <div style={styles.songList}>
          {album.songs.map((song, idx) => {
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
        <div style={styles.songListHeader}>
          <div style={styles.dividerLine} />
          <span style={styles.songCount}>{album.songs.length} 首</span>
        </div>
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
    padding: "80px 60px 20px 210px",
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
    alignSelf: "center",
    marginTop:"85px"
  },
  albumTitle: {
        fontSize: "32px", fontWeight: 700, color: "#1f2937",
    margin: 0, lineHeight: 1.2,
  },
  albumArtist: {
    fontSize: "18px", color: "#6b7280", margin: 0, fontWeight: 400,
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
    flex: 1, padding: "150px 170px 120px",
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
  playingIcon: { fontSize: "14px" },
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
    nowPlayingBadge: {
    fontSize: "11px", color: "#e94560", fontWeight: 500,
    flexShrink: 0, padding: "2px 10px", borderRadius: "12px",
    background: "rgba(233,69,96,0.1)",
  },
};


