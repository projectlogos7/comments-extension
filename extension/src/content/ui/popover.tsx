// Floating popovers, select menus and action menus. Popovers are position:fixed and placed against
// their trigger with flip/shift so they overlay everything (never clipped by the card, never
// pushing layout) and always stay inside the viewport. Esc and outside clicks close them.
import type { ComponentChildren, RefObject } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { pushLayer } from './layers';

const GAP = 6;
const EDGE = 8;

export interface Placement {
  left: number;
  top: number;
  maxHeight: number;
  side: 'top' | 'bottom';
}

/** Place a w×h box next to `a` (viewport rect): below if it fits, else above, else the larger side. */
export function placeFloating(a: { left: number; top: number; right: number; bottom: number; width: number }, w: number, h: number, align: 'start' | 'end' = 'start'): Placement {
  const vw = innerWidth;
  const vh = innerHeight;
  const below = vh - a.bottom - GAP - EDGE;
  const above = a.top - GAP - EDGE;
  const side: 'top' | 'bottom' = h <= below || below >= above ? 'bottom' : 'top';
  const maxHeight = Math.max(80, side === 'bottom' ? below : above);
  const height = Math.min(h, maxHeight);
  const top = side === 'bottom' ? a.bottom + GAP : a.top - GAP - height;
  let left = align === 'end' ? a.right - w : a.left;
  left = Math.min(Math.max(EDGE, left), Math.max(EDGE, vw - w - EDGE));
  return { left: Math.round(left), top: Math.round(Math.max(EDGE, top)), maxHeight: Math.floor(maxHeight), side };
}

interface PopoverProps {
  anchor: RefObject<HTMLElement>;
  open: boolean;
  onClose: () => void;
  children: ComponentChildren;
  align?: 'start' | 'end';
  class?: string;
  /** Minimum width = trigger width. */
  matchWidth?: boolean;
  role?: string;
  label?: string;
  id?: string;
  /** Do not register an Esc layer (the owner handles Esc itself). */
  noEscape?: boolean;
}

export function Popover(p: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Placement | null>(null);

  const reposition = () => {
    const a = p.anchor.current;
    const el = ref.current;
    if (!a || !el) return;
    const r = a.getBoundingClientRect();
    el.style.maxHeight = 'none';
    const w = Math.max(el.offsetWidth, p.matchWidth ? r.width : 0);
    setPlace(placeFloating(r, w, el.scrollHeight, p.align));
  };

  useLayoutEffect(() => {
    if (!p.open) {
      setPlace(null);
      return;
    }
    reposition();
  }, [p.open]);

  useEffect(() => {
    if (!p.open) return;
    const pop = p.noEscape ? () => undefined : pushLayer(p.onClose);
    const onDown = (e: Event) => {
      const path = e.composedPath();
      if ((ref.current && path.includes(ref.current)) || (p.anchor.current && path.includes(p.anchor.current))) return;
      p.onClose();
    };
    const onMove = () => reposition();
    addEventListener('pointerdown', onDown, true);
    addEventListener('scroll', onMove, true);
    addEventListener('resize', onMove);
    return () => {
      pop();
      removeEventListener('pointerdown', onDown, true);
      removeEventListener('scroll', onMove, true);
      removeEventListener('resize', onMove);
    };
  }, [p.open]);

  if (!p.open) return null;
  const minW = p.matchWidth && p.anchor.current ? p.anchor.current.getBoundingClientRect().width : 0;
  const style = place
    ? `left:${place.left}px;top:${place.top}px;max-height:${place.maxHeight}px;min-width:${minW}px`
    : `left:-9999px;top:0;visibility:hidden;min-width:${minW}px`;
  return (
    <div ref={ref} id={p.id} class={`pop ${p.class ?? ''} ${place?.side === 'top' ? 'from-top' : ''}`} style={style} role={p.role as never} aria-label={p.label}>
      {p.children}
    </div>
  );
}

let idSeq = 0;
function useId(prefix: string) {
  const r = useRef<string>();
  if (!r.current) r.current = `${prefix}-${++idSeq}`;
  return r.current;
}

export interface Option<T extends string> {
  value: T;
  label: string;
  hint?: string;
  /** Small leading element, e.g. a colored dot or an avatar. */
  icon?: ComponentChildren;
}

interface SelectProps<T extends string> {
  /** Accessible name and the prefix shown on the chip, e.g. "Priority". */
  label: string;
  value: T | '';
  options: Option<T>[];
  onChange: (v: T | '') => void;
  /** Chip text when nothing is selected. */
  placeholder?: string;
  /** Adds a "None" option that clears the value. */
  clearable?: boolean;
  disabled?: boolean;
  /** Show only the selected label (no "Label:" prefix). */
  bare?: boolean;
  class?: string;
}

/** An accessible single-select menu button (replaces native <select>). */
export function Select<T extends string>(p: SelectProps<T>) {
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const all: Option<T | ''>[] = p.clearable ? [{ value: '', label: 'None' }, ...p.options] : p.options;
  const [active, setActive] = useState(0);
  const id = useId('pp-sel');
  const current = p.options.find((o) => o.value === p.value);

  function openMenu() {
    if (p.disabled) return;
    setActive(Math.max(0, all.findIndex((o) => o.value === p.value)));
    setOpen(true);
  }
  function close(focusBack = true) {
    setOpen(false);
    if (focusBack) btn.current?.focus();
  }
  function pick(v: T | '') {
    p.onChange(v);
    close();
  }

  useEffect(() => {
    if (open) requestAnimationFrame(() => list.current?.focus());
  }, [open]);
  useEffect(() => {
    list.current?.querySelector(`#${id}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function onKey(e: KeyboardEvent) {
    const n = all.length;
    if (e.key === 'ArrowDown') setActive((a) => (a + 1) % n);
    else if (e.key === 'ArrowUp') setActive((a) => (a - 1 + n) % n);
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(n - 1);
    else if (e.key === 'Enter' || e.key === ' ') pick(all[active].value);
    else if (e.key === 'Tab') return close(false);
    else return;
    e.preventDefault();
  }

  const text = current ? (p.bare ? current.label : `${p.label}: ${current.label}`) : (p.placeholder ?? p.label);
  return (
    <>
      <button
        ref={btn}
        type="button"
        class={`chipbtn ${current ? 'set' : ''} ${p.class ?? ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${p.label}: ${current?.label ?? 'none'}`}
        disabled={p.disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            openMenu();
          }
        }}
      >
        {current?.icon}
        <span>{text}</span>
        <Caret />
      </button>
      <Popover anchor={btn} open={open} onClose={() => close()} class="menu-pop">
        <div ref={list} role="listbox" tabIndex={-1} aria-label={p.label} aria-activedescendant={`${id}-${active}`} onKeyDown={onKey as unknown as (e: Event) => void}>
          {all.map((o, i) => (
            <div
              id={`${id}-${i}`}
              role="option"
              aria-selected={o.value === p.value}
              class={`opt ${i === active ? 'active' : ''}`}
              onPointerEnter={() => setActive(i)}
              onClick={() => pick(o.value)}
            >
              {o.icon}
              <span class="opt-label">{o.label}</span>
              {o.hint && <span class="opt-hint">{o.hint}</span>}
              {o.value === p.value && <span class="check" aria-hidden="true">✓</span>}
            </div>
          ))}
        </div>
      </Popover>
    </>
  );
}

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  hint?: string;
  separatorBefore?: boolean;
}

/** An icon/text button that opens an action menu (role=menu with roving focus). */
export function MenuButton(p: { label: string; title?: string; children: ComponentChildren; items: MenuItem[]; align?: 'start' | 'end'; class?: string }) {
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (open) requestAnimationFrame(() => (menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')[active])?.focus());
  }, [open, active]);

  function close(focusBack = true) {
    setOpen(false);
    if (focusBack) btn.current?.focus();
  }

  function onKey(e: KeyboardEvent) {
    const n = p.items.length;
    if (e.key === 'ArrowDown') setActive((a) => (a + 1) % n);
    else if (e.key === 'ArrowUp') setActive((a) => (a - 1 + n) % n);
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(n - 1);
    else if (e.key === 'Tab') return close(false);
    else return;
    e.preventDefault();
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        class={p.class ?? 'icon'}
        aria-label={p.label}
        title={p.title ?? p.label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setActive(0);
          setOpen(!open);
        }}
      >
        {p.children}
      </button>
      <Popover anchor={btn} open={open} onClose={() => close()} align={p.align ?? 'end'} class="menu-pop">
        <div ref={menu} role="menu" aria-label={p.label} onKeyDown={onKey as unknown as (e: Event) => void}>
          {p.items.map((it, i) => (
            <>
              {it.separatorBefore && <div class="sep" role="separator" />}
              <button
                type="button"
                role="menuitem"
                tabIndex={i === active ? 0 : -1}
                class={`opt ${it.danger ? 'danger' : ''}`}
                onPointerEnter={() => setActive(i)}
                onClick={() => {
                  close();
                  it.onSelect();
                }}
              >
                <span class="opt-label">{it.label}</span>
                {it.hint && <span class="opt-hint">{it.hint}</span>}
              </button>
            </>
          ))}
        </div>
      </Popover>
    </>
  );
}

export function Caret() {
  return (
    <svg class="caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}
