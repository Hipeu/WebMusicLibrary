import { useEffect, useMemo, useState } from "react";
import {
  FaArrowLeft,
  FaArrowRight,
  FaCheck,
  FaChevronDown,
  FaChevronUp,
  FaCloudUploadAlt,
  FaCompactDisc,
  FaFolderOpen,
  FaMoon,
  FaMusic,
  FaRobot,
  FaSun,
} from "react-icons/fa";
import { AiFillOpenAI } from "react-icons/ai";
import { SiDeepseek } from "react-icons/si";
import {
  getDataJob,
  getMigrationStatus,
  getSettings,
  inspectDataImport,
  saveAppSettings,
  saveSettings,
  saveSmartProvider,
  startDataImport,
  testSmartProvider,
} from "../services/api";
import "../styles/setup-wizard.css";

const STEPS = [
  ["欢迎", "准备开始"], ["恢复", "从备份继续"], ["主题", "选择显示风格"],
  ["名称", "命名资料库"], ["位置", "选择存放目录"], ["匹配", "设定信息来源"],
  ["编辑", "设定编辑偏好"], ["智能", "连接智能服务"], ["完成", "开始使用"],
];

const MATCH_FIELDS = ["标题", "艺术家", "专辑", "年份", "音轨号/碟号", "风格（流派）", "专辑艺术家", "专辑简介", "作曲家", "作词家", "歌词", "发布者", "编曲", "制作人"];
const MATCH_SOURCES = ["QQ音乐", "网易云音乐", "iTunes", "MusicBrainz"];
const MATCH_SOURCE_KEYS = { "QQ音乐": "qq", "网易云音乐": "netease", iTunes: "itunes", MusicBrainz: "musicbrainz" };
const MATCH_FIELD_KEYS = { "标题": "title", "艺术家": "artist", "专辑": "album", "年份": "year", "音轨号/碟号": "track_disc", "风格（流派）": "genre", "专辑艺术家": "album_artist", "专辑简介": "description", "作曲家": "composer", "作词家": "lyricist", "歌词": "lyric", "发布者": "publisher", "编曲": "arranger", "制作人": "producer" };
const EDIT_OPTIONS = [
  ["publisher", "编辑发布者默认携带发布符号和日期", "发布者为空时自动填入「℗ 年份」前缀"],
  ["explicitMarker", "粗俗音乐符号转换", "将歌曲或专辑名称后的（explicit）自动转换为 E 符号"],
  ["keepArtist", "删除音乐时保留无音乐的艺人", "即使艺人的音乐全部删除，仍保留艺人资料"],
  ["hideArtist", "不显示空艺人", "艺人列表默认隐藏没有歌曲的艺人"],
  ["collab", "自动整理合作艺人", "统一整理为「A & B & C」格式"],
];

const initialState = {
  restore: "later", restoreFile: null, theme: "light", libraryName: "音乐资料库",
  locationMode: "system", customPath: "", matchMode: "default",
  matchSources: { "QQ音乐": true, "网易云音乐": true, iTunes: true, MusicBrainz: false },
  matchFields: Object.fromEntries(MATCH_FIELDS.map((field) => [field, true])),
  skipMatched: true, lyricFallback: true, overwrite: false, matchRate: "fast",
  editMode: "default", editOptions: { publisher: true, explicitMarker: true, keepArtist: true, hideArtist: true, collab: true },
  smartMode: "later", provider: "openai", apiKey: "", model: "", webSearch: false, outputLength: "medium",
};

const descriptions = [
  "欢迎使用，接下来将完成各项功能设定。",
  "如果你有此前导出的备份，可以从熟悉的状态继续。",
  "选择最适合当前环境的界面外观。",
  "给你的音乐收藏一个容易辨认的名字。",
  "决定音乐与资料信息存放在哪里。",
  "选择补全歌曲信息时使用的来源和规则。",
  "设定日后编辑音乐资料时的默认行为。",
  "连接智能服务，辅助生成歌单、简介和元信息建议。",
  "一切准备就绪，你可以开始建立自己的音乐资料库了。",
];

function ChoiceCard({ selected, icon, title, description, badge, onClick }) {
  return <button type="button" className={`setup-choice ${selected ? "is-selected" : ""}`} onClick={onClick} aria-pressed={selected}>
    <span className="setup-choice-icon">{icon}</span>
    <span className="setup-choice-copy"><strong>{title}</strong>{description && <small>{description}</small>}</span>
    {badge && <span className="setup-badge">{badge}</span>}
    <span className="setup-radio">{selected && <span />}</span>
  </button>;
}

function Switch({ checked, onChange, label }) {
  return <button type="button" className={`setup-switch ${checked ? "is-on" : ""}`} onClick={onChange} role="switch" aria-checked={checked} aria-label={label}><span /></button>;
}

function ToggleRow({ title, description, checked, onChange }) {
  return <div className="setup-toggle-row"><div><strong>{title}</strong>{description && <small>{description}</small>}</div><Switch checked={checked} onChange={onChange} label={title} /></div>;
}

export default function SetupWizard() {
  const [step, setStep] = useState(0);
  const [data, setData] = useState(initialState);
  const [error, setError] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [smartTested, setSmartTested] = useState(false);
  const [smartTesting, setSmartTesting] = useState(false);
  const [smartModels, setSmartModels] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");
  const [defaultLibraryPath, setDefaultLibraryPath] = useState("");
  const set = (patch) => setData((current) => ({ ...current, ...patch }));
  const completed = useMemo(() => step === 8 ? 100 : Math.round((step / 8) * 100), [step]);

  useEffect(() => {
    getSettings().then((result) => setDefaultLibraryPath(result?.default_library_path || "")).catch(() => {});
  }, []);

  async function waitForMigration() {
    for (;;) {
      const status = await getMigrationStatus();
      if (status?.status === "done") return;
      if (status?.status === "error") throw new Error(status.msg || "资料库位置设置失败");
      setSubmitMessage(`正在迁移资料库… ${status?.done || 0}/${status?.total || 0}`);
      await new Promise((resolve) => window.setTimeout(resolve, 450));
    }
  }

  async function saveWizardSettings() {
    setSubmitting(true);
    setError("");
    try {
      setSubmitMessage("正在保存资料库设置…");
      let targetPath = data.locationMode === "system" ? defaultLibraryPath : data.customPath.trim();
      if (data.locationMode === "system" && !targetPath) {
        const currentSettings = await getSettings();
        targetPath = currentSettings?.default_library_path || "";
      }
      if (!targetPath) throw new Error("无法读取系统音乐目录，请确认后端正在运行");
      if (targetPath) {
        const migration = await saveSettings(targetPath);
        if (migration?.status === "error") throw new Error(migration.msg || "资料库位置设置失败");
        if (migration?.status === "migrating") await waitForMigration();
      }

      const usingDefaultMatch = data.matchMode === "default";
      const usingDefaultEdit = data.editMode === "default";
      const appSettings = {
        "library-display-name": data.libraryName.trim(),
        "match-skip-matched": usingDefaultMatch || data.skipMatched ? "1" : "0",
        "match-lyric-fallback": usingDefaultMatch || data.lyricFallback ? "1" : "0",
        "match-overwrite": usingDefaultMatch ? "0" : data.overwrite ? "1" : "0",
        "match-rate": usingDefaultMatch ? "fast" : data.matchRate,
        "edit-publisher-copyright": usingDefaultEdit || data.editOptions.publisher ? "true" : "false",
        "display-explicit-marker": usingDefaultEdit || data.editOptions.explicitMarker ? "true" : "false",
        "artist-keep-empty": usingDefaultEdit || data.editOptions.keepArtist ? "true" : "false",
        "artist-hide-empty": usingDefaultEdit || data.editOptions.hideArtist ? "true" : "false",
        "edit-auto-organize-collab": usingDefaultEdit || data.editOptions.collab ? "true" : "false",
      };
      MATCH_SOURCES.forEach((source) => { const enabled = usingDefaultMatch ? source !== "MusicBrainz" : data.matchSources[source]; appSettings[`match-source-${MATCH_SOURCE_KEYS[source]}`] = enabled ? "1" : "0"; });
      MATCH_FIELDS.forEach((field) => { appSettings[`match-field-${MATCH_FIELD_KEYS[field]}`] = usingDefaultMatch || data.matchFields[field] ? "1" : "0"; });
      Object.entries(appSettings).forEach(([key, value]) => localStorage.setItem(key, value));
      localStorage.setItem("app-theme", data.theme);
      document.documentElement.setAttribute("data-theme", data.theme);
      const saved = await saveAppSettings(appSettings);
      if (saved?.status === "error") throw new Error(saved.msg || "设置保存失败");

      if (data.smartMode === "enabled") {
        setSubmitMessage("正在保存智能服务…");
        const smartSaved = await saveSmartProvider(data.provider, { api_key: data.apiKey.trim(), model: data.model, connected: true, enabled: true, make_default: true, web_search: data.webSearch, output_length: data.outputLength });
        if (smartSaved?.status === "error") throw new Error(smartSaved.msg || "智能服务保存失败");
      }
      const completed = await saveAppSettings({ "setup-complete": "1" });
      if (completed?.status === "error") throw new Error(completed.msg || "无法完成初始化");
      setSubmitMessage("");
      setStep(8);
    } catch (err) {
      setError(err?.message || "设置保存失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }

  async function restoreBackup() {
    setSubmitting(true);
    setError("");
    try {
      setSubmitMessage("正在检查备份包…");
      const inspected = await inspectDataImport(data.restoreFile);
      if (inspected?.status !== "ok" || !inspected.token) throw new Error(inspected?.detail || "备份包无效");
      const types = inspected.types || [];
      const started = await startDataImport(inspected.token, "replace", false, types);
      if (started?.status !== "started") throw new Error(started?.detail || "无法开始恢复");
      for (;;) {
        const job = await getDataJob(started.job_id);
        setSubmitMessage(job?.message || "正在恢复设置…");
        if (job?.status === "done") break;
        if (job?.status === "error" || job?.status === "cancelled") throw new Error(job.error || job.message || "恢复失败");
        await new Promise((resolve) => window.setTimeout(resolve, 500));
      }
      await saveAppSettings({ "setup-complete": "1" });
      localStorage.setItem("setup-complete", "1");
      setSubmitMessage("");
      setStep(8);
    } catch (err) {
      setError(err?.message || "恢复失败，请检查备份包");
    } finally {
      setSubmitting(false);
    }
  }

  async function validateAndNext() {
    setError("");
    if (step === 1 && data.restore === "backup") {
      if (!data.restoreFile) { setError("请先选择一个 ZIP 备份文件"); return; }
      await restoreBackup(); return;
    }
    if (step === 3 && !data.libraryName.trim()) { setError("资料库名称不能为空"); return; }
    if (step === 4 && data.locationMode === "custom" && !data.customPath.trim()) { setError("请输入资料库的完整路径"); return; }
    if (step === 7 && data.smartMode === "enabled") {
      if (!smartTested) { setError("请先填写 API Key 并通过连接测试"); return; }
      if (!data.model) { setError("请选择智能服务模型"); return; }
      await saveWizardSettings(); return;
    }
    if (step === 7) { await saveWizardSettings(); return; }
    setStep((current) => Math.min(8, current + 1));
  }

  function goBack() {
    setError("");
    setStep((current) => Math.max(0, current - 1));
  }

  async function testSmartKey() {
    if (!data.apiKey.trim() || smartTesting) return;
    setSmartTesting(true);
    setError("");
    try {
      const result = await testSmartProvider({ provider: data.provider, api_key: data.apiKey.trim() });
      const models = result?.models || [];
      if (!models.length) throw new Error("该密钥未返回可用模型");
      setSmartModels(models);
      setSmartTesting(false);
      setSmartTested(true);
    } catch (err) {
      setSmartModels([]);
      setSmartTested(false);
      setError(err?.message || "连接测试失败，请检查密钥和网络");
    } finally {
      setSmartTesting(false);
    }
  }

  function renderContent() {
    if (step === 0) return <div className="setup-welcome">
      <div className="setup-record"><FaCompactDisc /><span><FaMusic /></span></div>
      <div><span className="setup-eyebrow">WEB MUSIC PLAYER</span><h2>整理和归档音乐的理想之处</h2><p>只需几分钟就能完成各项功能，让我们开始吧。</p></div>
      <div className="setup-summary"><span><FaCheck /> 资料库</span><span><FaCheck /> 信息匹配</span><span><FaCheck /> 智能功能</span></div>
    </div>;

    if (step === 1) return <div className="setup-section">
      <div className="setup-choice-grid"><ChoiceCard selected={data.restore === "backup"} icon={<FaCloudUploadAlt />} title="从备份恢复" description="选择此前导出的 ZIP 备份包，恢复后直接完成设置" onClick={() => set({ restore: "backup" })} /><ChoiceCard selected={data.restore === "later"} icon={<FaArrowRight />} title="暂不恢复" description="继续逐项完成全新资料库的设置" onClick={() => set({ restore: "later", restoreFile: null })} /></div>
      {data.restore === "backup" && <label className="setup-file-drop"><input type="file" accept=".zip,application/zip" onChange={(e) => set({ restoreFile: e.target.files?.[0] || null })} /><FaFolderOpen /><strong>{data.restoreFile ? data.restoreFile.name : "选择 ZIP 备份文件"}</strong><small>支持由 Web Music Player 导出的 ZIP 备份包</small></label>}
    </div>;

    if (step === 2) return <div className="setup-section"><div className="setup-choice-grid theme-grid"><ChoiceCard selected={data.theme === "light"} icon={<FaSun />} title="浅色模式" description="明亮、清晰，适合日间环境" onClick={() => set({ theme: "light" })} /><ChoiceCard selected={data.theme === "dark"} icon={<FaMoon />} title="深色模式" description="柔和、沉浸，适合低光环境" onClick={() => set({ theme: "dark" })} /></div><div className="setup-theme-preview"><span /><span /><span /><div><i /><i /><i /></div></div></div>;

    if (step === 3) return <div className="setup-section setup-narrow"><label className="setup-field"><span>资料库名称</span><input autoFocus maxLength={40} value={data.libraryName} onChange={(e) => { set({ libraryName: e.target.value }); setError(""); }} placeholder="例如：我的音乐资料库" /><small>{data.libraryName.length} / 40</small></label><p className="setup-hint">这个名称会显示在资料库左上角，之后也可以随时修改。</p></div>;

    if (step === 4) return <div className="setup-section"><div className="setup-choice-stack"><ChoiceCard selected={data.locationMode === "system"} icon={<FaMusic />} title="系统音乐目录" description="使用系统默认的音乐文件夹，便于管理与备份" badge="推荐" onClick={() => set({ locationMode: "system" })} /><ChoiceCard selected={data.locationMode === "custom"} icon={<FaFolderOpen />} title="让我自行设定" description="将资料库存放在你指定的磁盘或目录" onClick={() => set({ locationMode: "custom" })} /></div>{data.locationMode === "custom" && <label className="setup-field setup-path"><span>资料库完整路径</span><input value={data.customPath} onChange={(e) => { set({ customPath: e.target.value }); setError(""); }} placeholder="例如 D:\Music\Music_Library" /></label>}</div>;

    if (step === 5) return <div className="setup-section"><ModeSelector value={data.matchMode} onChange={(matchMode) => set({ matchMode })} />{data.matchMode === "default" ? <DefaultSummary items={["QQ音乐、网易云音乐、iTunes", "全部 14 个匹配字段", "跳过已匹配 · 歌词信息补全", "快速匹配"]} /> : <div className="setup-custom"><ConfigBlock title="匹配源"><div className="setup-chip-grid">{MATCH_SOURCES.map((source) => <button type="button" key={source} className={`setup-chip ${data.matchSources[source] ? "is-on" : ""}`} onClick={() => set({ matchSources: { ...data.matchSources, [source]: !data.matchSources[source] } })}>{data.matchSources[source] && <FaCheck />}{source}</button>)}</div></ConfigBlock><ConfigBlock title="匹配字段"><div className="setup-field-grid">{MATCH_FIELDS.map((field) => <label key={field}><input type="checkbox" checked={data.matchFields[field]} onChange={() => set({ matchFields: { ...data.matchFields, [field]: !data.matchFields[field] } })} />{field}</label>)}</div></ConfigBlock><ConfigBlock title="功能设置"><ToggleRow title="跳过已匹配的音乐" checked={data.skipMatched} onChange={() => set({ skipMatched: !data.skipMatched })} /><ToggleRow title="通过歌词寻找作曲者、作词者和发布者信息" checked={data.lyricFallback} onChange={() => set({ lyricFallback: !data.lyricFallback })} /><ToggleRow title="覆盖原音乐文件的信息" checked={data.overwrite} onChange={() => set({ overwrite: !data.overwrite })} /><Segmented label="匹配速率" value={data.matchRate} options={[["fast", "快速"], ["normal", "标准"], ["slow", "低速"]]} onChange={(matchRate) => set({ matchRate })} /></ConfigBlock></div>}</div>;

    if (step === 6) return <div className="setup-section"><ModeSelector value={data.editMode} onChange={(editMode) => set({ editMode })} />{data.editMode === "default" ? <DefaultSummary items={["发布者自动携带发布符号和日期", "自动转换粗俗音乐 E 符号", "保留无音乐的艺人", "默认隐藏空艺人", "自动整理合作艺人"]} /> : <ConfigBlock title="编辑与艺人设置">{EDIT_OPTIONS.map(([key, title, description]) => <ToggleRow key={key} title={title} description={description} checked={data.editOptions[key]} onChange={() => set({ editOptions: { ...data.editOptions, [key]: !data.editOptions[key] } })} />)}</ConfigBlock>}</div>;

    if (step === 7) return <div className="setup-section"><div className="setup-choice-grid"><ChoiceCard selected={data.smartMode === "enabled"} icon={<FaRobot />} title="启用智能功能" description="连接服务以生成歌单、简介和元信息建议" onClick={() => set({ smartMode: "enabled" })} /><ChoiceCard selected={data.smartMode === "later"} icon={<FaArrowRight />} title="稍后设置" description="先完成向导，之后可随时在设置中连接" onClick={() => set({ smartMode: "later" })} /></div>{data.smartMode === "enabled" && <div className="setup-smart-form"><fieldset className="setup-provider-field"><legend>智能供应商</legend><div className="setup-provider-options"><button type="button" className={data.provider === "openai" ? "is-active" : ""} onClick={() => { set({ provider: "openai", model: "" }); setSmartModels([]); setSmartTested(false); setAdvanced(false); }}><AiFillOpenAI /><span>ChatGPT</span></button><button type="button" className={data.provider === "deepseek" ? "is-active" : ""} onClick={() => { set({ provider: "deepseek", model: "" }); setSmartModels([]); setSmartTested(false); setAdvanced(false); }}><SiDeepseek /><span>DeepSeek</span></button></div></fieldset><div className="setup-key-group"><label className="setup-field setup-key-field"><span>API Key</span><input type="password" value={data.apiKey} onChange={(e) => { set({ apiKey: e.target.value, model: "" }); setSmartModels([]); setSmartTested(false); setAdvanced(false); }} placeholder="输入 API Key" /><small className="setup-key-help">前往 <a href={data.provider === "openai" ? "https://platform.openai.com/api-keys" : "https://platform.deepseek.com/api_keys"} target="_blank" rel="noreferrer">{data.provider === "openai" ? "OpenAI 开放平台" : "DeepSeek 开放平台"}</a> 获取密钥。密钥将安全保存在本机服务中。</small></label><button type="button" className={`setup-test-key ${smartTested ? "is-success" : ""}`} disabled={!data.apiKey.trim() || smartTesting} onClick={testSmartKey}>{smartTesting ? "测试中…" : smartTested ? <><FaCheck /> 已连接</> : "测试连接"}</button></div>{smartTested && <><label className="setup-field setup-model-field"><span>模型</span><select value={data.model} onChange={(e) => set({ model: e.target.value })}><option value="">请选择模型</option>{smartModels.map((model) => <option key={model} value={model}>{model}</option>)}</select></label><button type="button" className="setup-advanced-button" onClick={() => setAdvanced(!advanced)}>高级设置 {advanced ? <FaChevronUp /> : <FaChevronDown />}</button>{advanced && <div className="setup-advanced"><ToggleRow title="联网搜索" description="允许模型结合网络资料生成内容" checked={data.webSearch} onChange={() => set({ webSearch: !data.webSearch })} /><Segmented label="输出内容长度" value={data.outputLength} options={[["short", "简洁"], ["medium", "适中"], ["long", "较长"]]} onChange={(outputLength) => set({ outputLength })} /></div>}</>}</div>}</div>;

    return <div className="setup-complete"><div className="setup-complete-icon"><FaCheck /></div><span className="setup-eyebrow">READY TO PLAY</span><h2>完成设置！</h2><p>现在就导入音乐吧</p><button type="button" className="setup-import-button" onClick={() => { window.location.href = "/"; }}><FaMusic /> 进入资料库</button><small>所有设置已保存，你可以随时在设置中修改</small></div>;
  }

  return <main className={`setup-page theme-${data.theme}`}>
    <div className="setup-shell">
      <aside className="setup-sidebar"><div className="setup-brand"><span><FaMusic /></span><strong>Web Music Player</strong></div><div className="setup-intro"><span>步骤 {step + 1} / {STEPS.length}</span><h1>{STEPS[step][0]}</h1><p>{descriptions[step]}</p></div><nav className="setup-progress" aria-label="设置进度">{STEPS.map(([title, subtitle], index) => <div key={title} className={`setup-progress-item ${index < step ? "is-complete" : ""} ${index === step ? "is-active" : ""}`}><span>{index < step ? <FaCheck /> : index + 1}</span><div><strong>{title}</strong><small>{subtitle}</small></div></div>)}</nav><div className="setup-progress-bar"><span style={{ height: `${completed}%` }} /></div></aside>
      <section className="setup-main"><div className="setup-mobile-progress">{STEPS.map(([title], index) => <span key={title} className={`${index < step ? "is-complete" : ""} ${index === step ? "is-active" : ""}`}>{index < step ? <FaCheck /> : index + 1}<small>{title}</small></span>)}</div><header className="setup-content-header"><span>{String(step + 1).padStart(2, "0")}</span><div><h2>{STEPS[step][0]}</h2><p>{descriptions[step]}</p></div></header><div className="setup-content">{renderContent()}</div>{error && <p className="setup-error" role="alert">{error}</p>}{submitting && <div className="setup-submitting" role="status"><span /><strong>{submitMessage || "正在处理…"}</strong></div>}<footer className="setup-actions">{step > 0 && step < 8 ? <button type="button" className="setup-secondary" disabled={submitting} onClick={goBack}><FaArrowLeft /> 上一步</button> : <span />}{step < 8 && <button type="button" className="setup-primary" disabled={submitting} onClick={validateAndNext}>{step === 0 ? "开始设置" : step === 1 && data.restore === "backup" ? "恢复并完成" : step === 7 ? "保存并完成" : "下一步"}<FaArrowRight /></button>}</footer></section>
    </div>
  </main>;
}

function ModeSelector({ value, onChange }) {
  return <div className="setup-mode"><button type="button" className={value === "default" ? "is-active" : ""} onClick={() => onChange("default")}><strong>使用默认设置</strong><small>采用推荐配置，快速完成</small></button><button type="button" className={value === "custom" ? "is-active" : ""} onClick={() => onChange("custom")}><strong>自定义设置</strong><small>逐项选择你需要的功能</small></button></div>;
}

function DefaultSummary({ items }) {
  return <div className="setup-default"><span className="setup-default-icon"><FaCheck /></span><div><strong>已应用推荐设置</strong><p>这些选项适合大多数音乐资料库，你可以稍后在设置中修改。</p><ul>{items.map((item) => <li key={item}><FaCheck />{item}</li>)}</ul></div></div>;
}

function ConfigBlock({ title, children }) { return <section className="setup-config"><h3>{title}</h3>{children}</section>; }

function Segmented({ label, value, options, onChange }) {
  return <div className="setup-segmented-row"><strong>{label}</strong><div className="setup-segmented">{options.map(([key, title]) => <button type="button" key={key} className={value === key ? "is-active" : ""} onClick={() => onChange(key)}>{title}</button>)}</div></div>;
}
