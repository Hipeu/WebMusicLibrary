import { parseBlob } from "music-metadata";

/**
 * 读取音频文件的元数据
 * @param {File} file - 音频文件对象
 * @returns {Promise<{title, artist, album, year, coverURL, genre, duration, trackNo, composer, lyricist, publisher, lyrics, comment}>}
 */
export async function readMetadata(file) {
  try {
  const metadata = await parseBlob(file);

    const title = metadata.common.title || file.name.replace(/\.[^/.]+$/, "");
    const artist = metadata.common.artist || "未知艺术家";
    const album = metadata.common.album || "未知专辑";

    // 年份获取：优先用 common.year，其次从 date 解析，最后用 creationTime
    let year = null;
    if (metadata.common.year) {
      year = metadata.common.year;
    } else if (metadata.common.date) {
      // date 可能是 "2024-01-15" 或 "2024" 格式
      const match = String(metadata.common.date).match(/(\d{4})/);
      if (match) year = parseInt(match[1]);
    } else if (metadata.format?.creationTime) {
      const d = new Date(metadata.format.creationTime);
      if (!isNaN(d.getTime())) year = d.getFullYear();
    }

    // 流派获取：common.genre 可能是字符串或数组
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

    // 时长获取（秒）
    const duration = metadata.format?.duration || null;

    // 音轨号
    const trackNo = metadata.common.track?.no || null;

    // 作曲家（可能是数组）
    let composer = null;
    if (metadata.common.composer) {
      const raw = metadata.common.composer;
      composer = Array.isArray(raw) ? raw.join(" / ") : String(raw);
    }

    // 作词家
    let lyricist = null;
    if (metadata.common.lyricist) {
      const raw = metadata.common.lyricist;
      lyricist = Array.isArray(raw) ? raw.join(" / ") : String(raw);
    }

    // 发布者 / 唱片公司
    const publisher = metadata.common.publisher || metadata.common.label || null;

    // 歌词（music-metadata 返回数组，取第一段或合并）
    let lyrics = null;
    if (metadata.common.lyrics) {
      const raw = metadata.common.lyrics;
      lyrics = Array.isArray(raw) ? raw.map(l => l.text || l).join("\n\n") : String(raw);
    }

    // 注释
    let comment = null;
    if (metadata.common.comment) {
      const raw = metadata.common.comment;
      comment = Array.isArray(raw) ? raw.join(" / ") : String(raw);
    }

    return { title, artist, album, year, coverURL, genre, duration, trackNo, composer, lyricist, publisher, lyrics, comment };
  } catch (err) {
    console.warn("读取元数据失败:", err);
    // 降级：只用文件名
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
    };
}
}


