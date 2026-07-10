import { parseBlob } from "music-metadata";

/**
 * 读取音频文件的元数据（标题、艺术家、专辑、封面）
 * @param {File} file - 音频文件对象
 * @returns {Promise<{title, artist, album, coverURL}>}
 */
export async function readMetadata(file) {
  try {
  const metadata = await parseBlob(file);

    const title = metadata.common.title || file.name.replace(/\.[^/.]+$/, "");
    const artist = metadata.common.artist || "未知艺术家";
    const album = metadata.common.album || "未知专辑";

    let coverURL = null;
    const picture = metadata.common.picture?.[0];
  if (picture) {
    const blob = new Blob([picture.data], { type: picture.format });
      coverURL = URL.createObjectURL(blob);
  }

    return { title, artist, album, coverURL };
  } catch (err) {
    console.warn("读取元数据失败:", err);
    // 降级：只用文件名
    return {
      title: file.name.replace(/\.[^/.]+$/, ""),
      artist: "未知艺术家",
      album: "未知专辑",
      coverURL: null,
    };
}
}

