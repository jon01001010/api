# Design: all devices in one circle

Status: **decided** (Option A, owner, 2026-11-15; see "Decided" at the end). **Stage 1 built 2026-11-15** (one key per PC, moved by pairing again by hand; "Your devices" on each device); stages 2-4 not yet. TODO.md item: "All devices in one circle".

## 1. The goal

In the owner's words (TODO.md): *"Windows desktop, Linux laptop, Android phone. Each device pairs once with each other one it should reach (or with one 'home' device that introduces the others, asking on both), so it's a small group of known keys, not an account or a server. … any device can use any other's model (each switched on per device); sync … extended to every device in the circle; tools stay on their own device and ask there (or on another device with the exact question mirrored). Removing a device on any one of them tells the others (signed by a device they already trust)."*

What the user sees, if built as recommended:

- Every device has one list, **"Your devices"**: Desktop, Laptop, Phone. Each row says how it is reached ("direct, 14 ms", "relay", "last seen 2 h ago") and what it may do **on this device**: Model, Keep in step, Chats, Answer questions, Pictures, Tools. All off except Model (as today: pairing means "may use my model").
- **Add a device**: pair as today (QR code or pasted code; this device asks). Later, also **"Introduce to my other devices"**: each other device shows its own dialog, "Desktop introduces 'Laptop' (key 3f2a…). Let it in?", and only a yes there adds it.
- **Remove a device** on any one device: it is cut off there at once, and the others are told the next time they talk ("Phone was removed on Desktop"; removed here too, with a notification).

## 2. What exists today

- **A PC is a hub.** `link.rs` accepts connections; it keeps a list of paired devices (`Phone {id, name, may_answer, may_picture}`, at most 8, in Credential Manager / an owner-only file). Pairing: one-time code (10 min, one try) + the PC's native dialog.
- **Devices dial.** The phone (`native/homelink`) and a second PC (`link_client.rs`, the same library) only dial a PC by its key. The phone never accepts connections (Android would stop it in the background).
- **A PC has two keys** today: its link key (as a hub) and a separate client key (as a device of another PC).
- **Sync is between a device and a hub**: the device sends, the PC's screens merge (`hostSync.web.ts`, `deviceSync.ts`). Newer edit wins per item, times clamped to 5 min ahead, deletions as tombstones (chats, assistants) so a third device doesn't bring something back.
- **Removal** (`link_forget`) cuts the device off at once and locks it out of pairing for an hour, on that PC only. Pairing history is sent to the paired devices with each status.

## 3. Options

### Option A: pair each pair, and tell each other about removals

**How it works.** Each pair that should talk pairs once, as today: Laptop ↔ Desktop (PC to PC, already built), Phone → Desktop, Phone → Laptop (the laptop switches on its own link). Three devices, three pairings. Each device keeps its own list and its own per-device flags. New: when a device is removed on one device, that device writes a **removal notice** ("key X removed, by key Y, at time T, number N"), signs it with its own key, and hands it to its other paired devices when they next talk (in the `status` answer, or a new `circle` request). A device that receives a notice signed by a device it already trusts removes X too, cuts it off, and passes the notice on.

**Code changes.** Small on the link: removal notices (sign, check, store the last ones seen); one key per PC instead of two (below); the phone and laptop managing more than one Home PC; a "Your devices" screen. Sync needs nothing new: each pair keeps in step as today, and tombstones already stop a third device from bringing things back.

**What can go wrong.**
- More pairings for the user (n devices → up to n(n−1)/2; for 3 devices, 3).
- A malicious paired device can remove others (it can only *narrow* trust: a nuisance, seen, fixed by pairing again). A notice can never add anyone.
- Sync between three devices goes in rounds (phone ↔ desktop, desktop ↔ laptop); a change reaches the third device on the next sync, not at once.
- A removed device that is offline still has its keys; it just can't get in anywhere that heard the notice. A device that never talks to the others never hears the notice (shown as "last seen …" so the user can remove it there by hand).

### Option B: a home device introduces the others (signed introductions)

**How it works.** One device is **home** (normally the desktop). A new device pairs with home only, as today. Then home can introduce it: it sends each other member an **introduction** ("key X, name 'Laptop', from home key H, at T, number N, valid 10 minutes"), signed by home. The member shows its own native dialog ("Desktop introduces 'Laptop' …. Let it in?"); the new device shows the matching one about each member. Only when both say yes do the two save each other's keys; all flags start off, as after a normal pairing. An introduction is really a **pairing code carried by a device you already trust**, so the trust step is the same as today: a dialog on each device. Removals: signed notices as in A, accepted from any trusted member.

**Code changes.** A: plus introductions (signed, short-lived, one use), a dialog on each side, and choosing / changing home.

**What can go wrong.**
- A compromised home can send introductions for an attacker's key. Each one still asks on every device, natively, naming the device and key, so it is never automatic; but a user who trusts "Desktop" may click yes. Mitigation: introductions only right after the user pressed "Introduce" on home (home shows the list it is sending), and each receiving device shows the new key.
- Losing home (stolen, broken): the others still trust each other directly (they were introduced pairwise), so nothing breaks; a new home is just whichever device the user introduces from next.

### Option C: one shared circle secret (like an account)

All devices hold one group key; anyone with it is "in". Simple to add a device, but one stolen device keeps the secret for good, a device can't be removed without changing the key on all the others, and no device can have rights the others don't. It is an account in disguise. **Not recommended**; listed so the choice is on record.

### Threat model

| Who | Option A (pairwise + removal notices) | Option B (+ introductions from home) | Option C (shared secret) |
|---|---|---|---|
| **Stolen phone** | Gets what the phone was allowed on each device (model; anything else only where switched on). Remove it on **any** device: cut off there at once, and on the others as soon as they hear. | Same. It can't introduce anyone (only home can, and each device asks). | Gets the circle secret; can't be removed without changing it everywhere. |
| **Malicious paired device** | Can send removal notices (narrowing only; visible; undone by pairing again). Can't add anyone, can't change another device's flags. | Same, plus: if it is home, it can propose introductions, each asked on every device. | Full member, invisible. |
| **Compromised PC** | Has its own data and keys. Can use the others only as far as each allowed it; can't add itself rights. Remove it from another device and the notice spreads. | If it is home: can propose introductions (each asks). Change home. | Has the secret. |
| **Relay / ISP observer** | Sees which keys talk, when, how much (now among 3 devices). Can't read, change or replay notices (encrypted, signed, numbered). | Same. | Same. |
| **Prompt injection / synced text** | The model has no tool for pairing, removing, introducing or flags; synced text is data and never read as a circle command. A poisoned memory note can spread to every device by keeping in step (as today between two); synced custom tools arrive off; "changed on Laptop" is shown. | Same. | Same. |

### How each owner rule holds

- **"Broad access, never automatic"**: adding a device, and every right it gets, asks in a native dialog **on the device that gives the right**. No notice, introduction or sync can turn a flag on. Removal needs no question (it only takes away).
- **"No point in any of this without real security"**: each device decides for itself; signed notices are checked against keys it already trusts; every new message gets its rule test before it ships.
- **"Phone actions always ask"**: unchanged; no device can start a phone action. Tools stay on their own device and ask there (see `phone-uses-pc-tools.md`).
- **No Google, no Apple**: no account, no server of ours; iroh's relays only pass encrypted bytes (as today). Nothing for iPhone.

### Mapping onto iroh keys

- **A device is its iroh key.** Its public key (`EndpointId`, Ed25519) is its name in every list. The link already proves who is on the other end (TLS with pinned keys).
- **One key per device.** Today a PC has a link key and a client key. In the circle, a PC uses its link key for both (the library already takes a key from the caller, `Phone::with_key`). Moving over: the PC sends a short "this client key is me" note signed by both keys to the PCs it is paired with, or the user pairs again (open question 4).
- **Signatures** use the same Ed25519 key (iroh's `SecretKey` can sign and `PublicKey` can check; confirm the calls in iroh 1.4.1). Every signed message starts with a fixed label (`PA circle remove v1` / `PA circle introduce v1`) so a signature can't be reused as anything else, and carries the signer's own counter and a time (times more than 5 minutes ahead are refused, as in sync); a device keeps the highest counter it saw per signer, so an old notice can't be replayed.

### Key storage

As today: Windows Credential Manager; on Linux an owner-only file in the settings folder; on the phone an owner-only file in the no-backup folder. The circle list (members, flags, last counters, notices) is kept in the same place, under names the screens can't write. The credential store's entry size limits the list to about 8 devices; a bigger circle needs a sealed file instead. Sealing the key to the device (Windows DPAPI / TPM, an Android Keystore key wrapping the phone's key file) is a separate, later stage (TODO "Keys at rest").

### Which device may do what on which

Rights are always **given by the device that does the work**, per device, off by default, asked in that device's native dialog:

| Right (on device G, for device U) | Today | In the circle |
|---|---|---|
| Use G's model | given by pairing | the same, per pair |
| Keep in step / mirror chats | switch on both | switch on both, per pair |
| Answer G's "Allow?" questions | `may_answer` on G | the same, per pair |
| Pictures from G | `may_picture` on G | the same |
| G's tools | — | `may_read` / `may_act` / `may_command` (other design) |

The phone can only *use* others (it never accepts connections). A phone that gives something (its model to the laptop, its questions to the PC) would need the phone to listen in the background: out of scope here.

## 4. Recommendation: Option A now, introductions (B) later

Why: A uses only what works today (pairing with a code and a native dialog) and adds one small, safe-by-shape message (removal can only narrow trust). B's introductions are a convenience that can come on top without changing trust: each is a pairing that still asks on each device.

| Stage | What | Tests / pins | Effort |
|---|---|---|---|
| **1. One key per device, "Your devices" list** | A PC uses its link key as a device too; the phone and a PC can hold several Home PCs; one list of paired devices with their rights; the flags kept per device in the protected store. | A PC's client key is its link key (or the signed move note is checked); flags default off for every new and old record; flags are written only after the giving device's own dialog (`ask_on_this_pc`). | ~1–1.5 weeks |
| **2. Signed removal notices** | Remove on one device → signed notice → others remove too, cut off at once, notify, pass it on. | A notice from an unknown key, with a bad signature, a wrong label, an old counter or a time over 5 min ahead is ignored (Rust tests); a notice can only remove (never add or change a flag); a notice naming the receiving device itself is ignored; the removed device is cut off and locked out of pairing for an hour, as with `link_forget`. | ~1 week |
| **3. Keeping in step across three** | Each PC can be both hub and device; the phone keeps in step with each PC it is paired with. Check that three devices settle on the same result (tombstones, 5-minute clamp, "recently deleted"). | A three-device test (A↔B, B↔C, A↔C in different orders) ends with the same items and no deleted item coming back. | ~1 week |
| **4. Introductions from home** | "Introduce to my other devices" on home; dialog on each receiving device and on the new device; one use, 10 minutes. | An introduction never saves a key without the receiving device's own dialog; one use; 10 minutes; signed by a key this device trusts; label and counter checked; the model has no tool to introduce. | ~2 weeks |
| **Later** | Seal keys to the device; an own relay; more than 8 devices. | — | 1–2 weeks each |

SECURITY.md rule 6 and `docs/privacy.md` are updated at each stage (who can remove whom, what the notices contain, that relays now see three devices talk).

## 5. Open questions for the owner

1. Who may send a removal that the others obey? (a) any device in the circle (recommended: removal only takes away); (b) only home; (c) none, remove on each device by hand.
2. Introductions from a home device: (a) build later, after stages 1–3 (recommended); (b) never, always pair each pair; (c) build first.
3. Can a device be told to remove **itself** from the circle (e.g. "this phone was stolen, wipe its list")? (a) no, a notice about yourself is ignored (recommended); (b) yes, it forgets its pairings.
4. Moving a PC to one key: (a) automatic, with a note signed by both keys (recommended); (b) pair again by hand.
5. Should a device that **receives** a removal notice ask first? (a) no, remove and tell the user (recommended); (b) ask "Laptop says Phone was removed. Remove it here too?".
6. Rights in the circle: (a) each right given per pair, as now (recommended); (b) also a "same rights on all my devices" shortcut (each device still asks once).

## Decided (owner, 2026-11-15)

Option A now. 6a: any device's signed removal is obeyed. 7a: introductions later, after stages 1–3. 8b: moving a PC to one key means pairing again by hand. 9a: a received removal is applied and the user is told. 10a: permissions per pair.
