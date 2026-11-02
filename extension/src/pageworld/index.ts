// Page-world helper. Runs in the page's own JavaScript context (world: MAIN), injected on demand,
// to read framework internals that the isolated content script cannot see (FR-6.2).
// Protocol: content script sets <html data-pinpoint-channel="nonce"> before injection, marks the
// target with data-pinpoint-probe="id", then posts { channel, kind: 'component', id } to window.
// We reply with { channel, kind: 'component.result', id, component }.

interface ComponentRef {
  framework: 'react' | 'vue' | 'angular' | 'svelte';
  name: string;
  file?: string;
  line?: number;
  stack?: string[];
}

type AnyObj = Record<string, any>;

(() => {
  const w = window as unknown as AnyObj;
  const root = document.documentElement;
  const channel = root.getAttribute('data-pinpoint-channel');
  if (!channel || w.__pinpointPageworld === channel) return;
  w.__pinpointPageworld = channel;
  root.removeAttribute('data-pinpoint-channel');

  const MAX_STACK = 8;

  function shortFile(f?: string): string | undefined {
    if (!f) return undefined;
    return f.replace(/^webpack:\/\/\/?/, '').replace(/^.*?\/(src|app|components|pages)\//, '$1/').replace(/\?.*$/, '');
  }

  function reactName(type: any): string | null {
    if (!type) return null;
    if (typeof type === 'string') return null; // host component (div)
    if (typeof type === 'function') return type.displayName || type.name || null;
    if (typeof type === 'object') {
      if (type.displayName) return type.displayName;
      if (type.render) return type.render.displayName || type.render.name || null; // forwardRef
      if (type.type) return reactName(type.type); // memo
    }
    return null;
  }

  function react(el: Element): ComponentRef | null {
    for (let cur: Element | null = el, depth = 0; cur && depth < 10; cur = cur.parentElement, depth++) {
      const key = Object.keys(cur).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      if (!key) continue;
      let fiber = (cur as AnyObj)[key];
      const stack: string[] = [];
      let first: AnyObj | null = null;
      let guard = 0;
      while (fiber && guard++ < 500 && stack.length < MAX_STACK) {
        const name = reactName(fiber.type);
        if (name && !/^(Fragment|Suspense|StrictMode|Provider|Consumer|Context|ForwardRef|Memo|Anonymous)$/.test(name)) {
          stack.push(name);
          if (!first) first = fiber;
        }
        fiber = fiber.return;
      }
      if (!first) return null;
      const src = first._debugSource || first._debugOwner?._debugSource;
      let file = src?.fileName as string | undefined;
      let line = src?.lineNumber as number | undefined;
      if (!file && typeof first._debugStack?.stack === 'string') {
        // React 19: parse the first app frame from the captured stack.
        const m = (first._debugStack.stack as string).split('\n').slice(1).map((l) => l.match(/\(?((?:https?|webpack|file):\/\/[^)]+?):(\d+):\d+\)?$/)).find((x) => x && !/node_modules|react-dom|react\.development/.test(x[1]));
        if (m) {
          file = m[1];
          line = Number(m[2]);
        }
      }
      return { framework: 'react', name: stack[0], file: shortFile(file), line, stack };
    }
    return null;
  }

  function vue(el: Element): ComponentRef | null {
    for (let cur: Element | null = el, depth = 0; cur && depth < 10; cur = cur.parentElement, depth++) {
      const v3 = (cur as AnyObj).__vueParentComponent;
      if (v3) {
        const stack: string[] = [];
        let inst = v3;
        let first: AnyObj | null = null;
        while (inst && stack.length < MAX_STACK) {
          const t = inst.type || {};
          const name = t.name || t.__name || (t.__file ? String(t.__file).split('/').pop()!.replace(/\.vue$/, '') : null);
          if (name) {
            stack.push(name);
            if (!first) first = t;
          }
          inst = inst.parent;
        }
        if (stack.length) return { framework: 'vue', name: stack[0], file: shortFile(first?.__file), stack };
      }
      const v2 = (cur as AnyObj).__vue__;
      if (v2) {
        const stack: string[] = [];
        let vm = v2;
        let firstFile: string | undefined;
        while (vm && stack.length < MAX_STACK) {
          const o = vm.$options || {};
          const name = o.name || o._componentTag || (o.__file ? String(o.__file).split('/').pop()!.replace(/\.vue$/, '') : null);
          if (name && name !== 'Root') {
            stack.push(name);
            if (!firstFile) firstFile = o.__file;
          }
          vm = vm.$parent;
        }
        if (stack.length) return { framework: 'vue', name: stack[0], file: shortFile(firstFile), stack };
      }
    }
    return null;
  }

  function angular(el: Element): ComponentRef | null {
    const ng = w.ng;
    if (ng && (ng.getComponent || ng.getOwningComponent)) {
      try {
        const stack: string[] = [];
        let comp = ng.getComponent?.(el) || ng.getOwningComponent?.(el);
        let guard = 0;
        while (comp && guard++ < MAX_STACK) {
          const name = String(comp.constructor?.name || '').replace(/^_+/, '');
          if (name && !stack.includes(name)) stack.push(name);
          const host = ng.getHostElement?.(comp);
          comp = host?.parentElement ? ng.getOwningComponent?.(host.parentElement) : null;
        }
        if (stack.length) return { framework: 'angular', name: stack[0], stack };
      } catch {
        /* ignore */
      }
    }
    // Production builds: no ng global; the host element tag is the best hint.
    for (let cur: Element | null = el, depth = 0; cur && depth < 15; cur = cur.parentElement, depth++) {
      if ((cur as AnyObj).__ngContext__ !== undefined && cur.tagName.includes('-') && !cur.tagName.startsWith('MAT-')) {
        return { framework: 'angular', name: cur.tagName.toLowerCase() };
      }
    }
    return null;
  }

  function svelte(el: Element): ComponentRef | null {
    for (let cur: Element | null = el, depth = 0; cur && depth < 10; cur = cur.parentElement, depth++) {
      const meta = (cur as AnyObj).__svelte_meta;
      if (meta?.loc?.file) {
        const file = String(meta.loc.file);
        const name = file.split('/').pop()!.replace(/\.svelte$/, '');
        return { framework: 'svelte', name, file: shortFile(file), line: typeof meta.loc.line === 'number' ? meta.loc.line + 1 : undefined };
      }
    }
    return null;
  }

  function detect(el: Element): ComponentRef | null {
    for (const fn of [react, vue, svelte, angular]) {
      try {
        const r = fn(el);
        if (r) return r;
      } catch {
        /* framework internals vary; never throw into the page */
      }
    }
    return null;
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data as AnyObj;
    if (!d || d.channel !== channel || d.kind !== 'component') return;
    const el = document.querySelector(`[data-pinpoint-probe="${String(d.id).replace(/[^a-z0-9]/gi, '')}"]`);
    const component = el ? detect(el) : null;
    window.postMessage({ channel, kind: 'component.result', id: d.id, component }, '*');
  });
})();
