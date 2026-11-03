# #31 — CPU/GPU/NPU acceleration (staged)

PocketAgent already has llama.rn backend enumeration, model-settings device selection, CPU fallback, GPU/OpenCL support, and experimental Qualcomm Hexagon/HTP selection. This checkpoint **does not falsely claim to implement a new NPU backend**. It adds a user-visible backend status panel on the Models screen using the existing `getDeviceOptions()` function. It reports only enumerated runtime backends, flags Hexagon as experimental, explains model/quantization limitations, and offers manual recheck. It never silently changes a model’s backend.

Apply after #30: copy `src/components/AccelerationAdvice.tsx` and run `python3 patches/apply-31-acceleration-advice.py` from repository root. Existing settings must still be used to select a backend and reload the model.

No Android compile, hardware validation, performance benchmark, or new NPU integration performed.
