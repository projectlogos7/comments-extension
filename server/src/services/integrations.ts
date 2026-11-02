import { bestSelector, componentLabel, plainText, threadTitle, type IntegrationConfig, type IntegrationKind, type ThreadDetail } from '@pinpoint/shared';
import type { AppCtx } from '../context';
import { AppError, badRequest } from '../errors';
import { livePageUrl, shareUrl, threadWebUrl } from '../model';

export const INTEGRATION_KINDS: IntegrationKind[] = ['slack', 'teams', 'linear', 'jira', 'github'];

const SECRET_FIELDS: Record<IntegrationKind, string[]> = {
  slack: ['webhookUrl'],
  teams: ['webhookUrl'],
  linear: ['apiKey'],
  jira: ['apiToken'],
  github: ['token'],
};

const REQUIRED: Record<IntegrationKind, string[]> = {
  slack: ['webhookUrl'],
  teams: ['webhookUrl'],
  linear: ['apiKey', 'teamId'],
  jira: ['baseUrl', 'email', 'apiToken', 'projectKey'],
  github: ['token', 'owner', 'repo'],
};

export const MASK = '••••';

export function maskSettings(kind: IntegrationKind, settings: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(settings)) out[k] = SECRET_FIELDS[kind].includes(k) && v ? MASK + v.slice(-4) : v;
  return out;
}

export function toIntegration(kind: IntegrationKind, row: any | undefined): IntegrationConfig {
  return { kind, enabled: !!row?.enabled, settings: maskSettings(kind, row?.settings ?? {}) };
}

/** Merge new settings into existing ones; masked values keep the stored secret. */
export function mergeSettings(kind: IntegrationKind, prev: Record<string, string>, next: Record<string, string>, enabled: boolean) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(next)) {
    if (typeof v !== 'string') continue;
    out[k] = v.startsWith(MASK) ? prev[k] ?? '' : v.trim();
  }
  if (enabled) for (const f of REQUIRED[kind]) if (!out[f]) throw badRequest(`${kind}: "${f}" is required`, 'validation_error');
  for (const f of ['webhookUrl', 'baseUrl']) {
    if (out[f]) {
      let u: URL;
      try {
        u = new URL(out[f]);
      } catch {
        throw badRequest(`${kind}: "${f}" must be a URL`, 'validation_error');
      }
      if (u.protocol !== 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) throw badRequest(`${kind}: "${f}" must use https`, 'validation_error');
    }
  }
  return out;
}

export async function getIntegration(app: AppCtx, workspaceId: string, kind: IntegrationKind) {
  const { rows } = await app.db.query('SELECT * FROM integrations WHERE workspace_id = $1 AND kind = $2', [workspaceId, kind]);
  return rows[0] as { enabled: boolean; settings: Record<string, string> } | undefined;
}

async function checkOk(res: Response, what: string) {
  if (res.ok) return;
  const text = await res.text().catch(() => '');
  throw new AppError(502, 'integration_failed', `${what} failed (${res.status}): ${text.slice(0, 200)}`);
}

export async function postChatMessage(app: AppCtx, workspaceId: string, kind: 'slack' | 'teams', text: string, opts: { required?: boolean } = {}) {
  const integ = await getIntegration(app, workspaceId, kind);
  if (!integ?.enabled || !integ.settings.webhookUrl) {
    if (opts.required) throw badRequest(`${kind} integration is not enabled`, 'integration_disabled');
    return;
  }
  const body = kind === 'slack' ? { text } : { text: text.replace(/\n/g, '\n\n') };
  const res = await app.fetch(integ.settings.webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await checkOk(res, kind);
}

function ticketBody(app: AppCtx, t: ThreadDetail): { title: string; markdown: string; links: { share: string; live: string; snapshot: string | null } } {
  const share = t.shareToken ? shareUrl(app, t.shareToken) : threadWebUrl(app, t.id);
  const live = livePageUrl(t.page.normalizedUrl, t.id);
  const snap = t.snapshots.find((s) => s.kind === 'area') ?? t.snapshots[0];
  const lines = [
    `**Page:** ${t.page.normalizedUrl}`,
    `**Scope:** ${t.scope}${t.type ? ` · **Type:** ${t.type}` : ''}${t.priority ? ` · **Priority:** ${t.priority}` : ''}`,
  ];
  const sel = bestSelector(t.anchor);
  if (sel) lines.push(`**Selector:** \`${sel}\``);
  const comp = componentLabel(t.anchor);
  if (comp) lines.push(`**Component:** \`${comp}\``);
  lines.push('');
  for (const c of t.comments.filter((c) => !c.deletedAt)) lines.push(`> **${c.author.name}:** ${plainText(c.body).replace(/\n/g, '\n> ')}`, '');
  lines.push(`[Open thread in Pinpoint](${share}) · [Open on live page](${live})`);
  if (snap) lines.push('', `![Snapshot](${snap.url})`);
  return { title: `[Pinpoint #${t.number}] ${threadTitle(t)}`, markdown: lines.join('\n'), links: { share, live, snapshot: snap?.url ?? null } };
}

export async function createTicket(app: AppCtx, kind: 'linear' | 'jira' | 'github', t: ThreadDetail): Promise<{ url: string; externalId: string }> {
  const integ = await getIntegration(app, t.workspaceId, kind);
  if (!integ?.enabled) throw badRequest(`${kind} integration is not enabled`, 'integration_disabled');
  const s = integ.settings;
  const { title, markdown } = ticketBody(app, t);
  if (kind === 'github') {
    const res = await app.fetch(`https://api.github.com/repos/${encodeURIComponent(s.owner)}/${encodeURIComponent(s.repo)}/issues`, {
      method: 'POST',
      headers: { authorization: `Bearer ${s.token}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'Pinpoint' },
      body: JSON.stringify({ title, body: markdown, labels: s.labels ? s.labels.split(',').map((x) => x.trim()) : undefined }),
    });
    await checkOk(res, 'GitHub');
    const j: any = await res.json();
    return { url: j.html_url, externalId: String(j.number) };
  }
  if (kind === 'linear') {
    const priorityMap: Record<string, number> = { high: 2, medium: 3, low: 4 };
    const res = await app.fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { authorization: s.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        query: 'mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url } } }',
        variables: { input: { teamId: s.teamId, title, description: markdown, priority: t.priority ? priorityMap[t.priority] : undefined } },
      }),
    });
    await checkOk(res, 'Linear');
    const j: any = await res.json();
    const issue = j?.data?.issueCreate?.issue;
    if (!issue) throw new AppError(502, 'integration_failed', `Linear: ${JSON.stringify(j?.errors ?? j).slice(0, 200)}`);
    return { url: issue.url, externalId: issue.identifier };
  }
  // Jira Cloud REST v3 with Atlassian Document Format.
  const para = (text: string) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
  const adf = { type: 'doc', version: 1, content: markdown.split('\n').map((l) => para(l.replace(/\*\*/g, ''))) };
  const base = s.baseUrl.replace(/\/$/, '');
  const res = await app.fetch(`${base}/rest/api/3/issue`, {
    method: 'POST',
    headers: {
      authorization: 'Basic ' + Buffer.from(`${s.email}:${s.apiToken}`).toString('base64'),
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ fields: { project: { key: s.projectKey }, summary: title.slice(0, 250), description: adf, issuetype: { name: s.issueType || 'Task' } } }),
  });
  await checkOk(res, 'Jira');
  const j: any = await res.json();
  return { url: `${base}/browse/${j.key}`, externalId: j.key };
}

export function chatSummary(app: AppCtx, t: ThreadDetail): string {
  const { title, links } = ticketBody(app, t);
  const first = t.comments.find((c) => !c.deletedAt);
  return `${title}\n${first ? `> ${plainText(first.body).slice(0, 300)}\n` : ''}${links.share}${links.snapshot ? `\nSnapshot: ${links.snapshot}` : ''}`;
}
