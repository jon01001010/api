/**
 * The PC's hardware in the desktop app: memory, cores and graphics cards,
 * read by the native side (src-tauri/src/system.rs) once per app start, so
 * a new card or more memory shows up next time. Used to say where a model
 * runs ("Fits on your graphics card", …) before it is downloaded.
 */
import {useEffect, useState} from 'react';

const native = require('../../../stubs/web/systemInfo');

import type {PcFit, PcHardware} from './pcHardware';
export {FIT_TEXT} from './pcHardware';
export type {PcFit, PcHardware} from './pcHardware';

let reading: Promise<PcHardware | null> | null = null;
function read(): Promise<PcHardware | null> {
  if (!reading) {
    reading = native.systemInfo().catch(() => null);
  }
  return reading as Promise<PcHardware | null>;
}

export function usePcHardware(): PcHardware | null {
  const [hw, setHw] = useState<PcHardware | null>(null);
  useEffect(() => {
    let alive = true;
    read().then(h => alive && setHw(h));
    return () => {
      alive = false;
    };
  }, []);
  return hw;
}

export const fitOnThisPc = (bytes: number, hw: PcHardware): PcFit =>
  native.pcFit(bytes, hw);
