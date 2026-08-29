import { useMemo, useRef, useState } from "react";
import { FaArrowLeft, FaEdit, FaEllipsisH, FaExclamationTriangle, FaFilm, FaFolderOpen, FaPlus, FaPlay, FaSearch, FaTimes, FaTrash } from "react-icons/fa";

const songKey = (song) => song?.file_path || song?.hash;

export default function VideoDetail({ video, songs = [], playlists = [], onBack, onSave, onDelete, onOpenLocal }) {
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  if (!video) return null;
  const ids = new Set(video.song_ids || []);
  const relatedSongs = songs.filter((song) => ids.has(songKey(song)));
  const relatedAlbums = Array.from(new Map(relatedSongs.map((song) => [`${song.album_artist || song.artist}|${song.album}`, { title: song.album || "未知专辑", artist: song.album_artist || song.artist || "未知艺人", cover: song.coverURL }])).values());
  const relatedPlaylists = playlists.filter((playlist) => (playlist.songs || []).some((song) => ids.has(songKey(song))));
  const cover = video.cover_url || relatedSongs[0]?.coverURL;
  const play = () => {
    if (!video.playable_in_app) return setUnsupported(true);
    document.getElementById(`video-player-${video.id}`)?.play();
  };
  return <main className="video-detail-page video-detail-centered">
    <header className="video-detail-header"><button className="video-back" onClick={onBack}><FaArrowLeft /></button><div><h1>{video.title || "未命名视频"}</h1>{video.artist && <p>{video.artist}</p>}</div><div className="video-menu-wrap"><button className="video-more" onClick={() => setMenuOpen(!menuOpen)}><FaEllipsisH /></button>{menuOpen && <div className="video-menu"><button onClick={() => { setEditing(true); setMenuOpen(false); }}><FaEdit />编辑视频信息</button><button className="danger" onClick={() => onDelete(video.id)}><FaTrash />删除视频</button></div>}</div></header>
    {video.source === "local" && (video.playable_in_app ? <section className="video-player-stage"><video id={`video-player-${video.id}`} className="video-player" controls poster={cover || undefined} src={video.file_url} /><button className="video-stage-play" onClick={play}><FaPlay /></button></section> : <section className="video-unplayable-stage">{cover ? <img src={cover} alt="" /> : <FaFilm size={68}/>}<p>{video.extension?.toUpperCase()} 无法在应用内播放</p><button onClick={() => setUnsupported(true)}>使用系统播放器打开</button></section>)}
    {unsupported && <div className="video-warning"><FaExclamationTriangle /><span>此格式无法在应用内播放。</span><button onClick={() => onOpenLocal(video.id)}><FaFolderOpen />使用系统播放器打开</button><button onClick={() => setUnsupported(false)}>取消</button></div>}
    <RelatedCollections title="关联专辑" items={relatedAlbums} empty="暂无关联专辑" />
    <RelatedCollections title="关联播放列表" items={relatedPlaylists.map((playlist) => ({ title: playlist.name, artist: `${playlist.songs?.length || 0} 首歌曲`, cover: playlist.coverURL || playlist.songs?.[0]?.coverURL }))} empty="暂无关联播放列表" />
    {editing && <VideoEdit video={video} songs={songs} onClose={() => setEditing(false)} onSave={async (payload, coverFile) => { await onSave(video.id, payload, coverFile); setEditing(false); }} />}
  </main>;
}

function RelatedCollections({ title, items, empty }) {
  return <section className="video-related-collection"><h2>{title}</h2>{items.length ? <div className="video-collection-grid">{items.map((item, index) => <article key={`${item.title}-${index}`}><span>{item.cover ? <img src={item.cover} alt="" /> : <FaFilm />}</span><strong>{item.title}</strong><small>{item.artist}</small></article>)}</div> : <p>{empty}</p>}</section>;
}

function VideoEdit({ video, songs, onClose, onSave }) {
  const [tab, setTab] = useState("details");
  const [form, setForm] = useState(() => ({ title: video.title || "", artist: video.artist || "", producer: video.producer || "", cast: video.cast || "", website_url: video.website_url || "", song_ids: video.song_ids || [] }));
  const [coverFile, setCoverFile] = useState(null); const [pickerOpen, setPickerOpen] = useState(false); const inputRef = useRef(null);
  const selected = useMemo(() => new Set(form.song_ids), [form.song_ids]);
  const relatedSongs = songs.filter((song) => selected.has(songKey(song)));
  const removeSong = (song) => setForm((old) => ({ ...old, song_ids: old.song_ids.filter((id) => id !== songKey(song)) }));
  const addSong = (song) => setForm((old) => old.song_ids.includes(songKey(song)) ? old : ({ ...old, song_ids: [...old.song_ids, songKey(song)] }));
  const tabs = [["details", "详细信息"], ...(video.source !== "local" ? [["cover", "封面"]] : []), ["type", "类型"]];
  return <div className="video-edit-overlay"><div className="video-edit-dialog"><h2>编辑视频信息</h2><div className="video-edit-tabs capsule-tabs">{tabs.map(([id,label]) => <button className={tab === id ? "active" : ""} key={id} onClick={() => setTab(id)}>{label}</button>)}</div>
    {tab === "details" && <div className="video-form"><Field label="标题" value={form.title} set={(v) => setForm({...form,title:v})}/><Field label="艺人" value={form.artist} set={(v) => setForm({...form,artist:v})}/><Field label="制作人" value={form.producer} set={(v) => setForm({...form,producer:v})}/><Field label="参演人员" value={form.cast} set={(v) => setForm({...form,cast:v})}/>{video.source !== "local" && <Field label="视频网站地址" value={form.website_url} set={(v) => setForm({...form,website_url:v})}/>}<label>关联音乐</label><div className="video-linked-list">{relatedSongs.map((song) => <div key={songKey(song)}><img src={song.coverURL || ""} alt=""/><span><strong>{song.title}</strong><small>{song.artist}{song.year ? ` · ${song.year}年` : ""}</small></span><button onClick={() => removeSong(song)}>移除</button></div>)}</div><button className="video-associate-add" onClick={() => setPickerOpen(true)}><FaPlus /><span>关联现有音乐</span></button></div>}
    {tab === "cover" && <div className="video-cover-edit cover-editor-like"><div className="cover-preview-box">{coverFile ? <img src={URL.createObjectURL(coverFile)} alt="" /> : video.cover_url ? <img src={video.cover_url} alt="" /> : <div className="cover-add-placeholder"><FaPlus size={26}/><span>添加</span></div>}</div><button onClick={() => inputRef.current?.click()}>{video.cover_url || coverFile ? "更换封面" : "添加封面"}</button><input ref={inputRef} type="file" accept="image/*" onChange={(e) => setCoverFile(e.target.files?.[0] || null)} /></div>}
    {tab === "type" && <div className="video-type"><p>视频类型 <b>{video.extension?.replace(".", "").toUpperCase() || "在线视频"}</b></p><p>编码信息 <b>{video.codec || "未检测到"}</b></p><p>关联状态 <b>{form.song_ids.length ? "已关联" : "未关联"}</b></p><p>关联音乐 <b>{form.song_ids.length} 首</b></p><p>添加时间 <b>{video.import_time ? new Date(video.import_time).toLocaleString() : "—"}</b></p></div>}
    <footer><button onClick={onClose}>取消</button><button className="save" onClick={() => onSave(form, coverFile)}>保存</button></footer></div>{pickerOpen && <SongPicker songs={songs} selected={selected} onPick={(song) => { addSong(song); setPickerOpen(false); }} onClose={() => setPickerOpen(false)} />}</div>;
}

function SongPicker({ songs, selected, onPick, onClose }) {
  const [query, setQuery] = useState("");
  const list = [...songs].sort((a,b) => (b.importTime || 0) - (a.importTime || 0)).filter((song) => !selected.has(songKey(song))).filter((song) => [song.title, song.artist, song.album].join(" ").toLowerCase().includes(query.toLowerCase()));
  return <div className="association-picker-overlay"><section className="association-picker"><header><div><FaSearch /><input autoFocus value={query} placeholder="搜索歌曲" onChange={(e) => setQuery(e.target.value)}/></div><button onClick={onClose}><FaTimes /></button></header><main><h3>{query ? "搜索结果" : "最近导入"}</h3><div className="association-song-grid">{list.map((song) => <button key={songKey(song)} onClick={() => onPick(song)}><span>{song.coverURL ? <img src={song.coverURL} alt=""/> : <FaFilm/>}</span><strong>{song.title}</strong><small>{song.artist || "未知艺人"}</small></button>)}{!list.length && <p>没有可关联的音乐</p>}</div></main></section></div>;
}
function Field({ label, value, set }) { return <label>{label}<input value={value} onChange={(e) => set(e.target.value)} /></label>; }
