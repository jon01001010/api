/**
 * The PC's hardware (desktop app only, pcHardware.web.ts). On the phone:
 * nothing; phones use their own memory checks.
 */
import type {PcFit, PcHardware} from './pcHardwareShared';
export {FIT_TEXT, npuText} from './pcHardwareShared';
export type {PcFit, PcHardware, PcNpu} from './pcHardwareShared';

export const usePcHardware = (): PcHardware | null => null;

export const read = async (): Promise<PcHardware | null> => null;

export const fitOnThisPc = (_bytes: number, _hw: PcHardware): PcFit => 'memory';
