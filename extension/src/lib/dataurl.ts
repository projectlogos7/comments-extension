export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const meta = dataUrl.slice(5, comma);
  const isB64 = meta.endsWith(';base64');
  const type = meta.replace(/;base64$/, '') || 'application/octet-stream';
  const data = dataUrl.slice(comma + 1);
  if (!isB64) return new Blob([decodeURIComponent(data)], { type });
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) bin += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`;
}

export function dataUrlSize(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const len = dataUrl.length - comma - 1;
  return dataUrl.slice(0, comma).endsWith(';base64') ? Math.floor((len * 3) / 4) : len;
}
