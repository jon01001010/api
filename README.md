# PocketAgent

**Private experimental Android app — work in progress. Not ready for public release.**

PocketAgent is a fork of [PocketPal AI](https://github.com/a-ghorbani/pocketpal-ai), focused on local GGUF inference, device hardware diagnostics, and a local text-only API.

## Current status

- Android APK builds are being tested on a physical phone.
- CPU inference is available through the upstream llama.cpp / llama.rn stack.
- Qualcomm Hexagon NPU offload is **not yet verified**. Detecting a chipset or GPU does not establish NPU execution.
- Hardware diagnostics report physical hardware and discovered inference backends.
- The local text API is experimental and subject to model/runtime requirements.
- Pals and other inherited PocketPal features remain part of the app.

This repository is a development fork, not an official PocketPal AI release. Do not rely on it for critical data or unattended device actions.

## Android test builds

See [GitHub Actions](https://github.com/jon01001010/api/actions) for experimental APK workflow runs and their artifacts. Build success does not guarantee hardware acceleration.

## Upstream acknowledgements

PocketAgent is based on **PocketPal AI** by its original contributors, under the repository's [MIT license](LICENSE). It also uses llama.rn and llama.cpp. The original project is at [a-ghorbani/pocketpal-ai](https://github.com/a-ghorbani/pocketpal-ai). The original upstream documentation remains available there.

## For developers

PocketAgent is a React Native Android experiment based on PocketPal AI.

### Prerequisites

- **Node.js** — version is pinned in [`.nvmrc`](.nvmrc) (currently `22.21.0`); run `nvm use` to match it. Older Node will fail the `engines` check.
- **Yarn 1 (Classic)** — `packageManager` is pinned to `yarn@1.22.22`.
- **Xcode** + **CocoaPods**, and **Ruby + Bundler** (for iOS / Fastlane tooling).
- **Android Studio** + Android SDK/NDK.

See the [React Native environment setup](https://reactnative.dev/docs/set-up-your-environment) for platform details.

### Clone, install & run

```bash
git clone https://github.com/jon01001010/api
cd api

nvm use                       # match the pinned Node version
yarn install                  # install JS dependencies
(cd ios && pod install)       # iOS only

yarn start                    # Metro bundler
yarn ios                      # build + run on iOS simulator
yarn android                  # build + run on Android emulator
```

Core on-device chat works without any backend keys; only PalsHub/auth features need additional configuration.

> **Native-change rule:** if you change `package.json`, a native module, `ios/`, `android/`, the Podfile, or `build.gradle`, re-run `pod install` and rebuild both platforms — a JS reload won't pick up native changes.

### Quality gates

```bash
yarn lint           # ESLint
yarn typecheck      # tsc --noEmit
yarn test           # Jest
yarn l10n:validate  # validate locale JSON (placeholders, integrity)
```

Run `yarn lint && yarn typecheck && yarn test` before opening a PR. Commits are validated by Commitlint ([Conventional Commits](https://www.conventionalcommits.org/)) via a Husky hook.

<details>
<summary><strong>Repository layout</strong></summary>

<br/>

```
src/
├── screens/        # Chat, Models, Pals, Benchmark, Settings, About, …
├── components/     # Reusable UI
├── store/          # MobX stores (Model, ChatSession, Pal, TTS, HF, Benchmark, …)
├── services/
│   ├── agent/      # AgentRunner — the chat / tool loop
│   ├── talents/    # Tool engines + registries
│   ├── tts/        # TTS engines (kokoro, kitten, supertonic, system)
│   ├── palshub/    # PalsHub marketplace integration
│   └── downloads/  # Model download manager
├── database/       # WatermelonDB schema, models, migrations
├── repositories/   # Data-access layer over the DB
├── locales/        # i18n JSON + lazy loader (index.ts is the registry)
└── hooks/  api/  theme/  utils/  config/  specs/
```
</details>

<details>
<summary><strong>Tech stack</strong></summary>

<br/>

Versions are pinned in [`package.json`](package.json); the highlights:

| Area | Choice |
| --- | --- |
| Framework | React Native `0.82.1`, React `19.1.1` (New Architecture) |
| Language | TypeScript `5.0.4` |
| UI | React Native Paper `5.14.5`, React Navigation |
| State | MobX `6` (`mobx`, `mobx-react`, `mobx-persist-store`) |
| Persistence | WatermelonDB (chat history), AsyncStorage (settings), Keychain (secrets) |
| LLM | `llama.rn` `0.13.0-rc.7` → llama.cpp b11385 · GGUF |
| TTS | `react-native-speech` `2.3.1` + `onnxruntime-react-native` `1.23.2` · ONNX |
| Tooling | Yarn 1 (Classic), ESLint, Prettier, Jest, Husky + Commitlint |

</details>

<details>
<summary><strong>Extending PocketPal</strong></summary>

<br/>

A **Talent** is a tool the model can call mid-conversation. Engines are registered in a `TalentRegistry`, exposed to the model as tool schemas; the `AgentRunner` detects a call, runs the engine, and returns the result for the next turn.

| Talent | Engine | Does |
| --- | --- | --- |
| `calculate` | `CalculateEngine` | Arithmetic / expression evaluation |
| `datetime` | `DatetimeEngine` | Current date / time |
| `render_html` | `RenderHtmlEngine` | Renders model-produced HTML in chat |

Good first contributions:
- A new **Talent** — implement a `TalentEngine` and register it in `src/services/talents/`.
- A new **TTS engine** — add it under `src/services/tts/engines/`.
- A new **locale** — add a JSON file in `src/locales/` (or translate on [Weblate](https://hosted.weblate.org/projects/pocketpal-ai/)).

</details>

## Contributing

Contributions are welcome — bug reports, fixes, features, translations, and docs all help.

1. Fork and branch: `git checkout -b feature/your-feature-name`
2. Make your changes; run on a device/emulator (`yarn ios` / `yarn android`). Re-run `pod install` + rebuild if you touched native code.
3. Gate locally: `yarn lint && yarn typecheck && yarn test`
4. Commit with [Conventional Commits](https://www.conventionalcommits.org/): `git commit -m "feat: add new talent"`
5. Push and open a pull request.

Please read the [Contributing Guidelines](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) first. Want to translate PocketPal into your language? Join us on [Weblate](https://hosted.weblate.org/projects/pocketpal-ai/).

## Roadmap

- **Tool use expansion** — grow the Talents catalog and deepen the agentic loop so Pals can do more, fully on-device.

Have an idea or found a bug? [Open an issue](https://github.com/a-ghorbani/pocketpal-ai/issues/new/choose) or start a [discussion](https://github.com/a-ghorbani/pocketpal-ai/discussions).

## Community & support

- 💬 **Questions & ideas** — [GitHub Discussions](https://github.com/a-ghorbani/pocketpal-ai/discussions)
- 🐛 **Bugs & requests** — [GitHub Issues](https://github.com/a-ghorbani/pocketpal-ai/issues/new/choose)
- 🌐 **Website** — [pocketpal.dev](https://pocketpal.dev/)
- ❤️ **Support development** — PocketPal is free and ad-free; [sponsoring](https://github.com/sponsors/a-ghorbani) helps keep it that way.

## License

Licensed under the [MIT License](LICENSE).

## Acknowledgements

PocketPal AI stands on the shoulders of the open-source community, including:

- **[llama.cpp](https://github.com/ggerganov/llama.cpp)** — efficient on-device LLM inference.
- **[llama.rn](https://github.com/mybigday/llama.rn)** — llama.cpp bindings for React Native.
- **[react-native-speech](https://github.com/a-ghorbani/react-native-speech)** — React Native TTS bridge powering on-device voices.
- **[ONNX Runtime](https://onnxruntime.ai/)** — cross-platform inference engine powering on-device TTS.
- **[React Native](https://reactnative.dev/)**, **[MobX](https://mobx.js.org/)**, **[React Native Paper](https://callstack.github.io/react-native-paper/)**, **[React Navigation](https://reactnavigation.org/)**, **[WatermelonDB](https://github.com/Nozbe/WatermelonDB)**, and many other open-source libraries that make this project possible.

<div align="center">
<br/>

Made with ❤️ for people who want AI that stays on their phone.

<br/>

<sub>If PocketPal is useful to you, consider giving it a ⭐ — it helps others find the project.</sub>

</div>
