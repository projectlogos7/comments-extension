// Comment body format ("markdown-lite"):
//   **bold**  *italic*  `code`  [label](https://url)  @[Display Name](userId)
// Rendering always escapes HTML first, so comment content can never inject markup (NFR Security).

const MENTION_RE = /@\[([^\]\n]{1,80})\]\(([A-Za-z0-9_-]{1,64})\)/g;

export function extractMentions(body: string): string[] {
  const ids = new Set<string>();
  for (const m of body.matchAll(MENTION_RE)) ids.add(m[2]);
  return [...ids];
}

export function mentionToken(name: string, userId: string): string {
  return `@[${name.replace(/[\[\]\n]/g, '')}](${userId})`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:') return u.toString();
  } catch {
    /* invalid */
  }
  return null;
}

/** Render a comment body to safe HTML. */
export function renderBody(body: string): string {
  // Pull out code spans first so their content is not formatted.
  const codes: string[] = [];
  let s = body.replace(/`([^`\n]+)`/g, (_, c: string) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = escapeHtml(s);
  // Mentions: @[Name](id)
  s = s.replace(/@\[([^\]\n]{1,80})\]\(([A-Za-z0-9_-]{1,64})\)/g, (_, name: string, id: string) => {
    return `<span class="pp-mention" data-user-id="${id}">@${name}</span>`;
  });
  // Links: [label](url)
  s = s.replace(/\[([^\]\n]{1,200})\]\(([^)\s]{1,2000})\)/g, (all, label: string, url: string) => {
    const href = safeHref(url.replace(/&amp;/g, '&'));
    if (!href) return all;
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  // Bare URLs
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, (all, pre: string, url: string) => {
    const href = safeHref(url.replace(/&amp;/g, '&'));
    if (!href) return all;
    return `${pre}<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code>${escapeHtml(codes[Number(i)])}</code>`);
  s = s.replace(/\n/g, '<br>');
  return s;
}

/** Plain-text version of a body (mentions become @Name, formatting removed). */
export function plainText(body: string): string {
  return body
    .replace(MENTION_RE, '@$1')
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1');
}

export function excerpt(body: string, max = 140): string {
  const t = plainText(body).replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/** Normalize visible text for fingerprints: collapse whitespace, trim, cap length. */
export function fingerprintText(text: string, max = 120): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Similarity of two strings in [0,1] using bigram Dice coefficient. */
export function textSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const A = a.toLowerCase();
  const B = b.toLowerCase();
  if (A.length < 2 || B.length < 2) return A === B ? 1 : 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < A.length - 1; i++) {
    const g = A.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < B.length - 1; i++) {
    const g = B.slice(i, i + 2);
    const n = grams.get(g) ?? 0;
    if (n > 0) {
      grams.set(g, n - 1);
      hits++;
    }
  }
  return (2 * hits) / (A.length - 1 + (B.length - 1));
}
