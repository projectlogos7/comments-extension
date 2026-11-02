// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { normalizeUrl } from '@pinpoint/shared';
import { takeThreadParam, withThreadParam } from '../src/lib/thread-param';
import { dataUrlToBlob, blobToDataUrl } from '../src/lib/dataurl';
import { domSnapshot } from '../src/content/dom-snapshot';
import { buildAnchor, resolveAnchor } from '../src/content/anchor';

describe('pinpoint_thread param', () => {
  it('adds and removes the parameter without touching the rest', () => {
    const url = withThreadParam('https://app.example.com/pricing?plan=pro#faq', 't_123');
    expect(url).toContain('pinpoint_thread=t_123');
    const taken = takeThreadParam(url)!;
    expect(taken.threadId).toBe('t_123');
    expect(taken.cleanUrl).toBe('https://app.example.com/pricing?plan=pro#faq');
  });
  it('rejects malformed ids and keeps page identity', () => {
    expect(takeThreadParam('https://a.com/?pinpoint_thread=<script>')).toBeNull();
    expect(takeThreadParam('https://a.com/')).toBeNull();
    expect(normalizeUrl(withThreadParam('https://a.com/x?b=1', 'abc')).url).toBe(normalizeUrl('https://a.com/x?b=1').url);
  });
});

describe('data urls', () => {
  it('round-trips', async () => {
    const b = new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'image/png' });
    const d = await blobToDataUrl(b);
    expect(d.startsWith('data:image/png;base64,')).toBe(true);
    const back = new Uint8Array(await dataUrlToBlob(d).arrayBuffer());
    expect([...back]).toEqual([1, 2, 3, 250]);
  });
});

describe('dom snapshot', () => {
  it('sanitizes scripts, handlers, values and javascript urls', () => {
    document.body.innerHTML = `<div id="x" onclick="evil()"><script>evil()</script><a href="javascript:alert(1)">a</a><input value="secret"><p>keep</p></div>`;
    const html = domSnapshot(document.getElementById('x')!);
    expect(html).not.toContain('evil()');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('secret');
    expect(html).toContain('<p');
    expect(html).toContain('keep');
  });
});

describe('free rectangles and frames', () => {
  it('stores a free rect relative to its container', () => {
    document.body.innerHTML = `<main><div id="box" data-testid="box">content here</div></main>`;
    const el = document.getElementById('box')!;
    const a = buildAnchor({ scope: 'area', urlMatch: 'exact', elements: [el], freeRect: { x: 10, y: 20, w: 50, h: 40 } });
    expect(a.freeRect).toBe(true);
    expect(a.rect).toMatchObject({ w: 50, h: 40 });
    expect(a.urlMatch).toBe('exact');
    expect(resolveAnchor(document, a).state).toBe('attached');
  });
  it('anchors inside open shadow roots', () => {
    document.body.innerHTML = `<my-widget id="w"></my-widget>`;
    const host = document.getElementById('w')!;
    const sr = host.attachShadow({ mode: 'open' });
    sr.innerHTML = `<button data-testid="buy">Buy now</button>`;
    const btn = sr.querySelector('button')!;
    const a = buildAnchor({ scope: 'area', urlMatch: 'path', elements: [btn] });
    expect(a.shadowHosts).toEqual(['#w']);
    expect(a.jsPath).toBe('document.querySelector("#w").shadowRoot.querySelector("[data-testid=\\"buy\\"]")');
    const r = resolveAnchor(document, a);
    expect(r.state).toBe('attached');
    expect(r.elements[0]).toBe(btn);
  });
});
