import { useEffect, useState } from 'preact/hooks';

export interface Route {
  /** Path segments after "#/", e.g. ["thread", "abc"]. */
  parts: string[];
  path: string;
  query: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [path, q = ''] = raw.split('?');
  const clean = path.replace(/\/+$/, '');
  return { parts: clean ? clean.split('/').map(decodeURIComponent) : [], path: '/' + clean, query: new URLSearchParams(q) };
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(typeof location !== 'undefined' ? location.hash : ''));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function navigate(route: string) {
  const h = route.startsWith('#') ? route : `#${route.startsWith('/') ? route : '/' + route}`;
  if (location.hash !== h) location.hash = h;
}
