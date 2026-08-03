import { useState, useMemo } from "react";
import { FaMusic, FaCompactDisc, FaUser, FaListUl, FaArrowLeft } from "react-icons/fa";

/* ================================================================
   🔍 Search — 侧边栏搜索输入框
   ================================================================ */
export default function Search({ filterText, setFilterText, activeNav, onNavChange }) {
  function handleFocus() {
    if (activeNav !== "search") {
      onNavChange("search");
    }
  }

  return (
    <div style={styles.searchContainer} className="search-box">
      <span style={styles.searchIcon}>🔍</span>
      <input
        className="search-box-input"
        style={styles.searchInput}
        type="text"
        placeholder="搜索"
        value={filterText}
        onChange={(e) => setFilterText(e.target.value)}
        onFocus={handleFocus}
      />
      {filterText && (
        <span style={styles.clearBtn} onClick={() => setFilterText("")}>
          ✕
        </span>
      )}
    </div>
  );
}

/* ================================================================
   搜索匹配度计算
   ================================================================ */
function computeSongScore(song, q) {
  let score = 0;
  const t = (song.title || "").toLowerCase();
  const a = (song.artist || "").toLowerCase();
  const al = (song.album || "").toLowerCase();
  if (t === q) score += 20;
  if (t.startsWith(q)) score += 5;
  if (t.includes(q)) score += 10;
  if (a.includes(q)) score += 5;
  if (al.includes(q)) score += 3;
  return score;
}

/* ================================================================
   🔍 SearchResults — 搜索结果页
   ================================================================ */
export function SearchResults({
  filterText,
  albums,
  playlists,
  onPlaySong,
  onOpenAlbum,
  onOpenArtist,
  onOpenPlaylist,
  onNavChange,
  currentSongIndex,
  currentAlbumId,
  isPlaying,
  togglePlay,
}) {
  const [detailCategory, setDetailCategory] = useState(null);
  const query = filterText.toLowerCase().trim();
  const hasQuery = query.length > 0;

  // ---------- 计算所有匹配结果 ----------
  const allResults = useMemo(() => {
    if (!hasQuery) return { songs: [], albums: [], artists: [], playlists: [] };

    const allSongs = albums.flatMap((album) =>
      album.songs.map((song, idx) => ({
        ...song,
        albumId: album.id,
        songIndex: idx,
        albumTitle: album.title,
        albumYear: album.year,
      }))
    );

    const scoredSongs = allSongs
      .map((song) => ({ ...song, score: computeSongScore(song, query) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    const albumScores = {};
    scoredSongs.forEach((s) => {
      if (!albumScores[s.albumId]) albumScores[s.albumId] = { score: 0, matchCount: 0 };
      albumScores[s.albumId].score += s.score;
      albumScores[s.albumId].matchCount += 1;
    });
    const scoredAlbums = albums
      .filter((a) => albumScores[a.id])
      .map((a) => ({ ...a, ...albumScores[a.id] }))
      .sort((a, b) => b.score - a.score);

    const artistScores = {};
    scoredSongs.forEach((s) => {
      const name = s.artist || "未知艺术家";
      if (!artistScores[name]) artistScores[name] = { score: 0, matchCount: 0 };
      artistScores[name].score += s.score;
      artistScores[name].matchCount += 1;
    });
    const allArtistNames = [...new Set(albums.map((a) => a.artist))];
    const scoredArtists = allArtistNames
      .filter((name) => artistScores[name])
      .map((name) => ({
        name,
        score: artistScores[name].score,
        matchCount: artistScores[name].matchCount,
        albumCount: albums.filter((a) => a.artist === name).length,
      }))
      .sort((a, b) => b.score - a.score);

    const plScores = {};
    playlists.forEach((pl) => {
      let total = 0, count = 0;
      pl.songs.forEach((song) => {
        const sc = computeSongScore(song, query);
        if (sc > 0) { total += sc; count += 1; }
      });
      if (count > 0) plScores[pl.id] = { score: total, matchCount: count };
    });
    const scoredPlaylists = playlists
      .filter((pl) => plScores[pl.id])
      .map((pl) => ({ ...pl, ...plScores[pl.id], songCount: pl.songs.length }))
      .sort((a, b) => b.score - a.score);

    return { songs: scoredSongs, albums: scoredAlbums, artists: scoredArtists, playlists: scoredPlaylists };
  }, [query, albums, playlists, hasQuery]);

  // ---------- 空状态 ----------
  if (!hasQuery) {
    return (
      <div style={pageStyles.emptyState}>
        <span style={pageStyles.emptyIcon}>🔍</span>
      </div>
    );
  }

  const hasAnyResult =
    allResults.songs.length > 0 ||
    allResults.albums.length > 0 ||
    allResults.artists.length > 0 ||
    allResults.playlists.length > 0;

  if (!hasAnyResult) {
    return (
      <div style={pageStyles.emptyState}>
        <span style={pageStyles.emptyIcon}>🔍</span>
        <p style={pageStyles.emptyText}>无相关内容</p>
      </div>
    );
  }

  // ---------- 详情视图（查看全部） ----------
  if (detailCategory) {
    return (
      <SearchCategoryDetail
        category={detailCategory}
        results={allResults}
        albums={albums}
        playlists={playlists}
        onBack={() => setDetailCategory(null)}
        onPlaySong={onPlaySong}
        onOpenAlbum={onOpenAlbum}
        onOpenArtist={onOpenArtist}
        onOpenPlaylist={onOpenPlaylist}
        onNavChange={onNavChange}
        currentSongIndex={currentSongIndex}
        currentAlbumId={currentAlbumId}
        isPlaying={isPlaying}
        togglePlay={togglePlay}
      />
    );
  }

  // ---------- 网格概览视图 ----------
  return (
    <div style={pageStyles.container} className="search-results">
      {/* 歌曲 */}
      {allResults.songs.length > 0 && (
        <div style={pageStyles.section}>
          <div className="search-section-header">
            <h2>歌曲</h2>
            {allResults.songs.length > 8 && (
              <span className="search-show-all" onClick={() => setDetailCategory("songs")}>&gt;</span>
            )}
          </div>
          <div className="search-grid search-grid-4">
              {allResults.songs.slice(0, 8).map((item) => {
              const isActive = currentAlbumId === item.albumId && currentSongIndex === item.songIndex;
              return (
                <div
                  key={`song-${item.albumId}-${item.songIndex}`}
                  className={`search-song-card${isActive ? " search-song-card-active" : ""}`}
                  onClick={() => {
                    if (isActive && togglePlay) togglePlay();
                    else onPlaySong(item.albumId, item.songIndex);
                  }}
                >
                  {item.coverURL ? (
                    <img src={item.coverURL} alt="" className="search-song-thumb" />
                  ) : (
                    <div className="search-song-thumb-placeholder"><FaMusic /></div>
                  )}
                  <div className="search-song-card-info">
                    <span className="search-song-card-title">{item.title}</span>
                    <span className="search-song-card-meta">{item.artist}{item.albumYear ? ` · ${item.albumYear}` : ""}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 专辑 */}
      {allResults.albums.length > 0 && (
        <div style={pageStyles.section}>
          <div className="search-section-header">
            <h2>专辑</h2>
            {allResults.albums.length > 5 && (
              <span className="search-show-all" onClick={() => setDetailCategory("albums")}>&gt;</span>
            )}
          </div>
          <div className="search-grid search-grid-5">
            {allResults.albums.slice(0, 5).map((item) => (
              <div
                key={`album-${item.id}`}
                className="search-result-card"
                onClick={() => { onNavChange("library"); onOpenAlbum(item.id); }}
              >
                {item.coverURL ? (
                  <img src={item.coverURL} alt="" className="search-result-card-cover" />
                ) : (
                  <div className="search-result-card-placeholder"><FaCompactDisc /></div>
                )}
                <div className="search-album-info">
                  <span className="search-album-title">{item.title}</span>
                  <span className="search-album-artist">{item.artist}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 艺人 */}
      {allResults.artists.length > 0 && (
        <div style={pageStyles.section}>
          <div className="search-section-header">
            <h2>艺人</h2>
            {allResults.artists.length > 5 && (
              <span className="search-show-all" onClick={() => setDetailCategory("artists")}>&gt;</span>
            )}
          </div>
          <div className="search-grid search-grid-5">
            {allResults.artists.slice(0, 5).map((item) => (
              <div
                key={`artist-${item.name}`}
                className="search-result-card"
                onClick={() => { onNavChange("artists"); onOpenArtist(item.name); }}
              >
                <div className="search-artist-avatar"><FaUser /></div>
                <span className="search-artist-name">{item.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 播放列表 */}
      {allResults.playlists.length > 0 && (
        <div style={pageStyles.section}>
          <div className="search-section-header">
            <h2>播放列表</h2>
            {allResults.playlists.length > 5 && (
              <span className="search-show-all" onClick={() => setDetailCategory("playlists")}>&gt;</span>
            )}
          </div>
          <div className="search-grid search-grid-5">
            {allResults.playlists.slice(0, 5).map((item) => (
              <div
                key={`pl-${item.id}`}
                className="search-result-card"
                onClick={() => { onNavChange("library"); onOpenPlaylist(item.id); }}
              >
                {item.coverURL ? (
                  <img src={item.coverURL} alt="" className="search-result-card-cover" />
                ) : (
                  <div className="search-result-card-placeholder"><FaListUl /></div>
                )}
                <div className="search-pl-info">
                  <span className="search-pl-name">{item.name}</span>
                  <span className="search-pl-count">{item.songCount} 首歌曲</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ================================================================
   📄 SearchCategoryDetail — 某个分类的完整结果列表
   ================================================================ */
function SearchCategoryDetail({
  category,
  results,
  albums,
  playlists,
  onBack,
  onPlaySong,
  onOpenAlbum,
  onOpenArtist,
  onOpenPlaylist,
  onNavChange,
  currentSongIndex,
  currentAlbumId,
  isPlaying,
  togglePlay,
}) {
  const titles = { songs: "歌曲", albums: "专辑", artists: "艺人", playlists: "播放列表" };
  const items = results[category];

  function renderItem(item, idx) {
    if (category === "songs") {
      const isActive = currentAlbumId === item.albumId && currentSongIndex === item.songIndex;
      return (
        <div
          key={`song-${item.albumId}-${item.songIndex}`}
          className={`search-song-card${isActive ? " search-song-card-active" : ""}`}
          onClick={() => {
            if (isActive && togglePlay) togglePlay();
            else onPlaySong(item.albumId, item.songIndex);
          }}
        >
          {item.coverURL ? (
            <img src={item.coverURL} alt="" className="search-song-thumb" />
          ) : (
            <div className="search-song-thumb-placeholder"><FaMusic /></div>
          )}
          <div className="search-song-card-info">
            <span className="search-song-card-title">{item.title}</span>
            <span className="search-song-card-meta">{item.artist}{item.albumYear ? ` · ${item.albumYear}` : ""}</span>
          </div>
        </div>
      );
    }
    if (category === "albums") {
      return (
        <div
          key={`album-${item.id}`}
          className="search-result-card"
          onClick={() => { onNavChange("library"); onOpenAlbum(item.id); }}
        >
          {item.coverURL ? (
            <img src={item.coverURL} alt="" className="search-result-card-cover" />
          ) : (
            <div className="search-result-card-placeholder"><FaCompactDisc /></div>
          )}
          <div className="search-album-info">
            <span className="search-album-title">{item.title}</span>
            <span className="search-album-artist">{item.artist}</span>
          </div>
        </div>
      );
    }
    if (category === "artists") {
      return (
        <div
          key={`artist-${item.name}`}
          className="search-result-card"
          onClick={() => { onNavChange("artists"); onOpenArtist(item.name); }}
        >
          <div className="search-artist-avatar"><FaUser /></div>
          <span className="search-artist-name">{item.name}</span>
        </div>
      );
    }
    if (category === "playlists") {
      return (
        <div
          key={`pl-${item.id}`}
          className="search-result-card"
          onClick={() => { onNavChange("library"); onOpenPlaylist(item.id); }}
        >
          {item.coverURL ? (
            <img src={item.coverURL} alt="" className="search-result-card-cover" />
          ) : (
            <div className="search-result-card-placeholder"><FaListUl /></div>
          )}
          <div className="search-pl-info">
            <span className="search-pl-name">{item.name}</span>
            <span className="search-pl-count">{item.songCount} 首歌曲</span>
          </div>
        </div>
      );
    }
    return null;
  }

  const gridClass = category === "songs" ? "search-grid-4" : "search-grid-5";

  return (
    <div style={pageStyles.container} className="search-results">
      <div style={pageStyles.detailHeader}>
        <button className="detail-back-btn" style={pageStyles.backBtn} onClick={onBack} title="返回">
          <FaArrowLeft size={16} />
        </button>
        <h2 style={pageStyles.detailTitle}>{titles[category]} · 搜索结果</h2>
      </div>
      <div className={`search-grid ${gridClass}`}>
        {items.map((item, i) => renderItem(item, i))}
      </div>
    </div>
  );
}

/* ================================================================
   🎨 样式
   ================================================================ */
const styles = {
  searchContainer: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 10px",
    borderRadius: "8px",
    background: "#f3f4f6",
    border: "1px solid #e5e7eb",
    transition: "border-color 0.2s",
  },
  searchIcon: {
    fontSize: "14px",
    opacity: 0.5,
    flexShrink: 0,
  },
  searchInput: {
    flex: 1,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "#1f2937",
    fontSize: "13px",
    fontFamily: "inherit",
  },
  clearBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "20px",
    height: "20px",
    borderRadius: "50%",
    fontSize: "12px",
    lineHeight: 1,
    cursor: "pointer",
    opacity: 0.5,
    flexShrink: 0,
    transition: "background 0.15s, opacity 0.15s",
  },
};

const pageStyles = {
  container: {
    flex: 1,
    padding: "0 0 160px",
    fontFamily: "'Segoe UI', sans-serif",
  },
  section: {
    marginBottom: "28px",
  },
  emptyState: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    color: "#9ca3af",
  },
  emptyIcon: {
    fontSize: "48px",
    opacity: 0.4,
  },
  emptyText: {
    fontSize: "14px",
    margin: 0,
  },
  detailHeader: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
    marginBottom: "20px",
    position: "relative",
  },
  backBtn: {
    width: "36px",
    height: "36px",
    borderRadius: "50%",
    border: "1px solid #e5e7eb",
    background: "#f3f4f6",
    color: "#374151",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background 0.2s, transform 0.15s",
    flexShrink: 0,
    padding: 0,
    fontFamily: "inherit",
  },
  detailTitle: {
    fontSize: "16px",
    fontWeight: 700,
    color: "#1f2937",
    margin: 0,
  },
};
