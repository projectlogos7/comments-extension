// Offline write queue (PRD §13 "Offline"): new threads, replies and snapshot uploads are stored in
// chrome.storage.local and synced in order when the connection returns. Each item carries a
// client id so a retried create is idempotent on the server.
import { ApiError, STORAGE_KEYS, type Comment, type CreateThreadInput, type SnapshotContext, type SnapshotKind, type ThreadDetail } from '@pinpoint/shared';
import { api } from './session';
import { dataUrlToBlob } from '../lib/dataurl';

export interface PreparedSnapshot {
  kind: SnapshotKind;
  dataUrl: string;
  width?: number;
  height?: number;
  context: SnapshotContext;
}

interface Base {
  id: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

export type QueueItem =
  | (Base & {
      kind: 'thread.create';
      workspaceId: string;
      input: CreateThreadInput;
      attachments: { name: string; dataUrl: string }[];
      attachmentIds?: string[];
      snapshots: PreparedSnapshot[];
      threadId?: string;
      uploaded?: SnapshotKind[];
    })
  | (Base & {
      kind: 'comment.create';
      workspaceId: string;
      threadId: string;
      body: string;
      attachments: { name: string; dataUrl: string }[];
      attachmentIds?: string[];
    })
  | (Base & { kind: 'snapshot.upload'; threadId: string; snapshots: PreparedSnapshot[]; uploaded?: SnapshotKind[] });

type Waiter = { resolve: (v: unknown) => void; reject: (e: unknown) => void };
const waiters = new Map<string, Waiter>();
let flushing: Promise<void> | null = null;
let online = true;
let listener: ((pending: number, online: boolean) => void) | null = null;
let lock: Promise<unknown> = Promise.resolve();

export function onQueueStatus(fn: (pending: number, online: boolean) => void) {
  listener = fn;
}

export function isOnline() {
  return online;
}

async function read(): Promise<QueueItem[]> {
  return ((await chrome.storage.local.get(STORAGE_KEYS.queue))[STORAGE_KEYS.queue] as QueueItem[] | undefined) ?? [];
}

async function write(items: QueueItem[]) {
  await chrome.storage.local.set({ [STORAGE_KEYS.queue]: items });
}

/** Serialize read-modify-write cycles on the queue. */
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const p = lock.then(fn, fn);
  lock = p.catch(() => undefined);
  return p;
}

export async function pendingCount(): Promise<number> {
  return (await read()).length;
}

async function update(id: string, patch: Partial<QueueItem>) {
  await withLock(async () => {
    const items = await read();
    const i = items.findIndex((x) => x.id === id);
    if (i >= 0) {
      items[i] = { ...items[i], ...patch } as QueueItem;
      await write(items);
    }
  });
}

async function remove(id: string) {
  await withLock(async () => write((await read()).filter((x) => x.id !== id)));
}

/** Add an item; resolves when its main write reached the server (thread or comment), or with {queued} when offline. */
export async function enqueue<T>(item: QueueItem, waitMs = 15000): Promise<T | { queued: true; clientId: string }> {
  await withLock(async () => write([...(await read()), item]));
  const done = new Promise<T>((resolve, reject) => waiters.set(item.id, { resolve: resolve as (v: unknown) => void, reject }));
  void flush();
  const timeout = new Promise<{ queued: true; clientId: string }>((r) => setTimeout(() => r({ queued: true, clientId: item.id }), waitMs));
  const res = await Promise.race([done, timeout]);
  return res;
}

function isNetworkError(e: unknown) {
  return !(e instanceof ApiError) || e.status === 0 || e.status === 408 || e.status === 429 || e.status >= 500;
}

async function uploadSnapshots(item: { id: string; snapshots: PreparedSnapshot[]; uploaded?: SnapshotKind[] }, threadId: string) {
  const client = await api();
  const uploaded = [...(item.uploaded ?? [])];
  for (const s of item.snapshots) {
    if (uploaded.includes(s.kind)) continue;
    await client.uploadSnapshot(threadId, { kind: s.kind, context: s.context, width: s.width, height: s.height, blob: dataUrlToBlob(s.dataUrl) });
    uploaded.push(s.kind);
    await update(item.id, { uploaded } as Partial<QueueItem>);
  }
}

async function uploadAttachments(workspaceId: string, atts: { name: string; dataUrl: string }[]): Promise<string[]> {
  const client = await api();
  const ids: string[] = [];
  for (const a of atts) ids.push((await client.uploadAttachment(workspaceId, dataUrlToBlob(a.dataUrl), a.name)).id);
  return ids;
}

let onSynced: ((item: QueueItem, result: unknown) => void) | null = null;
export function onItemSynced(fn: (item: QueueItem, result: unknown) => void) {
  onSynced = fn;
}

async function processItem(item: QueueItem): Promise<void> {
  const client = await api();
  if (item.kind === 'thread.create') {
    let threadId = item.threadId;
    if (!threadId) {
      let attachmentIds = item.attachmentIds;
      if (!attachmentIds) {
        attachmentIds = await uploadAttachments(item.workspaceId, item.attachments);
        await update(item.id, { attachmentIds, attachments: [] } as Partial<QueueItem>);
      }
      const thread = await client.createThread(item.workspaceId, { ...item.input, attachmentIds, clientId: item.id });
      threadId = thread.id;
      await update(item.id, { threadId } as Partial<QueueItem>);
      waiters.get(item.id)?.resolve(thread);
      waiters.delete(item.id);
      onSynced?.(item, thread);
    }
    await uploadSnapshots(item, threadId);
    if (item.snapshots.length) onSynced?.(item, { threadId, snapshots: true });
  } else if (item.kind === 'comment.create') {
    let attachmentIds = item.attachmentIds;
    if (!attachmentIds) {
      attachmentIds = await uploadAttachments(item.workspaceId, item.attachments);
      await update(item.id, { attachmentIds, attachments: [] } as Partial<QueueItem>);
    }
    const c: Comment = await client.addComment(item.threadId, { body: item.body, attachmentIds, clientId: item.id });
    waiters.get(item.id)?.resolve(c);
    waiters.delete(item.id);
    onSynced?.(item, c);
  } else {
    await uploadSnapshots(item, item.threadId);
    waiters.get(item.id)?.resolve({ ok: true });
    waiters.delete(item.id);
    onSynced?.(item, { threadId: item.threadId, snapshots: true });
  }
}

/** Sync every queued item in order. Stops at the first network failure (keeps order). */
export function flush(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    try {
      for (;;) {
        const items = await read();
        const item = items[0];
        if (!item) {
          online = true;
          break;
        }
        try {
          await processItem(item);
          await remove(item.id);
          online = true;
        } catch (e) {
          if (isNetworkError(e)) {
            online = !(e instanceof TypeError);
            await update(item.id, { attempts: item.attempts + 1, lastError: (e as Error).message } as Partial<QueueItem>);
            break;
          }
          // Permanent failure (validation, permission): drop it so the queue does not block.
          waiters.get(item.id)?.reject(e);
          waiters.delete(item.id);
          await remove(item.id);
        }
      }
    } finally {
      flushing = null;
      listener?.(await pendingCount(), online);
    }
  })();
  return flushing;
}

export function markOffline() {
  online = false;
}

export type { ThreadDetail };
