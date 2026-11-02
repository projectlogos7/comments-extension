import type { ActivityAction, ActivityEntry } from '@pinpoint/shared';
import type { AppCtx } from '../context';
import { iso, usersById } from '../model';

export async function logActivity(
  app: AppCtx,
  a: { workspaceId: string; threadId?: string | null; actorId: string | null; action: ActivityAction; detail?: Record<string, unknown> },
) {
  await app.db.query('INSERT INTO activity (workspace_id, thread_id, actor_id, action, detail) VALUES ($1,$2,$3,$4,$5)', [
    a.workspaceId,
    a.threadId ?? null,
    a.actorId,
    a.action,
    JSON.stringify(a.detail ?? {}),
  ]);
}

export async function listActivity(app: AppCtx, workspaceId: string, threadId?: string, limit = 200): Promise<ActivityEntry[]> {
  const params: unknown[] = [workspaceId];
  let sql = 'SELECT * FROM activity WHERE workspace_id = $1';
  if (threadId) {
    params.push(threadId);
    sql += ` AND thread_id = $2`;
  }
  sql += ` ORDER BY created_at DESC LIMIT ${Math.min(Math.max(limit, 1), 500)}`;
  const { rows } = await app.db.query(sql, params);
  const users = await usersById(app, rows.map((r) => r.actor_id));
  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspace_id,
    threadId: r.thread_id,
    actor: r.actor_id ? users.get(r.actor_id) ?? null : null,
    action: r.action,
    detail: r.detail ?? {},
    createdAt: iso(r.created_at),
  }));
}
