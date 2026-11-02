import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ListThreadsQuery, SavedView, Thread, ThreadFilters, ThreadSort } from '@pinpoint/shared';
import { errorMessage, useAsync, useMembers, useUi, useUiEvents } from '../context';
import { Empty, ErrorBox, Skeleton } from './common';
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

  useUiEvents((e) => {
    if (e.kind === 'threads.changed' && e.workspaceId === workspaceId) {
      reload();
      if (!e.threadId) reloadPages();
    }
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

  return (
    <div class={`pp-all ${threadId ? 'pp-has-detail' : ''}`}>
      <div class="pp-all-list">
        <div class="pp-row pp-wrap pp-toolbar">
          <h1 class="pp-h1">All comments</h1>
          <span class="pp-muted">{total} thread{total === 1 ? '' : 's'}</span>
          <span class="pp-grow" />
          <SavedViews workspaceId={workspaceId} filters={filters} sort={sort} activeViewId={viewId} onApply={applyView} />
          <button class="pp-btn pp-btn-sm" onClick={() => setExporting(true)}>
            Export
          </button>
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
          <Empty title="No comments match">Try clearing filters, or leave a comment on a page with the extension (Alt+Shift+C).</Empty>
        ) : (
          <>
            <ThreadList
              threads={items}
              selected={selected}
              onToggleSelect={toggle}
              onToggleAll={toggleAll}
              onOpen={(t) => onSelectThread(t.id)}
              activeId={threadId}
              grouped={sort !== 'priority' && sort !== 'oldest'}
            />
            {cursor && (
              <button class="pp-btn pp-load-more" disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? 'Loading…' : `Load more (${items.length} of ${total})`}
              </button>
            )}
          </>
        )}
      </div>
      {threadId && (
        <aside class="pp-all-detail" aria-label="Thread detail">
          <ThreadView key={threadId} threadId={threadId} onClose={() => onSelectThread(null)} onDeleted={() => (onSelectThread(null), reload())} />
        </aside>
      )}
      {exporting && <ExportDialog workspaceId={workspaceId} selectedIds={[...selected]} query={query} pages={pages} sites={sites} onClose={() => setExporting(false)} />}
    </div>
  );
}
