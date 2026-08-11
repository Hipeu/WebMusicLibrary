/**
 * 播放次数统计 — localStorage 持久化（{ 歌曲key: 次数 }）
 * 用于艺人详情页「歌曲」区按播放次数排序
 */

const KEY = "music-play-counts";

/** 歌曲唯一键：优先 url，其次 file_path，最后 title|artist|album */
export function songPlayKey(song) {
  return (
    song?.url ||
    song?.file_path ||
    (song ? `${song.artist}|${song.album}|${song.title}` : "")
  );
}

/** 读取全部播放次数 */
export function loadPlayCounts() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

function savePlayCounts(counts) {
  try {
    localStorage.setItem(KEY, JSON.stringify(counts));
  } catch {
    // 忽略存储失败
  }
}

/** 播放一次 → 计数 +1 */
export function incrementPlayCount(song) {
  const k = songPlayKey(song);
  if (!k) return;
  const counts = loadPlayCounts();
  counts[k] = (counts[k] || 0) + 1;
  savePlayCounts(counts);
}

/** 清空播放计数 */
export function clearPlayCounts() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 忽略
  }
}
