// DOM snapshot of the selected element (FR-4.11): sanitized HTML with key computed styles inlined.
// Scripts, event handlers, form values and javascript: URLs are removed.

const PROPS = [
  'display', 'position', 'box-sizing', 'width', 'height', 'margin', 'padding', 'border', 'border-radius', 'background-color', 'background-image',
  'color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'text-decoration',
  'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap', 'grid-template-columns', 'grid-template-rows', 'opacity', 'box-shadow',
  'overflow', 'white-space', 'z-index', 'top', 'left', 'right', 'bottom', 'transform',
];
const MAX_NODES = 600;
const MAX_BYTES = 512 * 1024;

export function domSnapshot(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  const src = [el, ...Array.from(el.querySelectorAll('*'))].slice(0, MAX_NODES);
  const dst = [clone, ...Array.from(clone.querySelectorAll('*'))].slice(0, MAX_NODES);
  const win = el.ownerDocument.defaultView ?? window;
  src.forEach((s, i) => {
    const d = dst[i];
    if (!d) return;
    const cs = win.getComputedStyle(s);
    const style = PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';');
    d.setAttribute('style', style);
  });
  clone.querySelectorAll('script,noscript,iframe,object,embed,template,link[rel="import"]').forEach((n) => n.remove());
  for (const n of [clone, ...Array.from(clone.querySelectorAll('*'))]) {
    for (const a of Array.from(n.attributes)) {
      const name = a.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc' || (/^(href|src|action|formaction|xlink:href)$/.test(name) && /^\s*javascript:/i.test(a.value))) n.removeAttribute(a.name);
    }
    if (n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement) {
      n.removeAttribute('value');
      if (n instanceof HTMLTextAreaElement) n.textContent = '';
    }
  }
  const base = `<base href="${location.href.replace(/"/g, '&quot;')}">`;
  let html = `<!doctype html><html><head><meta charset="utf-8">${base}<meta name="pinpoint-source" content="${encodeURIComponent(location.href)}"><title>DOM snapshot</title></head><body style="margin:16px">${clone.outerHTML}</body></html>`;
  if (html.length > MAX_BYTES) html = html.slice(0, MAX_BYTES);
  return html;
}
