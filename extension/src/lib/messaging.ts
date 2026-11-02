// Helpers for talking to the background service worker from content scripts and extension pages.
import type { BgRequest, BgResponse } from '@pinpoint/shared';
import type { LocalRequest } from './local-messages';

export class BgError extends Error {
  constructor(
    public code: string,
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export async function bg<T = unknown>(req: BgRequest | LocalRequest): Promise<T> {
  let res: BgResponse<T> | undefined;
  try {
    res = (await chrome.runtime.sendMessage(req)) as BgResponse<T>;
  } catch (e) {
    throw new BgError('extension_unavailable', (e as Error).message || 'Extension is not reachable');
  }
  if (!res) throw new BgError('no_response', 'No response from the extension background');
  if (!res.ok) throw new BgError(res.error.code, res.error.message, res.error.status);
  return res.data;
}

/** Call an ApiClient method through the background (which owns the session). */
export function api<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
  return bg<T>({ type: 'api', method, args });
}
