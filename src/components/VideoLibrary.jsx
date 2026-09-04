import { useEffect, useRef, useState } from "react";
import { FaArrowLeft, FaEdit, FaEllipsisH, FaExclamationCircle, FaFilm, FaPlay, FaTrash, FaUser } from "react-icons/fa";
import { splitArtists } from "../utils/artistSplit";

export default function VideoLibrary({ videos, albums, onOpen, onEdit, onDelete, onOpenArtist, title = "视频", onBack }) {
  const [menuVideoId, setMenuVideoId] = useState(null);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menuVideoId) return undefined;
    const close = (event) => {
      if (!menuRef.current?.contains(event.target)) setMenuVideoId(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuVideoId]);
  const albumCoverFor = (video) => {
    const ids = new Set(video.song_ids || []);
    const song = (albums || []).flatMap((album) => album.songs || []).find((item) => ids.has(item.file_path) || ids.has(item.hash));
    return song?.coverURL || null;
  };
  return <main className="video-library-page">
    <div className="video-library-heading">{onBack && <button type="button" className="video-back" onClick={onBack}><FaArrowLeft /></button>}<h1>{title}</h1><span>{videos.length} 个视频</span></div>
    {videos.length === 0 ? <div className="video-empty"><FaFilm size={38} /><p>暂无已入库视频</p><small>通过右上角“添加”导入本地视频或关联视频网站视频</small></div> : <div className="video-grid">
      {videos.map((video) => {
        const cover = video.cover_url || albumCoverFor(video);
        const isMissing = video.source === "local" && video.file_exists === false;
        return <article key={video.id} className={`video-card${isMissing ? " video-card-missing" : ""}`}>
          <button type="button" className="video-card-open" onClick={() => onOpen(video.id)}><span className="video-card-cover">{cover ? <img src={cover} alt="" /> : <FaFilm size={32} />}{isMissing ? <i title="视频文件已经丢失"><FaExclamationCircle /></i> : video.source === "local" && !video.playable_in_app && <i title="当前格式无法在应用内播放"><FaExclamationCircle /></i>}<b><FaPlay size={13} /></b></span></button>
          <div className="video-card-title-row"><button type="button" className="video-card-title" onClick={() => onOpen(video.id)}><strong>{video.title || "未命名视频"}</strong></button><div className="video-card-actions" ref={menuVideoId === video.id ? menuRef : null}><button type="button" className="video-card-more" aria-label="视频操作" onClick={() => setMenuVideoId((current) => current === video.id ? null : video.id)}><FaEllipsisH /></button>{menuVideoId === video.id && <div className="video-card-menu"><button type="button" onClick={() => { setMenuVideoId(null); onEdit?.(video.id); }}><FaEdit />更多信息</button>{video.artist && <button type="button" onClick={() => { setMenuVideoId(null); onOpenArtist?.(splitArtists(video.artist)[0] || video.artist); }}><FaUser />艺人</button>}<button type="button" className="danger" onClick={() => { setMenuVideoId(null); onDelete?.(video.id); }}><FaTrash />删除</button></div>}</div></div>
          <small>{video.artist || video.source_label || "视频"}</small>
        </article>;
      })}
    </div>}
  </main>;
}
