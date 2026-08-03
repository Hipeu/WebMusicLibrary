import { useState, useEffect } from "react";
import { Vibrant } from "node-vibrant/browser";

/**
 * 从封面图提取动态主题色
 * @param {string|null} coverUrl - 封面图地址
 * @returns {object|null} palette - node-vibrant 调色板对象
 */
export default function useCoverColor(coverUrl) {
  const [palette, setPalette] = useState(null);

  useEffect(() => {
    if (!coverUrl) {
      setPalette(null);
      return;
    }

    let cancelled = false;
    Vibrant.from(coverUrl)
      .getPalette()
      .then((result) => {
        if (!cancelled) {
          setPalette(result);
          console.log("[CoverColor] 提取成功:", coverUrl, !!result?.Vibrant?.hex);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setPalette(null);
          console.warn("[CoverColor] 提取失败:", coverUrl, err);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [coverUrl]);

  return palette;
}
