/** The PC side of keeping in step: desktop app only (hostSync.web.ts). */
export function startHostSync(): void {}

export async function hostSyncAllowed(): Promise<boolean> {
  return false;
}

export async function setHostSyncAllowed(_allowed: boolean): Promise<void> {}
