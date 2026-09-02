import { useMemo, useState } from "react";
import { FaArrowLeft, FaCompactDisc, FaSearch, FaUser, FaVideo } from "react-icons/fa";
import useCoverColor from "./CoverColor";
import { getAssetUrl } from "../services/api";
import { albumBelongsToArtist, splitArtists } from "../utils/artistSplit";

const splitValues = (value) => String(value || "").split(/[,，/、&;；]/).map((item) => item.trim()).filter(Boolean);
const unique = (items) => Array.from(new Set(items));
const matches = (album, field, value) => splitValues(album[field]).includes(value) || (album.songs || []).some((song) => splitValues(song[field] || album[field]).includes(value));

function AlbumCard({ album, onOpen }) {
  return <button type="button" className="metadata-album-card" style={styles.albumCard} onClick={() => onOpen?.(album.id)}>
    {album.coverURL ? <img src={album.coverURL} alt="" style={styles.albumCover} /> : <div style={styles.albumPlaceholder}><FaCompactDisc /></div>}
    <span style={styles.albumName}>{album.title}</span><span style={styles.albumArtist}>{album.artist}</span>
  </button>;
}

function ArtistCard({ artist, albums, artistRecords, onOpen }) {
  const stored = artistRecords?.[artist]?.cover_url;
  const cover = stored ? getAssetUrl(stored) : albums.find((album) => albumBelongsToArtist(album, artist))?.coverURL;
  return <button type="button" className="metadata-artist-card" style={styles.artistCard} onClick={() => onOpen?.(artist)}>
    {cover ? <img src={cover} alt="" style={styles.artistCover} /> : <div style={styles.artistPlaceholder}><FaUser /></div>}
    <span style={styles.artistName}>{artist}</span>
  </button>;
}

function SectionTitle({ children, more, onMore }) {
  return <div style={styles.headingRow}><h2 style={styles.heading}>{children}</h2>{more && <button type="button" style={styles.moreLink} onClick={onMore}>查看全部 ›</button>}</div>;
}

function GenreDetail({ genre, albums, artistRecords, view, onRouteChange, onOpenAlbum, onOpenArtist }) {
  const related = albums.filter((album) => matches(album, "genre", genre));
  const spotlight = related.filter((album) => album.coverURL).slice(0, 3);
  const palette = useCoverColor(spotlight[0]?.coverURL || null);
  const color = palette?.Muted?.hex || palette?.Vibrant?.hex || "#64748b";
  const artists = unique(related.flatMap((album) => splitArtists(album.artist)));
  const recent = [...related].sort((a, b) => (b.importTime || 0) - (a.importTime || 0));
  const allMode = view?.startsWith("all-");
  const allItems = view === "all-recent" ? recent : view === "all-artists" ? artists : related;
  const allTitle = view === "all-recent" ? "新入库" : view === "all-artists" ? "相关艺人" : "相关专辑";
  if (allMode) return <div className="metadata-browser-page" style={styles.page}>
    <button type="button" className="detail-back-btn" style={styles.back} onClick={() => onRouteChange(genre, "detail")}><FaArrowLeft /></button>
    <h1 style={styles.title}>{genre} · {allTitle}</h1>
    {view === "all-artists" ? <div style={styles.artistGrid}>{allItems.map((artist) => <ArtistCard key={artist} artist={artist} albums={albums} artistRecords={artistRecords} onOpen={onOpenArtist} />)}</div> : <div style={styles.albumGrid}>{allItems.map((album) => <AlbumCard key={album.id} album={album} onOpen={onOpenAlbum} />)}</div>}
  </div>;
  return <div className="metadata-browser-page" style={styles.page}>
    <section style={{ ...styles.genreHero, background: `linear-gradient(120deg, ${color}55, ${color}18 58%, transparent)` }}>
      <button type="button" className="detail-back-btn" style={styles.back} onClick={() => onRouteChange(null, "list")}><FaArrowLeft /></button>
      <h1 style={styles.genreTitle}>{genre}</h1>
      <div style={styles.spotlight}>{spotlight.map((album, index) => <img key={album.id} src={album.coverURL} alt="" style={{ ...styles.spotlightImage, transform: `translateX(${index * -22}px) translateY(${index * -10}px)` }} />)}</div>
    </section>
    <section style={styles.section}><SectionTitle more={recent.length > 5} onMore={() => onRouteChange(genre, "all-recent")}>新入库</SectionTitle><div style={styles.albumGrid}>{recent.slice(0, 5).map((album) => <AlbumCard key={album.id} album={album} onOpen={onOpenAlbum} />)}</div></section>
    <section style={styles.section}><SectionTitle more={related.length > 5} onMore={() => onRouteChange(genre, "all-albums")}>相关专辑</SectionTitle><div style={styles.albumGrid}>{related.slice(0, 5).map((album) => <AlbumCard key={album.id} album={album} onOpen={onOpenAlbum} />)}</div></section>
    <section style={styles.section}><SectionTitle more={artists.length > 5} onMore={() => onRouteChange(genre, "all-artists")}>相关艺人</SectionTitle><div style={styles.artistGrid}>{artists.slice(0, 5).map((artist) => <ArtistCard key={artist} artist={artist} albums={albums} artistRecords={artistRecords} onOpen={onOpenArtist} />)}</div></section>
  </div>;
}

function SearchBox({ value, onChange }) {
  return <label className="metadata-search-box" style={styles.searchBox}><FaSearch /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder="搜索" style={styles.searchInput} /></label>;
}

export default function MetadataBrowser({ type, albums = [], artistRecords = {}, selected, view = "list", onRouteChange, onOpenAlbum, onOpenArtist }) {
  const [query, setQuery] = useState("");
  const field = type === "composer" ? "composer" : type === "lyricist" ? "lyricist" : "genre";
  const label = type === "composer" ? "作曲者" : type === "lyricist" ? "作词者" : type === "video" ? "视频" : "流派";
  const values = useMemo(() => unique(albums.flatMap((album) => (album.songs || []).flatMap((song) => splitValues(song[field] || album[field])))).sort((a, b) => a.localeCompare(b, "zh-CN")), [albums, field]);
  if (type === "video") return <div className="metadata-browser-page" style={styles.page}><div style={styles.header}><h1 style={styles.title}>视频</h1><SearchBox value={query} onChange={setQuery} /></div><div style={styles.videoEmpty}><FaVideo size={34} /><span>暂无已入库视频</span></div></div>;
  const filtered = values.filter((value) => value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const related = selected ? albums.filter((album) => matches(album, field, selected)) : [];
  if (type === "genre" && selected) return <GenreDetail genre={selected} albums={albums} artistRecords={artistRecords} view={view} onRouteChange={onRouteChange} onOpenAlbum={onOpenAlbum} onOpenArtist={onOpenArtist} />;
  if (selected) return <div className="metadata-browser-page" style={styles.page}><button type="button" className="detail-back-btn" style={styles.back} onClick={() => onRouteChange(null, "list")}><FaArrowLeft /></button><h1 style={styles.title}>{selected}</h1><div style={styles.albumGrid}>{related.map((album) => <AlbumCard key={album.id} album={album} onOpen={onOpenAlbum} />)}</div></div>;
  return <div className="metadata-browser-page" style={styles.page}><div style={styles.header}><h1 style={styles.title}>{label}</h1><SearchBox value={query} onChange={setQuery} /></div><div style={styles.nameList}>{filtered.map((value) => <button key={value} className="metadata-name-row" style={styles.nameRow} onClick={() => onRouteChange(value, "detail")}><span>{value}</span><span>{albums.filter((album) => matches(album, field, value)).length} 个专辑</span></button>)}{filtered.length === 0 && <p style={styles.empty}>{query ? "没有匹配结果" : `暂无可用的${label}信息`}</p>}</div></div>;
}

const styles = {
  page: { padding: "28px 32px 160px", overflowY: "auto", height: "100%", boxSizing: "border-box", fontFamily: "'Segoe UI', sans-serif" }, header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, marginBottom: 24 }, title: { margin: 0, color: "#1f2937", fontSize: 28 }, back: { width: 36, height: 36, borderRadius: "50%", border: "none", background: "#f3f4f6", color: "#374151", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", marginBottom: 18 },
  searchBox: { width: 300, maxWidth: "42%", height: 38, display: "flex", alignItems: "center", gap: 9, padding: "0 12px", color: "#9ca3af", border: "1px solid #e5e7eb", borderRadius: 10, background: "#fff", boxSizing: "border-box" }, searchInput: { minWidth: 0, flex: 1, border: "none", outline: "none", background: "transparent", color: "#1f2937", font: "inherit" }, nameList: { maxWidth: 900, display: "flex", flexDirection: "column", gap: 4 }, nameRow: { border: "none", background: "transparent", padding: "15px 14px", borderRadius: 8, color: "#1f2937", cursor: "pointer", display: "flex", justifyContent: "space-between", font: "inherit", fontSize: 15, textAlign: "left", transition: "background .15s, box-shadow .15s" }, empty: { color: "#9ca3af" },
  albumGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 18 }, albumCard: { border: "none", padding: 0, background: "transparent", textAlign: "left", cursor: "pointer", minWidth: 0, fontFamily: "inherit" }, albumCover: { display: "block", width: "100%", aspectRatio: 1, objectFit: "cover", borderRadius: 10 }, albumPlaceholder: { width: "100%", aspectRatio: 1, borderRadius: 10, background: "#e5e7eb", color: "#9ca3af", display: "flex", alignItems: "center", justifyContent: "center" }, albumName: { display: "block", marginTop: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14, fontWeight: 600, color: "#1f2937" }, albumArtist: { display: "block", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, color: "#9ca3af" },
  genreHero: { height: 230, margin: "-28px -32px 30px", padding: "26px 32px", position: "relative", overflow: "hidden", borderBottom: "1px solid #e5e7eb" }, genreTitle: { position: "absolute", left: 68, bottom: 26, margin: 0, fontSize: 44, color: "#1f2937" }, spotlight: { position: "absolute", right: 80, bottom: 14, display: "flex", alignItems: "end" }, spotlightImage: { width: 128, height: 128, objectFit: "cover", borderRadius: 10, border: "4px solid rgba(255,255,255,.7)", boxShadow: "0 10px 25px rgba(15,23,42,.16)" }, section: { marginBottom: 34 }, headingRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }, heading: { fontSize: 20, color: "#1f2937", margin: 0 }, moreLink: { border: "none", background: "transparent", color: "#6b7280", cursor: "pointer", font: "inherit", fontSize: 13 },
  artistGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 22 }, artistCard: { minWidth: 0, border: "none", padding: 0, background: "transparent", color: "#1f2937", display: "flex", flexDirection: "column", alignItems: "center", cursor: "pointer", fontFamily: "inherit" }, artistCover: { width: 112, height: 112, objectFit: "cover", borderRadius: "50%" }, artistPlaceholder: { width: 112, height: 112, borderRadius: "50%", background: "#e5e7eb", color: "#9ca3af", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }, artistName: { marginTop: 9, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14, fontWeight: 600 }, videoEmpty: { minHeight: 280, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "#9ca3af" },
};
