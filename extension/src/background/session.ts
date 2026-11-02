// Session: server URL, tokens (refreshed before expiry, single-flight), the current user and the
// active workspace. Everything lives in chrome.storage.local because the service worker can be
// suspended at any time.
import { ApiClient, ApiError, DEFAULT_SERVER_URL, STORAGE_KEYS, parseAuthFragment, type AuthState, type AuthTokens, type Me, type Workspace } from '@pinpoint/shared';

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

const REFRESH_MARGIN_MS = 60_000;

let cachedServerUrl: string | null = null;
let refreshing: Promise<boolean> | null = null;
let apiInstance: ApiClient | null = null;

export async function getServerUrl(): Promise<string> {
  if (cachedServerUrl) return cachedServerUrl;
  const v = (await chrome.storage.local.get(STORAGE_KEYS.serverUrl))[STORAGE_KEYS.serverUrl] as string | undefined;
  cachedServerUrl = (v || DEFAULT_SERVER_URL).replace(/\/$/, '');
  return cachedServerUrl;
}

export async function setServerUrl(url: string) {
  const clean = new URL(url).origin;
  await signOutLocal();
  await chrome.storage.local.set({ [STORAGE_KEYS.serverUrl]: clean });
  cachedServerUrl = clean;
  apiInstance = null;
}

async function getTokens(): Promise<StoredTokens | null> {
  return ((await chrome.storage.local.get(STORAGE_KEYS.tokens))[STORAGE_KEYS.tokens] as StoredTokens | undefined) ?? null;
}

export async function saveTokens(t: AuthTokens) {
  const stored: StoredTokens = { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: Date.now() + t.expiresIn * 1000 };
  await chrome.storage.local.set({ [STORAGE_KEYS.tokens]: stored });
}

export async function api(): Promise<ApiClient> {
  if (apiInstance) return apiInstance;
  const baseUrl = await getServerUrl();
  apiInstance = new ApiClient({
    baseUrl,
    getToken: () => accessToken(),
    onUnauthorized: () => refreshTokens(true),
  });
  return apiInstance;
}

/** A valid access token, refreshing first when it is about to expire. */
export async function accessToken(): Promise<string | null> {
  const t = await getTokens();
  if (!t) return null;
  if (t.expiresAt - Date.now() < REFRESH_MARGIN_MS) {
    const ok = await refreshTokens(false);
    if (!ok) return null;
    return (await getTokens())?.accessToken ?? null;
  }
  return t.accessToken;
}

/** Single-flight refresh. Returns false (and signs out) when the refresh token is rejected. */
export function refreshTokens(force: boolean): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const t = await getTokens();
      if (!t) return false;
      if (!force && t.expiresAt - Date.now() >= REFRESH_MARGIN_MS) return true;
      const client = new ApiClient({ baseUrl: await getServerUrl(), getToken: () => null });
      const next = await client.refresh(t.refreshToken);
      await saveTokens(next);
      return true;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 400 || e.status === 403)) {
        await signOutLocal();
        onAuthChanged?.();
      }
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

let onAuthChanged: (() => void) | null = null;
export function setAuthChangedHandler(fn: () => void) {
  onAuthChanged = fn;
}

export async function getMe(): Promise<Me | null> {
  return ((await chrome.storage.local.get(STORAGE_KEYS.me))[STORAGE_KEYS.me] as Me | undefined) ?? null;
}

export async function loadMe(): Promise<Me | null> {
  const client = await api();
  const me = await client.me();
  await chrome.storage.local.set({ [STORAGE_KEYS.me]: me });
  const active = await getActiveWorkspaceId();
  if (!active || !me.memberships.some((m) => m.workspace.id === active)) {
    await chrome.storage.local.set({ [STORAGE_KEYS.activeWorkspace]: me.memberships[0]?.workspace.id ?? null });
  }
  return me;
}

export async function getActiveWorkspaceId(): Promise<string | null> {
  return ((await chrome.storage.local.get(STORAGE_KEYS.activeWorkspace))[STORAGE_KEYS.activeWorkspace] as string | null | undefined) ?? null;
}

export async function setActiveWorkspace(id: string) {
  await chrome.storage.local.set({ [STORAGE_KEYS.activeWorkspace]: id });
}

export async function activeWorkspace(): Promise<Workspace | null> {
  const me = await getMe();
  const id = await getActiveWorkspaceId();
  return me?.memberships.find((m) => m.workspace.id === id)?.workspace ?? null;
}

export async function completeSignIn(tokens: AuthTokens) {
  await saveTokens(tokens);
  apiInstance = null;
  await loadMe();
}

export function tokensFromRedirect(url: string): AuthTokens | null {
  return parseAuthFragment(url);
}

/** Sign out locally: clears tokens, cached user, queue and drafts (NFR Authentication). */
export async function signOutLocal() {
  await chrome.storage.local.remove([STORAGE_KEYS.tokens, STORAGE_KEYS.me, STORAGE_KEYS.activeWorkspace, STORAGE_KEYS.queue, STORAGE_KEYS.drafts, STORAGE_KEYS.lastSeenNotification]);
  try {
    await chrome.storage.session.clear();
  } catch {
    /* ignore */
  }
  apiInstance = null;
}

export async function signOut() {
  const t = await getTokens();
  if (t) {
    try {
      await (await api()).logout(t.refreshToken);
    } catch {
      /* offline: still clear locally */
    }
  }
  await signOutLocal();
}

export async function authState(extra: { pendingWrites: number; online: boolean }): Promise<AuthState> {
  const t = await getTokens();
  return {
    signedIn: !!t,
    me: t ? await getMe() : null,
    activeWorkspaceId: t ? await getActiveWorkspaceId() : null,
    serverUrl: await getServerUrl(),
    pendingWrites: extra.pendingWrites,
    online: extra.online,
  };
}
