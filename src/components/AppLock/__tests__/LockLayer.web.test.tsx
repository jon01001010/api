/**
 * The desktop's PIN layer is above every other layer of the page and
 * makes the rest inert (security review 2, 2026-11-18). A small stand-in
 * for the page (no browser here).
 */
import React from 'react';

jest.mock('react-dom', () => ({
  createPortal: (children: any) => children,
}));

import {act, create} from 'react-test-renderer';

import {LOCK_Z_INDEX, LockLayer} from '../LockLayer.web';

class El {
  style: any = {};
  attrs = new Map<string, string>();
  inert = false;
  parent: Body | null = null;
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
  }
  remove() {
    this.parent?.children.splice(this.parent.children.indexOf(this), 1);
  }
}
class Body {
  children: El[] = [];
  appendChild(el: El) {
    el.parent = this;
    this.children.push(el);
  }
}

describe('LockLayer (desktop)', () => {
  const body = new Body();
  beforeAll(() => {
    (globalThis as any).document = {
      body,
      createElement: () => {
        const el = new El();
        Object.defineProperty(el.style, 'cssText', {
          set(v: string) {
            for (const part of v.split(';').filter(Boolean)) {
              const [k, val] = part.split(':');
              el.style[k] = val;
            }
          },
        });
        return el;
      },
    };
  });
  afterAll(() => {
    delete (globalThis as any).document;
  });

  it('a box above the app and its dialogs; the rest inert until unlocked', () => {
    const app = new El();
    const dialog = new El();
    body.appendChild(app);
    body.appendChild(dialog);
    let tree: any;
    act(() => {
      tree = create(<LockLayer>{'PIN'}</LockLayer>);
    });
    const box = body.children.find(e => e.attrs.has('data-pa-lock'))!;
    expect(box).toBeTruthy();
    expect(Number(box.style['z-index'])).toBe(LOCK_Z_INDEX);
    // Above React Native Web's Modal (9999) and the desktop dialogs (100000).
    expect(LOCK_Z_INDEX).toBeGreaterThan(100000);
    expect(box.style.position).toBe('fixed');
    expect(app.inert).toBe(true);
    expect(dialog.inert).toBe(true);
    expect(app.attrs.get('aria-hidden')).toBe('true');
    expect(box.inert).toBe(false);
    act(() => tree.unmount());
    expect(body.children.includes(box)).toBe(false);
    expect(app.inert).toBe(false);
    expect(dialog.inert).toBe(false);
  });
});
