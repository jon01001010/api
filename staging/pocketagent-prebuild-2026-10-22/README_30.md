# #30 Hardware detection and model-fit guidance (staged)

Existing PocketAgent already reads RAM, CPU features, GPU capabilities and device tiers. This checkpoint reuses its GPU detector and device RAM reader, adds a **conservative model-fit estimator** and an advisory section on the Models screen. No forced model selection and no unsupported NPU claims.

Apply after copying `src/` and applying previous patches: `python3 patches/apply-30-hardware-advice.py`.

**Limitations:** approximate only, active model only, does not know vision projector memory unless supplied to estimator, and no live Android test. The existing native GPU support check is a compatibility heuristic, not proof of successful acceleration. Qwen3.5-2B remains the sole curated recommendation from #29.
