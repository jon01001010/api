# PocketAgent #28 — Smart-home / IoT bridge (staged)

Cumulative staged files from #27 plus `src/services/iot/HomeAssistantClient.ts` and tests.

A deliberately narrow **Home Assistant** bridge for light, switch and fan on/off/toggle. The user must supply the server URL, token and exact allowed entity IDs. Every action requires explicit confirmation. No automatic device discovery, arbitrary endpoints, door locks, alarms, thermostats or cameras. The adapter never chooses a URL based on model output.

**Not wired to Toolbox or agent execution yet.** There is no credential-storage UI, discovery UI, or confirmation UI in this checkpoint. Integrators must store the token securely (Android Keystore), present confirmation, and gate calls through existing Toolbox permission checks. Never place the token in AsyncStorage or tool logs. No commits or APK builds.
