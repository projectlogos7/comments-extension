import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import type { RealtimeEvent } from '@pinpoint/shared';
import type { Db } from './db';

const CHANNEL = 'pinpoint_events';

/** In-process event bus with optional Postgres LISTEN/NOTIFY fan-out across instances. */
export class Bus {
  private ee = new EventEmitter();
  private instance = crypto.randomUUID();
  constructor(private db: Db) {
    this.ee.setMaxListeners(0);
  }
  async start() {
    if (this.db.kind !== 'pg') return;
    await this.db.listen(CHANNEL, (payload) => {
      try {
        const { origin, event } = JSON.parse(payload);
        if (origin !== this.instance) this.ee.emit('event', event);
      } catch {
        /* ignore */
      }
    });
  }
  publish(event: Omit<RealtimeEvent, 'at'> & { at?: string }) {
    const full = { ...event, at: event.at ?? new Date().toISOString() } as RealtimeEvent;
    this.ee.emit('event', full);
    if (this.db.kind === 'pg') this.db.notify(CHANNEL, JSON.stringify({ origin: this.instance, event: full })).catch(() => {});
  }
  on(cb: (e: RealtimeEvent) => void): () => void {
    this.ee.on('event', cb);
    return () => this.ee.off('event', cb);
  }
}
