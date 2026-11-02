// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildAnchor,
  isGeneratedClass,
  isGeneratedId,
  resolveAnchor,
  sectionCandidates,
  selectorCandidates,
  xpathFor,
  evalXpath,
  describeRange,
  findTextRange,
  sectionInfo,
} from '../src/content/anchor';

function page(html: string) {
  document.body.innerHTML = html;
}

describe('generated names', () => {
  it('rejects generated classes', () => {
    for (const c of ['css-1x2y3z', 'sc-bdVaJa', 'jsx-2734823', 'Button_root__3xYz1', 'md:flex', 'w-[13px]', 'a1b2c3d4', 'x1n2onr6', 'emotion-0'])
      expect(isGeneratedClass(c), c).toBe(true);
    for (const c of ['card', 'btn-primary', 'pricing-card', 'nav__item', 'is-large', 'grid-cols-3']) expect(isGeneratedClass(c), c).toBe(false);
  });
  it('rejects generated ids', () => {
    for (const id of [':r1:', 'radix-12', 'headlessui-menu-button-3', 'ember123', '550e8400-e29b-41d4-a716-446655440000', 'item-482910'])
      expect(isGeneratedId(id), id).toBe(true);
    for (const id of ['pricing', 'main-nav', 'checkoutForm', 'step2']) expect(isGeneratedId(id), id).toBe(false);
  });
});

describe('selectors', () => {
  beforeEach(() =>
    page(`
    <main>
      <section class="hero css-abc123"><h1>Welcome</h1></section>
      <section class="plans">
        <div class="card sc-xYz12"><h3>Free</h3><button>Choose</button></div>
        <div class="card sc-xYz12" data-testid="pricing-card"><h3>Pro plan, billed yearly</h3><button aria-label="Choose Pro">Choose</button></div>
      </section>
    </main>`),
  );

  it('prefers test ids and aria labels, never generated classes', () => {
    const card = document.querySelector('[data-testid="pricing-card"]')!;
    const sels = selectorCandidates(card);
    expect(sels[0]).toBe('[data-testid="pricing-card"]');
    expect(sels.join(' ')).not.toContain('sc-xYz12');
    const btn = card.querySelector('button')!;
    expect(selectorCandidates(btn)[0]).toBe('button[aria-label="Choose Pro"]');
  });

  it('builds unique path selectors when nothing stable exists', () => {
    const free = document.querySelectorAll('.card')[0].querySelector('button')!;
    const sels = selectorCandidates(free);
    expect(sels.length).toBeGreaterThan(0);
    for (const s of sels) expect(document.querySelectorAll(s)).toHaveLength(1);
    expect(document.querySelector(sels[0])).toBe(free);
  });

  it('xpath round-trips', () => {
    const h3 = document.querySelectorAll('h3')[1];
    const xp = xpathFor(h3);
    expect(xp).toBe('/html/body/main/section[2]/div[2]/h3');
    expect(evalXpath(document, xp)).toBe(h3);
  });
});

describe('resolve', () => {
  const base = `
    <main>
      <section class="plans">
        <div class="card" data-testid="pricing-card"><h3>Pro plan, billed yearly</h3><p>$10</p></div>
        <div class="card"><h3>Team plan</h3><p>$30</p></div>
      </section>
    </main>`;

  it('finds the element by selector', () => {
    page(base);
    const el = document.querySelector('[data-testid="pricing-card"]')!;
    const a = buildAnchor({ scope: 'area', urlMatch: 'path', elements: [el] });
    expect(a.selectors?.[0]).toBe('[data-testid="pricing-card"]');
    const r = resolveAnchor(document, a);
    expect(r.state).toBe('attached');
    expect(r.elements[0]).toBe(el);
  });

  it('survives an attribute change via text and structure', () => {
    page(base);
    const el = document.querySelector('[data-testid="pricing-card"]')!;
    const a = buildAnchor({ scope: 'area', urlMatch: 'path', elements: [el] });
    page(base.replace('data-testid="pricing-card"', 'data-testid="plan-pro"'));
    const r = resolveAnchor(document, a);
    expect(r.state).toBe('attached');
    expect(r.elements[0].textContent).toContain('Pro plan');
  });

  it('survives the element moving to another place', () => {
    page(base);
    const el = document.querySelectorAll('.card')[1];
    const a = buildAnchor({ scope: 'area', urlMatch: 'path', elements: [el] });
    page(`<main><aside><div class="card"><h3>Team plan</h3><p>$30</p></div></aside><section class="plans"><div class="card"><h3>Pro plan, billed yearly</h3><p>$10</p></div></section></main>`);
    const r = resolveAnchor(document, a);
    expect(r.state).toBe('attached');
    expect(r.elements[0].textContent).toContain('Team plan');
  });

  it('survives small text tweaks', () => {
    page(base);
    const el = document.querySelector('[data-testid="pricing-card"] h3')!;
    const a = buildAnchor({ scope: 'area', urlMatch: 'path', elements: [el] });
    page(base.replace('Pro plan, billed yearly', 'Pro plan — billed yearly'));
    const r = resolveAnchor(document, a);
    expect(r.state).toBe('attached');
    expect(r.elements[0].textContent).toContain('Pro plan');
  });

  it('is detached when the element is gone', () => {
    page(base);
    const el = document.querySelector('[data-testid="pricing-card"]')!;
    const a = buildAnchor({ scope: 'area', urlMatch: 'path', elements: [el] });
    page(`<main><section><p>Completely different content now</p></section></main>`);
    const r = resolveAnchor(document, a);
    expect(r.state).toBe('detached');
  });

  it('page scope never needs an element', () => {
    page(base);
    expect(resolveAnchor(document, buildAnchor({ scope: 'page', urlMatch: 'path', elements: [] })).state).toBe('page');
  });

  it('multi-select keeps all targets', () => {
    page(base);
    const els = Array.from(document.querySelectorAll('.card'));
    const a = buildAnchor({ scope: 'area', urlMatch: 'path', elements: els });
    expect(a.targets).toHaveLength(2);
    expect(resolveAnchor(document, a).elements).toHaveLength(2);
  });
});

describe('sections', () => {
  it('detects landmarks and heading containers innermost first', () => {
    page(`<header><nav><a id="x" href="/a">A</a></nav></header>
      <main><div class="block"><h2>Features</h2><div><p id="p">Fast</p></div></div></main><footer>f</footer>`);
    const c = sectionCandidates(document.getElementById('p')!, { w: 1280, h: 800 });
    expect(c.map((e) => e.tagName.toLowerCase())).toEqual(['div', 'main']);
    expect(sectionInfo(c[0]).heading).toBe('Features');
    const n = sectionCandidates(document.getElementById('x')!, { w: 1280, h: 800 });
    expect(n.map((e) => e.tagName.toLowerCase())).toEqual(['nav', 'header']);
  });

  it('section anchors survive reordering inside', () => {
    page(`<main><section id="s1"><h2>Pricing</h2><p>a</p><p>b</p></section></main>`);
    const s = document.querySelector('section')!;
    const a = buildAnchor({ scope: 'section', urlMatch: 'path', elements: [s] });
    expect(a.section).toEqual({ landmark: 'section', heading: 'Pricing' });
    page(`<main><div></div><section><p>b</p><h2>Pricing</h2><p>a</p></section></main>`);
    const r = resolveAnchor(document, a);
    expect(r.state).toBe('attached');
    expect(r.elements[0].tagName).toBe('SECTION');
  });
});

describe('text ranges', () => {
  it('re-finds a quote with context', () => {
    page(`<p id="a">The quick brown fox jumps over the lazy dog.</p><p>Another fox appears here.</p>`);
    const t = document.getElementById('a')!.firstChild!;
    const range = document.createRange();
    range.setStart(t, 16);
    range.setEnd(t, 19);
    const ref = describeRange(range, document.body);
    expect(ref.text).toBe('fox');
    expect(ref.prefix.endsWith('brown ')).toBe(true);
    page(`<div><p>Intro added.</p><p>Another fox appears here.</p><p id="a">The quick brown fox jumps over the lazy dog.</p></div>`);
    const hit = findTextRange(document.body, ref)!;
    expect(hit).toBeTruthy();
    expect(hit.range.toString()).toBe('fox');
    expect(hit.range.startContainer.parentElement!.id).toBe('a');
  });
});
