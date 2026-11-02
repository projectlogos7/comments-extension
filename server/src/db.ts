import pg from 'pg';
import path from 'node:path';
import fs from 'node:fs';
import { MIGRATIONS } from './migrations';

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

export interface Db {
  kind: 'pg' | 'pglite';
  query<T = any>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  /** Run statements without parameters (migrations). */
  exec(sql: string): Promise<void>;
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  /** Subscribe to a NOTIFY channel (pg only; PGlite is single-process so this is a no-op). */
  listen(channel: string, cb: (payload: string) => void): Promise<void>;
  notify(channel: string, payload: string): Promise<void>;
  close(): Promise<void>;
}

class PgDb implements Db {
  kind = 'pg' as const;
  private listener: pg.Client | null = null;
  constructor(
    private pool: pg.Pool,
    private client: pg.PoolClient | null = null,
    private url = '',
  ) {}
  async query<T>(sql: string, params: unknown[] = []) {
    const r = await (this.client ?? this.pool).query(sql, params as any[]);
    return { rows: r.rows as T[], rowCount: r.rowCount ?? 0 };
  }
  async exec(sql: string) {
    await (this.client ?? this.pool).query(sql);
  }
  async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    if (this.client) return fn(this);
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(new PgDb(this.pool, c));
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }
  async listen(channel: string, cb: (payload: string) => void) {
    if (!this.listener) {
      this.listener = new pg.Client({ connectionString: this.url });
      await this.listener.connect();
    }
    this.listener.on('notification', (m) => {
      if (m.channel === channel && m.payload) cb(m.payload);
    });
    await this.listener.query(`LISTEN ${channel}`);
  }
  async notify(channel: string, payload: string) {
    await this.pool.query('SELECT pg_notify($1, $2)', [channel, payload]);
  }
  async close() {
    await this.listener?.end().catch(() => {});
    await this.pool.end();
  }
}

type PGliteLike = {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[]; affectedRows?: number }>;
  exec(sql: string): Promise<unknown>;
  transaction<T>(fn: (tx: any) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};

class PGliteDb implements Db {
  kind = 'pglite' as const;
  constructor(
    private db: PGliteLike,
    private inTx = false,
  ) {}
  async query<T>(sql: string, params: unknown[] = []) {
    const r = await this.db.query<T>(sql, params.map((p) => (p === undefined ? null : p)));
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  }
  async exec(sql: string) {
    await this.db.exec(sql);
  }
  async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    if (this.inTx) return fn(this);
    return this.db.transaction((tx) => fn(new PGliteDb(tx, true)));
  }
  async listen() {}
  async notify() {}
  async close() {
    if (!this.inTx) await this.db.close();
  }
}

export async function openDb(opts: { databaseUrl: string | null; dataDir: string }): Promise<Db> {
  let db: Db;
  if (opts.databaseUrl) {
    const pool = new pg.Pool({ connectionString: opts.databaseUrl, max: Number(process.env.PG_POOL_SIZE || 10) });
    db = new PgDb(pool, null, opts.databaseUrl);
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    let instance: PGliteLike;
    if (opts.dataDir === ':memory:') instance = new PGlite() as unknown as PGliteLike;
    else {
      const dir = path.join(opts.dataDir, 'pglite');
      fs.mkdirSync(dir, { recursive: true });
      instance = new PGlite(dir) as unknown as PGliteLike;
    }
    db = new PGliteDb(instance);
  }
  await migrate(db);
  return db;
}

export async function migrate(db: Db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version int PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const { rows } = await db.query<{ version: number }>('SELECT version FROM schema_migrations');
  const done = new Set(rows.map((r) => r.version));
  for (const m of MIGRATIONS) {
    if (done.has(m.version)) continue;
    await db.tx(async (t) => {
      await t.exec(m.sql);
      await t.query('INSERT INTO schema_migrations (version) VALUES ($1)', [m.version]);
    });
  }
}
