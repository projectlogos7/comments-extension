import { useState } from 'preact/hooks';
import type { ExportFormat, ListThreadsQuery, Page } from '@pinpoint/shared';
import { errorMessage, useUi } from '../context';
import { Modal } from './common';
import { cleanFilters } from './FiltersBar';

export type ExportTarget = 'selection' | 'filter' | 'page' | 'site';

export interface ExportDialogProps {
  workspaceId: string;
  selectedIds: string[];
  query: ListThreadsQuery;
  pages: Pick<Page, 'id' | 'title' | 'normalizedUrl' | 'site'>[];
  sites: string[];
  onClose: () => void;
}

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: 'md', label: 'Markdown', hint: 'Pull request or sprint notes' },
  { id: 'csv', label: 'CSV', hint: 'Spreadsheets and reports' },
  { id: 'json', label: 'JSON', hint: 'Automation and AI workflows' },
  { id: 'pdf', label: 'PDF report', hint: 'Grouped by page with snapshots' },
];

/** Build the export query for a target (FR-6.5: exports respect active filters). */
export function exportQuery(target: ExportTarget, opts: { selectedIds: string[]; query: ListThreadsQuery; pageId?: string; site?: string }): ListThreadsQuery & { ids?: string[] } {
  const { cursor: _c, limit: _l, ...rest } = opts.query;
  switch (target) {
    case 'selection':
      return { ids: opts.selectedIds };
    case 'page':
      return { pageId: opts.pageId, sort: 'page' };
    case 'site':
      return { site: opts.site, sort: 'page' };
    default:
      return cleanFilters(rest) as ListThreadsQuery;
  }
}

export function ExportDialog({ workspaceId, selectedIds, query, pages, sites, onClose }: ExportDialogProps) {
  const { host, toast } = useUi();
  const [format, setFormat] = useState<ExportFormat>('md');
  const [target, setTarget] = useState<ExportTarget>(selectedIds.length ? 'selection' : 'filter');
  const [pageId, setPageId] = useState(query.pageId ?? pages[0]?.id ?? '');
  const [site, setSite] = useState(query.site ?? sites[0] ?? '');
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    try {
      const ext = format === 'md' ? 'md' : format;
      await host.exportThreads(workspaceId, {
        format,
        query: exportQuery(target, { selectedIds, query, pageId, site }),
        filename: `pinpoint-${target}-${new Date().toISOString().slice(0, 10)}.${ext}`,
      });
      toast('Export ready', 'success');
      onClose();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Export comments" onClose={onClose}>
      <fieldset class="pp-fieldset">
        <legend>Format</legend>
        {FORMATS.map((f) => (
          <label key={f.id} class="pp-radio">
            <input type="radio" name="pp-format" checked={format === f.id} onChange={() => setFormat(f.id)} />
            <span>
              <strong>{f.label}</strong> <span class="pp-muted pp-small">{f.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset class="pp-fieldset">
        <legend>Threads</legend>
        <label class="pp-radio">
          <input type="radio" name="pp-target" disabled={!selectedIds.length} checked={target === 'selection'} onChange={() => setTarget('selection')} />
          <span>Selected threads ({selectedIds.length})</span>
        </label>
        <label class="pp-radio">
          <input type="radio" name="pp-target" checked={target === 'filter'} onChange={() => setTarget('filter')} />
          <span>Everything matching the current filter</span>
        </label>
        <label class="pp-radio">
          <input type="radio" name="pp-target" disabled={!pages.length} checked={target === 'page'} onChange={() => setTarget('page')} />
          <span>One page</span>
        </label>
        {target === 'page' && (
          <select aria-label="Page to export" value={pageId} onChange={(e) => setPageId((e.target as HTMLSelectElement).value)}>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title || p.normalizedUrl}
              </option>
            ))}
          </select>
        )}
        <label class="pp-radio">
          <input type="radio" name="pp-target" disabled={!sites.length} checked={target === 'site'} onChange={() => setTarget('site')} />
          <span>A whole site</span>
        </label>
        {target === 'site' && (
          <select aria-label="Site to export" value={site} onChange={(e) => setSite((e.target as HTMLSelectElement).value)}>
            {sites.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
      </fieldset>
      <p class="pp-muted pp-small">Each exported thread includes its share link.</p>
      <div class="pp-row pp-end">
        <button class="pp-btn" onClick={onClose}>
          Cancel
        </button>
        <button class="pp-btn pp-btn-primary" disabled={busy} onClick={go}>
          {busy ? 'Exporting…' : 'Export'}
        </button>
      </div>
    </Modal>
  );
}
