import { useState, useRef } from "react";
import { readMetadata } from "./MetadataReader";
import MusicPlayer from "./MusicPlayer";

/* ======================================================
   🎵 MusicLibrary — 音乐资料库主应用
   功能：顶部功能条 | 中间专辑网格
   播放相关由 MusicPlayer 组件处理
   ====================================================== */
export default function MusicLibrary() {
  // ---------- 专辑 & 歌曲状态 ----------
  const [albums, setAlbums] = useState([]);
  const [filterText, setFilterText] = useState("");

  // ---------- 播放器状态（与 MusicPlayer 共享） ----------
  const [currentAlbumId, setCurrentAlbumId] = useState(null);
  const [currentSongIndex, setCurrentSongIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const audioRef = useRef(null);
  const fileInputRef = useRef(null);

  // 当前专辑 & 当前歌曲
  const currentAlbum = albums.find((a) => a.id === currentAlbumId) || null;
  const currentSong = currentAlbum?.songs?.[currentSongIndex] || null;

  // ---------- 导入音频文件 ----------
  async function handleImportFiles(e) {
    const selectedFiles = Array.from(e.target.files);
    if (selectedFiles.length === 0) return;

    // 读取所有文件的元数据
    const entries = await Promise.all(
      selectedFiles.map(async (f) => {
        const meta = await readMetadata(f);
        return {
          ...meta,
          url: URL.createObjectURL(f),
        };
      })
    );

    // 按专辑名分组
    const albumMap = new Map();
    for (const entry of entries) {
      const key = entry.album || "未知专辑";
      if (!albumMap.has(key)) {
        albumMap.set(key, {
          id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
          title: key,
          artist: entry.artist || "未知艺术家",
          coverURL: entry.coverURL,
          songs: [],
        });
      }
      const album = albumMap.get(key);
      album.songs.push({
        title: entry.title,
        artist: entry.artist,
        album: entry.album,
        url: entry.url,
      });
      // 如果封面还没设置，用第一首歌的封面
      if (!album.coverURL && entry.coverURL) {
        album.coverURL = entry.coverURL;
      }
    }

    const newAlbums = Array.from(albumMap.values());

    setAlbums((prev) => {
      // 合并到已有专辑中（按专辑名匹配）
      const merged = new Map();
      for (const a of prev) merged.set(a.title, a);
      for (const a of newAlbums) {
        if (merged.has(a.title)) {
          const existing = merged.get(a.title);
          // 合并歌曲，去重
          const existingUrls = new Set(existing.songs.map((s) => s.url));
          for (const s of a.songs) {
            if (!existingUrls.has(s.url)) {
              existing.songs.push(s);
            }
          }
        } else {
          merged.set(a.title, a);
        }
      }
      return Array.from(merged.values());
    });
  }

  // ---------- 点击专辑卡片播放 ----------
  function handlePlayAlbum(albumId) {
    const album = albums.find((a) => a.id === albumId);
    if (!album || album.songs.length === 0) return;

    if (currentAlbumId === albumId) {
      // 同一专辑：切换播放/暂停
      togglePlay();
    } else {
      // 切换专辑
      setCurrentAlbumId(albumId);
            setCurrentSongIndex(0);
      setIsPlaying(true);
    }
  }

  // 简单播放/暂停（给专辑卡片复用）
  function togglePlay() {
    if (!audioRef.current || !currentSong) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
    setIsPlaying(!isPlaying);
  }

  // ---------- 过滤专辑 ----------
  const filteredAlbums = albums.filter((a) => {
    if (!filterText) return true;
    const t = filterText.toLowerCase();
    return (
      a.title.toLowerCase().includes(t) ||
      a.artist.toLowerCase().includes(t)
    );
  });

      // ---------- 渲染 ----------
  return (
    <div style={styles.container}>
            {/* 注入全局样式 */}
      <style>{`
        .upload-btn {
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .upload-btn:hover {
          transform: scale(1.05);
          box-shadow: 0 6px 25px rgba(233,69,96,0.5);
        }
        .upload-btn:active {
          transform: scale(0.97);
        }
        .album-card {
          transition: transform 0.25s ease, box-shadow 0.25s ease;
          cursor: pointer;
        }
        .album-card:hover {
          transform: translateY(-6px);
          box-shadow: 0 16px 48px rgba(0,0,0,0.5);
        }
        .album-card:active {
          transform: translateY(-2px);
        }
        .ctrl-btn {
          background: rgba(255,255,255,0.06);
          transition: background 0.2s, transform 0.1s;
        }
        .ctrl-btn:hover {
          background: rgba(255,255,255,0.12) !important;
        }
        .ctrl-btn:active {
          transform: scale(0.92) !important;
        }
        .ctrl-btn:disabled {
          opacity: 0.3 !important;
          cursor: not-allowed !important;
        }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.1);
          border-radius: 3px;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.97); }
          to { opacity: 1; transform: scale(1); }
        }
        .mini-cover-hover:hover {
          transform: scale(1.08);
          box-shadow: 0 4px 16px rgba(233,69,96,0.4);
        }
        .detail-back-btn:hover {
          background: rgba(255,255,255,0.12) !important;
          transform: scale(1.03);
        }
        .detail-song-item:hover {
          background: rgba(255,255,255,0.06) !important;
        }
      `}</style>

            {/* ============================================================ */}
      {/* ① 顶部功能条                                                 */}
      {/* ================================================================ */}
      <header style={styles.topBar}>
        {/* 左侧：LOGO / 标题 */}
        <div style={styles.logoArea}>
          <span style={styles.logoIcon}>🎵</span>
          <h1 style={styles.logoTitle}>音乐资料库</h1>
        </div>

        {/* 中间：搜索框 */}
        <div style={styles.searchArea}>
          <span style={styles.searchIcon}>🔍</span>
          <input
            style={styles.searchInput}
            type="text"
            placeholder="搜索专辑或艺人…"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
          {filterText && (
            <span
              style={styles.clearBtn}
              onClick={() => setFilterText("")}
            >
              ✕
            </span>
          )}
        </div>

        {/* 右侧：导入按钮 */}
        <button
          className="upload-btn"
          style={styles.importBtn}
          onClick={() => fileInputRef.current?.click()}
        >
          📂 导入音乐
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          onChange={handleImportFiles}
          style={{ display: "none" }}
        />

        {/* 专辑统计 */}
        <span style={styles.stats}>
          {albums.length} 个专辑
        </span>
      </header>

      {/* ================================================================ */}
      {/* ② 中间内容区 — 专辑网格                                          */}
      {/* ================================================================ */}
      <main style={styles.mainArea}>
        {filteredAlbums.length === 0 ? (
          <div style={styles.emptyState}>
            {albums.length === 0 ? (
              <>
                <span style={styles.emptyIcon}>📀</span>
                <p style={styles.emptyText}>还没有导入任何专辑</p>
                <p style={styles.emptyHint}>
                  点击右上角「导入音乐」按钮添加你的音乐文件
                </p>
              </>
            ) : (
              <>
                <span style={styles.emptyIcon}>🔍</span>
                <p style={styles.emptyText}>没有匹配的专辑</p>
                <p style={styles.emptyHint}>请尝试其他搜索词</p>
              </>
            )}
          </div>
        ) : (
          <div style={styles.albumGrid}>
            {filteredAlbums.map((album) => {
              const isActive = album.id === currentAlbumId;
              return (
                <div
                  key={album.id}
                  className="album-card"
                  style={{
                    ...styles.albumCard,
                    ...(isActive ? styles.albumCardActive : {}),
                  }}
                  onClick={() => handlePlayAlbum(album.id)}
                >
                  {/* 专辑封面 */}
                  <div style={styles.coverWrapper}>
                    {album.coverURL ? (
                      <img
                        src={album.coverURL}
                        alt={album.title}
                        style={styles.coverImage}
                      />
                    ) : (
                      <div style={styles.coverPlaceholder}>
                        <span style={styles.coverPlaceholderIcon}>🎶</span>
                      </div>
                    )}
                    {/* 播放指示器 */}
                    {isActive && (
                      <div style={styles.playingBadge}>
                        {isPlaying ? "▶ 播放中" : "⏸ 已暂停"}
                      </div>
                    )}
                    {/* 歌曲数量 */}
                    <div style={styles.songCount}>
                      {album.songs.length} 首
                    </div>
                  </div>

                  {/* 专辑名称 */}
                  <p style={styles.albumTitle}>{album.title}</p>

                  {/* 艺人 */}
                  <p style={styles.albumArtist}>{album.artist}</p>
                </div>
              );
            })}
          </div>
        )}
      </main>

            {/* ============================================================ */}
      {/* ③ 播放控制器（底部播放条 + 播放详情页）                     */}
      {/* ============================================================ */}
      <MusicPlayer
        albums={albums}
        currentAlbumId={currentAlbumId}
        setCurrentAlbumId={setCurrentAlbumId}
        currentSongIndex={currentSongIndex}
        setCurrentSongIndex={setCurrentSongIndex}
        isPlaying={isPlaying}
        setIsPlaying={setIsPlaying}
        currentTime={currentTime}
        setCurrentTime={setCurrentTime}
        duration={duration}
        setDuration={setDuration}
        volume={volume}
        setVolume={setVolume}
        audioRef={audioRef}
      />
    </div>
  );
}

/* ======================================================
   🎨 样式
   ====================================================== */
const styles = {
  container: {
    width: "100%", height: "100vh", display: "flex", flexDirection: "column",
    background: "radial-gradient(ellipse at center, #1a1a2e 0%, #0f0c1e 70%, #08060d 100%)",
    color: "#e0e0e0", overflow: "hidden",
    fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
  },

  // 顶部功能条
  topBar: {
    display: "flex", alignItems: "center", gap: "16px",
    padding: "12px 28px",
    background: "rgba(12, 10, 22, 0.85)",
    backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
    flexShrink: 0, zIndex: 10, flexWrap: "wrap",
  },
  logoArea: { display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 },
  logoIcon: { fontSize: "24px" },
  logoTitle: {
    fontSize: "18px", fontWeight: 700, color: "#f3f4f6",
    letterSpacing: "0.5px", margin: 0,
    background: "linear-gradient(135deg, #e94560, #f472b6)",
    WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
  },
  searchArea: {
    display: "flex", alignItems: "center",
    background: "rgba(255,255,255,0.06)", borderRadius: "24px",
    padding: "6px 14px", flex: "1 1 280px", maxWidth: "400px",
    border: "1px solid rgba(255,255,255,0.08)", transition: "border-color 0.2s",
  },
  searchIcon: { fontSize: "14px", marginRight: "8px", opacity: 0.5 },
  searchInput: {
    flex: 1, background: "transparent", border: "none",
    outline: "none", color: "#f3f4f6", fontSize: "14px", fontFamily: "inherit",
  },
  clearBtn: {
    fontSize: "14px", cursor: "pointer", opacity: 0.5,
    padding: "2px", transition: "opacity 0.2s",
  },
  importBtn: {
    display: "inline-flex", alignItems: "center", gap: "6px",
    padding: "8px 20px", borderRadius: "24px", border: "none",
    background: "linear-gradient(135deg, #e94560, #c73e52)",
    color: "#fff", fontSize: "13px", fontWeight: 600,
    cursor: "pointer", boxShadow: "0 4px 15px rgba(233,69,96,0.3)", flexShrink: 0,
  },
  stats: { fontSize: "12px", color: "#6b7280", whiteSpace: "nowrap", flexShrink: 0 },

  // 中间内容区
  mainArea: { flex: 1, overflowY: "auto", padding: "28px 28px 160px" },

  // 空状态
  emptyState: {
    display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", height: "100%", minHeight: "300px", gap: "12px",
  },
  emptyIcon: { fontSize: "56px", opacity: 0.3 },
  emptyText: { fontSize: "18px", color: "#6b7280", fontWeight: 500, margin: 0 },
  emptyHint: { fontSize: "14px", color: "#4b5563", margin: 0 },

  // 专辑网格
  albumGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
    gap: "24px",
  },
  albumCard: {
    borderRadius: "12px", overflow: "hidden",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.06)",
  },
  albumCardActive: {
    border: "2px solid #e94560", boxShadow: "0 0 20px rgba(233,69,96,0.2)",
  },

  // 封面
  coverWrapper: {
    position: "relative", width: "100%", aspectRatio: "1 / 1",
    overflow: "hidden", background: "#1a1a2e",
  },
  coverImage: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  coverPlaceholder: {
    width: "100%", height: "100%", display: "flex",
    alignItems: "center", justifyContent: "center",
    background: "linear-gradient(135deg, #1e1e3a, #2a1a3a)",
  },
  coverPlaceholderIcon: { fontSize: "40px", opacity: 0.4 },
  playingBadge: {
    position: "absolute", top: "8px", left: "8px", padding: "3px 10px",
    borderRadius: "12px", background: "rgba(233,69,96,0.9)", color: "#fff",
    fontSize: "11px", fontWeight: 600, letterSpacing: "0.3px",
    backdropFilter: "blur(4px)",
  },
  songCount: {
    position: "absolute", bottom: "8px", right: "8px", padding: "2px 10px",
    borderRadius: "10px", background: "rgba(0,0,0,0.6)", color: "#d1d5db",
    fontSize: "11px", fontWeight: 500, backdropFilter: "blur(4px)",
  },
  albumTitle: {
    fontSize: "14px", fontWeight: 600, color: "#f3f4f6",
    margin: "10px 12px 2px", overflow: "hidden",
    textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  albumArtist: {
    fontSize: "12px", color: "#9ca3af",
    margin: "0 12px 12px", overflow: "hidden",
    textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
};
