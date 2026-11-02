// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { placeFloating } from '../src/content/ui/popover';
import { clampPos } from '../src/content/ui/drag';
import { pushLayer } from '../src/content/ui/layers';

describe('floating placement', () => {
  it('opens below when it fits, above when it does not, and stays in the viewport', () => {
    Object.assign(window, { innerWidth: 1000, innerHeight: 800 });
    const below = placeFloating({ left: 100, top: 100, right: 200, bottom: 130, width: 100 }, 200, 150);
    expect(below.side).toBe('bottom');
    expect(below.top).toBe(136);
    const above = placeFloating({ left: 100, top: 700, right: 200, bottom: 730, width: 100 }, 200, 150);
    expect(above.side).toBe('top');
    expect(above.top + 150).toBeLessThanOrEqual(700);
    const shifted = placeFloating({ left: 950, top: 100, right: 990, bottom: 130, width: 40 }, 200, 100);
    expect(shifted.left + 200).toBeLessThanOrEqual(992);
  });
  it('clamps dragged cards fully on screen', () => {
    Object.assign(window, { innerWidth: 1000, innerHeight: 800 });
    expect(clampPos({ left: -50, top: 900 }, 300, 200)).toEqual({ left: 8, top: 592 });
    expect(clampPos({ left: 900, top: 10 }, 300, 200)).toEqual({ left: 692, top: 10 });
  });
});

describe('escape layers', () => {
  it('closes only the topmost layer and stops the page from seeing Esc', () => {
    const a = vi.fn();
    const b = vi.fn();
    const popA = pushLayer(a);
    const popB = pushLayer(b);
    const pageHandler = vi.fn();
    document.addEventListener('keydown', pageHandler);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    popB();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(a).toHaveBeenCalledTimes(1);
    expect(pageHandler).not.toHaveBeenCalled();
    popA();
  });
});
