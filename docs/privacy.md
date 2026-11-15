# What is kept where, and who can see what

Plain answers for users of PocketAgent (Android) and DesktopAgent (Windows / Linux). The rules behind this are in [SECURITY.md](../SECURITY.md).

**In short:** your chats, memory, files and models stay on your own devices. Nothing is sent anywhere unless you set it up (a cloud model, web search, a model download, the home link). There are no accounts, no analytics and no crash reports. Anyone who can run programs as you on the device, or who has a rooted phone, can read what the app keeps; the app can't protect against that.

## On the phone (PocketAgent)

All of it is in the app's private storage, which other apps can't read (unless the phone is rooted). Android's cloud backup is switched off for the app.

| What | Where |
|---|---|
| Chats | The app's database (private storage). |
| Memory notes (yours and the model's), with their history | Files in the app's private storage. |
| Workspace files (pictures, documents you add or the model writes) | The app's private storage (`PocketAgentFiles`). |
| Models | The app's private storage. |
| API keys for cloud models and servers you add; the Home PC's model password | Android's keystore (encrypted, tied to this phone). |
| The phone's home link key (who this phone is to your PC) | A file only the app can read, in a folder that is never backed up. Readable on a rooted phone. |
| Paired PCs | The app's settings (private storage): their public key and name. |
| Settings, assistants, custom tools | The app's private storage. |

## On the PC (DesktopAgent)

| What | Where |
|---|---|
| Chats | The app's own web storage (the system web view's data for the app, in your user profile). |
| Memory, workspace files, models | The app's data folder (Windows: `AppData\Roaming`; Linux: `~/.local/share`). |
| API keys | Windows Credential Manager; on Linux the system key store. |
| The PC's home link key and the list of paired devices | Windows Credential Manager; on Linux an owner-only file in the settings folder (`~/.config/…/link`). Not in the data folder the app's screens can reach. |
| Pairing history (codes made, devices paired or removed) | Same place as the link key. Paired devices are shown it. |
| A second PC's link key (when it is paired to a main PC) | Same as above. |
| The log of questions answered on a paired device (`answers.log`) | Linux: the settings folder; Windows: `AppData\Local`. Not reachable by the screens without asking. |
| The model server's password | Made new at every model start, kept in memory only, passed to the model server privately (not on its command line). |

**Anything running as you on the PC can read Credential Manager and these files.** A copied link key would let someone pose as that PC (sealing the key to the PC is being considered). If you think a device or key is compromised, remove the device in the PC's list: it is cut off at once.

## What the home link sends, and what others can see

The link between your phone and PC (or two PCs) is encrypted end to end (QUIC with TLS 1.3). Each device is pinned by its key, chosen when you paired them.

**What travels over it:** model requests and answers (when you use the PC's model from the phone), the status of the PC's model, and, only if you switched them on on both sides, kept-in-step settings, mirrored chats and the PC's "Allow?" questions and your answers.

**What others can see (metadata, never the content):**

- Your internet provider, the Wi-Fi or hotspot you are on: that the two devices talk, their IP addresses, when, and roughly how much.
- number0's public relay and discovery servers (the iroh project's own; used to find the other device, and to pass the encrypted data on when no direct path works): which device keys connect, their IP addresses, when and how much. They can't read or change what is sent.

**Never sent by the link:** your files, models, API keys, the link keys themselves, anything you didn't switch on.

## What never leaves the device

- Your link keys and API keys (an API key goes only to the service it is for, when you use it).
- Models and workspace files (pictures stay on the device they were taken on, even in mirrored chats).
- Memory and chats, unless you switch on keeping in step / mirroring for a paired device of your own.
- Nothing is ever sent to us. PocketAgent has no servers.

## Outside connections

Every outside address the phone app can contact, and when, is listed in [SECURITY.md](../SECURITY.md), rule 7.
