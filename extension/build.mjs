// Build the Pinpoint extension into extension/dist.
//   node extension/build.mjs            one-off production build
//   node extension/build.mjs --watch    rebuild on change
//   node extension/build.mjs --zip      build, then write extension/pinpoint-extension.zip for store upload
// Env: PINPOINT_SERVER_ORIGINS (comma separated, default http://localhost:8787) — server origins
// allowed to talk to the extension (externally_connectable) and pre-granted host access.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const dist = path.join(here, 'dist');
const args = new Set(process.argv.slice(2));
const watch = args.has('--watch');
const pkg = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));

const serverOrigins = (process.env.PINPOINT_SERVER_ORIGINS || 'http://localhost:8787')
  .split(',')
  .map((s) => s.trim().replace(/\/\*?$/, ''))
  .filter(Boolean);

/** Chrome match patterns: no ports, path wildcard. */
function toPattern(origin) {
  const u = new URL(origin);
  return `${u.protocol}//${u.hostname}/*`;
}

function manifest() {
  const serverPatterns = [...new Set(serverOrigins.map(toPattern))];
  return {
    manifest_version: 3,
    name: 'Pinpoint',
    short_name: 'Pinpoint',
    description: 'Select any part of a web page, comment on it, mention a teammate, and keep every comment in one shared place.',
    version: pkg.version.replace(/[^\d.]/g, ''),
    minimum_chrome_version: '116',
    icons: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
    action: {
      default_title: 'Pinpoint',
      default_popup: 'popup.html',
      default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png' },
    },
    background: { service_worker: 'background.js', type: 'module' },
    permissions: ['storage', 'unlimitedStorage', 'activeTab', 'scripting', 'sidePanel', 'contextMenus', 'alarms', 'notifications', 'identity', 'tabs', 'downloads'],
    host_permissions: [...new Set(['http://localhost/*', 'http://127.0.0.1/*', ...serverPatterns])],
    optional_host_permissions: ['<all_urls>'],
    side_panel: { default_path: 'sidepanel.html' },
    options_page: 'app.html',
    commands: {
      'toggle-comment-mode': {
        suggested_key: { default: 'Alt+Shift+C', mac: 'Alt+Shift+C' },
        description: 'Start or stop comment mode',
      },
    },
    web_accessible_resources: [{ resources: ['sidepanel.html', 'sidepanel.js', 'sidepanel.css', 'icons/*'], matches: ['<all_urls>'] }],
    externally_connectable: { matches: serverPatterns },
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
  };
}

// ---------------------------------------------------------------- icons (tiny PNG encoder)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/** A map-pin glyph: accent teardrop with a white dot, anti-aliased by supersampling. */
function pinIcon(size) {
  const SS = 4;
  const inside = (u, v) => {
    // u,v in [0,1]; circle head + triangle tail.
    const cx = 0.5, cy = 0.4, r = 0.34;
    const d = Math.hypot(u - cx, v - cy);
    const head = d <= r;
    const tail = v >= cy && v <= 0.95 && Math.abs(u - cx) <= (0.95 - v) * (r / (0.95 - cy)) * 0.98;
    if (!(head || tail)) return 0;
    return d <= r * 0.42 ? 2 : 1;
  };
  return png(size, (x, y) => {
    let acc = 0, white = 0;
    for (let i = 0; i < SS; i++)
      for (let j = 0; j < SS; j++) {
        const v = inside((x + (i + 0.5) / SS) / size, (y + (j + 0.5) / SS) / size);
        if (v) acc++;
        if (v === 2) white++;
      }
    const a = acc / (SS * SS);
    if (!a) return [0, 0, 0, 0];
    const w = white / acc;
    const mix = (c, t) => Math.round(c * (1 - t) + 255 * t);
    return [mix(0x5b, w), mix(0x5b, w), mix(0xd6, w), Math.round(a * 255)];
  });
}

// ---------------------------------------------------------------- zip writer (store + deflate)
function zipDir(dir, out) {
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (!e.name.endsWith('.map')) files.push(p);
    }
  };
  walk(dir);
  const locals = [];
  const centrals = [];
  let offset = 0;
  const dosTime = 0, dosDate = (2026 - 1980) << 9 | (1 << 5) | 1;
  for (const f of files.sort()) {
    const name = Buffer.from(path.relative(dir, f).split(path.sep).join('/'));
    const data = fs.readFileSync(f);
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(dosTime, 10);
    lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(dosTime, 12);
    ch.writeUInt16LE(dosDate, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  fs.writeFileSync(out, Buffer.concat([...locals, cd, end]));
  return files.length;
}

// ---------------------------------------------------------------- build
function writeStatic() {
  fs.mkdirSync(path.join(dist, 'icons'), { recursive: true });
  for (const s of [16, 32, 48, 128]) fs.writeFileSync(path.join(dist, 'icons', `icon-${s}.png`), pinIcon(s));
  fs.writeFileSync(path.join(dist, 'manifest.json'), JSON.stringify(manifest(), null, 2));
  const staticDir = path.join(here, 'static');
  if (fs.existsSync(staticDir)) fs.cpSync(staticDir, dist, { recursive: true });
  for (const rel of ['src/sidepanel/sidepanel.html', 'src/app/app.html']) {
    const p = path.join(here, rel);
    if (fs.existsSync(p)) fs.copyFileSync(p, path.join(dist, path.basename(p)));
  }
}

// Resolve workspace packages to their TypeScript sources, including subpaths (@pinpoint/ui/styles.css).
const workspacePackages = {
  name: 'pinpoint-workspace',
  setup(b) {
    b.onResolve({ filter: /^@pinpoint\/(shared|ui)(\/.*)?$/ }, (a) => {
      const m = a.path.match(/^@pinpoint\/(shared|ui)(\/.*)?$/);
      const base = path.join(root, 'packages', m[1], 'src');
      if (!m[2]) return { path: path.join(base, 'index.ts') };
      const sub = path.join(base, m[2]);
      for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) if (fs.existsSync(sub + ext) && fs.statSync(sub + ext).isFile()) return { path: sub + ext };
      return { path: sub };
    });
  },
};
const common = {
  bundle: true,
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  target: ['chrome116'],
  jsx: 'automatic',
  jsxImportSource: 'preact',
  plugins: [workspacePackages],
  logLevel: 'info',
  legalComments: 'none',
  charset: 'ascii',
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production'), __PINPOINT_VERSION__: JSON.stringify(pkg.version) },
  loader: { '.png': 'dataurl', '.svg': 'text' },
};

const optional = (rel) => (fs.existsSync(path.join(here, rel)) ? [rel] : []);
const configs = [
  { entryPoints: { background: 'src/background/index.ts' }, format: 'esm' },
  { entryPoints: { content: 'src/content/index.ts' }, format: 'iife' },
  { entryPoints: { pageworld: 'src/pageworld/index.ts' }, format: 'iife' },
  { entryPoints: { popup: 'src/popup/index.tsx' }, format: 'esm' },
  ...optional('src/sidepanel/index.tsx').map((e) => ({ entryPoints: { sidepanel: e }, format: 'esm' })),
  ...optional('src/app/index.tsx').map((e) => ({ entryPoints: { app: e }, format: 'esm' })),
].map((c) => ({ ...common, ...c, absWorkingDir: here, outdir: dist }));

if (!watch) fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
writeStatic();

if (watch) {
  for (const c of configs) (await esbuild.context(c)).watch();
  fs.watch(path.join(here, 'static'), { recursive: true }, () => writeStatic());
  console.log('[pinpoint] watching…');
} else {
  const results = await Promise.allSettled(configs.map((c) => esbuild.build(c)));
  const failed = results.map((r, i) => (r.status === 'rejected' ? Object.keys(configs[i].entryPoints)[0] : null)).filter(Boolean);
  if (failed.length) {
    console.error(`[pinpoint] failed entries: ${failed.join(', ')}`);
    process.exitCode = 1;
  }
  const sizes = fs.readdirSync(dist).filter((f) => f.endsWith('.js')).map((f) => {
    const buf = fs.readFileSync(path.join(dist, f));
    return `${f} ${(buf.length / 1024).toFixed(1)} KB (${(zlib.gzipSync(buf).length / 1024).toFixed(1)} KB gz)`;
  });
  console.log('[pinpoint] built:\n  ' + sizes.join('\n  '));
  const content = !fs.existsSync(path.join(dist, 'content.js')) ? 0 : zlib.gzipSync(fs.readFileSync(path.join(dist, 'content.js'))).length;
  if (content > 250 * 1024) {
    console.error(`content.js is ${(content / 1024).toFixed(0)} KB compressed — over the 250 KB budget`);
    process.exitCode = 1;
  }
  if (args.has('--zip')) {
    const out = path.join(here, 'pinpoint-extension.zip');
    const n = zipDir(dist, out);
    console.log(`[pinpoint] wrote ${path.relative(root, out)} (${n} files)`);
  }
}
