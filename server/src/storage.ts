import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Config } from './config';
import { hmac, safeEqual } from './crypto';

export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  html: 'text/html; charset=utf-8',
  json: 'application/json',
};

export function mimeFromKey(key: string): string {
  return MIME[key.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

export function extFromMime(ct: string): string {
  if (ct.includes('png')) return 'png';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  if (ct.includes('gif')) return 'gif';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('html')) return 'html';
  return 'bin';
}

class LocalStorage implements Storage {
  constructor(private root: string) {
    fs.mkdirSync(root, { recursive: true });
  }
  private p(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error('bad key');
    return full;
  }
  async put(key: string, body: Buffer) {
    const f = this.p(key);
    await fs.promises.mkdir(path.dirname(f), { recursive: true });
    await fs.promises.writeFile(f, body);
  }
  async get(key: string) {
    try {
      return { body: await fs.promises.readFile(this.p(key)), contentType: mimeFromKey(key) };
    } catch {
      return null;
    }
  }
  async delete(key: string) {
    await fs.promises.rm(this.p(key), { force: true });
  }
}

class S3Storage implements Storage {
  private clientP: Promise<any>;
  constructor(private cfg: NonNullable<Config['s3']>) {
    this.clientP = import('@aws-sdk/client-s3').then(
      (m) =>
        new m.S3Client({
          region: cfg.region,
          endpoint: cfg.endpoint,
          forcePathStyle: !!cfg.endpoint,
          credentials: cfg.accessKeyId && cfg.secretAccessKey ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } : undefined,
        }),
    );
  }
  async put(key: string, body: Buffer, contentType: string) {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    await (await this.clientP).send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: 'AES256' }));
  }
  async get(key: string) {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    try {
      const r = await (await this.clientP).send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      const bytes = await r.Body.transformToByteArray();
      return { body: Buffer.from(bytes), contentType: r.ContentType ?? mimeFromKey(key) };
    } catch {
      return null;
    }
  }
  async delete(key: string) {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    await (await this.clientP).send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }
}

export function createStorage(cfg: Config): Storage {
  if (cfg.storage === 's3') {
    if (!cfg.s3) throw new Error('STORAGE=s3 requires S3_BUCKET');
    return new S3Storage(cfg.s3);
  }
  const root = cfg.dataDir === ':memory:' ? fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-files-')) : path.join(cfg.dataDir, 'files');
  return new LocalStorage(root);
}

/** Signed, time-limited URL for a stored file. */
export function signFileUrl(cfg: Config, key: string, ttlSeconds = 3600): string {
  // Round expiry up to the TTL bucket so URLs are stable (cache friendly) within a window.
  const now = Math.floor(Date.now() / 1000);
  const bucket = Math.min(ttlSeconds, 3600);
  const exp = Math.ceil((now + ttlSeconds) / bucket) * bucket;
  const sig = hmac(cfg.jwtSecret, `file:${key}:${exp}`);
  return `${cfg.publicUrl}/files/${key}?exp=${exp}&sig=${sig}`;
}

export function verifyFileSig(cfg: Config, key: string, exp: string, sig: string): boolean {
  const e = Number(exp);
  if (!Number.isFinite(e) || e < Date.now() / 1000) return false;
  return safeEqual(hmac(cfg.jwtSecret, `file:${key}:${e}`), sig || '');
}
