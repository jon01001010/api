# 33 — Model lifecycle and thermal management (staged)

Adds a deterministic **advisory** policy for nominal/fair/serious/critical/unknown thermal states, and a conservative model-unload policy. The policy preserves the loaded model across app switches, tool calls and completed tasks. Explicit unload and memory pressure permit release.

## Important integration limits
- This checkpoint does **not** include a native Android thermal sensor bridge, so thermal readings are currently **unknown**.
- This checkpoint does **not** wire decisions into the inference engine, change threads during a running generation, or intercept actual OS memory pressure.
- A production implementation should use Android PowerManager thermal status and a native event emitter, then enforce `pause_new_work`/`stop_new_work` at the run admission boundary. Changes to thread count must happen at a supported model reinitialization boundary, never mid-generation.
- Do not unload a model simply because the app enters the background; background inference is already a separate feature.

## Apply
From repository root: `python3 /path/to/unpacked/patches/apply-33-thermal-policy.py`

## Verification
Jest tests included but not executed against the complete Android repository. No GitHub commit or APK build.
