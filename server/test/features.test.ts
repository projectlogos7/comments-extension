import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import crypto from 'node:crypto';
import { anchor, makeApp, multipart, PNG, type TestApp } from './helpers';
import { runJobs } from '../src/services/jobs';
import { sendDigests } from '../src/services/notify';

let t: TestApp;
let ana: string, bo: string;
let ws: string;
let threadId: string;
const outbound: { url: string; init: any }[] = [];
const fakeFetch = (async (url: any, init: any) => {
  outbound.push({ url: String(url), init });
  if (String(url).includes('api.github.com')) return new Response(JSON.stringify({ html_url: 'https://github.com/o/r/issues/7', number: 7 }), { status: 201 });
  if (String(url).includes('linear.app'))
    return new Response(JSON.stringify({ data: { issueCreate: { success: true, issue: { id: 'x', identifier: 'ENG-1', url: 'https://linear.app/i/ENG-1' } } } }));
  if (String(url).includes('fail.example')) return new Response('nope', { status: 500 });
  return new Response('ok');
}) as typeof fetch;

async function upload(tok: string, kind: string, data = PNG, type = 'image/png') {
  const mp = multipart({ kind, context: JSON.stringify({ pageUrl: 'https://s.example.com/p', pageTitle: 'P', viewport: { w: 1, h: 1 }, dpr: 2, browser: 'Chrome 130', os: 'macOS', scroll: { x: 0, y: 40 }, capturedAt: new Date().toISOString() }) }, { name: `${kind}.png`, type, data });
  const r = await t.app.inject({ method: 'POST', url: `/api/v1/threads/${threadId}/snapshots`, headers: { ...mp.headers, authorization: `Bearer ${tok}` }, payload: mp.payload });
  return { status: r.statusCode, json: r.json() };
}

beforeAll(async () => {
  t = await makeApp(fakeFetch);
  ana = await t.login('ana@ex.com', 'Ana');
  bo = await t.login('bo@ex.com', 'Bo');
  const m = await t.req('POST', '/api/v1/workspaces', ana, { name: 'Team' });
  ws = m.json.workspace.id;
  await t.req('POST', `/api/v1/invites/${m.json.workspace.inviteToken}/accept`, bo);
  threadId = (
    await t.req('POST', `/api/v1/workspaces/${ws}/threads`, ana, { url: 'https://s.example.com/p', title: 'Shop', scope: 'area', urlMatch: 'path', anchor: anchor(), body: '**Hero** copy is wrong', type: 'content' })
  ).json.id;
});
afterAll(() => t.close());

describe('snapshots and files', () => {
  it('uploads, signs URLs and keeps history on retake', async () => {
    const a = await upload(ana, 'area');
    expect(a.status).toBe(200);
    expect(a.json).toMatchObject({ kind: 'area', width: 1, height: 1, contentType: 'image/png' });
    const url = new URL(a.json.url);
    const f = await t.app.inject({ method: 'GET', url: url.pathname + url.search });
    expect(f.statusCode).toBe(200);
    expect(f.headers['content-type']).toBe('image/png');
    const tampered = await t.app.inject({ method: 'GET', url: url.pathname + url.search.replace(/sig=(.)/, (_m, c: string) => `sig=${c === 'X' ? 'Y' : 'X'}`) });
    expect(tampered.statusCode).toBe(404);
    await upload(ana, 'area');
    const d = (await t.req('GET', `/api/v1/threads/${threadId}`, ana)).json;
    expect(d.snapshots.filter((s: any) => s.kind === 'area')).toHaveLength(1);
    expect(d.snapshotHistory.filter((s: any) => s.kind === 'area')).toHaveLength(2);
    expect((await upload(bo, 'viewport')).status).toBe(403); // not the author
    expect((await upload(ana, 'area', Buffer.from('<script>'), 'image/png')).status).toBe(400);
  });

  it('respects privacy settings', async () => {
    await t.req('PATCH', `/api/v1/workspaces/${ws}`, ana, { privacy: { allowFullPage: false } });
    expect((await upload(ana, 'fullpage')).status).toBe(403);
    await t.req('PATCH', `/api/v1/workspaces/${ws}`, ana, { privacy: { allowFullPage: true } });
    expect((await upload(ana, 'fullpage')).status).toBe(200);
    const dom = await upload(ana, 'dom', Buffer.from('<html><body>hi</body></html>'), 'text/html');
    expect(dom.json.contentType).toContain('text/html');
    const u = new URL(dom.json.url);
    const f = await t.app.inject({ method: 'GET', url: u.pathname + u.search });
    expect(f.headers['content-security-policy']).toContain('sandbox');
  });

  it('attachments link to comments', async () => {
    const mp = multipart({}, { name: 'shot.png', type: 'image/png', data: PNG });
    const r = await t.app.inject({ method: 'POST', url: `/api/v1/workspaces/${ws}/attachments`, headers: { ...mp.headers, authorization: `Bearer ${bo}` }, payload: mp.payload });
    expect(r.statusCode).toBe(200);
    const att = r.json();
    const c = await t.req('POST', `/api/v1/threads/${threadId}/comments`, bo, { body: 'see image', attachmentIds: [att.id] });
    expect(c.json.attachments[0].id).toBe(att.id);
    expect((await t.req('POST', `/api/v1/threads/${threadId}/comments`, bo, { body: 'again', attachmentIds: [att.id] })).status).toBe(400);
  });
});

describe('share links', () => {
  it('members-only by default, public when allowed, revocable', async () => {
    const s = await t.req('POST', `/api/v1/threads/${threadId}/share`, bo);
    expect(s.json.url).toBe(`http://pinpoint.test/share/${s.json.token}`);
    expect((await t.req('POST', `/api/v1/threads/${threadId}/share`, ana)).json.token).toBe(s.json.token);
    expect((await t.req('GET', `/api/v1/share/${s.json.token}`)).status).toBe(401);
    const asMember = await t.req('GET', `/api/v1/share/${s.json.token}`, bo);
    expect(asMember.json.kind).toBe('thread');
    expect(asMember.json.threads[0].comments[0].body).toContain('Hero');
    const outsider = await t.login('x@y.com');
    expect((await t.req('GET', `/api/v1/share/${s.json.token}`, outsider)).status).toBe(403);
    // SSR shell does not leak content when members-only
    const shell = await t.req('GET', `/share/${s.json.token}`);
    expect(shell.status).toBe(200);
    expect(shell.text).not.toContain('Hero');
    expect(shell.text).toContain('Sign in to view');
    const frag = await t.req('GET', `/share/${s.json.token}/content`, bo);
    expect(frag.text).toContain('<strong>Hero</strong>');
    expect(frag.text).toContain('pinpoint_thread=');
    // anyone with link
    await t.req('PATCH', `/api/v1/workspaces/${ws}`, ana, { linkSharing: 'anyone' });
    const pub = await t.req('GET', `/share/${s.json.token}`);
    expect(pub.text).toContain('<strong>Hero</strong>');
    expect(pub.text).toMatch(/<meta property="og:image" content="http:\/\/pinpoint\.test\/files\//);
    expect(pub.text).toContain('Chrome 130');
    expect(pub.headers['content-security-policy']).toContain("script-src 'nonce-");
    expect((await t.req('GET', `/api/v1/share/${s.json.token}`)).status).toBe(200);
    expect((await t.req('GET', `/api/v1/threads/${threadId}`, ana)).json.shareToken).toBe(s.json.token);
    await t.req('DELETE', `/api/v1/threads/${threadId}/share`, ana);
    expect((await t.req('GET', `/share/${s.json.token}`)).status).toBe(404);
    // page link lists every thread on the page
    const pageId = (await t.req('GET', `/api/v1/threads/${threadId}`, ana)).json.pageId;
    const ps = await t.req('POST', `/api/v1/pages/${pageId}/share`, ana);
    const pv = await t.req('GET', `/api/v1/share/${ps.json.token}`);
    expect(pv.json.kind).toBe('page');
    expect(pv.json.threads.length).toBeGreaterThan(0);
    await t.req('PATCH', `/api/v1/workspaces/${ws}`, ana, { linkSharing: 'members' });
  });
});

describe('export and views', () => {
  it('exports md/csv/json/pdf with download tokens', async () => {
    const { token } = (await t.req('POST', `/api/v1/workspaces/${ws}/export-token`, bo)).json;
    const get = (fmt: string, extra = '') => t.app.inject({ method: 'GET', url: `/api/v1/workspaces/${ws}/export?format=${fmt}&dt=${token}${extra}` });
    const md = await get('md');
    expect(md.statusCode).toBe(200);
    expect(md.body).toContain('Hero copy is wrong');
    expect(md.headers['content-disposition']).toMatch(/attachment; filename="pinpoint-team-.*\.md"/);
    const csv = await get('csv', '&type=content');
    expect(csv.body.split('\r\n')[0]).toContain('number,page_title');
    expect(csv.body).toContain('http://pinpoint.test/app/#/thread/');
    const json = JSON.parse((await get('json', `&ids=${threadId}`)).body);
    expect(json.count).toBe(1);
    expect(json.threads[0].comments.length).toBeGreaterThan(0);
    const pdf = await get('pdf');
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await t.app.inject({ method: 'GET', url: `/api/v1/workspaces/${ws}/export?format=md&dt=bad` })).statusCode).toBe(401);
  });

  it('saved views: private and shared', async () => {
    const v = await t.req('POST', `/api/v1/workspaces/${ws}/views`, ana, { name: 'Open bugs', filters: { status: 'open', type: 'bug' }, sort: 'priority', shared: true });
    expect(v.json.filters).toEqual({ status: 'open', type: 'bug' });
    await t.req('POST', `/api/v1/workspaces/${ws}/views`, ana, { name: 'Mine', filters: { authorId: 'x' } });
    const bos = (await t.req('GET', `/api/v1/workspaces/${ws}/views`, bo)).json;
    expect(bos.map((x: any) => x.name)).toEqual(['Open bugs']);
    expect((await t.req('PATCH', `/api/v1/workspaces/${ws}/views/${v.json.id}`, bo, { name: 'x' })).status).toBe(403);
    expect((await t.req('PATCH', `/api/v1/workspaces/${ws}/views/${v.json.id}`, ana, { name: 'Open bugs R4' })).json.name).toBe('Open bugs R4');
    expect((await t.req('DELETE', `/api/v1/workspaces/${ws}/views/${v.json.id}`, ana)).status).toBe(204);
  });
});

describe('public API, webhooks and integrations', () => {
  it('API keys act as the workspace', async () => {
    const k = await t.req('POST', `/api/v1/workspaces/${ws}/api-keys`, ana, { name: 'CI' });
    expect(k.json.key).toMatch(/^pk_/);
    const list = await t.req('GET', `/api/v1/workspaces/${ws}/threads`, k.json.key);
    expect(list.json.total).toBeGreaterThan(0);
    expect((await t.req('GET', '/api/v1/me', k.json.key)).status).toBe(403);
    const other = (await t.req('POST', '/api/v1/workspaces', bo, { name: 'Other' })).json.workspace.id;
    expect((await t.req('GET', `/api/v1/workspaces/${other}/threads`, k.json.key)).status).toBe(404);
    expect((await t.req('GET', `/api/v1/workspaces/${ws}/api-keys`, ana)).json[0].lastUsedAt).not.toBeNull();
    await t.req('DELETE', `/api/v1/workspaces/${ws}/api-keys/${k.json.id}`, ana);
    expect((await t.req('GET', `/api/v1/workspaces/${ws}/threads`, k.json.key)).status).toBe(401);
  });

  it('delivers signed webhooks', async () => {
    const h = await t.req('POST', `/api/v1/workspaces/${ws}/webhooks`, ana, { url: 'https://hooks.example.com/pp', events: ['comment.created'] });
    expect(h.json.secret).toMatch(/^whsec_/);
    outbound.length = 0;
    await t.req('POST', `/api/v1/threads/${threadId}/comments`, bo, { body: 'webhook me' });
    await new Promise((r) => setTimeout(r, 50));
    const call = outbound.find((o) => o.url === 'https://hooks.example.com/pp')!;
    expect(call).toBeTruthy();
    const ts = call.init.headers['x-pinpoint-timestamp'];
    const expected = 'sha256=' + crypto.createHmac('sha256', h.json.secret).update(`${ts}.${call.init.body}`).digest('hex');
    expect(call.init.headers['x-pinpoint-signature']).toBe(expected);
    const payload = JSON.parse(call.init.body);
    expect(payload.event).toBe('comment.created');
    expect(payload.data.comment.body).toBe('webhook me');
    expect((await t.req('GET', `/api/v1/workspaces/${ws}/webhooks`, ana)).json[0].secret).toBeUndefined();
    expect((await t.req('POST', `/api/v1/workspaces/${ws}/webhooks`, bo, { url: 'https://x.com', events: ['thread.created'] })).status).toBe(403);
  });

  it('integrations: masked secrets, tickets and chat posts', async () => {
    const save = await t.req('PUT', `/api/v1/workspaces/${ws}/integrations/github`, ana, { enabled: true, settings: { token: 'ghp_secret1234', owner: 'o', repo: 'r' } });
    expect(save.json.settings.token).toBe('••••1234');
    // re-saving masked value keeps secret
    await t.req('PUT', `/api/v1/workspaces/${ws}/integrations/github`, ana, { enabled: true, settings: { token: '••••1234', owner: 'o', repo: 'r2' } });
    outbound.length = 0;
    const tk = await t.req('POST', `/api/v1/threads/${threadId}/tickets`, bo, { kind: 'github' });
    expect(tk.json).toMatchObject({ kind: 'github', url: 'https://github.com/o/r/issues/7', externalId: '7' });
    expect(outbound[0].url).toBe('https://api.github.com/repos/o/r2/issues');
    expect(outbound[0].init.headers.authorization).toBe('Bearer ghp_secret1234');
    expect((await t.req('GET', `/api/v1/threads/${threadId}/tickets`, bo)).json).toHaveLength(1);
    await t.req('PUT', `/api/v1/workspaces/${ws}/integrations/linear`, ana, { enabled: true, settings: { apiKey: 'lin_x', teamId: 'T' } });
    expect((await t.req('POST', `/api/v1/threads/${threadId}/tickets`, bo, { kind: 'linear' })).json.externalId).toBe('ENG-1');
    expect((await t.req('POST', `/api/v1/threads/${threadId}/tickets`, bo, { kind: 'jira' })).json.error.code).toBe('integration_disabled');
    expect((await t.req('PUT', `/api/v1/workspaces/${ws}/integrations/slack`, ana, { enabled: true, settings: {} })).status).toBe(400);
    await t.req('PUT', `/api/v1/workspaces/${ws}/integrations/slack`, ana, { enabled: true, settings: { webhookUrl: 'https://hooks.slack.com/services/T/B/X' } });
    outbound.length = 0;
    expect((await t.req('POST', `/api/v1/threads/${threadId}/post`, bo, { kind: 'slack' })).status).toBe(204);
    expect(outbound[0].url).toBe('https://hooks.slack.com/services/T/B/X');
    // mentions go to Slack too
    outbound.length = 0;
    const boId = (await t.req('GET', '/api/v1/me', bo)).json.user.id;
    await t.req('POST', `/api/v1/threads/${threadId}/comments`, ana, { body: `@[Bo](${boId}) look` });
    await new Promise((r) => setTimeout(r, 20));
    expect(outbound.some((o) => o.url.includes('hooks.slack.com') && o.init.body.includes('mentioned you'))).toBe(true);
    expect((await t.req('GET', `/api/v1/workspaces/${ws}/integrations`, bo)).status).toBe(403);
  });
});

describe('realtime', () => {
  it('pushes events to subscribed members over WebSocket', async () => {
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    const addr = t.app.server.address() as any;
    const sock = new WebSocket(`ws://127.0.0.1:${addr.port}/api/v1/ws?token=${bo}`);
    const msgs: any[] = [];
    sock.on('message', (d) => msgs.push(JSON.parse(String(d))));
    await new Promise((r) => sock.on('open', r));
    sock.send(JSON.stringify({ type: 'subscribe', workspaceId: ws }));
    await waitFor(() => msgs.some((m) => m.type === 'subscribed'));
    const boId = (await t.req('GET', '/api/v1/me', bo)).json.user.id;
    await t.req('POST', `/api/v1/threads/${threadId}/comments`, ana, { body: `live @[Bo](${boId})` });
    await waitFor(() => msgs.some((m) => m.event?.kind === 'comment.created') && msgs.some((m) => m.event?.kind === 'notification.created'));
    const ev = msgs.find((m) => m.event?.kind === 'comment.created').event;
    expect(ev).toMatchObject({ workspaceId: ws, threadId });
    sock.close();
    const bad = new WebSocket(`ws://127.0.0.1:${addr.port}/api/v1/ws?token=nope`);
    const code = await new Promise((r) => bad.on('close', (c) => r(c)));
    expect(code).toBe(4401);
  });
});

describe('telemetry, digests and jobs', () => {
  it('accepts anonymous telemetry only in the allowed shape', async () => {
    expect((await t.req('POST', '/api/v1/telemetry', null, { events: [{ name: 'comment.created', props: { scope: 'area', ms: 900 } }] })).status).toBe(204);
    expect((await t.req('POST', '/api/v1/telemetry', null, { events: [{ name: 'x', props: { deep: { a: 1 } } }] })).status).toBe(400);
    expect((await t.req('POST', '/api/v1/telemetry', null, { events: [{ name: 'x', text: 'secret' }] })).status).toBe(400);
    expect((await t.req('POST', '/api/v1/errors', null, { message: 'boom at https://secret.example.com/x', context: 'content', version: '0.2.0' })).status).toBe(204);
    const { rows } = await t.ctx.db.query('SELECT message FROM error_reports');
    expect(rows[0].message).not.toContain('secret.example.com');
  });

  it('daily digest batches pending emails', async () => {
    const prefs = (await t.req('GET', '/api/v1/me', bo)).json.memberships.find((m: any) => m.workspace.id === ws).member.notificationPrefs;
    await t.req('PUT', `/api/v1/workspaces/${ws}/me/preferences`, bo, { ...prefs, emailMode: 'digest' });
    const before = t.ctx.mailer.outbox.length;
    const boId = (await t.req('GET', '/api/v1/me', bo)).json.user.id;
    await t.req('POST', `/api/v1/threads/${threadId}/comments`, ana, { body: `digest @[Bo](${boId})` });
    expect(t.ctx.mailer.outbox.slice(before).some((m) => m.to === 'bo@ex.com')).toBe(false);
    expect(await sendDigests(t.ctx)).toBe(1);
    expect(t.ctx.mailer.outbox.at(-1)!.subject).toMatch(/Pinpoint digest/);
    expect(await sendDigests(t.ctx)).toBe(0);
  });

  it('purges old deleted comments and applies snapshot retention', async () => {
    const c = (await t.req('POST', `/api/v1/threads/${threadId}/comments`, bo, { body: 'old' })).json;
    await t.req('DELETE', `/api/v1/comments/${c.id}`, bo);
    await t.ctx.db.query(`UPDATE comments SET deleted_at = now() - interval '31 days' WHERE id = $1`, [c.id]);
    expect((await t.req('POST', `/api/v1/comments/${c.id}/restore`, bo)).json.error.code).toBe('restore_expired');
    await t.req('PATCH', `/api/v1/workspaces/${ws}`, ana, { privacy: { snapshotRetentionDays: 7 } });
    await t.ctx.db.query(`UPDATE snapshots SET captured_at = now() - interval '8 days' WHERE workspace_id = $1`, [ws]);
    await runJobs(t.ctx, { digests: false });
    expect((await t.ctx.db.query('SELECT 1 FROM comments WHERE id = $1', [c.id])).rows).toHaveLength(0);
    expect((await t.ctx.db.query('SELECT 1 FROM snapshots WHERE workspace_id = $1', [ws])).rows).toHaveLength(0);
    expect((await t.ctx.db.query('SELECT 1 FROM deleted_files')).rows).toHaveLength(0);
  });
});

async function waitFor(fn: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}
