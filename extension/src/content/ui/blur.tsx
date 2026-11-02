// Blur tool (FR-4.10): draw boxes over the captured viewport image; they are pixelated before saving.
import { useRef, useState } from 'preact/hooks';
import type { Rect } from '@pinpoint/shared';

interface Props {
  dataUrl: string;
  /** CSS viewport size of the capture. */
  viewport: { w: number; h: number };
  initial: Rect[];
  required: boolean;
  onApply: (regions: Rect[], blurredDataUrl: string) => void;
  onCancel: () => void;
}

async function pixelate(dataUrl: string, regions: Rect[], cssW: number): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const s = img.naturalWidth / cssW;
  for (const r of regions) {
    const x = Math.max(0, Math.round(r.x * s));
    const y = Math.max(0, Math.round(r.y * s));
    const w = Math.min(c.width - x, Math.round(r.w * s));
    const h = Math.min(c.height - y, Math.round(r.h * s));
    if (w <= 0 || h <= 0) continue;
    const block = Math.max(8, Math.round(12 * s));
    const sw = Math.max(1, Math.ceil(w / block));
    const sh = Math.max(1, Math.ceil(h / block));
    const tmp = document.createElement('canvas');
    tmp.width = sw;
    tmp.height = sh;
    const t = tmp.getContext('2d')!;
    t.drawImage(c, x, y, w, h, 0, 0, sw, sh);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, sw, sh, x, y, w, h);
  }
  return c.toDataURL('image/png');
}

export function BlurEditor(p: Props) {
  const [regions, setRegions] = useState<Rect[]>(p.initial);
  const [draft, setDraft] = useState<Rect | null>(null);
  const [busy, setBusy] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  function toCss(e: MouseEvent) {
    const img = imgRef.current!;
    const r = img.getBoundingClientRect();
    const k = p.viewport.w / r.width;
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, k };
  }

  function scale() {
    const img = imgRef.current;
    return img ? img.getBoundingClientRect().width / p.viewport.w : 1;
  }

  const k = scale();
  const box = (r: Rect, i?: number) => (
    <div class="blur-box" key={i ?? 'draft'} style={`left:${r.x * k}px;top:${r.y * k}px;width:${r.w * k}px;height:${r.h * k}px`}>
      {i != null && (
        <button type="button" aria-label="Remove blur box" onClick={(e) => { e.stopPropagation(); setRegions(regions.filter((_, j) => j !== i)); }}>×</button>
      )}
    </div>
  );

  return (
    <div class="modal" role="dialog" aria-modal="true" aria-label="Blur parts of the snapshot">
      <div class="modal-inner">
        <div class="hdr">
          <span class="title">Blur sensitive parts{p.required ? ' (review required by your workspace)' : ''}</span>
          <span class="muted">Drag over anything that should not be stored</span>
        </div>
        <div
          class="blur-stage"
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            const c = toCss(e);
            start.current = { x: c.x, y: c.y };
          }}
          onMouseMove={(e) => {
            if (!start.current) return;
            const c = toCss(e);
            const s = start.current;
            setDraft({ x: Math.min(s.x, c.x), y: Math.min(s.y, c.y), w: Math.abs(c.x - s.x), h: Math.abs(c.y - s.y) });
          }}
          onMouseUp={() => {
            if (draft && draft.w > 4 && draft.h > 4) setRegions([...regions, draft]);
            setDraft(null);
            start.current = null;
          }}
        >
          <div style="position:relative;display:inline-block">
            <img ref={imgRef} src={p.dataUrl} alt="Captured page" draggable={false} onLoad={() => setRegions([...regions])} />
            {regions.map((r, i) => box(r, i))}
            {draft && box(draft)}
          </div>
        </div>
        <div class="ftr">
          <span class="muted grow">{regions.length} region{regions.length === 1 ? '' : 's'} blurred</span>
          <button type="button" class="btn" onClick={() => setRegions([])} disabled={!regions.length}>Clear</button>
          <button type="button" class="btn" onClick={p.onCancel}>Back</button>
          <button
            type="button"
            class="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const out = regions.length ? await pixelate(p.dataUrl, regions, p.viewport.w) : p.dataUrl;
              p.onApply(regions, out);
            }}
          >
            {busy ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
