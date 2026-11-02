import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ThreadStatus, User } from '@pinpoint/shared';

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
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42), background: `hsl(${hue(user?.id ?? label)} 45% 42%)` }}
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
  return <span class={`pp-badge pp-status-${status}`}>{status === 'open' ? 'Open' : 'Resolved'}</span>;
}

export function Badge({ children, tone = 'neutral', title }: { children: ComponentChildren; tone?: string; title?: string }) {
  return (
    <span class={`pp-badge pp-badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Empty({ title, children }: { title: string; children?: ComponentChildren }) {
  return (
    <div class="pp-empty">
      <div class="pp-empty-title">{title}</div>
      {children && <div class="pp-muted">{children}</div>}
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div class="pp-skeleton" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} class="pp-skeleton-row" />
      ))}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div class="pp-error" role="alert">
      <span>{error instanceof Error ? error.message : String(error)}</span>
      {onRetry && (
        <button class="pp-btn pp-btn-sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current?.querySelector<HTMLElement>('input,select,textarea,button:not(.pp-modal-close)');
    el?.focus();
    return () => prev?.focus?.();
  }, []);
  return (
    <div class="pp-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        class={`pp-modal ${wide ? 'pp-modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div class="pp-modal-head">
          <h2>{title}</h2>
          <button class="pp-icon-btn pp-modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** Accessible dropdown menu (button + role=menu, arrow-key navigation). */
export function Menu({ label, items, buttonClass = 'pp-btn pp-btn-sm', icon }: { label: string; items: MenuItem[]; buttonClass?: string; icon?: ComponentChildren }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    wrap.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const onKey = (e: KeyboardEvent) => {
    const items = [...(wrap.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([disabled])') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
      wrap.current?.querySelector<HTMLElement>('button')?.focus();
    }
  };
  return (
    <div class="pp-menu-wrap" ref={wrap} onKeyDown={onKey}>
      <button class={buttonClass} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} aria-label={icon ? label : undefined}>
        {icon ?? label}
      </button>
      {open && (
        <div class="pp-menu" role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              class={`pp-menu-item ${it.danger ? 'pp-danger' : ''}`}
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ComponentChildren; hint?: string }) {
  return (
    <label class="pp-field">
      <span class="pp-field-label">{label}</span>
      {children}
      {hint && <span class="pp-field-hint">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label class="pp-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
      <span>{label}</span>
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
