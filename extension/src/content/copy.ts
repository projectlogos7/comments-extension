// "Copy as" (FR-6.1, FR-6.2, PRD §10): selector, XPath, JS path, component, HTML, Markdown, AI prompt.
import type { CopyFormat, ThreadDetail } from '@pinpoint/shared';
import { bestSelector, componentLabel, jsPath, threadToAiPrompt, threadToMarkdown } from '@pinpoint/shared';
import { api } from '../lib/messaging';
import { trimmedHtml } from './anchor';

export const COPY_LABELS: Record<CopyFormat, string> = {
  selector: 'CSS selector',
  xpath: 'XPath',
  jspath: 'JS path',
  component: 'Component',
  html: 'HTML snippet',
  markdown: 'Markdown',
  ai: 'AI prompt',
};

export async function copyText(thread: ThreadDetail, format: CopyFormat, serverUrl: string, liveEl: Element | null): Promise<string> {
  const a = thread.anchor;
  let shareToken = thread.shareToken;
  if ((format === 'markdown' || format === 'ai') && !shareToken) {
    try {
      shareToken = (await api<{ token: string }>('shareThread', thread.id)).token;
    } catch {
      /* links may be disabled for this role; export without one */
    }
  }
  const ctx = { shareUrl: () => (shareToken ? `${serverUrl}/share/${shareToken}` : null) };
  switch (format) {
    case 'selector':
      return bestSelector(a) ?? '';
    case 'xpath':
      return a.xpath ?? a.targets?.[0]?.xpath ?? '';
    case 'jspath':
      return jsPath(a) ?? '';
    case 'component':
      return componentLabel(a) ?? bestSelector(a) ?? '';
    case 'html':
      return liveEl ? trimmedHtml(liveEl) : a.htmlSnippet ?? '';
    case 'markdown':
      return threadToMarkdown(thread, ctx);
    case 'ai':
      return threadToAiPrompt(thread, ctx);
  }
}

/** Write to the clipboard; returns false when the page is not focused (the caller can copy instead). */
export async function writeClipboard(text: string, root?: ShadowRoot): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    (root ?? document.body).appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}
