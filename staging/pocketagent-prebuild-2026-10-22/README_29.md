# #29 — One recommended model

- Recommendation: **Qwen3.5-2B** (model family), not a long catalogue.
- Replace recommendation by editing `src/utils/recommendedModel.ts`; no hard-coded list scattered through the UI.
- `patches/apply-29-single-recommendation.py` adds a small recommendation banner to the Models screen and opens the official model information page. It does **not** automatically download a GGUF, promise vision projector compatibility, or replace a model the user already chose.
- The user tested a Qwen3.5-2B Uncensored variant with working image understanding and calculator tool invocation on their Motorola Razr 2023. This is not proof every GGUF variant supports both capabilities.
- Previous staged patches retained. No APK build, integration test, or GitHub push.
