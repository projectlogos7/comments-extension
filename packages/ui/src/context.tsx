import { createContext, type ComponentChildren } from 'preact';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Member, Membership, Role } from '@pinpoint/shared';
import type { Session, UiEvent, UiHost } from './host';

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error' | 'success';
}

interface ConfirmState {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

interface UiContextValue {
  host: UiHost;
  session: Session;
  setSession: (s: Session) => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  confirm: (opts: Omit<ConfirmState, 'resolve'>) => Promise<boolean>;
  membersCache: Map<string, Member[]>;
}

const UiContext = createContext<UiContextValue | null>(null);

export function UiProvider({ host, children }: { host: UiHost; children: ComponentChildren }) {
  const [session, setSession] = useState<Session>(() => host.getSession());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirm] = useState<ConfirmState | null>(null);
  const membersCache = useRef(new Map<string, Member[]>()).current;
  const nextId = useRef(1);

  useEffect(
    () =>
      host.subscribe((e) => {
        if (e.kind === 'auth.changed') setSession({ ...host.getSession() });
      }),
    [host],
  );

  const toast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 3000);
  }, []);

  const confirm = useCallback(
    (opts: Omit<ConfirmState, 'resolve'>) => new Promise<boolean>((resolve) => setConfirm({ ...opts, resolve })),
    [],
  );

  const value = useMemo(() => ({ host, session, setSession, toast, confirm, membersCache }), [host, session, toast, confirm, membersCache]);

  return (
    <UiContext.Provider value={value}>
      {children}
      <div class="pp-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} class={`pp-toast pp-toast-${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
      {confirmState && (
        <ConfirmDialog
          state={confirmState}
          onClose={(ok) => {
            confirmState.resolve(ok);
            setConfirm(null);
          }}
        />
      )}
    </UiContext.Provider>
  );
}

function ConfirmDialog({ state, onClose }: { state: ConfirmState; onClose: (ok: boolean) => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => btn.current?.focus(), []);
  return (
    <div class="pp-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose(false)}>
      <div
        class="pp-modal pp-modal-sm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="pp-confirm-title"
        onKeyDown={(e) => e.key === 'Escape' && onClose(false)}
      >
        <h2 id="pp-confirm-title">{state.title}</h2>
        {state.body && <p class="pp-muted">{state.body}</p>}
        <div class="pp-row pp-end">
          <button class="pp-btn" onClick={() => onClose(false)}>
            Cancel
          </button>
          <button ref={btn} class={`pp-btn ${state.danger ? 'pp-btn-danger' : 'pp-btn-primary'}`} onClick={() => onClose(true)}>
            {state.confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useUi(): UiContextValue {
  const v = useContext(UiContext);
  if (!v) throw new Error('UiProvider missing');
  return v;
}

export function useHost(): UiHost {
  return useUi().host;
}

/** Subscribe to live events for the lifetime of the component. */
export function useUiEvents(listener: (e: UiEvent) => void, deps: unknown[] = []) {
  const host = useHost();
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(() => host.subscribe((e) => ref.current(e)), [host, ...deps]);
}

export function useActiveMembership(): Membership | null {
  const { session } = useUi();
  const ms = session.me?.memberships ?? [];
  return ms.find((m) => m.workspace.id === session.activeWorkspaceId) ?? ms[0] ?? null;
}

export function useRole(): Role | null {
  return useActiveMembership()?.member.role ?? null;
}

/** Members of a workspace (cached; refreshed in background). */
export function useMembers(workspaceId: string | null | undefined): Member[] {
  const { host, membersCache } = useUi();
  const [members, setMembers] = useState<Member[]>(() => (workspaceId ? membersCache.get(workspaceId) ?? [] : []));
  useEffect(() => {
    if (!workspaceId) return;
    let alive = true;
    setMembers(membersCache.get(workspaceId) ?? []);
    host.api
      .listMembers(workspaceId)
      .then((m) => {
        membersCache.set(workspaceId, m);
        if (alive) setMembers(m);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [workspaceId, host]);
  return members;
}

/** Generic async loader with reload. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: Error | null; loading: boolean; reload: () => void; setData: (d: T) => void } {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn()
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((e) => alive && setError(e instanceof Error ? e : new Error(String(e))))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}

export function errorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as Error).message);
  return String(e);
}
