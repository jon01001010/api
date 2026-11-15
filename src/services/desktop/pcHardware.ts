/**
 * The PC's hardware (desktop app only, pcHardware.web.ts). On the phone:
 * nothing; phones use their own memory checks.
 */
export type PcFit = 'card' | 'partly' | 'memory' | 'too-big';

export interface PcHardware {
  totalMemory: number;
  availableMemory: number;
  cpuCores: number;
  gpus: {
    name: string;
    totalMemory: number;
    freeMemory: number;
    shared: boolean;
  }[];
  /** The processor's AI engine, if found (src-tauri/src/npu.rs). */
  npus?: PcNpu[];
}

export interface PcNpu {
  vendor: 'AMD' | 'Intel' | 'Qualcomm' | 'unknown';
  name: string;
  driverOk: boolean;
  how: 'pci-id' | 'device-class' | 'sysfs';
}

/** "NPU: AMD Ryzen AI (driver ready)" or "No NPU found". */
export const npuText = (npus: PcNpu[] | undefined): string => {
  if (!npus?.length) {
    return 'No NPU found';
  }
  return (
    'NPU: ' +
    npus
      .map(n => {
        const name =
          n.vendor !== 'unknown' &&
          !n.name.toLowerCase().includes(n.vendor.toLowerCase())
            ? `${n.vendor} ${n.name}`
            : n.name;
        return `${name} (${n.driverOk ? 'driver ready' : 'no working driver'})`;
      })
      .join(', ')
  );
};

export const usePcHardware = (): PcHardware | null => null;

export const fitOnThisPc = (_bytes: number, _hw: PcHardware): PcFit => 'memory';

export const FIT_TEXT: Record<PcFit, string> = {
  card: 'Fits on your graphics card (fast)',
  partly: 'Partly on your graphics card (medium)',
  memory: 'Runs in memory, no graphics card (slow)',
  'too-big': 'Too big for this PC',
};
