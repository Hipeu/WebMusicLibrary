import { FaChevronRight, FaFilm } from "react-icons/fa";

export default function RelatedVideos({ videos, songIds, onOpen, onMore }) {
  const idSet = new Set(songIds || []);
  const related = (videos || []).filter((video) => (video.song_ids || []).some((id) => idSet.has(id)));
  if (!related.length) return null;
  const shown = related.slice(0, 4);
  return <section className="related-videos"><div className="related-videos-title"><strong>关联视频</strong>{related.length > shown.length && <button onClick={onMore}>查看全部 <FaChevronRight /></button>}</div><div className="related-videos-row">{shown.map((video) => <button key={video.id} onClick={() => onOpen(video.id)}><span>{video.cover_url ? <img src={video.cover_url} alt="" /> : <FaFilm />}</span><small>{video.title}</small></button>)}</div></section>;
}
