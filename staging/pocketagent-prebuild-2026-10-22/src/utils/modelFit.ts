/** Conservative *guidance*, not a guarantee that a GGUF will load. */
export type ModelFit = 'likely' | 'tight' | 'unknown' | 'too_large';
export interface ModelFitResult {fit: ModelFit; estimateBytes?: number; detail: string}
export function estimateModelFit(totalRamBytes: number, weightsBytes: number, projectorBytes?: number): ModelFitResult {
  if (!Number.isFinite(totalRamBytes) || !Number.isFinite(weightsBytes) || totalRamBytes <= 0 || weightsBytes <= 0) {
    return {fit: 'unknown', detail: 'RAM or model size unavailable. Check model files and test loading.'};
  }
  // Approximate weights + compute/KV cache + Android memory reservation.
  // Vision projectors must be counted separately; missing size is explicitly uncertain.
  const estimateBytes = (weightsBytes + (projectorBytes || 0)) * 1.35 + 1.25 * 1024 ** 3;
  const ratio = estimateBytes / totalRamBytes;
  if (ratio >= 0.85) return {fit: 'too_large', estimateBytes, detail: 'High memory risk. Try a smaller quantization or model.'};
  if (ratio >= 0.65) return {fit: 'tight', estimateBytes, detail: 'May work, but memory pressure or slowdowns are possible.'};
  return {fit: 'likely', estimateBytes, detail: 'Memory estimate looks reasonable; loading is not guaranteed.'};
}
