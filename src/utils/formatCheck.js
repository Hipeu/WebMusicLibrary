/**
 * 格式检查工具 — 判断歌曲编码是否为浏览器不可播放的格式（如 ALAC / APE / WavPack / WMA / DSD 等）
 */

// 浏览器基本无法播放的编码关键字（music-metadata 的 format.codec 大小写不一）
const UNPLAYABLE_PATTERNS = [
  "alac",
  "monkey",
  "wavpack",
  "windows media",
  "dsd",
  "ape",
  "wv",
  "aiff",
  "aifc",
];

/** 判断编码是否不可播放 */
export function isUnplayableCodec(codec) {
  if (!codec) return false;
  const c = String(codec).toLowerCase();
  return UNPLAYABLE_PATTERNS.some((p) => c.includes(p));
}

/** 判断歌曲对象是否可播放（取 codec/container 综合判断） */
export function songPlayable(song) {
  if (!song) return true;
  return !isUnplayableCodec(song.codec || song.container);
}
