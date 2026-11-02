import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ListThreadsQuery, SavedView, Thread, ThreadFilters, ThreadSort } from '@pinpoint/shared';
import { can } from '@pinpoint/shared';
import { errorMessage, useAsync, useDebouncedUiEvents, useMembers, useRole, useUi } from '../context';
import { Drawer, Empty, ErrorBox, Icon, Kbd, Skeleton } from './common';
import { BulkBar } from './BulkBar';
import { ExportDialog } from './ExportDialog';
import { FiltersBar } from './FiltersBar';
import { SavedViews } from './SavedViews';
import { ThreadList } from './ThreadList';
import { ThreadView } from './ThreadView';

export interface AllCommentsProps {
  workspaceId: string;
  /** Thread shown in the detail pane (from the route). */
  threadId?: string | null;
  onSelectThread: (id: string | null) => void;
  initialFilters?: ThreadFilters;
}

const PAGE_SIZE = 50;

export function AllComments({ workspaceId, threadId, onSelectThread, initialFilters = { status: 'open' } }: AllCommentsProps) {
  const { host, toast } = useUi();
  const members = useMembers(workspaceId);
  const [filters, setFilters] = useState<ThreadFilters>(initialFilters);
  const [sort, setSort] = useState<ThreadSort>('activity');
  const [viewId, setViewId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [items, setItems] = useState<Thread[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const query: ListThreadsQuery = useMemo(() => ({ ...filters, sort, limit: PAGE_SIZE }), [filters, sort]);

  const { data, error, loading, reload } = useAsync(() => host.api.listThreads(workspaceId, query), [workspaceId, query]);
  const { data: pages = [], reload: reloadPages } = useAsync(() => host.api.listPages(workspaceId), [workspaceId]);
  const sites = useMemo(() => [...new Set(pages.map((p) => p.site))].sort(), [pages]);

  useEffect(() => {
    if (!data) return;
    setItems(data.items);
    setCursor(data.nextCursor);
    setTotal(data.total);
  }, [data]);

  useEffect(() => setSelected(new Set()), [workspaceId, query]);

  const role = useRole();
  // Realtime events come in bursts; refresh the list at most once per burst.
  useDebouncedUiEvents((e) => e.kind === 'threads.changed' && e.workspaceId === workspaceId, () => {
    reload();
    reloadPages();
  }, [workspaceId]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const r = await host.api.listThreads(workspaceId, { ...query, cursor });
      setItems((it) => [...it, ...r.items]);
      setCursor(r.nextCursor);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setLoadingMore(false);
    }
  };

  const applyView = (v: SavedView | null) => {
    setViewId(v?.id ?? null);
    if (v) {
      setFilters(v.filters);
      setSort(v.sort);
    } else {
      setFilters({});
      setSort('activity');
    }
  };

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      on ? n.add(id) : n.delete(id);
      return n;
    });
  const toggleAll = (ids: string[], on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      ids.forEach((id) => (on ? n.add(id) : n.delete(id)));
      return n;
    });

  const filtered = Object.keys(filters).some((k) => k !== 'status');
  return (
    <div class={`pp-all ${threadId ? 'pp-has-detail' : ''}`}>
      <div class="pp-all-list">
        <div class="pp-page-head-row">
          <div class="pp-grow">
            <h1 class="pp-h1">All comments</h1>
            <p class="pp-muted pp-small">
              {total} {filters.status === 'open' ? 'open ' : filters.status === 'resolved' ? 'resolved ' : ''}thread{total === 1 ? '' : 's'} across your sites
            </p>
          </div>
          <SavedViews workspaceId={workspaceId} filters={filters} sort={sort} activeViewId={viewId} onApply={applyView} />
          {can(role, 'export') && (
            <button class="pp-btn pp-btn-sm" onClick={() => setExporting(true)}>
              <Icon name="download" size={14} /> Export
            </button>
          )}
        </div>
        <FiltersBar
          filters={filters}
          sort={sort}
          members={members}
          sites={sites}
          pages={pages}
          onChange={(f, s) => {
            setFilters(f);
            setSort(s);
          }}
        />
        <BulkBar workspaceId={workspaceId} ids={[...selected]} members={members} onDone={() => (setSelected(new Set()), reload())} onClear={() => setSelected(new Set())} onExport={() => setExporting(true)} />
        {loading && !data ? (
          <Skeleton rows={8} />
        ) : error ? (
          <ErrorBox error={error} onRetry={reload} />
        ) : !items.length ? (
          filtered || filters.q ? (
            <Empty title="Nothing matches these filters" icon="search" action={<button class="pp-btn" onClick={() => (setFilters({}), setViewId(null))}>Clear filters</button>} />
          ) : filters.status === 'open' ? (
            <Empty
              title="No open comments"
              icon="check"
              action={
                <button class="pp-btn" onClick={() => setFilters({})}>
                  Show resolved too
                </button>
              }
            >
              Open a page on one of your sites and press <Kbd>Alt</Kbd>+<Kbd>Shift</Kbd>+<Kbd>C</Kbd> to point at something.
            </Empty>
          ) : (
            <Empty title="No comments yet" icon="message">
              Open a page on one of your sites and press <Kbd>Alt</Kbd>+<Kbd>Shift</Kbd>+<Kbd>C</Kbd> to point at something.
            </Empty>
          )
        ) : (
          <>
            <ThreadList
              threads={items}
              selected={selected}
              onToggleSelect={toggle}
              onToggleAll={toggleAll}
              onOpen={(t) => onSelectThread(t.id === threadId ? null : t.id)}
              activeId={threadId}
              grouped={sort !== 'priority' && sort !== 'oldest'}
            />
            {cursor && (
              <button class="pp-btn pp-load-more" disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? 'Loading…' : `Show more (${items.length} of ${total})`}
              </button>
            )}
          </>
        )}
      </div>
      {threadId && (
        <Drawer label="Thread detail" onClose={() => onSelectThread(null)}>
          <ThreadView key={threadId} threadId={threadId} onClose={() => onSelectThread(null)} onDeleted={() => (onSelectThread(null), reload())} />
        </Drawer>
      )}
      {exporting && <ExportDialog workspaceId={workspaceId} selectedIds={[...selected]} query={query} pages={pages} sites={sites} onClose={() => setExporting(false)} />}
    </div>
  );
}
