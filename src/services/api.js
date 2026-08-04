const BASE_URL = "http://127.0.0.1:8000";

/** 将后端相对资源路径（如 /library/...）转为完整可访问 URL */
export function getAssetUrl(path) {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `${BASE_URL}${path}`;
}

/** 上传音乐文件到后端音乐库 */
export async function uploadMusic(file) {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${BASE_URL}/api/music/upload`, {
    method: "POST",
    body: form,
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

export default {
  uploadMusic,
  getMusicList,
  deleteMusic,
  testConnection,
  checkMusicFiles,
  updateMusicMetadata,
  getLyrics,
  getAssetUrl,
};
