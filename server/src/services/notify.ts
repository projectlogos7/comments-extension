import { escapeHtml, excerpt, type NotificationEvent, type Notification } from '@pinpoint/shared';
import type { AppCtx } from '../context';
import { guestScope } from '../context';
import { emailLayout } from '../mail';
import { iso, livePageUrl, mergePrefs, threadWebUrl, toUser, usersById } from '../model';
import { postChatMessage } from './integrations';

export interface NotifyInput {
  event: NotificationEvent;
  workspaceId: string;
  threadId: string;
  commentId?: string | null;
  actorId: string;
  recipientIds: string[];
  /** Text used as the excerpt (comment body). */
  body?: string;
}

function titleFor(event: NotificationEvent, actor: string, pageTitle: string, n: number) {
  const where = pageTitle ? ` on “${pageTitle}”` : '';
  switch (event) {
    case 'mention':
      return `${actor} mentioned you${where}`;
    case 'reply':
      return `${actor} replied to thread #${n}${where}`;
    case 'assignment':
      return `${actor} assigned you thread #${n}${where}`;
    case 'resolution':
      return `${actor} resolved thread #${n}${where}`;
  }
}

export async function notify(app: AppCtx, input: NotifyInput): Promise<void> {
  const recipients = [...new Set(input.recipientIds)].filter((id) => id && id !== input.actorId);
  if (!recipients.length) return;
  const { rows: trows } = await app.db.query(
    'SELECT t.id, t.number, t.page_id, t.created_by, p.title, p.normalized_url FROM threads t JOIN pages p ON p.id = t.page_id WHERE t.id = $1',
    [input.threadId],
  );
  const t = trows[0];
  if (!t) return;
  const { rows: mrows } = await app.db.query(
    'SELECT m.user_id, m.role, m.notification_prefs, u.email, u.name, u.deleted_at FROM members m JOIN users u ON u.id = m.user_id WHERE m.workspace_id = $1 AND m.user_id = ANY($2::uuid[])',
    [input.workspaceId, recipients],
  );
  const actor = (await usersById(app, [input.actorId])).get(input.actorId);
  const actorName = actor?.name ?? 'Someone';
  const title = titleFor(input.event, actorName, t.title, t.number);
  const ex = input.body ? excerpt(input.body, 200) : '';
  const chatRecipients: string[] = [];

  for (const m of mrows) {
    if (m.deleted_at) continue;
    if (m.role === 'guest' && t.created_by !== m.user_id) {
      const g = await guestScope(app, input.workspaceId, m.user_id);
      if (!g.threadIds.includes(t.id) && !g.pageIds.includes(t.page_id)) continue;
    }
    const prefs = mergePrefs(m.notification_prefs).events[input.event];
    const prefsAll = mergePrefs(m.notification_prefs);
    if (prefs.chat && (input.event === 'mention' || input.event === 'assignment')) chatRecipients.push(m.name || m.email);
    if (!prefs.inApp && !prefs.email) continue;
    const emailStatus = prefs.email ? (prefsAll.emailMode === 'digest' ? 'pending' : 'sending') : null;
    const { rows } = await app.db.query(
      `INSERT INTO notifications (user_id, workspace_id, event, thread_id, comment_id, actor_id, title, excerpt, page_url, in_app, email_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [m.user_id, input.workspaceId, input.event, input.threadId, input.commentId ?? null, input.actorId, title, ex, t.normalized_url, prefs.inApp, emailStatus],
    );
    if (prefs.inApp) app.bus.publish({ kind: 'notification.created', workspaceId: input.workspaceId, threadId: input.threadId, userId: m.user_id });
    if (emailStatus === 'sending') {
      const live = livePageUrl(t.normalized_url, t.id);
      const html = emailLayout(
        escapeHtml(title),
        `${ex ? `<blockquote style="border-left:3px solid #c7d2fe;margin:0;padding:4px 12px;color:#374151">${escapeHtml(ex)}</blockquote>` : ''}
         <p style="color:#6b7280;font-size:13px">${escapeHtml(t.normalized_url)}</p>
         <p style="font-size:13px"><a href="${threadWebUrl(app, t.id)}">Open in the web app</a></p>`,
        { label: 'Open on page', url: live },
      );
      app.mailer
        .send({ to: m.email, subject: title, text: `${title}\n\n${ex}\n\nOpen on page: ${live}\nWeb app: ${threadWebUrl(app, t.id)}`, html })
        .then(() => app.db.query(`UPDATE notifications SET email_status = 'sent' WHERE id = $1`, [rows[0].id]))
        .catch((e) => app.log.warn({ err: String(e) }, 'notification email failed'));
    }
  }

  if (chatRecipients.length) {
    const text = `${title}${ex ? `\n> ${ex}` : ''}\nFor: ${chatRecipients.join(', ')}\n${livePageUrl(t.normalized_url, t.id)}`;
    for (const kind of ['slack', 'teams'] as const) {
      postChatMessage(app, input.workspaceId, kind, text).catch((e) => app.log.warn({ err: String(e) }, `${kind} notification failed`));
    }
  }
}

export function toNotification(r: any, actor: ReturnType<typeof toUser> | undefined): Notification {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    event: r.event,
    threadId: r.thread_id,
    commentId: r.comment_id ?? null,
    actor: actor ?? { id: r.actor_id ?? '', email: '', name: 'Someone', avatarUrl: null },
    title: r.title,
    excerpt: r.excerpt,
    pageUrl: r.page_url,
    read: !!r.read_at,
    createdAt: iso(r.created_at),
  };
}

/** Send one digest email per user with pending notifications, at most once per 24h (FR-7.5). */
export async function sendDigests(app: AppCtx, force = false): Promise<number> {
  const { rows: users } = await app.db.query(
    `SELECT DISTINCT u.id, u.email, u.name, u.last_digest_at FROM notifications n JOIN users u ON u.id = n.user_id
     WHERE n.email_status = 'pending' AND u.deleted_at IS NULL`,
  );
  let sent = 0;
  for (const u of users) {
    if (!force && u.last_digest_at && Date.now() - new Date(u.last_digest_at).getTime() < 24 * 3600 * 1000) continue;
    const { rows } = await app.db.query(
      `UPDATE notifications SET email_status = 'sent' WHERE user_id = $1 AND email_status = 'pending' RETURNING *`,
      [u.id],
    );
    if (!rows.length) continue;
    rows.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const itemsHtml = rows
      .map(
        (n) =>
          `<li style="margin-bottom:12px"><a href="${livePageUrl(n.page_url, n.thread_id)}">${escapeHtml(n.title)}</a>${
            n.excerpt ? `<div style="color:#4b5563;font-size:13px">${escapeHtml(n.excerpt)}</div>` : ''
          }</li>`,
      )
      .join('');
    const subject = `Pinpoint digest: ${rows.length} update${rows.length === 1 ? '' : 's'}`;
    await app.mailer.send({
      to: u.email,
      subject,
      text: rows.map((n) => `- ${n.title}${n.excerpt ? `: ${n.excerpt}` : ''}\n  ${livePageUrl(n.page_url, n.thread_id)}`).join('\n'),
      html: emailLayout(escapeHtml(subject), `<ul style="padding-left:18px">${itemsHtml}</ul>`, { label: 'Open Pinpoint', url: `${app.cfg.publicUrl}/app/` }),
    });
    await app.db.query('UPDATE users SET last_digest_at = now() WHERE id = $1', [u.id]);
    sent++;
  }
  return sent;
}
