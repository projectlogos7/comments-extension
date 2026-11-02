// Page-side helpers for full-page scroll-and-stitch capture (FR-4.2).
import type { ContentMessage } from '@pinpoint/shared';
import type { Host } from './host';
import { nextFrame } from './host';

export function installCaptureHandlers(getHost: () => Host | null) {
  let saved: { x: number; y: number; behavior: string } | null = null;
  let hidden: { el: HTMLElement; vis: string; prio: string }[] = [];

  function hideFixed() {
    if (hidden.length) return;
    const all = document.body ? document.body.querySelectorAll<HTMLElement>('*') : [];
    let n = 0;
    for (const el of Array.from(all)) {
      if (++n > 20000) break;
      const pos = getComputedStyle(el).position;
      if (pos === 'fixed' || pos === 'sticky') {
        hidden.push({ el, vis: el.style.getPropertyValue('visibility'), prio: el.style.getPropertyPriority('visibility') });
        el.style.setProperty('visibility', 'hidden', 'important');
      }
    }
  }

  function restore() {
    for (const h of hidden) {
      if (h.vis) h.el.style.setProperty('visibility', h.vis, h.prio);
      else h.el.style.removeProperty('visibility');
    }
    hidden = [];
    if (saved) {
      window.scrollTo(saved.x, saved.y);
      document.documentElement.style.scrollBehavior = saved.behavior;
      saved = null;
    }
    getHost()?.setVisible(true);
  }

  return async (msg: ContentMessage): Promise<unknown> => {
    switch (msg.type) {
      case 'capture.metrics': {
        const d = document.documentElement;
        return {
          scrollHeight: Math.max(d.scrollHeight, document.body?.scrollHeight ?? 0),
          scrollWidth: Math.max(d.scrollWidth, document.body?.scrollWidth ?? 0),
          viewportH: innerHeight,
          viewportW: innerWidth,
          dpr: devicePixelRatio || 1,
          scrollX,
          scrollY,
        };
      }
      case 'capture.prepare':
        if (!saved) saved = { x: scrollX, y: scrollY, behavior: document.documentElement.style.scrollBehavior };
        document.documentElement.style.scrollBehavior = 'auto';
        getHost()?.setVisible(false);
        if (msg.hideFixed) hideFixed();
        return null;
      case 'capture.scrollTo':
        window.scrollTo(0, msg.y);
        await nextFrame();
        await nextFrame();
        await new Promise((r) => setTimeout(r, 120)); // lazy images and scroll-linked effects
        return Math.round(scrollY);
      case 'capture.restore':
        restore();
        return null;
    }
    return null;
  };
}
