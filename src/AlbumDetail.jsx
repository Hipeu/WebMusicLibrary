import { FaPlay, FaPause, FaArrowLeft } from "react-icons/fa";
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

  return (
    <div style={styles.container}>
      <button style={styles.backBtn} onClick={onBack} title="返回">
        <FaArrowLeft size={18} />
      </button>

      {/* 上半部分：专辑信息 */}
      <div style={styles.topSection}>
        <div style={styles.infoRow}>
          <div style={styles.coverWrapper}>
            {album.coverURL ? (
              <img src={album.coverURL} alt={album.title} style={styles.cover} />
            ) : (
              <div style={styles.coverPlaceholder}>
                <span style={styles.coverPlaceholderIcon}>🎶</span>
              </div>
            )}
          </div>

          <div style={styles.infoGroup}>
            <h1 style={styles.albumTitle}>{album.title}</h1>
            <p style={styles.albumArtist}>{album.artist}</p>
            <p style={styles.albumYear}>{yearText}年</p>
            <button style={styles.playButton} onClick={onPlayAlbum}>
              {isPlaying ? (
                <><FaPause size={16} /> 暂停</>
              ) : (
                <><FaPlay size={16} /> 播放全部</>
              )}
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
    overflow: "hidden",
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
    alignItems: "center",
    justifyContent: "center",
    padding: "60px 60px 20px",
    minHeight: 0,
  },
  infoRow: {
    display: "flex",
    alignItems: "center",
    gap: "64px",
    maxWidth: "800px",
    width: "100%",
    justifyContent: "center",
  },

  coverWrapper: {
    flex: "0 0 260px",
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

  infoGroup: {
    display: "flex", flexDirection: "column", gap: "10px", maxWidth: "400px",
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
  },

  playButton: {
    display: "inline-flex", alignItems: "center", gap: "10px",
    marginTop: "8px", padding: "12px 32px", borderRadius: "28px",
    border: "none", background: "linear-gradient(135deg, #e94560, #c73e52)",
    color: "#fff", fontSize: "16px", fontWeight: 600,
    cursor: "pointer", boxShadow: "0 6px 20px rgba(233,69,96,0.35)",
    transition: "transform 0.2s, box-shadow 0.2s", width: "fit-content",
  },

        bottomSection: {
    flex: "0 0 60%", padding: "30px 250px 100px",
    display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden",
  },
    songListHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",   
        marginTop: "10px",             
        flexShrink: 0,
    },

  songListTitle: {
    fontSize: "14px", fontWeight: 600, color: "#6b7280",
    letterSpacing: "1px", textTransform: "uppercase",
  },
  songCount: { fontSize: "13px", color: "#6b7280" },

  songList: {
    flex: 1, overflowY: "auto", display: "flex", flexDirection: "column",
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


