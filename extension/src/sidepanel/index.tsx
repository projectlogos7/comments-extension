// Side panel (FR-5.1, FR-5.2): threads for the current tab's page, page comments on top, detached
// threads at the bottom, inline thread view, inbox, and the entry points into comment mode.
import '@pinpoint/ui/styles.css';
import { render } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AnchorStatus, Notification, PageInfo, Thread } from '@pinpoint/shared';
import {
  Empty,
  Icon,
  Kbd,
  Select,
  useDebouncedCallback,
  useLayer,
  ErrorBox,
  Inbox,
  Skeleton,
  ThreadRow,
  ThreadView,
  UiProvider,
  WorkspaceSwitcher,
  errorMessage,
  useActiveMembership,
  useUi,
  useUiEvents,
  useUnreadCounts,
} from '@pinpoint/ui';
import { bg, ExtensionHost } from '../app/extHost';
import { SignIn } from '../app/SignIn';
import { applyQuickFilter, orderPanelThreads, type QuickFilter } from './order';

const params = new URLSearchParams(location.search);
const embedded = params.get('embedded') === '1';
const fixedTabId = params.get('tabId') ? Number(params.get('tabId')) : null;

async function resolveTabId(): Promise<number | null> {
  if (fixedTabId !== null) return fixedTabId;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

function Panel({ host }: { host: ExtensionHost }) {
  const { session, toast } = useUi();
  const membership = useActiveMembership();
  const ws = membership?.workspace.id ?? null;
  const counts = useUnreadCounts(ws);
  const [tab, setTab] = useState<'page' | 'inbox'>('page');
  const [page, setPage] = useState<PageInfo | null>(null);
  const [anchors, setAnchors] = useState<AnchorStatus[]>([]);
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<QuickFilter>({ status: 'open', mine: false, scope: 'all' });
  const [sync, setSync] = useState({ pendingWrites: host.state.pendingWrites, online: host.state.online });

  const loadPage = useCallback(async () => {
    host.tabId = await resolveTabId();
    const info = await host.pageInfo();
    setPage(info);
    setAnchors(info?.anchors ?? []);
    return info;
  }, [host]);

  const loadThreads = useCallback(
    async (info: PageInfo | null) => {
      if (!ws || !info?.url || !/^https?:/.test(info.url)) {
        setThreads([]);
        return;
      }
      try {
        const r = await host.api.threadsForUrl(ws, info.url);
        setThreads(r.threads);
        setError(null);
      } catch (e) {
        setError(e);
      }
    },
    [host, ws],
  );

  const reload = useCallback(() => loadPage().then(loadThreads), [loadPage, loadThreads]);
  // Realtime events arrive in bursts (comment + thread + notification): reload once per burst.
  const pageRef = useRef(page);
  pageRef.current = page;
  const reloadThreadsSoon = useDebouncedCallback(() => loadThreads(pageRef.current), 300);

  useEffect(() => {
    setThreads(null);
    setOpenId(null);
    reload();
  }, [ws]);

  useUiEvents(
    (e) => {
      if (e.kind === 'page.changed') {
        if (fixedTabId === null) setOpenId(null);
        reload();
      } else if (e.kind === 'threads.changed' && (!ws || e.workspaceId === ws)) reloadThreadsSoon();
      else if (e.kind === 'page.anchors' && e.tabId === host.tabId) setAnchors(e.anchors);
      else if (e.kind === 'thread.selected' && (e.tabId === undefined || e.tabId === host.tabId)) {
        setTab('page');
        setOpenId(e.threadId);
      } else if (e.kind === 'sync.status') setSync({ pendingWrites: e.pendingWrites, online: e.online });
    },
    [ws, page, reload, loadThreads],
  );

  // Esc in an open thread goes back to the list (menus and dialogs inside close first).
  useLayer(!!openId, () => setOpenId(null));

  const groups = useMemo(() => orderPanelThreads(applyQuickFilter(threads ?? [], filter, session.me?.user.id), anchors), [threads, anchors, filter, session.me]);

  const command = (kind: 'commentMode.start' | 'pageComment.start' | 'pins.toggle') =>
    host.tabCommand({ kind } as never).catch((e) => toast(errorMessage(e), 'error'));

  const open = (t: Thread) => {
    setOpenId(t.id);
    if (t.scope !== 'page' && !t.detached) host.focusOnPage(t.id);
  };

  const openAll = () => chrome.tabs.create({ url: host.appUrl('/all') });

  const grant = async () => {
    try {
      await bg({ type: 'permissions.sync' });
      await reload();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  let body;
  if (!membership) {
    body = (
      <Empty title="No workspace yet">
        <div class="pp-row">
          <button class="pp-btn pp-btn-primary" onClick={() => chrome.tabs.create({ url: host.appUrl('/onboarding') })}>
            Create or join a workspace
          </button>
          <button class="pp-btn" onClick={() => void host.refreshSession().catch((e) => toast(errorMessage(e), 'error'))}>
            Check again
          </button>
        </div>
      </Empty>
    );
  } else if (tab === 'inbox') {
    body = (
      <Inbox
        workspaceId={ws}
        onOpen={(n: Notification) => {
          host.api
            .getThread(n.threadId)
            .then((t) => host.openThread(t, { newTab: false }))
            .catch(() => {});
          setTab('page');
          setOpenId(n.threadId);
        }}
      />
    );
  } else if (openId) {
    body = <ThreadView key={openId} threadId={openId} compact onClose={() => setOpenId(null)} onDeleted={() => (setOpenId(null), loadThreads(page))} />;
  } else if (!page || !/^https?:/.test(page.url)) {
    body = <Empty title="Nothing to comment on here">Open a web page on one of your workspace's sites.</Empty>;
  } else if (!page.allowed) {
    body = (
      <Empty title="This site isn't in your workspace">
        <p>Pinpoint only runs on the allowed sites of {membership.workspace.name}.</p>
        <button class="pp-btn" onClick={() => chrome.tabs.create({ url: host.appUrl('/settings/workspace') })}>
          Manage allowed sites
        </button>
      </Empty>
    );
  } else if (!page.hasPermission) {
    body = (
      <Empty title="Allow Pinpoint on this site">
        <p>The browser needs your permission before Pinpoint can show comments here.</p>
        <button class="pp-btn pp-btn-primary" onClick={grant}>
          Grant access
        </button>
      </Empty>
    );
  } else if (error && !threads) {
    body = <ErrorBox error={error} onRetry={reload} />;
  } else if (!threads) {
    body = <Skeleton rows={5} />;
  } else {
    const total = groups.page.length + groups.attached.length + groups.detached.length;
    body = (
      <>
        {!page.active && <p class="pp-status-line">Reload the page to show pins and select elements.</p>}
        {total === 0 && (
          <Empty title={threads.length ? 'No threads match' : 'No comments on this page yet'}>
            Press <Kbd>Alt</Kbd>+<Kbd>Shift</Kbd>+<Kbd>C</Kbd> or use “Comment” to point at something.
          </Empty>
        )}
        {groups.page.length > 0 && (
          <>
            <h2 class="pp-sp-section-title">Page comments</h2>
            <ul class="pp-thread-list" role="list">
              {groups.page.map((t) => (
                <ThreadRow key={t.id} t={t} onOpen={open} />
              ))}
            </ul>
          </>
        )}
        {groups.attached.length > 0 && (
          <>
            <h2 class="pp-sp-section-title">On this page</h2>
            <ul class="pp-thread-list" role="list">
              {groups.attached.map((t) => (
                <ThreadRow key={t.id} t={t} onOpen={open} />
              ))}
            </ul>
          </>
        )}
        {groups.detached.length > 0 && (
          <>
            <h2 class="pp-sp-section-title">Detached</h2>
            <p class="pp-muted pp-small">These elements were not found. Open one to see its snapshot or re-attach it.</p>
            <ul class="pp-thread-list" role="list">
              {groups.detached.map((t) => (
                <li key={t.id} class="pp-row">
                  <div class="pp-grow">
                    <ul class="pp-thread-list" role="list">
                      <ThreadRow t={t} onOpen={open} />
                    </ul>
                  </div>
                  <button class="pp-btn pp-btn-sm" onClick={() => host.reattach(t.id)} aria-label={`Re-attach thread ${t.number}`}>
                    Re-attach
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </>
    );
  }

  return (
    <div class="pp-sp">
      <header class="pp-sp-head">
        <div class="pp-row">
          <span class="pp-logo" aria-hidden="true" />
          <WorkspaceSwitcher />
          <span class="pp-grow" />
          <button class="pp-icon-btn" title="All comments" aria-label="Open all comments" onClick={openAll}>
            <Icon name="external" />
          </button>
          {embedded && (
            <button class="pp-icon-btn" aria-label="Close panel" onClick={() => host.tabCommand({ kind: 'panel.toggle' }).catch(() => {})}>
              <Icon name="x" />
            </button>
          )}
        </div>
        <div class="pp-segmented" role="tablist" aria-label="Panel">
          <button role="tab" aria-selected={tab === 'page'} class={tab === 'page' ? 'pp-active' : ''} onClick={() => setTab('page')}>
            This page{threads ? ` (${threads.length})` : ''}
          </button>
          <button role="tab" aria-selected={tab === 'inbox'} class={tab === 'inbox' ? 'pp-active' : ''} onClick={() => setTab('inbox')}>
            Inbox {counts.notifications > 0 && <span class="pp-nav-badge">{counts.notifications}</span>}
          </button>
        </div>
        {tab === 'page' && !openId && page?.allowed && page.hasPermission && (
          <>
            <div class="pp-row pp-wrap">
              <button class="pp-btn pp-btn-primary pp-btn-sm" onClick={() => command('commentMode.start')} title="Alt+Shift+C">
                <Icon name="plus" size={14} /> Comment
              </button>
              <button class="pp-btn pp-btn-sm" onClick={() => command('pageComment.start')}>
                Page comment
              </button>
              <span class="pp-grow" />
              <button class="pp-btn pp-btn-sm" aria-pressed={page.pinsVisible} onClick={() => command('pins.toggle').then(() => setPage({ ...page, pinsVisible: !page.pinsVisible }))}>
                {page.pinsVisible ? 'Hide pins' : 'Show pins'}
              </button>
            </div>
            <div class="pp-filter-row">
              <Select<QuickFilter['status']>
                label="Status"
                size="sm"
                highlight={filter.status !== 'open'}
                value={filter.status}
                onChange={(v) => setFilter({ ...filter, status: v })}
                options={[
                  { value: 'open', label: 'Open' },
                  { value: 'resolved', label: 'Resolved' },
                  { value: 'all', label: 'All' },
                ]}
              />
              <Select<QuickFilter['scope']>
                label="Scope"
                size="sm"
                highlight={filter.scope !== 'all'}
                value={filter.scope}
                onChange={(v) => setFilter({ ...filter, scope: v })}
                options={[
                  { value: 'all', label: 'Any scope' },
                  { value: 'area', label: 'Area' },
                  { value: 'section', label: 'Section' },
                  { value: 'page', label: 'Page' },
                ]}
              />
              <button type="button" class={`pp-chip-toggle ${filter.mine ? 'pp-active' : ''}`} aria-pressed={filter.mine} onClick={() => setFilter({ ...filter, mine: !filter.mine })}>
                Mine
              </button>
            </div>
          </>
        )}
        {(sync.pendingWrites > 0 || !sync.online) && (
          <p class="pp-status-line" role="status">
            {!sync.online ? 'Offline — ' : ''}
            {sync.pendingWrites > 0 ? `${sync.pendingWrites} change${sync.pendingWrites === 1 ? '' : 's'} waiting to sync` : 'changes will sync when you reconnect'}
          </p>
        )}
      </header>
      <main class="pp-sp-body">{body}</main>
    </div>
  );
}

function Root({ host }: { host: ExtensionHost }) {
  const { session } = useUi();
  if (!host.state.signedIn || !session.me) return <SignIn host={host} />;
  return <Panel host={host} />;
}

async function main() {
  const root = document.getElementById('app')!;
  render(<Skeleton rows={5} />, root);
  try {
    const host = await ExtensionHost.create();
    host.tabId = await resolveTabId();
    render(
      <UiProvider host={host}>
        <Root host={host} />
      </UiProvider>,
      root,
    );
  } catch (e) {
    root.textContent = `Pinpoint could not start: ${e instanceof Error ? e.message : String(e)}`;
  }
}

main();
