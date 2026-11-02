import type { AnchorStatus, Thread } from '@pinpoint/shared';

export interface PanelGroups {
  page: Thread[];
  attached: Thread[];
  detached: Thread[];
}

/**
 * Split the page's threads for the side panel (FR-5.1): page comments first, then anchored threads in
 * page order (as reported by the content script), then threads whose anchor could not be resolved.
 */
export function orderPanelThreads(threads: Thread[], anchors: AnchorStatus[]): PanelGroups {
  const status = new Map(anchors.map((a) => [a.threadId, a]));
  const page: Thread[] = [];
  const attached: Thread[] = [];
  const detached: Thread[] = [];
  for (const t of threads) {
    if (t.scope === 'page') page.push(t);
    else {
      const s = status.get(t.id);
      if (s?.state === 'detached' || (!s && t.detached)) detached.push(t);
      else attached.push(t);
    }
  }
  const order = (t: Thread) => status.get(t.id)?.order ?? Number.MAX_SAFE_INTEGER - 1000 + t.number;
  attached.sort((a, b) => order(a) - order(b) || a.number - b.number);
  page.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  detached.sort((a, b) => a.number - b.number);
  return { page, attached, detached };
}

export interface QuickFilter {
  status: 'open' | 'resolved' | 'all';
  mine: boolean;
  scope: 'all' | 'area' | 'section' | 'page';
}

export function applyQuickFilter(threads: Thread[], f: QuickFilter, meId: string | undefined): Thread[] {
  return threads.filter(
    (t) =>
      (f.status === 'all' || t.status === f.status) &&
      (!f.mine || t.createdBy === meId || t.assigneeId === meId) &&
      (f.scope === 'all' || t.scope === f.scope),
  );
}
