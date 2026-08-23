import { useState, useRef, useMemo } from "react";
import { FaPen, FaImage, FaPlus, FaMusic, FaTrash } from "react-icons/fa";
import { getAssetUrl, saveArtist, uploadArtistCover, deleteArtist } from "../services/api";
import ArtistMatchPicker from "../components/ArtistMatchPicker";

function normalizeCoverPosition(position) {
  return {
    x: clampCoverPosition(Number(position?.x ?? 50)),
    y: clampCoverPosition(Number(position?.y ?? 50)),
  };
}

function clampCoverPosition(value) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 50));
}

/* ================================================================
   ✏️ ArtistEdit — 编辑艺人信息弹窗
   顶部：艺人头像 + 名称
   标签：艺人封面 / 艺人详情 / 流派
   底部：无音乐时显示「移除空艺人」
   ================================================================ */
export default function ArtistEdit({ artist, record, albums, onClose, onSaved, onRemoved }) {
  // 自动抓取流派：该艺人所有歌曲的 genre 去重
  const autoGenres = useMemo(() => {
    const set = new Set();
    (albums || []).forEach((a) =>
      (a.songs || []).forEach((s) => {
        if (s.genre) set.add(s.genre);
      })
    );
    return Array.from(set);
  }, [albums]);

  const [activeTab, setActiveTab] = useState("cover"); // "cover" | "bio" | "genres"
  const [coverUrl, setCoverUrl] = useState(record?.cover_url || null);
  const [coverFile, setCoverFile] = useState(null);
  const [coverPosition, setCoverPosition] = useState(() => normalizeCoverPosition(record?.cover_position));
  const dragRef = useRef(null);
  const [bio, setBio] = useState(record?.bio || "");
  const [genres, setGenres] = useState(() => {
    const saved = record?.genres;
    if (saved && saved.length) return [...saved];
    return autoGenres;
  });
  const [genreInput, setGenreInput] = useState("");
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [showMatchPicker, setShowMatchPicker] = useState(false);
  const [bioSource, setBioSource] = useState(record?.bio_source || null);
  const [bioSourceId, setBioSourceId] = useState(record?.bio_source_id || null);
  const [coverSource, setCoverSource] = useState(record?.cover_source || null);
  const [coverSourceId, setCoverSourceId] = useState(record?.cover_source_id || null);
  const [matchGotData, setMatchGotData] = useState(false); // 本次匹配是否拿到任一数据
  const coverInputRef = useRef(null);

  const isEmpty = (albums || []).length === 0;

  async function handleRemoveArtist() {
    try {
      await deleteArtist(artist);
    } catch (err) {
      console.warn("删除艺人失败:", err);
    }
    onRemoved?.(artist);
    onClose?.();
  }

  function displayUrl(u) {
    if (!u) return null;
    if (u.startsWith("data:") || u.startsWith("http")) return u;
    return getAssetUrl(u);
  }

  function handleCoverSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverFile(file);
    setCoverPosition({ x: 50, y: 50 });
    const reader = new FileReader();
    reader.onload = (ev) => setCoverUrl(ev.target.result);
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function handleRemoveCover() {
    setCoverFile(null);
    setCoverUrl(null);
    setCoverPosition({ x: 50, y: 50 });
  }

  function handleCoverPointerDown(e) {
    if (!coverUrl) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      position: coverPosition,
    };
  }

  function handleCoverPointerMove(e) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const next = {
      x: clampCoverPosition(drag.position.x - ((e.clientX - drag.startX) / rect.width) * 100),
      y: clampCoverPosition(drag.position.y - ((e.clientY - drag.startY) / rect.height) * 100),
    };
    setCoverPosition(next);
  }

  function handleCoverPointerUp(e) {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  }

  function resetCoverPosition() {
    setCoverPosition({ x: 50, y: 50 });
  }

  function handleAddGenre() {
    const g = genreInput.trim();
    if (g && !genres.includes(g)) setGenres([...genres, g]);
    setGenreInput("");
  }

  function handleRemoveGenre(g) {
    setGenres(genres.filter((x) => x !== g));
  }

  function handleResetGenres() {
    setGenres([...autoGenres]);
  }

  async function handleSave() {
    const payload = {
      name: artist, bio, genres,
      cover_position: coverPosition,
      bio_source: bioSource,
      bio_source_id: bioSourceId,
      cover_source: coverSource,
      cover_source_id: coverSourceId,
      ...(matchGotData ? { matched: true } : {}),
    };
    if (coverFile) {
      const res = await uploadArtistCover(artist, coverFile);
      if (res?.status === "ok" && res.cover_url) {
        payload.cover_url = res.cover_url;
      }
    } else {
      payload.cover_url = coverUrl;
    }
    let ok = false;
    try {
      const res = await saveArtist(payload);
      ok = res?.status === "ok";
    } catch (err) {
      console.warn("保存艺人失败:", err);
    }
    if (ok) {
      onSaved?.({ name: artist, cover_url: payload.cover_url || null, bio, genres, cover_position: coverPosition, bio_source: bioSource, bio_source_id: bioSourceId, cover_source: coverSource, cover_source_id: coverSourceId, ...(matchGotData ? { matched: true } : {}) });
    }
    onClose?.();
  }

  const tabs = [
    { id: "cover", label: "艺人封面" },
    { id: "bio", label: "艺人详情" },
    { id: "genres", label: "流派" },
  ];

  return (
    <div style={styles.overlay}>
      <div style={styles.dialog} className="artist-edit-dialog" onClick={(e) => e.stopPropagation()}>
        <button type="button" style={styles.matchButton} onClick={() => setShowMatchPicker(true)} title="从 QQ音乐或网易云匹配艺人">
          匹配艺人
        </button>
        {/* 顶部：头像 + 名称 */}
        <div style={styles.topSection}>
          <div style={styles.topAvatar}>
            {coverUrl ? (
              <img src={displayUrl(coverUrl)} alt="" style={styles.topAvatarImg} />
            ) : (
              <div style={styles.topAvatarPlaceholder}><FaMusic size={20} /></div>
            )}
          </div>
          <div style={styles.topInfo}>
            <h3 style={styles.topTitle}>{artist}</h3>
            <p style={styles.topHint}>
              <FaPen size={11} style={{ marginRight: "5px" }} />
              编辑艺人信息
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
          {activeTab === "cover" && (
            <div style={styles.coverTab}>
              <div style={styles.coverPreview}>
                {coverUrl ? (
                  <img
                    src={displayUrl(coverUrl)}
                    alt="艺人照片"
                    style={styles.coverPreviewImg}
                  />
                ) : (
                  <div style={styles.coverAddArea} onClick={() => coverInputRef.current?.click()}>
                    <FaPlus size={28} />
                    <span style={styles.coverAddText}>添加照片</span>
                  </div>
                )}
              </div>
              {coverUrl && (
                <div style={styles.bannerPreviewBlock}>
                  <div style={styles.previewLabel}>详情页横幅预览</div>
                  <div
                    style={styles.bannerPreview}
                    onPointerDown={handleCoverPointerDown}
                    onPointerMove={handleCoverPointerMove}
                    onPointerUp={handleCoverPointerUp}
                    onPointerCancel={handleCoverPointerUp}
                    title="拖动图片调整显示位置"
                  >
                    <img
                      src={displayUrl(coverUrl)}
                      alt="详情页横幅预览"
                      draggable="false"
                      style={{ ...styles.bannerPreviewImg, objectPosition: `${coverPosition.x}% ${coverPosition.y}%` }}
                    />
                    <span style={styles.previewHint}>拖动调整位置</span>
                  </div>
                  <button type="button" style={styles.resetPositionBtn} onClick={resetCoverPosition}>重置位置</button>
                </div>
              )}
              <div style={styles.coverActions}>
                <button style={styles.changeCoverBtn} onClick={() => coverInputRef.current?.click()}>
                  <FaImage size={14} style={{ marginRight: "6px" }} />
                  更换照片
                </button>
                {coverUrl && (
                  <button style={styles.removeCoverBtn} onClick={handleRemoveCover}>
                    移除照片
                  </button>
                )}
              </div>
              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleCoverSelect}
              />
            </div>
          )}

          {activeTab === "bio" && (
            <div style={styles.bioTab}>
              <textarea
                style={styles.bioTextarea}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="在此填写艺人简介…"
                spellCheck={false}
              />
            </div>
          )}

          {activeTab === "genres" && (
            <div style={styles.genresTab}>
              <div style={styles.genresHint}>自动抓取自音乐元信息，可自行增删</div>
              <div style={styles.genresChips}>
                {genres.length === 0 ? (
                  <span style={styles.genresEmpty}>暂无流派</span>
                ) : (
                  genres.map((g) => (
                    <span key={g} style={styles.genreChip}>
                      <span style={styles.genreChipText}>{g}</span>
                      <button style={styles.genreChipRemove} onClick={() => handleRemoveGenre(g)}>
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>
              <div style={styles.genreAddRow}>
                <input
                  style={styles.genreInput}
                  value={genreInput}
                  onChange={(e) => setGenreInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddGenre(); }}
                  placeholder="输入流派后回车添加"
                  spellCheck={false}
                />
                <button style={styles.genreAddBtn} onClick={handleAddGenre}>
                  <FaPlus size={12} style={{ marginRight: "4px" }} />
                  添加
                </button>
              </div>
              <button style={styles.genreResetBtn} onClick={handleResetGenres}>
                重置为自动抓取
              </button>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div style={styles.footer}>
          {isEmpty && (
            <button style={styles.removeBtn} onClick={() => setShowRemoveConfirm(true)}>
              <FaTrash size={12} style={{ marginRight: "5px" }} />
              移除
            </button>
          )}
          <button style={styles.cancelBtn} onClick={onClose}>取消</button>
          <button style={styles.saveBtn} onClick={handleSave}>保存</button>
        </div>

        {/* 移除空艺人确认窗 */}
        {showRemoveConfirm && (
          <div style={confirmStyles.overlay} onClick={() => setShowRemoveConfirm(false)}>
            <div style={confirmStyles.box} onClick={(e) => e.stopPropagation()}>
              <h3 style={confirmStyles.title}>移除空艺人</h3>
              <div style={confirmStyles.divider} />
              <p style={confirmStyles.text}>该操作会删除已编辑的艺人数据，此操作不可撤销</p>
              <div style={confirmStyles.actions}>
                <button style={confirmStyles.confirmBtn} onClick={handleRemoveArtist}>确认</button>
                <button style={confirmStyles.cancelBtn} onClick={() => setShowRemoveConfirm(false)}>取消</button>
              </div>
            </div>
          </div>
        )}
        {showMatchPicker && (
          <ArtistMatchPicker
            artistName={artist}
            onPick={(candidate) => {
              if (candidate.bio) setBio(candidate.bio);
              if (candidate.avatar_url) setCoverUrl(candidate.avatar_url);
              setCoverPosition({ x: 50, y: 50 });
              setBioSource(candidate.source || null);
              setBioSourceId(candidate.singermid || candidate.artist_id || null);
              setCoverSource(candidate.source || null);
              setCoverSourceId(candidate.singermid || candidate.artist_id || null);
              if (candidate.bio || candidate.avatar_url) setMatchGotData(true);
              setActiveTab("bio");
            }}
            onClose={() => setShowMatchPicker(false)}
          />
        )}
      </div>
    </div>
  );
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
    background: "#ffffff", borderRadius: "14px", width: "580px",
    maxHeight: "85vh", display: "flex", flexDirection: "column",
    fontFamily: "'Segoe UI', sans-serif",
    boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
  },
  matchButton: {
    position: "absolute", top: "14px", right: "14px", zIndex: 5,
    padding: "7px 15px", border: "1px solid #e94560", borderRadius: "16px",
    background: "#fff", color: "#e94560", fontSize: "13px", fontWeight: 600,
    cursor: "pointer", fontFamily: "inherit",
  },

  /* 顶部 */
  topSection: {
    display: "flex", alignItems: "center", gap: "16px",
    padding: "20px 24px 16px",
    borderBottom: "1px solid #e5e7eb",
  },
  topAvatar: {
    width: "80px", height: "80px", borderRadius: "50%",
    overflow: "hidden", flexShrink: 0, background: "#e5e7eb",
  },
  topAvatarImg: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  topAvatarPlaceholder: {
    width: "100%", height: "100%", display: "flex", alignItems: "center",
    justifyContent: "center", color: "#9ca3af",
  },
  topInfo: { minWidth: 0, flex: 1 },
  topTitle: {
    fontSize: "18px", fontWeight: 700, color: "#1f2937", margin: 0,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  },
  topHint: {
    fontSize: "13px", color: "#6b7280", margin: "6px 0 0",
    display: "flex", alignItems: "center",
  },

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

  /* 封面 */
  coverTab: {
    display: "flex", flexDirection: "column", alignItems: "center",
    gap: "14px", padding: "20px 0",
  },
  coverPreview: {
    width: "220px", height: "220px", borderRadius: "50%", overflow: "hidden",
  },
  coverPreviewImg: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  bannerPreviewBlock: {
    width: "100%", maxWidth: "500px", display: "flex", flexDirection: "column",
    alignItems: "center", gap: "8px",
  },
  previewLabel: { alignSelf: "flex-start", color: "#6b7280", fontSize: "12px", fontWeight: 600 },
  bannerPreview: {
    position: "relative", width: "100%", height: "145px", overflow: "hidden",
    borderRadius: "10px", background: "#e5e7eb", cursor: "grab", touchAction: "none",
    boxShadow: "inset 0 0 0 1px rgba(15,23,42,0.08)",
  },
  bannerPreviewImg: {
    width: "100%", height: "100%", display: "block", objectFit: "cover", userSelect: "none",
    pointerEvents: "none",
  },
  previewHint: {
    position: "absolute", right: "10px", bottom: "8px", padding: "3px 7px",
    borderRadius: "10px", background: "rgba(15,23,42,0.55)", color: "#fff", fontSize: "11px",
    pointerEvents: "none",
  },
  resetPositionBtn: {
    alignSelf: "flex-end", padding: "5px 10px", border: "1px solid #e5e7eb",
    borderRadius: "14px", background: "#fff", color: "#6b7280", fontSize: "12px",
    cursor: "pointer", fontFamily: "inherit",
  },
  coverAddArea: {
    width: "100%", height: "100%", display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", gap: "6px",
    border: "2px dashed #d1d5db", borderRadius: "50%", cursor: "pointer",
    color: "#9ca3af", transition: "border-color 0.2s, color 0.2s",
  },
  coverAddText: { fontSize: "13px", fontWeight: 500 },
  coverActions: { display: "flex", alignItems: "center", gap: "10px" },
  changeCoverBtn: {
    display: "inline-flex", alignItems: "center", gap: "4px",
    padding: "8px 16px", borderRadius: "6px", border: "1px solid #e5e7eb",
    background: "#ffffff", color: "#374151", fontSize: "13px",
    cursor: "pointer", fontFamily: "inherit",
  },
  removeCoverBtn: {
    display: "inline-flex", alignItems: "center", gap: "4px",
    padding: "8px 16px", borderRadius: "6px", border: "1px solid #fecaca",
    background: "#fef2f2", color: "#dc2626", fontSize: "13px",
    cursor: "pointer", fontFamily: "inherit",
  },

  /* 详情 */
  bioTab: { padding: "4px 0" },
  bioTextarea: {
    width: "100%", minHeight: "240px", boxSizing: "border-box",
    padding: "12px", borderRadius: "8px",
    border: "1px solid #e5e7eb", background: "#f9fafb",
    fontSize: "13px", lineHeight: 1.7, color: "#1f2937",
    fontFamily: "'Segoe UI', sans-serif", resize: "vertical",
    outline: "none",
  },

  /* 流派 */
  genresTab: {
    display: "flex", flexDirection: "column", gap: "12px", padding: "4px 0",
  },
  genresHint: { fontSize: "12px", color: "#9ca3af" },
  genresChips: {
    display: "flex", flexWrap: "wrap", gap: "8px", minHeight: "28px",
  },
  genresEmpty: { fontSize: "13px", color: "#9ca3af" },
  genreChip: {
    display: "inline-flex", alignItems: "center", gap: "6px",
    padding: "4px 10px 4px 12px", borderRadius: "14px",
    background: "#f3f4f6", border: "1px solid #e5e7eb",
    fontSize: "13px", color: "#374151",
  },
  genreChipText: { lineHeight: 1.4 },
  genreChipRemove: {
    border: "none", background: "transparent", cursor: "pointer",
    color: "#9ca3af", fontSize: "15px", lineHeight: 1,
    padding: "0 2px", fontFamily: "inherit",
  },
  genreAddRow: { display: "flex", gap: "8px" },
  genreInput: {
    flex: 1, padding: "8px 10px", borderRadius: "6px",
    border: "1px solid #e5e7eb", fontSize: "13px", color: "#1f2937",
    background: "#f9fafb", outline: "none", fontFamily: "inherit",
  },
  genreAddBtn: {
    display: "inline-flex", alignItems: "center",
    padding: "8px 16px", borderRadius: "6px", border: "none",
    background: "#e94560", color: "#ffffff", fontSize: "13px",
    fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
  },
  genreResetBtn: {
    alignSelf: "flex-start",
    padding: "6px 14px", borderRadius: "6px",
    border: "1px solid #e5e7eb", background: "#ffffff",
    color: "#6b7280", fontSize: "12px", cursor: "pointer", fontFamily: "inherit",
  },

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
  removeBtn: {
    display: "inline-flex", alignItems: "center",
    padding: "8px 16px", borderRadius: "6px", border: "1px solid #fecaca",
    background: "#fef2f2", color: "#dc2626", fontSize: "13px",
    cursor: "pointer", fontFamily: "inherit", marginRight: "auto",
  },
  saveBtn: {
    padding: "8px 16px", borderRadius: "6px", border: "none",
    background: "#e94560", color: "#ffffff", fontSize: "13px",
    fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
  },
};

const confirmStyles = {
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 1001, fontFamily: "'Segoe UI', sans-serif",
  },
  box: {
    width: "420px", padding: "28px 30px 22px",
    background: "#ffffff", borderRadius: "14px",
    boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
    display: "flex", flexDirection: "column", alignItems: "stretch",
  },
  title: {
    fontSize: "20px", fontWeight: 700, color: "#1f2937",
    margin: "0", textAlign: "left",
  },
  divider: {
    height: "1px", background: "#e5e7eb", margin: "14px 0 4px",
  },
  text: {
    fontSize: "14px", lineHeight: 1.7, color: "#6b7280",
    textAlign: "left", margin: "8px 0 22px",
  },
  actions: {
    display: "flex", justifyContent: "flex-end", gap: "12px",
  },
  confirmBtn: {
    padding: "8px 20px", borderRadius: "8px", border: "none",
    background: "#e94560", color: "#ffffff", fontSize: "14px",
    fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
  },
  cancelBtn: {
    padding: "8px 20px", borderRadius: "8px", border: "1px solid #d1d5db",
    background: "#ffffff", color: "#374151", fontSize: "14px",
    cursor: "pointer", fontFamily: "inherit",
  },
};
