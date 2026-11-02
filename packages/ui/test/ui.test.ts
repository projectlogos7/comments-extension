// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { h as preactH, render } from 'preact';
// Loosely typed h() so tests can pass component props without overload noise.
const h = (c: any, props: any, ...children: any[]) => preactH(c, props, ...children);
import { act } from 'preact/test-utils';
import { UiProvider } from '../src/context';
import { ThreadView } from '../src/components/ThreadView';
import { FiltersBar } from '../src/components/FiltersBar';
import { Composer, findMentionQuery, wrapSelection } from '../src/components/Composer';
import { computePosition, Menu, Modal, openLayerCount, Select } from '../src/components/common';
import { EmailChips, parseEmails } from '../src/components/Invite';
import { errorMessage, RATE_LIMIT_MESSAGE } from '../src/context';
import { ApiError } from '@pinpoint/shared';
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
    act(() => render(null, root));
    root.remove();
  }
  document.getElementById('pp-layer-root')?.remove();
});

/** Open a custom Select by its accessible name and click the option with this label. */
async function choose(container: ParentNode, name: string, optionLabel: string) {
  const btn = [...container.querySelectorAll<HTMLButtonElement>('button[aria-haspopup=listbox]')].find((b) => b.getAttribute('aria-label')?.startsWith(name + ':'));
  if (!btn) throw new Error(`select ${name} not found`);
  await act(async () => {
    btn.click();
    await flush();
  });
  const opt = [...document.querySelectorAll<HTMLElement>('[role=option]')].find((o) => o.textContent?.includes(optionLabel));
  if (!opt) throw new Error(`option ${optionLabel} not found`);
  await act(async () => {
    opt.click();
    await flush();
  });
}

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
  it('combines filters and sort through overlay selects', async () => {
    const { host } = mockHost();
    const onChange = vi.fn();
    const el = mount(h(UiProvider, { host }, h(FiltersBar, { filters: { scope: 'area' }, sort: 'activity', members: [member(bo)], onChange })));
    await choose(el, 'Status', 'Resolved');
    expect(onChange).toHaveBeenLastCalledWith({ scope: 'area', status: 'resolved' }, 'activity');
    await choose(el, 'Assignee', 'Unassigned');
    expect(onChange).toHaveBeenLastCalledWith({ scope: 'area', unassigned: true }, 'activity');
    await choose(el, 'Sort', 'Priority');
    expect(onChange).toHaveBeenLastCalledWith({ scope: 'area' }, 'priority');
    // listboxes render in the top-level layer, never inside the filter bar
    expect(el.querySelector('[role=listbox]')).toBeNull();
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
    const item = [...document.querySelectorAll('[role=menuitem]')].find((b) => b.textContent === 'Copy as CSS selector') as HTMLButtonElement;
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
  it('wraps selections for formatting', () => {
    expect(wrapSelection('make bold', 5, 9, '**').text).toBe('make **bold**');
  });
  it('shows @Name while typing and sends a mention token', async () => {
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
    expect(document.querySelector('[role=listbox]')?.textContent).toContain('Bo Chen');
    await act(async () => {
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await flush(8);
    });
    expect(ta.value).toBe('ping @Bo Chen ');
    expect(onSubmit).not.toHaveBeenCalled();
    await act(async () => {
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await flush();
    });
    expect(onSubmit).toHaveBeenCalledWith('ping @[Bo Chen](u2)', []);
  });
  it('decodes tokens when editing', () => {
    const { host } = mockHost();
    const el = mount(h(UiProvider, { host }, h(Composer, { members: [member(bo)], initial: 'hey @[Bo Chen](u2)', onSubmit: async () => {} })));
    expect((el.querySelector('textarea') as HTMLTextAreaElement).value).toBe('hey @Bo Chen');
  });
});

describe('overlays', () => {
  it('places popovers inside the viewport and flips above when needed', () => {
    const below = computePosition({ top: 100, bottom: 130, left: 10, right: 110 }, { w: 200, h: 150 }, { w: 800, h: 600 });
    expect(below).toMatchObject({ placement: 'bottom', top: 136, left: 10 });
    const above = computePosition({ top: 500, bottom: 530, left: 700, right: 790 }, { w: 200, h: 150 }, { w: 800, h: 600 });
    expect(above.placement).toBe('top');
    expect(above.left).toBe(592);
  });

  it('Esc closes only the topmost layer and returns focus to the trigger', async () => {
    const { host } = mockHost();
    const onClose = vi.fn();
    const el = mount(
      h(UiProvider, { host }, h(Modal, { title: 'Dialog', onClose }, h(Menu, { label: 'Actions', items: [{ label: 'One', onSelect: () => {} }] }))),
    );
    void el;
    const trigger = document.querySelector('button[aria-haspopup=menu]') as HTMLButtonElement;
    await act(async () => {
      trigger.focus();
      trigger.click();
      await flush();
    });
    expect(document.querySelector('[role=menu]')).not.toBeNull();
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await flush();
    });
    expect(document.querySelector('[role=menu]')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await flush();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Select supports keyboard choice', async () => {
    const { host } = mockHost();
    const onChange = vi.fn();
    mount(h(UiProvider, { host }, h(Select, { label: 'Fruit', value: 'a', onChange, options: [{ value: 'a', label: 'Apple' }, { value: 'b', label: 'Banana' }] })));
    const btn = document.querySelector('button[aria-haspopup=listbox]') as HTMLButtonElement;
    await act(async () => {
      btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await flush();
    });
    const lb = document.querySelector('[role=listbox]') as HTMLElement;
    expect(lb).not.toBeNull();
    await act(async () => {
      lb.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await flush();
    });
    await act(async () => {
      lb.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await flush();
    });
    expect(onChange).toHaveBeenCalledWith('b');
    expect(openLayerCount()).toBe(0);
  });
});

describe('invites', () => {
  it('parses pasted email lists', () => {
    expect(parseEmails('Ana <ana@x.com>, bo@x.com; c@x.com\n')).toEqual(['ana@x.com', 'bo@x.com', 'c@x.com']);
  });
  it('turns typed emails into chips and flags bad ones', async () => {
    const { host } = mockHost();
    let value: string[] = [];
    const onChange = vi.fn((v: string[]) => (value = v));
    const el = mount(h(UiProvider, { host }, h(EmailChips, { value, onChange, domain: 'x.com' })));
    const input = el.querySelector('input') as HTMLInputElement;
    await act(async () => {
      input.value = 'ana@x.com,';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await flush();
    });
    expect(onChange).toHaveBeenLastCalledWith(['ana@x.com']);
    act(() => render(h(UiProvider, { host }, h(EmailChips, { value: ['ana@x.com', 'bo@other.com'], onChange, domain: 'x.com' })), root));
    expect(el.querySelectorAll('.pp-chip')).toHaveLength(2);
    expect(el.querySelector('.pp-chip-bad')?.textContent).toContain('bo@other.com');
  });
});

describe('errors', () => {
  it('turns rate limiting into a calm message', () => {
    expect(errorMessage(new ApiError(429, 'rate_limited', 'Too many'))).toBe(RATE_LIMIT_MESSAGE);
    expect(errorMessage(new ApiError(403, 'forbidden', 'Nope'))).toBe('Nope');
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
