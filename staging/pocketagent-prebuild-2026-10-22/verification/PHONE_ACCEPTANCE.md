# Phone acceptance checklist

1. Start app with no model loaded: model picker appears; no PocketPal/Assistants screen flashes.
2. Load Qwen3.5-2B: model name appears; global system prompt is visible/editable.
3. Start and reopen app: microphone/listening remains OFF without explicit action.
4. Start local chat; simulate local model failure. Offer remote handoff, never send conversation before user approves.
5. With a private file attached, ask separate consent before sharing file contents remotely.
6. Deny consent: conversation and files remain local. No automatic upload.
7. Approve remote: preserve relevant chat history and display active provider. Never replay in-flight tool calls.
8. Return to local Qwen after remote response, preserving conversation without duplicating tool effects.
9. Test calculator `847*293`: 248171. Test invalid Unicode multiply and recovery.
10. Background response completes: notification arrives without reopening app.
11. Create HTML clock. Inline view remains static; fullscreen clock ticks; button JS works.
12. HTML fetch and external navigation fail; close fullscreen and verify execution stops.
13. Reopen after thermal throttling; no forced unload simply for app switching.
14. Run permission, network URL and file sandbox regression suites before distribution.
15. Produce APK; inspect startup, crash logs, RAM, battery and temperature on actual device.
