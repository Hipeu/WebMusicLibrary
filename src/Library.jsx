import { useState, useRef } from "react";
import { FiPlus } from "react-icons/fi";
import { readMetadata } from "./MetadataReader";
import MusicPlayer from "./MusicPlayer";
import AlbumDetail from "./AlbumDetail";
import CoverPlayButton from "./CoverPlayButton";

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

  // ---------- 专辑详情页状态 ----------
  const [detailAlbumId, setDetailAlbumId] = useState(null);

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
            year: entry.year || null,
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
      for (const a of prev) {
        merged.set(a.title, { ...a, songs: [...a.songs] });
      }
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
          // 补全封面：已有专辑没有封面时用新专辑的
          if (!existing.coverURL && a.coverURL) {
            existing.coverURL = a.coverURL;
          }
          // 补全年份：已有专辑没有年份时用新专辑的
          if (!existing.year && a.year) {
            existing.year = a.year;
          }
          // 补全艺人：已有专辑是未知时用新专辑的
          if ((existing.artist === "未知艺术家" || !existing.artist) && a.artist && a.artist !== "未知艺术家") {
            existing.artist = a.artist;
          }
        } else {
          merged.set(a.title, { ...a, songs: [...a.songs] });
        }
      }
      return Array.from(merged.values());
    });
  }

    // ---------- 点击专辑卡片 — 打开专辑详情页 ----------
    function handleOpenAlbumDetail(albumId) {
      setDetailAlbumId(albumId);
    }

    // ---------- 从卡片播放按钮播放/暂停 ----------
    function handleQuickPlay(albumId) {
      const album = albums.find((a) => a.id === albumId);
      if (!album || album.songs.length === 0) return;

      if (currentAlbumId === albumId) {
        // 同一专辑：切换播放/暂停
        togglePlay();
      } else {
        setCurrentAlbumId(albumId);
        setCurrentSongIndex(0);
        setIsPlaying(true);
      }
    }

  // ---------- 从详情页播放整个专辑 ----------
  function handlePlayAlbumFromDetail() {
    const album = albums.find((a) => a.id === detailAlbumId);
    if (!album || album.songs.length === 0) return;

    if (currentAlbumId === detailAlbumId) {
      // 同一专辑：切换播放/暂停
      togglePlay();
    } else {
      setCurrentAlbumId(detailAlbumId);
      setCurrentSongIndex(0);
      setIsPlaying(true);
    }
  }

  // ---------- 从详情页选择歌曲播放 ----------
  function handlePlaySongFromDetail(songIndex) {
    setCurrentAlbumId(detailAlbumId);
    setCurrentSongIndex(songIndex);
    setIsPlaying(true);
  }

  // ---------- 关闭详情页 ----------
  function handleCloseDetail() {
    setDetailAlbumId(null);
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
          transform: scale(1.1);
          box-shadow: 0 6px 25px rgba(233,69,96,0.5);
        }
        .upload-btn:active {
          transform: scale(0.92);
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
          background: #f3f4f6;
          transition: background 0.2s, transform 0.1s;
        }
        .ctrl-btn:hover {
          background: #e5e7eb !important;
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
          background: #d1d5db;
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
          background: #e5e7eb !important;
          transform: scale(1.03);
        }
                .detail-song-item:hover {
          background: #f3f4f6 !important;
        }
        .album-card:hover .cover-play-btn {
          opacity: 1 !important;
          transform: scale(1) !important;
        }
        .cover-play-btn:hover .cover-play-btn-inner {
          transform: scale(1.1);
          box-shadow: 0 6px 24px rgba(233,69,96,0.7);
        }
        .cover-play-btn:active .cover-play-btn-inner {
          transform: scale(0.92);
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
    title="导入音乐"
  >
    <FiPlus size={18} />
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
      {/* ② 中间内容区 — 专辑网格 或 专辑详情页                           */}
      {/* ================================================================ */}
      {detailAlbumId ? (
        /* ----- 专辑详情页 ----- */
        <div style={styles.detailPageArea}>
          <AlbumDetail
            album={albums.find((a) => a.id === detailAlbumId)}
            currentSongIndex={
              detailAlbumId === currentAlbumId ? currentSongIndex : -1
            }
            isPlaying={detailAlbumId === currentAlbumId && isPlaying}
            onPlayAlbum={handlePlayAlbumFromDetail}
            onPlaySong={handlePlaySongFromDetail}
            onBack={handleCloseDetail}
          />
        </div>
      ) : (
        /* ----- 专辑网格 ----- */
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
                    onClick={() => handleOpenAlbumDetail(album.id)}
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
                                            {/* 播放/暂停控制按钮（悬停显示） */}
                      <CoverPlayButton
                        isActive={album.id === currentAlbumId}
                        isPlaying={isPlaying}
                        onTogglePlay={() => handleQuickPlay(album.id)}
                      />
                      {/* 正在播放标签（当前播放专辑左上角） */}
                      {album.id === currentAlbumId && (
                        <div style={styles.playingBadge}>
                          ▶ 正在播放
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
      )}

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
        background: "#ffffff",
    color: "#1f2937", overflow: "hidden",
    fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
  },

  // 顶部功能条
  topBar: {
    display: "flex", alignItems: "center", gap: "16px",
    padding: "12px 28px",
        background: "#f9fafb",
    borderBottom: "1px solid #e5e7eb",
    flexShrink: 0, zIndex: 10, flexWrap: "wrap",
  },
  logoArea: { display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 },
  logoIcon: { fontSize: "24px" },
  logoTitle: {
        fontSize: "18px", fontWeight: 700, color: "#1f2937",
    letterSpacing: "0.5px", margin: 0,
  },
  searchArea: {
    display: "flex", alignItems: "center",
        background: "#f3f4f6", borderRadius: "24px",
    padding: "6px 14px", flex: "1 1 280px", maxWidth: "400px",
    border: "1px solid #e5e7eb", transition: "border-color 0.2s",
  },
  searchIcon: { fontSize: "14px", marginRight: "8px", opacity: 0.5 },
  searchInput: {
        flex: 1, background: "transparent", border: "none",
    outline: "none", color: "#1f2937", fontSize: "14px", fontFamily: "inherit",
  },
  clearBtn: {
    fontSize: "14px", cursor: "pointer", opacity: 0.5,
    padding: "2px", transition: "opacity 0.2s",
  },
    importBtn: {
    display: "flex", alignItems: "center", justifyContent: "center",
    width: "40px", height: "40px", padding: 0,
    borderRadius: "50%", border: "none",
    background: "linear-gradient(135deg, #e94560, #c73e52)",
    color: "#fff", fontSize: "18px",
    cursor: "pointer", boxShadow: "0 4px 15px rgba(233,69,96,0.3)", flexShrink: 0,
    marginLeft: "auto",
    transition: "transform 0.2s, box-shadow 0.2s",
  },
  stats: { fontSize: "12px", color: "#6b7280", whiteSpace: "nowrap", flexShrink: 0 },

    // 中间内容区
  mainArea: { flex: 1, overflowY: "auto", padding: "28px 28px 160px" },
  // 专辑详情页容器
  detailPageArea: { flex: 1, overflow: "hidden", padding: "0 0 120px" },

  // 空状态
  emptyState: {
    display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", height: "100%", minHeight: "300px", gap: "12px",
  },
  emptyIcon: { fontSize: "56px", opacity: 0.3 },
  emptyText: { fontSize: "18px", color: "#374151", fontWeight: 500, margin: 0 },
  emptyHint: { fontSize: "14px", color: "#6b7280", margin: 0 },

  // 专辑网格
  albumGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
    gap: "24px",
  },
  albumCard: {
        borderRadius: "12px", overflow: "hidden",
    background: "#ffffff",
    border: "1px solid #e5e7eb",
  },
  albumCardActive: {
    border: "2px solid #e94560", boxShadow: "0 0 20px rgba(233,69,96,0.2)",
  },

  // 封面
  coverWrapper: {
    position: "relative", width: "100%", aspectRatio: "1 / 1",
    overflow: "hidden", background: "#f3f4f6",
  },
  coverImage: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  coverPlaceholder: {
    width: "100%", height: "100%", display: "flex",
    alignItems: "center", justifyContent: "center",
    background: "#e5e7eb",
  },
  coverPlaceholderIcon: { fontSize: "40px", opacity: 0.4 },
  playingBadge: {
    position: "absolute", top: "8px", left: "8px", padding: "3px 10px",
    borderRadius: "12px",     background: "#e94560", color: "#fff",
    fontSize: "11px", fontWeight: 600, letterSpacing: "0.3px",
    backdropFilter: "blur(4px)",
  },
  songCount: {
    position: "absolute", bottom: "8px", right: "8px", padding: "2px 10px",
    borderRadius: "10px",     background: "rgba(0,0,0,0.7)", color: "#fff",
    fontSize: "11px", fontWeight: 500, backdropFilter: "blur(4px)",
  },
  albumTitle: {
    fontSize: "14px", fontWeight: 600, color: "#1f2937",
    margin: "10px 12px 2px", overflow: "hidden",
    textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  albumArtist: {
    fontSize: "12px", color: "#6b7280",
    margin: "0 12px 12px", overflow: "hidden",
    textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
};
