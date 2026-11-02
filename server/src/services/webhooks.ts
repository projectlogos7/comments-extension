import type { WebhookEvent } from '@pinpoint/shared';
import type { AppCtx } from '../context';
import { hmacHex } from '../crypto';

const BACKOFF_MS = [0, 2000, 10000, 60000];

export function signPayload(secret: string, timestamp: string, body: string): string {
  return 'sha256=' + hmacHex(secret, `${timestamp}.${body}`);
}

/** Deliver an event to every active webhook of the workspace subscribed to it (FR-6.7). */
export async function deliverWebhooks(app: AppCtx, workspaceId: string, event: WebhookEvent, data: Record<string, unknown>) {
  const { rows } = await app.db.query('SELECT * FROM webhooks WHERE workspace_id = $1 AND active = true', [workspaceId]);
  const targets = rows.filter((w) => (w.events as string[]).includes(event));
  if (!targets.length) return;
  const body = JSON.stringify({ event, workspaceId, at: new Date().toISOString(), data });
  for (const w of targets) void sendWithRetry(app, w, body, 0);
}

async function sendWithRetry(app: AppCtx, w: { id: string; url: string; secret: string }, body: string, attempt: number): Promise<void> {
  const ts = String(Math.floor(Date.now() / 1000));
  try {
    const res = await app.fetch(w.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Pinpoint-Webhooks/1',
        'x-pinpoint-timestamp': ts,
        'x-pinpoint-signature': signPayload(w.secret, ts, body),
      },
      body,
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) return;
    throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    const next = attempt + 1;
    if (next >= BACKOFF_MS.length) {
      app.log.warn({ webhook: w.id, err: String(e) }, 'webhook delivery failed');
      return;
    }
    const t = setTimeout(() => void sendWithRetry(app, w, body, next), BACKOFF_MS[next]);
    t.unref?.();
  }
}
