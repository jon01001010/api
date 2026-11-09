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
}

export const usePcHardware = (): PcHardware | null => null;

export const fitOnThisPc = (_bytes: number, _hw: PcHardware): PcFit => 'memory';

export const FIT_TEXT: Record<PcFit, string> = {
  card: 'Fits on your graphics card (fast)',
  partly: 'Partly on your graphics card (medium)',
  memory: 'Runs in memory, no graphics card (slow)',
  'too-big': 'Too big for this PC',
};
