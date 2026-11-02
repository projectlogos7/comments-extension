import type { AppCtx } from '../context';
import { sendDigests } from './notify';

/** Housekeeping: retention, purges and digests. Safe to run repeatedly. */
export async function runJobs(app: AppCtx, opts: { digests?: boolean } = {}) {
  const db = app.db;
  // Comments soft-deleted more than 30 days ago are removed for good.
  await db.query(
    `INSERT INTO deleted_files (storage_key)
     SELECT a.storage_key FROM attachments a JOIN comments c ON c.id = a.comment_id
     WHERE c.deleted_at < now() - interval '30 days' ON CONFLICT DO NOTHING`,
  );
  await db.query(`DELETE FROM comments WHERE deleted_at < now() - interval '30 days'`);
  // Deleted threads: files removed within 30 days (immediately queued), rows after 30 days.
  await db.query(
    `INSERT INTO deleted_files (storage_key)
     SELECT s.storage_key FROM snapshots s JOIN threads t ON t.id = s.thread_id WHERE t.deleted_at IS NOT NULL
     UNION SELECT a.storage_key FROM attachments a JOIN comments c ON c.id = a.comment_id JOIN threads t ON t.id = c.thread_id WHERE t.deleted_at IS NOT NULL
     ON CONFLICT DO NOTHING`,
  );
  await db.query(`DELETE FROM snapshots s USING threads t WHERE t.id = s.thread_id AND t.deleted_at IS NOT NULL`);
  await db.query(`DELETE FROM threads WHERE deleted_at < now() - interval '30 days'`);
  // Snapshot retention per workspace (privacy controls).
  const { rows: ws } = await db.query(`SELECT id, (privacy->>'snapshotRetentionDays')::int AS days FROM workspaces WHERE privacy ? 'snapshotRetentionDays' AND privacy->>'snapshotRetentionDays' IS NOT NULL`);
  for (const w of ws) {
    if (!w.days) continue;
    const { rows } = await db.query(
      `DELETE FROM snapshots WHERE workspace_id = $1 AND captured_at < now() - make_interval(days => $2) RETURNING storage_key`,
      [w.id, w.days],
    );
    for (const r of rows) await db.query('INSERT INTO deleted_files (storage_key) VALUES ($1) ON CONFLICT DO NOTHING', [r.storage_key]);
  }
  // Orphan attachments never linked to a comment.
  await db.query(
    `WITH gone AS (DELETE FROM attachments WHERE comment_id IS NULL AND created_at < now() - interval '1 day' RETURNING storage_key)
     INSERT INTO deleted_files (storage_key) SELECT storage_key FROM gone ON CONFLICT DO NOTHING`,
  );
  // Remove queued files.
  const { rows: files } = await db.query('SELECT storage_key FROM deleted_files LIMIT 500');
  for (const f of files) {
    try {
      await app.storage.delete(f.storage_key);
      await db.query('DELETE FROM deleted_files WHERE storage_key = $1', [f.storage_key]);
    } catch (e) {
      app.log.warn({ err: String(e), key: f.storage_key }, 'file delete failed');
    }
  }
  // Expired credentials.
  await db.query(`DELETE FROM refresh_tokens WHERE expires_at < now() OR revoked_at < now() - interval '7 days'`);
  await db.query(`DELETE FROM email_login_tokens WHERE expires_at < now() - interval '1 day'`);
  await db.query(`DELETE FROM telemetry_events WHERE created_at < now() - interval '180 days'`);
  if (opts.digests !== false) await sendDigests(app);
}

export function startJobs(app: AppCtx): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runJobs(app);
    } catch (e) {
      app.log.error({ err: String(e) }, 'jobs failed');
    } finally {
      running = false;
    }
  };
  const first = setTimeout(tick, 10_000);
  const t = setInterval(tick, 60 * 60 * 1000);
  first.unref?.();
  t.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(t);
  };
}
