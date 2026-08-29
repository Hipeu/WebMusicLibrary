import { FaExclamationCircle, FaFilm, FaPlay } from "react-icons/fa";

export default function VideoLibrary({ videos, albums, onOpen }) {
  const albumCoverFor = (video) => {
    const ids = new Set(video.song_ids || []);
    const song = (albums || []).flatMap((album) => album.songs || []).find((item) => ids.has(item.file_path) || ids.has(item.hash));
    return song?.coverURL || null;
  };
  return <main className="video-library-page">
    <div className="video-library-heading"><h1>视频</h1><span>{videos.length} 个视频</span></div>
    {videos.length === 0 ? <div className="video-empty"><FaFilm size={38} /><p>暂无已入库视频</p><small>通过右上角“添加”导入本地视频或关联视频网站视频</small></div> : <div className="video-grid">
      {videos.map((video) => {
        const cover = video.cover_url || albumCoverFor(video);
        return <button key={video.id} className="video-card" onClick={() => onOpen(video.id)}>
          <span className="video-card-cover">{cover ? <img src={cover} alt="" /> : <FaFilm size={32} />}{video.source === "local" && !video.playable_in_app && <i title="当前格式无法在应用内播放"><FaExclamationCircle /></i>}<b><FaPlay size={13} /></b></span>
          <strong>{video.title || "未命名视频"}</strong><small>{video.artist || video.source_label || "视频"}</small>
        </button>;
      })}
    </div>}
  </main>;
}
