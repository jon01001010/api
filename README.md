<div align="center">

<img src="assets/pocketagent-brand.svg" alt="PocketAgent blue robot logo and branding" width="520" />

</div>

# PocketAgent

**Private experimental Android app — work in progress. Not ready for public release.**

PocketAgent is an on-device AI agent for Android, forked from [PocketPal AI](https://github.com/a-ghorbani/pocketpal-ai): local GGUF models, tools with your approval, persistent memory, and a private file workspace.

**Built for future phones and models.** Today's test phone and small models are only a development stand-in; the app is not tuned for them. Expect it to make full use of newer phones (more memory, faster NPUs) and larger local models as they arrive.

## What it does today

- **Local models** through llama.cpp / llama.rn (CPU). No account, works offline.
- **Agent tools**, each switched on in Toolbox, with approval before anything is written:
  - workspace files: read, create, edit, append, patch, diff, history, undo;
  - memory: User Memory (yours, read-only to the model) and Model Memory (model edits need approval), with snapshot history;
  - live HTML previews in a network-free sandbox, with Save as `.html`;
  - calculator, date/time;
  - web search and page reading (bring your own key).
- **Phosphor style**: an optional green-CRT terminal look, recolourable with R/G/B sliders (Settings → App Settings).
- **Local text API** (experimental) for other apps on the phone.
- **Hardware diagnostics** for the phone and the inference backends it finds.

Not yet verified: NPU offload (on hold until a newer test phone). `read_url` currently refuses every page until the readers report a verified final URL (see `TODO.md`). Purchases and PalsHub from upstream are switched off.

This repository is a development fork, not an official PocketAgent release. Do not rely on it for critical data or unattended device actions.

## Android test builds

Every successful APK build is published as a **pre-release** with a direct `.apk` download on the [Releases](https://github.com/jon01001010/api/releases) page: open it on the phone and tap the file to install. Builds run on pushes to `main` and on demand from [Actions](https://github.com/jon01001010/api/actions) ("PocketAgent integration APK", stage `apk`).

The **Tests** workflow runs the type check and the full Jest suite on every pull request and push to `main`.

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
<summary><strong>Extending PocketAgent</strong></summary>

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
- A new **locale** — add a JSON file in `src/locales/`.

</details>

## Contributing

Contributions are welcome — bug reports, fixes, features, translations, and docs all help.

1. Fork and branch: `git checkout -b feature/your-feature-name`
2. Make your changes; run on a device/emulator (`yarn ios` / `yarn android`). Re-run `pod install` + rebuild if you touched native code.
3. Gate locally: `yarn lint && yarn typecheck && yarn test`
4. Commit with [Conventional Commits](https://www.conventionalcommits.org/): `git commit -m "feat: add new talent"`
5. Push and open a pull request.

Upstream's [contributing guidelines](extras/upstream-community/CONTRIBUTING.md) and [code of conduct](extras/upstream-community/CODE_OF_CONDUCT.md) are kept in `extras/`.

## Roadmap

- **Tool use expansion** — grow the Talents catalog and deepen the agentic loop so Pals can do more, fully on-device.

Have an idea or found a bug? [Open an issue](https://github.com/jon01001010/api/issues/new).

## Community & support

- 🐛 **Bugs & requests** — [GitHub Issues](https://github.com/jon01001010/api/issues)
- ❤️ **Upstream** — PocketAgent builds on PocketPal AI; you can [sponsor its original author](https://github.com/sponsors/a-ghorbani).

## License

Licensed under the [MIT License](LICENSE).

## Acknowledgements

PocketAgent stands on the shoulders of the open-source community, including:

- **[llama.cpp](https://github.com/ggerganov/llama.cpp)** — efficient on-device LLM inference.
- **[llama.rn](https://github.com/mybigday/llama.rn)** — llama.cpp bindings for React Native.
- **[react-native-speech](https://github.com/a-ghorbani/react-native-speech)** — React Native TTS bridge powering on-device voices.
- **[ONNX Runtime](https://onnxruntime.ai/)** — cross-platform inference engine powering on-device TTS.
- **[React Native](https://reactnative.dev/)**, **[MobX](https://mobx.js.org/)**, **[React Native Paper](https://callstack.github.io/react-native-paper/)**, **[React Navigation](https://reactnavigation.org/)**, **[WatermelonDB](https://github.com/Nozbe/WatermelonDB)**, and many other open-source libraries that make this project possible.

<div align="center">
<br/>

Made with ❤️ for people who want AI that stays on their phone.

<br/>

<sub>If PocketAgent is useful to you, consider giving it a ⭐ — it helps others find the project.</sub>

</div>
