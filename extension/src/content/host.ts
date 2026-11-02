// The isolated layer: one host element with an open shadow root holding every piece of UI we draw.
// The host is 0×0 and position:fixed, so it never affects the page layout (FR-1.14).
import { CSS } from './styles';

export interface Host {
  el: HTMLElement;
  root: ShadowRoot;
  container: HTMLElement;
  pins: HTMLElement;
  overlay: HTMLElement;
  ui: HTMLElement;
  toasts: HTMLElement;
  live: HTMLElement;
  setVisible(v: boolean): void;
  destroy(): void;
}

const STOP_EVENTS = ['keydown', 'keyup', 'keypress', 'input', 'paste', 'copy', 'cut', 'mousedown', 'mouseup', 'click', 'dblclick', 'pointerdown', 'pointerup', 'focusin', 'focusout', 'contextmenu', 'beforeinput', 'drop', 'dragover'];

export function createHost(): Host {
  document.querySelectorAll('pinpoint-root').forEach((n) => n.remove());
  const el = document.createElement('pinpoint-root');
  el.setAttribute('data-pinpoint-root', '');
  el.style.cssText = 'all:initial!important;position:fixed!important;top:0!important;left:0!important;width:0!important;height:0!important;z-index:2147483647!important;display:block!important;';
  const root = el.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS;
  root.appendChild(style);
  const container = document.createElement('div');
  container.className = 'pp';
  root.appendChild(container);
  const mk = (cls: string) => {
    const d = document.createElement('div');
    d.className = cls;
    container.appendChild(d);
    return d;
  };
  const pins = mk('layer pins');
  const overlay = mk('overlay hidden');
  const ui = mk('layer ui');
  const toasts = mk('toasts');
  const live = mk('sr');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('role', 'status');
  // Keep our keystrokes and clicks away from the page's own handlers.
  for (const t of STOP_EVENTS) root.addEventListener(t, (e) => e.stopPropagation());
  (document.documentElement || document.body).appendChild(el);
  return {
    el,
    root,
    container,
    pins,
    overlay,
    ui,
    toasts,
    live,
    setVisible(v) {
      el.style.setProperty('display', v ? 'block' : 'none', 'important');
    },
    destroy() {
      el.remove();
    },
  };
}

let toastHost: Host | null = null;
export function setToastHost(h: Host) {
  toastHost = h;
}

export function announce(text: string) {
  if (!toastHost) return;
  toastHost.live.textContent = '';
  setTimeout(() => toastHost && (toastHost.live.textContent = text), 30);
}

export function toast(message: string, opts: { kind?: 'info' | 'error'; action?: { label: string; run: () => void }; ms?: number } = {}) {
  if (!toastHost) return;
  const t = document.createElement('div');
  t.className = `toast${opts.kind === 'error' ? ' error' : ''}`;
  t.setAttribute('role', opts.kind === 'error' ? 'alert' : 'status');
  const span = document.createElement('span');
  span.textContent = message;
  t.appendChild(span);
  if (opts.action) {
    const b = document.createElement('button');
    b.textContent = opts.action.label;
    b.onclick = () => {
      opts.action!.run();
      t.remove();
    };
    t.appendChild(b);
  }
  toastHost.toasts.appendChild(t);
  setTimeout(() => t.remove(), opts.ms ?? (opts.action ? 8000 : 2600));
}

export function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
