/** Start-up timing: desktop app only (startupTiming.web.ts). */
export interface StartupReport {
  rows: {label: string; seconds: number}[];
  waiting?: boolean;
}

export async function readStartupTiming(): Promise<StartupReport | null> {
  return null;
}
