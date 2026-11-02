import { loadConfig } from './config';
import { openDb } from './db';

const cfg = loadConfig();
const db = await openDb({ databaseUrl: cfg.databaseUrl, dataDir: cfg.dataDir });
console.log(`Migrations applied (${db.kind}).`);
await db.close();
