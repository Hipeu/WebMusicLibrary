import { useEffect, useRef, useState } from "react";
import { FaChevronRight, FaExclamationCircle } from "react-icons/fa";
import { relatedVideosForSongs, resolvePlaylistSongs, videoMatchesSong } from "../utils/videoAssociations";

export default function RelatedVideos({ videos, songs, librarySongs, onOpen, onMore }) {
  const rowRef = useRef(null);
  const [visibleCount, setVisibleCount] = useState(4);
  const resolvedSongs = librarySongs ? resolvePlaylistSongs(songs, librarySongs) : songs;
  const related = relatedVideosForSongs(videos, resolvedSongs);
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return undefined;
    const update = () => setVisibleCount(Math.max(1, Math.min(4, Math.floor((row.clientWidth + 18) / 298))));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);
  if (!related.length) return null;
  return <section className="related-videos related-videos-cards">
    <div className="related-videos-title"><strong>关联视频</strong>{related.length > visibleCount && <button type="button" aria-label="查看全部关联视频" onClick={() => onMore?.(related.map((video) => video.id))}><FaChevronRight /></button>}</div>
    <div className="related-videos-row" ref={rowRef}>{related.slice(0, visibleCount).map((video) => {
      const fallbackSong = resolvedSongs.find((song) => videoMatchesSong(video, song));
      const cover = video.cover_url || fallbackSong?.coverURL;
      const isMissing = video.source === "local" && video.file_exists === false;
      return <button type="button" className={isMissing ? "related-video-missing" : ""} key={video.id} onClick={() => onOpen?.(video.id)}><span>{cover ? <img src={cover} alt="" /> : null}{isMissing && <i title="视频文件已经丢失"><FaExclamationCircle /></i>}</span><div className="related-video-info"><strong>{video.title || "未命名视频"}</strong><small>{video.artist || video.source_label || "视频"}</small></div></button>;
    })}</div>
  </section>;
}
