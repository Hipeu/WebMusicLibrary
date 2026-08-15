/**
 * 解析 LRC 歌词文本
 * 返回格式：{ type: 'timed' | 'plain', lines: [...] }
 * - timed: [{ time: 秒数, content: string }]
 * - plain: [string]
 */
export function parseLRC(text) {
  if (!text || typeof text !== 'string') return { type: 'plain', lines: [] };

  // 元信息/创作团队行（作词/作曲/编曲/制作人/发布者/SP/OP/版权/出品/Lyrics by 等）不作为可滚动歌词
  const META_RE = /^(?:(?:作词|作詞)\/(?:作曲)|作词|作詞|作曲|编曲|編曲|制作人|发布者|发行|SP|OP|版权|出品|Lyrics by|Composed by|Produced by|Published by)\s*[:：]/i;

  const lines = text.split("\n");
  const timedLines = [];

  for (const line of lines) {
    // 兼容 [mm:ss] / [mm:ss.xx] / [mm:ss.xxx]（网易）/ [mm:ss:xx]
    const match = line.match(/\[(\d{1,3}):(\d{2}(?:[.:]\d{1,3})?)\](.*)/);
    if (match) {
      const time = parseInt(match[1]) * 60 + parseFloat(match[2].replace(':', '.'));
      const content = match[3].trim();
      if (content && !META_RE.test(content)) {
        timedLines.push({ time, content });
      }
    }
  }

  // 如果有至少一行带时间戳的内容，视为有时间轴歌词
  if (timedLines.length > 0) {
    // 按时间排序防止乱序
    timedLines.sort((a, b) => a.time - b.time);
    return { type: 'timed', lines: timedLines };
  }

  // 否则视为纯文本歌词
  const plainLines = lines
    .map(l => l.trim())
    .filter(l => l.length > 0 && !META_RE.test(l));
  return { type: 'plain', lines: plainLines };
}

