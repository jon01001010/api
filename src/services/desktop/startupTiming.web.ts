/**
 * Desktop app: where start-up time goes, to find why Windows took 45 s.
 * Native times count from the app process starting; page times from the
 * page starting to load (web/installNet.js, web/start.js).
 */
import {invoke} from '@tauri-apps/api/core';

export interface StartupReport {
  rows: {label: string; seconds: number}[];
  /** The Windows profile is still being recorded (read again soon). */
  waiting?: boolean;
}

const s = (ms: number | null | undefined) =>
  ms == null ? NaN : Math.round(ms / 100) / 10;

/** The three slowest files the page loaded (0.3 s or more). */
function slowestFiles(): {name: string; start: number; ms: number}[] {
  try {
    return (performance.getEntriesByType('resource') as any[])
      .filter(e => e.duration >= 300)
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 3)
      .map(e => ({
        name: String(e.name).split('/').pop()!.slice(0, 40),
        start: e.startTime,
        ms: e.duration,
      }));
  } catch {
    return [];
  }
}

type Hot = {name: string; place: string; ms: number};

function profileRows(p: any): {label: string; seconds: number}[] {
  if (!p) {
    return [
      {
        label: 'Profile: still recording (ready about a minute after start)',
        seconds: NaN,
      },
    ];
  }
  if (p.error) {
    return [{label: `Profile: not recorded (${p.error})`, seconds: NaN}];
  }
  const hot = (title: string, list: Hot[]) =>
    (list || []).slice(0, 8).map(h => ({
      label: `  …${title}: ${h.name} at ${h.place || '?'}`,
      seconds: s(h.ms),
    }));
  return [
    {label: 'Profile: page busy (first minute)', seconds: s(p.busyMs)},
    {label: '  …cleaning up memory', seconds: s(p.garbageCollectorMs)},
    {label: '  …browser itself', seconds: s(p.programMs)},
    ...hot('own time', p.topSelf),
    ...hot('with what it calls', p.topTotal),
  ];
}

export async function readStartupTiming(): Promise<StartupReport | null> {
  const boot = (globalThis as any).__paBoot || {};
  let native: any = {};
  try {
    native = await invoke('startup_timing');
  } catch {
    return null;
  }
  return {
    waiting: !native.profile,
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
      // The browser's storage (suspected cause of the Windows stall).
      {
        label: '  …first read of saved settings (page frozen while waiting)',
        seconds: s(boot.localStorageMs),
      },
      {
        label: '  …chat database storage answered after',
        seconds: s(boot.indexedDbMs),
      },
      // Finer marks (seconds since the page began loading).
      {label: '  …all start-up code has run at', seconds: s(boot.codeDone)},
      {
        label: '  …React put the first screen together at',
        seconds: s(boot.firstCommit),
      },
      {label: '  …first screen drawn at', seconds: s(boot.firstScreen)},
      {label: '  …page "loaded" event at', seconds: s(boot.pageLoad)},
      {
        label: '  …page busy without a break (long tasks, total)',
        seconds: s(
          (boot.longTasks || []).reduce((t: number, l: any) => t + l.ms, 0),
        ),
      },
      ...[...(boot.longTasks || [])]
        .sort((a: any, b: any) => b.ms - a.ms)
        .slice(0, 3)
        .map((l: any) => ({
          label: `  …long task starting at ${s(l.start)} s`,
          seconds: s(l.ms),
        })),
      ...(boot.canvas || []).map((c: any) => ({
        label: `  …canvas (${c.kind}) set up, started at ${s(c.start)} s`,
        seconds: s(c.ms),
      })),
      // The browser calls that took the most time in total.
      ...Object.entries(boot.calls || {})
        .sort((a: any, b: any) => b[1].ms - a[1].ms)
        .slice(0, 5)
        .map(([label, c]: any) => ({
          label: `  …browser: ${label} (${c.n}×, longest ${s(c.max)} s), total`,
          seconds: s(c.ms),
        })),
      ...(boot.visibility || []).map((v: any) => ({
        label: `  …window ${v.state} at`,
        seconds: s(v.at),
      })),
      ...slowestFiles().map(f => ({
        label: `  …file ${f.name} (started at ${s(f.start)} s)`,
        seconds: s(f.ms),
      })),
      // Windows: the page's own profiler (src-tauri/src/profile.rs), ready
      // a minute after start. Places are file:line:column in the app's code.
      ...profileRows(native.profile),
      // The slowest native calls (if any took 0.25 s or more).
      ...(boot.slowCalls || []).map((c: any) => ({
        label: `Slow native call ${c.cmd} (started at ${s(c.startedMs)} s)`,
        seconds: s(c.ms),
      })),
    ],
  };
}
