/** Copy text with the async clipboard API, falling back to execCommand for older contexts. */
export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    /* fall back */
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  if (!ok) throw new Error('Could not copy to the clipboard');
}

/** Local-storage drafts (FR-2.12) for hosts without extension storage. */
export const localDrafts = {
  async get(key: string): Promise<string | null> {
    try {
      return localStorage.getItem(`pp.draft.${key}`);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string | null): Promise<void> {
    try {
      if (value) localStorage.setItem(`pp.draft.${key}`, value);
      else localStorage.removeItem(`pp.draft.${key}`);
    } catch {
      /* storage unavailable */
    }
  },
};

/** Link to the live page that the extension's content script recognises (?pinpoint_thread=<id>). */
export function liveThreadUrl(pageUrl: string, threadId: string): string {
  try {
    const u = new URL(pageUrl);
    u.searchParams.set('pinpoint_thread', threadId);
    return u.toString();
  } catch {
    return pageUrl;
  }
}
