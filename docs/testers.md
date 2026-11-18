# Testing PocketAgent and DesktopAgent

Thank you for helping. This is an early, invite-only test. The apps work, but they are not finished, and your job is to find what breaks.

- **PocketAgent**: the Android app.
- **DesktopAgent**: the same app for Windows and Linux.

Both run AI models on your own device. Nothing goes to any server unless you set it up yourself (a cloud model with your own key, web search, model downloads, or the link between your phone and PC). There are no accounts, no analytics and no crash reports. What is kept where: [privacy.md](privacy.md).

## Before you start

- **Use a device you don't depend on**, or at least don't keep anything important only in these apps. A bug could lose chats or files.
- **Expect bugs.** If something is confusing, that counts as a bug too.
- **Don't test the erase PIN on an install you care about.** It really does erase everything the app holds, at once, with no undo.
- **Models are big downloads** (about 1–5 GB each). Use Wi-Fi.
- Don't use the apps for anything where a wrong answer or a wrong action could hurt you or someone else.

## Installing

Every build is on the [Releases](https://github.com/jon01001010/api/releases) page. **Phone and PC builds come in matching sets**: take all of them from the same set; the home link warns "Phone and PC apps differ" when they don't match, and mixed builds aren't supported. Each release has a `SHA256SUMS` file, so you can check the download is the real one (steps below).

### Android (PocketAgent)

1. On the phone, open the release whose name starts with `apk-` and download the `.apk`.
2. Tap it. Android asks to allow installing from your browser or files app; allow it for this install.
3. To update later: install the new `.apk` over the old one. Your chats stay.

GrapheneOS works, and needs no Google Play.

Check the download (optional, on a PC): run `sha256sum PocketAgent-*.apk` and compare the result with the line for that file in `SHA256SUMS`.

### Windows (DesktopAgent)

1. Download the `-setup.exe` from the release whose name starts with `exe-`.
2. Windows says **"Windows protected your PC"** (unknown publisher). This is expected: the app isn't code-signed yet. Click **More info**, then **Run anyway**.
3. To update later: run the new setup. It installs over the old one and keeps your chats and models.

Check the download (optional, in PowerShell): run `Get-FileHash .\DesktopAgent-*-setup.exe` and compare it with `SHA256SUMS` (letter case doesn't matter).

### Linux (DesktopAgent)

From the release whose name starts with `linux-`:

- **AppImage:** download it, make it runnable (`chmod +x DesktopAgent_*.AppImage`), then run it.
- **Debian / Ubuntu:** `sudo apt install ./DesktopAgent_*_amd64.deb`.

ARM64 builds are there too; picture making is switched off on ARM Linux.

Check the download: `sha256sum -c SHA256SUMS --ignore-missing`.

## What to try

Pick what fits your devices; you don't need to do all of it.

**Everyone**
1. First start: go through the welcome screens, download a small model from **Models** (the app suggests sizes that fit your device), load it and chat.
2. **Toolbox**: switch on a few tools (calculator, date/time, workspace files) and ask the model to use them. Anything that writes or reaches out must ask you first; tell us if something didn't.
3. **App PIN** (Settings): set one, leave the app for longer than the minutes you chose, come back. It should ask before showing anything.
4. **Updates**: install the next build over this one. Chats, models and settings should still be there.

**With a PC and a phone**
5. **Home link**: on the PC, Settings → "Use this PC's model from your phone" → Pair a phone; scan the QR code with the phone. Chat with the PC's model from the phone, first at home and then away from home on mobile data.
6. Let the phone answer the PC's "Allow?" questions (switch it on on both), and try the PC's tools from the phone (Toolbox → On your PC).

**PC only**
7. **Pictures**: Toolbox → Image models → download Stable Diffusion 1.5 (small), switch on `image_generate`, ask the chat model for a picture. It can take several minutes on older graphics cards; it should show its progress.
8. **Files outside the workspace**: switch on `outside_files` and ask the model to list your Downloads folder. The PC must ask every time.

**Trying to break it (welcome)**
- Give the model a web page or file that tells it to do something you didn't ask for, and see whether anything happens without asking you.
- Anything the model or a paired device can do without your OK is a serious bug: report it privately (below).

## Reporting

**Normal bugs:** open an issue with the [bug report form](https://github.com/jon01001010/api/issues/new/choose). This repository is **public**: anything you write there, and any screenshot, can be seen by anyone.
- Never post API keys, PINs, QR codes from pairing, private chats or file contents.
- Crop or blur screenshots.

**The build you're on:** Settings → App Info, then the copy button next to the version, and paste it into the report.

**Security problems** (anything that gets around an "Allow?", the PIN, or reads or sends something it shouldn't): **don't open a public issue.** Tell the owner privately: [private contact: the owner fills this in before inviting testers].

## Stopping

- **Android:** uninstall the app. That removes everything it kept.
- **Windows:** uninstall from Settings → Apps; then delete the app's folders in `AppData\Roaming` and `AppData\Local` if you want nothing left.
- **Linux:** remove the AppImage or `sudo apt remove desktop-agent` (check the exact name with `apt list --installed | grep -i agent`); then delete its folders in `~/.local/share`, `~/.config` and `~/.cache` (named after the app).
- Downloaded models are inside those folders; files you saved elsewhere stay where you put them.

Testers who find real bugs are credited, if they want to be.
