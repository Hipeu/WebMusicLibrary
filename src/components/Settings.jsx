import { useState } from "react";
import { FaPaintBrush, FaSyncAlt, FaTrashAlt, FaInfoCircle, FaTimes } from "react-icons/fa";

/* ================================================================
   ⚙️ Settings — 设置悬浮窗口
   左侧功能栏 + 右侧内容区
   ================================================================ */
export default function Settings({ show, onClose }) {
  const [active, setActive] = useState("appearance");

  if (!show) return null;

  const menuItems = [
    { id: "appearance", label: "外观设置", icon: <FaPaintBrush /> },
    { id: "sync", label: "同步设置", icon: <FaSyncAlt /> },
    { id: "reset", label: "数据重置", icon: <FaTrashAlt /> },
    { id: "about", label: "关于", icon: <FaInfoCircle /> },
  ];

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.window} className="settings-window" onClick={(e) => e.stopPropagation()}>
        <button style={styles.closeBtn} onClick={onClose} title="关闭">
          <FaTimes size={16} />
        </button>
        {/* 左侧功能栏 */}
        <div style={styles.sidebar}>
          <h2 style={styles.sidebarTitle}>设置</h2>
          {menuItems.map((item) => (
            <div
              key={item.id}
              style={{
                ...styles.sidebarItem,
                ...(active === item.id ? styles.sidebarItemActive : {}),
              }}
              onClick={() => setActive(item.id)}
            >
              <span style={{ ...styles.sidebarIcon, ...(active === item.id ? styles.sidebarIconActive : {}) }}>
                {item.icon}
              </span>
              <span style={{ ...styles.sidebarLabel, ...(active === item.id ? styles.sidebarLabelActive : {}) }}>
                {item.label}
              </span>
            </div>
          ))}
        </div>

        {/* 右侧内容区 */}
        <div style={styles.content}>
          {active === "appearance" && <AppearancePanel />}
          {active === "sync" && <PlaceholderPanel icon={<FaSyncAlt size={40} />} title="同步设置" hint="功能即将上线，敬请期待" />}
          {active === "reset" && <PlaceholderPanel icon={<FaTrashAlt size={40} />} title="数据重置" hint="功能即将上线，敬请期待" />}
          {active === "about" && <AboutPanel />}
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   📦 外观设置面板
   ================================================================ */
function AppearancePanel() {
  const [theme, setTheme] = useState(
    localStorage.getItem("app-theme") || "system"
  );

  function handleChange(value) {
    setTheme(value);
    localStorage.setItem("app-theme", value);
    applyTheme(value);
  }

  const options = [
    { value: "light", label: "浅色模式" },
    { value: "dark", label: "深色模式" },
    { value: "system", label: "跟随系统" },
  ];

  return (
    <div style={panelStyles.container}>
      <h3 style={panelStyles.title}>外观设置</h3>
      <p style={panelStyles.desc}>选择应用的主题模式</p>
      <div style={panelStyles.options}>
        {options.map((opt) => (
          <label
            key={opt.value}
            style={panelStyles.optionRow}
            onClick={() => handleChange(opt.value)}
          >
            <div style={{
              ...panelStyles.radio,
              ...(theme === opt.value ? panelStyles.radioActive : {}),
            }}>
              {theme === opt.value && <div style={panelStyles.radioDot} />}
            </div>
            <span style={panelStyles.optionLabel}>{opt.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/* ================================================================
   📦 关于面板
   ================================================================ */
function AboutPanel() {
  return (
    <div style={panelStyles.container}>
      <h3 style={panelStyles.title}>关于</h3>
      <div style={panelStyles.aboutList}>
        <InfoRow label="应用名称" value="WebMusicPlayer" />
        <InfoRow label="版本号" value="1.0.0" />
        <InfoRow label="作者" value="Hipeu" />
        <InfoRow label="GitHub" value={
          <a
            href="https://github.com/anomalyco/WebMusicPlayer"
            target="_blank"
            rel="noopener noreferrer"
            style={panelStyles.link}
          >
            github.com/anomalyco/WebMusicPlayer
          </a>
        } />
      </div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={panelStyles.infoRow}>
      <span style={panelStyles.infoLabel}>{label}</span>
      <span style={panelStyles.infoValue}>{value}</span>
    </div>
  );
}

/* ================================================================
   📦 占位面板
   ================================================================ */
function PlaceholderPanel({ icon, title, hint }) {
  return (
    <div style={panelStyles.container}>
      <h3 style={panelStyles.title}>{title}</h3>
      <div style={panelStyles.placeholder}>
        <span style={panelStyles.placeholderIcon}>{icon}</span>
        <p style={panelStyles.placeholderText}>{hint}</p>
      </div>
    </div>
  );
}

/* ================================================================
   📦 主题切换辅助
   ================================================================ */
export function applyTheme(theme) {
  const root = document.documentElement;
  let isDark = false;
  if (theme === "dark") {
    isDark = true;
  } else if (theme === "light") {
    isDark = false;
  } else {
    isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  root.setAttribute("data-theme", isDark ? "dark" : "light");
  if (isDark) {
    root.style.setProperty("--bg", "#1a1a2e");
    root.style.setProperty("--bg-secondary", "#23233b");
    root.style.setProperty("--bg-tertiary", "#2c2c4a");
    root.style.setProperty("--text", "#e4e4e7");
    root.style.setProperty("--text-secondary", "#9ca3af");
    root.style.setProperty("--border", "#3a3a5c");
    root.style.setProperty("--card", "#23233b");
  } else {
    root.style.setProperty("--bg", "#ffffff");
    root.style.setProperty("--bg-secondary", "#f9fafb");
    root.style.setProperty("--bg-tertiary", "#f3f4f6");
    root.style.setProperty("--text", "#1f2937");
    root.style.setProperty("--text-secondary", "#6b7280");
    root.style.setProperty("--border", "#e5e7eb");
    root.style.setProperty("--card", "#ffffff");
  }
}

/* ================================================================
   🎨 样式
   ================================================================ */
const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    fontFamily: "'Segoe UI', sans-serif",
    color: "#1f2937",
  },
  window: {
    position: "relative",
    display: "flex",
    width: "760px",
    height: "520px",
    maxWidth: "90vw",
    maxHeight: "85vh",
    background: "#ffffff",
    borderRadius: "14px",
    boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
    overflow: "hidden",
  },
  closeBtn: {
    position: "absolute",
    top: "14px",
    right: "14px",
    zIndex: 10,
    width: "32px",
    height: "32px",
    borderRadius: "50%",
    border: "none",
    background: "#f3f4f6",
    color: "#6b7280",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background 0.15s",
  },
  sidebar: {
    width: "180px",
    flexShrink: 0,
    background: "#f3f4f6",
    borderRight: "1px solid #e5e7eb",
    padding: "20px 10px",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  sidebarTitle: {
    fontSize: "14px",
    fontWeight: 700,
    color: "#374151",
    margin: "0 0 12px 10px",
  },
  sidebarItem: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "9px 12px",
    borderRadius: "8px",
    cursor: "pointer",
    color: "#374151",
    transition: "background 0.15s",
    userSelect: "none",
  },
  sidebarItemActive: {
    background: "rgba(233,69,96,0.12)",
    color: "#e94560",
  },
  sidebarIcon: {
    fontSize: "14px",
    color: "#6b7280",
    flexShrink: 0,
  },
  sidebarIconActive: {
    color: "#e94560",
  },
  sidebarLabel: {
    fontSize: "13px",
    fontWeight: 500,
  },
  sidebarLabelActive: {
    fontWeight: 600,
  },
  content: {
    flex: 1,
    padding: "28px 36px",
    overflowY: "auto",
  },
};

const panelStyles = {
  container: {
    maxWidth: "560px",
  },
  title: {
    fontSize: "20px",
    fontWeight: 700,
    color: "#1f2937",
    margin: "0 0 8px",
  },
  desc: {
    fontSize: "13px",
    color: "#6b7280",
    margin: "0 0 20px",
  },
  options: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  optionRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "10px 14px",
    borderRadius: "8px",
    cursor: "pointer",
    transition: "background 0.15s",
  },
  radio: {
    width: "18px",
    height: "18px",
    borderRadius: "50%",
    border: "2px solid #d1d5db",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "border-color 0.15s",
  },
  radioActive: {
    borderColor: "#e94560",
  },
  radioDot: {
    width: "10px",
    height: "10px",
    borderRadius: "50%",
    background: "#e94560",
  },
  optionLabel: {
    fontSize: "14px",
    color: "#374151",
  },
  aboutList: {
    display: "flex",
    flexDirection: "column",
    border: "1px solid #e5e7eb",
    borderRadius: "10px",
    overflow: "hidden",
  },
  infoRow: {
    display: "flex",
    alignItems: "center",
    padding: "12px 16px",
    borderBottom: "1px solid #f3f4f6",
    fontSize: "13px",
  },
  infoLabel: {
    width: "100px",
    flexShrink: 0,
    color: "#6b7280",
    fontWeight: 500,
  },
  infoValue: {
    color: "#1f2937",
  },
  link: {
    color: "#e94560",
    textDecoration: "none",
  },
  placeholder: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "60px 20px",
    borderRadius: "16px",
    border: "2px dashed #e5e7eb",
    background: "#f9fafb",
    gap: "12px",
    marginTop: "20px",
  },
  placeholderIcon: {
    opacity: 0.3,
    color: "#6b7280",
  },
  placeholderText: {
    fontSize: "14px",
    color: "#6b7280",
    margin: 0,
  },
};
