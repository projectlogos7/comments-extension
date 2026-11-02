// Bridge to the page-world helper for framework component detection (FR-6.2).
import type { ComponentRef } from '@pinpoint/shared';
import { uid } from '@pinpoint/shared';
import { bg } from '../lib/messaging';

let channel: string | null = null;
let ready: Promise<boolean> | null = null;
const pending = new Map<string, (c: ComponentRef | null) => void>();

function ensure(): Promise<boolean> {
  if (ready) return ready;
  channel = uid('ch');
  document.documentElement.setAttribute('data-pinpoint-channel', channel);
  window.addEventListener('message', (ev) => {
    const d = ev.data as { channel?: string; kind?: string; id?: string; component?: ComponentRef | null };
    if (ev.source !== window || !d || d.channel !== channel || d.kind !== 'component.result' || !d.id) return;
    pending.get(d.id)?.(d.component ?? null);
    pending.delete(d.id);
  });
  ready = bg<boolean>({ type: 'content.injectPageworld' }).catch(() => false);
  return ready;
}

/** Find the framework component that renders `el`. Resolves null on failure or after `timeoutMs`. */
export async function detectComponent(el: Element, timeoutMs = 400): Promise<ComponentRef | null> {
  if (el.ownerDocument !== document || el.getRootNode() !== document) return null; // page world sees only the top document tree
  const ok = await ensure();
  if (!ok || !channel) return null;
  const id = uid('p');
  el.setAttribute('data-pinpoint-probe', id);
  try {
    return await new Promise<ComponentRef | null>((resolve) => {
      pending.set(id, resolve);
      window.postMessage({ channel, kind: 'component', id }, '*');
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          resolve(null);
        }
      }, timeoutMs);
    });
  } finally {
    el.removeAttribute('data-pinpoint-probe');
  }
}
