// All in-page UI styles. They live inside our shadow root, so site CSS cannot reach them and
// they cannot leak into the site (FR-1.14).
export const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.pp, .pp * { font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
.pp {
  --pp-accent: #5B5BD6; --pp-accent-ink: #ffffff; --pp-accent-soft: rgba(91,91,214,.14);
  --pp-bg: #ffffff; --pp-bg2: #f6f6f8; --pp-fg: #1c1c22; --pp-muted: #5f5f6e; --pp-border: #dcdce3;
  --pp-ok: #1f7a4d; --pp-warn: #a35200; --pp-danger: #c62a2f; --pp-shadow: 0 8px 30px rgba(20,20,40,.18), 0 1px 3px rgba(20,20,40,.12);
  --pp-radius: 8px;
  color: var(--pp-fg); font-size: 13px; line-height: 1.45; -webkit-font-smoothing: antialiased;
}
@media (prefers-color-scheme: dark) {
  .pp { --pp-bg: #1d1d23; --pp-bg2: #26262e; --pp-fg: #ececf1; --pp-muted: #a5a5b4; --pp-border: #3a3a45; --pp-accent: #8b8bf0; --pp-accent-ink: #12121a; --pp-accent-soft: rgba(139,139,240,.18); --pp-ok: #5fd69a; --pp-warn: #f0a050; --pp-danger: #ff7b7f; --pp-shadow: 0 8px 30px rgba(0,0,0,.5); }
}
.layer { position: fixed; inset: 0; pointer-events: none; }
.overlay { position: fixed; inset: 0; pointer-events: auto; cursor: crosshair; background: rgba(15,15,30,.08); }
.overlay.hidden { display: none; }
.hl { position: fixed; pointer-events: none; border: 2px solid var(--pp-accent); background: var(--pp-accent-soft); border-radius: 3px; transition: all 60ms linear; }
.hl.multi { border-style: solid; background: rgba(91,91,214,.2); }
.hl.section { border-style: dashed; background: rgba(91,91,214,.06); }
.hl.drag { border-style: dashed; background: rgba(91,91,214,.12); }
.hl.pulse { animation: pp-pulse 1.2s ease-out 2; border-width: 3px; }
@keyframes pp-pulse { 0% { box-shadow: 0 0 0 0 rgba(91,91,214,.6); } 100% { box-shadow: 0 0 0 14px rgba(91,91,214,0); } }
.hl-label { position: fixed; pointer-events: none; background: var(--pp-accent); color: #fff; font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 4px 6px; border-radius: 4px; white-space: nowrap; max-width: 60vw; overflow: hidden; text-overflow: ellipsis; }
.mode-bar { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); pointer-events: auto; background: var(--pp-fg); color: var(--pp-bg); border-radius: 999px; padding: 8px 14px; display: flex; gap: 12px; align-items: center; box-shadow: var(--pp-shadow); font-size: 12px; }
.mode-bar kbd { font: 600 11px ui-monospace, monospace; background: rgba(127,127,127,.3); border-radius: 4px; padding: 1px 5px; }
.mode-bar button { all: unset; cursor: pointer; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: rgba(127,127,127,.25); }
.mode-bar button:focus-visible { outline: 2px solid var(--pp-accent); outline-offset: 2px; }

.pin { position: fixed; pointer-events: auto; width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 13px 13px 13px 3px; background: var(--pp-accent); color: var(--pp-accent-ink); border: 2px solid #fff; box-shadow: 0 2px 6px rgba(0,0,0,.3); font: 700 12px/22px system-ui, sans-serif; text-align: center; cursor: pointer; padding: 0; transition: transform 120ms; }
.pin:hover, .pin:focus-visible { transform: scale(1.12); outline: none; box-shadow: 0 0 0 3px var(--pp-accent-soft), 0 2px 6px rgba(0,0,0,.3); }
.pin.resolved { background: #6b7280; color: #fff; opacity: .8; }
.pin.unread::after { content: ""; position: absolute; top: -3px; right: -3px; width: 9px; height: 9px; border-radius: 50%; background: #e5484d; border: 2px solid #fff; }
.pin-outline { position: fixed; pointer-events: none; border: 1.5px dashed var(--pp-accent); border-radius: 4px; opacity: .55; }
.pin-outline.area { border-style: solid; opacity: 0; }
.pin-outline.show { opacity: .9; }
.pins.hidden { display: none; }

.card, .composer, .modal-inner, .menu, .toast, .sel-btn { pointer-events: auto; background: var(--pp-bg); color: var(--pp-fg); border: 1px solid var(--pp-border); border-radius: var(--pp-radius); box-shadow: var(--pp-shadow); }
.composer, .card { position: fixed; width: 340px; max-height: min(560px, calc(100vh - 24px)); display: flex; flex-direction: column; overflow: hidden; }
.card { width: 360px; }
.hdr { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--pp-border); }
.hdr .title { font-weight: 650; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.body { padding: 10px 12px; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
.ftr { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--pp-border); background: var(--pp-bg2); }
.grow { flex: 1; }
.muted { color: var(--pp-muted); font-size: 12px; }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.seg { display: inline-flex; border: 1px solid var(--pp-border); border-radius: 6px; overflow: hidden; }
.seg button { all: unset; cursor: pointer; padding: 4px 10px; font-size: 12px; font-weight: 550; color: var(--pp-muted); }
.seg button[aria-pressed="true"] { background: var(--pp-accent); color: var(--pp-accent-ink); }
.seg button:focus-visible { outline: 2px solid var(--pp-accent); outline-offset: -2px; }
button.btn { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 30px; padding: 0 12px; border-radius: 6px; font-weight: 600; font-size: 12.5px; border: 1px solid var(--pp-border); background: var(--pp-bg); color: var(--pp-fg); }
button.btn:hover { background: var(--pp-bg2); }
button.btn.primary { background: var(--pp-accent); border-color: var(--pp-accent); color: var(--pp-accent-ink); }
button.btn.primary:hover { filter: brightness(1.07); }
button.btn.danger { color: var(--pp-danger); }
button.btn[disabled] { opacity: .5; cursor: default; }
button.btn.sm { height: 24px; padding: 0 8px; font-size: 12px; }
button.icon { all: unset; cursor: pointer; width: 26px; height: 26px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; color: var(--pp-muted); font-size: 14px; }
button.icon:hover { background: var(--pp-bg2); color: var(--pp-fg); }
button:focus-visible, button.btn:focus-visible, button.icon:focus-visible, select:focus-visible, textarea:focus-visible, input:focus-visible { outline: 2px solid var(--pp-accent); outline-offset: 2px; }
textarea, select, input[type="text"], input[type="url"] { font: inherit; color: var(--pp-fg); background: var(--pp-bg); border: 1px solid var(--pp-border); border-radius: 6px; padding: 7px 9px; }
textarea { width: 100%; min-height: 84px; resize: vertical; line-height: 1.45; }
select { height: 28px; padding: 2px 6px; font-size: 12px; }
label.chk { display: inline-flex; gap: 6px; align-items: center; font-size: 12px; color: var(--pp-fg); cursor: pointer; }
label.chk input { accent-color: var(--pp-accent); margin: 0; }
.fmt { display: flex; gap: 2px; }
.fmt button { all: unset; cursor: pointer; width: 26px; height: 24px; text-align: center; border-radius: 4px; color: var(--pp-muted); font-size: 12px; }
.fmt button:hover { background: var(--pp-bg2); color: var(--pp-fg); }
.fmt button:focus-visible { outline: 2px solid var(--pp-accent); }
.picker { position: absolute; left: 12px; right: 12px; z-index: 2; max-height: 180px; overflow: auto; background: var(--pp-bg); border: 1px solid var(--pp-border); border-radius: 6px; box-shadow: var(--pp-shadow); padding: 4px; }
.picker [role="option"] { display: flex; gap: 8px; align-items: center; padding: 6px 8px; border-radius: 4px; cursor: pointer; }
.picker [role="option"][aria-selected="true"] { background: var(--pp-accent-soft); }
.avatar { width: 22px; height: 22px; border-radius: 50%; background: var(--pp-accent-soft); color: var(--pp-accent); font-weight: 700; font-size: 11px; display: inline-flex; align-items: center; justify-content: center; flex: none; overflow: hidden; }
.avatar img { width: 100%; height: 100%; object-fit: cover; }
.atts { display: flex; gap: 6px; flex-wrap: wrap; }
.att { position: relative; width: 56px; height: 56px; border-radius: 6px; overflow: hidden; border: 1px solid var(--pp-border); }
.att img { width: 100%; height: 100%; object-fit: cover; }
.att button { position: absolute; top: 2px; right: 2px; all: unset; cursor: pointer; background: rgba(0,0,0,.6); color: #fff; width: 16px; height: 16px; border-radius: 50%; font-size: 11px; text-align: center; line-height: 16px; }
.thumb { width: 100%; border-radius: 6px; border: 1px solid var(--pp-border); display: block; max-height: 140px; object-fit: cover; object-position: top left; }
.err { color: var(--pp-danger); font-size: 12px; }
.chip { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 999px; background: var(--pp-bg2); color: var(--pp-muted); border: 1px solid var(--pp-border); }
.chip.open { color: var(--pp-accent); border-color: var(--pp-accent-soft); background: var(--pp-accent-soft); }
.chip.resolved { color: var(--pp-ok); }
.chip.detached { color: var(--pp-warn); }
.cmt { display: flex; gap: 8px; }
.cmt .meta { font-size: 12px; color: var(--pp-muted); }
.cmt .meta b { color: var(--pp-fg); font-weight: 600; }
.cmt .text { word-wrap: break-word; overflow-wrap: anywhere; }
.cmt .text code { font: 12px ui-monospace, monospace; background: var(--pp-bg2); padding: 1px 4px; border-radius: 4px; }
.cmt .text a { color: var(--pp-accent); }
.pp-mention { color: var(--pp-accent); font-weight: 600; background: var(--pp-accent-soft); border-radius: 4px; padding: 0 3px; }
.cmt .imgs img { max-width: 100%; border-radius: 6px; margin-top: 4px; }
.menu { position: absolute; right: 8px; top: 40px; z-index: 3; padding: 4px; min-width: 180px; }
.menu button { all: unset; display: block; width: 100%; box-sizing: border-box; padding: 7px 10px; border-radius: 4px; cursor: pointer; font-size: 12.5px; }
.menu button:hover, .menu button:focus-visible { background: var(--pp-bg2); outline: none; }
.menu hr { border: 0; border-top: 1px solid var(--pp-border); margin: 4px 0; }
.toasts { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 8px; align-items: center; pointer-events: none; }
.toast { padding: 9px 14px; font-size: 13px; display: flex; gap: 10px; align-items: center; background: var(--pp-fg); color: var(--pp-bg); border: none; max-width: 520px; }
.toast button { all: unset; cursor: pointer; font-weight: 700; color: var(--pp-accent); }
.toast.error { background: var(--pp-danger); color: #fff; }
.toast.error button { color: #fff; text-decoration: underline; }
.sel-btn { position: fixed; display: inline-flex; gap: 6px; align-items: center; padding: 6px 10px; font-weight: 600; font-size: 12.5px; cursor: pointer; border: 1px solid var(--pp-border); }
.sel-btn:focus-visible { outline: 2px solid var(--pp-accent); }
.modal { position: fixed; inset: 0; background: rgba(10,10,20,.55); display: flex; align-items: center; justify-content: center; pointer-events: auto; }
.modal-inner { width: min(1100px, 94vw); max-height: 94vh; display: flex; flex-direction: column; overflow: hidden; }
.blur-stage { position: relative; overflow: auto; background: #111; flex: 1; cursor: crosshair; user-select: none; }
.blur-stage img { display: block; max-width: 100%; }
.blur-box { position: absolute; border: 2px dashed #fff; background: rgba(255,255,255,.25); backdrop-filter: blur(6px); }
.blur-box button { position: absolute; top: -10px; right: -10px; all: unset; cursor: pointer; background: #000; color: #fff; width: 18px; height: 18px; border-radius: 50%; text-align: center; line-height: 18px; font-size: 12px; }
.inpage-panel { position: fixed; top: 0; right: 0; bottom: 0; width: 380px; max-width: 92vw; pointer-events: auto; background: var(--pp-bg); border-left: 1px solid var(--pp-border); box-shadow: var(--pp-shadow); display: flex; flex-direction: column; }
.inpage-panel iframe { border: 0; flex: 1; width: 100%; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (prefers-reduced-motion: reduce) { .hl, .pin { transition: none !important; } .hl.pulse { animation: none; } }
`;
