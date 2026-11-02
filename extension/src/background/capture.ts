// Screenshots through the tabs API (no debugger permission): viewport capture, area crop with the
// selection outlined, full-page scroll-and-stitch, and pixelation of blurred regions (FR-4.1/4.2/4.10).
import type { ContentMessage, Rect } from '@pinpoint/shared';
import { blobToDataUrl, dataUrlToBlob } from '../lib/dataurl';

const ACCENT = '#5B5BD6';
// Chrome allows ~2 captureVisibleTab calls per second.
const MIN_CAPTURE_INTERVAL = 550;
let lastCapture = 0;
let captureChain: Promise<unknown> = Promise.resolve();

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function captureVisible(windowId?: number): Promise<string> {
  const run = async () => {
    const wait = lastCapture + MIN_CAPTURE_INTERVAL - Date.now();
    if (wait > 0) await sleep(wait);
    lastCapture = Date.now();
    return chrome.tabs.captureVisibleTab(windowId ?? chrome.windows.WINDOW_ID_CURRENT, { format: 'png' });
  };
  const p = captureChain.then(run, run);
  captureChain = p.catch(() => undefined);
  return p;
}

async function bitmapFromDataUrl(dataUrl: string): Promise<ImageBitmap> {
  return createImageBitmap(dataUrlToBlob(dataUrl));
}

function pixelate(ctx: OffscreenCanvasRenderingContext2D, r: Rect, scale: number) {
  const x = Math.max(0, Math.floor(r.x * scale));
  const y = Math.max(0, Math.floor(r.y * scale));
  const w = Math.min(ctx.canvas.width - x, Math.ceil(r.w * scale));
  const h = Math.min(ctx.canvas.height - y, Math.ceil(r.h * scale));
  if (w <= 0 || h <= 0) return;
  const block = Math.max(8, Math.round(12 * scale));
  const img = ctx.getImageData(x, y, w, h);
  const d = img.data;
  for (let by = 0; by < h; by += block) {
    for (let bx = 0; bx < w; bx += block) {
      let rs = 0,
        gs = 0,
        bs = 0,
        n = 0;
      for (let yy = by; yy < Math.min(by + block, h); yy++)
        for (let xx = bx; xx < Math.min(bx + block, w); xx++) {
          const i = (yy * w + xx) * 4;
          rs += d[i];
          gs += d[i + 1];
          bs += d[i + 2];
          n++;
        }
      ctx.fillStyle = `rgb(${(rs / n) | 0},${(gs / n) | 0},${(bs / n) | 0})`;
      ctx.fillRect(x + bx, y + by, Math.min(block, w - bx), Math.min(block, h - by));
    }
  }
}

export async function applyBlur(dataUrl: string, regions: Rect[], cssWidth: number): Promise<string> {
  if (!regions.length) return dataUrl;
  const bmp = await bitmapFromDataUrl(dataUrl);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  const scale = bmp.width / cssWidth;
  for (const r of regions) pixelate(ctx, r, scale);
  return blobToDataUrl(await c.convertToBlob({ type: 'image/png' }));
}

/** Crop the selection (viewport CSS px) out of a viewport capture, with padding and an outline. */
export async function cropArea(viewportDataUrl: string, rect: Rect, cssViewportWidth: number): Promise<{ dataUrl: string; width: number; height: number }> {
  const bmp = await bitmapFromDataUrl(viewportDataUrl);
  const scale = bmp.width / cssViewportWidth;
  const pad = 24;
  const sx = Math.max(0, Math.floor((rect.x - pad) * scale));
  const sy = Math.max(0, Math.floor((rect.y - pad) * scale));
  const ex = Math.min(bmp.width, Math.ceil((rect.x + rect.w + pad) * scale));
  const ey = Math.min(bmp.height, Math.ceil((rect.y + rect.h + pad) * scale));
  const w = Math.max(1, ex - sx);
  const h = Math.max(1, ey - sy);
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, sx, sy, w, h, 0, 0, w, h);
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = Math.max(2, 2 * scale);
  ctx.setLineDash([]);
  ctx.strokeRect(rect.x * scale - sx, rect.y * scale - sy, rect.w * scale, rect.h * scale);
  const blob = await c.convertToBlob({ type: 'image/png' });
  return { dataUrl: await blobToDataUrl(blob), width: w, height: h };
}

export async function imageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  const bmp = await bitmapFromDataUrl(dataUrl);
  return { width: bmp.width, height: bmp.height };
}

interface Metrics {
  scrollHeight: number;
  scrollWidth: number;
  viewportH: number;
  viewportW: number;
  dpr: number;
  scrollX: number;
  scrollY: number;
}

async function sendToTab<T>(tabId: number, msg: ContentMessage): Promise<T> {
  const res = await chrome.tabs.sendMessage(tabId, msg, { frameId: 0 });
  if (res && typeof res === 'object' && 'ok' in res) {
    if (!res.ok) throw new Error(res.error?.message ?? 'Content script error');
    return res.data as T;
  }
  return res as T;
}

const MAX_FULLPAGE_DEVICE_PX = 16000;

/** Scroll-and-stitch capture of the whole page (JPEG to keep it small). */
export async function captureFullPage(tabId: number, windowId: number, blurRegions: Rect[] = []): Promise<{ dataUrl: string; width: number; height: number }> {
  const m = await sendToTab<Metrics>(tabId, { type: 'capture.metrics' });
  await sendToTab(tabId, { type: 'capture.prepare', hideFixed: false });
  try {
    const scale = m.dpr;
    const totalH = Math.min(m.scrollHeight, Math.floor(MAX_FULLPAGE_DEVICE_PX / scale));
    const canvas = new OffscreenCanvas(Math.round(m.viewportW * scale), Math.round(totalH * scale));
    const ctx = canvas.getContext('2d')!;
    let y = 0;
    let first = true;
    for (let guard = 0; guard < 60; guard++) {
      const actualY = await sendToTab<number>(tabId, { type: 'capture.scrollTo', y });
      const shot = await captureVisible(windowId);
      const bmp = await bitmapFromDataUrl(shot);
      const s = bmp.width / m.viewportW;
      // The page may clamp the scroll: draw the frame at the real offset.
      const drawH = Math.min(bmp.height, Math.round((totalH - actualY) * s));
      if (drawH > 0) ctx.drawImage(bmp, 0, 0, bmp.width, drawH, 0, Math.round(actualY * scale), canvas.width, Math.round((drawH / s) * scale));
      if (first) {
        // Fixed and sticky elements are kept in the first frame only, so they do not repeat.
        await sendToTab(tabId, { type: 'capture.prepare', hideFixed: true });
        first = false;
      }
      if (actualY + m.viewportH >= totalH) break;
      y = actualY + m.viewportH;
    }
    for (const r of blurRegions) pixelate(ctx, r, scale);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    return { dataUrl: await blobToDataUrl(blob), width: canvas.width, height: canvas.height };
  } finally {
    await sendToTab(tabId, { type: 'capture.restore' }).catch(() => undefined);
  }
}
