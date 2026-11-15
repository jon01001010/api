# Security fixes

Every security fix in PocketAgent (Android) and DesktopAgent (Windows / Linux), newest first. Each one has a test that fails if it is undone (`src/__tests__/securityRules.test.ts`, the Rust tests in `src-tauri` and `native/homelink`, and the tests next to the code). The rules themselves are in [SECURITY.md](../SECURITY.md); how to report a problem is in [.github/SECURITY.md](../.github/SECURITY.md).

No release has been made to other people yet: all of these were found in our own reviews, before release. Credit for outside reports will be given here.

## 2026-11-15: security review 2, builds

- **The phone APK is a release build now, not a debug build.** The test APK was debuggable with React Native's dev support on: someone holding the unlocked phone could read the app's private files (its home link key, chats) over USB with `adb run-as`, and another app on the phone could pretend to be a "Metro" server and have its JavaScript run as PocketAgent at the next start. The published APK is now the release variant (not debuggable, no dev support, the JavaScript built in), and the build fails if it is debuggable. It is still signed with the same public debug key until the owner's key is added, so it installs over the current app.
- **The APK is signed in its own job**, on a fresh runner that ran none of the build's code and has no repository rights, so nothing left behind by a build dependency can reach the signing key.
- **Picture models are checked against their checksums** once the list has them (none yet): a mismatch is deleted; a set marked as checked without a checksum is refused; unchecked sets say "Not verified yet".
- **The Linux picture maker (`sd-cli`) from the build cache must match the checksum recorded when it was built.**

## 2026-11-15: pre-release work

- **Google Sign-In and Google Play billing are no longer built into the Android app.** They were PocketPal's (accounts and paid assistants) and never started in PocketAgent; now their native libraries aren't linked at all, and the code that would use them gets a stand-in that says "not available".
- **Checksums for every download.** Each published build comes with a `SHA256SUMS` file. The APK can be signed with our own release key as soon as that key is added (until then it keeps React Native's public debug key).
- **Pairing codes:** tests now show that a used, an expired or a replaced pairing code is refused, and that codes are compared whole (in constant time).
- The licences screen's llama.cpp entry is checked against the llama.cpp version the desktop builds download.

## 2026-11-15: review of both apps and the link

PC side (DesktopAgent, Rust):

- **Every request through the phone's tunnel is checked**, not just the first one on a connection: one request per stream (a plain `Content-Length` body of at most 16 MB, no `Transfer-Encoding`, nothing pipelined behind it), passed on with `Connection: close`. Before, a second request could ride along behind a checked one.
- **The model server no longer hands out the last conversation:** llama-server runs with `--no-slots` (its `/slots` showed the PC's last prompt).
- **Pictures, sound and video sent through the tunnel must be inline** (`data:`): an address the PC would fetch from inside its home network is refused.
- **`run_command` can't hide what runs:** no carriage returns, control characters or invisible / direction characters, at most 20 lines; the dialog says how many lines and characters it shows.
- **Answers given on a paired device are logged in full** (one escaped line), out of the screens' file space, and the PC user gets a notification at once; the PC's still-open dialog then says it was already answered.
- **The second PC's link key is in the credential store** (Windows Credential Manager; on Linux an owner-only file in the settings folder), moved there from a plain file. The phone's key file is owner-only.
- **Removing a device cuts it off at once:** its open connections close, and it can't ask to pair again for an hour. A paired or lately removed device can't use up a pairing code; a request line must arrive within 10 seconds; one sync at a time per device.
- **Media keys ask in a native dialog** too.

App side (both apps):

- **Custom tools that a sync adds, changes or removes are switched off** before the new list is saved; deleting a tool always switches its name off.
- **A time far in the future no longer wins forever:** times from another device count as at most 5 minutes ahead, and what is applied is stored with this device's own time.
- **Mirrored chats carry only known, checked fields** (no picture paths, audio files, author ids or file names). A copy that would drop or change messages keeps the earlier version for 30 days under "Recently deleted".
- **Pictures sent to a model server:** a web address is never passed on as a picture, and only pictures in the app's own folder are read.
- **Long PC questions on the phone** are never cut at the end (start and end are shown; such a question can only be refused on the phone); invisible and direction characters show as markers.
- **Downloaded (store) assistants are never matched or rewritten by a sync.**
- "Kept in step" notices on the PC show one at a time.

## 2026-11-12

- **The model server's password is no longer on its command line** (where any program on the PC could read it); it is passed by environment.
- **The phone's tunnel passes only model requests, and every one needs the password** (another app on the phone that found the local port got `/health` before).
- **Report, feedback and share-benchmark buttons copy the text** instead of sending it anywhere.

## 2026-11-09

- **No outside connection the user didn't ask for:** PocketPal's reports, feedback and shared benchmarks (to its Firebase service, after a google.com check) are refused before any connection; the device-rules download from a CDN at every phone start is off. The desktop app makes no network calls at start-up.
- **Native calls on Windows were sent through the network layer to themselves** (the 40-second start); both sides now refuse the app's own internal addresses.

## 2026-11-07 / 2026-11-08 (desktop app and home link)

- The desktop app's doors (files, keys, network, previews, the model server, opening things, the PC's tools) are native commands, each listed and allowed by name, and everything outside the app's folder asks in a native dialog.
- Release publishing uses a token limited to this repository, only in the publish steps (a test fails otherwise).
- Pairing: one-time code (10 minutes, one try), QR tag checked, and the PC asks before saving a device; every code made and device paired or removed is shown on the paired phones.

## 2026-11-06: first audit ("off means off")

- **Switched-off tools never run,** whatever an assistant lists or the model names; downloaded assistants can add only harmless tools by themselves.
- **The HTML preview is a closed box:** no WebRTC, frames or pop-ups, no network (CSP), no bridge into the app.
- Security rules written down (SECURITY.md) with tests that guard each one.

## 2026-11-01 to 2026-11-03

- **Reading a web page (`read_url`)** fails closed unless the final address is the one that was allowed: exact scheme, host, port and path; no https → http downgrade on redirects.
- **Model HTML runs only in a network-free sandbox.**
- **Workspace files:** the file size cap is enforced on its own; a text model can't overwrite imported binary files.

## 2026-10-21

- No unauthenticated probe of a cloud server before its key is entered.
