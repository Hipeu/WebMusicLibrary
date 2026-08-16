import { useState, useEffect } from "react";
import { Vibrant } from "node-vibrant/browser";

/**
 * 从封面图提取动态主题色
 * @param {string|null} coverUrl - 封面图地址
 * @returns {object|null} palette - node-vibrant 调色板对象
 */
export default function useCoverColor(coverUrl) {
  const [resolved, setResolved] = useState({ url: null, palette: null });

  useEffect(() => {
    if (!coverUrl) return undefined;

    let cancelled = false;
    Vibrant.from(coverUrl)
      .getPalette()
      .then((result) => {
        if (!cancelled) {
          setResolved({ url: coverUrl, palette: result });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setResolved({ url: coverUrl, palette: null });
          console.warn("[CoverColor] 提取失败:", coverUrl, err);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [coverUrl]);

  return resolved.url === coverUrl ? resolved.palette : null;
}
