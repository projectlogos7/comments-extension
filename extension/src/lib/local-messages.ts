// Extension-internal messages that are not part of the shared contract (content -> background).
import type { AnchorStatus } from '@pinpoint/shared';

export type LocalRequest =
  /** Content script reports how its threads' anchors resolved on the page. */
  | { type: 'content.anchors'; url: string; anchors: AnchorStatus[] }
  /** Content script asks the background to inject the page-world helper into its frame. */
  | { type: 'content.injectPageworld' }
  /** Content script reports that it is alive on a page. */
  | { type: 'content.ready'; url: string; allowed: boolean }
  /** Content script asks the background to mark the active thread for the side panel. */
  | { type: 'content.threadSelected'; threadId: string };

export const LOCAL_TYPES = new Set(['content.anchors', 'content.injectPageworld', 'content.ready', 'content.threadSelected']);

/** chrome.storage.session key holding { threadId, tabId } the side panel should open. */
export const FOCUS_THREAD_KEY = 'pp.focusThread';
/** chrome.storage.session key with latest anchors per tab: Record<tabId, { url, anchors }>. */
export const TAB_ANCHORS_KEY = 'pp.tabAnchors';
