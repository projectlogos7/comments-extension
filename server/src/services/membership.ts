import { defaultNotificationPrefs, type Role } from '@pinpoint/shared';
import type { AppCtx } from '../context';
import { forbidden } from '../errors';

export function domainOf(email: string): string {
  return email.split('@')[1]?.toLowerCase() ?? '';
}

/** Add a user to a workspace (no-op if already a member; guests may be upgraded). */
export async function joinWorkspace(
  app: AppCtx,
  input: { workspaceId: string; userId: string; role: Role; email: string; enforceDomain: boolean },
): Promise<string> {
  const { rows: ws } = await app.db.query('SELECT email_domain FROM workspaces WHERE id = $1', [input.workspaceId]);
  if (!ws[0]) throw forbidden('Workspace no longer exists');
  const restricted = ws[0].email_domain as string | null;
  if (input.enforceDomain && restricted && domainOf(input.email) !== restricted.toLowerCase().replace(/^@/, '')) {
    throw forbidden(`Only @${restricted} accounts can join this workspace`);
  }
  const { rows: existing } = await app.db.query('SELECT id, role FROM members WHERE workspace_id = $1 AND user_id = $2', [input.workspaceId, input.userId]);
  if (existing[0]) {
    if (existing[0].role === 'guest' && input.role !== 'guest') {
      await app.db.query('UPDATE members SET role = $1 WHERE id = $2', [input.role, existing[0].id]);
    }
    return existing[0].id;
  }
  const { rows } = await app.db.query(
    'INSERT INTO members (workspace_id, user_id, role, notification_prefs) VALUES ($1,$2,$3,$4) RETURNING id',
    [input.workspaceId, input.userId, input.role, JSON.stringify(defaultNotificationPrefs())],
  );
  return rows[0].id;
}
