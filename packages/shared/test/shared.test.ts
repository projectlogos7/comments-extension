import { describe, expect, it } from 'vitest';
import { normalizeUrl, urlMatches, siteAllowed, renderBody, extractMentions, can, threadsToCsv, textSimilarity } from '@pinpoint/shared';

describe('url', () => {
  it('normalizes and strips tracking params', () => {
    const n = normalizeUrl('https://WWW.Example.com:443/pricing/?utm_source=x&b=2&a=1&fbclid=z#top');
    expect(n.url).toBe('https://example.com/pricing?a=1&b=2');
    expect(n.site).toBe('example.com');
    expect(n.path).toBe('/pricing');
  });
  it('keeps hash routes', () => {
    expect(normalizeUrl('http://localhost:3000/#/settings/').path).toBe('/#/settings');
  });
  it('matches by level', () => {
    expect(urlMatches('https://a.com/x?q=1', 'exact', 'https://a.com/x?q=2')).toBe(false);
    expect(urlMatches('https://a.com/x?q=1', 'path', 'https://a.com/x?q=2')).toBe(true);
    expect(urlMatches('https://a.com/x', 'site', 'https://a.com/y')).toBe(true);
    expect(urlMatches('https://a.com/x', 'site', 'https://b.com/x')).toBe(false);
  });
  it('checks allowed sites', () => {
    expect(siteAllowed('staging.example.com', ['*.example.com'])).toBe(true);
    expect(siteAllowed('example.com', ['https://www.example.com/'])).toBe(true);
    expect(siteAllowed('evil.com', ['example.com'])).toBe(false);
    expect(siteAllowed('localhost:5173', [])).toBe(true);
    expect(siteAllowed('localhost:5173', [], false)).toBe(false);
  });
});

describe('text', () => {
  it('renders safely', () => {
    const html = renderBody('**hi** <script>x</script> @[Ana](u1) [l](javascript:alert(1)) `<b>`');
    expect(html).toContain('<strong>hi</strong>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('data-user-id="u1"');
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('<code>&lt;b&gt;</code>');
  });
  it('extracts mentions', () => {
    expect(extractMentions('hey @[Ana B](u1) and @[Bo](u2) @[Ana B](u1)')).toEqual(['u1', 'u2']);
  });
  it('similarity', () => {
    expect(textSimilarity('Pro plan billed yearly', 'Pro plan, billed yearly')).toBeGreaterThan(0.85);
  });
});

describe('permissions', () => {
  it('follows the matrix', () => {
    expect(can('member', 'deleteAny')).toBe(false);
    expect(can('admin', 'manageMembers')).toBe(true);
    expect(can('guest', 'export')).toBe(false);
    expect(can('owner', 'billing')).toBe(true);
  });
});

describe('csv', () => {
  it('escapes formulas', () => {
    const csv = threadsToCsv([{ number: 1, page: { title: '=HYPERLINK()', normalizedUrl: 'u' }, anchor: {}, firstComment: null, author: { name: 'a' } } as any], { shareUrl: () => null });
    expect(csv).toContain("'=HYPERLINK()");
  });
});
