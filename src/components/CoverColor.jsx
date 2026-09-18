import { useState, useEffect } from "react";
import { Vibrant } from "node-vibrant/browser";

const paletteCache = new Map();
const paletteRequests = new Map();
const MAX_CACHE_ENTRIES = 100;

function cachePalette(key, palette) {
  paletteCache.set(key, palette);
  if (paletteCache.size <= MAX_CACHE_ENTRIES) return;
  paletteCache.delete(paletteCache.keys().next().value);
}

function requestUrlFor(source, revision) {
  if (!revision || /^(data:|blob:)/i.test(source)) return source;
  try {
    const url = new URL(source, window.location.href);
    url.searchParams.set("cover_version", String(revision));
    return url.href;
  } catch {
    return source;
  }
}

async function loadImage(blobUrl) {
  const image = new Image();
  image.decoding = "async";
  const loaded = new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("图片解码失败"));
  });
  image.src = blobUrl;
  if (typeof image.decode === "function") {
    try {
      await image.decode();
    } catch {
      await loaded;
    }
  } else {
    await loaded;
  }
  if (!image.naturalWidth || !image.naturalHeight) throw new Error("图片尺寸无效");
  return image;
}

function averageColor(image) {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("无法创建取色画布");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let red = 0, green = 0, blue = 0, weight = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255;
    if (alpha < 0.1) continue;
    red += pixels[i] * alpha;
    green += pixels[i + 1] * alpha;
    blue += pixels[i + 2] * alpha;
    weight += alpha;
  }
  if (!weight) throw new Error("封面没有可取色像素");
  const hex = [red, green, blue]
    .map((value) => Math.round(value / weight).toString(16).padStart(2, "0"))
    .join("");
  return `#${hex}`;
}

async function extractPalette(source, revision, cache = "default") {
  const response = await fetch(requestUrlFor(source, revision), { cache });
  if (!response.ok) throw new Error(`封面请求失败 (${response.status})`);
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error(`封面类型无效 (${blob.type || "unknown"})`);

  const blobUrl = URL.createObjectURL(blob);
  try {
    const image = await loadImage(blobUrl);
    try {
      const palette = await Vibrant.from(image).getPalette();
      if (Object.values(palette || {}).some((swatch) => swatch?.hex)) return palette;
    } catch {
      // 极端图片或浏览器调色板实现失败时，回退为平均色。
    }
    return { Muted: { hex: averageColor(image) } };
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

function resolvePalette(source, revision) {
  const key = `${source}\n${revision ?? ""}`;
  if (paletteCache.has(key)) return Promise.resolve(paletteCache.get(key));
  if (paletteRequests.has(key)) return paletteRequests.get(key);

  const request = extractPalette(source, revision)
    .catch(() => extractPalette(source, revision, "reload"))
    .then((palette) => {
      cachePalette(key, palette);
      return palette;
    })
    .finally(() => paletteRequests.delete(key));
  paletteRequests.set(key, request);
  return request;
}

/**
 * 从封面图提取动态主题色
 * @param {string|null} coverUrl - 封面图地址
 * @param {string|number|null} revision - 同一路径封面更新时用于使缓存失效
 * @returns {object|null} palette - node-vibrant 调色板对象
 */
export default function useCoverColor(coverUrl, revision = null) {
  const key = coverUrl ? `${coverUrl}\n${revision ?? ""}` : null;
  const [resolved, setResolved] = useState({ key: null, palette: null });

  useEffect(() => {
    if (!coverUrl) return undefined;

    let cancelled = false;
    resolvePalette(coverUrl, revision)
      .then((result) => {
        if (!cancelled) {
          setResolved({ key, palette: result });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setResolved({ key, palette: null });
          console.warn("[CoverColor] 提取失败:", coverUrl, err);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [coverUrl, revision, key]);

  return resolved.key === key ? resolved.palette : null;
}
