import { escapeHtml, plainText, renderBody, threadTitle, type ThreadDetail, type Page } from '@pinpoint/shared';
import { livePageUrl } from './model';

export interface ShareRender {
  kind: 'thread' | 'page';
  workspaceName: string;
  page: Page;
  threads: ThreadDetail[];
}

const fmt = (iso: string) => new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

function contextTable(t: ThreadDetail): string {
  const s = t.snapshots.find((x) => x.kind === 'viewport') ?? t.snapshots[0];
  if (!s) return '';
  const c = s.context;
  const rows: [string, string][] = [
    ['Page', `<a href="${escapeHtml(c.pageUrl)}" rel="noopener noreferrer" target="_blank">${escapeHtml(c.pageTitle || c.pageUrl)}</a>`],
    ['Captured', escapeHtml(fmt(c.capturedAt || s.capturedAt))],
    ['Viewport', `${c.viewport?.w ?? '?'} × ${c.viewport?.h ?? '?'} @${c.dpr ?? 1}x`],
    ['Browser', escapeHtml(c.browser ?? '')],
    ['OS', escapeHtml(c.os ?? '')],
    ['Scroll', `${c.scroll?.x ?? 0}, ${c.scroll?.y ?? 0}`],
  ];
  return `<dl class="ctx">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
}

export function renderThreadsHtml(v: ShareRender, opts: { extensionIds: string[] }): string {
  const items = v.threads
    .map((t) => {
      const area = t.snapshots.find((s) => s.kind === 'area');
      const viewport = t.snapshots.find((s) => s.kind === 'viewport');
      const full = t.snapshots.find((s) => s.kind === 'fullpage');
      const dom = t.snapshots.find((s) => s.kind === 'dom');
      const images = [area, viewport]
        .filter(Boolean)
        .map((s) => `<a href="${escapeHtml(s!.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(s!.url)}" alt="${s!.kind} snapshot of thread ${t.number}" loading="lazy"></a>`)
        .join('');
      const extra = [
        full ? `<a href="${escapeHtml(full.url)}" target="_blank" rel="noopener">Full-page snapshot</a>` : '',
        dom ? `<a href="${escapeHtml(dom.url)}" target="_blank" rel="noopener">DOM snapshot</a>` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      const comments = t.comments
        .map((c) =>
          c.deletedAt
            ? `<li class="c deleted"><em>Comment deleted</em></li>`
            : `<li class="c"><div class="meta"><strong>${escapeHtml(c.author.name)}</strong> <span>${escapeHtml(fmt(c.createdAt))}${c.editedAt ? ' · edited' : ''}</span></div>
               <div class="body">${renderBody(c.body)}</div>
               ${c.attachments.map((a) => `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener"><img class="att" src="${escapeHtml(a.url)}" alt="${escapeHtml(a.name)}"></a>`).join('')}
               ${c.reactions.length ? `<div class="reacts">${c.reactions.map((r) => `<span>${escapeHtml(r.emoji)} ${r.userIds.length}</span>`).join('')}</div>` : ''}</li>`,
        )
        .join('');
      const live = livePageUrl(t.page.normalizedUrl, t.id);
      const badges = [
        `<span class="b ${t.status}">${t.status}</span>`,
        `<span class="b">${t.scope}</span>`,
        t.type ? `<span class="b">${escapeHtml(t.type)}</span>` : '',
        t.priority ? `<span class="b p-${t.priority}">${t.priority}</span>` : '',
        t.detached ? '<span class="b warn">detached</span>' : '',
      ].join('');
      return `<article class="thread" id="t-${t.id}">
        <header><span class="num">#${t.number}</span><h2>${escapeHtml(threadTitle(t))}</h2><div class="badges">${badges}</div></header>
        ${images ? `<div class="snaps">${images}</div>` : ''}
        ${extra ? `<p class="extra">${extra}</p>` : ''}
        <ol class="comments">${comments}</ol>
        ${t.assignee ? `<p class="muted">Assigned to ${escapeHtml(t.assignee.name)}</p>` : ''}
        ${t.resolvedAt ? `<p class="muted">Resolved ${escapeHtml(fmt(t.resolvedAt))}</p>` : ''}
        ${contextTable(t)}
        <p class="actions"><a class="btn" href="${escapeHtml(live)}" target="_blank" rel="noopener">Open page</a>
          <button class="btn primary ext-open" hidden data-thread="${t.id}" data-url="${escapeHtml(t.page.normalizedUrl)}">Open on live page</button></p>
      </article>`;
    })
    .join('');
  return `<section class="head"><div class="ws">${escapeHtml(v.workspaceName)}</div>
    <h1>${escapeHtml(v.page.title || v.page.normalizedUrl)}</h1>
    <a class="url" href="${escapeHtml(v.page.normalizedUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(v.page.normalizedUrl)}</a>
    ${v.kind === 'page' ? `<p class="muted">${v.threads.length} thread${v.threads.length === 1 ? '' : 's'} on this page</p>` : ''}</section>
    ${items || '<p class="muted">No threads on this page.</p>'}`;
}

const CSS = `
:root{--bg:#f6f7f9;--card:#fff;--fg:#111827;--muted:#6b7280;--line:#e5e7eb;--accent:#4f46e5;--accent-fg:#fff;--chip:#eef2ff;--ok:#047857;--warn:#b45309}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#181b21;--fg:#e5e7eb;--muted:#9ca3af;--line:#2a2f38;--accent:#818cf8;--accent-fg:#0f1115;--chip:#262b45;--ok:#34d399;--warn:#fbbf24}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:900px;margin:0 auto;padding:24px 16px 64px}.brand{font-weight:700;color:var(--accent);margin-bottom:16px}
.head h1{font-size:22px;margin:4px 0}.ws{color:var(--muted);font-size:13px}.url{color:var(--muted);word-break:break-all;font-size:13px}
.thread{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin-top:20px}
.thread header{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.thread h2{font-size:17px;margin:0;flex:1;min-width:200px}
.num{background:var(--accent);color:var(--accent-fg);border-radius:999px;padding:2px 9px;font-weight:700;font-size:13px}
.badges{display:flex;gap:6px;flex-wrap:wrap}.b{background:var(--chip);border-radius:6px;padding:1px 8px;font-size:12px}
.b.resolved{color:var(--ok)}.b.warn,.b.p-high{color:var(--warn)}
.snaps{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin:16px 0}
.snaps img{width:100%;border:1px solid var(--line);border-radius:8px;display:block;background:var(--bg)}
.comments{list-style:none;padding:0;margin:12px 0}.c{padding:10px 0;border-top:1px solid var(--line)}.c:first-child{border-top:0}
.meta span{color:var(--muted);font-size:12px}.body{margin-top:4px;overflow-wrap:anywhere}.body code{background:var(--chip);padding:1px 4px;border-radius:4px}
.pp-mention{color:var(--accent);font-weight:600}.att{max-width:200px;border-radius:6px;margin-top:6px;border:1px solid var(--line)}
.reacts span{display:inline-block;background:var(--chip);border-radius:999px;padding:0 8px;margin:4px 4px 0 0;font-size:13px}
.muted,.extra{color:var(--muted);font-size:13px}.deleted{color:var(--muted)}
.ctx{display:grid;grid-template-columns:max-content 1fr;gap:2px 16px;font-size:13px;margin:12px 0;color:var(--muted)}.ctx dd{margin:0;color:var(--fg);overflow-wrap:anywhere}
.actions{display:flex;gap:8px;flex-wrap:wrap}.btn{display:inline-block;border:1px solid var(--line);background:var(--card);color:var(--fg);padding:7px 14px;border-radius:8px;text-decoration:none;font:inherit;cursor:pointer}
.btn.primary{background:var(--accent);color:var(--accent-fg);border-color:var(--accent)}
.signin{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:24px;margin-top:24px;max-width:420px}
.signin input{width:100%;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);margin:8px 0}
a{color:var(--accent)}`;

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
  const signIn = `<div class="signin" id="signin" hidden>
    <h2 style="margin-top:0;font-size:18px">Sign in to view</h2>
    <p class="muted">This link is limited to workspace members.</p>
    ${o.providers.google ? `<p><a class="btn" id="g" href="#">Continue with Google</a></p>` : ''}
    ${o.providers.microsoft ? `<p><a class="btn" id="m" href="#">Continue with Microsoft</a></p>` : ''}
    <form id="ef"><label>Email<input type="email" name="email" required placeholder="you@company.com"></label><button class="btn primary">Email me a sign-in link</button></form>
    <p id="emsg" class="muted"></p></div>`;
  const script = `
(function(){
  var token=${JSON.stringify(o.token)}, base=${JSON.stringify(o.publicUrl)}, exts=${JSON.stringify(o.extensionIds)};
  var KEY='pinpoint.auth';
  function store(v){try{localStorage.setItem(KEY,JSON.stringify(v))}catch(e){}}
  function load(){try{return JSON.parse(localStorage.getItem(KEY)||'null')}catch(e){return null}}
  var h=location.hash.slice(1); if(h.indexOf('accessToken=')>=0){var p=new URLSearchParams(h);store({accessToken:p.get('accessToken'),refreshToken:p.get('refreshToken'),expiresAt:Date.now()+Number(p.get('expiresIn')||900)*1000});history.replaceState(null,'',location.pathname+location.search);}
  function wireExt(){
    if(!exts.length||!window.chrome||!chrome.runtime||!chrome.runtime.sendMessage)return;
    exts.forEach(function(id){try{chrome.runtime.sendMessage(id,{type:'ping'},function(r){if(chrome.runtime.lastError||!r)return;
      document.querySelectorAll('.ext-open').forEach(function(b){b.hidden=false;b.onclick=function(){chrome.runtime.sendMessage(id,{type:'thread.openOnPage',threadId:b.dataset.thread,url:b.dataset.url});};});});}catch(e){}});
  }
  var content=document.getElementById('content');
  if(content.dataset.ready==='1'){wireExt();return;}
  var here=location.origin+location.pathname;
  function showSignin(){var s=document.getElementById('signin');s.hidden=false;
    var g=document.getElementById('g'),m=document.getElementById('m');
    if(g)g.href=base+'/api/v1/auth/google/start?redirect='+encodeURIComponent(here);
    if(m)m.href=base+'/api/v1/auth/microsoft/start?redirect='+encodeURIComponent(here);
    document.getElementById('ef').onsubmit=function(e){e.preventDefault();var em=e.target.email.value;
      fetch(base+'/api/v1/auth/email',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:em,redirect:here})})
      .then(function(r){document.getElementById('emsg').textContent=r.ok?'Check your inbox for a sign-in link.':'Could not send the link.';});};}
  function refresh(a){return fetch(base+'/api/v1/auth/refresh',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({refreshToken:a.refreshToken})})
    .then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(t){var v={accessToken:t.accessToken,refreshToken:t.refreshToken,expiresAt:Date.now()+t.expiresIn*1000};store(v);return v;});}
  function get(a,retry){return fetch(base+'/share/'+token+'/content',{headers:{authorization:'Bearer '+a.accessToken}}).then(function(r){
    if(r.status===401&&retry)return refresh(a).then(function(n){return get(n,false)});
    if(r.status===401||r.status===403){showSignin();return;}
    if(!r.ok){content.innerHTML='<p class="muted">This link is no longer available.</p>';return;}
    return r.text().then(function(html){content.innerHTML=html;wireExt();});});}
  var a=load(); if(!a||!a.accessToken){showSignin();return;}
  get(a,true).catch(function(){showSignin();});
})();`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(o.title)} · Pinpoint</title>
<meta name="description" content="${escapeHtml(o.description)}">
<meta name="robots" content="noindex,nofollow">
${meta}
<style>${CSS}</style></head><body><div class="wrap"><div class="brand">Pinpoint</div>
<main id="content" data-ready="${o.contentHtml ? '1' : '0'}">${o.contentHtml ?? '<p class="muted">Loading…</p>'}</main>
${o.contentHtml ? '' : signIn}
</div><script nonce="${o.nonce}">${script}</script></body></html>`;
}

export function renderNotFoundPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link unavailable · Pinpoint</title><meta name="robots" content="noindex"><style>${CSS}</style></head>
<body><div class="wrap"><div class="brand">Pinpoint</div><h1>This link is not available</h1><p class="muted">It may have been revoked, or the thread was deleted.</p></div></body></html>`;
}

export function shareDescription(t: ThreadDetail | undefined, count: number, kind: 'thread' | 'page'): string {
  if (kind === 'page') return `${count} comment thread${count === 1 ? '' : 's'} on this page`;
  const first = t?.comments.find((c) => !c.deletedAt);
  return first ? `${first.author.name}: ${plainText(first.body).slice(0, 180)}` : 'Pinpoint thread';
}
