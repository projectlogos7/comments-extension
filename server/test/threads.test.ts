import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anchor, makeApp, type TestApp } from './helpers';

let t: TestApp;
let ana: string, bo: string, cy: string;
let ws: string;
let boId: string, cyId: string;

const create = (tok: string, extra: Record<string, unknown> = {}) =>
  t.req('POST', `/api/v1/workspaces/${ws}/threads`, tok, {
    url: 'https://shop.example.com/pricing?utm_source=x',
    title: 'Pricing',
    scope: 'area',
    urlMatch: 'path',
    anchor: anchor(),
    body: 'padding is off on mobile',
    ...extra,
  });

beforeAll(async () => {
  t = await makeApp();
  ana = await t.login('ana@ex.com', 'Ana');
  bo = await t.login('bo@ex.com', 'Bo');
  cy = await t.login('cy@ex.com', 'Cy');
  const m = await t.req('POST', '/api/v1/workspaces', ana, { name: 'Team' });
  ws = m.json.workspace.id;
  const link = m.json.workspace.inviteToken;
  await t.req('POST', `/api/v1/invites/${link}/accept`, bo);
  await t.req('POST', `/api/v1/invites/${link}/accept`, cy);
  const members = (await t.req('GET', `/api/v1/workspaces/${ws}/members`, ana)).json;
  boId = members.find((x: any) => x.user.name === 'Bo').userId;
  cyId = members.find((x: any) => x.user.name === 'Cy').userId;
});
afterAll(() => t.close());

describe('threads', () => {
  it('creates a thread on a normalized page with numbering and mentions', async () => {
    const r = await create(ana, { body: `please check @[Bo](${boId}) and @[Ghost](00000000-0000-0000-0000-000000000000)`, type: 'bug', priority: 'high' });
    expect(r.status).toBe(200);
    expect(r.json.page.normalizedUrl).toBe('https://shop.example.com/pricing');
    expect(r.json.number).toBe(1);
    expect(r.json.comments[0].mentions).toEqual([boId]);
    expect(r.json.unread).toBe(false);
    const n = await t.req('GET', '/api/v1/notifications', bo);
    expect(n.json[0].event).toBe('mention');
    expect(n.json[0].title).toContain('Ana mentioned you');
    expect((await t.req('GET', '/api/v1/notifications/counts', bo)).json).toEqual({ mentions: 1, notifications: 1 });
    // email immediately
    expect(t.ctx.mailer.outbox.some((m) => m.to === 'bo@ex.com' && m.text.includes('pinpoint_thread='))).toBe(true);
    const second = await create(bo, { anchor: anchor(20), scope: 'section' });
    expect(second.json.number).toBe(2);
  });

  it('is idempotent by clientId', async () => {
    const a = await create(ana, { clientId: 'c-1' });
    const b = await create(ana, { clientId: 'c-1' });
    expect(a.json.id).toBe(b.json.id);
  });

  it('matches threads for a URL by match level', async () => {
    await create(ana, { url: 'https://shop.example.com/pricing?plan=pro', urlMatch: 'exact', body: 'exact one' });
    await create(ana, { url: 'https://shop.example.com/about', urlMatch: 'site', body: 'site wide' });
    const r = await t.req('GET', `/api/v1/workspaces/${ws}/threads/for-url?url=${encodeURIComponent('https://www.shop.example.com/pricing/?utm_campaign=1')}`, bo);
    const bodies = r.json.threads.map((x: any) => x.firstComment.body);
    expect(bodies).toContain('site wide');
    expect(bodies).not.toContain('exact one');
    expect(r.json.page.normalizedUrl).toBe('https://shop.example.com/pricing');
    const r2 = await t.req('GET', `/api/v1/workspaces/${ws}/threads/for-url?url=${encodeURIComponent('https://shop.example.com/pricing?plan=pro')}`, bo);
    expect(r2.json.threads.map((x: any) => x.firstComment.body)).toContain('exact one');
    const other = await t.req('GET', `/api/v1/workspaces/${ws}/threads/for-url?url=${encodeURIComponent('https://other.com/pricing')}`, bo);
    expect(other.json.threads).toEqual([]);
  });

  it('replies notify participants, mark unread, read clears', async () => {
    const th = (await create(ana, { body: 'reply target' })).json;
    await t.req('POST', `/api/v1/threads/${th.id}/comments`, bo, { body: 'on it' });
    const ns = (await t.req('GET', '/api/v1/notifications', ana)).json;
    expect(ns[0]).toMatchObject({ event: 'reply', threadId: th.id });
    const listed = (await t.req('GET', `/api/v1/workspaces/${ws}/threads?unread=true`, ana)).json.items;
    expect(listed.map((x: any) => x.id)).toContain(th.id);
    await t.req('POST', `/api/v1/threads/${th.id}/read`, ana);
    const after = (await t.req('GET', `/api/v1/workspaces/${ws}/threads?unread=true`, ana)).json.items;
    expect(after.map((x: any) => x.id)).not.toContain(th.id);
    const d = (await t.req('GET', `/api/v1/threads/${th.id}`, ana)).json;
    expect(d.commentCount).toBe(2);
    expect(d.comments).toHaveLength(2);
  });

  it('filters, search, sort and pagination', async () => {
    const all = await t.req('GET', `/api/v1/workspaces/${ws}/threads?limit=2`, ana);
    expect(all.json.items).toHaveLength(2);
    expect(all.json.total).toBeGreaterThan(2);
    const page2 = await t.req('GET', `/api/v1/workspaces/${ws}/threads?limit=2&cursor=${all.json.nextCursor}`, ana);
    expect(page2.json.items[0].id).not.toBe(all.json.items[0].id);
    const bugs = await t.req('GET', `/api/v1/workspaces/${ws}/threads?type=bug&priority=high`, ana);
    expect(bugs.json.items).toHaveLength(1);
    const mentions = await t.req('GET', `/api/v1/workspaces/${ws}/threads?mentionsMe=true`, bo);
    expect(mentions.json.items).toHaveLength(1);
    const search = await t.req('GET', `/api/v1/workspaces/${ws}/threads?q=paddings`, ana);
    expect(search.json.total).toBeGreaterThan(0);
    const byTitle = await t.req('GET', `/api/v1/workspaces/${ws}/threads?q=Pricing`, ana);
    expect(byTitle.json.total).toBeGreaterThan(0);
    const none = await t.req('GET', `/api/v1/workspaces/${ws}/threads?q=zzzunknownzzz`, ana);
    expect(none.json.total).toBe(0);
    const sections = await t.req('GET', `/api/v1/workspaces/${ws}/threads?scope=section`, ana);
    expect(sections.json.items).toHaveLength(1);
    const byPage = await t.req('GET', `/api/v1/workspaces/${ws}/threads?sort=page&site=shop.example.com`, ana);
    const pricing = byPage.json.items.filter((x: any) => x.page.normalizedUrl === 'https://shop.example.com/pricing');
    expect(pricing[0].anchor.docRect.y).toBe(20);
    const prio = await t.req('GET', `/api/v1/workspaces/${ws}/threads?sort=priority`, ana);
    expect(prio.json.items[0].priority).toBe('high');
    const pages = await t.req('GET', `/api/v1/workspaces/${ws}/pages`, ana);
    expect(pages.json.find((p: any) => p.normalizedUrl === 'https://shop.example.com/pricing').threadCount).toBeGreaterThan(1);
    const today = new Date().toISOString().slice(0, 10);
    expect((await t.req('GET', `/api/v1/workspaces/${ws}/threads?from=${today}&to=${today}`, ana)).json.total).toBe(all.json.total);
  });

  it('resolve, assign, scope change history, activity', async () => {
    const th = (await create(bo, { body: 'resolve me' })).json;
    const a = await t.req('PATCH', `/api/v1/threads/${th.id}`, ana, { assigneeId: cyId });
    expect(a.json.assignee.name).toBe('Cy');
    expect((await t.req('GET', '/api/v1/notifications', cy)).json[0].event).toBe('assignment');
    const r = await t.req('PATCH', `/api/v1/threads/${th.id}`, cy, { status: 'resolved' });
    expect(r.json.status).toBe('resolved');
    expect(r.json.resolvedBy).toBe(cyId);
    expect((await t.req('GET', '/api/v1/notifications', bo)).json[0].event).toBe('resolution');
    const s = await t.req('PATCH', `/api/v1/threads/${th.id}`, bo, { scope: 'section', anchor: anchor(500, { section: { landmark: 'main', heading: 'Plans' } }) });
    expect(s.json.scope).toBe('section');
    expect(s.json.anchorHistory).toHaveLength(1);
    expect(s.json.anchorHistory[0].scope).toBe('area');
    const act = await t.req('GET', `/api/v1/workspaces/${ws}/activity?threadId=${th.id}`, ana);
    expect(act.json.map((x: any) => x.action)).toEqual(expect.arrayContaining(['thread.created', 'thread.assigned', 'thread.resolved', 'thread.scope_changed']));
    const bad = await t.req('PATCH', `/api/v1/threads/${th.id}`, ana, { assigneeId: '00000000-0000-0000-0000-000000000000' });
    expect(bad.status).toBe(400);
  });

  it('comment permissions, edit, delete, restore, reactions', async () => {
    const th = (await create(ana, { body: 'mine' })).json;
    const cid = th.comments[0].id;
    expect((await t.req('PATCH', `/api/v1/comments/${cid}`, bo, { body: 'hijack' })).status).toBe(403);
    expect((await t.req('DELETE', `/api/v1/comments/${cid}`, bo)).status).toBe(403);
    const e = await t.req('PATCH', `/api/v1/comments/${cid}`, ana, { body: `edited @[Cy](${cyId})` });
    expect(e.json.editedAt).not.toBeNull();
    expect((await t.req('GET', '/api/v1/notifications', cy)).json[0].event).toBe('mention');
    const re = await t.req('POST', `/api/v1/comments/${cid}/reactions`, bo, { emoji: '👍' });
    expect(re.json.reactions).toEqual([{ emoji: '👍', userIds: [boId] }]);
    const re2 = await t.req('POST', `/api/v1/comments/${cid}/reactions`, bo, { emoji: '👍' });
    expect(re2.json.reactions).toEqual([]);
    expect((await t.req('DELETE', `/api/v1/comments/${cid}`, ana)).status).toBe(204);
    const d = (await t.req('GET', `/api/v1/threads/${th.id}`, ana)).json;
    expect(d.comments[0].deletedAt).not.toBeNull();
    expect(d.comments[0].body).toBe('');
    const rs = await t.req('POST', `/api/v1/comments/${cid}/restore`, ana);
    expect(rs.json.body).toContain('edited');
    // owner (admin) can delete anyone's comment; bo cannot delete ana's thread
    const reply = (await t.req('POST', `/api/v1/threads/${th.id}/comments`, bo, { body: 'bo says' })).json;
    expect((await t.req('DELETE', `/api/v1/comments/${reply.id}`, ana)).status).toBe(204);
    expect((await t.req('DELETE', `/api/v1/threads/${th.id}`, bo)).status).toBe(403);
    expect((await t.req('DELETE', `/api/v1/threads/${th.id}`, ana)).status).toBe(204);
    expect((await t.req('GET', `/api/v1/threads/${th.id}`, ana)).status).toBe(404);
  });

  it('bulk actions', async () => {
    const a = (await create(ana, { body: 'bulk a' })).json;
    const b = (await create(ana, { body: 'bulk b' })).json;
    const r = await t.req('POST', `/api/v1/workspaces/${ws}/threads/bulk`, bo, { ids: [a.id, b.id], action: 'resolve' });
    expect(r.json.updated).toBe(2);
    await t.req('POST', `/api/v1/workspaces/${ws}/threads/bulk`, bo, { ids: [a.id, b.id], action: 'priority', priority: 'low' });
    const got = (await t.req('GET', `/api/v1/threads/${a.id}`, bo)).json;
    expect(got).toMatchObject({ status: 'resolved', priority: 'low' });
    const del = await t.req('POST', `/api/v1/workspaces/${ws}/threads/bulk`, bo, { ids: [a.id], action: 'delete' });
    expect(del.status).toBe(403);
  });

  it('validates input', async () => {
    expect((await create(ana, { body: '' })).json.error.code).toBe('validation_error');
    expect((await create(ana, { url: 'not a url' })).status).toBe(400);
    expect((await create(ana, { scope: 'galaxy' })).status).toBe(400);
  });
});
