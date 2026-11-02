// Drag a fixed-position card by its header. Uses left/top (not transforms) so floating menus
// inside the card keep the viewport as their containing block and are never clipped.
import { useEffect, useRef, useState } from 'preact/hooks';

export interface Pos {
  left: number;
  top: number;
}

const MARGIN = 8;

export function clampPos(p: Pos, w: number, h: number): Pos {
  const maxL = Math.max(MARGIN, innerWidth - w - MARGIN);
  const maxT = Math.max(MARGIN, innerHeight - h - MARGIN);
  return { left: Math.round(Math.min(Math.max(MARGIN, p.left), maxL)), top: Math.round(Math.min(Math.max(MARGIN, p.top), maxT)) };
}

/**
 * Returns the current position, a ref for the card element, and props to spread on the drag
 * handle (header). Double-clicking the handle resets to `initial()`.
 */
export function useDraggable(initial: () => Pos) {
  const [pos, setPos] = useState<Pos>(() => initial());
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const moved = useRef(false);

  // Keep the card fully on screen when the window shrinks or the card grows (e.g. Options opened).
  useEffect(() => {
    const onResize = () => {
      const el = ref.current;
      if (el && !start.current) setPos((p) => {
        const c = clampPos(p, el.offsetWidth, el.offsetHeight);
        return c.left === p.left && c.top === p.top ? p : c;
      });
    };
    addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize);
    if (ref.current) ro.observe(ref.current);
    return () => {
      removeEventListener('resize', onResize);
      ro.disconnect();
    };
  }, []);

  function isInteractive(t: EventTarget | null) {
    return t instanceof Element && !!t.closest('button, input, textarea, select, a, [role="button"], [role="tab"], [data-nodrag]');
  }

  const handleProps = {
    onPointerDown(e: PointerEvent) {
      if (e.button !== 0 || isInteractive(e.target)) return;
      const el = ref.current;
      if (!el) return;
      e.preventDefault();
      start.current = { x: e.clientX, y: e.clientY, left: pos.left, top: pos.top };
      moved.current = false;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setDragging(true);
    },
    onPointerMove(e: PointerEvent) {
      const s = start.current;
      const el = ref.current;
      if (!s || !el) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved.current = true;
      setPos(clampPos({ left: s.left + dx, top: s.top + dy }, el.offsetWidth, el.offsetHeight));
    },
    onPointerUp(e: PointerEvent) {
      if (!start.current) return;
      start.current = null;
      setDragging(false);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    },
    onDblClick(e: MouseEvent) {
      if (isInteractive(e.target)) return;
      const el = ref.current;
      const p = initial();
      setPos(el ? clampPos(p, el.offsetWidth, el.offsetHeight) : p);
    },
  };

  return { pos, setPos, ref, dragging, handleProps };
}
