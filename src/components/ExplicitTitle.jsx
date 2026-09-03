const EXPLICIT_SUFFIX = /\s*[（(]\s*explicit\s*[）)]\s*$/i;

function usesExplicitMarker() {
  return localStorage.getItem("display-explicit-marker") !== "false";
}

/** 仅转换展示文本，保留原始元数据和搜索/排序使用的标题。 */
export default function ExplicitTitle({ children, fallback = "" }) {
  const original = String(children || fallback || "");
  if (!usesExplicitMarker()) return original;
  const title = original.replace(EXPLICIT_SUFFIX, "");
  if (title === original) return original;
  return <>{title}<span className="explicit-marker" title="Explicit" aria-label="Explicit">E</span></>;
}
