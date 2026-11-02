// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { h as preactH, render } from 'preact';
// Loosely typed h() so tests can pass component props without overload noise.
const h = (c: any, props: any, ...children: any[]) => preactH(c, props, ...children);
import { act } from 'preact/test-utils';
import { UiProvider } from '../src/context';
import { ThreadView } from '../src/components/ThreadView';
import { FiltersBar } from '../src/components/FiltersBar';
import { Composer, findMentionQuery, insertMention, wrapSelection } from '../src/components/Composer';
import { groupThreads, ThreadList } from '../src/components/ThreadList';
import { exportQuery } from '../src/components/ExportDialog';
import { copyText } from '../src/components/copy';
import { flush, member, bo, mockHost, thread, threads } from './fixtures';

let root: HTMLElement;
function mount(vnode: preact.VNode) {
  root = document.createElement('div');
  document.body.appendChild(root);
  act(() => render(vnode, root));
  return root;
}
afterEach(() => {
  if (root) {
    render(null, root);
    root.remove();
  }
});

describe('ThreadList', () => {
  it('groups by site then page, preserving order', () => {
    const g = groupThreads(threads());
    expect(g.map((s) => s.site)).toEqual(['staging.example.com', 'app.example.com']);
    expect(g[0].pages.map((p) => p.pageId)).toEqual(['p1', 'p2']);
    expect(g[0].pages[0].threads.map((t) => t.id)).toEqual(['a', 'c']);
    expect(g[0].count).toBe(3);
  });

  it('renders groups and reports selection and open', () => {
    const { host } = mockHost();
    const onOpen = vi.fn();
    const onToggleSelect = vi.fn();
    const el = mount(h(UiProvider, { host }, h(ThreadList, { threads: threads(), onOpen, onToggleSelect, selected: new Set() })));
    expect(el.querySelectorAll('.pp-site-group')).toHaveLength(2);
    expect(el.querySelectorAll('.pp-page-group')).toHaveLength(3);
    act(() => (el.querySelector('.pp-thread-row-main') as HTMLButtonElement).click());
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    const cb = el.querySelector('.pp-thread-row input[type=checkbox]') as HTMLInputElement;
    act(() => cb.click());
    expect(onToggleSelect).toHaveBeenCalledWith('a', true);
  });
});

describe('FiltersBar', () => {
  it('combines filters and sort', () => {
    const { host } = mockHost();
    const onChange = vi.fn();
    const el = mount(h(UiProvider, { host }, h(FiltersBar, { filters: { scope: 'area' }, sort: 'activity', members: [member(bo)], onChange })));
    const status = el.querySelector('select[aria-label=Status]') as HTMLSelectElement;
    act(() => {
      status.value = 'resolved';
      status.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith({ scope: 'area', status: 'resolved' }, 'activity');
    const assignee = el.querySelector('select[aria-label=Assignee]') as HTMLSelectElement;
    act(() => {
      assignee.value = '__none';
      assignee.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith({ scope: 'area', unassigned: true }, 'activity');
    const sort = el.querySelector('select[aria-label=Sort]') as HTMLSelectElement;
    act(() => {
      sort.value = 'priority';
      sort.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith({ scope: 'area' }, 'priority');
  });
});

describe('ThreadView', () => {
  it('loads, renders safely and resolves', async () => {
    const { host, api } = mockHost();
    const el = mount(h(UiProvider, { host }, h(ThreadView, { threadId: 't1' })));
    await act(flush);
    expect(api.getThread).toHaveBeenCalledWith('t1');
    expect(el.querySelector('.pp-body strong')?.textContent).toBe('off');
    expect(el.querySelector('.pp-mention')?.textContent).toBe('@Bo Chen');
    const resolve = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Resolve')!;
    await act(async () => {
      resolve.click();
      await flush();
    });
    expect(api.updateThread).toHaveBeenCalledWith('t1', { status: 'resolved' });
    expect([...el.querySelectorAll('button')].some((b) => b.textContent === 'Reopen')).toBe(true);
  });

  it('copies a selector from the Copy as menu', async () => {
    const { host } = mockHost();
    const el = mount(h(UiProvider, { host }, h(ThreadView, { threadId: 't1' })));
    await act(flush);
    await act(async () => {
      (el.querySelector('[aria-label="Thread actions"]') as HTMLButtonElement).click();
      await flush();
    });
    const item = [...el.querySelectorAll('[role=menuitem]')].find((b) => b.textContent === 'Copy as CSS selector') as HTMLButtonElement;
    await act(async () => {
      item.click();
      await flush();
    });
    expect(host.copy).toHaveBeenCalledWith("[data-testid='pricing-card']");
  });

  it('posts a reply through the host', async () => {
    const { host } = mockHost();
    const el = mount(h(UiProvider, { host }, h(ThreadView, { threadId: 't1' })));
    await act(flush);
    const ta = el.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      ta.value = 'on it';
      ta.selectionStart = ta.selectionEnd = 5;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await flush();
    });
    await act(async () => {
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await flush();
    });
    expect(host.postReply).toHaveBeenCalledWith('w1', 't1', 'on it', []);
  });

  it('hides resolve from guests on others’ threads', async () => {
    const { host } = mockHost({}, 'guest');
    const el = mount(h(UiProvider, { host }, h(ThreadView, { threadId: 't1' })));
    // guest is the author (ana) in fixtures → can resolve own; make the thread someone else's
    (host.api.getThread as any).mockResolvedValue(thread({ createdBy: 'u2' }));
    act(() => render(h(UiProvider, { host }, h(ThreadView, { threadId: 't2' })), el));
    await act(flush);
    expect([...el.querySelectorAll('button')].some((b) => b.textContent === 'Resolve')).toBe(false);
  });
});

describe('mentions', () => {
  it('detects a mention query at the caret', () => {
    expect(findMentionQuery('hi @an', 6)).toEqual({ start: 3, query: 'an' });
    expect(findMentionQuery('email a@b', 9)).toBeNull();
    expect(findMentionQuery('@', 1)).toEqual({ start: 0, query: '' });
  });
  it('inserts a mention token', () => {
    const r = insertMention('hi @an there', 3, 6, { userId: 'u1', user: { name: 'Ana Lima', email: 'a@x' } });
    expect(r.text).toBe('hi @[Ana Lima](u1)  there');
    expect(r.caret).toBe('hi @[Ana Lima](u1) '.length);
  });
  it('wraps selections for formatting', () => {
    expect(wrapSelection('make bold', 5, 9, '**').text).toBe('make **bold**');
  });
  it('picks a member from the picker with the keyboard', async () => {
    const { host } = mockHost();
    const onSubmit = vi.fn(async () => {});
    const el = mount(h(UiProvider, { host }, h(Composer, { members: [member(bo)], onSubmit })));
    const ta = el.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      ta.value = 'ping @bo';
      ta.selectionStart = ta.selectionEnd = 8;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await flush();
    });
    expect(el.querySelector('[role=listbox]')?.textContent).toContain('Bo Chen');
    await act(async () => {
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await flush();
    });
    expect(ta.value).toBe('ping @[Bo Chen](u2) ');
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('export & copy helpers', () => {
  it('builds export queries per target', () => {
    const q = { status: 'open' as const, sort: 'activity' as const, limit: 50, cursor: 'x' };
    expect(exportQuery('selection', { selectedIds: ['a'], query: q })).toEqual({ ids: ['a'] });
    expect(exportQuery('filter', { selectedIds: [], query: q })).toEqual({ status: 'open', sort: 'activity' });
    expect(exportQuery('page', { selectedIds: [], query: q, pageId: 'p1' })).toEqual({ pageId: 'p1', sort: 'page' });
    expect(exportQuery('site', { selectedIds: [], query: q, site: 's' })).toEqual({ site: 's', sort: 'page' });
  });
  it('produces copy texts with fallbacks', () => {
    const t = thread({ shareToken: 'abc' });
    expect(copyText(t, 'component', 'http://srv')).toBe('<PricingCard> (src/Pricing.tsx:12) [react]');
    expect(copyText(t, 'jspath', 'http://srv')).toBe(`document.querySelector("[data-testid='pricing-card']")`);
    expect(copyText(t, 'markdown', 'http://srv')).toContain('http://srv/share/abc');
    expect(copyText(t, 'ai', 'http://srv')).toContain('CSS selector: [data-testid=\'pricing-card\']');
    const noComp = thread({ anchor: { ...t.anchor, component: undefined } });
    expect(copyText(noComp, 'component', 'http://srv')).toBe("[data-testid='pricing-card']");
  });
});
