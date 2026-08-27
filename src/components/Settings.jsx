import { useState, useEffect, useRef } from "react";
import { FaSlidersH, FaLink, FaDatabase, FaInfoCircle, FaTimes, FaPen, FaFileImport, FaRobot, FaPlus, FaPencilAlt, FaTrashAlt, FaChevronRight, FaChevronDown } from "react-icons/fa";
import { SiDeepseek } from "react-icons/si";
import { AiFillOpenAI } from "react-icons/ai";
import { saveSettings, getMigrationStatus, matchAll, cancelMatchAll, startDataExport, startDataImport, inspectDataImport, getSmartProviders, testSmartProvider, saveSmartProvider, toggleSmartProvider, deleteSmartProvider } from "../services/api";

/* ================================================================
   ⚙️ Settings — 设置悬浮窗口
   左侧功能栏 + 右侧内容区
   ================================================================ */
export default function Settings({ show, onClose, onReset, onSettingsSaved, matchState, onOpenMatchDetail, onMatchStarted, onRefreshLibrary, onArtistVisibilityChange, onMatchNothing, onDataJobStarted, onSmartProvidersChanged }) {
  const [active, setActive] = useState("appearance");

  if (!show) return null;

  const menuItems = [
    { id: "appearance", label: "通用设置", icon: <FaSlidersH /> },
    { id: "edit", label: "编辑", icon: <FaPen /> },
    { id: "match", label: "匹配", icon: <FaLink /> },
    { id: "smart", label: "智能", icon: <FaRobot /> },
    { id: "data", label: "数据", icon: <FaDatabase /> },
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

        {/* 右侧内容区（外层留白内缩滚动区，避开右上角 X 与窗口下边） */}
        <div style={styles.contentWrap}>
          <div style={styles.content}>
            {active === "appearance" && <AppearancePanel onSettingsSaved={onSettingsSaved} onRefreshLibrary={onRefreshLibrary} />}
            {active === "edit" && <EditPanel onSettingsSaved={onSettingsSaved} onArtistVisibilityChange={onArtistVisibilityChange} />}
            {active === "match" && <MatchPanel matchState={matchState} onOpenMatchDetail={onOpenMatchDetail} onMatchStarted={onMatchStarted} onSettingsSaved={onSettingsSaved} onMatchNothing={onMatchNothing} />}
            {active === "smart" && <SmartPanel onProvidersChanged={onSmartProvidersChanged} />}
            {active === "data" && <DataPanel onReset={onReset} onDataJobStarted={onDataJobStarted} onSettingsSaved={onSettingsSaved} />}
            {active === "about" && <AboutPanel />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   📦 外观设置面板
   ================================================================ */
function AppearancePanel({ onSettingsSaved, onRefreshLibrary }) {
  const [theme, setTheme] = useState(
    localStorage.getItem("app-theme") || "light"
  );

  function handleChange(value) {
    setTheme(value);
    localStorage.setItem("app-theme", value);
    applyTheme(value);
    onSettingsSaved?.();
  }

  const options = [
    { value: "light", label: "浅色模式" },
    { value: "dark", label: "深色模式" },
    { value: "system", label: "跟随系统" },
  ];

  return (
    <div style={panelStyles.container}>
      <h3 style={panelStyles.title}>通用设置</h3>
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

      <RefreshLibrary onRefreshLibrary={onRefreshLibrary} />
    </div>
  );
}

/* ================================================================
   🔄 更新资料库 — 扫描资料库内所有项目并更新状态
   ================================================================ */
function RefreshLibrary({ onRefreshLibrary }) {
  return (
    <div style={{ marginTop: "28px" }}>
      <h3 style={panelStyles.title}>更新资料库</h3>
      <div style={panelStyles.locationRow}>
        <p style={panelStyles.locationDesc}>扫描资料库内所有项目并更新状态</p>
        <button style={panelStyles.modifyBtn} onClick={() => onRefreshLibrary?.()}>
          更新资料库
        </button>
      </div>
    </div>
  );
}

/* ================================================================
   🎤 艺人设置 — 删除音乐时对空艺人的处理
   ================================================================ */
function ArtistSettings({ onSettingsSaved, onArtistVisibilityChange }) {
  const [keepEmpty, setKeepEmpty] = useState(
    () => localStorage.getItem("artist-keep-empty") !== "false"
  );
  const [hideEmpty, setHideEmpty] = useState(
    () => localStorage.getItem("artist-hide-empty") !== "false"
  );
  const [autoOrganizeCollab, setAutoOrganizeCollab] = useState(
    () => localStorage.getItem("edit-auto-organize-collab") !== "false"
  );

  function handleToggleKeepEmpty() {
    const next = !keepEmpty;
    setKeepEmpty(next);
    localStorage.setItem("artist-keep-empty", String(next));
    onSettingsSaved?.();
  }

  function handleToggleHideEmpty() {
    const next = !hideEmpty;
    setHideEmpty(next);
    localStorage.setItem("artist-hide-empty", String(next));
    onArtistVisibilityChange?.(next);
    onSettingsSaved?.();
  }

  function handleToggleAutoOrganizeCollab() {
    const next = !autoOrganizeCollab;
    setAutoOrganizeCollab(next);
    localStorage.setItem("edit-auto-organize-collab", String(next));
    onSettingsSaved?.();
  }

  return (
    <div style={{ marginTop: "28px" }}>
      <h3 style={panelStyles.title}>艺人设置</h3>
      <div style={panelStyles.toggleRow}>
        <div style={panelStyles.toggleText}>
          <p style={panelStyles.toggleTitle}>删除音乐时保留无音乐的艺人</p>
          <p style={panelStyles.toggleDesc}>开启后，即使某位艺人的音乐被全部删除，该艺人仍会保留在艺人列表中；关闭则自动删除空艺人</p>
        </div>
        <button
          style={{
            ...panelStyles.toggleSwitch,
            ...(keepEmpty ? panelStyles.toggleSwitchOn : {}),
          }}
          onClick={handleToggleKeepEmpty}
          title={keepEmpty ? "点击关闭" : "点击开启"}
        >
          <div
            style={{
              ...panelStyles.toggleKnob,
              ...(keepEmpty ? panelStyles.toggleKnobOn : {}),
            }}
          />
        </button>
      </div>
      <div style={panelStyles.toggleRow}>
        <div style={panelStyles.toggleText}>
          <p style={panelStyles.toggleTitle}>不显示空艺人</p>
          <p style={panelStyles.toggleDesc}>启用后，艺人列表默认隐藏没有歌曲的艺人，不会删除艺人资料</p>
        </div>
        <button
          style={{ ...panelStyles.toggleSwitch, ...(hideEmpty ? panelStyles.toggleSwitchOn : {}) }}
          onClick={handleToggleHideEmpty}
          title={hideEmpty ? "点击关闭" : "点击开启"}
        >
          <div style={{ ...panelStyles.toggleKnob, ...(hideEmpty ? panelStyles.toggleKnobOn : {}) }} />
        </button>
      </div>
      <div style={panelStyles.toggleRow}>
        <div style={panelStyles.toggleText}>
          <p style={panelStyles.toggleTitle}>自动整理合作艺人</p>
          <p style={panelStyles.toggleDesc}>开启后，导入、编辑和匹配写入时把多位艺人统一为「A & B & C」格式</p>
        </div>
        <button
          style={{ ...panelStyles.toggleSwitch, ...(autoOrganizeCollab ? panelStyles.toggleSwitchOn : {}) }}
          onClick={handleToggleAutoOrganizeCollab}
          title={autoOrganizeCollab ? "点击关闭" : "点击开启"}
        >
          <div style={{ ...panelStyles.toggleKnob, ...(autoOrganizeCollab ? panelStyles.toggleKnobOn : {}) }} />
        </button>
      </div>
    </div>
  );
}

/* ================================================================
   ✏️ 编辑设置面板 — 编辑音乐信息时的默认行为
   ================================================================ */
function EditPanel({ onSettingsSaved, onArtistVisibilityChange }) {
  const [publisherCopyright, setPublisherCopyright] = useState(
    () => localStorage.getItem("edit-publisher-copyright") !== "false"
  );
  const [deleteToTrash, setDeleteToTrash] = useState(
    () => localStorage.getItem("delete-to-trash") === "1"
  );
  const [skipUnplayable, setSkipUnplayable] = useState(
    () => localStorage.getItem("import-skip-unplayable") !== "false"
  );

  function handleTogglePublisherCopyright() {
    const next = !publisherCopyright;
    setPublisherCopyright(next);
    localStorage.setItem("edit-publisher-copyright", String(next));
    onSettingsSaved?.();
  }

  function handleToggleDeleteToTrash() {
    const next = !deleteToTrash;
    setDeleteToTrash(next);
    localStorage.setItem("delete-to-trash", next ? "1" : "0");
    onSettingsSaved?.();
  }

  function handleToggleSkipUnplayable() {
    const next = !skipUnplayable;
    setSkipUnplayable(next);
    localStorage.setItem("import-skip-unplayable", String(next));
    onSettingsSaved?.();
  }

  return (
    <div style={panelStyles.container}>
      <h3 style={panelStyles.title}>编辑</h3>
      <p style={panelStyles.desc}>编辑音乐信息时的默认行为</p>
      <div style={{ marginTop: "28px" }}>
        <h3 style={panelStyles.title}>音乐设置</h3>
      <div style={panelStyles.toggleRow}>
        <div style={panelStyles.toggleText}>
          <p style={panelStyles.toggleTitle}>编辑发布者默认携带发布符号和日期</p>
          <p style={panelStyles.toggleDesc}>开启后，编辑歌曲或专辑时若发布者为空，会自动填入「℗ 年份 」前缀</p>
        </div>
        <button
          style={{
            ...panelStyles.toggleSwitch,
            ...(publisherCopyright ? panelStyles.toggleSwitchOn : {}),
          }}
          onClick={handleTogglePublisherCopyright}
          title={publisherCopyright ? "点击关闭" : "点击开启"}
        >
          <div
            style={{
              ...panelStyles.toggleKnob,
              ...(publisherCopyright ? panelStyles.toggleKnobOn : {}),
            }}
          />
        </button>
      </div>
      <div style={panelStyles.toggleRow}>
        <div style={panelStyles.toggleText}>
          <p style={panelStyles.toggleTitle}>删除时移动至项目 trash 文件夹</p>
          <p style={panelStyles.toggleDesc}>开启后，删除的文件将发送到项目下的trash文件夹；关闭则直接删除</p>
        </div>
        <button
          style={{
            ...panelStyles.toggleSwitch,
            ...(deleteToTrash ? panelStyles.toggleSwitchOn : {}),
          }}
          onClick={handleToggleDeleteToTrash}
          title={deleteToTrash ? "点击关闭" : "点击开启"}
        >
          <div
            style={{
              ...panelStyles.toggleKnob,
              ...(deleteToTrash ? panelStyles.toggleKnobOn : {}),
            }}
          />
        </button>
      </div>
      <div style={panelStyles.toggleRow}>
        <div style={panelStyles.toggleText}>
          <p style={panelStyles.toggleTitle}>导入不支持播放的格式时跳过导入</p>
          <p style={panelStyles.toggleDesc}>开启后，导入时会自动跳过浏览器无法播放的格式（如 ALAC / APE 等）</p>
        </div>
        <button
          style={{ ...panelStyles.toggleSwitch, ...(skipUnplayable ? panelStyles.toggleSwitchOn : {}) }}
          onClick={handleToggleSkipUnplayable}
          title={skipUnplayable ? "点击关闭" : "点击开启"}
        >
          <div style={{ ...panelStyles.toggleKnob, ...(skipUnplayable ? panelStyles.toggleKnobOn : {}) }} />
        </button>
      </div>
      </div>
      <ArtistSettings onSettingsSaved={onSettingsSaved} onArtistVisibilityChange={onArtistVisibilityChange} />
    </div>
  );
}

/* ================================================================
   🎯 匹配设置面板 — 元信息字段 / 匹配源 / 全部匹配配置
   ================================================================ */
const MATCH_FIELDS = [
  ["title", "标题"], ["artist", "艺术家"], ["album", "专辑"], ["year", "年份"],
  ["track_disc", "音轨号/碟号"], ["genre", "风格（流派）"], ["album_artist", "专辑艺术家"],
  ["description", "专辑简介"],
  ["composer", "作曲家"], ["lyricist", "作词家"], ["lyric", "歌词"],
  ["publisher", "发布者"], ["arranger", "编曲"], ["producer", "制作人"],
];
const MATCH_SOURCES = [
  ["qq", "QQ音乐"], ["netease", "网易云音乐"], ["itunes", "iTunes"], ["musicbrainz", "MusicBrainz"],
];

/* ================================================================
   🤖 智能设置 — 本机后端保存 API Key，不参与数据备份
   ================================================================ */
function SmartPanel({ onProvidersChanged }) {
  const [providers, setProviders] = useState([]);
  const [editor, setEditor] = useState(null);
  const [isAdding, setIsAdding] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState([]);
  const [model, setModel] = useState("");
  const [webSearch, setWebSearch] = useState(false);
  const [outputLength, setOutputLength] = useState("medium");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [tested, setTested] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");

  const names = { openai: "ChatGPT", deepseek: "DeepSeek" };
  const refresh = async () => {
    try {
      const next = (await getSmartProviders()).providers || [];
      setProviders(next);
      onProvidersChanged?.(next);
    } catch { setMessage("无法读取智能供应商配置"); }
  };
  // 供应商列表仅在智能设置面板挂载时读取一次；保存、删除、开关后会显式 refresh。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { const timer = setTimeout(refresh, 0); return () => clearTimeout(timer); }, []);
  const openEditor = (kind) => {
    const found = providers.find((item) => item.id === kind);
    setIsAdding(false); setEditor(kind); setApiKey(""); setModels([]); setModel(found?.model || ""); setWebSearch(Boolean(found?.web_search)); setOutputLength(found?.output_length || "medium"); setAdvancedOpen(false); setMessage(""); setTested(false);
  };
  const startAdding = () => {
    setIsAdding(true); setEditor("openai"); setApiKey(""); setModels([]); setModel(""); setWebSearch(false); setOutputLength("medium"); setAdvancedOpen(false); setMessage(""); setTested(false);
  };
  const selectAddingProvider = (kind) => {
    setEditor(kind); setModels([]); setModel(""); setWebSearch(false); setTested(false); setMessage("");
  };
  useEffect(() => {
    const key = apiKey.trim();
    if (!editor || !key) return undefined;
    let stale = false;
    const timer = setTimeout(async () => {
      setTesting(true); setMessage("正在拉取可用模型…");
      try {
        const result = await testSmartProvider({ provider: editor, api_key: key });
        if (stale) return;
        const nextModels = result.models || [];
        setModels(nextModels);
        setTested(false);
        setMessage(nextModels.length ? "已拉取可用模型" : "该 API Key 未返回可用模型");
      } catch {
        if (!stale) { setModels([]); setTested(false); setMessage("模型拉取失败，请检查 API Key 和网络"); }
      } finally { if (!stale) setTesting(false); }
    }, 600);
    return () => { stale = true; clearTimeout(timer); };
  }, [apiKey, editor]);
  const save = async () => {
    if (isAdding && !apiKey.trim()) { setMessage("请输入 API Key"); return; }
    if (isAdding && (!tested || !model)) { setMessage("请先等待模型拉取完成并选择模型"); return; }
    if (!isAdding && apiKey.trim() && (!tested || !model)) { setMessage("请等待模型拉取完成并选择模型"); return; }
    if (!model) { setMessage("当前服务尚未选择模型"); return; }
    try {
      const existing = providers.find((item) => item.id === editor);
      await saveSmartProvider(editor, { api_key: apiKey, model, connected: true, enabled: isAdding || existing?.enabled, make_default: isAdding || !providers.some((item) => item.is_default), web_search: webSearch, output_length: outputLength });
      setEditor(null); setIsAdding(false); await refresh();
    } catch { setMessage("保存失败"); }
  };

  return <div style={panelStyles.container}>
    <h3 style={panelStyles.title}>智能</h3>
    <p style={panelStyles.desc}>连接 AI 服务以生成歌单、简介和元信息建议。</p>
    <p style={panelStyles.desc}>使用对应服务即你同意相应服务商条款。</p>
    <button style={smartStyles.addBtn} onClick={startAdding}><FaPlus size={12} /> 添加</button>
    <div style={smartStyles.providerList}>
      {providers.map((item) => <div key={item.id} style={smartStyles.providerRow}>
        {item.id === "deepseek" ? <SiDeepseek size={19} color="#4d6bfe" /> : <AiFillOpenAI size={19} color="#10a37f" />}
        <span style={smartStyles.providerName}>{item.name}</span>
        <span style={smartStyles.modelName}>{item.model || "未选择模型"}</span>
        <button style={smartStyles.iconBtn} onClick={() => openEditor(item.id)} title="编辑"><FaPencilAlt size={12} /></button>
        <span style={{ ...smartStyles.status, color: item.connected ? "#16a34a" : "#dc2626" }}>● {item.connected ? "已连接" : "已断开"}</span>
        <button aria-label={`切换 ${item.name}`} title={item.enabled ? "停用智能服务" : "启用智能服务"} style={{ ...panelStyles.toggleSwitch, ...(item.enabled ? panelStyles.toggleSwitchOn : {}) }} onClick={async () => { await toggleSmartProvider(item.id, !item.enabled); refresh(); }}><span style={{ ...panelStyles.toggleKnob, ...(item.enabled ? panelStyles.toggleKnobOn : {}) }} /></button>
      </div>)}
    </div>
    {(editor || isAdding) && <div style={resetDialogStyles.overlay} onClick={() => { setEditor(null); setIsAdding(false); }}><div style={resetDialogStyles.box} onClick={(e) => e.stopPropagation()}>
      <h3 style={resetDialogStyles.title}>{isAdding ? "添加智能服务" : `编辑 ${names[editor]}`}</h3><div style={resetDialogStyles.divider} />
      <>
      {isAdding && <><label style={smartStyles.fieldLabel}>选择供应商</label><div style={smartStyles.providerSelectWrap}>{editor === "deepseek" ? <SiDeepseek style={smartStyles.providerSelectIcon} size={19} color="#4d6bfe" /> : <AiFillOpenAI style={smartStyles.providerSelectIcon} size={19} color="#10a37f" />}<select style={smartStyles.providerSelect} value={editor} onChange={(e) => selectAddingProvider(e.target.value)}><option value="openai">ChatGPT</option><option value="deepseek">DeepSeek</option></select></div></>}
      <label style={smartStyles.fieldLabel}>API Key</label><input type="password" style={dataStyles.confirmInput} value={apiKey} onChange={(e) => { setApiKey(e.target.value); setModels([]); setTested(false); }} placeholder="输入 API Key" />
      <label style={smartStyles.fieldLabel}>模型{testing ? "（正在拉取…）" : ""}</label>
      <select style={dataStyles.confirmInput} value={model} disabled={!models.length} onChange={(e) => { setModel(e.target.value); setTested(true); }}><option value="">{models.length ? "请选择模型" : "请先输入 API Key 并自动拉取模型"}</option>{model && !models.includes(model) && <option value={model}>{model}</option>}{models.map((item) => <option key={item} value={item}>{item}</option>)}</select>
      <button type="button" style={smartStyles.advancedToggle} onClick={() => setAdvancedOpen((value) => !value)}>高级 {advancedOpen ? <FaChevronDown size={11} /> : <FaChevronRight size={11} />}</button>
      {advancedOpen && <div style={smartStyles.advancedPanel}>
        {editor === "deepseek" && model === "deepseek-v4-flash" && <div style={smartStyles.advancedRow}><div><div style={smartStyles.advancedTitle}>联网搜索</div><div style={smartStyles.advancedHint}>启用后模型将基于网络资料进行输出</div></div><button aria-label="切换联网搜索" style={{ ...panelStyles.toggleSwitch, ...(webSearch ? panelStyles.toggleSwitchOn : {}) }} onClick={() => setWebSearch((value) => !value)}><span style={{ ...panelStyles.toggleKnob, ...(webSearch ? panelStyles.toggleKnobOn : {}) }} /></button></div>}
        <div style={smartStyles.lengthRow}><div><div style={smartStyles.advancedTitle}>输出内容长度</div><div style={smartStyles.advancedHint}>用于控制播放列表简介的文字输出量</div></div><div style={smartStyles.lengthButtons}>{[["short", "简洁"], ["medium", "适中"], ["long", "较长"]].map(([value, label]) => <button key={value} style={{ ...smartStyles.lengthBtn, ...(outputLength === value ? smartStyles.lengthBtnActive : {}) }} onClick={() => setOutputLength(value)}>{label}</button>)}</div></div>
      </div>}
        {message && <p style={dataStyles.hint}>{message}</p>}
        <div style={{ ...resetDialogStyles.actions, marginTop: "20px" }}><button style={smartStyles.deleteBtn} onClick={async () => { if (!isAdding) await deleteSmartProvider(editor); setEditor(null); setIsAdding(false); refresh(); }}><FaTrashAlt /> 移除</button><span style={{ flex: 1 }} /><button style={resetDialogStyles.cancelBtn} onClick={() => { setEditor(null); setIsAdding(false); }}>取消</button><button style={resetDialogStyles.confirmBtn} onClick={save}>保存</button></div>
      </>
    </div></div>}
  </div>;
}

function MatchPanel({ matchState, onOpenMatchDetail, onMatchStarted, onSettingsSaved, onMatchNothing }) {
  // 元信息字段开关（localStorage 持久化，默认全开）
  const [fields, setFields] = useState(() => {
    const o = {};
    MATCH_FIELDS.forEach(([k]) => { o[k] = localStorage.getItem(`match-field-${k}`) !== "0"; });
    return o;
  });
  // 匹配源开关（localStorage 持久化，默认全开，可单一/混合）
  const [sources, setSources] = useState(() => {
    const o = {};
    MATCH_SOURCES.forEach(([k]) => { o[k] = localStorage.getItem(`match-source-${k}`) !== "0"; });
    return o;
  });
  const [skipMatched, setSkipMatched] = useState(
    () => localStorage.getItem("match-skip-matched") !== "0"
  );
  const [lyricFallback, setLyricFallback] = useState(
    () => localStorage.getItem("match-lyric-fallback") === "1"
  );
  const [matchOverwrite, setMatchOverwrite] = useState(
    () => localStorage.getItem("match-overwrite") === "1"
  );
  const [matchRate, setMatchRate] = useState(
    () => localStorage.getItem("match-rate") || "normal" // "fast" | "normal" | "slow"
  );
  // 艺人匹配源联动：标记“艺术家”字段是否因 QQ/网易源都未选而被自动关闭
  const artistAutoOffRef = useRef(false);

  // 匹配状态由 Library 统一轮询驱动
  const running = !!matchState?.running;
  const progress = {
    done: matchState?.done || 0,
    total: matchState?.total || 0,
    matched: matchState?.matched || 0,
    failed: matchState?.failed || 0,
    skipped: matchState?.skipped || 0,
  };
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");

  function toggleField(k) {
    // 艺术家字段依赖 QQ/网易源，两者都未选时禁止开启
    if (k === "artist" && sources.qq === false && sources.netease === false) return;
    const next = !fields[k];
    setFields((prev) => ({ ...prev, [k]: next }));
    localStorage.setItem(`match-field-${k}`, next ? "1" : "0");
    onSettingsSaved?.();
  }

  function toggleSource(k) {
    const next = !sources[k];
    const nextSources = { ...sources, [k]: next };
    setSources(nextSources);
    localStorage.setItem(`match-source-${k}`, next ? "1" : "0");
    // 艺人匹配源联动：QQ 与网易云都未选 → 自动关闭“艺术家”字段；重新勾选则自动恢复
    const qqOn = nextSources.qq !== false;
    const neteaseOn = nextSources.netease !== false;
    if (!qqOn && !neteaseOn) {
      if (fields.artist) {
        artistAutoOffRef.current = true;
        setFields((prev) => ({ ...prev, artist: false }));
        localStorage.setItem("match-field-artist", "0");
      }
    } else if (artistAutoOffRef.current) {
      artistAutoOffRef.current = false;
      if (!fields.artist) {
        setFields((prev) => ({ ...prev, artist: true }));
        localStorage.setItem("match-field-artist", "1");
      }
    }
    onSettingsSaved?.();
  }

  function toggleSkipMatched() {
    const next = !skipMatched;
    setSkipMatched(next);
    localStorage.setItem("match-skip-matched", next ? "1" : "0");
    onSettingsSaved?.();
  }

  function toggleLyricFallback() {
    const next = !lyricFallback;
    setLyricFallback(next);
    localStorage.setItem("match-lyric-fallback", next ? "1" : "0");
    onSettingsSaved?.();
  }

  function toggleOverwrite() {
    const next = !matchOverwrite;
    setMatchOverwrite(next);
    localStorage.setItem("match-overwrite", next ? "1" : "0");
    onSettingsSaved?.();
  }

  function setRate(k) {
    setMatchRate(k);
    localStorage.setItem("match-rate", k);
    onSettingsSaved?.();
  }

  async function handleCancelMatch() {
    if (!running) return;
    setCancelling(true);
    try {
      await cancelMatchAll();
    } catch {
      setCancelling(false);
      setError("取消失败，请重试");
    }
  }

  async function handleStartMatch() {
    if (running) return;
    setError("");
    try {
      const res = await matchAll({
        match_song: true,
        sources,
        fields,
        skip_matched: skipMatched,
        lyric_credits_fallback: lyricFallback,
        overwrite: matchOverwrite,
        auto_organize_collab: localStorage.getItem("edit-auto-organize-collab") !== "false",
      });      if (res && res.status === "error") {
        setError(res.msg || "启动匹配失败");
        return;
      }
      if (res && res.status === "done") {
        onMatchNothing?.();
        return;
      }
      if (res && res.status === "started") {
        // 通知 Library 启动按需轮询
        onMatchStarted?.();
      }
      // 进行中/已完成状态由 Library 轮询驱动
    } catch {
      setError("启动匹配失败，请确认后端已启动");
    }
  }

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const hasLog = (matchState?.log && matchState.log.length > 0) || progress.total > 0;

  return (
    <div style={matchStyles.container}>
      <h3 style={panelStyles.title}>匹配</h3>
      <p style={panelStyles.desc}>通过在线源拉取歌曲与艺人信息，并自动写回音乐文件</p>

      {/* 全部匹配（置顶） */}
      <div style={matchStyles.matchBox}>
        <p style={matchStyles.configTitle}>全部匹配</p>
        <p style={matchStyles.matchDesc}>
          为资料库中缺少信息的歌曲补全所选字段，并为艺人补写真。件内已存在的信息不会被覆盖
        </p>

        <div style={matchStyles.matchHeader}>
          <button style={matchStyles.startBtn} onClick={handleStartMatch} disabled={running}>
            {running ? "匹配中…" : "开始匹配"}
          </button>
          {running && (
            <button
              style={matchStyles.cancelBtn}
              onClick={handleCancelMatch}
              disabled={cancelling}
            >
              {cancelling ? "取消中…" : "取消"}
            </button>
          )}
          {error && <span style={matchStyles.error}>{error}</span>}
        </div>

        {progress.total > 0 && (
          <div style={matchStyles.progressWrap}>
            <div style={matchStyles.countRow}>
              <span style={matchStyles.count}>已完成：{progress.done}/{progress.total}</span>
              <span style={matchStyles.pct}>{pct}%</span>
            </div>
            <div style={matchStyles.track}>
              <div style={{ ...matchStyles.fill, width: `${pct}%` }} />
            </div>
            <div style={matchStyles.statsRow}>
              <span style={matchStyles.statOk}>成功 {progress.matched}</span>
              <span style={matchStyles.statFail}>失败 {progress.failed}</span>
              <span style={matchStyles.statSkip}>跳过 {progress.skipped}</span>
            </div>
          </div>
        )}

        {hasLog && (
          <div style={matchStyles.detailRow}>
            <span style={matchStyles.detailHint}>查看本次匹配的详细结果</span>
            <button style={matchStyles.detailBtn} onClick={onOpenMatchDetail}>
              查看详情
            </button>
          </div>
        )}
      </div>

      {/* 匹配字段 + 匹配源 */}
      <div style={matchStyles.configBox}>
        <p style={matchStyles.configTitle}>匹配字段</p>
        <p style={matchStyles.fieldHint}>勾选“艺术家”同时匹配歌曲艺人、艺人写真与艺人简介</p>
        <div style={matchStyles.fieldGrid}>
          {MATCH_FIELDS.map(([k, label]) => {
            const artistDisabled = k === "artist" && sources.qq === false && sources.netease === false;
            return (
              <div key={k} style={matchStyles.fieldChip}>
                <button
                  disabled={artistDisabled}
                  style={{
                    ...matchStyles.miniSwitch,
                    ...(fields[k] ? matchStyles.miniSwitchOn : {}),
                    ...(artistDisabled ? matchStyles.miniSwitchDisabled : {}),
                  }}
                  onClick={() => toggleField(k)}
                  title={artistDisabled ? "请先选择 QQ 或网易云源" : (fields[k] ? "点击关闭" : "点击开启")}
                >
                  <div
                    style={{
                      ...matchStyles.miniKnob,
                      ...(fields[k] ? matchStyles.miniKnobOn : {}),
                    }}
                  />
                </button>
                <span style={{ ...matchStyles.fieldChipLabel, ...(artistDisabled ? matchStyles.fieldChipLabelDisabled : {}) }}>{label}</span>
              </div>
            );
          })}
        </div>

        <p style={{ ...matchStyles.configTitle, marginTop: "16px" }}>匹配源（可多选）</p>
        <div style={matchStyles.sourceRow}>
          {MATCH_SOURCES.map(([k, label]) => (
            <button
              key={k}
              style={{
                ...matchStyles.sourceChip,
                ...(sources[k] ? matchStyles.sourceChipOn : {}),
              }}
              onClick={() => toggleSource(k)}
            >
              {label}
            </button>
          ))}
        </div>
        {sources.musicbrainz && (
          <p style={matchStyles.sourceWarn}>⚠ 该源请求速率较慢可能延长匹配时间</p>
        )}
        {sources.qq === false && sources.netease === false && (
          <p style={matchStyles.sourceWarn}>⚠ 艺人匹配将跳过</p>
        )}
      </div>

      {/* 功能设置 */}
      <div style={matchStyles.configBox}>
        <p style={matchStyles.configTitle}>功能设置</p>

        <div style={matchStyles.toggleRow}>
          <div style={matchStyles.toggleText}>
            <p style={matchStyles.toggleTitle}>跳过已匹配的音乐</p>
            <p style={matchStyles.toggleDesc}>已匹配音乐不再参与匹配</p>
          </div>
          <button
            style={{
              ...panelStyles.toggleSwitch,
              ...(skipMatched ? panelStyles.toggleSwitchOn : {}),
            }}
            onClick={toggleSkipMatched}
            title={skipMatched ? "点击关闭" : "点击开启"}
          >
            <div
              style={{
                ...panelStyles.toggleKnob,
                ...(skipMatched ? panelStyles.toggleKnobOn : {}),
              }}
            />
          </button>
        </div>

        <div style={matchStyles.toggleRow}>
          <div style={matchStyles.toggleText}>
            <p style={matchStyles.toggleTitle}>通过歌词寻找作曲者、作词者和发布者信息</p>
            <p style={matchStyles.toggleDesc}>匹配源无法获取上述信息时通过LRC获取</p>
          </div>
          <button
            style={{
              ...panelStyles.toggleSwitch,
              ...(lyricFallback ? panelStyles.toggleSwitchOn : {}),
            }}
            onClick={toggleLyricFallback}
            title={lyricFallback ? "点击关闭" : "点击开启"}
          >
            <div
              style={{
                ...panelStyles.toggleKnob,
                ...(lyricFallback ? panelStyles.toggleKnobOn : {}),
              }}
            />
          </button>
        </div>

        <div style={matchStyles.toggleRow}>
          <div style={matchStyles.toggleText}>
            <p style={matchStyles.toggleTitle}>覆盖原音乐文件的信息</p>
            <p style={matchStyles.toggleDesc}>启用后完整覆盖音乐文件内已有标签；关闭则仅填空缺</p>
          </div>
          <button
            style={{
              ...panelStyles.toggleSwitch,
              ...(matchOverwrite ? panelStyles.toggleSwitchOn : {}),
            }}
            onClick={toggleOverwrite}
            title={matchOverwrite ? "点击关闭" : "点击开启"}
          >
            <div
              style={{
                ...panelStyles.toggleKnob,
                ...(matchOverwrite ? panelStyles.toggleKnobOn : {}),
              }}
            />
          </button>
        </div>

        {/* 匹配速率 */}
        <div style={matchStyles.toggleRow}>
          <div style={matchStyles.toggleText}>
            <p style={matchStyles.toggleTitle}>匹配速率</p>
            <p style={matchStyles.toggleDesc}>调整匹配速度，较快的速率可能导致被风控</p>
          </div>
          <div style={matchStyles.rateSegments}>
            {[["fast", "快速"], ["normal", "标准"], ["slow", "低速"]].map(([k, label]) => (
              <button
                key={k}
                style={{ ...matchStyles.rateSegment, ...(matchRate === k ? matchStyles.rateSegmentOn : {}) }}
                onClick={() => setRate(k)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   📂 导入设置 — 修改资料库位置
   ================================================================ */
function ImportSettings({ onSettingsSaved }) {
  const [showDialog, setShowDialog] = useState(false);
  const [pathInput, setPathInput] = useState("");
  const [error, setError] = useState("");
  const [migrating, setMigrating] = useState(false);
  const [migProgress, setMigProgress] = useState({ done: 0, total: 0 });
  async function handleConfirm() {
    const p = pathInput.trim();
    if (!p) {
      setError("请输入完整绝对路径");
      return;
    }
    const isAbs = /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("/");
    if (!isAbs) {
      setError("请输入完整绝对路径（如 D:\\Music\\Music_Library）");
      return;
    }
    const res = await saveSettings(p);
    if (res && res.status === "error") {
      setError(res.msg || "保存失败");
      return;
    }
    if (res && res.status === "ok") {
      // 兼容：极快完成
      onSettingsSaved?.();
      return;
    }
    // 开始迁移 → 关闭输入框，显示迁移进度
    setShowDialog(false);
    setPathInput("");
    setError("");
    setMigProgress({ done: 0, total: (res && res.total) || 0 });
    setMigrating(true);
  }

  // 轮询迁移进度
  useEffect(() => {
    if (!migrating) return;
    const timer = setInterval(async () => {
      try {
        const res = await getMigrationStatus();
        if (res.status === "migrating") {
          setMigProgress({ done: res.done || 0, total: res.total || 0 });
        } else if (res.status === "done") {
          setMigProgress({ done: res.total || 0, total: res.total || 0 });
          setMigrating(false);
          onSettingsSaved?.();
        } else if (res.status === "error") {
          setMigrating(false);
          setError(res.msg || "迁移失败");
        }
      } catch {
        setMigrating(false);
        setError("获取迁移状态失败");
      }
    }, 500);
    return () => clearInterval(timer);
  }, [migrating, onSettingsSaved]);

  const migPct = migProgress.total > 0 ? Math.round((migProgress.done / migProgress.total) * 100) : 0;

  return (
    <>
      <div style={{ marginTop: "28px" }}>
            <h3 style={panelStyles.title}>资料库位置</h3>
        <div style={panelStyles.locationRow}>
          <p style={panelStyles.locationDesc}>修改音乐资料库的存放位置</p>
          <button style={panelStyles.modifyBtn} onClick={() => setShowDialog(true)}>
            修改
          </button>
        </div>
      </div>

      {showDialog && (
        <div style={dialogStyles.overlay} onClick={() => setShowDialog(false)}>
          <div style={dialogStyles.box} onClick={(e) => e.stopPropagation()}>
            <h3 style={dialogStyles.title}>修改资料库位置</h3>
            <div style={dialogStyles.divider} />
            <p style={dialogStyles.hint}>请输入资料库的完整绝对路径（如 D:\Music\Music_Library）</p>
            <input
              style={dialogStyles.input}
              value={pathInput}
              onChange={(e) => { setPathInput(e.target.value); setError(""); }}
              placeholder="例如 D:\Music\Music_Library"
              autoFocus
              spellCheck={false}
            />
            {error && <p style={dialogStyles.error}>{error}</p>}
            <div style={dialogStyles.actions}>
              <button style={dialogStyles.confirmBtn} onClick={handleConfirm}>确认</button>
              <button style={dialogStyles.cancelBtn} onClick={() => setShowDialog(false)}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 迁移进度对话框（不允许取消） */}
      {migrating && (
        <div style={migrateDialogStyles.overlay}>
          <div style={migrateDialogStyles.box} onClick={(e) => e.stopPropagation()}>
            <div style={migrateDialogStyles.body}>
              <h3 style={migrateDialogStyles.title}>正在迁移资料库</h3>
              <div style={migrateDialogStyles.divider} />
              <p style={migrateDialogStyles.warn}>迁移完成前请不要关闭窗口</p>
              <div style={migrateDialogStyles.countRow}>
                <span style={migrateDialogStyles.count}>
                  已迁移：{migProgress.done}/{migProgress.total}
                </span>
                <span style={migrateDialogStyles.pct}>{migPct}%</span>
              </div>
            </div>
            <div style={migrateDialogStyles.track}>
              <div style={{ ...migrateDialogStyles.fill, width: `${migPct}%` }} />
            </div>
          </div>
        </div>
      )}
    </>
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
   🗑️ 重置面板
   ================================================================ */
function DataPanel({ onReset, onDataJobStarted, onSettingsSaved }) {
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [importFile, setImportFile] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [mode, setMode] = useState("merge");
  const [keepBackup, setKeepBackup] = useState(true);
  const [error, setError] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [importToken, setImportToken] = useState(null);
  const [availableTypes, setAvailableTypes] = useState([]);
  const [importTypes, setImportTypes] = useState([]);
  const [exportTypes, setExportTypes] = useState(["artists", "albums", "playlists", "settings", "music"]);
  const importInputRef = useRef(null);

  const typeOptions = [
    ["artists", "艺人信息"], ["albums", "专辑信息"], ["playlists", "播放列表"],
    ["settings", "设置"], ["music", "音乐文件"],
  ];

  function toggleType(value, setter) {
    setter((prev) => prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]);
  }

  async function handleExport() {
    if (exportTypes.length === 0) return;
    setError("");
    try {
      const result = await startDataExport(exportTypes);
      if (result?.job_id) {
        setExportOpen(false);
        onDataJobStarted?.({ kind: "export", jobId: result.job_id });
      } else setError(result?.detail || "无法启动导出");
    } catch {
      setError("无法启动导出，请确认后端正在运行");
    }
  }

  async function handleImportFile(file) {
    setImportFile(file || null);
    setImportToken(null);
    setAvailableTypes([]);
    setImportTypes([]);
    if (!file) return;
    setInspecting(true);
    setError("");
    try {
      const result = await inspectDataImport(file);
      if (result?.status === "ok") {
        setImportToken(result.token);
        setAvailableTypes(result.types || []);
        setImportTypes(result.types || []);
      } else setError(result?.detail || "无法读取该备份包");
    } catch {
      setError("无法读取该备份包");
    } finally {
      setInspecting(false);
    }
  }

  async function handleImport() {
    if (!importToken || importTypes.length === 0) return;
    setError("");
    try {
      const result = await startDataImport(importToken, mode, keepBackup, importTypes);
      if (result?.job_id) {
        setImportOpen(false);
        setImportFile(null);
        setImportToken(null);
        onDataJobStarted?.({ kind: "import", jobId: result.job_id });
      } else setError(result?.detail || "无法启动导入");
    } catch {
      setError("无法启动导入，请确认备份包有效且后端正在运行");
    }
  }

  return (
    <>
      <div style={panelStyles.container}>
        <h3 style={panelStyles.title}>数据</h3>
        <p style={panelStyles.desc}>管理资料库的备份、恢复与存放位置</p>
        <div style={{ marginTop: "28px" }}>
          <h3 style={panelStyles.title}>备份和恢复</h3>
        <div style={panelStyles.locationRow}>
          <p style={panelStyles.locationDesc}>导出音乐、封面、歌词、艺人、简介、播放列表及应用设置为 ZIP 备份包</p>
          <button style={panelStyles.modifyBtn} onClick={() => { setError(""); setExportOpen(true); }}>导出数据</button>
        </div>
        <div style={{ ...panelStyles.locationRow, marginTop: "14px" }}>
          <p style={panelStyles.locationDesc}>从 WebMusicPlayer ZIP 备份包恢复数据</p>
          <button style={panelStyles.modifyBtn} onClick={() => {
            setError(""); setImportFile(null); setImportToken(null);
            setAvailableTypes([]); setImportTypes([]); setImportOpen(true);
          }}>导入数据</button>
        </div>
        <div style={{ ...panelStyles.resetBox, marginTop: "14px" }}>
          <p style={panelStyles.resetDesc}>重置会删除资料库中的音乐、封面、歌词、艺人、简介和播放列表数据</p>
          <div style={panelStyles.resetBtnWrap}>
            <button style={panelStyles.resetBtn} onClick={() => setConfirming(true)}>
              重置
            </button>
          </div>
        </div>
        </div>
        <ImportSettings onSettingsSaved={onSettingsSaved} />
      </div>

      {confirming && (
        <div style={resetDialogStyles.overlay} onClick={() => setConfirming(false)}>
          <div style={resetDialogStyles.box} onClick={(e) => e.stopPropagation()}>
            <h3 style={resetDialogStyles.title}>确认重置数据</h3>
            <div style={resetDialogStyles.divider} />
            <p style={resetDialogStyles.text}>这会删除所有资料库数据，且无法恢复。请输入「是，我确认」继续。</p>
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="是，我确认" style={dataStyles.confirmInput} />
            <div style={{ ...resetDialogStyles.actions, marginTop: "18px" }}>
              <button
                style={resetDialogStyles.confirmBtn}
                disabled={confirmText.trim() !== "是，我确认"}
                onClick={() => {
                  setConfirming(false);
                  setConfirmText("");
                  onReset?.();
                }}
              >
                确认
              </button>
              <button style={resetDialogStyles.cancelBtn} onClick={() => setConfirming(false)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}
      {exportOpen && (
        <div style={resetDialogStyles.overlay} onClick={() => setExportOpen(false)}>
          <div style={resetDialogStyles.box} onClick={(e) => e.stopPropagation()}>
            <h3 style={resetDialogStyles.title}>选择导出数据</h3>
            <div style={resetDialogStyles.divider} />
            <div style={dataStyles.typeList}>{typeOptions.map(([value, label]) => {
              const checked = exportTypes.includes(value);
              return <label key={value} style={{ ...dataStyles.typeRow, ...(checked ? dataStyles.typeRowActive : {}) }}>
                <input type="checkbox" checked={checked} onChange={() => toggleType(value, setExportTypes)} style={dataStyles.nativeCheck} />
                <span style={{ ...dataStyles.typeCheck, ...(checked ? dataStyles.typeCheckActive : {}) }}>{checked ? "✓" : ""}</span>
                <span>{label}</span>
              </label>;
            })}</div>
            {error && <p style={dataStyles.error}>{error}</p>}
            <div style={{ ...resetDialogStyles.actions, marginTop: "24px" }}>
              <button style={resetDialogStyles.confirmBtn} disabled={exportTypes.length === 0} onClick={handleExport}>开始导出</button>
              <button style={resetDialogStyles.cancelBtn} onClick={() => setExportOpen(false)}>取消</button>
            </div>
          </div>
        </div>
      )}
      {importOpen && (
        <div style={resetDialogStyles.overlay} onClick={() => setImportOpen(false)}>
          <div style={resetDialogStyles.box} onClick={(e) => e.stopPropagation()}>
            <h3 style={resetDialogStyles.title}>导入数据</h3>
            <div style={resetDialogStyles.divider} />
            <div style={dataStyles.fileRow}>
              <button style={dataStyles.fileBtn} onClick={() => importInputRef.current?.click()}>
                <FaFileImport size={13} style={{ marginRight: 6 }} /> 浏览备份包
              </button>
              <span style={dataStyles.fileName}>{importFile?.name || "尚未选择 ZIP 文件"}</span>
              <input ref={importInputRef} type="file" accept=".zip,application/zip" style={{ display: "none" }} onChange={(e) => handleImportFile(e.target.files?.[0] || null)} />
            </div>
            {inspecting && <p style={dataStyles.hint}>正在读取备份包内容…</p>}
            {availableTypes.length > 0 && <>
              <p style={dataStyles.sectionLabel}>选择要恢复的数据</p>
              <div style={dataStyles.typeList}>{typeOptions.filter(([value]) => availableTypes.includes(value)).map(([value, label]) => {
                const checked = importTypes.includes(value);
                return <label key={value} style={{ ...dataStyles.typeRow, ...(checked ? dataStyles.typeRowActive : {}) }}>
                  <input type="checkbox" checked={checked} onChange={() => toggleType(value, setImportTypes)} style={dataStyles.nativeCheck} />
                  <span style={{ ...dataStyles.typeCheck, ...(checked ? dataStyles.typeCheckActive : {}) }}>{checked ? "✓" : ""}</span>
                  <span>{label}</span>
                </label>;
              })}</div>
            </>}
            <p style={dataStyles.sectionLabel}>选择导入方式</p>
            <div style={dataStyles.typeList}>
              {[
                ["merge", "合并导入", "重复音乐跳过，同名不同内容自动重命名"],
                ["replace", "覆盖恢复", "替换现有资料数据，保留本机资料库路径"],
              ].map(([value, title, description]) => {
                const checked = mode === value;
                return <label key={value} style={{ ...dataStyles.typeRow, ...dataStyles.modeRow, ...(checked ? dataStyles.typeRowActive : {}) }}>
                  <input type="radio" name="data-import-mode" checked={checked} onChange={() => setMode(value)} style={dataStyles.nativeCheck} />
                  <span style={{ ...dataStyles.typeCheck, ...(checked ? dataStyles.typeCheckActive : {}) }}>{checked ? "✓" : ""}</span>
                  <span style={dataStyles.modeText}>
                    <span style={dataStyles.modeTitle}>{title}</span>
                    <span style={dataStyles.modeDesc}>{description}</span>
                  </span>
                </label>;
              })}
            </div>
            {mode === "replace" && <div style={dataStyles.backupToggleRow}>
              <span style={dataStyles.backupToggleText}>导入前自动备份当前数据</span>
              <button
                type="button"
                style={{ ...panelStyles.toggleSwitch, ...(keepBackup ? panelStyles.toggleSwitchOn : {}) }}
                onClick={() => setKeepBackup((value) => !value)}
                title={keepBackup ? "点击关闭" : "点击开启"}
              >
                <span style={{ ...panelStyles.toggleKnob, ...(keepBackup ? panelStyles.toggleKnobOn : {}) }} />
              </button>
            </div>}
            {error && <p style={dataStyles.error}>{error}</p>}
            <div style={{ ...resetDialogStyles.actions, marginTop: mode === "replace" ? "24px" : undefined }}>
              <button style={resetDialogStyles.confirmBtn} disabled={!importToken || importTypes.length === 0 || inspecting} onClick={handleImport}>开始导入</button>
              <button style={resetDialogStyles.cancelBtn} onClick={() => setImportOpen(false)}>取消</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ================================================================
   📦 主题切换辅助
   ================================================================ */
// eslint-disable-next-line react-refresh/only-export-components
export function applyTheme(theme) {
  const root = document.documentElement;
  const isDark = theme === "dark" || (theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
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
  contentWrap: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    padding: "64px 0 40px",
    boxSizing: "border-box",
    overflow: "hidden",
  },
  content: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: "0 24px",
    boxSizing: "border-box",
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
  resetBox: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    padding: "18px 20px",
    borderRadius: "10px",
    border: "1px solid #f3f4f6",
    background: "#fafafa",
  },
  resetDesc: {
    fontSize: "14px",
    lineHeight: 1.6,
    color: "#6b7280",
    margin: 0,
  },
  resetBtnWrap: {
    display: "flex",
    justifyContent: "flex-end",
  },
  resetBtn: {
    padding: "9px 22px",
    borderRadius: "8px",
    border: "none",
    background: "#e94560",
    color: "#ffffff",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  locationRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    padding: "18px 20px",
    borderRadius: "10px",
    border: "1px solid #f3f4f6",
    background: "#fafafa",
  },
  locationDesc: {
    flex: 1,
    fontSize: "14px",
    lineHeight: 1.6,
    color: "#6b7280",
    margin: 0,
  },
  modifyBtn: {
    flexShrink: 0,
    padding: "9px 22px",
    borderRadius: "8px",
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    color: "#374151",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  toggleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    padding: "18px 20px",
    marginTop: "12px",
    borderRadius: "10px",
    border: "1px solid #f3f4f6",
    background: "#fafafa",
  },
  toggleText: {
    flex: 1,
    minWidth: 0,
  },
  toggleTitle: {
    fontSize: "14px",
    fontWeight: 600,
    color: "#374151",
    margin: "0 0 4px",
  },
  toggleDesc: {
    fontSize: "12px",
    lineHeight: 1.6,
    color: "#6b7280",
    margin: 0,
  },
  toggleSwitch: {
    flexShrink: 0,
    width: "44px",
    height: "24px",
    borderRadius: "12px",
    border: "none",
    background: "#d1d5db",
    padding: "2px",
    cursor: "pointer",
    transition: "background 0.2s",
    position: "relative",
    fontFamily: "inherit",
  },
  toggleSwitchOn: {
    background: "#e94560",
  },
  toggleKnob: {
    width: "20px",
    height: "20px",
    borderRadius: "50%",
    background: "#ffffff",
    boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
    transition: "transform 0.2s",
    position: "absolute",
    top: "2px",
    left: "2px",
  },
  toggleKnobOn: {
    transform: "translateX(20px)",
  },
};

const resetDialogStyles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1001,
    fontFamily: "'Segoe UI', sans-serif",
  },
  box: {
    width: "420px",
    padding: "28px 30px 22px",
    background: "#ffffff",
    borderRadius: "14px",
    boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
  },
  title: {
    fontSize: "20px",
    fontWeight: 700,
    color: "#1f2937",
    margin: "0",
    textAlign: "left",
  },
  divider: {
    height: "1px",
    background: "#e5e7eb",
    margin: "14px 0 4px",
  },
  text: {
    fontSize: "14px",
    lineHeight: 1.7,
    color: "#6b7280",
    textAlign: "left",
    margin: "8px 0 22px",
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "12px",
  },
  confirmBtn: {
    padding: "8px 20px",
    borderRadius: "8px",
    border: "none",
    background: "#e94560",
    color: "#ffffff",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  cancelBtn: {
    padding: "8px 20px",
    borderRadius: "8px",
    border: "1px solid #d1d5db",
    background: "#ffffff",
    color: "#374151",
    fontSize: "14px",
    cursor: "pointer",
    fontFamily: "inherit",
  },
};

const dataStyles = {
  confirmInput: {
    width: "100%", boxSizing: "border-box", padding: "11px 14px",
    borderRadius: "10px", border: "1px solid #d1d5db", outline: "none",
    background: "#f9fafb", color: "#1f2937", fontSize: "14px", fontFamily: "inherit",
  },
  fileRow: { display: "flex", alignItems: "center", gap: "12px", margin: "12px 0 4px" },
  fileBtn: {
    display: "inline-flex", alignItems: "center", padding: "7px 18px", borderRadius: "18px",
    border: "1px solid #d1d5db", background: "#ffffff", color: "#374151",
    fontSize: "13px", cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
  },
  fileName: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "13px", color: "#6b7280" },
  typeList: { display: "flex", flexDirection: "column", gap: "9px", margin: "12px 0 4px" },
  typeRow: { display: "flex", alignItems: "center", gap: "10px", minHeight: "42px", padding: "0 13px", border: "1px solid #e5e7eb", borderRadius: "10px", fontSize: "14px", color: "#374151", cursor: "pointer", transition: "all 0.15s", userSelect: "none" },
  typeRowActive: { borderColor: "rgba(233,69,96,0.25)", background: "rgba(233,69,96,0.12)", color: "#1f2937" },
  nativeCheck: { position: "absolute", opacity: 0, pointerEvents: "none" },
  typeCheck: { width: "17px", height: "17px", boxSizing: "border-box", border: "1.5px solid #e94560", borderRadius: "4px", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#ffffff", fontSize: "13px", fontWeight: 700, lineHeight: 1, flexShrink: 0 },
  typeCheckActive: { background: "#e94560" },
  modeRow: { minHeight: "58px", alignItems: "center" },
  modeText: { display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 },
  modeTitle: { fontSize: "14px", fontWeight: 600, color: "#1f2937" },
  modeDesc: { fontSize: "12px", lineHeight: 1.45, color: "#6b7280" },
  backupToggleRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "12px", padding: "10px 13px", borderRadius: "10px", background: "#f9fafb" },
  backupToggleText: { fontSize: "13px", fontWeight: 500, color: "#374151" },
  sectionLabel: { margin: "18px 0 0", fontSize: "14px", fontWeight: 600, color: "#1f2937" },
  hint: { margin: "10px 0 0", fontSize: "13px", color: "#6b7280" },
  error: { margin: "10px 0 0", color: "#dc2626", fontSize: "13px" },
};

const smartStyles = {
  addBtn: { display: "inline-flex", alignItems: "center", gap: "7px", marginTop: "16px", padding: "8px 14px", border: "none", borderRadius: "18px", background: "#e94560", color: "#fff", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 },
  providerList: { display: "flex", flexDirection: "column", gap: "10px", marginTop: "16px" },
  providerRow: { display: "flex", alignItems: "center", gap: "10px", padding: "12px", border: "1px solid #e5e7eb", borderRadius: "10px" },
  providerName: { fontWeight: 600, color: "#1f2937" },
  modelName: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "13px", color: "#6b7280" },
  status: { fontSize: "13px", whiteSpace: "nowrap" },
  iconBtn: { border: "none", background: "transparent", color: "#6b7280", cursor: "pointer" },
  providerSelectWrap: { position: "relative", display: "flex", alignItems: "center" },
  providerSelectIcon: { position: "absolute", left: "14px", zIndex: 1, pointerEvents: "none" },
  providerSelect: { width: "100%", padding: "10px 36px 10px 44px", borderRadius: "8px", border: "1px solid #d1d5db", background: "#fff", color: "#374151", fontSize: "14px", fontFamily: "inherit", outline: "none", appearance: "auto" },
  fieldLabel: { display: "block", margin: "14px 0 6px", fontSize: "13px", fontWeight: 600, color: "#374151" },
  modelHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "14px", marginBottom: "6px" },
  fetchModelsBtn: { border: "none", background: "transparent", color: "#e94560", cursor: "pointer", fontFamily: "inherit", fontSize: "13px", fontWeight: 600, padding: "2px 0" },
  advancedToggle: { display: "inline-flex", alignItems: "center", gap: "7px", marginTop: "18px", padding: 0, border: "none", background: "transparent", color: "#374151", cursor: "pointer", fontFamily: "inherit", fontSize: "14px", fontWeight: 600 },
  advancedPanel: { marginTop: "10px", padding: "12px", borderRadius: "10px", background: "#f9fafb", display: "flex", flexDirection: "column", gap: "14px" },
  advancedRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" },
  advancedTitle: { fontSize: "13px", fontWeight: 600, color: "#374151" },
  advancedHint: { marginTop: "4px", fontSize: "12px", lineHeight: 1.45, color: "#6b7280" },
  lengthRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" },
  lengthButtons: { display: "flex", flexShrink: 0, overflow: "hidden", border: "1px solid #d1d5db", borderRadius: "8px" },
  lengthBtn: { padding: "6px 9px", border: "none", borderLeft: "1px solid #d1d5db", background: "#fff", color: "#6b7280", cursor: "pointer", fontFamily: "inherit", fontSize: "12px" },
  lengthBtnActive: { background: "#e94560", color: "#fff" },
  deleteBtn: { display: "inline-flex", alignItems: "center", gap: "5px", padding: "8px 12px", border: "none", borderRadius: "8px", background: "#ef233c", color: "#fff", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 },
};

const dialogStyles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1002,
    fontFamily: "'Segoe UI', sans-serif",
  },
  box: {
    width: "460px",
    padding: "26px 30px 20px",
    background: "#ffffff",
    borderRadius: "14px",
    boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
  },
  title: {
    fontSize: "20px",
    fontWeight: 700,
    color: "#1f2937",
    margin: "0",
    textAlign: "left",
  },
  divider: {
    height: "1px",
    background: "#e5e7eb",
    margin: "14px 0 16px",
  },
  hint: {
    fontSize: "13px",
    color: "#6b7280",
    lineHeight: 1.6,
    margin: "0 0 12px",
  },
  input: {
    padding: "10px 14px",
    borderRadius: "8px",
    border: "1px solid #d1d5db",
    outline: "none",
    fontSize: "14px",
    fontFamily: "inherit",
    background: "#fafafa",
    color: "#1f2937",
  },
  error: {
    fontSize: "13px",
    color: "#e94560",
    margin: "8px 0 0",
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "12px",
    marginTop: "18px",
  },
  confirmBtn: {
    padding: "8px 22px",
    borderRadius: "8px",
    border: "none",
    background: "#e94560",
    color: "#ffffff",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  cancelBtn: {
    padding: "8px 22px",
    borderRadius: "8px",
    border: "1px solid #d1d5db",
    background: "#ffffff",
    color: "#374151",
    fontSize: "14px",
    cursor: "pointer",
    fontFamily: "inherit",
  },
};

const migrateDialogStyles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1003,
    fontFamily: "'Segoe UI', sans-serif",
  },
  box: {
    width: "400px",
    background: "#ffffff",
    borderRadius: "14px",
    boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    overflow: "hidden",
  },
  body: {
    padding: "26px 28px 20px",
  },
  title: {
    fontSize: "20px",
    fontWeight: 700,
    color: "#1f2937",
    margin: "0",
    textAlign: "left",
  },
  divider: {
    height: "1px",
    background: "#e5e7eb",
    margin: "14px 0 16px",
  },
  warn: {
    fontSize: "14px",
    color: "#e94560",
    lineHeight: 1.6,
    margin: "0 0 18px",
  },
  countRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  count: {
    fontSize: "14px",
    color: "#6b7280",
  },
  pct: {
    fontSize: "14px",
    fontWeight: 600,
    color: "#374151",
  },
  // 红色进度条（紧贴底部，满 = 到右侧）
  track: {
    height: "6px",
    width: "100%",
    background: "#f3f4f6",
  },
  fill: {
    height: "100%",
    background: "#e94560",
    transition: "width 0.25s ease",
  },
};

const matchStyles = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  configBox: {
    border: "1px solid #f3f4f6",
    borderRadius: "10px",
    background: "#fafafa",
    padding: "18px 20px",
  },
  fieldGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: "8px 14px",
  },
  fieldChip: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minWidth: 0,
  },
  fieldChipLabel: {
    fontSize: "13px",
    color: "#374151",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  fieldChipLabelDisabled: {
    color: "#9ca3af",
  },
  fieldHint: {
    fontSize: "12px",
    color: "#9ca3af",
    margin: "-6px 0 10px",
  },
  miniSwitch: {
    flexShrink: 0,
    width: "34px",
    height: "20px",
    borderRadius: "10px",
    border: "none",
    background: "#d1d5db",
    padding: "2px",
    cursor: "pointer",
    transition: "background 0.2s",
    position: "relative",
    fontFamily: "inherit",
  },
  miniSwitchOn: {
    background: "#e94560",
  },
  miniSwitchDisabled: {
    opacity: 0.45,
    cursor: "not-allowed",
  },
  miniKnob: {
    width: "16px",
    height: "16px",
    borderRadius: "50%",
    background: "#ffffff",
    boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
    transition: "transform 0.2s",
    position: "absolute",
    top: "2px",
    left: "2px",
  },
  miniKnobOn: {
    transform: "translateX(14px)",
  },
  sourceRow: {
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
  },
  sourceWarn: {
    fontSize: "12px",
    color: "#b45309",
    background: "#fef3c7",
    border: "1px solid #fde68a",
    borderRadius: "8px",
    padding: "6px 10px",
    margin: "10px 0 0",
  },
  sourceChip: {
    padding: "6px 16px",
    borderRadius: "16px",
    border: "1px solid #d1d5db",
    background: "#ffffff",
    color: "#6b7280",
    fontSize: "13px",
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "all 0.15s",
  },
  sourceChipOn: {
    background: "#e94560",
    borderColor: "#e94560",
    color: "#ffffff",
  },
  rateSegments: {
    display: "flex",
    flexShrink: 0,
    padding: "3px",
    gap: "2px",
    borderRadius: "20px",
    background: "#f3f4f6",
  },
  rateSegment: {
    minWidth: "52px",
    padding: "6px 10px",
    border: "none",
    borderRadius: "16px",
    background: "transparent",
    color: "#6b7280",
    fontSize: "12px",
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease",
  },
  rateSegmentOn: {
    background: "#e94560",
    color: "#ffffff",
    boxShadow: "0 3px 10px rgba(233,69,96,0.28)",
  },
  configTitle: {
    fontSize: "14px",
    fontWeight: 600,
    color: "#374151",
    margin: "0 0 12px",
  },
  configRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    marginBottom: "12px",
  },
  configLabel: {
    flexShrink: 0,
    width: "160px",
    fontSize: "13px",
    color: "#6b7280",
  },
  input: {
    flex: 1,
    padding: "8px 12px",
    borderRadius: "8px",
    border: "1px solid #d1d5db",
    background: "#ffffff",
    color: "#1f2937",
    fontSize: "13px",
    fontFamily: "inherit",
    outline: "none",
  },
  toggleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    padding: "12px 0",
    borderTop: "1px solid #f3f4f6",
  },
  toggleText: {
    flex: 1,
    minWidth: 0,
  },
  toggleTitle: {
    fontSize: "13px",
    fontWeight: 600,
    color: "#374151",
    margin: "0 0 2px",
  },
  toggleDesc: {
    fontSize: "12px",
    lineHeight: 1.5,
    color: "#6b7280",
    margin: 0,
  },
  matchBox: {
    border: "1px solid #f3f4f6",
    borderRadius: "10px",
    background: "#fafafa",
    padding: "18px 20px",
  },
  matchDesc: {
    fontSize: "12px",
    lineHeight: 1.6,
    color: "#6b7280",
    margin: "0 0 14px",
  },
  matchHeader: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },
  startBtn: {
    flexShrink: 0,
    padding: "9px 22px",
    borderRadius: "8px",
    border: "none",
    background: "#e94560",
    color: "#ffffff",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  detailRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    marginTop: "14px",
    padding: "12px 16px",
    borderRadius: "10px",
    border: "1px solid #f3f4f6",
    background: "#fafafa",
  },
  detailHint: {
    fontSize: "13px",
    color: "#6b7280",
  },
  detailBtn: {
    flexShrink: 0,
    padding: "7px 18px",
    borderRadius: "18px",
    border: "1px solid #e94560",
    background: "#ffffff",
    color: "#e94560",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  cancelBtn: {
    flexShrink: 0,
    padding: "9px 22px",
    borderRadius: "8px",
    border: "1px solid #d1d5db",
    background: "#ffffff",
    color: "#374151",
    fontSize: "14px",
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  error: {
    fontSize: "13px",
    color: "#e94560",
  },
  progressWrap: {
    marginTop: "16px",
  },
  countRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "6px",
  },
  count: {
    fontSize: "13px",
    color: "#6b7280",
  },
  pct: {
    fontSize: "13px",
    fontWeight: 600,
    color: "#374151",
  },
  track: {
    height: "6px",
    width: "100%",
    borderRadius: "3px",
    background: "#e5e7eb",
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    background: "#e94560",
    transition: "width 0.3s ease",
  },
  statsRow: {
    display: "flex",
    gap: "16px",
    marginTop: "8px",
  },
  statOk: {
    fontSize: "12px",
    color: "#16a34a",
  },
  statFail: {
    fontSize: "12px",
    color: "#e94560",
  },
  statSkip: {
    fontSize: "12px",
    color: "#9ca3af",
  },
  logBox: {
    marginTop: "14px",
    maxHeight: "200px",
    overflowY: "auto",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    background: "#ffffff",
    padding: "8px 12px",
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  logItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
    fontSize: "12px",
    lineHeight: 1.5,
  },
  logIcon: {
    flexShrink: 0,
    width: "16px",
    height: "16px",
    borderRadius: "50%",
    fontSize: "10px",
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#ffffff",
    marginTop: "1px",
  },
  logIconOk: {
    background: "#16a34a",
  },
  logIconSkip: {
    background: "#9ca3af",
  },
  logIconFail: {
    background: "#e94560",
  },
  logText: {
    color: "#4b5563",
    wordBreak: "break-word",
  },
};
