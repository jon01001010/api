# Extras

Kept, but not part of the app or its build. Nothing here runs in CI. Each
folder explains what it is and how to bring it back into use.

| Folder | What it is | To use it again |
|---|---|---|
| `npu-workflows/` | GitHub Actions experiments for Qualcomm Hexagon / QNN / FastRPC NPU offload on the Snapdragon 7 Gen 1 (V69) test phone, plus the older "API Helper" build workflow. On hold until a newer phone (issue #1, `TODO.md`). | Move a file back into `.github/workflows/` and update the SDK versions and target. See its `README.md`. |
| `api-helper-history/` | Notes from when this fork was called "API Helper": the original fork description and an old build-status note. | Reference only. |
| `upstream-community/` | PocketPal AI's contributing guide, code of conduct, Weblate translation config and user guide. They point at the upstream project. | Move back to the repository root (and `docs/`) if this project starts its own community process. |
| `store-publishing/` | Upstream fastlane setup for Google Play / App Store publishing (`fastlane/`, `android-fastlane/`), with store text and screenshots. Unused here. | Move `fastlane/` back to the root and `android-fastlane/` to `android/fastlane`, then set the real app ID and store accounts. |
| `e2e-tests/` | Appium end-to-end device tests and benchmark tooling inherited from upstream. Paths are already updated for this location; unit tests for its scripts still run from `scripts/__tests__/`. | Run from this folder (see its `README.md`); the `android:build:e2e` / `ios:build:e2e` scripts in `package.json` build the test app. |

Things deliberately left where they are:

- `ios/` and `Gemfile`: React Native's tooling expects them at the root.
- Git branches and APK pre-releases: kept as they are.
