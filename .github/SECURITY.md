# Security policy

This is how to tell us about a security problem in PocketAgent. The rules the apps keep, and the tests that hold them to it, are in [SECURITY.md](../SECURITY.md) at the top of the repository. Fixes made so far are listed in [docs/security-changelog.md](../docs/security-changelog.md). What each app keeps on your devices, and what the relay can see, is in [docs/privacy.md](../docs/privacy.md).

## Reporting a problem privately

Please **don't open a public issue** for a security problem.

Use GitHub's private reporting instead: on this repository, go to **Security → Report a vulnerability** (or "Advisories → New draft security advisory"). Only the maintainers can see the report, and we can talk it through and work on a fix there before anything is made public.

Please include:

- which app and build (App Info shows the build, e.g. "1.21.512 (1a2b3c4)"), and the device / operating system;
- what someone could do, and what they would need first (a paired device, an app on the same phone, the same Wi-Fi, a model's answer, a link or QR code, …);
- the steps to show it, as small as you can make them.

Don't send other people's data, and only test against your own devices and accounts.

## What's in scope

- **PocketAgent**, the Android app (this repository, React Native; `android/`, `src/`, `native/homelink`).
- **DesktopAgent**, the Windows and Linux app (`src-tauri/`, `web/`).
- **The home link** between them: pairing (QR code / pasted code), the encrypted connection, the model tunnel, keeping in step, mirrored chats, and answering the PC's questions on a paired device.
- Anything where the apps' own rules in [SECURITY.md](../SECURITY.md) can be got round: a tool running without its switch or its question, the HTML preview reaching the network or the app, a downloaded assistant doing more than it says, an outside connection the user didn't ask for, a secret stored where it shouldn't be.
- The build and release workflows in `.github/workflows` (what ends up in a download).

Not in scope: problems in the cloud services or model servers a user chooses to connect to, in the models themselves (a model saying something wrong or rude is not a security problem unless it gets past one of the rules above), or on a device that is already taken over (rooted / malware running as the user). Reports about those are still welcome if the apps make them worse.

## What to expect

These are goals, not promises: PocketAgent is a small project.

- **First answer:** within 7 days, to say we have the report.
- **A first view** (whether we can reproduce it and how serious it is): within 14 days.
- **A fix:** as soon as we can; serious problems before any other work. We'll tell you when a test build with the fix is out, and agree with you when the report is made public (normally once the fixed build is out, at most 90 days after the report unless we agree otherwise).
- **Credit:** in [docs/security-changelog.md](../docs/security-changelog.md) and the release notes, if you'd like it (tell us the name to use).

There is no bug bounty.

## Supported versions

Only the newest build of each app gets fixes. There are no long-term versions; please update before reporting.

## Checking a download

Every published build comes with a `SHA256SUMS` file. Check a download before installing it:

- Linux: `sha256sum -c SHA256SUMS --ignore-missing`
- Windows (PowerShell): `Get-FileHash .\DesktopAgent-…-setup.exe -Algorithm SHA256`, and compare with the line in `SHA256SUMS`.
- Android: compare `sha256sum PocketAgent-….apk` (on a computer) with `SHA256SUMS`.

Test builds before the first release are not code-signed yet (see TODO.md, "Signed builds").
