# API Helper — combined Android prototype

Free local inference, no advertising, no purchase flow. This is a source prototype, not a verified release APK.

## Foundation

Based on PocketPal AI commit `07ef06ffbfc5be79330aaa38b5e38020aaf2a2fe` (version 1.20.0), preserving its MIT licence and attribution. The fork keeps Hugging Face discovery/downloads and the existing llama.rn engine, including experimental Hexagon support. It implements PocketOrca-style shared inference independently: no Orca APK assets, JavaScript bridge, file manager or mismatched native binaries are imported.

Android application ID: `org.apihelper.local`; launcher name: **API Helper**. The launcher icon and local sharing card are new. The rest of the upstream UI remains largely intact. This is not affiliated with the upstream developers.

## What is implemented

- A single loaded local model serves chat in the app and authenticated requests from compatible client apps. Both use the existing exclusive generation lease; a busy model returns 429 instead of starting another generation.
- Settings → **Share local model · experimental** starts/stops a user-visible Android foreground service. A persistent notification provides Stop. Notification permission is required. There is no boot receiver or automatic restart after process death.
- Loopback address only: `http://127.0.0.1:8765/v1`. No LAN option. A cryptographically random 256-bit bearer key is generated per start. It is held in memory, not saved or logged. Stop closes sockets and revokes that session.
- Text-only, non-streaming subset of the OpenAI chat API: `GET /v1/models` and `POST /v1/chat/completions`. `model` must be `local`; `stream` must be omitted or false. No tools, media, file paths, saved chat access, remote URLs or arbitrary engine parameters.
- Maximum 32 messages, 16,000 text characters, 32 KiB request bodies and 512 generated tokens. The formatted prompt is tokenized and checked against the configured context capacity. Requests expire after 120 seconds and cancel generation.
- Only two native request workers, no unbounded queue, bounded headers/body reads. Browser Origin/fetch headers and unexpected Host values are rejected. There are no CORS grants, file-serving routes or log endpoints.
- Shared inference requires an HTP device and positive offload-layer setting in the loaded context. A CPU fallback is rejected. **This checks configuration; it is not proof of actual NPU offload.** Runtime offload, 8B model compatibility, speed, thermal behaviour and Motorola support require a real-device test.

## Client example

Configure a compatible native app with the base URL above, its current session key, and model `local`. Send the key in `Authorization: Bearer <session-key>`, never in a URL.

```json
{
  "model": "local",
  "messages": [{"role": "user", "content": "Summarise this text…"}],
  "max_tokens": 256,
  "stream": false
}
```

A client needs to support a custom local endpoint and non-streaming responses. Ordinary apps do not automatically gain AI features. Share intents, keyboard integration, accessibility-based screen assistance, per-app grants and streaming are future work. Token possession authorizes access; this version does not authenticate an Android package identity.

## Security changes

| Area | Change |
|---|---|
| Hugging Face credentials | AndroidKeyStore AES-GCM encryption before persistence in the download database; migration removes legacy plaintext values; completion/cancellation clears stored credentials; clearing the HF token cancels credential-bearing downloads and clears their copies. |
| Model downloads | HTTPS Hugging Face entry URLs, no HTTPS-to-HTTP redirect downgrade, canonical destinations restricted to the private models directory, mandatory expected SHA-256 and verification before committing downloaded bytes. Equal-size corrupted files are rejected. Metadata absence fails closed. |
| Backup exposure | Android backup disabled; cloud/device-transfer rules exclude app data. This does not erase historical backups or forensically scrub old SQLite pages. |
| Generated HTML | A trusted document envelope places CSP before all generated markup. Both previews disable JavaScript, external resources, file access, mixed content, navigation and popups. Interactive generated HTML is deliberately unavailable in this build. |
| Calculator | Replaced expr-eval with a small arithmetic parser: no property access, assignment, variables or dynamic code; bounded text, token count and nesting. |
| Network policy | Outbound cleartext traffic limited to localhost. Existing plain-HTTP LAN server configurations will no longer work; use HTTPS. |
| Releases | Removed fallback to the publicly known debug signing key. A release needs the owner's signing credentials. |
| Payments | Removed purchase startup and Settings purchase/account cards; hid purchase footer; disabled purchase eligibility, startup and the native payment entry point. This does not unlock other people's paid content. No ads were added. |
| Dependencies | Upgraded vulnerable packages, with explicit compatible overrides where required. Applied local bounds for two dependencies with no published patched version; see validation notes. |

A repository digest verifies the downloaded bytes against that repository's metadata. It does not make an untrusted model safe, authenticate its author, or prove the native inference engine has no vulnerabilities. Imported models without independent expected hashes remain unverified.

## Build and validation

Use Node >=22.21, Yarn 1.22.22, JDK 17+, Android SDK/build tools 36 and NDK 27.3.13750724. Follow the existing upstream native setup instructions as well.

```sh
corepack yarn install --frozen-lockfile --ignore-scripts
node node_modules/patch-package/index.js --error-on-fail
bash scripts/check-local-security.sh
# On a machine with the Android SDK/NDK and native prerequisites:
cd android
./gradlew :app:testProdDebugUnitTest :app:assembleProdDebug
```

The upstream postinstall script also prepares OpenCL headers for a native source build; review/run it when that build path is used. Do not skip the checked-in dependency patches. A Gradle-plugin patch updates Foojay to 1.0.0 for Gradle 9 compatibility, as documented in its [official release notes](https://plugins.gradle.org/plugin/org.gradle.toolchains.foojay-resolver-convention/1.0.0).

The debug build is for development and uses Metro. It is not a standalone release APK. For a distributable build, configure a private release keystore and build the release variant after the native/device checks pass.

See `SECURITY_VALIDATION.md` for actual results and outstanding gates. No claim of “all security fixed” or phone compatibility is made.

### Metro dictionary compatibility

`scripts/metro/transformer.cjs` delegates to the SVG/React Native transformer after compacting the pinned phonemize 1.1.0 English dictionary. This avoids compiling over 100,000 static bindings. Run `node scripts/check-phonemize-bundle.cjs` after build changes. A different dictionary hash deliberately fails until its transformation is reviewed. The Metro patch under `patches/` adapts image-size 2 to Metro's asset loader. Both fixes are required for the verified production JS bundle; they do not establish Android or NPU compatibility.

### Sorted checkpoints

Run `python3 scripts/create-checkpoint.py --output /absolute/path/outside/repository`.
It creates `api-helper_YYYY-MM-DD_HH-mm-ss_PT_source.zip` and a matching `_progress.md` using America/Vancouver time. Each checkpoint is a new file; the command refuses to overwrite an existing timestamp. The report records the exact UTC offset and the archive SHA-256. Source archives exclude ignored dependencies and build output. Keep earlier checkpoints; use the newest timestamp to resume.

### Rebuild after an environment reset

Use Python 3.12+ on Linux x64: `python3 scripts/setup-android-build.py --tools-dir /absolute/path/outside/source/android-tools --accept-sdk-licenses --compile-native`. This pins and verifies the portable JDK, SDK manager and Gradle downloads, installs SDK/NDK/CMake, and checks ARM64 Java/Kotlin compilation. Review Android SDK terms before supplying the license flag. For a managed network, `--java-truststore /path/to/trusted/cacerts` uses an existing trusted Java CA store without disabling certificate verification. Reapply dependency patches after dependency installation. Logs live in the tools directory. Hexagon tooling and APK/device validation are separate requirements.


## Reproducible diagnostic build (October 18)

The portable setup script now validates both required NDK revisions and recovers a single matching nested NDK installation without overwriting existing entries. Run offline regression checks with `PYTHONDONTWRITEBYTECODE=1 python3 scripts/test_android_build_tools.py` and `node scripts/check-arm64-manifest.cjs`.

After installing dependencies, applying patches, and provisioning the pinned Hexagon SDK/tools, run `bash scripts/build-api-helper-npu.sh`. Set `HEXAGON_SDK_ROOT` and `HEXAGON_TOOLS_ROOT` to that installation. This builds a debug-signed ARM64 diagnostic APK and requires the existing ELF/symbol/DSP payload verification to pass. It does not publish anything or prove device acceleration. No APK is available at this checkpoint.


## Staged build runner

The manual `API Helper diagnostic build` GitHub Actions workflow has three choices: `configuration`, `compilation`, and `apk`. Run them in that order on a GitHub repository containing this source. It keeps Gradle dependency caches and uploads build logs. Caches are an optimization, may be evicted, and are not guaranteed permanent. Each selected stage remains a complete independent job.

The APK stage provisions the pinned Hexagon SDK and uploads a debug APK only after the existing NPU ELF/symbol payload check succeeds. It uses diagnostic Firebase placeholders, no release credentials, and does not publish to a store. Optional cloud services are not functional with these placeholders. Successful packaging still does not prove device NPU offload or 8B model compatibility.

Workflow YAML and embedded shell syntax were checked locally; no GitHub Actions run has occurred. A GitHub repository and runner access are required. Repository Actions availability, policies, and usage limits still apply.


## October 19 build recovery

The manual diagnostic workflow is now actually included in the checkpoint ZIP. Earlier packaging accidentally omitted it because a generic `workflows/` ignore rule also matched the build workflow directory. The checkpoint creator now rejects missing required build files.

Local setup accepts `--gradle-cache /tmp/api-helper-gradle-cache` when the project lives in a synchronized workspace. This does not make the cache durable across cleanup. Hexagon extraction no longer tries to restore archive owner IDs. Use `python3 scripts/prepare-diagnostic-config.py` only in a checkout without existing service configuration; it refuses to overwrite existing files. Optional cloud integrations will not function with its placeholders.

The latest local build result is unknown after tool usage limits interrupted inspection and workspace cleanup removed the logs. No APK is claimed.
