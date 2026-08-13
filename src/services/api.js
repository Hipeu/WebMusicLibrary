const BASE_URL = "http://127.0.0.1:8000";

/** 将后端相对资源路径（如 /library/...）转为完整可访问 URL */
export function getAssetUrl(path) {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `${BASE_URL}${path}`;
}

/** 上传音乐文件到后端音乐库（signal 用于取消导入） */
export async function uploadMusic(file, signal) {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${BASE_URL}/api/music/upload`, {
    method: "POST",
    body: form,
    signal,
  });

  return res.json();
}

/** 获取音乐库中所有已持久化的音乐列表 */
export async function getMusicList() {
  const res = await fetch(`${BASE_URL}/api/music/list`);
  return res.json();
}

/** 删除音乐库中的歌曲 */
export async function deleteMusic(artist, album, title) {
  const params = new URLSearchParams({ artist, album, title });
  const res = await fetch(`${BASE_URL}/api/music/delete?${params}`, {
    method: "DELETE",
  });
  return res.json();
}

/** 测试后端连接 */
export async function testConnection() {
  const res = await fetch(`${BASE_URL}/api/hello`);
  return res.json();
}

/** 批量检查音乐文件是否存在（paths 为相对音乐库根目录的路径数组） */
export async function checkMusicFiles(paths) {
  const res = await fetch(`${BASE_URL}/api/music/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
  });
  return res.json();
}

/** 用系统默认程序（本地播放器）打开资料库中的音乐文件 */
export async function openMusicFile(filePath) {
  const res = await fetch(`${BASE_URL}/api/music/open`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_path: filePath }),
  });
  return res.json();
}

/** 编辑歌曲元信息（写入音乐文件内部标签 + data 备份 + manifest）
 *  payload: { file_path, title?, artist?, album?, genre?, year?, trackNo?,
 *             composer?, lyricist?, publisher?, comment?, lyrics?, cover?(File) }
 *  注意：trackNo 传空字符串表示清除音轨号
 */
export async function updateMusicMetadata(payload) {
  const form = new FormData();
  for (const [k, v] of Object.entries(payload)) {
    if (v === undefined || v === null) continue;
    form.append(k, v);
  }
  const res = await fetch(`${BASE_URL}/api/music/edit`, {
    method: "POST",
    body: form,
  });
  return res.json();
}

/** 获取歌曲歌词（优先 data/Lyrics 备份，否则解析文件内嵌歌词） */
export async function getLyrics(filePath) {
  const params = new URLSearchParams({ file_path: filePath });
  const res = await fetch(`${BASE_URL}/api/music/lyrics?${params}`);
  return res.json();
}

/** 获取播放列表（后端 data/playlists.json，跨浏览器一致） */
export async function getPlaylists() {
  const res = await fetch(`${BASE_URL}/api/playlists`);
  return res.json();
}

/** 整体覆盖保存播放列表到后端 */
export async function savePlaylists(list) {
  const res = await fetch(`${BASE_URL}/api/playlists`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(list),
  });
  return res.json();
}

/** 重置整个资料库（清空音乐库 + data 备份，后台线程执行） */
export async function resetAll() {
  const res = await fetch(`${BASE_URL}/api/reset`, {
    method: "DELETE",
  });
  return res.json();
}

/** 获取资料库重置进度 */
export async function getResetProgress() {
  const res = await fetch(`${BASE_URL}/api/reset/progress`);
  return res.json();
}

/** 获取设置（资料库路径等） */
export async function getSettings() {
  const res = await fetch(`${BASE_URL}/api/settings`);
  return res.json();
}

/** 保存设置（更新资料库路径） */
export async function saveSettings(libraryPath) {
  const res = await fetch(`${BASE_URL}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ library_path: libraryPath }),
  });
  return res.json();
}

/** 获取资料库迁移进度 */
export async function getMigrationStatus() {
  const res = await fetch(`${BASE_URL}/api/settings/migration`);
  return res.json();
}

/** 获取艺人数据（data/artists.json） */
export async function getArtists() {
  const res = await fetch(`${BASE_URL}/api/artists`);
  return res.json();
}

/** 保存单个艺人记录 { name, bio?, genres?, cover_url? } */
export async function saveArtist(payload) {
  const res = await fetch(`${BASE_URL}/api/artists`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

/** 删除艺人记录及其封面 */
export async function deleteArtist(name) {
  const res = await fetch(`${BASE_URL}/api/artists/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  return res.json();
}

/** 上传艺人封面，返回 { status, cover_url } */
export async function uploadArtistCover(name, file) {
  const form = new FormData();
  form.append("name", name);
  form.append("file", file);
  const res = await fetch(`${BASE_URL}/api/artists/cover`, {
    method: "POST",
    body: form,
  });
  return res.json();
}

/** 匹配单曲元数据（QQ音乐→iTunes→MusicBrainz：作曲/作词/编曲/制作人/专辑/封面） */
export async function matchSong({ song_name, artist_name }) {
  const res = await fetch(`${BASE_URL}/api/match/song`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ song_name, artist_name }),
  });
  return res.json();
}

/** 启动全部匹配（后台线程执行） */
export async function matchAll(config) {
  const res = await fetch(`${BASE_URL}/api/match/all`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config || {}),
  });
  return res.json();
}

/** 获取全部匹配进度 */
export async function getMatchAllProgress() {
  const res = await fetch(`${BASE_URL}/api/match/all/progress`);
  return res.json();
}

/** 取消进行中的全部匹配 */
export async function cancelMatchAll() {
  const res = await fetch(`${BASE_URL}/api/match/all/cancel`, {
    method: "POST",
  });
  return res.json();
}

export default {
  uploadMusic,
  getMusicList,
  deleteMusic,
  testConnection,
  checkMusicFiles,
  openMusicFile,
  updateMusicMetadata,
  getLyrics,
  getPlaylists,
  savePlaylists,
  resetAll,
  getResetProgress,
  getSettings,
  saveSettings,
  getMigrationStatus,
  getArtists,
  saveArtist,
  deleteArtist,
  uploadArtistCover,
  matchSong,
  matchAll,
  getMatchAllProgress,
  cancelMatchAll,
  getAssetUrl,
};
