// Text-range anchoring (FR-1.5): a quote with prefix/suffix context, re-found by text search.
import type { TextRangeRef } from '@pinpoint/shared';

const CTX = 32;

interface TextIndex {
  text: string;
  nodes: { node: Text; start: number }[];
}

function indexText(root: Node): TextIndex {
  const doc = (root.ownerDocument ?? root) as Document;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const nodes: { node: Text; start: number }[] = [];
  let text = '';
  let n = walker.nextNode() as Text | null;
  while (n) {
    const p = n.parentElement;
    const tag = p?.tagName.toLowerCase();
    if (tag !== 'script' && tag !== 'style' && tag !== 'noscript' && !p?.closest('[data-pinpoint-root]')) {
      nodes.push({ node: n, start: text.length });
      text += n.data;
    }
    n = walker.nextNode() as Text | null;
  }
  return { text, nodes };
}

function locate(idx: TextIndex, offset: number): { node: Text; offset: number } | null {
  let lo = 0,
    hi = idx.nodes.length - 1,
    found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (idx.nodes[mid].start <= offset) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found < 0) return null;
  const e = idx.nodes[found];
  return { node: e.node, offset: Math.min(offset - e.start, e.node.data.length) };
}

/** Describe a DOM Range as text + surrounding context. */
export function describeRange(range: Range, root: Node): TextRangeRef {
  const idx = indexText(root);
  const text = range.toString();
  let startOffset = -1;
  const sc = range.startContainer;
  if (sc.nodeType === 3) {
    const e = idx.nodes.find((n) => n.node === sc);
    if (e) startOffset = e.start + range.startOffset;
  } else {
    // Element container: first indexed text node at or after the boundary.
    const child = sc.childNodes[range.startOffset] ?? null;
    const e = idx.nodes.find((n) => (child ? child === n.node || child.contains(n.node) || !!(child.compareDocumentPosition(n.node) & 4) : sc.contains(n.node)));
    if (e) startOffset = e.start;
  }
  if (startOffset < 0) startOffset = Math.max(0, idx.text.indexOf(text));
  return {
    text: text.slice(0, 2000),
    prefix: idx.text.slice(Math.max(0, startOffset - CTX), startOffset),
    suffix: idx.text.slice(startOffset + text.length, startOffset + text.length + CTX),
  };
}

function norm(s: string) {
  return s.replace(/\s+/g, ' ');
}

/** Find the quote again. Returns offsets in the concatenated text and a Range, or null. */
export function findTextRange(root: Node, ref: TextRangeRef): { range: Range; exact: boolean } | null {
  if (!ref.text) return null;
  const idx = indexText(root);
  const hay = idx.text;
  const candidates: number[] = [];
  let from = 0;
  for (;;) {
    const i = hay.indexOf(ref.text, from);
    if (i < 0) break;
    candidates.push(i);
    from = i + 1;
    if (candidates.length > 200) break;
  }
  let start = -1;
  let exact = false;
  if (candidates.length) {
    let best = -1;
    let bestScore = -1;
    for (const c of candidates) {
      const pre = hay.slice(Math.max(0, c - ref.prefix.length), c);
      const suf = hay.slice(c + ref.text.length, c + ref.text.length + ref.suffix.length);
      let s = 0;
      if (ref.prefix && norm(pre).endsWith(norm(ref.prefix).slice(-12))) s += 1;
      if (ref.suffix && norm(suf).startsWith(norm(ref.suffix).slice(0, 12))) s += 1;
      if (pre === ref.prefix) s += 1;
      if (suf === ref.suffix) s += 1;
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    start = best;
    exact = bestScore >= 2 || candidates.length === 1;
  } else {
    // Whitespace-insensitive fallback.
    const target = norm(ref.text).trim();
    const n = norm(hay);
    const i = n.indexOf(target);
    if (i < 0) return null;
    // Map normalized index back: walk original string counting normalized chars.
    let oi = 0,
      ni = 0;
    while (ni < i && oi < hay.length) {
      if (/\s/.test(hay[oi])) {
        while (oi < hay.length && /\s/.test(hay[oi])) oi++;
        ni++;
      } else {
        oi++;
        ni++;
      }
    }
    start = oi;
  }
  const end = start + ref.text.length;
  const s = locate(idx, start);
  const e = locate(idx, Math.min(end, hay.length));
  if (!s || !e) return null;
  const range = root.ownerDocument!.createRange();
  range.setStart(s.node, s.offset);
  range.setEnd(e.node, e.offset);
  return { range, exact };
}
