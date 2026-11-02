// Section detection (FR-3.2, FR-3.3): landmarks, headings with following content, large containers.
import { fingerprintText } from '@pinpoint/shared';

const LANDMARK_TAGS = new Set(['header', 'nav', 'main', 'section', 'article', 'aside', 'footer', 'form', 'dialog']);
const LANDMARK_ROLES = new Set(['banner', 'navigation', 'main', 'region', 'contentinfo', 'complementary', 'form', 'search', 'dialog', 'article']);
const HEADING_SEL = 'h1,h2,h3,h4,h5,h6,[role="heading"]';

export function landmarkName(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role');
  if (role && LANDMARK_ROLES.has(role)) return role;
  if (LANDMARK_TAGS.has(tag)) return tag;
  return null;
}

/** Heading that introduces a container: a heading among its first few descendants. */
export function sectionHeading(el: Element): string {
  const label = el.getAttribute('aria-label');
  if (label) return fingerprintText(label, 80);
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const lab = el.ownerDocument.getElementById(labelledBy.split(/\s+/)[0]);
    if (lab?.textContent) return fingerprintText(lab.textContent, 80);
  }
  const h = el.querySelector(HEADING_SEL);
  if (h && h.textContent) {
    // Only count it if it is near the top of the container (within the first 3 levels).
    let depth = 0;
    for (let p = h.parentElement; p && p !== el; p = p.parentElement) depth++;
    if (depth <= 3) return fingerprintText(h.textContent, 80);
  }
  return '';
}

function hasLeadingHeading(el: Element): boolean {
  const first = Array.from(el.children).slice(0, 3);
  return first.some((c) => c.matches(HEADING_SEL) || (c.children.length <= 3 && !!c.querySelector(':scope > ' + HEADING_SEL.split(',').join(', :scope > '))));
}

function isLarge(el: Element, viewport: { w: number; h: number }): boolean {
  const r = el.getBoundingClientRect();
  return r.width >= viewport.w * 0.6 && r.height >= 120;
}

/**
 * Candidate sections containing `el`, innermost first. Includes landmark elements, containers that
 * start with a heading, and large full-width containers. body/html are never returned.
 */
export function sectionCandidates(el: Element, viewport = { w: globalThis.innerWidth || 1280, h: globalThis.innerHeight || 800 }): Element[] {
  const out: Element[] = [];
  let cur: Element | null = el;
  while (cur) {
    const tag = cur.tagName.toLowerCase();
    if (tag === 'body' || tag === 'html') break;
    if (landmarkName(cur) || hasLeadingHeading(cur) || isLarge(cur, viewport)) {
      if (!out.includes(cur)) out.push(cur);
    }
    cur = cur.parentElement;
  }
  if (!out.length && el.tagName.toLowerCase() !== 'body') {
    // Fall back to the outermost non-body ancestor.
    let top: Element = el;
    while (top.parentElement && !['body', 'html'].includes(top.parentElement.tagName.toLowerCase())) top = top.parentElement;
    out.push(top);
  }
  return out;
}

export function sectionInfo(el: Element): { landmark: string; heading: string } {
  return { landmark: landmarkName(el) ?? el.tagName.toLowerCase(), heading: sectionHeading(el) };
}

/** Find a section again by its landmark + heading when selectors fail (content inside may have reordered). */
export function findSectionByInfo(root: Document | ShadowRoot, info: { landmark: string; heading: string }): Element | null {
  if (!info.heading) return null;
  const sel = LANDMARK_TAGS.has(info.landmark) ? info.landmark : LANDMARK_ROLES.has(info.landmark) ? `[role="${info.landmark}"]` : info.landmark;
  let list: Element[] = [];
  try {
    list = Array.from(root.querySelectorAll(sel));
  } catch {
    return null;
  }
  return list.find((e) => sectionHeading(e) === info.heading) ?? null;
}
