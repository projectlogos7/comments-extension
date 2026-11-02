import { bestSelector, componentLabel, jsPath, threadToAiPrompt, threadToMarkdown, type CopyFormat, type Thread, type ThreadDetail } from '@pinpoint/shared';
import { shareUrlFor } from '../host';

export const COPY_LABELS: Record<CopyFormat, string> = {
  selector: 'CSS selector',
  xpath: 'XPath',
  jspath: 'JS path',
  component: 'Component',
  html: 'HTML snippet',
  markdown: 'Markdown',
  ai: 'AI prompt',
};

/** Text for a "Copy as" option; falls back to the selector when a reference is missing (FR-6.2). */
export function copyText(thread: Thread | ThreadDetail, format: CopyFormat, serverUrl: string): string | null {
  const a = thread.anchor;
  const ctx = { shareUrl: (t: Thread) => shareUrlFor(serverUrl, t.shareToken) };
  switch (format) {
    case 'selector':
      return bestSelector(a);
    case 'xpath':
      return a.xpath ?? a.targets?.[0]?.xpath ?? null;
    case 'jspath':
      return jsPath(a);
    case 'component':
      return componentLabel(a) ?? bestSelector(a);
    case 'html':
      return a.htmlSnippet ?? null;
    case 'markdown':
      return threadToMarkdown(thread, ctx);
    case 'ai':
      return threadToAiPrompt(thread, ctx);
  }
}

export function availableCopyFormats(thread: Thread): CopyFormat[] {
  const a = thread.anchor;
  const hasEl = !!bestSelector(a);
  const out: CopyFormat[] = [];
  if (hasEl) out.push('selector', 'xpath', 'jspath', 'component');
  if (a.htmlSnippet) out.push('html');
  out.push('markdown', 'ai');
  return out;
}
