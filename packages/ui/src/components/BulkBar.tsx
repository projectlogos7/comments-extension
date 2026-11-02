import { useState } from 'preact/hooks';
import { can, PRIORITIES, THREAD_TYPES, type BulkAction, type Member, type Priority, type ThreadType } from '@pinpoint/shared';
import { errorMessage, useRole, useUi } from '../context';
import { capitalize, Icon, Menu, type MenuItem } from './common';

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
  const assignItems: MenuItem[] = [
    { label: 'Unassign', onSelect: () => run({ action: 'assign', assigneeId: null }, 'Unassigned') },
    ...members
      .filter((m) => m.role !== 'guest')
      .map((m) => ({ label: m.user.name || m.user.email, onSelect: () => run({ action: 'assign', assigneeId: m.userId }, 'Assigned') })),
  ];
  const typeItems: MenuItem[] = [
    { label: 'None', onSelect: () => run({ action: 'type', type: null }, 'Type cleared') },
    ...THREAD_TYPES.map((t) => ({ label: capitalize(t), onSelect: () => run({ action: 'type', type: t as ThreadType }, 'Type set') })),
  ];
  const prioItems: MenuItem[] = [
    { label: 'None', onSelect: () => run({ action: 'priority', priority: null }, 'Priority cleared') },
    ...PRIORITIES.map((p) => ({ label: capitalize(p), onSelect: () => run({ action: 'priority', priority: p as Priority }, 'Priority set') })),
  ];

  return (
    <div class="pp-bulkbar" role="toolbar" aria-label="Bulk actions">
      <strong>{ids.length} selected</strong>
      <span class="pp-bulk-sep" aria-hidden="true" />
      <button class="pp-btn pp-btn-sm" disabled={busy} onClick={() => run({ action: 'resolve' }, 'Resolved')}>
        <Icon name="check" size={14} /> Resolve
      </button>
      <button class="pp-btn pp-btn-sm" disabled={busy} onClick={() => run({ action: 'reopen' }, 'Reopened')}>
        Reopen
      </button>
      {can(role, 'assign') && (
        <Menu label="Assign selected" align="start" items={assignItems}>
          Assign <Icon name="chevron" size={13} />
        </Menu>
      )}
      <Menu label="Set type" align="start" items={typeItems}>
        Type <Icon name="chevron" size={13} />
      </Menu>
      <Menu label="Set priority" align="start" items={prioItems}>
        Priority <Icon name="chevron" size={13} />
      </Menu>
      {can(role, 'export') && (
        <button class="pp-btn pp-btn-sm" onClick={onExport}>
          <Icon name="download" size={14} /> Export
        </button>
      )}
      {can(role, 'deleteAny') && (
        <button class="pp-btn pp-btn-sm pp-danger" disabled={busy} onClick={() => run({ action: 'delete' }, 'Deleted')}>
          <Icon name="trash" size={14} /> Delete
        </button>
      )}
      <span class="pp-grow" />
      <button class="pp-icon-btn" aria-label="Clear selection" title="Clear selection" onClick={onClear}>
        <Icon name="x" />
      </button>
    </div>
  );
}
