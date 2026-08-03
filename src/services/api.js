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

export default {
  uploadMusic,
  getMusicList,
  deleteMusic,
  testConnection,
  getAssetUrl,
};
