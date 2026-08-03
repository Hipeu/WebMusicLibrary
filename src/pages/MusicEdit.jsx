import { useState, useEffect, useRef } from "react";
import { FaTimes, FaImage, FaMusic, FaPlus, FaClock, FaCodeBranch, FaCalendarAlt } from "react-icons/fa";

/* ================================================================
   ✏️ MusicEdit — 编辑音乐元信息弹窗
   ================================================================ */
export default function MusicEdit({ target, onClose, onSave }) {
  const [form, setForm] = useState({});
  const [editCover, setEditCover] = useState(null);
  const [activeTab, setActiveTab] = useState("details");
  const coverInputRef = useRef(null);
  const isAlbum = target?.type === "album";
  const data = target?.data;

  useEffect(() => {
    if (!target) return;
    if (isAlbum) {
      setForm({
        title: data.title || "",
        artist: data.artist || "",
        year: data.year ?? "",
        genre: data.genre || "",
        publisher: data.publisher || "",
      });
    } else {
      setForm({
        title: data.title || "",
        artist: data.artist || "",
        album: data.album || "",
        genre: data.genre || "",
        trackNo: data.trackNo ?? "",
        composer: data.composer || "",
        lyricist: data.lyricist || "",
        publisher: data.publisher || "",
        comment: data.comment || "",
      });
    }
  }, [target]);

  if (!target) return null;

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleCoverSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setEditCover(ev.target.result);
    reader.readAsDataURL(file);
  }

  function handleSave() {
    onSave?.(target, form, editCover);
    onClose();
  }

  const tabs = [
    { id: "details", label: "详细信息" },
    { id: "cover", label: "封面" },
    { id: "type", label: "类型" },
  ];

  return (
    <div style={styles.overlay}>
      <div style={styles.dialog} className="music-edit-dialog" onClick={(e) => e.stopPropagation()}>
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
                    <label style={styles.label}>流派</label>
                    <input style={styles.input} value={form.genre || ""} onChange={(e) => handleChange("genre", e.target.value)} />
                  </div>
                  <div style={styles.field}>
                    <label style={styles.label}>音轨号</label>
                    <input style={styles.input} value={form.trackNo} onChange={(e) => handleChange("trackNo", e.target.value)} />
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

          {activeTab === "type" && (
            <div style={styles.typeTab}>
              {!isAlbum && (
                <div style={styles.typeRow}>
                  <span style={styles.typeIcon}><FaCodeBranch size={13} /></span>
                  <span style={styles.typeLabel}>种类</span>
                  <span style={styles.typeValue}>{data?.codec || data?.container || "未知"}</span>
                </div>
              )}
              {!isAlbum && (
                <>
                  <div style={styles.typeRow}>
                    <span style={styles.typeIcon}><FaClock size={13} /></span>
                    <span style={styles.typeLabel}>音乐时长</span>
                    <span style={styles.typeValue}>{data?.duration ? formatDuration(data.duration) : "未知"}</span>
                  </div>
                  <div style={styles.typeRow}>
                    <span style={styles.typeIcon}><FaCodeBranch size={13} /></span>
                    <span style={styles.typeLabel}>码率</span>
                    <span style={styles.typeValue}>{data?.bitrate ? `${Math.round(data.bitrate / 1000)} kbps` : "未知"}</span>
                  </div>
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
                <span style={styles.typeIcon}><FaCalendarAlt size={13} /></span>
                <span style={styles.typeLabel}>添加时间</span>
                <span style={styles.typeValue}>{formatTimestamp(data?.importTime)}</span>
              </div>
              <div style={styles.typeRow}>
                <span style={styles.typeIcon}><FaCalendarAlt size={13} /></span>
                <span style={styles.typeLabel}>修改时间</span>
                <span style={styles.typeValue}>{formatTimestamp(data?.modificationTime || data?.creationTime)}</span>
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div style={styles.footer}>
          <button style={styles.cancelBtn} onClick={onClose}>取消</button>
          <button style={styles.saveBtn} onClick={handleSave}>保存</button>
        </div>
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
    background: "#ffffff", borderRadius: "12px", width: "500px",
    maxHeight: "85vh", display: "flex", flexDirection: "column",
    fontFamily: "'Segoe UI', sans-serif",
    boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
  },

  /* 上半部分 */
  topSection: {
    display: "flex", alignItems: "center", gap: "16px",
    padding: "20px 24px 16px",
    borderBottom: "1px solid #e5e7eb",
  },
  topCover: { width: "64px", height: "64px", borderRadius: "8px", overflow: "hidden", flexShrink: 0 },
  topCoverImg: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  topCoverPlaceholder: {
    width: "100%", height: "100%", display: "flex", alignItems: "center",
    justifyContent: "center", background: "#e5e7eb", color: "#9ca3af",
  },
  topInfo: { minWidth: 0, flex: 1 },
  topTitle: { fontSize: "16px", fontWeight: 700, color: "#1f2937", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  topArtist: { fontSize: "13px", color: "#6b7280", margin: "4px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },

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
  field: { display: "flex", flexDirection: "column", gap: "4px" },
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
  coverPreview: { width: "180px", height: "180px", borderRadius: "10px", overflow: "hidden" },
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
