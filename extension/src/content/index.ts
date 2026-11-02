// Pinpoint content script: injected only on the workspace's allowed sites. Draws the overlay,
// handles selection, builds and resolves anchors, and renders pins inside a shadow DOM.
import { h, render, type VNode } from 'preact';
import {
  STORAGE_KEYS,
  detectBrowser,
  detectOs,
  siteAllowed,
  type AnchorStatus,
  type AuthState,
  type BgResponse,
  type ContentMessage,
  type CopyFormat,
  type Member,
  type Membership,
  type PageInfo,
  type Rect,
  type SnapshotContext,
  type TabCommand,
  type Thread,
  type ThreadDetail,
} from '@pinpoint/shared';
import { api, bg } from '../lib/messaging';
import { createHost, nextFrame, setToastHost, toast, announce, type Host } from './host';
import { Overlay, type Selection } from './overlay';
import { Pins } from './pins';
import { Composer, type Capture } from './ui/composer';
import { ThreadCard } from './ui/card';
import { detectComponent } from './component';
import { buildAnchor, describeRange, rangeViewportRect, sectionCandidates, viewportRect } from './anchor';
import { COPY_LABELS, copyText, writeClipboard } from './copy';
import { installCaptureHandlers } from './capture-handlers';
import { takeThreadParam } from '../lib/thread-param';

declare global {
  interface Window {
    __pinpointContent?: boolean;
  }
}


(function main() {
  if (window.top !== window || window.__pinpointContent) return;
  window.__pinpointContent = true;

  let auth: AuthState | null = null;
  let membership: Membership | null = null;
  let allowed = false;
  let host: Host | null = null;
  let pins: Pins | null = null;
  let overlay: Overlay | null = null;
  let threads: Thread[] = [];
  let members: Member[] = [];
  let membersAt = 0;
  let pinsVisible = true;
  let lastUrl = location.href;
  let lastContextTarget: { el: Element; at: number } | null = null;
  let uiMount: HTMLElement | null = null;
  let sectionPreview: HTMLDivElement | null = null;
  let sectionRaf = 0;
  let openCardId: string | null = null;
  const patchedDetached = new Set<string>();

  // ------------------------------------------------------------ setup
  function ensureHost(): Host {
    if (host && host.el.isConnected) return host;
    host = createHost();
    setToastHost(host);
    uiMount = document.createElement('div');
    host.ui.appendChild(uiMount);
    pins?.destroy();
    pins = new Pins(host, { onPinClick: openThread, onStatus: reportAnchors });
    pins.setVisible(pinsVisible);
    return host;
  }

  function teardown() {
    overlay?.exit();
    pins?.destroy();
    pins = null;
    host?.destroy();
    host = null;
    threads = [];
  }

  async function refreshAuth() {
    try {
      auth = await bg<AuthState>({ type: 'auth.state' });
    } catch {
      auth = null;
    }
    membership = auth?.me?.memberships.find((m) => m.workspace.id === auth?.activeWorkspaceId) ?? null;
    allowed = !!(auth?.signedIn && membership && siteAllowed(location.host, membership.workspace.allowedSites));
    if (!allowed) teardown();
    bg({ type: 'content.ready', url: location.href, allowed }).catch(() => undefined);
    return allowed;
  }

  async function getMembers(): Promise<Member[]> {
    if (!membership) return [];
    if (members.length && Date.now() - membersAt < 5 * 60_000) return members;
    try {
      members = await api<Member[]>('listMembers', membership.workspace.id);
      membersAt = Date.now();
    } catch {
      /* offline: mention picker stays empty */
    }
    return members;
  }

  // ------------------------------------------------------------ threads
  let loadSeq = 0;
  async function loadThreads() {
    if (!allowed || !membership) return;
    ensureHost();
    const seq = ++loadSeq;
    try {
      const r = await api<{ threads: Thread[] }>('threadsForUrl', membership.workspace.id, location.href);
      if (seq !== loadSeq) return;
      threads = r.threads;
      pins?.setThreads(threads);
      window.dispatchEvent(new CustomEvent('pinpoint:thread-changed'));
    } catch (e) {
      console.debug('[pinpoint] could not load threads', e);
    }
  }

  let reloadTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleReload(ms = 250) {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => void loadThreads(), ms);
  }

  function reportAnchors(anchors: AnchorStatus[]) {
    bg({ type: 'content.anchors', url: location.href, anchors }).catch(() => undefined);
    // Persist the detached state for the list, after a grace period so slow pages do not flap.
    for (const a of anchors) {
      const t = threads.find((x) => x.id === a.threadId);
      if (!t || patchedDetached.has(t.id)) continue;
      const item = pins?.items.get(t.id);
      if (a.state === 'detached' && !t.detached && item?.detachedSince && Date.now() - item.detachedSince > 10_000 && document.visibilityState === 'visible') {
        patchedDetached.add(t.id);
        void api('updateThread', t.id, { detached: true }).catch(() => undefined);
      } else if (a.state === 'attached' && t.detached && a.score >= 0.8) {
        patchedDetached.add(t.id);
        void api('updateThread', t.id, { detached: false }).catch(() => undefined);
      }
    }
  }
  // Re-check detached threads once the grace period has passed.
  setInterval(() => pins?.forceReport(), 12_000);

  // ------------------------------------------------------------ UI mounting
  function mount(vnode: VNode<any> | null) {
    ensureHost();
    if (!uiMount) return;
    render(vnode, uiMount);
  }

  function closeUi() {
    mount(null);
    openCardId = null;
    showSectionPreview(null);
  }

  function showSectionPreview(el: Element | null) {
    cancelAnimationFrame(sectionRaf);
    if (!el) {
      sectionPreview?.remove();
      sectionPreview = null;
      return;
    }
    const hst = ensureHost();
    if (!sectionPreview) {
      sectionPreview = document.createElement('div');
      sectionPreview.className = 'hl section';
      hst.ui.prepend(sectionPreview);
    }
    const tick = () => {
      if (!sectionPreview) return;
      const r = viewportRect(el);
      Object.assign(sectionPreview.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
      sectionRaf = requestAnimationFrame(tick);
    };
    tick();
  }

  // ------------------------------------------------------------ comment mode
  function startCommentMode(opts: { reattach?: Thread } = {}) {
    if (!allowed) {
      toast('Pinpoint is not active on this site.', { kind: 'error' });
      return;
    }
    const hst = ensureHost();
    closeUi();
    overlay?.exit();
    const pre = lastContextTarget && Date.now() - lastContextTarget.at < 5000 ? lastContextTarget.el : null;
    lastContextTarget = null;
    overlay = new Overlay(hst, {
      title: opts.reattach ? `Re-attach comment #${opts.reattach.number}: pick the element` : undefined,
      preselect: pre,
      onExit: () => {
        overlay = null;
      },
      onSelect: (sel) => {
        overlay = null;
        if (opts.reattach) void reattach(opts.reattach, sel);
        else void openComposer(sel);
      },
    });
    overlay.start();
    announce('Comment mode on. Click an element or drag an area. Press Escape to leave.');
  }

  function captureContext(): SnapshotContext {
    const nav = navigator as Navigator & { userAgentData?: { brands: { brand: string; version: string }[]; platform?: string } };
    return {
      pageUrl: location.href,
      pageTitle: document.title,
      viewport: { w: innerWidth, h: innerHeight },
      dpr: devicePixelRatio || 1,
      browser: detectBrowser(navigator.userAgent, nav.userAgentData?.brands),
      os: detectOs(navigator.userAgent, nav.userAgentData?.platform || undefined),
      scroll: { x: Math.round(scrollX), y: Math.round(scrollY) },
      capturedAt: new Date().toISOString(),
    };
  }

  async function captureViewport(): Promise<Capture> {
    const hst = ensureHost();
    const context = captureContext();
    const capture: Capture = { dataUrl: null, context, scroll: { x: scrollX, y: scrollY }, viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio || 1 } };
    hst.setVisible(false);
    await nextFrame();
    await nextFrame();
    try {
      capture.dataUrl = await bg<string>({ type: 'capture.visible' });
    } catch (e) {
      console.debug('[pinpoint] capture failed', e);
    } finally {
      hst.setVisible(true);
    }
    return capture;
  }

  async function openComposer(sel: Selection) {
    if (!membership || !auth?.me) return;
    const capture = await captureViewport();
    const component = sel.elements[0] ? detectComponent(sel.elements[0]).catch(() => null) : Promise.resolve(null);
    const mem = await getMembers();
    mount(
      h(Composer, {
        sel,
        capture,
        workspace: membership.workspace,
        members: mem,
        me: auth.me.user,
        component,
        onPreviewSection: showSectionPreview,
        onCancel: () => {
          closeUi();
          announce('Comment cancelled');
        },
        onSaved: (r) => {
          closeUi();
          if ('queued' in r) toast('Saved offline — it will sync when the connection returns.');
          else {
            toast(`Comment #${r.number} saved`);
            threads = [...threads.filter((t) => t.id !== r.id), r];
            pins?.setThreads(threads);
          }
          scheduleReload(1200);
        },
      }),
    );
  }

  function startPageComment() {
    if (!allowed) return;
    overlay?.exit();
    void openComposer({ scope: 'page', elements: [], freeRect: null, textRange: null, rect: null, sections: [], sectionIndex: 0 });
  }

  async function reattach(thread: Thread, sel: Selection) {
    const scope = thread.scope === 'page' ? 'area' : thread.scope;
    const elements = scope === 'section' ? [sel.sections[0] ?? sel.elements[0]] : sel.elements;
    const anchor = buildAnchor({ scope, urlMatch: thread.urlMatch, elements, freeRect: sel.freeRect, textRange: sel.textRange, component: await detectComponent(elements[0]).catch(() => null) });
    try {
      await api('updateThread', thread.id, { anchor, scope, detached: false });
      patchedDetached.delete(thread.id);
      toast(`Comment #${thread.number} re-attached`);
      await loadThreads();
    } catch (e) {
      toast((e as Error).message, { kind: 'error' });
    }
  }

  // ------------------------------------------------------------ text selection (FR-1.5)
  let selBtn: HTMLButtonElement | null = null;
  function hideSelBtn() {
    selBtn?.remove();
    selBtn = null;
  }
  document.addEventListener('mouseup', () => {
    if (!allowed || overlay?.active) return;
    setTimeout(() => {
      const s = window.getSelection();
      if (!s || s.isCollapsed || !s.rangeCount || !s.toString().trim()) return hideSelBtn();
      const range = s.getRangeAt(0);
      const anc = range.commonAncestorContainer;
      const el = anc.nodeType === 1 ? (anc as Element) : anc.parentElement;
      if (!el || el.closest('[data-pinpoint-root]') || (el as HTMLElement).isContentEditable || /^(INPUT|TEXTAREA)$/.test(el.tagName)) return hideSelBtn();
      const r = rangeViewportRect(range);
      const hst = ensureHost();
      hideSelBtn();
      selBtn = document.createElement('button');
      selBtn.className = 'sel-btn';
      selBtn.type = 'button';
      selBtn.textContent = '💬 Comment';
      selBtn.setAttribute('aria-label', 'Comment on the selected text');
      selBtn.style.left = `${Math.min(r.x + r.w, innerWidth - 120)}px`;
      selBtn.style.top = `${Math.min(r.y + r.h + 6, innerHeight - 40)}px`;
      const saved = range.cloneRange();
      selBtn.onclick = () => {
        hideSelBtn();
        const textRange = describeRange(saved, document.body);
        void openComposer({ scope: 'area', elements: [el], freeRect: null, textRange, rect: rangeViewportRect(saved), sections: sectionCandidates(el), sectionIndex: 0 });
      };
      hst.ui.appendChild(selBtn);
    }, 10);
  });
  document.addEventListener('mousedown', (e) => {
    if (selBtn && !(e.composedPath() as Element[]).includes(host?.el as Element)) hideSelBtn();
  });
  document.addEventListener(
    'contextmenu',
    (e) => {
      const t = e.composedPath()[0];
      if (t instanceof Element) lastContextTarget = { el: t, at: Date.now() };
    },
    true,
  );

  // ------------------------------------------------------------ threads on the page
  function openThread(threadId: string) {
    const item = pins?.items.get(threadId);
    const thread = threads.find((t) => t.id === threadId);
    if (!thread || !membership || !auth?.me) return;
    openCardId = threadId;
    bg({ type: 'content.threadSelected', threadId }).catch(() => undefined);
    void getMembers().then((mem) => {
      if (openCardId !== threadId) return;
      mount(
        h(ThreadCard, {
          key: threadId,
          threadId,
          workspaceId: membership!.workspace.id,
          me: auth!.me!.user,
          role: membership!.member.role,
          members: mem,
          detached: item?.resolved.state === 'detached',
          anchorRect: () => item?.resolved.rect() ?? null,
          onClose: closeUi,
          onCopy: (t, f) => void doCopy(t, f),
          onCopyText: (text, label) => void writeClipboard(text, host?.root).then((ok) => toast(ok ? label : 'Copy failed', { kind: ok ? 'info' : 'error' })),
          onReattach: () => {
            closeUi();
            startCommentMode({ reattach: thread });
          },
          onChanged: () => scheduleReload(100),
        }),
      );
    });
  }

  function pulse(rect: Rect) {
    const hst = ensureHost();
    const d = document.createElement('div');
    d.className = 'hl pulse';
    Object.assign(d.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.w}px`, height: `${rect.h}px` });
    hst.ui.prepend(d);
    setTimeout(() => d.remove(), 2600);
  }

  async function focusThread(threadId: string) {
    if (!threads.some((t) => t.id === threadId)) await loadThreads();
    let thread = threads.find((t) => t.id === threadId);
    if (!thread) {
      // Thread may belong to another URL match; fetch it directly.
      try {
        const d = await api<ThreadDetail>('getThread', threadId);
        threads = [...threads, d];
        pins?.setThreads(threads);
        thread = d;
      } catch (e) {
        toast((e as Error).message || 'Thread not found', { kind: 'error' });
        return;
      }
    }
    const item = pins?.items.get(threadId);
    if (item?.resolved.state === 'attached') {
      const el = item.resolved.elements[0];
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
      setTimeout(() => {
        const r = item.resolved.rect();
        if (r) pulse(r);
        openThread(threadId);
      }, reduce ? 50 : 450);
    } else if (item?.resolved.state === 'detached') {
      openThread(threadId);
      toast(`Comment #${thread.number} is detached: its element was not found on this page.`, {
        action: { label: 'Re-attach', run: () => startCommentMode({ reattach: thread! }) },
      });
    } else openThread(threadId);
  }

  async function doCopy(thread: Thread | ThreadDetail, format: CopyFormat): Promise<string> {
    const detail = 'comments' in thread ? thread : await api<ThreadDetail>('getThread', thread.id);
    const live = pins?.items.get(thread.id)?.resolved.elements[0] ?? null;
    const text = await copyText(detail, format, auth?.serverUrl ?? '', live);
    if (!text) {
      toast(`No ${COPY_LABELS[format]} available for this thread`, { kind: 'error' });
      return '';
    }
    const ok = await writeClipboard(text, host?.root);
    toast(ok ? `${COPY_LABELS[format]} copied` : `Could not copy ${COPY_LABELS[format]}`, { kind: ok ? 'info' : 'error' });
    return text;
  }

  // ------------------------------------------------------------ in-page panel fallback
  let panel: HTMLDivElement | null = null;
  async function togglePanel() {
    const hst = ensureHost();
    if (panel) {
      panel.remove();
      panel = null;
      return;
    }
    let tabId = '';
    try {
      tabId = String((await bg<PageInfo>({ type: 'page.info' })).tabId);
    } catch {
      /* ignore */
    }
    panel = document.createElement('div');
    panel.className = 'inpage-panel';
    panel.setAttribute('role', 'complementary');
    panel.setAttribute('aria-label', 'Pinpoint comments');
    const bar = document.createElement('div');
    bar.className = 'hdr';
    bar.innerHTML = '<span class="title">Pinpoint</span>';
    const close = document.createElement('button');
    close.className = 'icon';
    close.textContent = '✕';
    close.setAttribute('aria-label', 'Close panel');
    close.onclick = () => void togglePanel();
    bar.appendChild(close);
    const frame = document.createElement('iframe');
    frame.src = chrome.runtime.getURL(`sidepanel.html?embedded=1&tabId=${tabId}`);
    frame.title = 'Pinpoint comments';
    panel.append(bar, frame);
    hst.ui.appendChild(panel);
  }

  // ------------------------------------------------------------ commands
  async function runCommand(c: TabCommand): Promise<unknown> {
    if (!allowed && c.kind !== 'pins.toggle') {
      await refreshAuth();
      if (!allowed) throw Object.assign(new Error('This site is not on your workspace’s allowed list.'), { code: 'site_not_allowed' });
      await loadThreads();
    }
    switch (c.kind) {
      case 'commentMode.start':
        startCommentMode();
        return null;
      case 'commentMode.stop':
        overlay?.exit();
        return null;
      case 'commentMode.toggle':
        if (overlay?.active) overlay.exit();
        else startCommentMode();
        return null;
      case 'pageComment.start':
        startPageComment();
        return null;
      case 'pins.toggle':
        pinsVisible = c.visible ?? !pinsVisible;
        await chrome.storage.local.set({ [STORAGE_KEYS.pinsVisible]: pinsVisible });
        pins?.setVisible(pinsVisible);
        announce(pinsVisible ? 'Pins shown' : 'Pins hidden');
        return { pinsVisible };
      case 'thread.focus':
        await focusThread(c.threadId);
        return null;
      case 'thread.reattach': {
        const t = threads.find((x) => x.id === c.threadId) ?? (await api<ThreadDetail>('getThread', c.threadId));
        startCommentMode({ reattach: t });
        return null;
      }
      case 'threads.reload':
        await loadThreads();
        return null;
      case 'copy': {
        const t = threads.find((x) => x.id === c.threadId) ?? (await api<ThreadDetail>('getThread', c.threadId));
        return { text: await doCopy(t, c.format) };
      }
      case 'panel.toggle':
        await togglePanel();
        return null;
    }
  }

  function pageInfo(): Partial<PageInfo> {
    return { url: location.href, title: document.title, allowed, active: true, pinsVisible, anchors: pins?.statuses() ?? [] };
  }

  const captureHandlers = installCaptureHandlers(() => host);

  chrome.runtime.onMessage.addListener((msg: ContentMessage, _sender, sendResponse) => {
    const reply = (p: Promise<unknown> | unknown) =>
      Promise.resolve(p).then(
        (data) => sendResponse({ ok: true, data: data ?? null } satisfies BgResponse),
        (e) => sendResponse({ ok: false, error: { code: (e as { code?: string }).code ?? 'error', message: (e as Error).message } } satisfies BgResponse),
      );
    switch (msg?.type) {
      case 'command':
        reply(runCommand(msg.command));
        return true;
      case 'page.info':
        reply(pageInfo());
        return true;
      case 'event': {
        const ev = msg.event;
        if (ev.type === 'auth.changed') {
          void refreshAuth().then((ok) => {
            if (ok) void loadThreads();
          });
        } else if (ev.type === 'threads.changed' && allowed && ev.workspaceId === membership?.workspace.id) {
          scheduleReload();
          if (ev.threadId && ev.threadId === openCardId) window.dispatchEvent(new CustomEvent('pinpoint:thread-changed'));
        } else if (ev.type === 'thread.selected') {
          // the side panel selected a thread: nothing to do unless we are its tab (handled via thread.focus)
        }
        return false;
      }
      case 'capture.prepare':
      case 'capture.scrollTo':
      case 'capture.restore':
      case 'capture.metrics':
        reply(captureHandlers(msg));
        return true;
    }
    return false;
  });

  // ------------------------------------------------------------ SPA navigation
  function onUrlChange() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    closeUi();
    patchedDetached.clear();
    if (allowed) scheduleReload(300);
  }
  setInterval(onUrlChange, 500);
  window.addEventListener('popstate', onUrlChange);
  window.addEventListener('hashchange', onUrlChange);

  // ------------------------------------------------------------ start
  void (async () => {
    pinsVisible = ((await chrome.storage.local.get(STORAGE_KEYS.pinsVisible))[STORAGE_KEYS.pinsVisible] as boolean | undefined) ?? true;
    if (!(await refreshAuth())) return;
    ensureHost();
    await loadThreads();
    // Arriving from a share link, email or notification: ?pinpoint_thread=<id> (FR-4.6).
    const param = takeThreadParam(location.href);
    if (param) {
      history.replaceState(history.state, '', param.cleanUrl);
      lastUrl = location.href;
      setTimeout(() => void focusThread(param.threadId), 400);
    }
  })();
})();
