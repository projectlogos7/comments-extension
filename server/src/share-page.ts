import { escapeHtml, plainText, renderBody, threadTitle, type ThreadDetail, type Page, type User } from '@pinpoint/shared';
import { livePageUrl } from './model';

export interface ShareRender {
  kind: 'thread' | 'page';
  workspaceName: string;
  page: Page;
  threads: ThreadDetail[];
}

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';

function initials(u: Pick<User, 'name' | 'email'> | null | undefined): string {
  const n = (u?.name || u?.email || '?').trim();
  const parts = n.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

function hue(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function avatar(u: User | null | undefined): string {
  const label = escapeHtml(u?.name || u?.email || 'Unknown');
  if (u?.avatarUrl) return `<img class="av" src="${escapeHtml(u.avatarUrl)}" alt="" title="${label}">`;
  return `<span class="av" aria-hidden="true" style="background:hsl(${hue(u?.id ?? label)} 45% 42%)">${escapeHtml(initials(u))}</span>`;
}

const SCOPE_LABEL: Record<string, string> = { area: 'Area', section: 'Section', page: 'Whole page' };
const KIND_LABEL: Record<string, string> = { area: 'Selected area', viewport: 'Visible screen', fullpage: 'Full page', dom: 'Page HTML' };

function contextTable(t: ThreadDetail): string {
  const s = t.snapshots.find((x) => x.kind === 'viewport') ?? t.snapshots[0];
  if (!s) return '';
  const c = s.context;
  const rows: [string, string][] = [
    ['Captured', escapeHtml(fmt(c.capturedAt || s.capturedAt))],
    ['Screen', `${c.viewport?.w ?? '?'} × ${c.viewport?.h ?? '?'} @${c.dpr ?? 1}x`],
    ['Browser', escapeHtml(c.browser ?? '')],
    ['OS', escapeHtml(c.os ?? '')],
    ['Scroll', `${Math.round(c.scroll?.x ?? 0)}, ${Math.round(c.scroll?.y ?? 0)}`],
  ];
  return `<details class="ctx-wrap"><summary>Capture details</summary><dl class="ctx">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></details>`;
}

export function renderThreadsHtml(v: ShareRender, opts: { extensionIds: string[]; publicUrl?: string }): string {
  const items = v.threads
    .map((t) => {
      const shots = t.snapshots.filter((s) => s.kind !== 'dom' && s.contentType.startsWith('image/'));
      const main = shots.find((s) => s.kind === 'area') ?? shots[0];
      const others = [...shots.filter((s) => s !== main), ...t.snapshots.filter((s) => s.kind === 'dom')];
      const hero = main
        ? `<a class="hero" href="${escapeHtml(main.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(main.url)}" alt="${escapeHtml(KIND_LABEL[main.kind])} snapshot of comment ${t.number}" loading="lazy"></a>`
        : '';
      const extra = others.length
        ? `<p class="extra">${others.map((s) => `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${KIND_LABEL[s.kind]}</a>`).join('<span aria-hidden="true"> · </span>')}</p>`
        : '';
      const comments = t.comments
        .map((c) =>
          c.deletedAt
            ? `<li class="c deleted">Comment deleted</li>`
            : `<li class="c">${avatar(c.author)}<div class="cb"><div class="meta"><strong>${escapeHtml(c.author.name || c.author.email)}</strong><span>${escapeHtml(fmt(c.createdAt))}${c.editedAt ? ' · edited' : ''}</span></div>
               <div class="body">${renderBody(c.body)}</div>
               ${c.attachments.length ? `<div class="atts">${c.attachments.map((a) => `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener"><img class="att" src="${escapeHtml(a.url)}" alt="${escapeHtml(a.name)}"></a>`).join('')}</div>` : ''}
               ${c.reactions.some((r) => r.userIds.length) ? `<div class="reacts">${c.reactions.filter((r) => r.userIds.length).map((r) => `<span>${escapeHtml(r.emoji)} ${r.userIds.length}</span>`).join('')}</div>` : ''}</div></li>`,
        )
        .join('');
      const live = livePageUrl(t.page.normalizedUrl, t.id);
      const reply = opts.publicUrl ? `${opts.publicUrl}/app/#/all?thread=${encodeURIComponent(t.id)}` : null;
      const badges = [
        `<span class="b ${t.status}">${t.status === 'open' ? 'Open' : 'Resolved'}</span>`,
        `<span class="b">${SCOPE_LABEL[t.scope] ?? t.scope}</span>`,
        t.type ? `<span class="b">${escapeHtml(t.type[0].toUpperCase() + t.type.slice(1))}</span>` : '',
        t.priority ? `<span class="b p-${t.priority}">${t.priority[0].toUpperCase() + t.priority.slice(1)} priority</span>` : '',
        t.detached ? '<span class="b warn" title="The element was not found on the latest version of the page">Detached</span>' : '',
      ].join('');
      const facts = [
        t.assignee ? `Assigned to <strong>${escapeHtml(t.assignee.name)}</strong>` : '',
        t.resolvedAt ? `Resolved ${escapeHtml(fmt(t.resolvedAt))}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      return `<article class="thread" id="t-${t.id}">
        <header><span class="num" aria-label="Comment ${t.number}">${t.scope === 'page' ? 'P' : t.number}</span><h2>${escapeHtml(threadTitle(t))}</h2><div class="badges">${badges}</div></header>
        ${hero}${extra}
        <ol class="comments">${comments}</ol>
        ${facts ? `<p class="muted">${facts}</p>` : ''}
        <div class="actions">
          <a class="btn primary live-open" href="${escapeHtml(live)}" target="_blank" rel="noopener" data-thread="${t.id}" data-url="${escapeHtml(t.page.normalizedUrl)}">Open on live page</a>
          ${reply ? `<a class="btn" href="${escapeHtml(reply)}">Reply in Pinpoint</a>` : ''}
        </div>
        ${contextTable(t)}
      </article>`;
    })
    .join('');
  return `<section class="head"><div class="ws">${escapeHtml(v.workspaceName)}${v.kind === 'page' ? ` · ${v.threads.length} comment${v.threads.length === 1 ? '' : 's'} on this page` : ''}</div>
    <h1>${escapeHtml(v.page.title || v.page.normalizedUrl)}</h1>
    <a class="url" href="${escapeHtml(v.page.normalizedUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(v.page.normalizedUrl)}</a></section>
    ${items || '<div class="empty">No comments on this page yet.</div>'}`;
}

const CSS = `
:root{--bg:#f6f6f9;--card:#fff;--fg:#1b1b29;--muted:#62627a;--line:#e3e3ec;--accent:#5b5bd6;--accent-strong:#4747c2;--accent-fg:#fff;--chip:#efeffb;--ok:#18794e;--ok-bg:#e6f6ee;--warn:#9a5b00;--warn-bg:#fff4e0;--shadow:0 1px 2px rgba(20,20,40,.06),0 4px 16px rgba(20,20,40,.05)}
@media (prefers-color-scheme:dark){:root{--bg:#111118;--card:#1a1a24;--fg:#ececf3;--muted:#a3a3b8;--line:#2c2c3a;--accent:#8f8ff0;--accent-strong:#a5a5f5;--accent-fg:#111118;--chip:#26263a;--ok:#4cc38a;--ok-bg:#13291f;--warn:#f1a944;--warn-bg:#2d2112;--shadow:none}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}a:focus-visible,.btn:focus-visible,summary:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.top{display:flex;align-items:center;gap:10px;max-width:880px;margin:0 auto;padding:18px 16px 0}
.brand{display:flex;align-items:center;gap:8px;font-weight:700;color:var(--fg);text-decoration:none}.logo{width:22px;height:22px;border-radius:7px;background:var(--accent);display:inline-grid;place-items:center}
.logo::after{content:"";width:8px;height:8px;border-radius:50%;background:var(--accent-fg)}
.wrap{max-width:880px;margin:0 auto;padding:16px 16px 64px}
.head{margin:8px 0 4px}.head h1{font-size:24px;line-height:1.25;margin:6px 0 4px;letter-spacing:-.01em}.ws{color:var(--muted);font-size:13px}.url{color:var(--muted);word-break:break-all;font-size:13px;text-decoration:none}.url:hover{text-decoration:underline}
.thread{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;margin-top:20px;box-shadow:var(--shadow)}
.thread header{display:flex;flex-wrap:wrap;align-items:center;gap:10px}.thread h2{font-size:17px;margin:0;flex:1;min-width:200px;line-height:1.35}
.num{background:var(--accent);color:var(--accent-fg);border-radius:999px;min-width:26px;height:26px;padding:0 8px;display:inline-grid;place-items:center;font-weight:700;font-size:13px}
.badges{display:flex;gap:6px;flex-wrap:wrap}.b{background:var(--chip);border-radius:999px;padding:2px 10px;font-size:12px;font-weight:500}
.b.resolved{color:var(--ok);background:var(--ok-bg)}.b.warn,.b.p-high{color:var(--warn);background:var(--warn-bg)}
.hero{display:block;margin:16px 0 4px;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:repeating-conic-gradient(var(--chip) 0 25%,transparent 0 50%) 0 0/16px 16px}
.hero img{display:block;max-width:100%;max-height:520px;margin:0 auto}
.extra{font-size:13px;margin:6px 0 0}.extra a{text-decoration:none}.extra a:hover{text-decoration:underline}
.comments{list-style:none;padding:0;margin:14px 0 4px}.c{display:flex;gap:10px;padding:12px 0;border-top:1px solid var(--line)}.c:first-child{border-top:0}
.av{flex:none;width:30px;height:30px;border-radius:50%;display:inline-grid;place-items:center;color:#fff;font-size:12px;font-weight:600;object-fit:cover}
.cb{min-width:0;flex:1}.meta{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}.meta span{color:var(--muted);font-size:12px}
.body{margin-top:2px;overflow-wrap:anywhere}.body code{background:var(--chip);padding:1px 5px;border-radius:5px;font-size:13px}
.pp-mention{color:var(--accent);font-weight:600;background:var(--chip);border-radius:5px;padding:0 4px}
.atts{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.att{max-width:200px;max-height:160px;border-radius:8px;border:1px solid var(--line);display:block}
.reacts{margin-top:6px}.reacts span{display:inline-block;background:var(--chip);border-radius:999px;padding:0 9px;margin-right:4px;font-size:13px}
.muted{color:var(--muted);font-size:13px}.deleted{color:var(--muted);font-style:italic;font-size:14px}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--card);color:var(--fg);padding:8px 14px;border-radius:9px;text-decoration:none;font:inherit;font-weight:500;cursor:pointer}
.btn:hover{border-color:var(--accent)}.btn.primary{background:var(--accent);color:var(--accent-fg);border-color:var(--accent)}.btn.primary:hover{background:var(--accent-strong)}.btn.block{width:100%;justify-content:center}
.ctx-wrap{margin-top:14px;font-size:13px}.ctx-wrap summary{cursor:pointer;color:var(--muted)}
.ctx{display:grid;grid-template-columns:max-content 1fr;gap:2px 16px;margin:8px 0 0;color:var(--muted)}.ctx dd{margin:0;color:var(--fg);overflow-wrap:anywhere}
.panel{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px;margin:48px auto 0;max-width:420px;box-shadow:var(--shadow);text-align:center}
.panel h1{font-size:20px;margin:0 0 6px}.panel p{color:var(--muted);margin:0 0 18px}.panel .stack{display:grid;gap:10px;text-align:left}
.panel input{width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--fg);font:inherit}
.or{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:12px;margin:6px 0}.or::before,.or::after{content:"";flex:1;height:1px;background:var(--line)}
.empty{color:var(--muted);text-align:center;padding:40px 0}.loading{color:var(--muted);padding:40px 0;text-align:center}
@media (prefers-reduced-motion:no-preference){.btn{transition:background .15s,border-color .15s}}`;

export interface SharePageOpts {
  nonce: string;
  title: string;
  description: string;
  ogImage: string | null;
  url: string;
  publicUrl: string;
  extensionIds: string[];
  /** Pre-rendered content (anonymous links). When null, content is fetched client-side with the stored session. */
  contentHtml: string | null;
  token: string;
  providers: { google: boolean; microsoft: boolean };
}

function topBar(publicUrl: string) {
  return `<div class="top"><a class="brand" href="${escapeHtml(publicUrl)}/app/"><span class="logo" aria-hidden="true"></span>Pinpoint</a></div>`;
}

export function renderSharePage(o: SharePageOpts): string {
  const meta = [
    `<meta property="og:type" content="article">`,
    `<meta property="og:site_name" content="Pinpoint">`,
    `<meta property="og:title" content="${escapeHtml(o.title)}">`,
    `<meta property="og:description" content="${escapeHtml(o.description)}">`,
    `<meta property="og:url" content="${escapeHtml(o.url)}">`,
    o.ogImage ? `<meta property="og:image" content="${escapeHtml(o.ogImage)}">` : '',
    `<meta name="twitter:card" content="${o.ogImage ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${escapeHtml(o.title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(o.description)}">`,
    o.ogImage ? `<meta name="twitter:image" content="${escapeHtml(o.ogImage)}">` : '',
  ].join('\n');
  const signIn = `<div class="panel" id="signin" hidden>
    <h1 id="si-title">Sign in to view</h1>
    <p id="si-text">This link is only for members of the workspace.</p>
    <div class="stack">
      <a class="btn primary block" id="app-login" href="#">Sign in to Pinpoint</a>
      ${o.providers.google ? `<a class="btn block" id="g" href="#">Continue with Google</a>` : ''}
      ${o.providers.microsoft ? `<a class="btn block" id="m" href="#">Continue with Microsoft</a>` : ''}
      <div class="or">or get a sign-in link</div>
      <form id="ef" class="stack"><input type="email" name="email" required placeholder="you@company.com" aria-label="Email"><button class="btn block">Email me a link</button></form>
      <p id="emsg" class="muted" role="status" style="margin:0;text-align:center"></p>
    </div></div>`;
  const script = `
(function(){
  var token=${JSON.stringify(o.token)}, base=${JSON.stringify(o.publicUrl)}, exts=${JSON.stringify(o.extensionIds)};
  var KEY='pinpoint.auth';
  function store(v){try{localStorage.setItem(KEY,JSON.stringify(v))}catch(e){}}
  function load(){try{return JSON.parse(localStorage.getItem(KEY)||'null')}catch(e){return null}}
  var h=location.hash.slice(1); if(h.indexOf('accessToken=')>=0){var p=new URLSearchParams(h);store({accessToken:p.get('accessToken'),refreshToken:p.get('refreshToken'),expiresIn:Number(p.get('expiresIn')||900),expiresAt:Date.now()+Number(p.get('expiresIn')||900)*1000});history.replaceState(null,'',location.pathname+location.search);}
  function wireExt(){
    if(!exts.length||!window.chrome||!chrome.runtime||!chrome.runtime.sendMessage)return;
    exts.forEach(function(id){try{chrome.runtime.sendMessage(id,{type:'ping'},function(r){if(chrome.runtime.lastError||!r)return;
      document.querySelectorAll('.live-open').forEach(function(b){b.onclick=function(e){e.preventDefault();chrome.runtime.sendMessage(id,{type:'thread.openOnPage',threadId:b.dataset.thread,url:b.dataset.url});};});});}catch(e){}});
  }
  var content=document.getElementById('content');
  if(content.dataset.ready==='1'){wireExt();return;}
  var here=location.origin+location.pathname;
  function showSignin(forbidden){var s=document.getElementById('signin');s.hidden=false;content.innerHTML='';
    if(forbidden){document.getElementById('si-title').textContent='You don\\u2019t have access';
      document.getElementById('si-text').textContent='You\\u2019re signed in, but not as a member of the workspace that shared this link. Sign in with another account, or ask the person who sent it to invite you.';}
    var al=document.getElementById('app-login'); al.href=base+'/app/#/login?next='+encodeURIComponent(location.pathname);
    var g=document.getElementById('g'),m=document.getElementById('m');
    if(g)g.href=base+'/api/v1/auth/google/start?redirect='+encodeURIComponent(here);
    if(m)m.href=base+'/api/v1/auth/microsoft/start?redirect='+encodeURIComponent(here);
    document.getElementById('ef').onsubmit=function(e){e.preventDefault();var em=e.target.email.value;
      fetch(base+'/api/v1/auth/email',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:em,redirect:here})})
      .then(function(r){return r.json().catch(function(){return {}}).then(function(j){
        var msg=document.getElementById('emsg');
        if(!r.ok){msg.textContent=(j.error&&j.error.message)||'Could not send the link. Try again in a moment.';return;}
        if(j.devLink){msg.innerHTML='';var a=document.createElement('a');a.href=j.devLink;a.textContent='Development: open the sign-in link';msg.appendChild(a);}
        else msg.textContent='Check your inbox for a sign-in link.';});});};}
  function refresh(a){return fetch(base+'/api/v1/auth/refresh',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({refreshToken:a.refreshToken})})
    .then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(t){var v={accessToken:t.accessToken,refreshToken:t.refreshToken,expiresIn:t.expiresIn,expiresAt:Date.now()+t.expiresIn*1000};store(v);return v;});}
  function get(a,retry){return fetch(base+'/share/'+token+'/content',{headers:{authorization:'Bearer '+a.accessToken}}).then(function(r){
    if(r.status===401&&retry)return refresh(a).then(function(n){return get(n,false)},function(){showSignin(false)});
    if(r.status===401){showSignin(false);return;}
    if(r.status===403){showSignin(true);return;}
    if(!r.ok){content.innerHTML='<div class="panel"><h1>This link isn\\u2019t available</h1><p>It may have been revoked, or the comment was deleted.</p></div>';return;}
    return r.text().then(function(html){content.innerHTML=html;wireExt();});});}
  var a=load(); if(!a||!a.accessToken){showSignin(false);return;}
  get(a,true).catch(function(){showSignin(false);});
})();`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(o.title)} · Pinpoint</title>
<meta name="description" content="${escapeHtml(o.description)}">
<meta name="robots" content="noindex,nofollow">
${meta}
<style>${CSS}</style></head><body>${topBar(o.publicUrl)}<div class="wrap">
<main id="content" data-ready="${o.contentHtml ? '1' : '0'}">${o.contentHtml ?? '<div class="loading" role="status">Loading…</div>'}</main>
${o.contentHtml ? '' : signIn}
</div><script nonce="${o.nonce}">${script}</script></body></html>`;
}

export function renderNotFoundPage(reason: 'revoked' | 'missing' = 'missing', publicUrl = ''): string {
  const [title, text] =
    reason === 'revoked'
      ? ['This link was turned off', 'Whoever shared it has revoked access. Ask them for a new link if you still need it.']
      : ['This link isn’t available', 'It may have been revoked, or the comment was deleted.'];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link unavailable · Pinpoint</title><meta name="robots" content="noindex"><style>${CSS}</style></head>
<body>${topBar(publicUrl)}<div class="wrap"><div class="panel"><h1>${title}</h1><p>${text}</p><a class="btn" href="${escapeHtml(publicUrl)}/app/">Go to Pinpoint</a></div></div></body></html>`;
}

export function shareDescription(t: ThreadDetail | undefined, count: number, kind: 'thread' | 'page'): string {
  if (kind === 'page') return `${count} comment thread${count === 1 ? '' : 's'} on this page`;
  const first = t?.comments.find((c) => !c.deletedAt);
  return first ? `${first.author.name}: ${plainText(first.body).slice(0, 180)}` : 'Pinpoint thread';
}
