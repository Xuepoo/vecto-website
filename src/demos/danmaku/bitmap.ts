/**
 * Pre-rasterize each comment to a small offscreen bitmap, keyed by its content.
 * Thousands of live comments would die under thousands of per-frame `fillText`
 * calls; drawing a cached bitmap with `drawImage` is a GPU blit and an order of
 * magnitude cheaper. The corpus repeats heavily, so a stage of 2000 comments
 * resolves to only a few dozen unique bitmaps.
 */
const cache = new Map<string, DanmakuBitmap>();
const measureCtx =
  typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
const DPR = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2);
const CACHE_CAP = 800; // bound growth from user-sent comments

export interface DanmakuBitmap {
  canvas: HTMLCanvasElement;
  cssW: number;
  cssH: number;
}

const font = (size: number) => `600 ${size}px "Inter", system-ui, sans-serif`;

export function danmakuBitmap(text: string, color: string, fontSize: number): DanmakuBitmap | null {
  if (!measureCtx) return null;
  const key = `${fontSize}|${color}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;

  measureCtx.font = font(fontSize);
  const cssW = Math.ceil(measureCtx.measureText(text).width) + 4;
  const cssH = Math.ceil(fontSize * 1.5);

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(cssW * DPR);
  canvas.height = Math.ceil(cssH * DPR);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(DPR, DPR);
  ctx.font = font(fontSize);
  ctx.textBaseline = 'middle';
  const midY = cssH / 2;
  // 1px dark drop-shadow for legibility over a busy backdrop, then the fill.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillText(text, 1.4, midY + 1.4);
  ctx.fillStyle = color;
  ctx.fillText(text, 0, midY);

  if (cache.size >= CACHE_CAP) cache.clear();
  const bmp = { canvas, cssW, cssH };
  cache.set(key, bmp);
  return bmp;
}
