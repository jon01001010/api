import * as React from 'react';
import {createPortal} from 'react-dom';

/**
 * The desktop's PIN screen over the app when it locks again (AppLockRoot).
 * React Native Web's Modal sits at z-index 9999 like every other dialog of
 * the app, so one opened later would be drawn over it; this layer is a
 * page-wide box of its own at the highest z-index, above the app's dialogs
 * and web/AlertHost.js, and everything else on the page is made inert
 * while it is up (no clicks, no keyboard focus behind it; security review
 * 2, 2026-11-18).
 */
export const LOCK_Z_INDEX = 2147483647;

export function LockLayer({
  children,
}: React.PropsWithChildren): React.JSX.Element | null {
  // The page's own objects (no DOM types in this project's settings).
  const [host, setHost] = React.useState<any>(null);

  React.useEffect(() => {
    const doc: any = (globalThis as any).document;
    if (!doc?.body) {
      return;
    }
    const box = doc.createElement('div');
    box.setAttribute('data-pa-lock', '');
    box.style.cssText = `position:fixed;top:0;left:0;right:0;bottom:0;z-index:${LOCK_Z_INDEX};display:flex;flex-direction:column;`;
    doc.body.appendChild(box);
    // Everything else on the page: inert while locked (only what this
    // layer changed is put back).
    const changed: any[] = [];
    const quiet = () => {
      for (const el of Array.from(doc.body.children) as any[]) {
        if (el !== box && !el.inert) {
          el.inert = true;
          el.setAttribute('aria-hidden', 'true');
          changed.push(el);
        }
      }
    };
    quiet();
    // A dialog the app opens while locked is inert too.
    const Observer = (globalThis as any).MutationObserver;
    const watch = typeof Observer === 'function' ? new Observer(quiet) : null;
    watch?.observe(doc.body, {childList: true});
    setHost(box);
    return () => {
      watch?.disconnect();
      for (const el of changed) {
        el.inert = false;
        el.removeAttribute('aria-hidden');
      }
      box.remove();
    };
  }, []);

  return host ? createPortal(children, host) : null;
}
