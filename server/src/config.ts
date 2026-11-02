import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
/** server/ directory (works from src/ under tsx and from dist/ when bundled). */
export const SERVER_ROOT = path.resolve(here, '..');

export interface Config {
  port: number;
  host: string;
  publicUrl: string;
  databaseUrl: string | null;
  /** Directory for PGlite data and local file storage. ":memory:" = in-memory DB + temp files. */
  dataDir: string;
  jwtSecret: string;
  smtpUrl: string | null;
  mailFrom: string;
  google: { clientId: string; clientSecret: string } | null;
  microsoft: { clientId: string; clientSecret: string; tenant: string } | null;
  storage: 'local' | 's3';
  s3: { bucket: string; region: string; endpoint?: string; accessKeyId?: string; secretAccessKey?: string } | null;
  devLogin: boolean;
  extensionIds: string[];
  /** Run background jobs (retention, digests). Off in tests. */
  jobs: boolean;
  logger: boolean;
  /** Directory of the built web app (served at /app/). */
  webDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Config> = {}): Config {
  const publicUrl = (env.PUBLIC_URL || `http://localhost:${env.PORT || 8787}`).replace(/\/$/, '');
  const cfg: Config = {
    port: Number(env.PORT || 8787),
    host: env.HOST || '0.0.0.0',
    publicUrl,
    databaseUrl: env.DATABASE_URL || null,
    dataDir: env.DATA_DIR || path.join(SERVER_ROOT, 'data'),
    jwtSecret: env.JWT_SECRET || '',
    smtpUrl: env.SMTP_URL || null,
    mailFrom: env.MAIL_FROM || 'Pinpoint <no-reply@pinpoint.local>',
    google: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } : null,
    microsoft:
      env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET
        ? { clientId: env.MICROSOFT_CLIENT_ID, clientSecret: env.MICROSOFT_CLIENT_SECRET, tenant: env.MICROSOFT_TENANT || 'common' }
        : null,
    storage: env.STORAGE === 's3' ? 's3' : 'local',
    s3: env.S3_BUCKET
      ? {
          bucket: env.S3_BUCKET,
          region: env.S3_REGION || 'us-east-1',
          endpoint: env.S3_ENDPOINT || undefined,
          accessKeyId: env.S3_ACCESS_KEY_ID || undefined,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY || undefined,
        }
      : null,
    devLogin: env.DEV_LOGIN === '1' || env.DEV_LOGIN === 'true',
    extensionIds: (env.EXTENSION_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
    jobs: env.JOBS !== '0',
    logger: env.LOG !== '0',
    webDir: env.WEB_DIR || path.join(SERVER_ROOT, 'public', 'app'),
    ...overrides,
  };
  if (!cfg.jwtSecret) {
    if (env.NODE_ENV === 'production') throw new Error('JWT_SECRET is required in production');
    cfg.jwtSecret = 'dev-insecure-secret-' + crypto.createHash('sha256').update(cfg.publicUrl).digest('hex').slice(0, 16);
  }
  return cfg;
}
