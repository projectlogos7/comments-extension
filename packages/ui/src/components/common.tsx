import { Fragment, type ComponentChildren, type JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ThreadStatus, User } from '@pinpoint/shared';

// ---------------------------------------------------------------- basics

export function initials(u: Pick<User, 'name' | 'email'> | null | undefined): string {
  const n = (u?.name || u?.email || '?').trim();
  const parts = n.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

function hue(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function Avatar({ user, size = 24 }: { user: User | null | undefined; size?: number }) {
  const label = user?.name || user?.email || 'Unknown';
  if (user?.avatarUrl)
    return <img class="pp-avatar" src={user.avatarUrl} alt="" width={size} height={size} style={{ width: size, height: size }} title={label} />;
  return (
    <span
      class="pp-avatar"
      aria-hidden="true"
      title={label}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.4)), background: `hsl(${hue(user?.id ?? label)} 42% 44%)` }}
    >
      {initials(user)}
    </span>
  );
}

export function relTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const d = new Date(iso).getTime();
  const s = Math.round((now - d) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: days > 300 ? 'numeric' : undefined });
}

export function RelTime({ iso }: { iso: string | null | undefined }) {
  if (!iso) return null;
  return (
    <time dateTime={iso} title={new Date(iso).toLocaleString()}>
      {relTime(iso)}
    </time>
  );
}

export function StatusBadge({ status }: { status: ThreadStatus }) {
  return (
    <span class={`pp-badge pp-status-${status}`}>
      {status === 'resolved' && <Icon name="check" size={12} />}
      {status === 'open' ? 'Open' : 'Resolved'}
    </span>
  );
}

export function Badge({ children, tone = 'neutral', title }: { children: ComponentChildren; tone?: string; title?: string }) {
  return (
    <span class={`pp-badge pp-badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ComponentChildren }) {
  return <kbd class="pp-kbd">{children}</kbd>;
}

export function Empty({ title, children, icon, action }: { title: string; children?: ComponentChildren; icon?: IconName; action?: ComponentChildren }) {
  return (
    <div class="pp-empty">
      {icon && (
        <span class="pp-empty-icon" aria-hidden="true">
          <Icon name={icon} size={22} />
        </span>
      )}
      <div class="pp-empty-title">{title}</div>
      {children && <div class="pp-muted pp-empty-text">{children}</div>}
      {action && <div class="pp-empty-action">{action}</div>}
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div class="pp-skeleton" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} class="pp-skeleton-row">
          <span class="pp-skeleton-dot" />
          <span class="pp-skeleton-lines">
            <span style={{ width: `${70 - ((i * 17) % 30)}%` }} />
            <span style={{ width: `${40 - ((i * 7) % 15)}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div class="pp-error" role="alert">
      <Icon name="alert" size={16} />
      <span class="pp-grow">{error instanceof Error ? error.message : String(error)}</span>
      {onRetry && (
        <button class="pp-btn pp-btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ComponentChildren; hint?: ComponentChildren }) {
  return (
    <label class="pp-field">
      <span class="pp-field-label">{label}</span>
      {children}
      {hint && <span class="pp-field-hint">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label class={`pp-switch ${disabled ? 'pp-disabled' : ''}`}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
      <span class="pp-switch-track" aria-hidden="true">
        <span class="pp-switch-thumb" />
      </span>
      <span class="pp-switch-text">
        <span>{label}</span>
        {hint && <span class="pp-field-hint">{hint}</span>}
      </span>
    </label>
  );
}

export function capitalize(s: string | null | undefined) {
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function useDebouncedCallback<A extends unknown[]>(fn: (...a: A) => void, ms = 300) {
  const ref = useRef(fn);
  ref.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  return useCallback(
    (...a: A) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => ref.current(...a), ms);
    },
    [ms],
  );
}

// ---------------------------------------------------------------- icons

const ICONS = {
  chevron: 'M6 9l6 6 6-6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  link: 'M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1',
  share: 'M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6',
  search: 'M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM20 20l-4-4',
  plus: 'M12 5v14M5 12h14',
  users: 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.6a3.5 3.5 0 0 1 0 6.8',
  userPlus: 'M15 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 3 18.5V20M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 8v6M22 11h-6',
  inbox: 'M3 13h5l1.5 3h5l1.5-3h5M5.5 5h13L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  external: 'M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4',
  filter: 'M4 5h16M7 12h10M10 19h4',
  target: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zM12 12h.01',
  at: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1',
  image: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM20 15l-5-5L5 20',
  copy: 'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  send: 'M5 12h14M13 6l6 6-6 6',
  arrowLeft: 'M19 12H5M11 18l-6-6 6-6',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  lock: 'M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 11V7a4 4 0 1 1 8 0v4',
  mail: 'M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM3 7l9 6 9-6',
  refresh: 'M20 11a8 8 0 0 0-14.9-3.5M4 4v4h4M4 13a8 8 0 0 0 14.9 3.5M20 20v-4h-4',
  smile: 'M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01',
  message: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10',
  bold: 'M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z',
  italic: 'M14 5h-4M14 19h-4M14 5l-4 14',
  code: 'M9 8l-4 4 4 4M15 8l4 4-4 4',
  paperclip: 'M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  sparkles: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z',
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 16, class: cls }: { name: IconName; size?: number; class?: string }) {
  return (
    <svg
      class={`pp-icon ${cls ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={name === 'more' ? 3 : 1.8}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

// ---------------------------------------------------------------- layers (Esc closes the topmost)

interface Layer {
  close: () => void;
}
const layerStack: Layer[] = [];
let escListening = false;

function onEscape(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !layerStack.length || e.isComposing) return;
  const top = layerStack[layerStack.length - 1];
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  top.close();
}

/**
 * Register an open overlay (menu, popover, dialog, drawer). Esc closes the most recently opened
 * one only; focus returns to whatever had it when the layer opened.
 */
export function useLayer(open: boolean, close: () => void, opts: { restoreFocus?: boolean } = {}) {
  const ref = useRef(close);
  ref.current = close;
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    const prev = document.activeElement as HTMLElement | null;
    const layer: Layer = { close: () => ref.current() };
    layerStack.push(layer);
    if (!escListening) {
      document.addEventListener('keydown', onEscape, true);
      escListening = true;
    }
    return () => {
      const i = layerStack.indexOf(layer);
      if (i >= 0) layerStack.splice(i, 1);
      if (opts.restoreFocus !== false && prev && prev.isConnected && typeof prev.focus === 'function') {
        const active = document.activeElement;
        if (!active || active === document.body || !active.isConnected) prev.focus();
      }
    };
  }, [open]);
}

/** Number of overlays currently open (for tests and focus logic). */
export function openLayerCount() {
  return layerStack.length;
}

function layerRoot(): HTMLElement {
  let el = document.getElementById('pp-layer-root');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pp-layer-root';
    el.className = 'pp-layer-root';
    document.body.appendChild(el);
  }
  return el;
}

export function Portal({ children }: { children: ComponentChildren }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children as JSX.Element, layerRoot());
}

// ---------------------------------------------------------------- popover

export type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';

export interface PopoverPosition {
  top: number;
  left: number;
  maxHeight: number;
  placement: 'top' | 'bottom';
}

/** Pure placement math: below the anchor if it fits (else above, whichever has more room), shifted into the viewport. */
export function computePosition(anchor: { top: number; bottom: number; left: number; right: number }, size: { w: number; h: number }, viewport: { w: number; h: number }, placement: Placement = 'bottom-start', gap = 6, margin = 8): PopoverPosition {
  const below = viewport.h - anchor.bottom - gap - margin;
  const above = anchor.top - gap - margin;
  const preferTop = placement.startsWith('top');
  let side: 'top' | 'bottom' = preferTop ? (above >= size.h || above >= below ? 'top' : 'bottom') : below >= size.h || below >= above ? 'bottom' : 'top';
  const room = side === 'bottom' ? below : above;
  const h = Math.min(size.h, Math.max(80, room));
  const top = side === 'bottom' ? anchor.bottom + gap : anchor.top - gap - h;
  let left = placement.endsWith('end') ? anchor.right - size.w : anchor.left;
  left = Math.max(margin, Math.min(left, viewport.w - size.w - margin));
  return { top: Math.max(margin, top), left, maxHeight: Math.max(80, room), placement: side };
}

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  /** Element (or rect getter) the popover is attached to. */
  anchor: HTMLElement | null | (() => DOMRect | null);
  placement?: Placement;
  /** Make the popover at least as wide as the anchor. */
  matchWidth?: boolean;
  class?: string;
  role?: string;
  id?: string;
  label?: string;
  children: ComponentChildren;
  /** Do not move focus into the popover (e.g. mention picker while typing). */
  keepFocus?: boolean;
  onKeyDown?: (e: KeyboardEvent) => void;
}

/** Floating layer rendered at the end of <body>: never clipped by overflow, never pushes layout. */
export function Popover({ open, onClose, anchor, placement = 'bottom-start', matchWidth, class: cls, role, id, label, children, keepFocus, onKeyDown }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<PopoverPosition | null>(null);
  useLayer(open, onClose, { restoreFocus: !keepFocus });

  const getRect = useCallback((): DOMRect | null => {
    if (!anchor) return null;
    return typeof anchor === 'function' ? anchor() : anchor.isConnected ? anchor.getBoundingClientRect() : null;
  }, [anchor]);

  const update = useCallback(() => {
    const el = ref.current;
    const r = getRect();
    if (!el || !r) return;
    el.style.maxHeight = '';
    const w = Math.max(el.offsetWidth, matchWidth ? r.width : 0);
    const next = computePosition(r, { w, h: el.scrollHeight }, { w: window.innerWidth, h: window.innerHeight }, placement);
    setPos((p) => (p && p.top === next.top && p.left === next.left && p.maxHeight === next.maxHeight ? p : next));
  }, [getRect, placement, matchWidth]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    update();
    const on = () => update();
    window.addEventListener('resize', on);
    window.addEventListener('scroll', on, true);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(on) : null;
    if (ref.current) ro?.observe(ref.current);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('scroll', on, true);
      ro?.disconnect();
    };
  }, [open, update]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      // Clicks inside a popover opened from this one (e.g. a select inside a filter panel) don't count.
      const other = (t as Element).closest?.('.pp-popover, .pp-modal-backdrop');
      if (other && ref.current && ref.current.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING) return;
      const a = typeof anchor === 'function' ? null : anchor;
      if (a?.contains(t)) return;
      onClose();
    };
    // Defer so the click that opened the popover does not immediately close it.
    const id = setTimeout(() => document.addEventListener('mousedown', down, true), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', down, true);
    };
  }, [open, anchor, onClose]);

  if (!open) return null;
  const r = matchWidth ? getRect() : null;
  return (
    <Portal>
      <div
        ref={ref}
        id={id}
        role={role as JSX.AriaRole | undefined}
        aria-label={label}
        class={`pp-popover ${pos ? `pp-pop-${pos.placement}` : ''} ${cls ?? ''}`}
        tabIndex={-1}
        data-keep-focus={keepFocus ? '1' : undefined}
        style={{
          top: pos ? pos.top : -9999,
          left: pos ? pos.left : -9999,
          maxHeight: pos ? pos.maxHeight : undefined,
          minWidth: r ? r.width : undefined,
          visibility: pos ? 'visible' : 'hidden',
        }}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </Portal>
  );
}

// ---------------------------------------------------------------- menu

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  icon?: IconName;
  hint?: string;
  /** Draw a separator above this item. */
  separator?: boolean;
}

function focusItem(container: HTMLElement | null, selector: string, dir: 1 | -1 | 'first' | 'last') {
  const items = [...(container?.querySelectorAll<HTMLElement>(selector) ?? [])].filter((i) => !i.hasAttribute('disabled') && i.getAttribute('aria-disabled') !== 'true');
  if (!items.length) return;
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next = dir === 'first' ? 0 : dir === 'last' ? items.length - 1 : i < 0 ? (dir === 1 ? 0 : items.length - 1) : (i + dir + items.length) % items.length;
  items[next]?.focus();
}

/** Accessible dropdown menu (button + floating role=menu, arrow keys, Esc, outside click). */
export function Menu({
  label,
  items,
  buttonClass = 'pp-btn pp-btn-sm',
  icon,
  align = 'end',
  children,
}: {
  label: string;
  items: MenuItem[];
  buttonClass?: string;
  icon?: ComponentChildren;
  align?: 'start' | 'end';
  /** Button content (defaults to icon or label). */
  children?: ComponentChildren;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menuId = useMemo(() => `pp-menu-${Math.random().toString(36).slice(2, 8)}`, []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => focusItem(document.getElementById(menuId), '[role=menuitem]', 'first'));
    return () => cancelAnimationFrame(id);
  }, [open]);

  const onKey = (e: KeyboardEvent) => {
    const c = document.getElementById(menuId);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusItem(c, '[role=menuitem]', 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusItem(c, '[role=menuitem]', -1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusItem(c, '[role=menuitem]', 'first');
    } else if (e.key === 'End') {
      e.preventDefault();
      focusItem(c, '[role=menuitem]', 'last');
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        class={buttonClass}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={icon || children ? label : undefined}
        title={icon ? label : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {children ?? icon ?? label}
      </button>
      <Popover open={open} onClose={close} anchor={btn.current} placement={align === 'end' ? 'bottom-end' : 'bottom-start'} role="menu" id={menuId} label={label} class="pp-menu" onKeyDown={onKey}>
        {items.map((it, i) => (
          <Fragment key={`${i}-${it.label}`}>
            {it.separator && i > 0 && <div class="pp-menu-sep" role="separator" />}
            <button
              key={it.label}
              type="button"
              role="menuitem"
              class={`pp-menu-item ${it.danger ? 'pp-danger' : ''}`}
              disabled={it.disabled}
              tabIndex={-1}
              onClick={() => {
                setOpen(false);
                btn.current?.focus();
                it.onSelect();
              }}
            >
              {it.icon && <Icon name={it.icon} size={15} />}
              <span class="pp-grow">{it.label}</span>
              {it.hint && <span class="pp-menu-hint">{it.hint}</span>}
            </button>
          </Fragment>
        ))}
      </Popover>
    </>
  );
}

// ---------------------------------------------------------------- select

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  /** Leading visual (avatar, dot…). */
  icon?: ComponentChildren;
  hint?: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string = string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  /** Accessible name. */
  label: string;
  /** Shown before the value inside the button, e.g. "Status:". */
  prefix?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  class?: string;
  /** Mark the button as "active" when a non-default value is chosen (used by filters). */
  highlight?: boolean;
  align?: 'start' | 'end';
}

/** Custom select: a button plus a floating listbox (overlays, never clipped), full keyboard support. */
export function Select<T extends string = string>({ value, options, onChange, label, prefix, disabled, size = 'md', class: cls, highlight, align = 'start' }: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const listId = useMemo(() => `pp-lb-${Math.random().toString(36).slice(2, 8)}`, []);
  const typed = useRef({ text: '', at: 0 });
  const current = options.find((o) => o.value === value);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const i = Math.max(0, options.findIndex((o) => o.value === value));
    setActive(i);
    const id = requestAnimationFrame(() => document.getElementById(listId)?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  const choose = (o: SelectOption<T> | undefined) => {
    if (!o || o.disabled) return;
    setOpen(false);
    btn.current?.focus();
    if (o.value !== value) onChange(o.value);
  };

  const move = (dir: number) => {
    if (!options.length) return;
    let i = active;
    for (let n = 0; n < options.length; n++) {
      i = (i + dir + options.length) % options.length;
      if (!options[i].disabled) break;
    }
    setActive(i);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(options.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose(options[active]);
    } else if (e.key === 'Tab') {
      setOpen(false);
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase(), at: now };
      const i = options.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text));
      if (i >= 0) setActive(i);
    }
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        class={`pp-select pp-select-${size} ${highlight ? 'pp-select-on' : ''} ${cls ?? ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current?.label ?? 'None'}`}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {prefix && <span class="pp-select-prefix">{prefix}</span>}
        {current?.icon}
        <span class="pp-select-value">{current?.label ?? '—'}</span>
        <Icon name="chevron" size={14} class="pp-select-chevron" />
      </button>
      <Popover open={open} onClose={close} anchor={btn.current} placement={align === 'end' ? 'bottom-end' : 'bottom-start'} matchWidth class="pp-listbox-pop">
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          aria-activedescendant={`${listId}-${active}`}
          class="pp-listbox"
          onKeyDown={onKey}
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={o.value === value}
              aria-disabled={o.disabled || undefined}
              class={`pp-option ${i === active ? 'pp-active' : ''} ${o.disabled ? 'pp-disabled' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o)}
            >
              {o.icon}
              <span class="pp-grow pp-option-label">{o.label}</span>
              {o.hint && <span class="pp-menu-hint">{o.hint}</span>}
              {o.value === value && <Icon name="check" size={14} class="pp-option-check" />}
            </li>
          ))}
        </ul>
      </Popover>
    </>
  );
}

// ---------------------------------------------------------------- dialogs

function trapTab(e: KeyboardEvent, container: HTMLElement | null) {
  if (e.key !== 'Tab' || !container) return;
  const f = [...container.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
  if (!f.length) return;
  const first = f[0];
  const last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

export function Modal({
  title,
  onClose,
  children,
  wide,
  size,
  description,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  wide?: boolean;
  size?: 'sm' | 'md' | 'lg';
  description?: ComponentChildren;
  footer?: ComponentChildren;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useMemo(() => `pp-modal-${Math.random().toString(36).slice(2, 8)}`, []);
  useLayer(true, onClose);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[data-autofocus],input:not([type=hidden]):not([readonly]),select,textarea,.pp-modal-body button');
    (el ?? ref.current)?.focus();
  }, []);
  const s = size ?? (wide ? 'lg' : 'md');
  return (
    <Portal>
      <div class="pp-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div ref={ref} class={`pp-modal pp-modal-${s}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={(e) => trapTab(e, ref.current)}>
          <div class="pp-modal-head">
            <div class="pp-grow">
              <h2 id={titleId}>{title}</h2>
              {description && <p class="pp-muted pp-modal-desc">{description}</p>}
            </div>
            <button type="button" class="pp-icon-btn pp-modal-close" aria-label="Close" onClick={onClose}>
              <Icon name="x" />
            </button>
          </div>
          <div class="pp-modal-body">{children}</div>
          {footer && <div class="pp-modal-foot">{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}

/** Right-side panel that leaves the page behind it usable (thread detail on All comments). */
export function Drawer({ label, onClose, children }: { label: string; onClose: () => void; children: ComponentChildren }) {
  const ref = useRef<HTMLElement>(null);
  useLayer(true, onClose);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <aside ref={ref} class="pp-drawer" role="complementary" aria-label={label} tabIndex={-1}>
      {children}
    </aside>
  );
}
