// All in-page UI styles. They live inside our shadow root, so site CSS cannot reach them and
// they cannot leak into the site (FR-1.14).
export const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.pp, .pp * { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
.pp {
  --accent: #5B5BD6; --accent-hover: #4c4cc4; --accent-ink: #ffffff; --accent-soft: rgba(91,91,214,.12); --accent-line: rgba(91,91,214,.35);
  --bg: #ffffff; --bg2: #f7f7f9; --bg3: #efeff3; --fg: #1a1a1f; --muted: #60606c; --faint: #8e8e9a; --border: #e3e3e8; --border-strong: #d0d0d8;
  --ok: #18794e; --ok-soft: rgba(24,121,78,.1); --warn: #a35200; --danger: #c62a2f;
  --shadow: 0 12px 32px -8px rgba(20,20,40,.22), 0 2px 6px rgba(20,20,40,.08), 0 0 0 1px rgba(20,20,40,.04);
  --shadow-sm: 0 6px 18px -6px rgba(20,20,40,.25), 0 0 0 1px rgba(20,20,40,.05);
  --r: 10px; --r-sm: 7px; --t: 150ms;
  color: var(--fg); font-size: 13.5px; line-height: 1.45; -webkit-font-smoothing: antialiased;
}
@media (prefers-color-scheme: dark) {
  .pp { --accent: #8b8cf6; --accent-hover: #9d9ef8; --accent-ink: #121218; --accent-soft: rgba(139,140,246,.16); --accent-line: rgba(139,140,246,.45);
    --bg: #1b1b21; --bg2: #232329; --bg3: #2c2c34; --fg: #ededf2; --muted: #a8a8b5; --faint: #7d7d8a; --border: #34343d; --border-strong: #44444f;
    --ok: #4cc38a; --ok-soft: rgba(76,195,138,.14); --warn: #f0a050; --danger: #ff7b7f;
    --shadow: 0 16px 40px -8px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.06); --shadow-sm: 0 8px 20px -6px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.07); }
}
.layer { position: fixed; inset: 0; pointer-events: none; }
.grow { flex: 1; min-width: 0; }
.muted { color: var(--muted); font-size: 12px; }
.row { display: flex; gap: 8px; align-items: center; }
.err { color: var(--danger); font-size: 12px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* ---------- comment mode ---------- */
.overlay { position: fixed; inset: 0; pointer-events: auto; cursor: crosshair; background: rgba(15,15,30,.05); }
.overlay.hidden { display: none; }
.hl { position: fixed; pointer-events: none; border: 2px solid var(--accent); background: var(--accent-soft); border-radius: 4px; transition: left 60ms linear, top 60ms linear, width 60ms linear, height 60ms linear; }
.hl.multi { background: rgba(91,91,214,.18); }
.hl.section { border-style: dashed; background: rgba(91,91,214,.05); }
.hl.drag { border-style: dashed; background: rgba(91,91,214,.1); }
.hl.pulse { animation: pp-pulse 1.2s ease-out 2; border-width: 3px; }
@keyframes pp-pulse { 0% { box-shadow: 0 0 0 0 rgba(91,91,214,.55); } 100% { box-shadow: 0 0 0 16px rgba(91,91,214,0); } }
.hl-label { position: fixed; pointer-events: none; background: var(--accent); color: #fff; font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 4px 6px; border-radius: 5px; white-space: nowrap; max-width: 60vw; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 2px 6px rgba(0,0,0,.2); }
.mode-bar { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); pointer-events: auto; background: rgba(24,24,30,.94); color: #f2f2f6; border-radius: 999px; padding: 6px 6px 6px 16px; display: flex; gap: 14px; align-items: center; box-shadow: 0 10px 30px -6px rgba(0,0,0,.4); font-size: 12.5px; white-space: nowrap; }
.mode-bar .hints { color: #b4b4c0; }
.mode-bar kbd { font: 600 10.5px ui-monospace, monospace; background: rgba(255,255,255,.14); border-radius: 4px; padding: 1px 5px; color: #fff; }
.mode-bar button { all: unset; cursor: pointer; font-weight: 600; padding: 5px 12px; border-radius: 999px; background: rgba(255,255,255,.14); color: #fff; }
.mode-bar button:hover { background: rgba(255,255,255,.24); }
.mode-bar button:focus-visible { outline: 2px solid #a5a6ff; outline-offset: 2px; }

/* ---------- pins ---------- */
.pin { position: fixed; pointer-events: auto; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%; background: var(--accent); color: #fff; border: 2px solid #fff; box-shadow: 0 2px 6px rgba(0,0,0,.28); font: 700 11px/18px ui-sans-serif, system-ui, sans-serif; text-align: center; cursor: pointer; padding: 0; transition: transform var(--t); font-variant-numeric: tabular-nums; }
.pin:hover, .pin:focus-visible { transform: scale(1.15); outline: none; box-shadow: 0 0 0 4px var(--accent-line), 0 2px 6px rgba(0,0,0,.28); z-index: 1; }
.pin.resolved { background: var(--ok); }
.pin.unread::after { content: ""; position: absolute; top: -4px; right: -4px; width: 8px; height: 8px; border-radius: 50%; background: #e5484d; border: 2px solid #fff; }
.pin-tip { position: absolute; left: 28px; top: 50%; transform: translateY(-50%); display: none; width: max-content; max-width: 260px; text-align: left; background: rgba(24,24,30,.95); color: #f2f2f6; font: 500 12px/1.4 ui-sans-serif, system-ui, sans-serif; padding: 6px 9px; border-radius: 7px; box-shadow: 0 6px 18px rgba(0,0,0,.3); white-space: normal; pointer-events: none; }
.pin-tip b { font-weight: 650; color: #fff; }
.pin:hover .pin-tip, .pin:focus-visible .pin-tip { display: block; }
.pin.tip-left .pin-tip { left: auto; right: 28px; }
.pin-outline { position: fixed; pointer-events: none; border: 1.5px dashed var(--accent); border-radius: 5px; opacity: .5; }
.pin-outline.area { border-style: solid; opacity: 0; }
.pin-outline.show { opacity: .9; }
.pins.hidden { display: none; }

/* ---------- cards: composer + thread card ---------- */
.card-ui { position: fixed; pointer-events: auto; background: var(--bg); color: var(--fg); border-radius: var(--r); box-shadow: var(--shadow); display: flex; flex-direction: column; max-height: min(600px, calc(100vh - 16px)); animation: pp-in var(--t) ease-out; }
.card-ui.dragging { box-shadow: 0 24px 48px -12px rgba(20,20,40,.35), 0 0 0 1px var(--accent-line); user-select: none; }
@keyframes pp-in { from { opacity: 0; transform: translateY(4px) scale(.985); } to { opacity: 1; transform: none; } }
.hdr { display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 10px; border-bottom: 1px solid var(--border); min-height: 44px; }
.drag-handle { cursor: grab; user-select: none; touch-action: none; border-radius: var(--r) var(--r) 0 0; }
.dragging .drag-handle { cursor: grabbing; }
.grip { color: var(--faint); display: inline-flex; padding: 0 2px; }
.hdr .title { font-weight: 650; font-size: 13.5px; }
.hdr-text { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; }
.hdr-text .sub { font-size: 11.5px; color: var(--muted); text-transform: capitalize; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.num { width: 24px; height: 24px; border-radius: 50%; background: var(--accent); color: #fff; font: 700 11.5px/24px ui-sans-serif, system-ui, sans-serif; text-align: center; flex: none; font-variant-numeric: tabular-nums; }
.num.resolved { background: var(--ok); }
.body { padding: 12px; overflow: auto; display: flex; flex-direction: column; gap: 12px; min-height: 0; }
.composer .body { padding: 10px 12px 8px; gap: 10px; }
.ftr { display: flex; align-items: center; gap: 8px; padding: 8px 10px 10px 12px; }
.composer .ftr { border-top: 1px solid var(--border); padding-top: 8px; }
.ftr.reply { border-top: 1px solid var(--border); padding: 10px 12px 12px; display: block; }
.kbd-hint { font-size: 11px; color: var(--faint); }

/* segmented control */
.seg { display: inline-flex; padding: 2px; gap: 2px; background: var(--bg3); border-radius: 8px; }
.seg button { all: unset; cursor: pointer; padding: 3px 10px; font-size: 12px; font-weight: 600; color: var(--muted); border-radius: 6px; transition: background var(--t), color var(--t); }
.seg button:hover:not([disabled]) { color: var(--fg); }
.seg button[aria-checked="true"] { background: var(--bg); color: var(--fg); box-shadow: 0 1px 2px rgba(0,0,0,.12); }
.seg button[disabled] { opacity: .4; cursor: default; }
.seg button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

/* buttons */
button.btn { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 14px; border-radius: var(--r-sm); font-weight: 600; font-size: 13px; border: 1px solid var(--border-strong); background: var(--bg); color: var(--fg); transition: background var(--t), border-color var(--t), filter var(--t); white-space: nowrap; }
button.btn:hover:not([disabled]) { background: var(--bg2); }
button.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
button.btn.primary:hover:not([disabled]) { background: var(--accent-hover); border-color: var(--accent-hover); }
button.btn.ghost { border-color: transparent; background: transparent; color: var(--muted); }
button.btn.ghost:hover:not([disabled]) { background: var(--bg3); color: var(--fg); }
button.btn.resolve { color: var(--ok); border-color: transparent; background: var(--ok-soft); }
button.btn.resolve:hover:not([disabled]) { background: var(--ok-soft); filter: brightness(.96); }
button.btn.danger { color: var(--danger); }
button.btn[disabled] { opacity: .45; cursor: default; }
button.btn.sm { height: 26px; padding: 0 10px; font-size: 12px; border-radius: 6px; }
button.icon { all: unset; cursor: pointer; width: 28px; height: 28px; border-radius: 7px; display: inline-flex; align-items: center; justify-content: center; color: var(--muted); flex: none; transition: background var(--t), color var(--t); }
button.icon:hover, button.icon[aria-expanded="true"] { background: var(--bg3); color: var(--fg); }
button.icon.xs { width: 22px; height: 22px; border-radius: 5px; }
button.linkbtn { all: unset; cursor: pointer; color: var(--accent); font-weight: 600; font-size: 12px; display: inline-flex; align-items: center; gap: 4px; }
button.linkbtn:hover { text-decoration: underline; }
button.linkbtn.opts-toggle { color: var(--muted); padding: 4px 6px; margin-left: -6px; border-radius: 6px; }
button.linkbtn.opts-toggle:hover, button.linkbtn.opts-toggle.on { color: var(--fg); background: var(--bg3); text-decoration: none; }
button:focus-visible, textarea:focus-visible, input:focus-visible, [role="listbox"]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* editor */
.editor { display: flex; flex-direction: column; gap: 6px; }
.editor-box { border: 1px solid var(--border-strong); border-radius: 8px; background: var(--bg); transition: border-color var(--t), box-shadow var(--t); }
.editor-box:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.editor textarea { display: block; width: 100%; border: 0; outline: none !important; resize: none; background: transparent; color: var(--fg); font: inherit; font-size: 13.5px; line-height: 1.5; padding: 9px 11px; min-height: 38px; max-height: 240px; }
.editor textarea::placeholder { color: var(--faint); }
.editor-bar { display: flex; align-items: center; gap: 6px; }
.fmt { display: flex; gap: 1px; }
.fmt button { all: unset; cursor: pointer; width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; color: var(--faint); font-size: 12.5px; }
.fmt button:hover { background: var(--bg3); color: var(--fg); }
.fmt button:focus-visible { outline: 2px solid var(--accent); }
.atts { display: flex; gap: 6px; flex-wrap: wrap; padding: 0 9px 9px; }
.att { position: relative; width: 52px; height: 52px; border-radius: 6px; overflow: hidden; border: 1px solid var(--border); }
.att img { width: 100%; height: 100%; object-fit: cover; }
.att button { all: unset; position: absolute; top: 2px; right: 2px; cursor: pointer; background: rgba(0,0,0,.65); color: #fff; width: 16px; height: 16px; border-radius: 50%; font-size: 11px; text-align: center; line-height: 16px; }
.quote { margin: 0; padding: 4px 10px; border-left: 3px solid var(--accent-line); color: var(--muted); font-size: 12.5px; font-style: italic; }
.section-step code { font: 11.5px ui-monospace, monospace; background: var(--bg3); padding: 1px 5px; border-radius: 4px; }

/* options */
.options { display: flex; flex-direction: column; gap: 10px; padding-top: 2px; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
button.chipbtn { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 9px; border-radius: 999px; border: 1px dashed var(--border-strong); color: var(--muted); font-size: 12px; font-weight: 550; max-width: 100%; transition: background var(--t), border-color var(--t); }
button.chipbtn span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
button.chipbtn:hover:not([disabled]), button.chipbtn[aria-expanded="true"] { background: var(--bg2); color: var(--fg); }
button.chipbtn.set { border-style: solid; color: var(--fg); background: var(--bg2); }
button.chipbtn .caret { flex: none; opacity: .7; }
.ticon { width: 14px; text-align: center; font-size: 12px; }
.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: none; }
.snap-row { display: flex; gap: 10px; align-items: flex-start; }
.thumb-sm { width: 96px; height: 60px; object-fit: cover; object-position: top left; border-radius: 6px; border: 1px solid var(--border); flex: none; }
.thumb-sm.empty { display: flex; align-items: center; justify-content: center; font-size: 11px; color: var(--faint); background: var(--bg2); }
.snap-opts { display: flex; flex-direction: column; gap: 6px; padding-top: 2px; }
label.chk { display: inline-flex; gap: 7px; align-items: center; font-size: 12.5px; color: var(--fg); cursor: pointer; }
label.chk input { accent-color: var(--accent); margin: 0; width: 14px; height: 14px; }
label.chk:has(input[disabled]) { color: var(--faint); cursor: default; }

/* floating popovers (always on top, never clipped) */
.pop { position: fixed; z-index: 10; pointer-events: auto; background: var(--bg); color: var(--fg); border-radius: 9px; box-shadow: var(--shadow-sm); padding: 4px; overflow: auto; min-width: 180px; max-width: 320px; animation: pp-pop 120ms ease-out; }
.pop.from-top { animation-name: pp-pop-up; }
@keyframes pp-pop { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
@keyframes pp-pop-up { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
.pop [role="listbox"], .pop [role="menu"] { outline: none; display: flex; flex-direction: column; gap: 1px; }
.pop .opt { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; cursor: pointer; font-size: 13px; min-height: 30px; }
.pop .opt.active, .pop button.opt:focus-visible { background: var(--bg3); outline: none; }
.pop .opt[aria-selected="true"] { font-weight: 600; }
.pop .opt.danger { color: var(--danger); }
.opt-label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.opt-hint { color: var(--faint); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px; }
.check { color: var(--accent); font-weight: 700; }
.sep { height: 1px; background: var(--border); margin: 4px 2px; }
.mention-pop { min-width: 240px; }

/* thread card content */
.avatar { width: 22px; height: 22px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); font-weight: 700; font-size: 10px; display: inline-flex; align-items: center; justify-content: center; flex: none; overflow: hidden; letter-spacing: .02em; }
.avatar img { width: 100%; height: 100%; object-fit: cover; }
.cmt { display: flex; gap: 10px; }
.cmt.deleted { font-style: italic; padding-left: 36px; }
.cmt-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.cmt .meta { display: flex; align-items: center; gap: 6px; font-size: 12.5px; min-height: 22px; }
.cmt .meta b { font-weight: 650; }
.cmt .text { word-wrap: break-word; overflow-wrap: anywhere; font-size: 13.5px; }
.cmt .text code { font: 12px ui-monospace, monospace; background: var(--bg3); padding: 1px 4px; border-radius: 4px; }
.cmt .text a { color: var(--accent); }
.pp-mention { color: var(--accent); font-weight: 600; background: var(--accent-soft); border-radius: 4px; padding: 0 3px; }
.cmt .imgs { display: flex; gap: 6px; flex-wrap: wrap; }
.cmt .imgs img { max-width: 100%; max-height: 160px; border-radius: 6px; border: 1px solid var(--border); }
.thumb-link { display: block; }
.thumb { width: 100%; border-radius: 8px; border: 1px solid var(--border); display: block; max-height: 150px; object-fit: cover; object-position: top left; }
.notice-inline { display: flex; gap: 10px; align-items: center; font-size: 12px; color: var(--muted); background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; }
.skeleton { height: 56px; border-radius: 8px; background: linear-gradient(90deg, var(--bg2), var(--bg3), var(--bg2)); background-size: 200% 100%; animation: pp-sk 1.2s linear infinite; }
@keyframes pp-sk { to { background-position: -200% 0; } }

/* toasts */
.toasts { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 8px; align-items: center; pointer-events: none; }
.toast { pointer-events: auto; padding: 9px 14px; font-size: 13px; display: flex; gap: 12px; align-items: center; background: rgba(24,24,30,.95); color: #f2f2f6; border-radius: 9px; box-shadow: 0 10px 30px -6px rgba(0,0,0,.4); max-width: 520px; animation: pp-pop-up 150ms ease-out; }
.toast button { all: unset; cursor: pointer; font-weight: 700; color: #a5a6ff; }
.toast.error { background: #b4232a; color: #fff; }
.toast.error button { color: #fff; text-decoration: underline; }

/* selection button */
.sel-btn { position: fixed; pointer-events: auto; display: inline-flex; gap: 6px; align-items: center; padding: 6px 11px; font: 600 12.5px ui-sans-serif, system-ui, sans-serif; cursor: pointer; border: 0; border-radius: 8px; background: var(--fg); color: var(--bg); box-shadow: var(--shadow-sm); }
.sel-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* blur editor */
.modal { position: fixed; inset: 0; background: rgba(10,10,20,.55); display: flex; align-items: center; justify-content: center; pointer-events: auto; }
.modal-inner { width: min(1100px, 94vw); max-height: 94vh; display: flex; flex-direction: column; overflow: hidden; background: var(--bg); border-radius: var(--r); box-shadow: var(--shadow); }
.modal-inner .hdr { gap: 12px; padding: 10px 14px; }
.modal-inner .ftr { border-top: 1px solid var(--border); }
.blur-stage { position: relative; overflow: auto; background: #111; flex: 1; cursor: crosshair; user-select: none; }
.blur-stage img { display: block; max-width: 100%; }
.blur-box { position: absolute; border: 2px dashed #fff; background: rgba(255,255,255,.25); backdrop-filter: blur(6px); }
.blur-box button { all: unset; position: absolute; top: -10px; right: -10px; cursor: pointer; background: #000; color: #fff; width: 18px; height: 18px; border-radius: 50%; text-align: center; line-height: 18px; font-size: 12px; }

/* in-page panel fallback */
.inpage-panel { position: fixed; top: 0; right: 0; bottom: 0; width: 380px; max-width: 92vw; pointer-events: auto; background: var(--bg); box-shadow: var(--shadow); display: flex; flex-direction: column; }
.inpage-panel .hdr .title { flex: 1; }
.inpage-panel iframe { border: 0; flex: 1; width: 100%; }

@media (prefers-reduced-motion: reduce) {
  .pp *, .pp *::before, .pp *::after { animation: none !important; transition: none !important; }
}
`;
