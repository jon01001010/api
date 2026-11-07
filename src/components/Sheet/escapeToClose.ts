import {useEffect, useRef} from 'react';
import {Platform} from 'react-native';

/**
 * Desktop app: Escape closes the most recently opened sheet (phones swipe a
 * sheet down instead). Does nothing on the phone.
 */
const open: Array<{current: () => void}> = [];
let listening = false;

function onKeyDown(event: {key?: string}) {
  if (event.key === 'Escape' && open.length > 0) {
    open[open.length - 1].current();
  }
}

export function useEscapeToClose(
  visible: boolean | undefined,
  close: () => void,
) {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    if (Platform.OS !== 'web' || !visible) {
      return;
    }
    const doc = (globalThis as any).document;
    if (!doc) {
      return;
    }
    if (!listening) {
      doc.addEventListener('keydown', onKeyDown);
      listening = true;
    }
    const entry = {current: () => latest.current()};
    open.push(entry);
    return () => {
      const i = open.indexOf(entry);
      if (i >= 0) {
        open.splice(i, 1);
      }
    };
  }, [visible]);
}

/** For tests. */
export const _openSheetCount = () => open.length;
export const _pressKey = onKeyDown;
