# October 19 recovery checkpoint — build still unverified

No successful APK or app Java/Kotlin compilation has been verified. The temporary toolchain and unsaved build logs were removed again before the next session could inspect the final result.

During the previous attempt, the Hexagon SDK tarball and consumed-file checksums passed, both Android NDK compilers passed their version checks, and Gradle explicitly detected the Hexagon SDK and enabled the DSP build. The first APK attempt reached its 15-minute limit during dependency resolution. A retry detected a modified immutable Gradle transform cache. The cache was moved to a temporary location and derived transforms regenerated. That attempt progressed through module configuration, but a usage-limit rejection blocked the final status check. Its terminal outcome is unknown. None of this proves NPU execution on a phone.

Recovered fixes now included in this checkpoint:

- Hexagon tar extraction uses --no-same-owner, fixing observed foreign-UID extraction failures without weakening checksum checks.
- Portable setup supports --gradle-cache for a location outside a synchronized project workspace. Synchronization is a suspected cache-corruption cause, not a proven diagnosis.
- Restored the manual configuration/compilation/APK workflow and diagnostic service-placeholder helper.
- Corrected the ignore rule that excluded the workflow from earlier ZIPs. Checkpoint creation now refuses to omit required build files. The final ZIP is explicitly checked for these files.

Validation today: workflow YAML parsed, embedded shell syntax passed, Python scripts parsed, and the existing ten build-tool tests passed. This is build preparation, not a successful Actions run. GitHub integration is available but has not been installed/connected in this session. No source was pushed, no workflow was dispatched, and nothing was published.

Next executable stage: run the manual configuration job on a connected repository/runner, then compilation, then the guarded NPU debug APK stage. Optional cloud services use placeholders; no release credentials are needed. The free/no-ads requirement and upstream licenses remain unchanged.

---

# October 18: staged runner preparation after workspace loss

The last bounded local stage downloaded checker-qual 3.12.0, error_prone_annotations 2.7.1, and j2objc-annotations 1.3. A damaged Gradle transform cache entry was isolated; the subsequent offline configuration check advanced to an uncached Android Gradle Plugin 8.7.2 dependency for the file-access module. No app compilation result was reached.

Workspace maintenance subsequently removed the local toolchain and dependency cache. The confirmed October 18 12:02:29 PT source checkpoint has now been restored. Previously reported tool installations are historical, not the current environment.

Added `.github/workflows/api-helper-diagnostic.yml`: manually selected configuration, compilation, and NPU APK stages; bounded steps; Gradle cache; logs retained on failure; APK artifact uploaded only on successful NPU payload verification. Read-only repository permission, no release credentials, no store publishing. Uses diagnostic service placeholders. YAML parsing and every embedded shell block passed local syntax checks. The workflow has NOT run on GitHub and is not evidence of successful Android compilation.

Current blocker: a persistent build runner/repository connection is needed to execute this prepared workflow without repeating toolchain recovery in this temporary workspace. No APK exists; actual NPU offload remains untested.

---

# October 18 follow-up: restored toolchain and security regression results

The pinned portable JDK, Android SDK, both NDK revisions and Gradle were installed successfully in this session. Both NDK clang executables passed their real version checks. React Native Gradle plugins compiled successfully. The Android app compile attempt is still in native-module configuration at checkpoint creation; this is not a successful app compilation or APK build.

The restored node_modules directory was missing the saved Metro image-size patch. Reapplying all eight repository patches fixed the observed TypeError in Metro asset handling. Native setup now reapplies patches with --error-on-fail before downloading tools/compiling, and rejects missing JavaScript dependencies early. That exact patch command passed.

Current validation: TypeScript check passed; all 103 application tests across eight suites passed; 16 real Java HTTP security checks, 19 protocol checks, six dependency mitigation checks and three dependency compatibility checks passed. The first combined run stopped at the missing Metro patch; after reapplying patches, the complete phonemize/Metro check passed (109225 dictionary entries, namespace semantics, predictions, changed-input rejection, path routing and asset handling). Ten build-tool regression tests also passed. git diff --check passed.

This compile-only run has no Hexagon SDK and explicitly reports CPU-only configuration. It is only an Android integration check and must not be used as the accelerated product build. The separate diagnostic APK command requires Hexagon paths and verifies NPU payload contents. No APK or measured NPU compatibility is established.

---

# October 18 checkpoint: build recovery and NPU packaging guard

Current status: source restored from the confirmed October 17 13:16:27 PT checkpoint. No APK has been produced; full Android compilation and measured device NPU offload remain unverified. The later interrupted build-tool cache and checkpoint were not saved and are not available.

This chunk adds revision-aware NDK layout recovery to the portable setup script. It accepts the expected direct layout or exactly one nested directory with the requested Pkg.Revision, checks for a compiler and destination conflicts before moving files, then executes clang --version during real setup. Metadata validation is not a cryptographic authenticity check. Recovery assumes SDK installation is serialized; an OS error during moves can still require reinstalling the package.

A diagnostic ARM64 debug APK command now requires Hexagon SDK/tools paths, forces llama.rn source builds, and runs the existing ELF/symbol/DSP payload verifier after assembly. Its ARM64 manifest preserves all original ARM64 requirements. Directory presence does not prove SDK provenance; use the pinned SDK setup workflow. Successful packaging would still not establish actual NPU execution or 8B model compatibility.

Validation this chunk: 10 Python tests passed for NDK layout recovery and missing/invalid Hexagon build paths; Node manifest integrity checks passed (all ARM64 rules retained, missing/duplicate ABI rejected); shell syntax passed. These are offline fixtures, not an SDK installation or native compilation. Prior application test results below are historical and were not rerun for these build-script-only changes.

Next: restore dependencies and pinned toolchain, run Android Java/Kotlin compilation, then attempt the guarded diagnostic APK build. Device installation and measured acceleration follow only after successful packaging.

---

# API Helper — source checkpoint

Date: 16 October 2026. Status: source prototype; no installable APK yet.

## Implemented

- PocketPal foundation and Hugging Face model browsing/downloads, retaining upstream MIT notices.
- Android identity and launcher changed to API Helper; full visual redesign remains unfinished.
- User-controlled foreground inference service with a loopback-only, bearer-authenticated API. Other apps must explicitly integrate; this does not automatically control every app.
- Stateless text endpoints: `/v1/models` and `/v1/chat/completions`. Bounded input, deadlines, cancellation, and serialized model use.
- API startup requires configured Qualcomm HTP acceleration. Actual NPU offload and 8B performance have not been verified on hardware.
- Android Keystore encryption for persisted download credentials, clearing legacy plaintext tokens, required Hugging Face SHA-256 checks, restricted download destinations, and disabled backup.
- Script-disabled HTML previews, stricter deep links, restricted cleartext traffic, and no release signing fallback to the public debug key.
- Payments disabled, no ads added, bounded calculator parser, dependency upgrades and targeted dependency patches.

## Verification

- TypeScript typecheck passed.
- Eight targeted Jest suites passed: 102 tests. A subsequent service run passed seven tests including one new timeout-cancellation regression: 103 distinct app tests passed across those runs.
- Standalone checks passed: 16 HTTP, 19 protocol, six dependency mitigation and three dependency compatibility checks.
- Lint: zero errors; one existing React Native Blob import warning. Git whitespace check passed. React Native codegen succeeded.
- Dependency audit reduced from 95 unique advisories to two. Remaining versions are flagged for braces and sprintf-js; local patches mitigate the tested vulnerable paths. This is not a clean audit or a guarantee of complete security.

## Build and security limitations

- Android SDK 36, build tools 36.0.0, NDK 27.3.13750724 and CMake 3.22.1 were installed in the current workspace. React Native Gradle plugins compiled. Native app compilation remains blocked by the missing Java compiler; native download tests have not run.
- JavaScript production bundling now passes: Metro wrote the Android production bundle and copied 50 assets. Native Android compilation is still unverified.
- No physical Motorola test, measured NPU offload, 8B memory/thermal test, or cross-app end-to-end test yet.
- The NPU gate checks configuration, not proof of successful hardware execution. Arbitrary GGUF models are not promised to work on the NPU.
- No complete audit of inference engines or binary supply chains. Historical backups and forensic database remnants are not scrubbed by these changes.
- An app holding the local API key can send prompts while the service runs. Keys rotate on restart; keep the key private. This prototype has no per-app consent registry.
- Existing optional cloud features and IAP dependencies remain in the source; purchase paths are disabled.
- No PocketOrca APK or native binaries were merged. The shared API is independently implemented in PocketPal.

## Contents and next small chunks

The ZIP contains the modified source, tests, dependency lockfile, patches and original license. Start with `API_HELPER.md`. It excludes dependencies, build output, private release keys and the Orca APK.

1. Compile Android with SDK/NDK available and fix concrete native errors.
2. Test authenticated API and accelerated inference on the intended phone.
3. Add per-app authorization and finish the UI redesign.

Base: PocketPal commit `07ef06ffbfc5be79330aaa38b5e38020aaf2a2fe`; branch `api-helper/security-and-service`. This is an uncommitted working-tree checkpoint.

## Completed chunk: Metro production bundle

The original build bottleneck was phonemize 1.1.0's generated English dictionary: 100,844 individual JavaScript bindings. A build-time transformer now compacts the static declarations into JSON strings, preserving all 109,225 dictionary entries and namespace behavior. Input SHA-256 pinning forces review after dependency changes. The original installed package is not modified by this transformer.

The dependency security upgrade to image-size 2 also exposed Metro's old filename API usage. The reproducible `metro+0.83.3.patch` makes Metro read image bytes before measuring dimensions. The regression check exercises Metro's real asset-loading path.

Validation for this chunk:

- Production CLI bundle completed with exit code 0; 50 assets copied.
- All dictionary entries and property order match the original; namespace default identity, freeze state, and null prototype are preserved.
- Five original/compacted pronunciation predictions match; modified dependency input is rejected.
- Transformer routing checks pass for relative, absolute and Windows paths; unrelated source passes through.
- Existing nine dependency checks plus the new Metro asset regression pass.
- New build scripts and Metro config pass lint; git whitespace check passes.

Commands: `node scripts/check-phonemize-bundle.cjs`, `node tests/security/dependencies.cjs`, and `NODE_OPTIONS=--max-old-space-size=4096 node node_modules/react-native/cli.js bundle --platform android --dev false --entry-file index.js --bundle-output /tmp/api-helper-android.bundle --assets-dest /tmp/api-helper-assets --max-workers 1`.

This verifies JavaScript packaging, not installation, Hermes/native compilation, speech quality on-device, or NPU operation.

## Checkpoint: 17 October 2026 — Android build setup

- Restored the saved Metro-success source checkpoint after the workspace reverted to an older state. All eight dependency patches applied successfully.
- Re-ran dictionary equivalence/routing checks and all ten dependency/Metro asset checks: passed. Whitespace check passed.
- Reinstalled official Android SDK 36, build tools 36.0.0, NDK 27.3.13750724 and CMake 3.22.1. SDK manager and Gradle distributions were checked against their recorded published digests.
- With a fresh Gradle cache, React Native settings/shared/build plugins compiled successfully. The earlier plugin/cache failure did not recur.
- Native compilation stopped configuring onnxruntime-react-native: the installed Java 17 runtime lacks the Java compiler executable required by Gradle. The system package installer cannot operate under this environment's user/group permissions. Next: install a verified portable JDK and retry.
- llama.rn explicitly reported missing Hexagon SDK and CPU-only configuration. This is NOT an accepted accelerated build. Next: provision and verify Hexagon tooling, require the existing Android payload checks to confirm backend libraries/symbols, then test actual offload on hardware. SDK presence alone does not prove acceleration.
- No APK was produced. No native app compilation, device install or NPU performance claim is made.
- Added `scripts/create-checkpoint.py`. It generates new matching source/report files in America/Vancouver time, refuses timestamp collisions, and records the archive SHA-256. Existing checkpoints remain intact.

The build tools/cache are temporary environment dependencies, excluded from the source ZIP. The source archive contains the app and reproducible source changes, not a preconfigured Android workstation.

## Portable JDK recovery — 17 October 2026

The previous working session installed and checksum-verified Temurin 17.0.20.1. Its javac compiled a test program and the local HTTP server; all 16 HTTP checks passed. Native Gradle configuration passed the earlier missing-compiler failure, then stopped while fetching gradle-download-task 5.0.1 (HTTP 403). A direct retry of the exact same artifact URL returned HTTP 200. The subsequent Gradle retry outcome is unknown: a usage-limit block interrupted observation and the temporary environment later reset. No successful native app build is claimed.

This checkpoint restores the saved source and adds scripts/setup-android-build.py so the portable environment can be recreated. The script pins verified download digests, supports the existing trusted Java CA store and records build logs. The script is preserved before another long build attempt. NPU/Hexagon setup remains blocked and no APK has been produced.
