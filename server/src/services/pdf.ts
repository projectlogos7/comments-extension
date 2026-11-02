import PDFDocument from 'pdfkit';
import { bestSelector, componentLabel, groupByPage, plainText, threadTitle, type ThreadDetail } from '@pinpoint/shared';

export interface PdfInput {
  title: string;
  workspaceName: string;
  threads: ThreadDetail[];
  linkFor: (t: ThreadDetail) => string;
  /** Load image bytes for a snapshot id (area snapshot). */
  image: (snapshotId: string) => Promise<Buffer | null>;
}

/** PDF report grouped by page with snapshots (FR-6.4). */
export async function renderPdf(input: PdfInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: input.title, Creator: 'Pinpoint' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const width = doc.page.width - 96;
  const accent = '#4f46e5';
  const muted = '#6b7280';

  doc.fillColor(accent).fontSize(10).text('PINPOINT REPORT');
  doc.moveDown(0.3).fillColor('#111827').fontSize(22).text(input.title);
  doc
    .moveDown(0.3)
    .fillColor(muted)
    .fontSize(10)
    .text(`${input.workspaceName} · ${input.threads.length} thread${input.threads.length === 1 ? '' : 's'} · generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`);
  const open = input.threads.filter((t) => t.status === 'open').length;
  doc.text(`${open} open · ${input.threads.length - open} resolved`);

  for (const [, group] of groupByPage(input.threads)) {
    const page = group[0].page;
    doc.addPage();
    doc.fillColor('#111827').fontSize(16).text(page.title || page.normalizedUrl, { width });
    doc.fillColor(accent).fontSize(9).text(page.normalizedUrl, { width, link: page.normalizedUrl });
    doc.moveDown(0.8);
    for (const t of group) {
      if (doc.y > doc.page.height - 200) doc.addPage();
      doc.fillColor('#111827').fontSize(13).text(`#${t.number}  ${threadTitle(t)}`, { width });
      const meta = [t.status, t.scope, t.type, t.priority, t.assignee ? `assigned to ${t.assignee.name}` : null, t.detached ? 'detached' : null]
        .filter(Boolean)
        .join(' · ');
      doc.fillColor(muted).fontSize(9).text(meta, { width });
      const sel = bestSelector(t.anchor);
      if (sel) doc.font('Courier').text(sel.slice(0, 200), { width }).font('Helvetica');
      const comp = componentLabel(t.anchor);
      if (comp) doc.text(comp, { width });
      doc.moveDown(0.4);
      const snap = t.snapshots.find((s) => s.kind === 'area' && s.contentType.startsWith('image/')) ?? t.snapshots.find((s) => s.kind === 'viewport');
      if (snap && /png|jpeg/.test(snap.contentType)) {
        const buf = await input.image(snap.id).catch(() => null);
        if (buf) {
          const maxH = 260;
          if (doc.y + maxH > doc.page.height - 60) doc.addPage();
          try {
            const y = doc.y;
            doc.image(buf, doc.page.margins.left, y, { fit: [width, maxH] });
            const ratio = snap.width && snap.height ? Math.min(width / snap.width, maxH / snap.height) : 1;
            doc.y = y + (snap.height ? Math.min(snap.height * ratio, maxH) : maxH) + 8;
          } catch {
            /* unsupported image */
          }
        }
      }
      for (const c of t.comments) {
        if (c.deletedAt) continue;
        if (doc.y > doc.page.height - 80) doc.addPage();
        doc.fillColor('#111827').fontSize(10).font('Helvetica-Bold').text(`${c.author.name}  `, { continued: true, width });
        doc.font('Helvetica').fillColor(muted).fontSize(8).text(c.createdAt.slice(0, 16).replace('T', ' '));
        doc.fillColor('#111827').fontSize(10).text(plainText(c.body), { width });
        doc.moveDown(0.3);
      }
      doc.fillColor(accent).fontSize(9).text('Open thread', { link: input.linkFor(t), underline: true });
      doc.moveDown(0.6);
      doc.strokeColor('#e5e7eb').moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
      doc.moveDown(0.8);
    }
  }
  doc.end();
  return done;
}
