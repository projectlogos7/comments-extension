import type { Anchor, Comment, Thread, ThreadDetail } from './types';
import { plainText } from './text';

// Formatters for "Copy as" (FR-6.1) and bulk export (FR-6.3). PDF is rendered on the server.

export interface ExportContext {
  /** Builds the share-link URL for a thread (may be null when the thread has no link yet). */
  shareUrl: (thread: Thread) => string | null;
}

export function bestSelector(anchor: Anchor): string | null {
  return anchor.selectors?.[0] ?? anchor.targets?.[0]?.selectors?.[0] ?? null;
}

export function jsPath(anchor: Anchor): string | null {
  if (anchor.jsPath) return anchor.jsPath;
  const sel = bestSelector(anchor);
  if (!sel) return null;
  let expr = 'document';
  for (const f of anchor.frames ?? []) expr += `.querySelector(${JSON.stringify(f)}).contentDocument`;
  for (const h of anchor.shadowHosts ?? []) expr += `.querySelector(${JSON.stringify(h)}).shadowRoot`;
  return `${expr}.querySelector(${JSON.stringify(sel)})`;
}

export function componentLabel(anchor: Anchor): string | null {
  const c = anchor.component;
  if (!c) return null;
  const loc = c.file ? ` (${c.file}${c.line ? `:${c.line}` : ''})` : '';
  return `<${c.name}>${loc} [${c.framework}]`;
}

function authorName(c: Comment | null | undefined) {
  return c?.author?.name || c?.author?.email || 'Unknown';
}

export function threadTitle(thread: Thread): string {
  const first = thread.firstComment ? plainText(thread.firstComment.body).split('\n')[0] : '';
  const t = first.trim() || `Thread #${thread.number}`;
  return t.length > 80 ? t.slice(0, 79) + '…' : t;
}

/** Markdown for a single thread (copy as Markdown, Markdown export entry). */
export function threadToMarkdown(thread: Thread | ThreadDetail, ctx: ExportContext, level = 2): string {
  const h = '#'.repeat(level);
  const lines: string[] = [];
  lines.push(`${h} #${thread.number} ${threadTitle(thread)}`);
  lines.push('');
  const meta: string[] = [
    `**Status:** ${thread.status}`,
    `**Scope:** ${thread.scope}`,
    `**Author:** ${thread.author?.name ?? 'Unknown'}`,
  ];
  if (thread.assignee) meta.push(`**Assignee:** ${thread.assignee.name}`);
  if (thread.type) meta.push(`**Type:** ${thread.type}`);
  if (thread.priority) meta.push(`**Priority:** ${thread.priority}`);
  if (thread.detached) meta.push('**Anchor:** detached');
  lines.push(meta.join(' · '));
  lines.push(`**Page:** [${thread.page.title || thread.page.normalizedUrl}](${thread.page.normalizedUrl})`);
  const sel = bestSelector(thread.anchor);
  if (sel) lines.push(`**Selector:** \`${sel}\``);
  const comp = componentLabel(thread.anchor);
  if (comp) lines.push(`**Component:** \`${comp}\``);
  const link = ctx.shareUrl(thread);
  if (link) lines.push(`**Link:** ${link}`);
  const snap = thread.snapshots.find((s) => s.kind === 'area') ?? thread.snapshots[0];
  if (snap) lines.push(`**Snapshot:** ${snap.url}`);
  lines.push('');
  const comments = 'comments' in thread ? thread.comments : thread.firstComment ? [thread.firstComment] : [];
  for (const c of comments) {
    if (c.deletedAt) continue;
    const body = plainText(c.body)
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n');
    lines.push(`**${authorName(c)}** · ${c.createdAt.slice(0, 16).replace('T', ' ')}`);
    lines.push(body);
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}

/** "AI prompt" copy option (PRD §10). */
export function threadToAiPrompt(thread: Thread | ThreadDetail, ctx: ExportContext): string {
  const a = thread.anchor;
  const comments = 'comments' in thread ? thread.comments.filter((c) => !c.deletedAt) : thread.firstComment ? [thread.firstComment] : [];
  const parts = [
    'You are helping fix a piece of UI feedback left on a live web page.',
    '',
    `Page URL: ${thread.page.normalizedUrl}`,
    `Page title: ${thread.page.title}`,
    `Scope: ${thread.scope}`,
  ];
  const sel = bestSelector(a);
  if (sel) parts.push(`CSS selector: ${sel}`);
  if (a.xpath) parts.push(`XPath: ${a.xpath}`);
  const comp = componentLabel(a);
  if (comp) parts.push(`Component: ${comp}`);
  if (a.textFingerprint) parts.push(`Element text: "${a.textFingerprint}"`);
  if (a.htmlSnippet) parts.push('', 'Element HTML:', '```html', a.htmlSnippet.slice(0, 1200), '```');
  parts.push('', 'Feedback:');
  for (const c of comments) parts.push(`- ${authorName(c)}: ${plainText(c.body)}`);
  const link = ctx.shareUrl(thread);
  const snap = thread.snapshots.find((s) => s.kind === 'area') ?? thread.snapshots[0];
  if (link) parts.push('', `Thread and snapshot: ${link}`);
  else if (snap) parts.push('', `Snapshot: ${snap.url}`);
  parts.push('', 'Find the code that renders this element, explain the cause, and propose a minimal change.');
  return parts.join('\n');
}

export function threadsToMarkdown(threads: (Thread | ThreadDetail)[], ctx: ExportContext, title = 'Pinpoint export'): string {
  const out: string[] = [`# ${title}`, '', `${threads.length} thread${threads.length === 1 ? '' : 's'} · exported ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, ''];
  const byPage = groupByPage(threads);
  for (const [, group] of byPage) {
    const p = group[0].page;
    out.push(`## ${p.title || p.normalizedUrl}`);
    out.push(p.normalizedUrl);
    out.push('');
    for (const t of group) out.push(threadToMarkdown(t, ctx, 3));
  }
  return out.join('\n');
}

export function groupByPage<T extends Thread>(threads: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const t of threads) {
    const arr = m.get(t.pageId) ?? [];
    arr.push(t);
    m.set(t.pageId, arr);
  }
  return m;
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  // Guard against CSV formula injection in spreadsheet apps.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const CSV_COLUMNS = [
  'number',
  'page_title',
  'page_url',
  'scope',
  'status',
  'author',
  'assignee',
  'type',
  'priority',
  'first_comment',
  'comments',
  'selector',
  'component',
  'created_at',
  'last_activity_at',
  'resolved_at',
  'detached',
  'link',
] as const;

export function threadsToCsv(threads: Thread[], ctx: ExportContext): string {
  const rows = [CSV_COLUMNS.join(',')];
  for (const t of threads) {
    rows.push(
      [
        t.number,
        t.page.title,
        t.page.normalizedUrl,
        t.scope,
        t.status,
        t.author?.name,
        t.assignee?.name ?? '',
        t.type ?? '',
        t.priority ?? '',
        t.firstComment ? plainText(t.firstComment.body) : '',
        t.commentCount,
        bestSelector(t.anchor) ?? '',
        t.anchor.component?.name ?? '',
        t.createdAt,
        t.lastActivityAt,
        t.resolvedAt ?? '',
        t.detached ? 'yes' : 'no',
        ctx.shareUrl(t) ?? '',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return rows.join('\r\n') + '\r\n';
}

export function threadsToJson(threads: (Thread | ThreadDetail)[], ctx: ExportContext): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      count: threads.length,
      threads: threads.map((t) => ({ ...t, link: ctx.shareUrl(t) })),
    },
    null,
    2,
  );
}
