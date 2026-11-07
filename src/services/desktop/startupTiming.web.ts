/**
 * Desktop app: where start-up time goes, to find why Windows took 45 s.
 * Native times count from the app process starting; page times from the
 * page starting to load (web/installNet.js, web/start.js).
 */
import {invoke} from '@tauri-apps/api/core';

export interface StartupReport {
  rows: {label: string; seconds: number}[];
}

const s = (ms: number | null | undefined) =>
  ms == null ? NaN : Math.round(ms / 100) / 10;

export async function readStartupTiming(): Promise<StartupReport | null> {
  const boot = (globalThis as any).__paBoot || {};
  let native: any = {};
  try {
    native = await invoke('startup_timing');
  } catch {
    return null;
  }
  return {
    rows: [
      {
        label: 'App opened → page starts loading',
        seconds: s(native.pageLoadStartedMs),
      },
      {label: "Loading the app's code", seconds: s(boot.codeRunning)},
      {
        label: 'Code running → first screen',
        seconds: s(boot.firstScreen - boot.codeRunning),
      },
      {
        label: 'App opened → page fully loaded',
        seconds: s(native.pageLoadFinishedMs),
      },
    ],
  };
}
