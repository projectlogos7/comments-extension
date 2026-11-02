import type { UrlMatch } from './types';

/** Query parameters that never identify page content (FR-1.13). */
const TRACKING_PARAMS = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^dclid$/i,
  /^gbraid$/i,
  /^wbraid$/i,
  /^msclkid$/i,
  /^mc_cid$/i,
  /^mc_eid$/i,
  /^_ga$/i,
  /^_gl$/i,
  /^_hsenc$/i,
  /^_hsmi$/i,
  /^igshid$/i,
  /^yclid$/i,
  /^ref$/i,
  /^ref_src$/i,
  /^spm$/i,
  /^mkt_tok$/i,
  /^oly_(anon|enc)_id$/i,
  /^vero_(conv|id)$/i,
  /^pinpoint(_\w+)?$/i,
];

export function isTrackingParam(name: string): boolean {
  return TRACKING_PARAMS.some((r) => r.test(name));
}

export interface NormalizedUrl {
  /** Full normalized URL: origin + path + sorted non-tracking query (no hash unless it is a hash route). */
  url: string;
  /** host[:port], lowercased, without leading "www.". */
  site: string;
  /** Path without trailing slash (except root). */
  path: string;
}

/**
 * Normalize a page URL so the same page always maps to the same key:
 * lowercase host, drop "www.", default ports, trailing slash, tracking params and plain fragments.
 * Hash-routes ("#/settings", "#!/x") are kept because SPAs use them as paths.
 */
export function normalizeUrl(input: string): NormalizedUrl {
  const u = new URL(input);
  let host = u.hostname.toLowerCase().replace(/^www\./, '');
  const defaultPort = (u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443');
  if (u.port && !defaultPort) host += `:${u.port}`;
  let path = u.pathname.replace(/\/{2,}/g, '/');
  if (path.length > 1) path = path.replace(/\/+$/, '');
  try {
    path = decodeURI(path);
    path = encodeURI(path);
  } catch {
    /* keep as is */
  }
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !isTrackingParam(k))
    .sort(([a, av], [b, bv]) => (a === b ? av.localeCompare(bv) : a.localeCompare(b)));
  const qs = params.length ? '?' + new URLSearchParams(params).toString() : '';
  const hashRoute = /^#!?\//.test(u.hash) ? u.hash.replace(/\/+$/, '') : '';
  const fullPath = path + (hashRoute ? hashRoute : '');
  return {
    url: `${u.protocol}//${host}${path}${qs}${hashRoute}`,
    site: host,
    path: fullPath,
  };
}

/** Strip tracking params but keep everything else as written (for navigation links). */
export function cleanUrl(input: string): string {
  const u = new URL(input);
  for (const k of [...u.searchParams.keys()]) if (isTrackingParam(k)) u.searchParams.delete(k);
  return u.toString();
}

/** Does a thread created on `threadUrl` with match level `match` apply to `currentUrl`? */
export function urlMatches(threadUrl: string, match: UrlMatch, currentUrl: string): boolean {
  const a = normalizeUrl(threadUrl);
  const b = normalizeUrl(currentUrl);
  if (a.site !== b.site) return false;
  switch (match) {
    case 'site':
      return true;
    case 'path':
      return a.path === b.path;
    case 'exact':
    default:
      return a.url === b.url;
  }
}

/** Hosts where the extension is always allowed (development). */
export function isLocalHost(host: string): boolean {
  const h = host.replace(/:\d+$/, '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' || h.endsWith('.localhost');
}

/**
 * Normalize an allowed-site entry as typed by an admin:
 * "https://www.Example.com/foo" -> "example.com", "*.example.com" stays, "example.com:8080" stays.
 */
export function normalizeSitePattern(pattern: string): string {
  let p = pattern.trim().toLowerCase();
  if (!p) return '';
  p = p.replace(/^[a-z]+:\/\//, '');
  p = p.replace(/\/.*$/, '');
  p = p.replace(/^www\./, '');
  return p;
}

/** Is `host` (host[:port]) covered by one of the workspace's allowed-site patterns (FR-7.3)? */
export function siteAllowed(host: string, patterns: string[], allowLocalhost = true): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  if (allowLocalhost && isLocalHost(h)) return true;
  const hostNoPort = h.replace(/:\d+$/, '');
  return patterns.some((raw) => {
    const p = normalizeSitePattern(raw);
    if (!p) return false;
    const hasPort = /:\d+$/.test(p);
    const target = hasPort ? h : hostNoPort;
    if (p.startsWith('*.')) {
      const base = p.slice(2);
      return target === base || target.endsWith('.' + base);
    }
    return target === p;
  });
}

/** Chrome match patterns for an allowed-site entry (used for optional host permissions). */
export function sitePatternToMatchPatterns(pattern: string): string[] {
  const p = normalizeSitePattern(pattern);
  if (!p) return [];
  const host = p.replace(/:\d+$/, ''); // match patterns do not support ports
  if (host.startsWith('*.')) {
    return [`*://${host}/*`, `*://${host.slice(2)}/*`];
  }
  return [`*://${host}/*`, `*://www.${host}/*`];
}

export const LOCALHOST_MATCH_PATTERNS = ['http://localhost/*', 'http://127.0.0.1/*', 'http://*.localhost/*'];
