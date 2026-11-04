/**
 * Why PocketAgent closed: Android's record of the app's last exits
 * (Android 11+), plus a fatal JavaScript error saved the moment it
 * happened. Shown once on the next launch and in Settings.
 */
import {NativeModules, Platform} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface CrashReport {
  time: number;
  /** Short label: "Low memory", "Native crash", "App error", ... */
  kind: string;
  /** One line for the notice. */
  summary: string;
  /** Everything, for Copy details. */
  details: string;
}

const LAST_SEEN_KEY = '@pocketagent/crash-reports/last-seen/v1';

const native = () =>
  Platform.OS === 'android' ? NativeModules.AppDiagnostics : undefined;

/** android.app.ApplicationExitInfo reason codes that mean "closed on its own". */
const REASONS: Record<number, string | null> = {
  0: 'Unknown',
  1: null, // exit self (normal)
  2: 'Stopped by a signal',
  3: 'Low memory',
  4: 'App error',
  5: 'Native crash',
  6: 'Not responding',
  7: 'Startup error',
  8: 'Excessive resource use',
  9: 'Permission changed',
  10: null, // user swiped it away / force stop
  11: 'User stopped',
  12: 'Dependency died',
  13: null, // other
  14: 'Frozen',
  15: null, // package state change (update)
  16: null, // package updated
};

/** The library a native crash happened in, from the trace. */
function crashedLibrary(trace: string | undefined): string | undefined {
  const libs = (trace ?? '').match(/lib[\w.-]+\.so/g) ?? [];
  const interesting = libs.find(l =>
    /rnwhisper|rnllama|whisper|llama|ggml/i.test(l),
  );
  return interesting ?? libs[0];
}

export function describeExit(exit: any): CrashReport | null {
  const kind = REASONS[exit?.reason as number];
  if (kind === null || kind === undefined) {
    return null;
  }
  const lib = exit.reason === 5 ? crashedLibrary(exit.trace) : undefined;
  const mb = (kb: number) => `${Math.round((kb || 0) / 1024)} MB`;
  const summary =
    exit.reason === 3
      ? `Android closed PocketAgent to free memory (it was using ${mb(exit.pssKb)}).`
      : exit.reason === 5
        ? `PocketAgent crashed in native code${lib ? ` (${lib})` : ''}.`
        : exit.reason === 2 && exit.status === 9
          ? 'Android ended PocketAgent (often to free memory).'
          : `${kind}${exit.description ? `: ${exit.description}` : ''}`;
  const details = [
    `When: ${new Date(exit.timestamp).toISOString()}`,
    `Reason: ${kind} (${exit.reason}), status ${exit.status}`,
    exit.description ? `Description: ${exit.description}` : '',
    `Memory: PSS ${mb(exit.pssKb)}, RSS ${mb(exit.rssKb)}`,
    exit.trace ? `Trace:\n${exit.trace}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return {time: Number(exit.timestamp) || 0, kind, summary, details};
}

/** Saved by the JS error recorder: "<time>\n<error and stack>". */
export function describeJsError(saved: string | null): CrashReport | null {
  if (!saved) {
    return null;
  }
  const at = saved.indexOf('\n');
  const time = Number(saved.slice(0, at)) || 0;
  const text = saved.slice(at + 1);
  return {
    time,
    kind: 'App error',
    summary: text.split('\n')[0].slice(0, 200),
    details: `When: ${new Date(time).toISOString()}\n${text}`,
  };
}

/** Newest first. */
export async function loadCrashReports(max = 10): Promise<CrashReport[]> {
  const n = native();
  if (!n) {
    return [];
  }
  const [exits, jsError] = await Promise.all([
    n.getLastExits?.(max).catch(() => []) ?? [],
    n.readJsError?.().catch(() => null) ?? null,
  ]);
  const reports = [
    ...(exits as any[]).map(describeExit),
    describeJsError(jsError),
  ].filter((r): r is CrashReport => !!r);
  return reports.sort((a, b) => b.time - a.time);
}

/** Reports newer than the last one shown (and mark them shown). */
export async function takeNewCrashReports(): Promise<CrashReport[]> {
  const reports = await loadCrashReports();
  let lastSeen = 0;
  try {
    lastSeen = Number(await AsyncStorage.getItem(LAST_SEEN_KEY)) || 0;
  } catch {}
  const fresh = reports.filter(r => r.time > lastSeen);
  if (reports.length) {
    try {
      await AsyncStorage.setItem(LAST_SEEN_KEY, String(reports[0].time));
    } catch {}
  }
  // First run ever: don't greet the user with old history.
  return lastSeen === 0 ? [] : fresh;
}

/** Save fatal JS errors before React Native closes the app. */
export function installJsErrorRecorder(): void {
  const utils = (globalThis as any).ErrorUtils;
  const n = native();
  if (!utils?.setGlobalHandler || !n?.recordJsError) {
    return;
  }
  const previous = utils.getGlobalHandler?.();
  utils.setGlobalHandler((error: any, isFatal?: boolean) => {
    if (isFatal) {
      try {
        n.recordJsError(
          `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}\n${
            error?.stack ?? ''
          }`.slice(0, 20000),
        );
      } catch {}
    }
    previous?.(error, isFatal);
  });
}

/** Free memory above Android's low-memory line, when the app can tell. */
export async function usableMemoryBytes(): Promise<number | undefined> {
  try {
    const info = await native()?.memoryInfo?.();
    if (info && typeof info.availMem === 'number') {
      return Math.max(0, info.availMem - (info.threshold || 0));
    }
  } catch {}
  return undefined;
}
