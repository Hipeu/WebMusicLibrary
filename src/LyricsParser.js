/**
 * 解析 LRC 歌词文本
 * 返回格式：{ type: 'timed' | 'plain', lines: [...] }
 * - timed: [{ time: 秒数, content: string }]
 * - plain: [string]
 */
export function parseLRC(text) {
  if (!text || typeof text !== 'string') return { type: 'plain', lines: [] };

  const lines = text.split("\n");
  const timedLines = [];

  for (const line of lines) {
    const match = line.match(/\[(\d{2}):(\d{2}\.\d{2})\](.*)/);
    if (match) {
      const min = parseInt(match[1]);
      const sec = parseFloat(match[2]);
      const time = min * 60 + sec;
      const content = match[3].trim();
      if (content) {
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
    .filter(l => l.length > 0);
  return { type: 'plain', lines: plainLines };
}

