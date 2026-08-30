const SYSTEM_PLAYLIST_IDS = new Set(["liked", "recent"]);

export function normalizeSongRef(value) {
  if (value === null || value === undefined) return "";
  let text = String(value).trim().replace(/\\/g, "/");
  try { text = decodeURIComponent(text); } catch { /* 保留无法解码的旧值 */ }
  const libraryIndex = text.toLowerCase().indexOf("/library/");
  if (libraryIndex >= 0) text = text.slice(libraryIndex + "/library/".length);
  return text.replace(/^\/+/, "").replace(/\/{2,}/g, "/");
}

export function songRefCandidates(song) {
  if (!song) return [];
  return Array.from(new Set([
    normalizeSongRef(song.file_path),
    normalizeSongRef(song.url),
    String(song.hash || "").trim(),
  ].filter(Boolean)));
}

export function primarySongRef(song) {
  return normalizeSongRef(song?.file_path) || String(song?.hash || "").trim() || normalizeSongRef(song?.url);
}

export function refMatchesSong(ref, song) {
  const normalized = normalizeSongRef(ref);
  return !!normalized && songRefCandidates(song).includes(normalized);
}

export function videoMatchesSong(video, song) {
  return (video?.song_ids || []).some((ref) => refMatchesSong(ref, song));
}

export function relatedVideosForSongs(videos, songs) {
  return (videos || []).filter((video) => (songs || []).some((song) => videoMatchesSong(video, song)));
}

export function resolvePlaylistSongs(songs, librarySongs) {
  const lookup = new Map();
  for (const song of librarySongs || []) {
    for (const ref of songRefCandidates(song)) if (!lookup.has(ref)) lookup.set(ref, song);
  }
  return (songs || []).map((snapshot) => songRefCandidates(snapshot).map((ref) => lookup.get(ref)).find(Boolean) || snapshot);
}

export function relatedAlbumsForVideo(video, albums) {
  return (albums || []).filter((album) => (album.songs || []).some((song) => videoMatchesSong(video, song)));
}

export function relatedPlaylistsForVideo(video, playlists, librarySongs) {
  return (playlists || []).filter((playlist) => {
    if (SYSTEM_PLAYLIST_IDS.has(playlist.id)) return false;
    return resolvePlaylistSongs(playlist.songs, librarySongs).some((song) => videoMatchesSong(video, song));
  });
}
