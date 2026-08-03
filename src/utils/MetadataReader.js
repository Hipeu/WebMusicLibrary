import { parseBlob } from "music-metadata";

/**
 * 读取音频文件的元数据
 * @param {File} file - 音频文件对象
 * @returns {Promise<{title, artist, album, year, coverURL, genre, duration, trackNo, composer, lyricist, publisher, lyrics, comment, bitrate, codec, container, creationTime, modificationTime, importTime}>}
 */
export async function readMetadata(file) {
  try {
  const metadata = await parseBlob(file);

    const title = metadata.common.title || file.name.replace(/\.[^/.]+$/, "");
    const artist = metadata.common.artist || "未知艺术家";
    const album = metadata.common.album || "未知专辑";

    let year = null;
    if (metadata.common.year) {
      year = metadata.common.year;
    } else if (metadata.common.date) {
      const match = String(metadata.common.date).match(/(\d{4})/);
      if (match) year = parseInt(match[1]);
    } else if (metadata.format?.creationTime) {
      const d = new Date(metadata.format.creationTime);
      if (!isNaN(d.getTime())) year = d.getFullYear();
    }

    let genre = null;
    if (metadata.common.genre) {
      const raw = metadata.common.genre;
      genre = Array.isArray(raw) ? raw.join(" / ") : String(raw);
    }

    let coverURL = null;
    const picture = metadata.common.picture?.[0];
  if (picture) {
    const blob = new Blob([picture.data], { type: picture.format });
      coverURL = URL.createObjectURL(blob);
  }

    const duration = metadata.format?.duration || null;
    const trackNo = metadata.common.track?.no || null;

    let composer = null;
    if (metadata.common.composer) {
      const raw = metadata.common.composer;
      composer = Array.isArray(raw) ? raw.join(" / ") : String(raw);
    }

    let lyricist = null;
    if (metadata.common.lyricist) {
      const raw = metadata.common.lyricist;
      lyricist = Array.isArray(raw) ? raw.join(" / ") : String(raw);
    }

    const publisher = metadata.common.publisher || metadata.common.label || null;

    let lyrics = null;
    if (metadata.common.lyrics) {
      const raw = metadata.common.lyrics;
      lyrics = Array.isArray(raw) ? raw.map(l => l.text || l).join("\n\n") : String(raw);
    }

    let comment = null;
    if (metadata.common.comment) {
      const raw = metadata.common.comment;
      comment = Array.isArray(raw) ? raw.join(" / ") : String(raw);
    }

    // 格式信息
    const bitrate = metadata.format?.bitrate || null;
    const codec = metadata.format?.codec || metadata.format?.container || null;
    const container = metadata.format?.container || null;
    const creationTime = metadata.format?.creationTime || null;
    const modificationTime = metadata.format?.modificationTime || null;
    const importTime = Date.now();

    return { title, artist, album, year, coverURL, genre, duration, trackNo, composer, lyricist, publisher, lyrics, comment, bitrate, codec, container, creationTime, modificationTime, importTime };
  } catch (err) {
    console.warn("读取元数据失败:", err);
    return {
      title: file.name.replace(/\.[^/.]+$/, ""),
      artist: "未知艺术家",
      album: "未知专辑",
      year: null,
      coverURL: null,
      genre: null,
      duration: null,
      trackNo: null,
      composer: null,
      lyricist: null,
      publisher: null,
      lyrics: null,
      comment: null,
      bitrate: null,
      codec: null,
      container: null,
      creationTime: null,
      modificationTime: null,
      importTime: Date.now(),
    };
}
}
