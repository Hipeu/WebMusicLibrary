/**
 * 本地音乐索引 — 用于在服务未启动时也能展示已导入的歌曲
 * 以 localStorage 持久化，key 为相对音乐库根目录的 file_path
 */
const INDEX_KEY = "music-library-index";

/** 保存一首歌到本地索引 */
export function saveSongToIndex(song) {
  if (!song || !song.file_path) return;
  const index = loadMusicIndex();
  index[song.file_path] = song;
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch (err) {
    console.warn("保存本地音乐索引失败:", err);
  }
}

/** 从本地索引移除一首歌 */
export function removeSongFromIndex(file_path) {
  if (!file_path) return;
  const index = loadMusicIndex();
  delete index[file_path];
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch (err) {
    console.warn("更新本地音乐索引失败:", err);
  }
}

/** 读取本地音乐索引（file_path -> song 元信息） */
export function loadMusicIndex() {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY)) || {};
  } catch (err) {
    return {};
  }
}
