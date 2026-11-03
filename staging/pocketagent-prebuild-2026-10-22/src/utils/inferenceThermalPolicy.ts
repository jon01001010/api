/** Advisory thermal policy: never claim a sensor reading without native telemetry. */
export type ThermalState = 'unknown' | 'nominal' | 'fair' | 'serious' | 'critical';
export type ThermalAction = 'normal' | 'reduce_load' | 'pause_new_work' | 'stop_new_work';
export interface ThermalDecision { action: ThermalAction; reason: string; suggestedThreads?: number; }
/** Pure policy, usable by a future native thermal bridge. Does not alter an active inference run. */
export function decideThermalAction(state: ThermalState, currentThreads: number): ThermalDecision {
  const threads = Number.isFinite(currentThreads) ? Math.max(1, Math.floor(currentThreads)) : 1;
  switch (state) {
    case 'nominal': return {action: 'normal', reason: 'Thermal conditions nominal.'};
    case 'fair': return {action: 'reduce_load', reason: 'Device is warming; reduce CPU work on the next run.', suggestedThreads: Math.max(1, Math.floor(threads * 0.75))};
    case 'serious': return {action: 'pause_new_work', reason: 'Device is hot; defer new inference until it cools.', suggestedThreads: Math.max(1, Math.floor(threads * 0.5))};
    case 'critical': return {action: 'stop_new_work', reason: 'Critical thermal state; do not start new inference.'};
    default: return {action: 'normal', reason: 'Thermal status unavailable; no automatic thermal intervention.'};
  }
}
/** Preserve loaded model during app switches and tool calls; unload only on explicit release or OS pressure. */
export function shouldUnloadModel(event: 'app_background' | 'app_foreground' | 'tool_call' | 'user_unload' | 'memory_pressure' | 'task_complete'): boolean {
  return event === 'user_unload' || event === 'memory_pressure';
}
