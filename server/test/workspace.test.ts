import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anchor, makeApp, type TestApp } from './helpers';

let t: TestApp;
let owner: string;
let ws: string;
beforeAll(async () => {
  t = await makeApp();
  owner = await t.login('owner@acme.com', 'Olivia');
  ws = (await t.req('POST', '/api/v1/workspaces', owner, { name: 'Acme' })).json.workspace.id;
});
afterAll(() => t.close());

describe('workspaces', () => {
  it('creator is owner and sees invite token', async () => {
    const me = await t.req('GET', '/api/v1/me', owner);
    expect(me.json.memberships[0].member.role).toBe('owner');
    expect(me.json.memberships[0].workspace.inviteToken).toMatch(/^lnk_/);
  });

  it('updates settings and normalizes allowed sites', async () => {
    const r = await t.req('PATCH', `/api/v1/workspaces/${ws}`, owner, {
      allowedSites: ['https://www.Staging.Acme.com/foo', '*.acme.dev'],
      emailDomain: '@acme.com',
      privacy: { allowDom: false },
    });
    expect(r.status).toBe(200);
    expect(r.json.allowedSites).toEqual(['staging.acme.com', '*.acme.dev']);
    expect(r.json.emailDomain).toBe('acme.com');
    expect(r.json.privacy).toMatchObject({ allowDom: false, allowFullPage: true });
  });

  it('email invites: domain restriction, email must match, auto-accept on login', async () => {
    const bad = await t.req('POST', `/api/v1/workspaces/${ws}/invites`, owner, { emails: ['x@other.com'] });
    expect(bad.json.error.code).toBe('domain_restricted');
    const inv = await t.req('POST', `/api/v1/workspaces/${ws}/invites`, owner, { emails: ['dev@acme.com'], role: 'member' });
    expect(inv.status).toBe(200);
    const mail = t.ctx.mailer.outbox.at(-1)!;
    expect(mail.to).toBe('dev@acme.com');
    const token = mail.text.match(/invite\/(inv_[\w-]+)/)![1];
    const preview = await t.req('GET', `/api/v1/invites/${token}`);
    expect(preview.json).toEqual({ workspaceName: 'Acme', role: 'member', kind: 'email' });
    const stranger = await t.login('someone@acme.com');
    expect((await t.req('POST', `/api/v1/invites/${token}/accept`, stranger)).status).toBe(403);
    // signing in with the invited address accepts it automatically
    const dev = await t.login('dev@acme.com', 'Dev');
    const me = await t.req('GET', '/api/v1/me', dev);
    expect(me.json.memberships.map((m: any) => m.workspace.id)).toContain(ws);
    expect(me.json.memberships[0].workspace.inviteToken).toBeUndefined();
  });

  it('invite link honours domain restriction', async () => {
    const link = (await t.req('POST', `/api/v1/workspaces/${ws}/invite-link`, owner)).json;
    const outsider = await t.login('out@gmail.com');
    expect((await t.req('POST', `/api/v1/invites/${link.token}/accept`, outsider)).status).toBe(403);
    const insider = await t.login('in@acme.com');
    const ok = await t.req('POST', `/api/v1/invites/${link.token}/accept`, insider);
    expect(ok.json.member.role).toBe('member');
  });

  it('roles: members cannot manage, last owner protected', async () => {
    const dev = await t.login('dev@acme.com');
    expect((await t.req('PATCH', `/api/v1/workspaces/${ws}`, dev, { allowedSites: ['x.com'] })).status).toBe(403);
    expect((await t.req('GET', `/api/v1/workspaces/${ws}/invites`, dev)).status).toBe(403);
    const members = (await t.req('GET', `/api/v1/workspaces/${ws}/members`, dev)).json;
    const own = members.find((m: any) => m.role === 'owner');
    expect((await t.req('PATCH', `/api/v1/workspaces/${ws}/members/${own.id}`, owner, { role: 'member' })).json.error.code).toBe('last_owner');
    const devM = members.find((m: any) => m.user.email === 'dev@acme.com');
    const promoted = await t.req('PATCH', `/api/v1/workspaces/${ws}/members/${devM.id}`, owner, { role: 'admin' });
    expect(promoted.json.role).toBe('admin');
    expect((await t.req('PATCH', `/api/v1/workspaces/${ws}/members/${own.id}`, dev, { role: 'member' })).status).toBe(403);
    // outsiders do not see the workspace
    const outsider = await t.login('nobody@else.com');
    expect((await t.req('GET', `/api/v1/workspaces/${ws}`, outsider)).status).toBe(404);
  });

  it('notification preferences', async () => {
    const dev = await t.login('dev@acme.com');
    const prefs = {
      events: {
        mention: { inApp: true, email: false, chat: false },
        reply: { inApp: false, email: false, chat: false },
        assignment: { inApp: true, email: true, chat: true },
        resolution: { inApp: true, email: false, chat: false },
      },
      emailMode: 'digest',
    };
    const r = await t.req('PUT', `/api/v1/workspaces/${ws}/me/preferences`, dev, prefs);
    expect(r.json.notificationPrefs).toEqual(prefs);
  });

  it('guests only see shared threads and can only resolve their own', async () => {
    const mk = (url: string) =>
      t.req('POST', `/api/v1/workspaces/${ws}/threads`, owner, { url, title: 'P', scope: 'area', urlMatch: 'path', anchor: anchor(), body: 'hi' });
    const a = (await mk('https://staging.acme.com/a')).json;
    const b = (await mk('https://staging.acme.com/b')).json;
    const grant = await t.req('POST', `/api/v1/workspaces/${ws}/guest-links`, owner, { threadIds: [a.id] });
    expect(grant.json.token).toMatch(/^gst_/);
    const guest = await t.login('client@agency.io', 'Client');
    const acc = await t.req('POST', `/api/v1/invites/${grant.json.token}/accept`, guest);
    expect(acc.json.member.role).toBe('guest');
    const list = await t.req('GET', `/api/v1/workspaces/${ws}/threads`, guest);
    expect(list.json.items.map((x: any) => x.id)).toEqual([a.id]);
    expect((await t.req('GET', `/api/v1/threads/${b.id}`, guest)).status).toBe(404);
    expect((await t.req('POST', `/api/v1/threads/${a.id}/comments`, guest, { body: 'looks good' })).status).toBe(200);
    expect((await t.req('PATCH', `/api/v1/threads/${a.id}`, guest, { status: 'resolved' })).status).toBe(403);
    expect((await t.req('GET', `/api/v1/workspaces/${ws}/export?format=json`, guest)).status).toBe(403);
    // guest cannot start threads on pages outside the grant
    const own = await t.req('POST', `/api/v1/workspaces/${ws}/threads`, guest, {
      url: 'https://staging.acme.com/a',
      title: 'P',
      scope: 'page',
      urlMatch: 'path',
      anchor: anchor(),
      body: 'x',
    });
    expect(own.status).toBe(403);
    // revoking the grant removes access
    await t.req('DELETE', `/api/v1/workspaces/${ws}/guest-links/${grant.json.id}`, owner);
    expect((await t.req('GET', `/api/v1/threads/${a.id}`, guest)).status).toBe(404);
  });
});

describe('invite resend', () => {
  it('re-sends the same link, skips existing members, admin only', async () => {
    await t.req('PATCH', `/api/v1/workspaces/${ws}`, owner, { emailDomain: null });
    const r = await t.req('POST', `/api/v1/workspaces/${ws}/invites`, owner, { emails: ['new.person@acme.com', 'owner@acme.com'] });
    expect(r.status).toBe(200);
    expect(r.json.map((i: any) => i.email)).toEqual(['new.person@acme.com']);
    const first = t.ctx.mailer.outbox.at(-1)!;
    const before = t.ctx.mailer.outbox.length;
    const again = await t.req('POST', `/api/v1/workspaces/${ws}/invites/${r.json[0].id}/resend`, owner);
    expect(again.status).toBe(200);
    expect(t.ctx.mailer.outbox.length).toBe(before + 1);
    const second = t.ctx.mailer.outbox.at(-1)!;
    expect(second.to).toBe('new.person@acme.com');
    expect(second.text.match(/invite\/(inv_[\w-]+)/)![1]).toBe(first.text.match(/invite\/(inv_[\w-]+)/)![1]);
    const member = await t.login('plain@acme.com');
    const link = (await t.req('GET', '/api/v1/me', owner)).json.memberships[0].workspace.inviteToken;
    if (link) await t.req('POST', `/api/v1/invites/${link}/accept`, member);
    expect((await t.req('POST', `/api/v1/workspaces/${ws}/invites/${r.json[0].id}/resend`, member)).status).toBe(403);
    await t.req('DELETE', `/api/v1/workspaces/${ws}/invites/${r.json[0].id}`, owner);
    expect((await t.req('POST', `/api/v1/workspaces/${ws}/invites/${r.json[0].id}/resend`, owner)).status).toBe(404);
  });
});
