import { useEffect, useMemo, useRef, useState } from "react";
import { FaArrowLeft, FaEdit, FaEllipsisH, FaFilm, FaPlus, FaPlay, FaSearch, FaTimes, FaTrash, FaUser } from "react-icons/fa";
import { SiBilibili, SiYoutube } from "react-icons/si";
import useCoverColor from "./CoverColor";
import AlbumArtistPicker from "./AlbumArtistPicker";
import { getAssetUrl } from "../services/api";
import { joinArtists, splitArtists } from "../utils/artistSplit";
import { primarySongRef, refMatchesSong, relatedAlbumsForVideo, relatedPlaylistsForVideo, videoMatchesSong } from "../utils/videoAssociations";

const songKey = primarySongRef;

export default function VideoDetail({ video, songs = [], albums = [], playlists = [], artistRecords = {}, initialEditing = false, onBack, onSave, onDelete, onOpenLocal, onOpenAlbum, onOpenPlaylist, onOpenArtist }) {
  const [editing, setEditing] = useState(initialEditing);
  const [menuOpen, setMenuOpen] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [view, setView] = useState("detail");
  const [showArtistPicker, setShowArtistPicker] = useState(false);
  if (!video) return null;
  const relatedSongs = songs.filter((song) => videoMatchesSong(video, song));
  const relatedAlbums = relatedAlbumsForVideo(video, albums).map((album) => ({ id: album.id, title: album.title || "未知专辑", artist: album.artist || "未知艺人", cover: album.coverURL }));
  const relatedPlaylists = relatedPlaylistsForVideo(video, playlists, songs);
  const cover = video.cover_url || relatedSongs[0]?.coverURL;
  const isMissing = video.source === "local" && video.file_exists === false;
  const sourceName = video.source === "youtube" ? "YouTube" : "哔哩哔哩";
  const SourceIcon = video.source === "youtube" ? SiYoutube : SiBilibili;
  const artistItems = splitArtists(video.artist).map((name) => ({
    name,
    avatar: artistRecords?.[name]?.cover_url ? getAssetUrl(artistRecords[name].cover_url) : null,
  }));
  const play = () => {
    if (video.source !== "local") {
      if (video.website_url) window.open(video.website_url, "_blank", "noopener,noreferrer");
      return;
    }
    if (isMissing) return;
    if (!video.playable_in_app) return setUnsupported(true);
    document.getElementById(`video-player-${video.id}`)?.play();
  };

  if (view === "all-related") {
    return <main className="video-detail-page video-related-all-page">
      <button className="video-back" onClick={() => setView("detail")}><FaArrowLeft /></button>
      <h1>关联内容</h1>
      <RelatedCollections title="关联专辑" items={relatedAlbums} empty="暂无关联专辑" onOpen={onOpenAlbum} />
      {relatedPlaylists.length > 0 && <RelatedCollections title="关联播放列表" items={relatedPlaylists.map(relatedPlaylistItem)} empty="暂无关联播放列表" onOpen={onOpenPlaylist} />}
    </main>;
  }
  return <main className={`video-detail-page video-detail-centered ${video.source === "local" ? "video-detail-local" : "video-detail-online"}`}>
    {video.source === "local" ? <header className="video-detail-header"><button className="video-back" onClick={onBack}><FaArrowLeft /></button><div><h1>{video.title || "未命名视频"}</h1><VideoArtists artists={artistItems} onOpenArtist={onOpenArtist} onOpenPicker={() => setShowArtistPicker(true)} /></div><VideoMenu open={menuOpen} setOpen={setMenuOpen} artist={video.artist} onOpenArtist={onOpenArtist} onEdit={() => setEditing(true)} onDelete={() => onDelete(video.id)} /></header> : <>
      <button className="video-back" onClick={onBack}><FaArrowLeft /></button>
      <section className="video-detail-top video-online-top"><div className="video-detail-cover">{cover ? <img src={cover} alt="" /> : <FaFilm size={55} />}</div><div className="video-detail-info"><h1>{video.title || "未命名视频"}</h1><VideoArtists artists={artistItems} onOpenArtist={onOpenArtist} onOpenPicker={() => setShowArtistPicker(true)} /><p className="video-detail-source video-source-attribution"><SourceIcon /><span>来自{sourceName}</span></p><div className="video-detail-actions"><button className="video-play" onClick={play}><FaPlay />跳转至{sourceName}播放</button><VideoMenu open={menuOpen} setOpen={setMenuOpen} artist={video.artist} onOpenArtist={onOpenArtist} onEdit={() => setEditing(true)} onDelete={() => onDelete(video.id)} /></div></div></section>
    </>}
    {video.source === "local" && (isMissing ? <VideoUnavailableStage cover={cover} message="无法播放此项目，该项目已经被移动或删除" /> : video.playable_in_app ? <section className="video-player-stage"><video id={`video-player-${video.id}`} className="video-player" controls poster={cover || undefined} src={video.file_url} /><button className="video-stage-play" onClick={play}><FaPlay /></button></section> : <VideoUnavailableStage cover={cover} onClick={() => setUnsupported(true)} />)}
    {unsupported && <div className="video-format-overlay" onClick={() => setUnsupported(false)}><section className="video-format-dialog" onClick={(event) => event.stopPropagation()}><h2>此格式不受支持</h2><div /><p>无法打开该视频，但可以通过本地播放器打开</p><footer><button type="button" className="open" onClick={() => { onOpenLocal(video.id); setUnsupported(false); }}>打开</button><button type="button" onClick={() => setUnsupported(false)}>取消</button></footer></section></div>}
    <RelatedSummary albums={relatedAlbums} playlists={relatedPlaylists} onMore={() => setView("all-related")} onOpenAlbum={onOpenAlbum} onOpenPlaylist={onOpenPlaylist} />
    {editing && <VideoEdit video={video} songs={songs} onClose={() => setEditing(false)} onSave={async (payload, coverFile) => { await onSave(video.id, payload, coverFile); setEditing(false); }} />}
    {showArtistPicker && <AlbumArtistPicker artists={artistItems} onClose={() => setShowArtistPicker(false)} onPick={(name) => { setShowArtistPicker(false); onOpenArtist?.(name); }} />}
  </main>;
}

function VideoUnavailableStage({ cover, message, onClick }) {
  const content = <><span className="video-alert-icon">!</span>{message && <p>{message}</p>}</>;
  return <section className={`video-unavailable-stage${message ? " video-missing-stage" : ""}`}>{cover && <img src={cover} alt="" />}<div className="video-unavailable-shade" />{onClick ? <button type="button" className="video-unavailable-action" aria-label="查看无法播放原因" onClick={onClick}>{content}</button> : <div className="video-unavailable-message">{content}</div>}</section>;
}

function VideoArtists({ artists, onOpenArtist, onOpenPicker }) {
  if (!artists.length) return null;
  const isMultiArtist = artists.length > 1;
  const displayName = artists.length > 4 ? `${joinArtists(artists.slice(0, 4).map((item) => item.name))} 等` : joinArtists(artists.map((item) => item.name));
  return <div className="video-detail-artists"><span className={isMultiArtist ? "video-artist-stack" : "video-artist-stack single"}>{artists.slice(0, 4).map((artist, index) => <span className="video-artist-avatar" style={{ marginLeft: index === 0 ? 0 : -10 }} key={artist.name}>{artist.avatar ? <img src={artist.avatar} alt="" /> : <FaUser />}</span>)}</span><button type="button" className="video-artist-link" onClick={() => isMultiArtist ? onOpenPicker?.() : onOpenArtist?.(artists[0].name)}>{displayName}</button></div>;
}

function VideoMenu({ open, setOpen, artist, onOpenArtist, onEdit, onDelete }) {
  const menuRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!menuRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open, setOpen]);
  return <div className="video-menu-wrap" ref={menuRef}><button className="video-more" onClick={() => setOpen(!open)}><FaEllipsisH /></button>{open && <div className="video-menu"><button onClick={() => { onEdit(); setOpen(false); }}><FaEdit />编辑视频信息</button>{artist && <button onClick={() => { onOpenArtist?.(splitArtists(artist)[0] || artist); setOpen(false); }}><FaUser />艺人</button>}<button className="danger" onClick={() => { onDelete(); setOpen(false); }}><FaTrash />删除视频</button></div>}</div>;
}

function relatedPlaylistItem(playlist) {
  return { id: playlist.id, title: playlist.name, artist: `${playlist.songs?.length || 0} 首歌曲`, cover: playlist.coverURL || playlist.songs?.[0]?.coverURL, coverStyle: playlist.id === "liked" || playlist.id === "recent" || !!playlist.coverStyle };
}

function RelatedCover({ item }) {
  const palette = useCoverColor(item.coverStyle && item.cover ? item.cover : null);
  const swatch = palette?.Vibrant || palette?.Muted || palette?.DarkVibrant || palette?.LightVibrant;
  return <span className={item.coverStyle && item.cover ? "video-related-cover styled" : "video-related-cover"}>{item.cover ? <img src={item.cover} alt="" /> : <FaFilm />}{item.coverStyle && item.cover && swatch && <i style={{ background: swatch.hex }} />}{item.coverStyle && item.cover && <b>{item.title}</b>}</span>;
}

function RelatedSummary({ albums, playlists, onMore, onOpenAlbum, onOpenPlaylist }) {
  const items = [...albums.map((item) => ({ ...item, kind: "专辑", onOpen: onOpenAlbum })), ...playlists.map((playlist) => ({ ...relatedPlaylistItem(playlist), kind: "播放列表", onOpen: onOpenPlaylist }))].slice(0, 5);
  return <section className="video-related-summary"><button className="video-related-heading" onClick={onMore}><span>关联内容</span><b>›</b></button>{items.length ? <div className="video-collection-grid">{items.map((item, index) => <button type="button" className="video-related-card" key={`${item.kind}-${item.id || item.title}-${index}`} onClick={() => item.onOpen?.(item.id)}><RelatedCover item={item} /><strong>{item.title}</strong><small>{item.artist}</small><em>{item.kind}</em></button>)}</div> : <p>暂无关联内容</p>}</section>;
}

function RelatedCollections({ title, items, empty, onOpen }) {
  return <section className="video-related-collection"><h2>{title}</h2>{items.length ? <div className="video-collection-grid">{items.map((item, index) => <button type="button" className="video-related-card" key={`${item.id || item.title}-${index}`} onClick={() => onOpen?.(item.id)}><RelatedCover item={item} /><strong>{item.title}</strong><small>{item.artist}</small></button>)}</div> : <p>{empty}</p>}</section>;
}

function VideoEdit({ video, songs, onClose, onSave }) {
  const [tab, setTab] = useState("details");
  const [form, setForm] = useState(() => ({ title: video.title || "", artist: video.artist || "", producer: video.producer || "", cast: video.cast || "", website_url: video.website_url || "", song_ids: video.song_ids || [] }));
  const [coverFile, setCoverFile] = useState(null); const [pickerOpen, setPickerOpen] = useState(false); const inputRef = useRef(null);
  const didAutoFillRef = useRef((video.song_ids || []).length > 0);
  const selected = useMemo(() => new Set(form.song_ids), [form.song_ids]);
  const relatedSongs = songs.filter((song) => form.song_ids.some((ref) => refMatchesSong(ref, song)));
  const removeSong = (song) => setForm((old) => ({ ...old, song_ids: old.song_ids.filter((ref) => !refMatchesSong(ref, song)) }));
  const addSong = (song) => setForm((old) => {
    if (old.song_ids.some((ref) => refMatchesSong(ref, song))) return old;
    const next = { ...old, song_ids: [...old.song_ids, songKey(song)] };
    if (!didAutoFillRef.current) {
      if (song.title) next.title = song.title;
      if (song.artist) next.artist = song.artist;
      didAutoFillRef.current = true;
    }
    return next;
  });
  const tabs = [["details", "详细信息"], ...(video.source !== "local" ? [["cover", "封面"]] : []), ["type", "类型"]];
  return <div className="video-edit-overlay"><div className="video-edit-dialog"><h2>编辑视频信息</h2><div className="video-edit-tabs capsule-tabs">{tabs.map(([id,label]) => <button className={tab === id ? "active" : ""} key={id} onClick={() => setTab(id)}>{label}</button>)}</div>
    {tab === "details" && <div className="video-form"><Field label="标题" value={form.title} set={(v) => setForm({...form,title:v})}/><Field label="艺人" value={form.artist} set={(v) => setForm({...form,artist:v})}/><Field label="制作人" value={form.producer} set={(v) => setForm({...form,producer:v})}/><Field label="参演人员" value={form.cast} set={(v) => setForm({...form,cast:v})}/>{video.source !== "local" && <Field label="视频网站地址" value={form.website_url} set={(v) => setForm({...form,website_url:v})}/>}<label>关联音乐</label><div className="video-linked-list">{relatedSongs.map((song) => <div key={songKey(song)}><img src={song.coverURL || ""} alt=""/><span><strong>{song.title}</strong><small>{song.artist}{song.year ? ` · ${song.year}年` : ""}</small></span><button onClick={() => removeSong(song)}>移除</button></div>)}</div><button className="video-associate-add" onClick={() => setPickerOpen(true)}><FaPlus /><span>关联现有音乐</span></button></div>}
    {tab === "cover" && <div className="video-cover-edit cover-editor-like"><div className="cover-preview-box">{coverFile ? <img src={URL.createObjectURL(coverFile)} alt="" /> : video.cover_url ? <img src={video.cover_url} alt="" /> : <div className="cover-add-placeholder"><FaPlus size={26}/><span>添加</span></div>}</div><button onClick={() => inputRef.current?.click()}>{video.cover_url || coverFile ? "更换封面" : "添加封面"}</button><input ref={inputRef} type="file" accept="image/*" onChange={(e) => setCoverFile(e.target.files?.[0] || null)} /></div>}
    {tab === "type" && <div className="video-type"><p>视频类型 <b>{video.extension?.replace(".", "").toUpperCase() || "在线视频"}</b></p><p>编码信息 <b>{video.codec || "未检测到"}</b></p><p>关联状态 <b>{form.song_ids.length ? "已关联" : "未关联"}</b></p><p>关联音乐 <b>{form.song_ids.length} 首</b></p><p>添加时间 <b>{video.import_time ? new Date(video.import_time).toLocaleString() : "—"}</b></p></div>}
    <footer><button onClick={onClose}>取消</button><button className="save" onClick={() => onSave(form, coverFile).catch(() => {})}>保存</button></footer></div>{pickerOpen && <SongPicker songs={songs} selected={selected} onPick={(song) => { addSong(song); setPickerOpen(false); }} onClose={() => setPickerOpen(false)} />}</div>;
}

function SongPicker({ songs, selected, onPick, onClose }) {
  const [query, setQuery] = useState("");
  const list = [...songs].sort((a,b) => (b.importTime || 0) - (a.importTime || 0)).filter((song) => !Array.from(selected).some((ref) => refMatchesSong(ref, song))).filter((song) => [song.title, song.artist, song.album].join(" ").toLowerCase().includes(query.toLowerCase()));
  const durationText = (seconds) => {
    if (!seconds || Number.isNaN(Number(seconds))) return "--:--";
    const value = Number(seconds);
    return `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, "0")}`;
  };
  return <div className="association-picker-overlay"><section className="association-picker"><header><div><FaSearch /><input autoFocus value={query} placeholder="搜索歌曲" onChange={(e) => setQuery(e.target.value)}/></div><button onClick={onClose}><FaTimes /></button></header><main><h3>{query ? "搜索结果" : "最近导入"}</h3>{list.length ? <div className="association-song-list"><div className="association-song-list-head"><span>封面</span><span>音乐名</span><span>艺人</span><span>专辑名</span><span>时间</span></div>{list.map((song) => <button key={songKey(song)} onClick={() => onPick(song)}><span className="association-song-cover">{song.coverURL ? <img src={song.coverURL} alt=""/> : <FaFilm/>}</span><strong>{song.title || "未知歌曲"}</strong><span>{song.artist || "未知艺人"}</span><span>{song.album || "未知专辑"}</span><time>{durationText(song.duration)}</time></button>)}</div> : <p>没有可关联的音乐</p>}</main></section></div>;
}
function Field({ label, value, set }) { return <label>{label}<input value={value} onChange={(e) => set(e.target.value)} /></label>; }
