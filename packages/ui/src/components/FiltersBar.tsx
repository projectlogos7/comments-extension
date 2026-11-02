import { useEffect, useState } from 'preact/hooks';
import { PRIORITIES, SCOPES, THREAD_TYPES, type Member, type Page, type ThreadFilters, type ThreadSort } from '@pinpoint/shared';
import { capitalize } from './common';

export interface FiltersBarProps {
  filters: ThreadFilters;
  sort: ThreadSort;
  members: Member[];
  sites?: string[];
  pages?: Pick<Page, 'id' | 'title' | 'normalizedUrl' | 'site'>[];
  onChange: (filters: ThreadFilters, sort: ThreadSort) => void;
}

/** Remove empty values so filter objects compare and serialize cleanly. */
export function cleanFilters(f: ThreadFilters): ThreadFilters {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '' && v !== false && v !== null) out[k] = v;
  return out as ThreadFilters;
}

export function activeFilterCount(f: ThreadFilters): number {
  return Object.keys(cleanFilters(f)).filter((k) => k !== 'q').length;
}

export function FiltersBar({ filters, sort, members, sites = [], pages = [], onChange }: FiltersBarProps) {
  const [q, setQ] = useState(filters.q ?? '');
  useEffect(() => setQ(filters.q ?? ''), [filters.q]);
  useEffect(() => {
    if ((filters.q ?? '') === q) return;
    const t = setTimeout(() => onChange(cleanFilters({ ...filters, q }), sort), 300);
    return () => clearTimeout(t);
  }, [q]);

  const set = <K extends keyof ThreadFilters>(k: K, v: ThreadFilters[K] | '') => onChange(cleanFilters({ ...filters, [k]: v === '' ? undefined : v }), sort);
  const sel = (e: Event) => (e.target as HTMLSelectElement).value;
  const visiblePages = filters.site ? pages.filter((p) => p.site === filters.site) : pages;

  return (
    <div class="pp-filters" role="search" aria-label="Filter comments">
      <input
        type="search"
        class="pp-search"
        placeholder="Search comments, replies, page titles…"
        aria-label="Search"
        value={q}
        onInput={(e) => setQ((e.target as HTMLInputElement).value)}
      />
      <div class="pp-filter-row">
        <select aria-label="Status" value={filters.status ?? ''} onChange={(e) => set('status', sel(e) as ThreadFilters['status'])}>
          <option value="">Any status</option>
          <option value="open">Open</option>
          <option value="resolved">Resolved</option>
        </select>
        <select aria-label="Author" value={filters.authorId ?? ''} onChange={(e) => set('authorId', sel(e))}>
          <option value="">Any author</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.user.name || m.user.email}
            </option>
          ))}
        </select>
        <select
          aria-label="Assignee"
          value={filters.unassigned ? '__none' : filters.assigneeId ?? ''}
          onChange={(e) => {
            const v = sel(e);
            onChange(cleanFilters({ ...filters, assigneeId: v && v !== '__none' ? v : undefined, unassigned: v === '__none' || undefined }), sort);
          }}
        >
          <option value="">Any assignee</option>
          <option value="__none">Unassigned</option>
          {members
            .filter((m) => m.role !== 'guest')
            .map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.user.name || m.user.email}
              </option>
            ))}
        </select>
        <select aria-label="Scope" value={filters.scope ?? ''} onChange={(e) => set('scope', sel(e) as ThreadFilters['scope'])}>
          <option value="">Any scope</option>
          {SCOPES.map((s) => (
            <option key={s} value={s}>
              {capitalize(s)}
            </option>
          ))}
        </select>
        <select aria-label="Type" value={filters.type ?? ''} onChange={(e) => set('type', sel(e) as ThreadFilters['type'])}>
          <option value="">Any type</option>
          {THREAD_TYPES.map((s) => (
            <option key={s} value={s}>
              {capitalize(s)}
            </option>
          ))}
        </select>
        <select aria-label="Priority" value={filters.priority ?? ''} onChange={(e) => set('priority', sel(e) as ThreadFilters['priority'])}>
          <option value="">Any priority</option>
          {PRIORITIES.map((s) => (
            <option key={s} value={s}>
              {capitalize(s)}
            </option>
          ))}
        </select>
        {sites.length > 0 && (
          <select aria-label="Site" value={filters.site ?? ''} onChange={(e) => onChange(cleanFilters({ ...filters, site: sel(e) || undefined, pageId: undefined }), sort)}>
            <option value="">All sites</option>
            {sites.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        {visiblePages.length > 0 && (
          <select aria-label="Page" value={filters.pageId ?? ''} onChange={(e) => set('pageId', sel(e))}>
            <option value="">All pages</option>
            {visiblePages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title || p.normalizedUrl}
              </option>
            ))}
          </select>
        )}
        <label class="pp-inline">
          <span>From</span>
          <input type="date" aria-label="From date" value={filters.from ?? ''} onChange={(e) => set('from', (e.target as HTMLInputElement).value)} />
        </label>
        <label class="pp-inline">
          <span>To</span>
          <input type="date" aria-label="To date" value={filters.to ?? ''} onChange={(e) => set('to', (e.target as HTMLInputElement).value)} />
        </label>
        <label class="pp-toggle">
          <input type="checkbox" checked={!!filters.mentionsMe} onChange={(e) => set('mentionsMe', (e.target as HTMLInputElement).checked || undefined)} />
          <span>Mentions me</span>
        </label>
        <label class="pp-toggle">
          <input type="checkbox" checked={!!filters.unread} onChange={(e) => set('unread', (e.target as HTMLInputElement).checked || undefined)} />
          <span>Unread</span>
        </label>
        <label class="pp-toggle">
          <input type="checkbox" checked={!!filters.detached} onChange={(e) => set('detached', (e.target as HTMLInputElement).checked || undefined)} />
          <span>Detached</span>
        </label>
        <select aria-label="Sort" value={sort} onChange={(e) => onChange(filters, sel(e) as ThreadSort)}>
          <option value="activity">Newest activity</option>
          <option value="oldest">Oldest</option>
          <option value="page">Page order</option>
          <option value="priority">Priority</option>
        </select>
        {activeFilterCount(filters) > 0 && (
          <button class="pp-link-btn" onClick={() => onChange(filters.q ? { q: filters.q } : {}, sort)}>
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
