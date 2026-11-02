// Content-script injection only on the workspace's allowed sites (FR-7.3, NFR Privacy).
// Host access is an optional permission per site; we register a dynamic content script for the
// origins we hold, and inject on demand (activeTab) when the user starts comment mode.
import { LOCALHOST_MATCH_PATTERNS, siteAllowed, sitePatternToMatchPatterns } from '@pinpoint/shared';
import { activeWorkspace } from './session';

const SCRIPT_ID = 'pinpoint-content';

export async function allowedMatchPatterns(): Promise<string[]> {
  const ws = await activeWorkspace();
  const patterns = new Set<string>(LOCALHOST_MATCH_PATTERNS);
  for (const s of ws?.allowedSites ?? []) for (const p of sitePatternToMatchPatterns(s)) patterns.add(p);
  return [...patterns];
}

export async function missingOrigins(): Promise<string[]> {
  const out: string[] = [];
  for (const p of await allowedMatchPatterns()) {
    try {
      if (!(await chrome.permissions.contains({ origins: [p] }))) out.push(p);
    } catch {
      out.push(p);
    }
  }
  return out;
}

/** (Re-)register the dynamic content script for allowed origins we have permission for. */
export async function syncContentScripts(): Promise<{ registered: string[]; missing: string[] }> {
  const ws = await activeWorkspace();
  const all = ws ? await allowedMatchPatterns() : [];
  const granted: string[] = [];
  const missing: string[] = [];
  for (const p of all) {
    let ok = false;
    try {
      ok = await chrome.permissions.contains({ origins: [p] });
    } catch {
      ok = false;
    }
    (ok ? granted : missing).push(p);
  }
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  } catch {
    /* none registered */
  }
  if (granted.length) {
    await chrome.scripting.registerContentScripts([
      { id: SCRIPT_ID, js: ['content.js'], matches: granted, runAt: 'document_idle', allFrames: false, persistAcrossSessions: true },
    ]);
  }
  return { registered: granted, missing };
}

export async function isUrlAllowed(url: string | undefined): Promise<boolean> {
  if (!url || !/^https?:/.test(url)) return false;
  const ws = await activeWorkspace();
  if (!ws) return false;
  return siteAllowed(new URL(url).host, ws.allowedSites);
}

export async function hasHostPermission(url: string | undefined): Promise<boolean> {
  if (!url || !/^https?:/.test(url)) return false;
  const u = new URL(url);
  try {
    return await chrome.permissions.contains({ origins: [`${u.protocol}//${u.hostname}/*`] });
  } catch {
    return false;
  }
}

/** Is our content script alive in this tab? */
export async function pingContent(tabId: number): Promise<boolean> {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: 'page.info' }, { frameId: 0 });
    return !!r;
  } catch {
    return false;
  }
}

/** Inject the content script into a tab if it is on an allowed site and not running yet. */
export async function ensureInjected(tabId: number): Promise<boolean> {
  if (await pingContent(tabId)) return true;
  const tab = await chrome.tabs.get(tabId);
  if (!(await isUrlAllowed(tab.url))) return false;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch {
    return false; // no host permission and no activeTab grant
  }
  for (let i = 0; i < 10; i++) {
    if (await pingContent(tabId)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/** Inject into already-open tabs of allowed sites after sign-in or permission grants. */
export async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    if (t.id == null || !t.url) continue;
    if ((await isUrlAllowed(t.url)) && (await hasHostPermission(t.url))) void ensureInjected(t.id);
  }
}
