/** Best-effort browser and OS detection for snapshot context (FR-4.3). */
export function detectBrowser(ua: string, brands?: { brand: string; version: string }[]): string {
  const b = brands?.find((x) => !/Not.?A.?Brand|Chromium/i.test(x.brand));
  if (b) return `${b.brand} ${b.version}`;
  const tests: [RegExp, string][] = [
    [/Edg\/([\d.]+)/, 'Edge'],
    [/OPR\/([\d.]+)/, 'Opera'],
    [/Brave\/([\d.]+)/, 'Brave'],
    [/Arc\/([\d.]+)/, 'Arc'],
    [/Chrome\/([\d.]+)/, 'Chrome'],
    [/Firefox\/([\d.]+)/, 'Firefox'],
    [/Version\/([\d.]+).*Safari/, 'Safari'],
  ];
  for (const [re, name] of tests) {
    const m = ua.match(re);
    if (m) return `${name} ${m[1].split('.')[0]}`;
  }
  return 'Unknown browser';
}

export function detectOs(ua: string, platform?: string): string {
  if (platform) return platform;
  if (/Windows NT 10/.test(ua)) return 'Windows 10/11';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X ([\d_]+)/.test(ua)) return 'macOS ' + RegExp.$1.replace(/_/g, '.');
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Android ([\d.]+)/.test(ua)) return 'Android ' + RegExp.$1;
  if (/Linux/.test(ua)) return 'Linux';
  return 'Unknown OS';
}

export function uid(prefix = ''): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return prefix + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
