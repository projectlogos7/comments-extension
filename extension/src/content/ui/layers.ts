// Escape-key layer stack. Every open piece of UI (dropdown, composer, thread card, blur editor)
// registers a close callback; Esc always closes the topmost one only. The listener runs in the
// capture phase on window, so it fires before the page's own handlers and before our textarea,
// and it stops the event so the page never also reacts to that Esc.

type Closer = () => void;

const stack: { id: number; close: Closer }[] = [];
let seq = 0;
let installed = false;

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.isComposing || !stack.length) return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  stack[stack.length - 1].close();
}

export function installEscapeHandler() {
  if (installed) return;
  installed = true;
  window.addEventListener('keydown', onKey, true);
}

/** Register a layer; returns the function that removes it. */
export function pushLayer(close: Closer): () => void {
  installEscapeHandler();
  const id = ++seq;
  stack.push({ id, close });
  return () => {
    const i = stack.findIndex((l) => l.id === id);
    if (i >= 0) stack.splice(i, 1);
  };
}

export function layerCount() {
  return stack.length;
}
