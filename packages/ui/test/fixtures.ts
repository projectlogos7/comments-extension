import { vi } from 'vitest';
import type { Comment, Me, Member, Thread, ThreadDetail, User } from '@pinpoint/shared';
import { defaultNotificationPrefs, DEFAULT_PRIVACY } from '@pinpoint/shared';
import type { UiHost, UiEvent } from '../src/host';

export const ana: User = { id: 'u1', email: 'ana@example.com', name: 'Ana Lima', avatarUrl: null };
export const bo: User = { id: 'u2', email: 'bo@example.com', name: 'Bo Chen', avatarUrl: null };

export function member(u: User, role: Member['role'] = 'member'): Member {
  return { id: 'm-' + u.id, workspaceId: 'w1', userId: u.id, user: u, role, notificationPrefs: defaultNotificationPrefs(), createdAt: '2026-01-01T00:00:00Z' };
}

export function comment(over: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    threadId: 't1',
    authorId: ana.id,
    author: ana,
    body: 'padding is **off** on mobile @[Bo Chen](u2)',
    mentions: ['u2'],
    attachments: [],
    reactions: [],
    createdAt: '2026-11-01T10:00:00Z',
    editedAt: null,
    deletedAt: null,
    ...over,
  };
}

export function thread(over: Partial<ThreadDetail> = {}): ThreadDetail {
  const site = over.page?.site ?? 'staging.example.com';
  const t: ThreadDetail = {
    id: 't1',
    workspaceId: 'w1',
    pageId: 'p1',
    page: { id: 'p1', workspaceId: 'w1', site, normalizedUrl: `https://${site}/pricing`, path: '/pricing', title: 'Pricing', lastSeenAt: '2026-11-01T00:00:00Z' },
    number: 1,
    scope: 'area',
    urlMatch: 'path',
    anchor: {
      scope: 'area',
      urlMatch: 'path',
      viewport: { w: 1440, h: 900, dpr: 2 },
      selectors: ["[data-testid='pricing-card']"],
      xpath: '/html/body/main/section[2]/div[1]',
      textFingerprint: 'Pro plan',
      component: { framework: 'react', name: 'PricingCard', file: 'src/Pricing.tsx', line: 12 },
      htmlSnippet: '<div data-testid="pricing-card">Pro plan</div>',
    },
    anchorHistory: [],
    status: 'open',
    assigneeId: null,
    assignee: null,
    type: 'bug',
    priority: 'high',
    detached: false,
    createdBy: ana.id,
    author: ana,
    createdAt: '2026-11-01T10:00:00Z',
    resolvedBy: null,
    resolvedAt: null,
    lastActivityAt: '2026-11-01T10:00:00Z',
    commentCount: 1,
    firstComment: comment(),
    snapshots: [],
    unread: false,
    shareToken: null,
    comments: [comment()],
    snapshotHistory: [],
    ...over,
  };
  return t;
}

export function me(role: Member['role'] = 'member'): Me {
  return {
    user: ana,
    analyticsOptOut: false,
    memberships: [
      {
        workspace: { id: 'w1', name: 'Acme', allowedSites: ['staging.example.com'], linkSharing: 'members', emailDomain: null, privacy: DEFAULT_PRIVACY, createdAt: '2026-01-01T00:00:00Z' },
        member: member(ana, role),
      },
    ],
  };
}

export function mockHost(apiOverrides: Record<string, unknown> = {}, role: Member['role'] = 'member') {
  const listeners = new Set<(e: UiEvent) => void>();
  const api: Record<string, ReturnType<typeof vi.fn>> = {
    listMembers: vi.fn(async () => [member(ana, role), member(bo)]),
    getThread: vi.fn(async () => thread()),
    updateThread: vi.fn(async (_id: string, input: Partial<ThreadDetail>) => thread(input)),
    markRead: vi.fn(async () => undefined),
    markNotificationsRead: vi.fn(async () => undefined),
    listIntegrations: vi.fn(async () => []),
    listTickets: vi.fn(async () => []),
    shareThread: vi.fn(async () => ({ token: 'tok', url: 'http://srv/share/tok', kind: 'thread', createdAt: '' })),
    activity: vi.fn(async () => []),
    unreadCounts: vi.fn(async () => ({ mentions: 0, notifications: 0 })),
  };
  Object.assign(api, apiOverrides);
  const host: UiHost & { emit: (e: UiEvent) => void } = {
    isExtension: false,
    api: api as unknown as UiHost['api'],
    serverUrl: 'http://srv',
    getSession: () => ({ me: me(role), activeWorkspaceId: 'w1' }),
    refreshSession: vi.fn(async () => ({ me: me(role), activeWorkspaceId: 'w1' })),
    setActiveWorkspace: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    emit: (e) => listeners.forEach((l) => l(e)),
    openThread: vi.fn(),
    postReply: vi.fn(async () => {}),
    copy: vi.fn(async () => {}),
    exportThreads: vi.fn(async () => {}),
    getDraft: vi.fn(async () => null),
    setDraft: vi.fn(async () => {}),
    navigate: vi.fn(),
    appUrl: (r: string) => `http://srv/app/#${r}`,
  };
  return { host, api };
}

export const flush = async (n = 5) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

export function threads(): Thread[] {
  return [
    thread({ id: 'a', number: 1 }),
    thread({ id: 'b', number: 2, pageId: 'p2', page: { id: 'p2', workspaceId: 'w1', site: 'staging.example.com', normalizedUrl: 'https://staging.example.com/', path: '/', title: 'Home', lastSeenAt: '' } }),
    thread({ id: 'c', number: 3 }),
    thread({ id: 'd', number: 1, pageId: 'p3', page: { id: 'p3', workspaceId: 'w1', site: 'app.example.com', normalizedUrl: 'https://app.example.com/x', path: '/x', title: 'X', lastSeenAt: '' } }),
  ];
}
