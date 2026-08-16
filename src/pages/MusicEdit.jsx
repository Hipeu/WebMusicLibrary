import { startTransition, useState, useEffect, useRef } from "react";
import { FaImage, FaMusic, FaPlus, FaClock, FaCodeBranch, FaCalendarAlt, FaLink } from "react-icons/fa";
import { matchSong, updateMusicMetadata } from "../services/api";
import LyricImport from "../components/LyricImport";
import MatchResultPicker from "../components/MatchResultPicker";
import AlbumMatchPicker from "../components/AlbumMatchPicker";

/* ================================================================
   ✏️ MusicEdit — 编辑音乐元信息弹窗
   右上角「匹配」：歌曲匹配填入表单 / 专辑匹配逐首写回
   ================================================================ */
export default function MusicEdit({ target, onClose, onSave, onRefresh, onAlbumMatchProgress, onAlbumMatchSaved, onMatchError }) {
  const [form, setForm] = useState({});
  const [editCover, setEditCover] = useState(null);
  const [editCoverFile, setEditCoverFile] = useState(null);
  const [activeTab, setActiveTab] = useState("details");
  const [matching, setMatching] = useState(false);
  const [matchMsg, setMatchMsg] = useState("");
  const [didMatch, setDidMatch] = useState(false);
  const [albumDidMatch, setAlbumDidMatch] = useState(false);
  const [lastSource, setLastSource] = useState(null);
  const [showSongPicker, setShowSongPicker] = useState(false);
  const [showAlbumPicker, setShowAlbumPicker] = useState(false);
  const [lyricImportOpen, setLyricImportOpen] = useState(false);
  const coverInputRef = useRef(null);
  const isAlbum = target?.type === "album";
  const data = target?.data;
  // 匹配状态：专辑 = 任一首已匹配；歌曲 = 自身已匹配
  const albumMatched = isAlbum
    ? (data?.songs || []).some((s) => s.matched)
    : false;
  const songMatched = isAlbum ? albumMatched : !!data?.matched;
  // 匹配源展示：多源斜杠分隔；专辑取各歌并集
  const matchSourceDisplay = isAlbum
    ? Array.from(new Set((data?.songs || []).map((s) => s.match_source).filter(Boolean))).map(matchSourceLabel).join(" / ")
    : matchSourceLabel(data?.match_source);

  useEffect(() => {
    if (!target) return;
    // 发布者预输入：设置开启且年份存在时补全 "℗ 年份 "（仅当发布者原本为空）
    const prefilledPublisher = getPrefilledPublisher(data?.year);
    if (isAlbum) {
      startTransition(() => setForm({
        title: data.title || "",
        artist: data.artist || "",
        album_artist: data.album_artist ?? "",
        year: data.year ?? "",
        genre: data.genre || "",
        publisher: data.publisher || prefilledPublisher,
        description: data.description || "",
      }));
    } else {
      startTransition(() => setForm({
        title: data.title || "",
        artist: data.artist || "",
        album: data.album || "",
        album_artist: data.album_artist ?? "",
        year: data.year ?? "",
        genre: data.genre || "",
        trackNo: data.trackNo ?? "",
        discNo: data.discNo ?? "",
        composer: data.composer || "",
        lyricist: data.lyricist || "",
        publisher: data.publisher || prefilledPublisher,
        comment: data.comment || "",
        lyrics: data.lyrics ?? "",
      }));
    }
  }, [
    target,
    isAlbum,
    data?.album,
    data?.album_artist,
    data?.artist,
    data?.comment,
    data?.composer,
    data?.description,
    data?.discNo,
    data?.genre,
    data?.lyricist,
    data?.lyrics,
    data?.publisher,
    data?.title,
    data?.trackNo,
    data?.year,
  ]);

  if (!target) return null;

  // 读取设置里的匹配配置（字段/源/歌词兜底）
  function buildMatchConfig() {
    const fieldKeys = ["title", "artist", "album", "year", "track_disc", "genre", "album_artist", "description",
                       "composer", "lyricist", "lyric", "publisher", "arranger", "producer"];
    const sourceKeys = ["qq", "netease", "itunes", "musicbrainz"];
    const fields = {};
    fieldKeys.forEach((k) => { fields[k] = localStorage.getItem(`match-field-${k}`) !== "0"; });
    const sources = {};
    sourceKeys.forEach((k) => { sources[k] = localStorage.getItem(`match-source-${k}`) !== "0"; });
    return {
      sources,
      fields,
      lyric_credits_fallback: localStorage.getItem("match-lyric-fallback") === "1",
    };
  }

  async function handleMatch(selectedAlbum = null) {
    if (matching) return;
    setMatching(true);
    setMatchMsg("");
    try {
      const config = buildMatchConfig();
      if (isAlbum) {
        // 专辑：逐首匹配并直接写回（仅填空缺），完成后刷新；独立进度通知
        const songs = data.songs || [];
        let doneCount = 0;
        let okCount = 0;
        let skipCount = 0;
        onAlbumMatchProgress?.({ status: "start", total: songs.length });
        for (const song of songs) {
          if (song.file_path) {
            const res = await matchSong({ song_name: song.title, artist_name: song.artist, file_path: song.file_path || "", ...config });
            if (res && !res.error) {
              // 仅填空缺：源匹配其余字段，LRC 保底只补 作曲/作词/发布者，已有值不覆盖
              const payload = {};
              if (!song.composer && res.composers?.length) payload.composer = res.composers.join(", ");
              if (!song.lyricist && res.lyricists?.length) payload.lyricist = res.lyricists.join(", ");
              if (selectedAlbum?.album) payload.album = selectedAlbum.album;
              else if (!song.album && res.album) payload.album = res.album;
              if (selectedAlbum?.album_artist) {
                payload.artist = selectedAlbum.album_artist;
                payload.album_artist = selectedAlbum.album_artist;
              } else if (!song.album_artist && res.album_artist) payload.album_artist = res.album_artist;
              if (selectedAlbum?.year) payload.year = selectedAlbum.year;
              else if (!song.year && res.year) payload.year = res.year;
              if (selectedAlbum?.genre) payload.genre = selectedAlbum.genre;
              else if (!song.genre && res.genre) payload.genre = res.genre;
              if (song.trackNo == null && res.trackNo != null) payload.trackNo = res.trackNo;
              if (song.discNo == null && res.discNo != null) payload.discNo = res.discNo;
              if (!song.publisher && res.publisher) payload.publisher = res.publisher;
              if (!song.arranger && res.arranger) payload.arranger = res.arranger;
              if (!song.producer && res.producer) payload.producer = res.producer;
              if (!song.lyrics && res.lyric) payload.lyrics = res.lyric;
              const saveRes = await updateMusicMetadata({
                file_path: song.file_path,
                ...payload,
                matched: "1",
                match_source: res.source,
              });
              if (saveRes?.status === "ok") okCount++;
              else skipCount++;
              if (saveRes?.status === "ok") {
                onAlbumMatchSaved?.(target.data?.id, song, {
                  ...saveRes.song,
                  matched: true,
                  match_source: res.source || null,
                });
              }
            } else {
              skipCount++;
            }
          } else {
            skipCount++;
          }
          doneCount++;
          onAlbumMatchProgress?.({ status: "update", done: doneCount, total: songs.length });
          setMatchMsg(`正在匹配 ${doneCount}/${songs.length}`);
        }
        setAlbumDidMatch(true);
        const doneMessage = skipCount > 0
          ? `匹配成功 ${okCount} 首，跳过 ${skipCount} 首`
          : `匹配成功 ${okCount} 首`;
        onAlbumMatchProgress?.({ status: "done", done: doneCount, total: songs.length, message: doneMessage, skipped: skipCount });
        await onRefresh?.({ replace: true });
        setMatchMsg("专辑匹配完成，已写回音乐文件");
      } else {
        // 歌曲：匹配并填入表单（只填当前为空的字段）
        const res = await matchSong({
          song_name: form.title || data.title || "",
          artist_name: form.artist || data.artist || "",
          file_path: data.file_path || "",
          ...config,
        });
        if (res && res.error) {
          setMatchMsg(res.error);
          return;
        }
        setForm((prev) => {
          const next = { ...prev };
          if (!next.title && res.song_name) next.title = res.song_name;
          if (!next.artist && res.artist) next.artist = res.artist;
          if (!next.album && res.album) next.album = res.album;
          if (!next.album_artist && res.album_artist) next.album_artist = res.album_artist;
          if (!next.year && res.year) next.year = res.year;
          if (!next.genre && res.genre) next.genre = res.genre;
          if (!next.trackNo && res.trackNo != null) next.trackNo = res.trackNo;
          if (!next.discNo && res.discNo != null) next.discNo = res.discNo;
          if (!next.composer && res.composers?.length) next.composer = res.composers.join(", ");
          if (!next.lyricist && res.lyricists?.length) next.lyricist = res.lyricists.join(", ");
          if (!next.publisher && res.publisher) next.publisher = res.publisher;
          if (!next.lyrics && res.lyric) next.lyrics = res.lyric;
          return next;
        });
        setDidMatch(true);
        setLastSource(res.source || null);
        setMatchMsg("匹配完成，请确认后保存");
      }
    } catch {
      if (isAlbum) onMatchError?.();
      setMatchMsg("匹配失败，请确认后端与 QQ 服务已启动");
    } finally {
      setMatching(false);
    }
  }

  // 单曲多结果：选中候选 → 只填当前为空字段；有封面则应用到编辑表单
  function handlePickCandidate(c, coverFile) {
    if (!c) return;
    setForm((prev) => {
      const next = { ...prev };
      if (!next.title && c.song_name) next.title = c.song_name;
      if (!next.artist && c.artist) next.artist = c.artist;
      if (!next.album && c.album) next.album = c.album;
      if (!next.album_artist && c.album_artist) next.album_artist = c.album_artist;
      if (!next.year && c.year) next.year = c.year;
      if (!next.genre && c.genre) next.genre = c.genre;
      if (!next.trackNo && c.trackNo != null) next.trackNo = c.trackNo;
      if (!next.discNo && c.discNo != null) next.discNo = c.discNo;
      if (!next.composer && c.composers?.length) next.composer = c.composers.join(", ");
      if (!next.lyricist && c.lyricists?.length) next.lyricist = c.lyricists.join(", ");
      // 发布者：已有真实发布者不覆盖；仅预填前缀（℗ 年份，无真实名）视为无发布者 → 用候选的
      const isJustPrefill = next.publisher && /^℗\s*\d{4}\s*$/.test(String(next.publisher).trim());
      if ((!next.publisher || isJustPrefill) && c.publisher) next.publisher = c.publisher;
      if (!next.lyrics && c.lyric) next.lyrics = c.lyric;
      return next;
    });
    if (coverFile) {
      setEditCover(URL.createObjectURL(coverFile));
      setEditCoverFile(coverFile);
    }
    setDidMatch(true);
    setLastSource(c.source || null);
    setMatchMsg("已选择匹配结果，请确认后保存");
  }

  // 专辑多结果：选择封面 = 选择该专辑版本 → 填充专辑表单 + 封面，随后自动逐首匹配
  function handlePickAlbumCandidate(c, coverFile) {
    if (!c) return;
    setForm((prev) => {
      const next = { ...prev };
       if (c.album) next.title = c.album;
       if (c.album_artist) {
         next.artist = c.album_artist;
         next.album_artist = c.album_artist;
       }
       if (c.year) next.year = c.year;
       if (c.genre) next.genre = c.genre;
       if (c.description) next.description = c.description;
      return next;
    });
    if (coverFile) {
      setEditCover(URL.createObjectURL(coverFile));
      setEditCoverFile(coverFile);
    }
    setAlbumDidMatch(true);
    setMatchMsg("已选择专辑版本，正在匹配专辑内歌曲…");
     handleMatch(c);
  }

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleCoverSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setEditCoverFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setEditCover(ev.target.result);
    reader.readAsDataURL(file);
  }

  // 导入 LRC / 歌词文件，填入歌词表单
  async function handleSave() {
    await onSave?.(target, form, editCoverFile, didMatch, lastSource);
    onClose();
  }

  const tabs = [
    { id: "details", label: "详细信息" },
    { id: "cover", label: "封面" },
    ...(isAlbum ? [{ id: "description", label: "简介" }] : []),
    ...(isAlbum ? [] : [{ id: "lyrics", label: "歌词" }]),
    { id: "type", label: "类型" },
  ];

  return (
    <div style={styles.overlay}>
      <div style={styles.dialog} className="music-edit-dialog" onClick={(e) => e.stopPropagation()}>
        {/* 右上角：单项匹配 */}
        <button style={styles.matchBtn} onClick={() => (isAlbum ? setShowAlbumPicker(true) : setShowSongPicker(true))} disabled={matching} title="按设置中的字段与源进行匹配">
          <FaLink size={13} style={{ marginRight: 6 }} />
          {matching ? "匹配中…" : (didMatch || albumDidMatch) ? "✔已匹配" : (isAlbum ? "匹配专辑" : "匹配")}
        </button>
        {matchMsg && <p style={styles.matchMsg}>{matchMsg}</p>}

        {/* 上半部分：封面 + 标题 + 艺人 */}
        <div style={styles.topSection}>
          <div style={styles.topCover}>
            {editCover ? (
              <img src={editCover} alt="" style={styles.topCoverImg} />
            ) : data?.coverURL ? (
              <img src={data.coverURL} alt="" style={styles.topCoverImg} />
            ) : (
              <div style={styles.topCoverPlaceholder}><FaMusic size={22} /></div>
            )}
          </div>
          <div style={styles.topInfo}>
            <h3 style={styles.topTitle}>{form.title || "未知标题"}</h3>
            <p style={styles.topArtist}>
              {form.artist || "未知艺人"}
              {isAlbum && form.year ? ` · ${form.year}` : ""}
            </p>
          </div>
        </div>

        {/* 标签栏 */}
        <div style={styles.tabBar}>
          <div style={styles.tabCapsule}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                style={{
                  ...styles.tabBtn,
                  ...(activeTab === tab.id ? styles.tabBtnActive : {}),
                }}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* 标签内容 */}
        <div style={styles.tabContent}>
          {activeTab === "details" && (
            <div style={styles.formFields}>
              <div style={styles.field}>
                <label style={styles.label}>标题</label>
                <input style={styles.input} value={form.title || ""} onChange={(e) => handleChange("title", e.target.value)} />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>艺人</label>
                <input style={styles.input} value={form.artist || ""} onChange={(e) => handleChange("artist", e.target.value)} />
              </div>
              {isAlbum ? (
                <>
                  <div style={styles.field}>
                    <label style={styles.label}>专辑艺人</label>
                    <input style={styles.input} value={form.album_artist ?? ""} onChange={(e) => handleChange("album_artist", e.target.value)} />
                  </div>
                  <div style={styles.field}>
                    <label style={styles.label}>年份</label>
                    <input style={styles.input} value={form.year} onChange={(e) => handleChange("year", e.target.value)} />
                  </div>
                  <div style={styles.field}>
                    <label style={styles.label}>流派</label>
                    <input style={styles.input} value={form.genre || ""} onChange={(e) => handleChange("genre", e.target.value)} />
                  </div>
                  <div style={styles.field}>
                    <label style={styles.label}>发布者</label>
                    <input style={styles.input} value={form.publisher || ""} onChange={(e) => handleChange("publisher", e.target.value)} />
                  </div>
                </>
              ) : (
                <>
                  <div style={styles.field}>
                    <label style={styles.label}>专辑</label>
                    <input style={styles.input} value={form.album || ""} onChange={(e) => handleChange("album", e.target.value)} />
                  </div>
                  <div style={styles.field}>
                    <label style={styles.label}>专辑艺人</label>
                    <input style={styles.input} value={form.album_artist ?? ""} onChange={(e) => handleChange("album_artist", e.target.value)} />
                  </div>
                  <div style={styles.field}>
                    <label style={styles.label}>年份</label>
                    <input style={styles.input} value={form.year} onChange={(e) => handleChange("year", e.target.value)} />
                  </div>
                  <div style={styles.field}>
                    <label style={styles.label}>流派</label>
                    <input style={styles.input} value={form.genre || ""} onChange={(e) => handleChange("genre", e.target.value)} />
                  </div>
                  <div style={styles.fieldRow}>
                    <div style={styles.field}>
                      <label style={styles.label}>音轨号</label>
                      <input style={styles.input} value={form.trackNo} onChange={(e) => handleChange("trackNo", e.target.value)} />
                    </div>
                    <div style={styles.field}>
                      <label style={styles.label}>碟号</label>
                      <input style={styles.input} value={form.discNo} onChange={(e) => handleChange("discNo", e.target.value)} placeholder="留空清除" />
                    </div>
                  </div>
                  <div style={styles.field}>
                    <label style={styles.label}>作曲</label>
                    <input style={styles.input} value={form.composer || ""} onChange={(e) => handleChange("composer", e.target.value)} />
                  </div>
                  <div style={styles.field}>
                    <label style={styles.label}>作词</label>
                    <input style={styles.input} value={form.lyricist || ""} onChange={(e) => handleChange("lyricist", e.target.value)} />
                  </div>
                  <div style={styles.field}>
                    <label style={styles.label}>发布者</label>
                    <input style={styles.input} value={form.publisher || ""} onChange={(e) => handleChange("publisher", e.target.value)} />
                  </div>
                  <div style={styles.field}>
                    <label style={styles.label}>注释</label>
                    <input style={styles.input} value={form.comment || ""} onChange={(e) => handleChange("comment", e.target.value)} />
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === "cover" && (
            <div style={styles.coverTab}>
              <div style={styles.coverPreview}>
                {editCover || data?.coverURL ? (
                  <img
                    src={editCover || data.coverURL}
                    alt="封面"
                    style={styles.coverPreviewImg}
                  />
                ) : (
                  <div style={styles.coverAddArea} onClick={() => coverInputRef.current?.click()}>
                    <FaPlus size={28} />
                    <span style={styles.coverAddText}>添加</span>
                  </div>
                )}
              </div>
              {(editCover || data?.coverURL) && (
                <button style={styles.changeCoverBtn} onClick={() => coverInputRef.current?.click()}>
                  <FaImage size={14} style={{ marginRight: "6px" }} />
                  更换封面
                </button>
              )}
              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleCoverSelect}
              />
            </div>
          )}

          {activeTab === "description" && isAlbum && (
            <div style={styles.descriptionTab}>
              <textarea
                style={styles.descriptionInput}
                value={form.description || ""}
                onChange={(e) => handleChange("description", e.target.value)}
                placeholder="输入专辑简介"
                rows={8}
              />
            </div>
          )}

          {activeTab === "type" && (
            <div style={styles.typeTab}>
              {!isAlbum && (data?.codec || data?.container) && (
                <div style={styles.typeRow}>
                  <span style={styles.typeIcon}><FaCodeBranch size={13} /></span>
                  <span style={styles.typeLabel}>种类</span>
                  <span style={styles.typeValue}>{data?.codec || data?.container}</span>
                </div>
              )}
              {!isAlbum && data?.duration && (
                <>
                  <div style={styles.typeRow}>
                    <span style={styles.typeIcon}><FaClock size={13} /></span>
                    <span style={styles.typeLabel}>音乐时长</span>
                    <span style={styles.typeValue}>{formatDuration(data.duration)}</span>
                  </div>
                  {data?.bitrate && (
                    <div style={styles.typeRow}>
                      <span style={styles.typeIcon}><FaCodeBranch size={13} /></span>
                      <span style={styles.typeLabel}>码率</span>
                      <span style={styles.typeValue}>{`${Math.round(data.bitrate / 1000)} kbps`}</span>
                    </div>
                  )}
                </>
              )}
              {isAlbum && (
                <div style={styles.typeRow}>
                  <span style={styles.typeIcon}><FaMusic size={13} /></span>
                  <span style={styles.typeLabel}>歌曲数量</span>
                  <span style={styles.typeValue}>{data?.songs?.length || 0} 首</span>
                </div>
              )}
              <div style={styles.typeRow}>
                <span style={styles.typeIcon}><FaLink size={13} /></span>
                <span style={styles.typeLabel}>匹配状态</span>
                <span style={{ ...styles.typeValue, color: songMatched ? "#16a34a" : "#9ca3af" }}>
                  {songMatched ? "已匹配" : "未匹配"}
                </span>
              </div>
              {matchSourceDisplay && (
                <div style={styles.typeRow}>
                  <span style={styles.typeIcon}><FaCodeBranch size={13} /></span>
                  <span style={styles.typeLabel}>匹配源</span>
                  <span style={styles.typeValue}>{matchSourceDisplay}</span>
                </div>
              )}
              {data?.importTime && (
                <div style={styles.typeRow}>
                  <span style={styles.typeIcon}><FaCalendarAlt size={13} /></span>
                  <span style={styles.typeLabel}>添加时间</span>
                  <span style={styles.typeValue}>{formatTimestamp(data.importTime)}</span>
                </div>
              )}
              {data?.modification_time && (
                <div style={styles.typeRow}>
                  <span style={styles.typeIcon}><FaCalendarAlt size={13} /></span>
                  <span style={styles.typeLabel}>修改时间</span>
                  <span style={styles.typeValue}>{formatTimestamp(data?.modification_time)}</span>
                </div>
              )}
            </div>
          )}

          {activeTab === "lyrics" && !isAlbum && (
            <div style={styles.lyricsTab}>
              <div style={styles.lyricsToolbar}>
                <button style={styles.importLrcBtn} onClick={() => setLyricImportOpen(true)}>
                  📄 导入歌词
                </button>
              </div>
              <textarea
                style={styles.lyricsTextarea}
                value={form.lyrics ?? ""}
                onChange={(e) => handleChange("lyrics", e.target.value)}
                placeholder="在此输入 / 编辑歌词（支持 .lrc 时间轴格式或纯文本）"
                spellCheck={false}
              />
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div style={styles.footer}>
          <button style={styles.cancelBtn} onClick={onClose}>取消</button>
          <button style={styles.saveBtn} onClick={handleSave}>保存</button>
        </div>

        {/* 歌词获取界面 */}
        {lyricImportOpen && (
          <LyricImport
            song_name={form.title || data?.title || ""}
            artist_name={form.artist || data?.artist || ""}
            onUseLyric={(text) => handleChange("lyrics", text)}
            onClose={() => setLyricImportOpen(false)}
          />
        )}

        {/* 单曲匹配多结果选择 */}
        {showSongPicker && (
          <MatchResultPicker
            song_name={form.title || data?.title || ""}
            artist_name={form.artist || data?.artist || ""}
            file_path={data?.file_path || ""}
            onPick={handlePickCandidate}
            onClose={() => setShowSongPicker(false)}
          />
        )}

        {/* 专辑匹配多结果选择 */}
        {showAlbumPicker && (
          <AlbumMatchPicker
            album_name={form.title || data?.title || ""}
            artist_name={form.artist || data?.artist || ""}
            onPick={handlePickAlbumCandidate}
            onClose={() => setShowAlbumPicker(false)}
          />
        )}
      </div>
    </div>
  );
}

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** 匹配源 → 中文标签（多源以 / 分隔） */
function matchSourceLabel(source) {
  if (!source) return "";
  const LABELS = { qq: "QQ音乐", itunes: "iTunes", musicbrainz: "MusicBrainz", netease: "网易云音乐" };
  const parts = String(source).split(/[^\w]+/).map((s) => s.trim()).filter(Boolean);
  return parts.map((s) => LABELS[s] || s).join(" / ");
}

/** 发布者预输入：设置「编辑发布者默认携带发布符号和日期」开启且有年份时，返回 "℗ 年份 "，否则空字符串 */
function getPrefilledPublisher(year) {
  const enabled = localStorage.getItem("edit-publisher-copyright") !== "false";
  if (!enabled) return "";
  if (!year) return "";
  return `℗ ${year} `;
}

function formatTimestamp(ts) {
  if (!ts) return "未知";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "未知";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}`;
}

/* ================================================================
   🎨 样式
   ================================================================ */
const styles = {
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 1000,
  },
  dialog: {
    position: "relative",
    background: "#ffffff", borderRadius: "14px", width: "640px",
    maxHeight: "85vh", display: "flex", flexDirection: "column",
    fontFamily: "'Segoe UI', sans-serif",
    boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
  },
  matchBtn: {
    position: "absolute",
    top: "14px",
    right: "14px",
    zIndex: 10,
    display: "inline-flex",
    alignItems: "center",
    padding: "7px 16px",
    borderRadius: "16px",
    border: "1px solid #e94560",
    background: "#ffffff",
    color: "#e94560",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  matchMsg: {
    position: "absolute",
    top: "58px",
    right: "14px",
    zIndex: 10,
    fontSize: "12px",
    color: "#6b7280",
    margin: 0,
    background: "#ffffff",
    padding: "4px 10px",
    borderRadius: "8px",
    border: "1px solid #f3f4f6",
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
  },

  /* 上半部分 */
  topSection: {
    display: "flex", alignItems: "center", gap: "16px",
    padding: "20px 24px 16px",
    borderBottom: "1px solid #e5e7eb",
  },
  topCover: { width: "80px", height: "80px", borderRadius: "8px", overflow: "hidden", flexShrink: 0 },
  topCoverImg: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  topCoverPlaceholder: {
    width: "100%", height: "100%", display: "flex", alignItems: "center",
    justifyContent: "center", background: "#e5e7eb", color: "#9ca3af",
  },
  topInfo: { minWidth: 0, flex: 1 },
  topTitle: { fontSize: "18px", fontWeight: 700, color: "#1f2937", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  topArtist: { fontSize: "14px", color: "#6b7280", margin: "4px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },

  /* 标签栏 */
  tabBar: {
    display: "flex", justifyContent: "center",
    padding: "12px 24px 16px", flexShrink: 0,
  },
  tabCapsule: {
    display: "flex", gap: "2px", padding: "4px",
    borderRadius: "28px", background: "#f3f4f6",
  },
  tabBtn: {
    display: "flex", alignItems: "center",
    padding: "6px 18px", borderRadius: "24px",
    border: "none", background: "transparent",
    color: "#6b7280", fontSize: "13px", fontWeight: 500,
    cursor: "pointer", fontFamily: "inherit",
    transition: "all 0.25s ease", letterSpacing: "0.3px",
  },
  tabBtnActive: {
    background: "#e94560", color: "#ffffff",
    boxShadow: "0 4px 12px rgba(233,69,96,0.35)",
  },

  /* 标签内容 */
  tabContent: {
    flex: 1, overflowY: "auto", padding: "16px 24px", minHeight: "200px",
  },
  formFields: { display: "flex", flexDirection: "column", gap: "10px" },
  field: { display: "flex", flexDirection: "column", gap: "4px", flex: 1, minWidth: 0 },
  fieldRow: { display: "flex", gap: "10px" },
  label: { fontSize: "12px", fontWeight: 600, color: "#6b7280" },
  input: {
    padding: "8px 10px", borderRadius: "6px", border: "1px solid #e5e7eb",
    fontSize: "13px", color: "#1f2937", background: "#f9fafb",
    outline: "none", fontFamily: "inherit",
  },

  /* 封面标签 */
  coverTab: {
    display: "flex", flexDirection: "column", alignItems: "center",
    gap: "12px", padding: "20px 0",
  },
  coverPreview: { width: "220px", height: "220px", borderRadius: "10px", overflow: "hidden" },
  coverPreviewImg: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  coverAddArea: {
    width: "100%", height: "100%", display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", gap: "6px",
    border: "2px dashed #d1d5db", borderRadius: "10px", cursor: "pointer",
    color: "#9ca3af", transition: "border-color 0.2s, color 0.2s",
  },
  coverAddText: { fontSize: "13px", fontWeight: 500 },
  changeCoverBtn: {
    display: "inline-flex", alignItems: "center", gap: "4px",
    padding: "8px 16px", borderRadius: "6px", border: "1px solid #e5e7eb",
    background: "#ffffff", color: "#374151", fontSize: "13px",
    cursor: "pointer", fontFamily: "inherit",
  },

  descriptionTab: {
    display: "flex", flexDirection: "column", gap: "8px", padding: "8px 0",
  },
  descriptionInput: {
    width: "100%", boxSizing: "border-box", minHeight: "220px",
    padding: "12px", borderRadius: "8px", border: "1px solid #e5e7eb",
    background: "#f9fafb", color: "#1f2937", fontSize: "13px",
    lineHeight: 1.7, fontFamily: "inherit", resize: "vertical", outline: "none",
  },

  /* 歌词标签 */
  lyricsTab: {
    display: "flex", flexDirection: "column", gap: "8px", padding: "4px 0",
  },
  lyricsToolbar: {
    display: "flex", alignItems: "center", gap: "10px",
  },
  importLrcBtn: {
    display: "inline-flex", alignItems: "center", gap: "6px",
    alignSelf: "flex-start",
    padding: "6px 16px", borderRadius: "20px",
    border: "1px solid rgba(233,69,96,0.3)",
    background: "rgba(233,69,96,0.1)",
    color: "#e94560", fontSize: "13px", fontWeight: 500,
    cursor: "pointer", fontFamily: "inherit",
  },
  lyricsTextarea: {
    minHeight: "300px",
    padding: "12px",
    borderRadius: "8px",
    border: "1px solid #e5e7eb",
    background: "#f9fafb",
    fontSize: "13px",
    lineHeight: 1.7,
    color: "#1f2937",
    fontFamily: "'Segoe UI', sans-serif",
    resize: "vertical",
    outline: "none",
  },

  /* 类型标签 */
  typeTab: {
    display: "flex", flexDirection: "column", gap: "14px", padding: "8px 0",
  },
  typeRow: {
    display: "flex", alignItems: "center", gap: "10px",
    fontSize: "13px", color: "#374151",
  },
  typeIcon: { color: "#9ca3af", width: "16px", flexShrink: 0, display: "flex", justifyContent: "center" },
  typeLabel: { color: "#6b7280", width: "80px", flexShrink: 0 },
  typeValue: { color: "#1f2937", fontWeight: 500 },

  /* 底部 */
  footer: {
    display: "flex", justifyContent: "flex-end", gap: "8px",
    padding: "12px 24px", borderTop: "1px solid #e5e7eb",
  },
  cancelBtn: {
    padding: "8px 16px", borderRadius: "6px", border: "1px solid #e5e7eb",
    background: "#ffffff", color: "#374151", fontSize: "13px",
    cursor: "pointer", fontFamily: "inherit",
  },
  saveBtn: {
    padding: "8px 16px", borderRadius: "6px", border: "none",
    background: "#e94560", color: "#ffffff", fontSize: "13px",
    fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
  },
};
