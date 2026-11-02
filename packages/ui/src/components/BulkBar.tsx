import { useState } from 'preact/hooks';
import { can, PRIORITIES, THREAD_TYPES, type BulkAction, type Member, type Priority, type ThreadType } from '@pinpoint/shared';
import { errorMessage, useRole, useUi } from '../context';
import { capitalize } from './common';

export interface BulkBarProps {
  workspaceId: string;
  ids: string[];
  members: Member[];
  onDone: () => void;
  onClear: () => void;
  onExport: () => void;
}

export function BulkBar({ workspaceId, ids, members, onDone, onClear, onExport }: BulkBarProps) {
  const { host, toast, confirm } = useUi();
  const role = useRole();
  const [busy, setBusy] = useState(false);
  if (!ids.length) return null;

  const run = async (action: BulkAction, label: string) => {
    if (action.action === 'delete') {
      const ok = await confirm({ title: `Delete ${ids.length} threads?`, body: 'Threads and their snapshots will be deleted.', confirmLabel: 'Delete', danger: true });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const r = await host.api.bulk(workspaceId, ids, action);
      toast(`${label}: ${r.updated} thread${r.updated === 1 ? '' : 's'}`, 'success');
      onDone();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  const val = (e: Event) => (e.target as HTMLSelectElement).value;

  return (
    <div class="pp-bulkbar" role="toolbar" aria-label="Bulk actions">
      <strong>{ids.length} selected</strong>
      <button class="pp-btn pp-btn-sm" disabled={busy} onClick={() => run({ action: 'resolve' }, 'Resolved')}>
        Resolve
      </button>
      <button class="pp-btn pp-btn-sm" disabled={busy} onClick={() => run({ action: 'reopen' }, 'Reopened')}>
        Reopen
      </button>
      {can(role, 'assign') && (
        <select
          aria-label="Assign selected"
          disabled={busy}
          value=""
          onChange={(e) => {
            const v = val(e);
            if (v) run({ action: 'assign', assigneeId: v === '__none' ? null : v }, 'Assigned');
          }}
        >
          <option value="">Assign…</option>
          <option value="__none">Unassign</option>
          {members
            .filter((m) => m.role !== 'guest')
            .map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.user.name || m.user.email}
              </option>
            ))}
        </select>
      )}
      <select
        aria-label="Set type"
        disabled={busy}
        value=""
        onChange={(e) => {
          const v = val(e);
          if (v) run({ action: 'type', type: v === '__none' ? null : (v as ThreadType) }, 'Type set');
        }}
      >
        <option value="">Type…</option>
        <option value="__none">None</option>
        {THREAD_TYPES.map((t) => (
          <option key={t} value={t}>
            {capitalize(t)}
          </option>
        ))}
      </select>
      <select
        aria-label="Set priority"
        disabled={busy}
        value=""
        onChange={(e) => {
          const v = val(e);
          if (v) run({ action: 'priority', priority: v === '__none' ? null : (v as Priority) }, 'Priority set');
        }}
      >
        <option value="">Priority…</option>
        <option value="__none">None</option>
        {PRIORITIES.map((t) => (
          <option key={t} value={t}>
            {capitalize(t)}
          </option>
        ))}
      </select>
      {can(role, 'export') && (
        <button class="pp-btn pp-btn-sm" onClick={onExport}>
          Export…
        </button>
      )}
      {can(role, 'deleteAny') && (
        <button class="pp-btn pp-btn-sm pp-btn-danger" disabled={busy} onClick={() => run({ action: 'delete' }, 'Deleted')}>
          Delete
        </button>
      )}
      <span class="pp-grow" />
      <button class="pp-link-btn" onClick={onClear}>
        Clear selection
      </button>
    </div>
  );
}
