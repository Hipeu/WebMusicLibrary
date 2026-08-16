import util from '../src/util/lyricParse';

describe('lyricParse', () => {
  it('should parse lyrics correctly', () => {
    const lyricStr = `[ti:Test Title]
[ar:Test Artist]
[00:01.00]First line
[00:02.50]Second line`;

    const parsed = util.lyricParse(lyricStr);
    expect(parsed.tags.title).toBe('Test Title');
    expect(parsed.tags.artist).toBe('Test Artist');
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0].time).toBe(1000);
    expect(parsed.lines[0].txt).toBe('First line');
    expect(parsed.lines[1].time).toBe(2500);
    expect(parsed.lines[1].txt).toBe('Second line');
  });

  it('should handle empty string', () => {
    const parsed = util.lyricParse('');
    expect(parsed.lines).toHaveLength(0);
  });
});
