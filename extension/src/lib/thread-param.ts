// The ?pinpoint_thread=<id> query parameter opens a page with a thread focused (FR-4.6, FR-5.8).
// normalizeUrl() treats it as a tracking parameter, so it never changes which page a URL maps to.
export const THREAD_PARAM = 'pinpoint_thread';

export function withThreadParam(url: string, threadId: string): string {
  const u = new URL(url);
  u.searchParams.set(THREAD_PARAM, threadId);
  return u.toString();
}

/** Returns the thread id and the URL without the parameter (null when absent). */
export function takeThreadParam(url: string): { threadId: string; cleanUrl: string } | null {
  const u = new URL(url);
  const threadId = u.searchParams.get(THREAD_PARAM);
  if (!threadId || !/^[A-Za-z0-9_-]{1,64}$/.test(threadId)) return null;
  u.searchParams.delete(THREAD_PARAM);
  return { threadId, cleanUrl: u.toString() };
}
