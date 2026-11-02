import { describe, expect, it, vi } from 'vitest';
import { orderPanelThreads, applyQuickFilter } from '../../../extension/src/sidepanel/order';
import { createApiProxy, extEventToUi } from '../../../extension/src/app/extHost';
import { realtimeToUiEvents } from '../../../web/src/webHost';
import { thread } from './fixtures';

describe('side panel ordering', () => {
  it('puts page comments first, then page order, then detached', () => {
    const ts = [
      thread({ id: 'x', number: 1 }),
      thread({ id: 'y', number: 2 }),
      thread({ id: 'p', number: 3, scope: 'page' }),
      thread({ id: 'z', number: 4 }),
      thread({ id: 'd', number: 5, detached: true }),
    ];
    const g = orderPanelThreads(ts, [
      { threadId: 'x', state: 'attached', score: 1, order: 20 },
      { threadId: 'y', state: 'attached', score: 1, order: 5 },
      { threadId: 'z', state: 'detached', score: 0.1, order: 0 },
    ]);
    expect(g.page.map((t) => t.id)).toEqual(['p']);
    expect(g.attached.map((t) => t.id)).toEqual(['y', 'x']);
    expect(g.detached.map((t) => t.id)).toEqual(['z', 'd']);
  });
  it('applies quick filters', () => {
    const ts = [thread({ id: 'a' }), thread({ id: 'b', status: 'resolved' }), thread({ id: 'c', createdBy: 'u9', assigneeId: 'u9' })];
    expect(applyQuickFilter(ts, { status: 'open', mine: true, scope: 'all' }, 'u1').map((t) => t.id)).toEqual(['a']);
    expect(applyQuickFilter(ts, { status: 'all', mine: false, scope: 'page' }, 'u1')).toEqual([]);
  });
});

describe('extension host', () => {
  it('proxies api calls as background messages', async () => {
    const send = vi.fn(async () => ({ page: null, threads: [] }));
    const api = createApiProxy(send as never);
    await api.threadsForUrl('w1', 'https://a.com/');
    expect(send).toHaveBeenCalledWith({ type: 'api', method: 'threadsForUrl', args: ['w1', 'https://a.com/'] });
  });
  it('maps background events', () => {
    expect(extEventToUi({ type: 'threads.changed', workspaceId: 'w1', threadId: 't' })).toEqual([{ kind: 'threads.changed', workspaceId: 'w1', threadId: 't', pageId: undefined }]);
    expect(extEventToUi({ type: 'api', method: 'x', args: [] })).toEqual([]);
  });
});

describe('web host', () => {
  it('maps realtime events', () => {
    expect(realtimeToUiEvents({ kind: 'comment.created', workspaceId: 'w1', threadId: 't', at: '' })[0]).toMatchObject({ kind: 'threads.changed', threadId: 't' });
    expect(realtimeToUiEvents({ kind: 'notification.created', workspaceId: 'w1', at: '' })).toEqual([{ kind: 'unread.changed' }]);
  });
});
