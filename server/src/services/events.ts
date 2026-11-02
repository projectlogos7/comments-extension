import type { RealtimeEvent, WebhookEvent } from '@pinpoint/shared';
import type { AppCtx } from '../context';
import { loadComments, loadThreadDetail } from '../model';
import { deliverWebhooks } from './webhooks';

type Kind = Extract<RealtimeEvent['kind'], WebhookEvent>;

/** Publish a thread/comment change to WebSocket subscribers and outgoing webhooks. */
export async function emitChange(app: AppCtx, kind: Kind, e: { workspaceId: string; threadId: string; pageId?: string; commentId?: string }) {
  app.bus.publish({ kind, workspaceId: e.workspaceId, threadId: e.threadId, pageId: e.pageId });
  try {
    const { rows } = await app.db.query('SELECT 1 FROM webhooks WHERE workspace_id = $1 AND active = true LIMIT 1', [e.workspaceId]);
    if (!rows.length) return;
    const data: Record<string, unknown> = { threadId: e.threadId };
    if (kind !== 'thread.deleted') data.thread = await loadThreadDetail(app, e.threadId, null).catch(() => null);
    if (e.commentId) data.comment = (await loadComments(app, { commentIds: [e.commentId] }))[0] ?? null;
    await deliverWebhooks(app, e.workspaceId, kind, data);
  } catch (err) {
    app.log.warn({ err: String(err) }, 'webhook dispatch failed');
  }
}
