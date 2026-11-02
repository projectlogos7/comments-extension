import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { PRIORITIES, SCOPES, THREAD_TYPES, type Member, type Page, type ThreadFilters, type ThreadSort } from '@pinpoint/shared';
import { Avatar, capitalize, Icon, Popover, Select, type SelectOption } from './common';

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

/** Filters that live behind the "More filters" button. */
const MORE_KEYS: (keyof ThreadFilters)[] = ['authorId', 'scope', 'type', 'priority', 'site', 'pageId', 'from', 'to', 'mentionsMe', 'unread', 'detached'];

export const SORT_OPTIONS: SelectOption<ThreadSort>[] = [
  { value: 'activity', label: 'Newest activity' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'page', label: 'Page order' },
  { value: 'priority', label: 'Priority' },
];

function memberOptions(members: Member[], any: string, extra: SelectOption[] = []): SelectOption[] {
  return [
    { value: '', label: any },
    ...extra,
    ...members.map((m) => ({ value: m.userId, label: m.user.name || m.user.email, icon: <Avatar user={m.user} size={18} /> })),
  ];
}

export function FiltersBar({ filters, sort, members, sites = [], pages = [], onChange }: FiltersBarProps) {
  const [q, setQ] = useState(filters.q ?? '');
  const [moreOpen, setMoreOpen] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => setQ(filters.q ?? ''), [filters.q]);
  useEffect(() => {
    if ((filters.q ?? '') === q) return;
    const t = setTimeout(() => onChange(cleanFilters({ ...filters, q }), sort), 300);
    return () => clearTimeout(t);
  }, [q]);

  const set = <K extends keyof ThreadFilters>(k: K, v: ThreadFilters[K] | '') => onChange(cleanFilters({ ...filters, [k]: v === '' ? undefined : v }), sort);
  const visiblePages = filters.site ? pages.filter((p) => p.site === filters.site) : pages;
  const moreCount = MORE_KEYS.filter((k) => cleanFilters(filters)[k] !== undefined).length;
  const closeMore = useCallback(() => setMoreOpen(false), []);
  const nonGuests = members.filter((m) => m.role !== 'guest');

  return (
    <div class="pp-filters" role="search" aria-label="Filter comments">
      <div class="pp-search-wrap">
        <Icon name="search" size={15} class="pp-search-icon" />
        <input
          type="search"
          class="pp-search"
          placeholder="Search comments, replies, pages…"
          aria-label="Search"
          value={q}
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        />
      </div>
      <Select
        label="Status"
        prefix="Status"
        size="sm"
        highlight={!!filters.status}
        value={filters.status ?? ''}
        onChange={(v) => set('status', v as ThreadFilters['status'])}
        options={[
          { value: '', label: 'Any' },
          { value: 'open', label: 'Open' },
          { value: 'resolved', label: 'Resolved' },
        ]}
      />
      <Select
        label="Assignee"
        prefix="Assignee"
        size="sm"
        highlight={!!(filters.assigneeId || filters.unassigned)}
        value={filters.unassigned ? '__none' : filters.assigneeId ?? ''}
        onChange={(v) => onChange(cleanFilters({ ...filters, assigneeId: v && v !== '__none' ? v : undefined, unassigned: v === '__none' || undefined }), sort)}
        options={memberOptions(nonGuests, 'Anyone', [{ value: '__none', label: 'Unassigned' }])}
      />
      <button
        ref={moreBtn}
        type="button"
        class={`pp-select pp-select-sm ${moreCount ? 'pp-select-on' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={moreOpen}
        onClick={() => setMoreOpen(!moreOpen)}
      >
        <Icon name="filter" size={14} />
        <span class="pp-select-value">More filters</span>
        {moreCount > 0 && <span class="pp-count-pill">{moreCount}</span>}
      </button>
      <span class="pp-grow" />
      {activeFilterCount(filters) > 0 && (
        <button type="button" class="pp-link-btn pp-small" onClick={() => onChange(filters.q ? { q: filters.q } : {}, sort)}>
          Clear filters
        </button>
      )}
      <Select<ThreadSort> label="Sort" prefix="Sort" size="sm" align="end" value={sort} onChange={(v) => onChange(filters, v)} options={SORT_OPTIONS} />

      <Popover open={moreOpen} onClose={closeMore} anchor={moreBtn.current} role="dialog" label="More filters" class="pp-filter-pop">
        <div class="pp-filter-grid">
          <span class="pp-meta-label">Author</span>
          <Select label="Author" size="sm" value={filters.authorId ?? ''} onChange={(v) => set('authorId', v)} options={memberOptions(members, 'Anyone')} />
          <span class="pp-meta-label">Scope</span>
          <Select
            label="Scope"
            size="sm"
            value={filters.scope ?? ''}
            onChange={(v) => set('scope', v as ThreadFilters['scope'])}
            options={[{ value: '', label: 'Any' }, ...SCOPES.map((s) => ({ value: s, label: capitalize(s) }))]}
          />
          <span class="pp-meta-label">Type</span>
          <Select
            label="Type"
            size="sm"
            value={filters.type ?? ''}
            onChange={(v) => set('type', v as ThreadFilters['type'])}
            options={[{ value: '', label: 'Any' }, ...THREAD_TYPES.map((s) => ({ value: s, label: capitalize(s) }))]}
          />
          <span class="pp-meta-label">Priority</span>
          <Select
            label="Priority"
            size="sm"
            value={filters.priority ?? ''}
            onChange={(v) => set('priority', v as ThreadFilters['priority'])}
            options={[{ value: '', label: 'Any' }, ...PRIORITIES.map((s) => ({ value: s, label: capitalize(s), icon: <span class={`pp-prio-dot pp-prio-${s}`} /> }))]}
          />
          {sites.length > 0 && (
            <>
              <span class="pp-meta-label">Site</span>
              <Select
                label="Site"
                size="sm"
                value={filters.site ?? ''}
                onChange={(v) => onChange(cleanFilters({ ...filters, site: v || undefined, pageId: undefined }), sort)}
                options={[{ value: '', label: 'All sites' }, ...sites.map((s) => ({ value: s, label: s }))]}
              />
            </>
          )}
          {visiblePages.length > 0 && (
            <>
              <span class="pp-meta-label">Page</span>
              <Select
                label="Page"
                size="sm"
                value={filters.pageId ?? ''}
                onChange={(v) => set('pageId', v)}
                options={[{ value: '', label: 'All pages' }, ...visiblePages.map((p) => ({ value: p.id, label: p.title || p.normalizedUrl }))]}
              />
            </>
          )}
          <span class="pp-meta-label">Created</span>
          <div class="pp-date-range">
            <input type="date" aria-label="From date" value={filters.from ?? ''} onChange={(e) => set('from', (e.target as HTMLInputElement).value)} />
            <span class="pp-muted">–</span>
            <input type="date" aria-label="To date" value={filters.to ?? ''} onChange={(e) => set('to', (e.target as HTMLInputElement).value)} />
          </div>
        </div>
        <div class="pp-filter-checks">
          <label class="pp-check">
            <input type="checkbox" checked={!!filters.mentionsMe} onChange={(e) => set('mentionsMe', (e.target as HTMLInputElement).checked || undefined)} />
            <span>Mentions me</span>
          </label>
          <label class="pp-check">
            <input type="checkbox" checked={!!filters.unread} onChange={(e) => set('unread', (e.target as HTMLInputElement).checked || undefined)} />
            <span>Unread</span>
          </label>
          <label class="pp-check">
            <input type="checkbox" checked={!!filters.detached} onChange={(e) => set('detached', (e.target as HTMLInputElement).checked || undefined)} />
            <span>Detached</span>
          </label>
        </div>
        {moreCount > 0 && (
          <div class="pp-row pp-end">
            <button
              type="button"
              class="pp-link-btn pp-small"
              onClick={() => {
                const next: Record<string, unknown> = { ...filters };
                for (const k of MORE_KEYS) delete next[k];
                onChange(cleanFilters(next as ThreadFilters), sort);
              }}
            >
              Reset these filters
            </button>
          </div>
        )}
      </Popover>
    </div>
  );
}
