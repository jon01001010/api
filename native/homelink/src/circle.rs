//! Device circle, stage 2: signed removal notices
//! (docs/design/device-circle.md; the same code on the phone and the PC).
//!
//! When the user removes a device on one of their devices ("Remove here" in
//! "Your devices"), that device writes a notice "key X removed, by key Y,
//! number N, at time T", signs it with its own key and hands it to its other
//! paired devices the next time they talk (in the PC's status answer, or the
//! device's "removal" request). A device that receives a notice signed by a
//! device it already trusts removes X too and passes the notice on.
//!
//! A notice can only take trust away: it names one key to remove and
//! nothing else, so it can never add a device or switch a right on. It is
//! ignored when:
//! - it is not exactly a notice (fields, key and signature forms);
//! - its signer is not a device this one trusts (paired either way);
//! - its signature does not hold, over the fixed label REMOVAL_LABEL and its
//!   fields (so no other signed message can pass for one);
//! - it names this device itself (a notice can't make a device remove itself:
//!   the design's recommendation, open question 3);
//! - its time is more than 5 minutes ahead, or more than 30 days old;
//! - its number is not above the highest one seen from that signer (no replay).

use iroh::{PublicKey, SecretKey, Signature};
use serde::{Deserialize, Serialize};

/// Every signed removal starts with this, so a signature over anything else
/// can never pass for a removal (and a removal for anything else).
pub const REMOVAL_LABEL: &str = "PA circle remove v1";
/// A notice's time may be at most this far ahead of this device's clock.
pub const MAX_AHEAD_SECS: u64 = 5 * 60;
/// Older notices are not taken (and are dropped from the outbox).
pub const MAX_AGE_SECS: u64 = 30 * 24 * 60 * 60;
/// Most notices waiting to be passed on (the oldest go first).
pub const MAX_OUTBOX: usize = 8;
/// Most notices sent or taken in one request or status answer.
pub const MAX_NOTICES: usize = 8;
/// Signers whose highest number is remembered (the least recent go first).
pub const MAX_SEEN: usize = 16;
/// Removals waiting for the screens (Home PC entries to remove, to tell the
/// user).
pub const MAX_NEWS: usize = 8;
/// Home PCs this device uses, as last told by the screens.
pub const MAX_USES: usize = 16;

/// One signed removal notice. Nothing else is in it: it can only remove.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Removal {
    /// The key removed.
    pub removed: String,
    /// The key that removed it (and signed this).
    pub by: String,
    /// The signer's own counter, always rising.
    pub n: u64,
    /// When (seconds since 1970, the signer's clock).
    pub at: u64,
    /// Ed25519 signature over signed_text(), 128 hex characters.
    pub sig: String,
}

/// This device's clock (seconds since 1970).
pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Exactly what is signed: the label and every field, one per line.
pub fn signed_text(removed: &str, by: &str, n: u64, at: u64) -> String {
    format!("{REMOVAL_LABEL}\n{removed}\n{by}\n{n}\n{at}")
}

/// A key in its one written form (64 lowercase hex characters).
pub fn canonical_key(key: &str) -> Option<PublicKey> {
    let parsed: PublicKey = key.parse().ok()?;
    (parsed.to_string() == key).then_some(parsed)
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn signature_of(hex: &str) -> Option<Signature> {
    if hex.len() != Signature::LENGTH * 2 || !hex.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
        return None;
    }
    let mut bytes = [0u8; Signature::LENGTH];
    for (i, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(Signature::from_bytes(&bytes))
}

/// Signs a notice removing `removed`, with this device's key.
pub fn sign_removal(key: &SecretKey, removed: &str, n: u64, at: u64) -> Result<Removal, String> {
    let removed = canonical_key(removed.trim()).ok_or("Not a device key")?.to_string();
    let by = key.public().to_string();
    if removed == by {
        return Err("A device can't remove itself".into());
    }
    let sig = to_hex(&key.sign(signed_text(&removed, &by, n, at).as_bytes()).to_bytes());
    Ok(Removal { removed, by, n, at, sig })
}

/// What becomes of a notice received.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    /// Good and new: remove the key here and pass the notice on.
    Apply,
    /// Good, but this device's own or about itself: nothing is done.
    Ignore(&'static str),
    /// Refused (the reason, for tests and logs).
    Refuse(&'static str),
}

/// Checks a notice. `me`: this device's own keys; `trusted`: the devices it
/// is paired with (either way); `last_seen`: the highest number taken from
/// this signer; `now`: this device's clock. Only Apply removes anything.
pub fn check_removal(r: &Removal, me: &[String], trusted: &[String], last_seen: Option<u64>, now: u64) -> Verdict {
    let (Some(_), Some(by)) = (canonical_key(&r.removed), canonical_key(&r.by)) else {
        return Verdict::Refuse("not a device key");
    };
    let Some(sig) = signature_of(&r.sig) else {
        return Verdict::Refuse("not a signature");
    };
    if me.iter().any(|k| *k == r.by) {
        return Verdict::Ignore("sent by this device");
    }
    if !trusted.iter().any(|k| *k == r.by) {
        return Verdict::Refuse("not signed by a device this one trusts");
    }
    if by.verify(signed_text(&r.removed, &r.by, r.n, r.at).as_bytes(), &sig).is_err() {
        return Verdict::Refuse("bad signature");
    }
    if r.at > now.saturating_add(MAX_AHEAD_SECS) {
        return Verdict::Refuse("time ahead");
    }
    if r.at.saturating_add(MAX_AGE_SECS) < now {
        return Verdict::Refuse("too old");
    }
    if last_seen.is_some_and(|seen| r.n <= seen) {
        return Verdict::Refuse("already seen");
    }
    if me.iter().any(|k| *k == r.removed) {
        return Verdict::Ignore("about this device");
    }
    Verdict::Apply
}

/// A notice to pass on, and who has it already (keys, first 16 characters).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Outgoing {
    pub notice: Removal,
    #[serde(default)]
    pub sent: Vec<String>,
}

/// A removal applied here that the screens still have to see (to remove a
/// Home PC entry and tell the user). Names where this device knew them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct News {
    pub removed: String,
    pub by: String,
    pub at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub removed_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub by_name: Option<String>,
    /// This device has told the user already (the PC's own notification).
    #[serde(default)]
    pub told: bool,
}

/// What a device keeps for the circle, where the screens can't write (the
/// PC's credential store; the phone's no-backup folder).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct State {
    /// The last number this device signed with.
    #[serde(default)]
    pub last_n: u64,
    /// Highest number taken per signer, least recent first.
    #[serde(default)]
    pub seen: Vec<(String, u64)>,
    /// Notices to pass on.
    #[serde(default)]
    pub outbox: Vec<Outgoing>,
    /// Removals the screens have not seen yet.
    #[serde(default)]
    pub news: Vec<News>,
    /// The Home PCs this device uses (as the screens last said).
    #[serde(default)]
    pub uses: Vec<String>,
}

fn short(key: &str) -> String {
    key.chars().take(16).collect()
}

impl State {
    pub fn from_json(text: &str) -> State {
        serde_json::from_str(text).unwrap_or_default()
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }

    fn last_seen(&self, by: &str) -> Option<u64> {
        self.seen.iter().find(|(k, _)| k == by).map(|(_, n)| *n)
    }

    fn mark_seen(&mut self, by: &str, n: u64) {
        let top = self.last_seen(by).map_or(n, |old| old.max(n));
        self.seen.retain(|(k, _)| k != by);
        self.seen.push((by.to_string(), top));
        while self.seen.len() > MAX_SEEN {
            self.seen.remove(0);
        }
    }

    fn queue(&mut self, notice: Removal, sent: Vec<String>) {
        self.outbox.push(Outgoing { notice, sent });
        while self.outbox.len() > MAX_OUTBOX {
            self.outbox.remove(0);
        }
    }

    /// Drops notices too old to be taken anywhere.
    pub fn prune(&mut self, now: u64) {
        self.outbox.retain(|o| o.notice.at.saturating_add(MAX_AGE_SECS) >= now);
    }

    /// The Home PCs this device uses, as the screens say now (keys only;
    /// anything else is dropped).
    pub fn set_uses(&mut self, keys: &[String]) {
        self.uses = keys
            .iter()
            .filter(|k| canonical_key(k).is_some())
            .take(MAX_USES)
            .cloned()
            .collect();
        let mut seen = std::collections::HashSet::new();
        self.uses.retain(|k| seen.insert(k.clone()));
    }

    /// Whether this device uses `key` as a Home PC (as the screens said).
    pub fn uses(&self, key: &str) -> bool {
        self.uses.iter().any(|k| k == key)
    }

    /// `key` was removed here: no longer one of the Home PCs this device
    /// trusts (until the screens say so again after pairing anew).
    pub fn forget_used(&mut self, key: &str) {
        self.uses.retain(|k| k != key);
    }

    /// The user removed `removed` here: a notice signed with `key`, queued
    /// for the other devices. Numbers always rise (never below the clock,
    /// so a lost state can't make new notices look old).
    pub fn sign(&mut self, key: &SecretKey, removed: &str, now: u64) -> Result<Removal, String> {
        let n = (self.last_n + 1).max(now);
        let notice = sign_removal(key, removed, n, now)?;
        self.last_n = n;
        self.forget_used(&notice.removed);
        self.queue(notice.clone(), vec![short(&notice.removed)]);
        Ok(notice)
    }

    /// A notice from another device (`from`: the device that handed it
    /// over). On Apply it is remembered (no replay) and queued to be passed
    /// on, once; the caller then removes the key here (forget_used).
    pub fn take(&mut self, notice: &Removal, me: &[String], trusted: &[String], from: Option<&str>, now: u64) -> Verdict {
        let verdict = check_removal(notice, me, trusted, self.last_seen(&notice.by), now);
        match verdict {
            Verdict::Apply => {
                self.mark_seen(&notice.by, notice.n);
                let mut sent = vec![short(&notice.by), short(&notice.removed)];
                sent.extend(from.map(short));
                self.queue(notice.clone(), sent);
            }
            Verdict::Ignore("about this device") => self.mark_seen(&notice.by, notice.n),
            _ => {}
        }
        verdict
    }

    /// The notices `to` doesn't have yet (at most MAX_NOTICES, oldest first).
    pub fn outgoing_for(&self, to: &str, now: u64) -> Vec<Removal> {
        let to = short(to);
        self.outbox
            .iter()
            .filter(|o| !o.sent.contains(&to) && o.notice.at.saturating_add(MAX_AGE_SECS) >= now)
            .take(MAX_NOTICES)
            .map(|o| o.notice.clone())
            .collect()
    }

    /// `to` has these now.
    pub fn mark_sent(&mut self, to: &str, notices: &[Removal]) {
        let to = short(to);
        for o in self.outbox.iter_mut().filter(|o| notices.contains(&o.notice)) {
            if !o.sent.contains(&to) {
                o.sent.push(to.clone());
            }
        }
    }

    pub fn add_news(&mut self, news: News) {
        self.news.push(news);
        while self.news.len() > MAX_NEWS {
            self.news.remove(0);
        }
    }

    /// The news for the screens; given once.
    pub fn take_news(&mut self) -> Vec<News> {
        std::mem::take(&mut self.news)
    }
}

/// Notices read from another device's answer: at most MAX_NOTICES, each
/// exactly a notice (anything else is dropped).
pub fn notices_in(value: Option<&serde_json::Value>) -> Vec<Removal> {
    value
        .and_then(|v| v.as_array())
        .map(|list| {
            list.iter()
                .take(MAX_NOTICES)
                .filter_map(|v| serde_json::from_value(v.clone()).ok())
                .collect()
        })
        .unwrap_or_default()
}

/// The phone's state file, next to its key (owner only, no backup).
pub fn state_file(key_file: &std::path::Path) -> std::path::PathBuf {
    key_file.with_file_name("circle.json")
}

pub fn load(file: &std::path::Path) -> State {
    std::fs::read_to_string(file).map(|t| State::from_json(&t)).unwrap_or_default()
}

pub fn save(file: &std::path::Path, state: &State) -> Result<(), String> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = file.with_extension("new");
    crate::write_private(&tmp, state.to_json().as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, file).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 1_800_000_000;

    fn key(seed: u8) -> SecretKey {
        SecretKey::from_bytes(&[seed; 32])
    }

    fn id(seed: u8) -> String {
        key(seed).public().to_string()
    }

    #[test]
    fn a_notice_is_signed_over_the_label_and_every_field() {
        let notice = sign_removal(&key(1), &id(2), 7, NOW).unwrap();
        assert_eq!(notice.by, id(1));
        assert_eq!(notice.removed, id(2));
        assert_eq!(notice.sig.len(), 128);
        let me = vec![id(3)];
        let trusted = vec![id(1)];
        assert_eq!(check_removal(&notice, &me, &trusted, None, NOW), Verdict::Apply);
        // Any field changed: the signature no longer holds.
        for changed in [
            Removal { removed: id(4), ..notice.clone() },
            Removal { n: 8, ..notice.clone() },
            Removal { at: NOW - 1, ..notice.clone() },
        ] {
            assert_eq!(check_removal(&changed, &me, &trusted, None, NOW), Verdict::Refuse("bad signature"));
        }
        // Signed by someone else, or the signer swapped.
        let other = Removal { by: id(5), ..notice.clone() };
        assert_eq!(check_removal(&other, &me, &[id(5)], None, NOW), Verdict::Refuse("bad signature"));
    }

    /// Domain separation: the same key signing the same fields without the
    /// label (or with another label) does not make a removal.
    #[test]
    fn a_signature_over_anything_else_is_not_a_removal() {
        let k = key(1);
        let fields = format!("{}\n{}\n{}\n{}", id(2), id(1), 7, NOW);
        for text in [fields.clone(), format!("PA circle introduce v1\n{fields}"), format!("PA circle remove v2\n{fields}")] {
            let sig = to_hex(&k.sign(text.as_bytes()).to_bytes());
            let forged = Removal { removed: id(2), by: id(1), n: 7, at: NOW, sig };
            assert_eq!(check_removal(&forged, &[id(3)], &[id(1)], None, NOW), Verdict::Refuse("bad signature"));
        }
        assert_eq!(REMOVAL_LABEL, "PA circle remove v1");
        assert!(signed_text("a", "b", 1, 2).starts_with("PA circle remove v1\n"));
    }

    #[test]
    fn only_a_device_this_one_trusts_can_remove() {
        let notice = sign_removal(&key(1), &id(2), 7, NOW).unwrap();
        assert_eq!(check_removal(&notice, &[id(3)], &[], None, NOW), Verdict::Refuse("not signed by a device this one trusts"));
        assert_eq!(check_removal(&notice, &[id(3)], &[id(9)], None, NOW), Verdict::Refuse("not signed by a device this one trusts"));
    }

    #[test]
    fn a_notice_about_this_device_is_ignored() {
        let notice = sign_removal(&key(1), &id(3), 7, NOW).unwrap();
        assert_eq!(check_removal(&notice, &[id(3)], &[id(1)], None, NOW), Verdict::Ignore("about this device"));
        let mut state = State::default();
        assert_eq!(state.take(&notice, &[id(3)], &[id(1)], None, NOW), Verdict::Ignore("about this device"));
        // Not passed on, nothing for the screens.
        assert!(state.outbox.is_empty());
        assert!(state.news.is_empty());
        // And a device never signs one about itself.
        assert!(sign_removal(&key(1), &id(1), 1, NOW).is_err());
    }

    #[test]
    fn a_time_more_than_five_minutes_ahead_or_a_month_old_is_refused() {
        let me = [id(3)];
        let trusted = [id(1)];
        let ahead = sign_removal(&key(1), &id(2), 7, NOW + MAX_AHEAD_SECS + 1).unwrap();
        assert_eq!(check_removal(&ahead, &me, &trusted, None, NOW), Verdict::Refuse("time ahead"));
        let just = sign_removal(&key(1), &id(2), 7, NOW + MAX_AHEAD_SECS).unwrap();
        assert_eq!(check_removal(&just, &me, &trusted, None, NOW), Verdict::Apply);
        let old = sign_removal(&key(1), &id(2), 7, NOW - MAX_AGE_SECS - 1).unwrap();
        assert_eq!(check_removal(&old, &me, &trusted, None, NOW), Verdict::Refuse("too old"));
    }

    #[test]
    fn a_notice_seen_before_or_an_older_number_is_refused() {
        let me = [id(3)];
        let trusted = [id(1)];
        let mut state = State::default();
        let first = sign_removal(&key(1), &id(2), 10, NOW).unwrap();
        assert_eq!(state.take(&first, &me, &trusted, None, NOW), Verdict::Apply);
        // Replayed, or an older number from the same signer.
        assert_eq!(state.take(&first, &me, &trusted, None, NOW), Verdict::Refuse("already seen"));
        let older = sign_removal(&key(1), &id(4), 9, NOW).unwrap();
        assert_eq!(state.take(&older, &me, &trusted, None, NOW), Verdict::Refuse("already seen"));
        let newer = sign_removal(&key(1), &id(4), 11, NOW).unwrap();
        assert_eq!(state.take(&newer, &me, &trusted, None, NOW), Verdict::Apply);
        // Kept across a restart.
        let again = State::from_json(&state.to_json());
        assert_eq!(again.last_seen(&id(1)), Some(11));
    }

    #[test]
    fn malformed_notices_are_refused() {
        let good = sign_removal(&key(1), &id(2), 7, NOW).unwrap();
        let me = [id(3)];
        let trusted = [id(1)];
        for bad in [
            Removal { removed: "not a key".into(), ..good.clone() },
            Removal { by: good.by.to_uppercase(), ..good.clone() },
            Removal { sig: good.sig[..126].into(), ..good.clone() },
            Removal { sig: good.sig.to_uppercase(), ..good.clone() },
        ] {
            assert!(matches!(check_removal(&bad, &me, &trusted, None, NOW), Verdict::Refuse(_)), "{bad:?}");
        }
        // Extra fields (a flag, a new device) are not a notice at all.
        let mut value = serde_json::to_value(&good).unwrap();
        value["add"] = serde_json::json!(id(9));
        assert!(serde_json::from_value::<Removal>(value.clone()).is_err());
        assert!(notices_in(Some(&serde_json::json!([value]))).is_empty());
        assert_eq!(notices_in(Some(&serde_json::json!([good.clone(), 5, "x"]))), vec![good]);
    }

    /// A notice can only remove: it has one key to remove and nothing else
    /// (no device to add, no right, no name).
    #[test]
    fn a_notice_carries_only_a_key_to_remove() {
        let notice = sign_removal(&key(1), &id(2), 7, NOW).unwrap();
        let value = serde_json::to_value(&notice).unwrap();
        let mut fields: Vec<_> = value.as_object().unwrap().keys().cloned().collect();
        fields.sort();
        assert_eq!(fields, ["at", "by", "n", "removed", "sig"]);
        let source = include_str!("circle.rs");
        let fields = &source[source.find("pub struct Removal {").unwrap()..];
        let fields = &fields[..fields.find('}').unwrap()];
        assert_eq!(fields.matches("pub ").count(), 6);
    }

    #[test]
    fn a_notice_is_passed_on_once_and_not_back() {
        let me = [id(3)];
        let trusted = [id(1), id(5)];
        let mut state = State::default();
        let notice = sign_removal(&key(1), &id(2), 7, NOW).unwrap();
        assert_eq!(state.take(&notice, &me, &trusted, Some(&id(5)), NOW), Verdict::Apply);
        // Not to the signer, the removed device, or the one it came from.
        assert!(state.outgoing_for(&id(1), NOW).is_empty());
        assert!(state.outgoing_for(&id(2), NOW).is_empty());
        assert!(state.outgoing_for(&id(5), NOW).is_empty());
        let out = state.outgoing_for(&id(6), NOW);
        assert_eq!(out, vec![notice.clone()]);
        state.mark_sent(&id(6), &out);
        assert!(state.outgoing_for(&id(6), NOW).is_empty());
        // The same notice again (from another device): not queued twice.
        assert_eq!(state.take(&notice, &me, &trusted, Some(&id(5)), NOW), Verdict::Refuse("already seen"));
        assert_eq!(state.outbox.len(), 1);
        // Own notices coming back are ignored.
        let own = sign_removal(&key(3), &id(2), 8, NOW).unwrap();
        assert_eq!(state.take(&own, &me, &[id(3)], None, NOW), Verdict::Ignore("sent by this device"));
        assert_eq!(state.outbox.len(), 1);
    }

    #[test]
    fn numbers_rise_and_the_queues_are_bounded() {
        let mut state = State::default();
        let first = state.sign(&key(3), &id(2), NOW).unwrap();
        let second = state.sign(&key(3), &id(4), NOW).unwrap();
        assert!(second.n > first.n);
        assert!(first.n >= NOW);
        // A lost state still signs above the clock.
        let mut fresh = State::default();
        assert!(fresh.sign(&key(3), &id(2), NOW + 10).unwrap().n > second.n);
        for i in 0..20u8 {
            state.sign(&key(3), &id(10 + i), NOW).unwrap();
            state.mark_seen(&id(40 + i), 1);
            state.add_news(News { removed: id(2), by: id(1), at: NOW, removed_name: None, by_name: None, told: false });
        }
        assert_eq!(state.outbox.len(), MAX_OUTBOX);
        assert_eq!(state.seen.len(), MAX_SEEN);
        assert_eq!(state.news.len(), MAX_NEWS);
        assert_eq!(state.take_news().len(), MAX_NEWS);
        assert!(state.take_news().is_empty());
        state.prune(NOW + MAX_AGE_SECS + 1);
        assert!(state.outbox.is_empty());
    }

    #[test]
    fn the_state_file_is_private_and_read_back() {
        let dir = std::env::temp_dir().join(format!("homelink-circle-{}", std::process::id()));
        let file = state_file(&dir.join("phone.key"));
        assert_eq!(file.file_name().unwrap(), "circle.json");
        let mut state = State::default();
        state.sign(&key(3), &id(2), NOW).unwrap();
        save(&file, &state).unwrap();
        assert_eq!(load(&file), state);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o600);
        }
        // A broken file is an empty state, never a crash.
        std::fs::write(&file, b"{broken").unwrap();
        assert_eq!(load(&file), State::default());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
