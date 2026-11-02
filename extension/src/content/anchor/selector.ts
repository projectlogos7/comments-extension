// Stable selector generation (FR-1.10, FR-1.11).
// Prefers test ids, ids, aria labels, roles and names; ignores generated class names and ids.

export const TEST_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa', 'data-pw', 'data-component'];

export function cssEscape(value: string): string {
  const g = globalThis as { CSS?: { escape?: (s: string) => string } };
  if (g.CSS?.escape) return g.CSS.escape(value);
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    const code = value.charCodeAt(i);
    if (code === 0) out += '�';
    else if ((code >= 0x1 && code <= 0x1f) || code === 0x7f || (i === 0 && code >= 48 && code <= 57) || (i === 1 && code >= 48 && code <= 57 && value[0] === '-'))
      out += '\\' + code.toString(16) + ' ';
    else if (i === 0 && ch === '-' && value.length === 1) out += '\\-';
    else if (/[a-zA-Z0-9_\- -￿]/.test(ch)) out += ch;
    else out += '\\' + ch;
  }
  return out;
}

function attrValue(v: string): string {
  return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ') + '"';
}

/** Class names produced by CSS-in-JS, CSS modules, Tailwind arbitrary values, or build hashes. */
export function isGeneratedClass(c: string): boolean {
  if (!c || c.length > 40) return true;
  if (/^(css|sc|jsx|emotion|svelte|styled|jss|tw|chakra-ui|astro|vue|v|ng-tns|ng-star|_ngcontent|_nghost)-/i.test(c) && /[\d]/.test(c)) return true;
  if (/^(css|sc|jsx|emotion|svelte|jss)-[a-z0-9]+$/i.test(c)) return true;
  if (/^(ng-|cdk-|is-|has-)?(active|focus|focused|hover|hovered|selected|open|visible|hidden|disabled|loading|animating|ng-dirty|ng-pristine|ng-touched|ng-untouched|ng-valid|ng-invalid)$/.test(c)) return true; // state classes change
  if (/[\[\]:/!@%#()]/.test(c)) return true; // tailwind variants & arbitrary values: md:flex, w-[13px], hover:bg-x
  if (/__[a-zA-Z0-9_-]{5,}$/.test(c) && /\d/.test(c.split('__').pop() ?? '')) return true; // CSS modules: Button_root__3xYz1
  if (/_[a-zA-Z0-9]{5,}$/.test(c) && /\d/.test(c.slice(-6)) && /[A-Z]/.test(c.slice(-6))) return true;
  if (/\d{3,}/.test(c)) return true;
  if (/^[a-zA-Z0-9]{6,}$/.test(c) && /\d/.test(c) && /[a-z]/.test(c) && /[A-Z]/.test(c)) return true; // random token
  if (/^[a-f0-9]{6,}$/i.test(c) && /\d/.test(c)) return true; // hex hash
  if (/^[a-z]{1,2}[0-9a-z]{4,7}$/.test(c) && (c.match(/\d/g)?.length ?? 0) >= 2) return true; // e.g. "x1n2onr6" atomic
  return false;
}

/** Ids that are generated per render/session and therefore unstable. */
export function isGeneratedId(id: string): boolean {
  if (!id || id.length > 64) return true;
  if (/^(:r|«r)|^:|:$/.test(id)) return true; // React useId
  if (/^(radix-|headlessui-|react-select-|react-aria|mui-|ember\d|ext-gen|yui_|uid[-_]|id[-_]\d|__next|rc[-_]|tippy-|downshift-|aria-\d|mat-|cdk-|ng-|vs\d|pv_id_)/i.test(id)) return true;
  if (/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id)) return true; // uuid
  if (/\d{4,}/.test(id)) return true;
  if (/^[a-zA-Z0-9]{8,}$/.test(id) && /\d/.test(id) && /[a-zA-Z]/.test(id) && !/^[a-z]+[A-Z]?[a-z]*\d?$/.test(id)) return true;
  return false;
}

export type QueryRoot = Document | ShadowRoot | DocumentFragment;

export function rootOf(el: Element): QueryRoot {
  const r = el.getRootNode() as QueryRoot;
  return r && 'querySelectorAll' in r ? r : el.ownerDocument;
}

export function isUnique(root: QueryRoot, selector: string, el: Element): boolean {
  try {
    const found = root.querySelectorAll(selector);
    return found.length === 1 && found[0] === el;
  } catch {
    return false;
  }
}

export function stableClasses(el: Element): string[] {
  const list = Array.from(el.classList ?? []);
  return list.filter((c) => !isGeneratedClass(c)).slice(0, 3);
}

/** Identifying selectors for one element without ancestors, best first. */
export function ownSelectors(el: Element): string[] {
  const tag = el.tagName.toLowerCase();
  const out: string[] = [];
  for (const a of TEST_ATTRS) {
    const v = el.getAttribute(a);
    if (v && v.length <= 80) out.push(`[${a}=${attrValue(v)}]`);
  }
  const id = el.getAttribute('id');
  if (id && !isGeneratedId(id)) out.push(`#${cssEscape(id)}`);
  const aria = el.getAttribute('aria-label');
  if (aria && aria.length <= 80) out.push(`${tag}[aria-label=${attrValue(aria)}]`);
  const name = el.getAttribute('name');
  if (name && name.length <= 60 && !isGeneratedId(name)) out.push(`${tag}[name=${attrValue(name)}]`);
  const role = el.getAttribute('role');
  const classes = stableClasses(el);
  if (role) out.push(`${tag}[role=${attrValue(role)}]${classes.length ? '.' + classes.map(cssEscape).join('.') : ''}`);
  for (const attr of ['href', 'src', 'for', 'type', 'placeholder', 'alt', 'title']) {
    const v = el.getAttribute(attr);
    if (!v || v.length > 100 || /^(data:|javascript:)/i.test(v)) continue;
    if ((attr === 'href' || attr === 'src') && /[?&](token|sig|session|t)=|\d{6,}/i.test(v)) continue;
    out.push(`${tag}[${attr}=${attrValue(v)}]`);
  }
  if (classes.length) out.push(`${tag}.${classes.map(cssEscape).join('.')}`);
  return out;
}

function nthOfType(el: Element): number {
  let n = 1;
  for (let s = el.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === el.tagName) n++;
  return n;
}

function hasSameTagSiblings(el: Element): boolean {
  const p = el.parentElement;
  if (!p) return false;
  for (const c of Array.from(p.children)) if (c !== el && c.tagName === el.tagName) return true;
  return false;
}

/** Segment for one ancestor level: the most stable short description of the element. */
function segment(el: Element): { sel: string; strong: boolean } {
  const tag = el.tagName.toLowerCase();
  for (const a of TEST_ATTRS) {
    const v = el.getAttribute(a);
    if (v && v.length <= 80) return { sel: `[${a}=${attrValue(v)}]`, strong: true };
  }
  const id = el.getAttribute('id');
  if (id && !isGeneratedId(id)) return { sel: `#${cssEscape(id)}`, strong: true };
  const classes = stableClasses(el);
  let sel = tag + (classes.length ? '.' + classes.map(cssEscape).join('.') : '');
  const p = el.parentElement;
  if (p) {
    let ambiguous = false;
    try {
      ambiguous = Array.from(p.children).filter((c) => c !== el && c.matches(sel)).length > 0;
    } catch {
      ambiguous = hasSameTagSiblings(el);
    }
    if (ambiguous) sel += `:nth-of-type(${nthOfType(el)})`;
  }
  return { sel, strong: false };
}

/** A unique selector built from ancestor segments, stopping at the first strong (id/test-id) ancestor. */
export function pathSelector(el: Element, maxDepth = 8): string | null {
  const root = rootOf(el);
  const parts: string[] = [];
  let cur: Element | null = el;
  let depth = 0;
  while (cur && depth < maxDepth) {
    const tag = cur.tagName.toLowerCase();
    if (tag === 'html') break;
    const seg = segment(cur);
    parts.unshift(seg.sel);
    const candidate = parts.join(' > ');
    if (isUnique(root, candidate, el)) return candidate;
    if (seg.strong || tag === 'body') {
      // Try a descendant combinator from the strong ancestor to keep it short.
      if (parts.length > 2) {
        const short = `${parts[0]} ${parts[parts.length - 1]}`;
        if (isUnique(root, short, el)) return short;
      }
    }
    cur = cur.parentElement;
    depth++;
  }
  const candidate = parts.join(' > ');
  return isUnique(root, candidate, el) ? candidate : null;
}

/** Ordered, de-duplicated, verified-unique selector candidates for an element. */
export function selectorCandidates(el: Element, max = 4): string[] {
  const root = rootOf(el);
  const out: string[] = [];
  const add = (s: string | null) => {
    if (s && !out.includes(s) && isUnique(root, s, el)) out.push(s);
  };
  const own = ownSelectors(el);
  for (const s of own) add(s);
  // Scope own selectors under the nearest strong ancestor when not unique on their own.
  if (out.length < 2) {
    let anc = el.parentElement;
    while (anc && anc.tagName.toLowerCase() !== 'body') {
      const seg = segment(anc);
      if (seg.strong) {
        for (const s of own.slice(0, 3)) add(`${seg.sel} ${s}`);
        break;
      }
      anc = anc.parentElement;
    }
  }
  add(pathSelector(el));
  return out.slice(0, max);
}

/** Absolute XPath with positional indexes, e.g. /html/body/main/section[2]/div[1]. Scoped to the element's root. */
export function xpathFor(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1) {
    const tag = cur.tagName.toLowerCase();
    const hasSiblings = hasSameTagSiblings(cur);
    parts.unshift(hasSiblings ? `${tag}[${nthOfType(cur)}]` : tag);
    cur = cur.parentElement;
  }
  return '/' + parts.join('/');
}

/** Evaluate the simple absolute XPaths produced by xpathFor (no full XPath engine needed). */
export function evalXpath(root: QueryRoot, xpath: string): Element | null {
  const steps = xpath.split('/').filter(Boolean);
  let nodes: Element[] = Array.from(root.children ?? []);
  let cur: Element | null = null;
  for (const step of steps) {
    const m = step.match(/^([a-zA-Z0-9_-]+)(?:\[(\d+)\])?$/);
    if (!m) return null;
    const tag = m[1].toUpperCase();
    const idx = m[2] ? Number(m[2]) : 1;
    const matches = nodes.filter((n) => n.tagName.toUpperCase() === tag);
    cur = matches[idx - 1] ?? null;
    if (!cur) return null;
    nodes = Array.from(cur.children);
  }
  return cur;
}

/** html > body > main:nth-child(2) > ... — a CSS selector that only encodes structure. */
export function structuralPath(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1) {
    const tag = cur.tagName.toLowerCase();
    const p: Element | null = cur.parentElement;
    if (!p) {
      parts.unshift(tag);
      break;
    }
    const idx = Array.from(p.children).indexOf(cur) + 1;
    parts.unshift(`${tag}:nth-child(${idx})`);
    cur = p;
  }
  return parts.join(' > ');
}

/** Selector chain for open shadow hosts from the document down to the element's root. */
export function shadowHostChain(el: Element): { hosts: string[]; ok: boolean } {
  const hosts: string[] = [];
  let node: Element = el;
  let root = node.getRootNode();
  while (root && (root as ShadowRoot).host) {
    const host = (root as ShadowRoot).host;
    const sel = selectorCandidates(host, 1)[0] ?? pathSelector(host);
    if (!sel) return { hosts, ok: false };
    hosts.unshift(sel);
    node = host;
    root = node.getRootNode();
  }
  return { hosts, ok: true };
}

/** Resolve a root (document or nested shadow root) from frame/shadow selector chains. */
export function resolveRoot(doc: Document, frames: string[] = [], shadowHosts: string[] = []): QueryRoot | null {
  let d: Document = doc;
  for (const f of frames) {
    const iframe = d.querySelector(f) as HTMLIFrameElement | null;
    try {
      const cd = iframe?.contentDocument;
      if (!cd) return null;
      d = cd;
    } catch {
      return null;
    }
  }
  let root: QueryRoot = d;
  for (const h of shadowHosts) {
    const host = root.querySelector(h);
    const sr = host?.shadowRoot;
    if (!sr) return null;
    root = sr;
  }
  return root;
}
