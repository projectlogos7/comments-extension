import { useState } from 'preact/hooks';
import type { Notification } from '@pinpoint/shared';
import { errorMessage, useAsync, useDebouncedUiEvents, useUi } from '../context';
import { Avatar, Empty, ErrorBox, RelTime, Skeleton } from './common';

const EVENT_LABEL: Record<Notification['event'], string> = {
  mention: 'mentioned you',
  reply: 'replied',
  assignment: 'assigned you',
  resolution: 'resolved',
};

export function Inbox({ workspaceId, onOpen }: { workspaceId?: string | null; onOpen: (n: Notification) => void }) {
  const { host, toast } = useUi();
  const [filter, setFilter] = useState<'all' | 'unread' | 'mentions'>('unread');
  const { data, error, loading, reload, setData } = useAsync(
    () => host.api.notifications({ workspaceId: workspaceId ?? undefined, unread: filter === 'unread' || undefined, limit: 100 }),
    [workspaceId, filter],
  );
  useDebouncedUiEvents((e) => e.kind === 'unread.changed', reload, [workspaceId, filter]);

  const items = (data ?? []).filter((n) => filter !== 'mentions' || n.event === 'mention');

  const markAll = async () => {
    try {
      await host.api.markNotificationsRead({ all: true });
      setData((data ?? []).map((n) => ({ ...n, read: true })));
      if (filter === 'unread') reload();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const open = (n: Notification) => {
    if (!n.read) host.api.markNotificationsRead({ ids: [n.id] }).catch(() => {});
    setData((data ?? []).map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    onOpen(n);
  };

  return (
    <section class="pp-inbox" aria-label="Inbox">
      <div class="pp-row pp-wrap">
        <div class="pp-segmented" role="tablist" aria-label="Inbox filter">
          {(['unread', 'mentions', 'all'] as const).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} class={filter === f ? 'pp-active' : ''} onClick={() => setFilter(f)}>
              {f === 'unread' ? 'Unread' : f === 'mentions' ? 'Mentions' : 'All'}
            </button>
          ))}
        </div>
        <span class="pp-grow" />
        <button class="pp-link-btn" onClick={markAll}>
          Mark all read
        </button>
      </div>
      {loading && !data ? (
        <Skeleton rows={4} />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !items.length ? (
        <Empty title="You’re all caught up" icon="inbox">
          Mentions, replies, assignments and resolutions show up here.
        </Empty>
      ) : (
        <ul class="pp-notifications" role="list">
          {items.map((n) => (
            <li key={n.id}>
              <button class={`pp-notification ${n.read ? '' : 'pp-unread'}`} onClick={() => open(n)}>
                <Avatar user={n.actor} />
                <span class="pp-row-body">
                  <span>
                    {!n.read && <span class="pp-unread-dot" aria-label="Unread" />}
                    <strong>{n.actor?.name}</strong> {EVENT_LABEL[n.event]} · {n.title}
                  </span>
                  {n.excerpt && <span class="pp-muted pp-small pp-clip">{n.excerpt}</span>}
                  <span class="pp-muted pp-small">
                    <RelTime iso={n.createdAt} />
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
