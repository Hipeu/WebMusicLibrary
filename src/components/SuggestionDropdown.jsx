import { useEffect, useMemo, useRef, useState } from "react";

export default function SuggestionDropdown({ anchorRef, items, value, onPick, onClose }) {
  const listRef = useRef(null);
  const [pos, setPos] = useState(null);

  useEffect(() => {
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const maxItems = Math.min(items.length, 8);
      const listH = Math.min(280, maxItems * 36 + 12);
      // 默认向下弹出，贴近输入框下方；下方空间不足时向上弹出并尽量贴近输入框
      const bottom = rect.bottom + 4 + listH;
      const top = bottom > window.innerHeight
        ? Math.max(4, rect.top - listH - 4)
        : rect.bottom + 4;
      setPos({
        left: rect.left,
        top,
        width: rect.width,
      });
    };
    update();
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, items.length, value]);

  const filtered = useMemo(() => {
    const q = (value || "").trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => item.toLowerCase().includes(q));
  }, [items, value]);

  useEffect(() => {
    const onDown = (e) => {
      if (listRef.current && !listRef.current.contains(e.target) && !(anchorRef.current && anchorRef.current.contains(e.target))) {
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [anchorRef, onClose]);

  if (!pos) return null;

  return (
    <div
      ref={listRef}
      style={{
        position: "fixed",
        left: pos.left,
        top: pos.top,
        width: pos.width,
        zIndex: 1400,
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: "10px",
        boxShadow: "0 12px 40px rgba(0,0,0,0.18)",
        maxHeight: "280px",
        overflowY: "auto",
        padding: "6px",
        boxSizing: "border-box",
        fontFamily: "'Segoe UI', system-ui, sans-serif",
      }}
    >
      {filtered.length === 0 ? (
        <div style={{ padding: "10px", color: "#9ca3af", fontSize: "13px", textAlign: "center" }}>无匹配项</div>
      ) : (
        filtered.map((item) => (
          <button
            key={item}
            type="button"
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "7px 10px",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              fontSize: "13px",
              color: "#374151",
              fontFamily: "inherit",
              borderRadius: "6px",
            }}
            onClick={() => { onPick(item); onClose(); }}
          >
            {item}
          </button>
        ))
      )}
    </div>
  );
}