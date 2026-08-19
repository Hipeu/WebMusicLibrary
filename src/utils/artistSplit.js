/** 艺人名称拆分与整理工具（与后端 backend/services/artist_utils.py 逻辑一致） */

const SEPARATOR_RE = /[,，/&;；]/;

/** 按 , ， / & ; ； 拆分并清理，返回去重后的艺人名列表 */
export function splitArtists(value) {
  if (!value) return [];
  const parts = String(value)
    .split(SEPARATOR_RE)
    .map((p) => p.trim())
    .filter(Boolean);
  return Array.from(new Set(parts));
}

/** 将多艺人数组 join 为 " A & B & C " 格式 */
export function joinArtists(list) {
  const names = (list || []).map((s) => String(s).trim()).filter(Boolean);
  if (names.length === 0) return "";
  return names.join(" & ");
}

/** 是否为现场类专辑（genre 包含 live，忽略大小写；中文不纳入） */
export function isLiveAlbum(album) {
  return /live/i.test(String(album?.genre || ""));
}

/** 是否为该艺人的主专辑（专辑艺人拆分后等于该艺人，且非现场类） */
export function isPrimaryAlbum(album, artist) {
  if (isLiveAlbum(album)) return false;
  return splitArtists(album?.artist).includes(artist);
}

/** 专辑是否归属该艺人：主专辑，或合作（专辑艺人拆分含该艺人，或专辑内某歌曲艺人拆分含该艺人） */
export function albumBelongsToArtist(album, artist) {
  if (splitArtists(album?.artist).includes(artist)) return true;
  return (album?.songs || []).some((s) => splitArtists(s.artist).includes(artist));
}

/** 收集全量艺人：拆分所有专辑艺人/歌曲艺人 + artistRecords 键，去重后 A-Z 排序 */
export function collectAllArtists(albums, artistRecords) {
  const set = new Set();
  (albums || []).forEach((a) => {
    splitArtists(a.artist).forEach((n) => set.add(n));
    (a.songs || []).forEach((s) => splitArtists(s.artist).forEach((n) => set.add(n)));
  });
  Object.keys(artistRecords || {}).forEach((n) => set.add(n));
  return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-CN"));
}