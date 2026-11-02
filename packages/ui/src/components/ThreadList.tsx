import { excerpt, type Thread } from '@pinpoint/shared';
import { Avatar, Badge, capitalize, RelTime, StatusBadge } from './common';

export interface PageGroup {
  pageId: string;
  title: string;
  url: string;
  threads: Thread[];
}
export interface SiteGroup {
  site: string;
  pages: PageGroup[];
  count: number;
}

/** Group threads by site, then page, keeping the incoming (sorted) order within each group. */
export function groupThreads(threads: Thread[]): SiteGroup[] {
  const sites = new Map<string, Map<string, PageGroup>>();
  for (const t of threads) {
    const site = t.page?.site ?? 'unknown';
    let pages = sites.get(site);
    if (!pages) sites.set(site, (pages = new Map()));
    let g = pages.get(t.pageId);
    if (!g) pages.set(t.pageId, (g = { pageId: t.pageId, title: t.page?.title || t.page?.normalizedUrl || 'Untitled page', url: t.page?.normalizedUrl ?? '', threads: [] }));
    g.threads.push(t);
  }
  return [...sites].map(([site, pages]) => {
    const list = [...pages.values()];
    return { site, pages: list, count: list.reduce((n, p) => n + p.threads.length, 0) };
  });
}

export interface ThreadListProps {
  threads: Thread[];
  selected?: Set<string>;
  onToggleSelect?: (id: string, on: boolean) => void;
  onToggleAll?: (ids: string[], on: boolean) => void;
  onOpen: (t: Thread) => void;
  activeId?: string | null;
  grouped?: boolean;
}

export function ThreadList({ threads, selected, onToggleSelect, onToggleAll, onOpen, activeId, grouped = true }: ThreadListProps) {
  if (!grouped) {
    return (
      <ul class="pp-thread-list" role="list">
        {threads.map((t) => (
          <ThreadRow key={t.id} t={t} selected={selected?.has(t.id)} onToggleSelect={onToggleSelect} onOpen={onOpen} active={activeId === t.id} />
        ))}
      </ul>
    );
  }
  const groups = groupThreads(threads);
  return (
    <div class="pp-groups">
      {groups.map((s) => (
        <section key={s.site} class="pp-site-group" aria-label={`Site ${s.site}`}>
          <h3 class="pp-site-head">
            {onToggleAll && (
              <input
                type="checkbox"
                aria-label={`Select all on ${s.site}`}
                checked={s.pages.every((p) => p.threads.every((t) => selected?.has(t.id)))}
                onChange={(e) => onToggleAll(s.pages.flatMap((p) => p.threads.map((t) => t.id)), (e.target as HTMLInputElement).checked)}
              />
            )}
            <span>{s.site}</span>
            <span class="pp-count">{s.count}</span>
          </h3>
          {s.pages.map((p) => (
            <div key={p.pageId} class="pp-page-group">
              <h4 class="pp-page-head">
                <a href={p.url} target="_blank" rel="noopener noreferrer" title={p.url}>
                  {p.title}
                </a>
                <span class="pp-count">{p.threads.length}</span>
              </h4>
              <ul class="pp-thread-list" role="list">
                {p.threads.map((t) => (
                  <ThreadRow key={t.id} t={t} selected={selected?.has(t.id)} onToggleSelect={onToggleSelect} onOpen={onOpen} active={activeId === t.id} />
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

export function ThreadRow({
  t,
  selected,
  onToggleSelect,
  onOpen,
  active,
}: {
  t: Thread;
  selected?: boolean;
  onToggleSelect?: (id: string, on: boolean) => void;
  onOpen: (t: Thread) => void;
  active?: boolean;
}) {
  const text = t.firstComment ? excerpt(t.firstComment.body, 160) : '(no comment)';
  return (
    <li class={`pp-thread-row ${active ? 'pp-active' : ''} ${t.status === 'resolved' ? 'pp-resolved' : ''}`}>
      {onToggleSelect && (
        <input type="checkbox" aria-label={`Select thread ${t.number}`} checked={!!selected} onChange={(e) => onToggleSelect(t.id, (e.target as HTMLInputElement).checked)} />
      )}
      <button class="pp-thread-row-main" onClick={() => onOpen(t)} aria-label={`Thread ${t.number}: ${text}`}>
        <span class={`pp-pin-num ${t.status === 'resolved' ? 'pp-pin-resolved' : ''}`} aria-hidden="true">
          {t.scope === 'page' ? 'P' : t.number}
        </span>
        <span class="pp-row-body">
          <span class="pp-row-text">
            {t.unread && <span class="pp-unread-dot" aria-label="Unread" />}
            {text}
          </span>
          <span class="pp-row-meta">
            <Avatar user={t.author} size={16} />
            <span>{t.author?.name}</span>
            <StatusBadge status={t.status} />
            <Badge tone="scope">{capitalize(t.scope)}</Badge>
            {t.type && <Badge>{capitalize(t.type)}</Badge>}
            {t.priority && <Badge tone={`prio-${t.priority}`}>{capitalize(t.priority)}</Badge>}
            {t.detached && <Badge tone="warn">Detached</Badge>}
            {t.assignee && (
              <span class="pp-assignee" title={`Assigned to ${t.assignee.name}`}>
                → {t.assignee.name}
              </span>
            )}
            <span class="pp-grow" />
            {t.commentCount > 1 && <span title="Replies">💬 {t.commentCount - 1}</span>}
            <RelTime iso={t.lastActivityAt} />
          </span>
        </span>
      </button>
    </li>
  );
}
