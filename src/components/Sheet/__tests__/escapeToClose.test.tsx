import {renderHook} from '@testing-library/react-native';
import {Platform} from 'react-native';

import {useEscapeToClose, _openSheetCount, _pressKey} from '../escapeToClose';

describe('Escape closes the top sheet (desktop)', () => {
  const realOS = Platform.OS;
  const g = globalThis as any;
  const realDoc = g.document;
  beforeEach(() => {
    g.document = {addEventListener: jest.fn()};
  });
  afterEach(() => {
    Platform.OS = realOS;
    g.document = realDoc;
  });

  it('closes only the most recently opened sheet', () => {
    Platform.OS = 'web' as any;
    const first = jest.fn();
    const second = jest.fn();
    const a = renderHook(() => useEscapeToClose(true, first));
    const b = renderHook(() => useEscapeToClose(true, second));
    expect(_openSheetCount()).toBe(2);
    _pressKey({key: 'Escape'});
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    _pressKey({key: 'a'});
    expect(second).toHaveBeenCalledTimes(1);
    b.unmount();
    _pressKey({key: 'Escape'});
    expect(first).toHaveBeenCalledTimes(1);
    a.unmount();
    expect(_openSheetCount()).toBe(0);
  });

  it('does nothing on the phone or for a closed sheet', () => {
    Platform.OS = 'android' as any;
    const close = jest.fn();
    const a = renderHook(() => useEscapeToClose(true, close));
    Platform.OS = 'web' as any;
    const b = renderHook(() => useEscapeToClose(false, close));
    expect(_openSheetCount()).toBe(0);
    _pressKey({key: 'Escape'});
    expect(close).not.toHaveBeenCalled();
    a.unmount();
    b.unmount();
  });
});
