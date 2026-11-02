import { useState } from 'preact/hooks';
import type { SavedView, ThreadFilters, ThreadSort } from '@pinpoint/shared';
import { errorMessage, useAsync, useUi } from '../context';
import { Modal, Toggle } from './common';

export interface SavedViewsProps {
  workspaceId: string;
  filters: ThreadFilters;
  sort: ThreadSort;
  activeViewId: string | null;
  onApply: (view: SavedView | null) => void;
}

export function SavedViews({ workspaceId, filters, sort, activeViewId, onApply }: SavedViewsProps) {
  const { host, toast, confirm, session } = useUi();
  const { data: views = [], reload, setData } = useAsync(() => host.api.listViews(workspaceId), [workspaceId]);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const active = views.find((v) => v.id === activeViewId) ?? null;
  const meId = session.me?.user.id;

  const save = async () => {
    try {
      const v = await host.api.createView(workspaceId, { name: name.trim(), filters, sort, shared });
      setData([...views, v]);
      onApply(v);
      setSaving(false);
      setName('');
      toast('View saved', 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const updateActive = async () => {
    if (!active) return;
    try {
      const v = await host.api.updateView(workspaceId, active.id, { filters, sort });
      setData(views.map((x) => (x.id === v.id ? v : x)));
      toast('View updated', 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const remove = async () => {
    if (!active) return;
    if (!(await confirm({ title: `Delete view "${active.name}"?`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await host.api.deleteView(workspaceId, active.id);
      onApply(null);
      reload();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  return (
    <div class="pp-views" aria-label="Saved views">
      <select
        aria-label="Saved view"
        value={activeViewId ?? ''}
        onChange={(e) => {
          const id = (e.target as HTMLSelectElement).value;
          onApply(views.find((v) => v.id === id) ?? null);
        }}
      >
        <option value="">All threads</option>
        {views.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
            {v.shared ? ' (shared)' : ''}
          </option>
        ))}
      </select>
      <button class="pp-btn pp-btn-sm" onClick={() => setSaving(true)}>
        Save view
      </button>
      {active && active.createdBy === meId && (
        <>
          <button class="pp-btn pp-btn-sm" onClick={updateActive}>
            Update
          </button>
          <button class="pp-btn pp-btn-sm pp-btn-danger" onClick={remove}>
            Delete
          </button>
        </>
      )}
      {saving && (
        <Modal title="Save view" onClose={() => setSaving(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) save();
            }}
          >
            <label class="pp-field">
              <span class="pp-field-label">Name</span>
              <input required value={name} placeholder="Open bugs for release 4" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
            </label>
            <Toggle checked={shared} onChange={setShared} label="Share with the workspace" />
            <div class="pp-row pp-end">
              <button type="button" class="pp-btn" onClick={() => setSaving(false)}>
                Cancel
              </button>
              <button type="submit" class="pp-btn pp-btn-primary">
                Save
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
