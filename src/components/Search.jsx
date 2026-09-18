import { useState, useMemo } from "react";
import { FaMusic, FaCompactDisc, FaUser, FaListUl, FaArrowLeft, FaExclamationCircle, FaFilm } from "react-icons/fa";
import { songPlayable } from "../utils/formatCheck";
import { getAssetUrl } from "../services/api";
import { splitArtists, collectAllArtists, albumBelongsToArtist } from "../utils/artistSplit";
import { videoMatchesSong } from "../utils/videoAssociations";
import { getPlaylistCoverInfo } from "../utils/playlistStore";
import useCoverColor from "./CoverColor";
import ExplicitTitle from "./ExplicitTitle";

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
function computeTextScore(value, q, exactScore, containsScore) {
  const text = (value || "").toLowerCase();
  if (!text || !q || !text.includes(q)) return 0;
  return text === q ? exactScore : containsScore;
}

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

function getArtistCover(artistName, albums, artistRecords) {
  const recordCover = artistRecords?.[artistName]?.cover_url;
  if (recordCover) return getAssetUrl(recordCover);
  return (albums || []).find((album) => albumBelongsToArtist(album, artistName))?.coverURL || null;
}

function SearchPlaylistCard({ item, onClick }) {
  const { url: cover, revision: coverRevision } = getPlaylistCoverInfo(item);
  const styled = item.id === "liked" || item.id === "recent" || !!item.coverStyle;
  const palette = useCoverColor(styled && cover ? cover : null, coverRevision);
  const swatch = palette?.Vibrant || palette?.Muted || palette?.DarkVibrant || palette?.LightVibrant;

  return <div className="search-result-card" onClick={onClick}>
    <div style={{ position: "relative", width: "fit-content" }}>
      {cover ? <img src={cover} alt="" className="search-result-card-cover" /> : <div className="search-result-card-placeholder"><FaListUl /></div>}
      {styled && cover && swatch && <div className="search-playlist-cover-overlay" style={{ background: swatch.hex }} />}
      {styled && cover && <div className="search-playlist-cover-title"><span>{item.name}</span></div>}
    </div>
    <div className="search-pl-info">
      <span className="search-pl-name">{item.name}</span>
      <span className="search-pl-count">{item.songCount} 首歌曲</span>
    </div>
  </div>;
}

function getVideoCover(video, albums) {
  if (video?.cover_url) return video.cover_url;
  const linkedSong = (albums || []).flatMap((album) => album.songs || []).find((song) => videoMatchesSong(video, song));
  return linkedSong?.coverURL || null;
}

function SearchVideoCard({ item, albums, onClick }) {
  const cover = getVideoCover(item, albums);
  const isMissing = item.source === "local" && item.file_exists === false;
  return <div className={`search-result-card search-video-card${isMissing ? " search-video-card-missing" : ""}`} onClick={onClick}>
    {cover ? <img src={cover} alt="" className="search-result-card-cover search-video-card-cover" /> : <div className="search-result-card-placeholder search-video-card-cover"><FaFilm /></div>}
    <div className="search-album-info">
      <span className="search-album-title">{item.title || "未命名视频"}</span>
      <span className="search-album-artist">{item.artist || item.source_label || "视频"}{isMissing ? " · 文件缺失" : ""}</span>
    </div>
  </div>;
}

/* ================================================================
   🔍 SearchResults — 搜索结果页
   ================================================================ */
export function SearchResults({
  filterText,
  albums,
  playlists,
  videos,
  artistRecords,
  onPlaySong,
  onOpenAlbum,
  onOpenArtist,
  onOpenPlaylist,
  onOpenVideo,
  onNavChange,
  currentSongIndex,
  currentAlbumId,
  togglePlay,
}) {
  const [detailCategory, setDetailCategory] = useState(null);
  const query = filterText.toLowerCase().trim();
  const hasQuery = query.length > 0;

  // ---------- 计算所有匹配结果 ----------
  const allResults = useMemo(() => {
    if (!hasQuery) return { songs: [], albums: [], artists: [], playlists: [], videos: [] };

    const allSongs = (albums || []).flatMap((album) =>
      (album.songs || []).map((song, idx) => ({
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
    const autoOrganize = localStorage.getItem("edit-auto-organize-collab") !== "false";
    const artistKeys = (value) => (autoOrganize ? splitArtists(value) : [value].filter(Boolean));
    scoredSongs.forEach((s) => {
      artistKeys(s.artist || "未知艺术家").forEach((name) => {
        if (!artistScores[name]) artistScores[name] = { score: 0, matchCount: 0 };
        artistScores[name].score += s.score;
        artistScores[name].matchCount += 1;
      });
    });
    // 艺人名本身也必须能命中。此前只从已命中的歌曲反推艺人，
    // 导致只有艺人资料、或歌曲字段未包含查询词时，艺人栏目为空。
    const allArtistNames = autoOrganize
      ? collectAllArtists(albums || [], artistRecords || {})
      : [...new Set([
        ...(albums || []).map((a) => a.artist),
        ...Object.keys(artistRecords || {}),
      ].filter(Boolean))];
    const scoredArtists = allArtistNames
      .map((name) => {
        const directScore = computeTextScore(name, query, 20, 10);
        const songScore = artistScores[name] || { score: 0, matchCount: 0 };
        return { name, score: songScore.score + directScore, matchCount: songScore.matchCount };
      })
      .filter((artist) => artist.score > 0)
      .map((artist) => ({
        ...artist,
        albumCount: autoOrganize
          ? (albums || []).filter((a) => albumBelongsToArtist(a, artist.name)).length
          : (albums || []).filter((a) => a.artist === artist.name).length,
      }))
      .sort((a, b) => b.score - a.score);

    const plScores = {};
    (playlists || []).forEach((pl) => {
      let total = 0, count = 0;
      // 播放列表名称命中即参与结果
      const playlistText = [pl.name, pl.description].filter(Boolean).join(" ");
      const directScore = computeTextScore(playlistText, query, 20, 10);
      if (directScore > 0) {
        total += directScore;
        count += 1;
      }
      (pl.songs || []).forEach((song) => {
        const sc = computeSongScore(song, query);
        if (sc > 0) { total += sc; count += 1; }
      });
      if (count > 0) plScores[pl.id] = { score: total, matchCount: count };
    });
    const scoredPlaylists = (playlists || [])
      .filter((pl) => plScores[pl.id])
      .map((pl) => ({ ...pl, ...plScores[pl.id], songCount: (pl.songs || []).length }))
      .sort((a, b) => b.score - a.score);

    const scoredVideos = (videos || [])
      .map((video) => {
        const videoText = [video.title, video.artist, video.producer, video.cast, video.source_label, video.source, video.website_url].filter(Boolean).join(" ");
        const directScore = computeTextScore(videoText, query, 20, 10);
        const linkedSongScore = allSongs
          .filter((song) => videoMatchesSong(video, song))
          .reduce((total, song) => total + computeSongScore(song, query), 0);
        return { ...video, score: directScore + linkedSongScore };
      })
      .filter((video) => video.score > 0)
      .sort((a, b) => b.score - a.score);

    return { songs: scoredSongs, albums: scoredAlbums, artists: scoredArtists, playlists: scoredPlaylists, videos: scoredVideos };
  }, [query, albums, playlists, videos, artistRecords, hasQuery]);

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
    allResults.playlists.length > 0 ||
    allResults.videos.length > 0;

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
        artistRecords={artistRecords}
        onBack={() => setDetailCategory(null)}
        onPlaySong={onPlaySong}
        onOpenAlbum={onOpenAlbum}
        onOpenArtist={onOpenArtist}
        onOpenPlaylist={onOpenPlaylist}
        onOpenVideo={onOpenVideo}
        onNavChange={onNavChange}
        currentSongIndex={currentSongIndex}
        currentAlbumId={currentAlbumId}
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
                    <span className="search-song-card-title">
                      {!songPlayable(item) && (
                        <FaExclamationCircle size={12} title="该格式无法播放" style={{ color: "#f59e0b", marginRight: "5px", flexShrink: 0 }} />
                      )}
                      <ExplicitTitle>{item.title}</ExplicitTitle>
                    </span>
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
                  <span className="search-album-title"><ExplicitTitle>{item.title}</ExplicitTitle></span>
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
                {getArtistCover(item.name, albums, artistRecords) ? (
                  <img src={getArtistCover(item.name, albums, artistRecords)} alt="" className="search-artist-avatar" />
                ) : <div className="search-artist-avatar"><FaUser /></div>}
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
              <SearchPlaylistCard
                key={`pl-${item.id}`}
                item={item}
                onClick={() => { onNavChange("library"); onOpenPlaylist(item.id); }}
              />
            ))}
          </div>
        </div>
      )}

      {/* 视频 */}
      {allResults.videos.length > 0 && (
        <div style={pageStyles.section}>
          <div className="search-section-header">
            <h2>视频</h2>
            {allResults.videos.length > 5 && <span className="search-show-all" onClick={() => setDetailCategory("videos")}> &gt;</span>}
          </div>
          <div className="search-grid search-grid-5">
            {allResults.videos.slice(0, 5).map((item) => <SearchVideoCard key={`video-${item.id}`} item={item} albums={albums} onClick={() => onOpenVideo(item.id)} />)}
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
  artistRecords,
  onBack,
  onPlaySong,
  onOpenAlbum,
  onOpenArtist,
  onOpenPlaylist,
  onOpenVideo,
  onNavChange,
  currentSongIndex,
  currentAlbumId,
  togglePlay,
}) {
  const titles = { songs: "歌曲", albums: "专辑", artists: "艺人", playlists: "播放列表", videos: "视频" };
  const items = results[category];

  function renderItem(item) {
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
            <span className="search-song-card-title">
              {!songPlayable(item) && (
                <FaExclamationCircle size={12} title="该格式无法播放" style={{ color: "#f59e0b", marginRight: "5px", flexShrink: 0 }} />
              )}
              <ExplicitTitle>{item.title}</ExplicitTitle>
            </span>
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
            <span className="search-album-title"><ExplicitTitle>{item.title}</ExplicitTitle></span>
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
          {getArtistCover(item.name, albums, artistRecords) ? (
            <img src={getArtistCover(item.name, albums, artistRecords)} alt="" className="search-artist-avatar" />
          ) : <div className="search-artist-avatar"><FaUser /></div>}
          <span className="search-artist-name">{item.name}</span>
        </div>
      );
    }
    if (category === "playlists") {
      return (
        <SearchPlaylistCard
          key={`pl-${item.id}`}
          item={item}
          onClick={() => { onNavChange("library"); onOpenPlaylist(item.id); }}
        />
      );
    }
    if (category === "videos") {
      return <SearchVideoCard key={`video-${item.id}`} item={item} albums={albums} onClick={() => onOpenVideo(item.id)} />;
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
