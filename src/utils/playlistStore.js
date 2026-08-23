/**
 * 播放列表本地缓存 — 用于启动加速（首屏秒出），权威数据源为后端 data/playlists.json
 * 以 localStorage 持久化，key 为 music-playlists-v1
 * 歌曲以 file_path 为稳定引用做轻量归一化，避免存冗余的 blob URL / 大对象
 */
const CACHE_KEY = "music-playlists-v1";

/** 把一首歌归一化为轻量快照（无 file_path 的临时歌曲跳过，返回 null） */
export function normalizePlaylistSong(song) {
  if (!song || !song.file_path) return null;
  return {
    file_path: song.file_path,
    title: song.title || "",
    artist: song.artist || "",
    album: song.album || "",
    albumKey: song.albumKey || `${song.album_artist || song.artist || ""}|${song.album || ""}`,
    coverURL: song.coverURL || null,
    duration: song.duration || null,
    year: song.year || null,
  };
}

/** 整份播放列表归一化（保留 id/name/description/cover/pinned，歌曲过滤无 file_path 的） */
export function normalizePlaylists(playlists) {
  return (playlists || [])
    .filter((p) => p && typeof p === "object")
    .map((p) => ({
      id: p.id,
      name: p.name || "",
      description: p.description || "",
      coverURL: p.coverURL || null,
      pinned: !!p.pinned,
      coverStyle: !!p.coverStyle,
      createdAt: Number(p.createdAt) || (String(p.id || "").startsWith("pl_") ? Number(String(p.id).slice(3)) || 0 : 0),
      songs: (p.songs || []).map(normalizePlaylistSong).filter(Boolean),
    }));
}

/** 读取本地缓存（损坏/空返回 null，由调用方决定回退） */
export function loadPlaylistCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/** 写入本地缓存（已归一化，失败静默） */
export function savePlaylistCache(playlists) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(normalizePlaylists(playlists)));
  } catch {
    // localStorage 可能满 / 隐私模式禁用，静默失败不影响功能
  }
}
