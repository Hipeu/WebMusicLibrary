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
  form.append("auto_organize", localStorage.getItem("edit-auto-organize-collab") !== "false" ? "1" : "0");

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

/** 删除音乐库中的歌曲（toTrash=true 时移入项目 trash 文件夹） */
export async function deleteMusic(artist, album, title, toTrash) {
  const params = new URLSearchParams({ artist, album, title });
  if (toTrash) params.append("to_trash", "1");
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

/** 保存专辑级简介（与歌曲文件是否存在无关） */
export async function updateAlbumDescription({ artist, album, description }) {
  const res = await fetch(`${BASE_URL}/api/music/album-description`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ artist, album, description }),
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

/** 启动资料库 ZIP 导出任务。 */
export async function startDataExport(types) {
  const res = await fetch(`${BASE_URL}/api/data/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ types }),
  });
  return res.json();
}

/** 获取导入/导出任务进度。 */
export async function getDataJob(jobId) {
  const res = await fetch(`${BASE_URL}/api/data/jobs/${encodeURIComponent(jobId)}`);
  return res.json();
}

/** 上传 ZIP 备份并启动导入任务。 */
export async function inspectDataImport(file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE_URL}/api/data/import/inspect`, { method: "POST", body: form });
  return res.json();
}

/** 以预检令牌启动选择性导入任务。 */
export async function startDataImport(token, mode, keepBackup, types) {
  const form = new FormData();
  form.append("token", token);
  form.append("mode", mode);
  form.append("keep_backup", keepBackup ? "true" : "false");
  form.append("types", JSON.stringify(types));
  const res = await fetch(`${BASE_URL}/api/data/import`, { method: "POST", body: form });
  return res.json();
}

export async function cancelDataJob(jobId) {
  const res = await fetch(`${BASE_URL}/api/data/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
  return res.json();
}

export function getDataExportDownloadUrl(jobId) {
  return `${BASE_URL}/api/data/export/${encodeURIComponent(jobId)}/download`;
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

/** 保存跨浏览器同步的应用设置（主题等浏览器偏好除外） */
export async function saveAppSettings(settings) {
  const res = await fetch(`${BASE_URL}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_settings: settings }),
  });
  return res.json();
}

// 智能功能（供应商密钥仅保存在后端，本接口不会返回密钥）
export async function getSmartProviders() {
  const res = await fetch(`${BASE_URL}/api/smart/providers`);
  return res.json();
}
export async function testSmartProvider(payload) {
  const res = await fetch(`${BASE_URL}/api/smart/providers/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  return res.json();
}
export async function saveSmartProvider(kind, payload) {
  const res = await fetch(`${BASE_URL}/api/smart/providers/${kind}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  return res.json();
}
export async function toggleSmartProvider(kind, enabled) {
  const res = await fetch(`${BASE_URL}/api/smart/providers/${kind}/toggle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
  return res.json();
}
export async function deleteSmartProvider(kind) {
  const res = await fetch(`${BASE_URL}/api/smart/providers/${kind}`, { method: "DELETE" });
  return res.json();
}
export async function startSmartJob(kind, payload) {
  const res = await fetch(`${BASE_URL}/api/smart/jobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, payload }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "智能任务启动失败");
  return data;
}
export async function getSmartJob(jobId) {
  const res = await fetch(`${BASE_URL}/api/smart/jobs/${jobId}`);
  return res.json();
}
export async function cancelSmartJob(jobId) {
  const res = await fetch(`${BASE_URL}/api/smart/jobs/${jobId}/cancel`, { method: "POST" });
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

/** 匹配单曲元数据（QQ音乐→iTunes→MusicBrainz），可携带 sources/fields/lyric_credits_fallback 配置；
 *  file_path 用于后端读取本地歌词做 credits 兜底 */
export async function matchSong({ song_name, artist_name, sources, fields, lyric_credits_fallback, file_path }) {
  const res = await fetch(`${BASE_URL}/api/match/song`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ song_name, artist_name, sources, fields, lyric_credits_fallback, file_path, match_rate: "fast" }),
  });
  return res.json();
}

/** 单曲匹配多候选（分页），返回 { status, total, results:[{source, source_label, song_name, artist, album, album_artist, year, genre, trackNo, discNo, cover_url, composers, lyricists, arranger, producer, publisher}] } */
export async function matchSongCandidates({ song_name, artist_name, file_path, sources, fields, lyric_credits_fallback, offset, limit }) {
  const res = await fetch(`${BASE_URL}/api/match/song/candidates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ song_name, artist_name, file_path, sources, fields, lyric_credits_fallback, offset, limit, match_rate: "fast" }),
  });
  return res.json();
}

/** 通过后端同源代理下载封面（规避 CDN 跨域），返回 Blob 或 null */
export async function fetchCoverProxy(coverUrl) {
  if (!coverUrl) return null;
  try {
    const res = await fetch(`${BASE_URL}/api/match/cover?url=${encodeURIComponent(coverUrl)}`);
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

/** 专辑匹配多候选（分页），返回 { status, total, results:[{source, source_label, album, album_artist, year, genre, cover_url}] } */
export async function matchAlbumCandidates({ album_name, artist_name, sources, offset, limit }) {
  const res = await fetch(`${BASE_URL}/api/match/album/candidates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ album_name, artist_name, sources, offset, limit, match_rate: "fast" }),
  });
  return res.json();
}

/** 获取已选单曲候选的详情 */
export async function matchSongCandidateDetails({ candidate, fields, lyric_credits_fallback }) {
  const res = await fetch(`${BASE_URL}/api/match/song/candidate/details`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidate, fields, lyric_credits_fallback }),
  });
  return res.json();
}

/** 在线歌词多源匹配（分页），返回 { status, total, results:[{source, source_label, song_name, artist, album, lyric}] } */
export async function matchLyric({ song_name, artist_name, sources, offset, limit }) {
  const res = await fetch(`${BASE_URL}/api/match/lyric`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ song_name, artist_name, sources, offset, limit, match_rate: "fast" }),
  });
  return res.json();
}

/** 启动全部匹配（后台线程执行） */
export async function matchAll(config) {
  const res = await fetch(`${BASE_URL}/api/match/all`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(config || {}), match_rate: localStorage.getItem("match-rate") || "normal" }),
  });
  return res.json();
}

/** 获取艺人简介与写真 */
export async function matchArtist(artistName) {
  const res = await fetch(`${BASE_URL}/api/match/artist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ artist_name: artistName, match_rate: localStorage.getItem("match-rate") || "normal" }),
  });
  return res.json();
}

/** 搜索艺人候选 */
export async function matchArtistCandidates({ artist_name, sources, limit = 10 }) {
  const res = await fetch(`${BASE_URL}/api/match/artist/candidates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ artist_name, sources, limit }),
  });
  return res.json();
}

/** 获取选中艺人候选详情 */
export async function matchArtistCandidateDetails(candidate) {
  const res = await fetch(`${BASE_URL}/api/match/artist/candidate/details`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidate }),
  });
  return res.json();
}

/** 按来源和 ID 获取艺人/专辑简介 */
export async function fetchDescription({ source = "netease", kind = "album", id }) {
  const res = await fetch(`${BASE_URL}/api/match/description`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, kind, id, match_rate: "fast" }),
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
  updateAlbumDescription,
  getLyrics,
  getPlaylists,
  savePlaylists,
  resetAll,
  getResetProgress,
  startDataExport,
  getDataJob,
  startDataImport,
  inspectDataImport,
  cancelDataJob,
  getDataExportDownloadUrl,
  getSettings,
  saveSettings,
  saveAppSettings,
  getSmartProviders,
  testSmartProvider,
  saveSmartProvider,
  toggleSmartProvider,
  deleteSmartProvider,
  startSmartJob,
  getSmartJob,
  cancelSmartJob,
  getMigrationStatus,
  getArtists,
  saveArtist,
  deleteArtist,
  uploadArtistCover,
  matchSong,
  matchSongCandidateDetails,
  matchLyric,
  matchAll,
  getMatchAllProgress,
  cancelMatchAll,
  matchArtist,
  matchArtistCandidates,
  matchArtistCandidateDetails,
  fetchDescription,
  getAssetUrl,
};
