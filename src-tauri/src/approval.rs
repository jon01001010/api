//! The "Allow?" dialog, shown by the native side so the web screens can't
//! skip it. Used for everything outside the app's own folder.
//!
//! While the user allows it on this PC, the same question is also offered
//! to paired devices (remote_ask.rs): the first answer wins, and a device
//! can only allow once. Pairing itself is asked on this PC only.
//!
//! Security review 2026-11-17:
//! - "Don't allow" is the first button, so it is the default (Enter) on
//!   Windows; closing the dialog (Esc, the window's X) is "Don't allow"
//!   too. The dialogs are rfd's own (the dialog plugin maps closing to
//!   its last button, which would be a yes here).
//! - One dialog at a time, across the app: the others wait their turn
//!   (a question a device answers while waiting is never shown here).
//! - MAX_REFUSALS refusals in a row from the same asker (Asker) within a
//!   minute: it can't ask again for COOL_DOWN.
//!
//! Security review 2 (2026-11-18):
//! - Refusals are counted per asker: this PC's own screens, this PC's model
//!   and each paired device on their own (`Asker`), so the model's
//!   refusals can't block the user's own screens' questions.
//! - At most one question waiting per asker; another one from the same
//!   asker is refused at once (`ALREADY_WAITING`).
//! - The cool-down and the app lock are looked at again right before a
//!   dialog shows (in_turn), not only when it was asked.
//! - While the app is locked (app_lock.rs), questions wait for the unlock
//!   (at most app_lock::LOCKED_WAIT) and are then refused
//!   (app_lock::LOCKED_REFUSAL); they are not offered to paired devices
//!   while they wait, and notifications say nothing about them.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

/// The safe answer, first (the default button).
pub const DONT: &str = "Don't allow";
pub const ALLOW: &str = "Allow";

/// Who asks. Each counts its refusals and its one waiting question on its
/// own.
#[derive(Clone, Debug, PartialEq)]
pub enum Asker {
    /// This PC's own screens, for the user's own actions (pairing, a
    /// device's switches, a screenshot, a model file from elsewhere).
    Screens,
    /// This PC's model: its tools (ask_for without a device) and its files
    /// outside the workspace (outside.rs).
    Model,
    /// A paired device, by its key.
    Device(String),
}

/// ask_as / ask_for: no device is this PC's model (only the model's tools
/// come through them without a device).
impl From<Option<&str>> for Asker {
    fn from(device: Option<&str>) -> Self {
        match device {
            Some(key) => Asker::Device(key.to_string()),
            None => Asker::Model,
        }
    }
}

impl Asker {
    /// Its key in Refusals and the waiting list.
    pub fn key(&self) -> String {
        match self {
            Asker::Screens => "pc:screens".into(),
            Asker::Model => "pc:model".into(),
            Asker::Device(key) => format!("device:{key}"),
        }
    }

    /// The device's key, if a device asks (it alone may see the private
    /// parts of its question, remote_ask::shared_view).
    fn device(&self) -> Option<&str> {
        match self {
            Asker::Device(key) => Some(key),
            _ => None,
        }
    }

    /// How the user is told who it is.
    pub fn who(&self) -> String {
        match self {
            Asker::Device(key) => format!("the paired device {}", crate::remote_ask::short_key(key)),
            Asker::Model => "this PC's model".to_string(),
            Asker::Screens => "this PC's app".to_string(),
        }
    }
}

// Why a question was refused without being asked, for whoever wants to
// pass it on (link.rs gives it to the asking device; with_reason).
tokio::task_local! {
    static WHY: RefCell<Option<String>>;
}

fn note_why(text: &str) {
    let _ = WHY.try_with(|why| *why.borrow_mut() = Some(text.to_string()));
}

/// Runs `job`; also returns why a question in it was refused without
/// being asked (cool-down, one already waiting, the app locked), if one
/// was. None when every question was asked (and answered either way).
#[cfg_attr(not(feature = "link"), allow(dead_code))]
pub async fn with_reason<F: Future>(job: F) -> (F::Output, Option<String>) {
    WHY.scope(RefCell::new(None), async move {
        let out = job.await;
        let why = WHY.with(|why| why.borrow_mut().take());
        (out, why)
    })
    .await
}

/// One native dialog at a time, across the app.
fn turn() -> Arc<tokio::sync::Mutex<()>> {
    static TURN: OnceLock<Arc<tokio::sync::Mutex<()>>> = OnceLock::new();
    TURN.get_or_init(|| Arc::new(tokio::sync::Mutex::new(()))).clone()
}

/// Why a dialog was not shown after all.
#[derive(Debug, PartialEq)]
pub enum NotShown {
    /// Answered elsewhere while it waited its turn.
    Answered,
    /// The app stayed locked (app_lock::LOCKED_WAIT).
    Locked,
    /// Its asker began to cool down while it waited (the message).
    Cooling(String),
}

/// Runs `show` (a blocking dialog) when no other dialog is up. Not shown
/// when `skip` was set while it waited (answered elsewhere meanwhile),
/// when the app is locked and stays locked (app_lock::LOCKED_WAIT), or
/// when its asker began to cool down meanwhile (looked at again right
/// before showing).
fn in_turn<T: Send + 'static>(
    asker: Option<Asker>,
    skip: Arc<AtomicBool>,
    show: impl FnOnce() -> T + Send + 'static,
) -> tauri::async_runtime::JoinHandle<Result<T, NotShown>> {
    tauri::async_runtime::spawn(async move {
        let mine = turn().lock_owned().await;
        if skip.load(Ordering::SeqCst) {
            return Err(NotShown::Answered);
        }
        if !crate::app_lock::wait_unlocked(crate::app_lock::LOCKED_WAIT).await {
            return Err(NotShown::Locked);
        }
        if skip.load(Ordering::SeqCst) {
            return Err(NotShown::Answered);
        }
        if let Some(asker) = &asker {
            if let Err(message) = refusals().lock().unwrap().check(&asker.key(), &asker.who(), Instant::now()) {
                return Err(NotShown::Cooling(message));
            }
        }
        tauri::async_runtime::spawn_blocking(move || {
            let _mine = mine;
            show()
        })
        .await
        .map_err(|_| NotShown::Answered)
    })
}

/// A native message dialog (rfd, started on the main thread as the dialog
/// plugin does), waited for on this blocking thread. Anything unexpected
/// is Cancel.
fn native(
    app: &AppHandle,
    title: &str,
    text: &str,
    level: rfd::MessageLevel,
    buttons: rfd::MessageButtons,
) -> rfd::MessageDialogResult {
    let (tx, rx) = std::sync::mpsc::channel();
    let (title, text) = (title.to_string(), text.to_string());
    let sent = app.run_on_main_thread(move || {
        let shown = rfd::AsyncMessageDialog::new()
            .set_title(title)
            .set_description(text)
            .set_level(level)
            .set_buttons(buttons)
            .show();
        std::thread::spawn(move || {
            let _ = tx.send(tauri::async_runtime::block_on(shown));
        });
    });
    if sent.is_err() {
        return rfd::MessageDialogResult::Cancel;
    }
    rx.recv().unwrap_or(rfd::MessageDialogResult::Cancel)
}

/// The buttons of a plain "Allow?": "Don't allow" first (the default).
pub fn allow_buttons() -> rfd::MessageButtons {
    rfd::MessageButtons::OkCancelCustom(DONT.into(), ALLOW.into())
}

/// True only for the Allow button itself; closing the dialog, "Don't
/// allow" or anything unexpected is no.
pub fn allowed_by(result: &rfd::MessageDialogResult) -> bool {
    matches!(result, rfd::MessageDialogResult::Custom(label) if label == ALLOW)
}

/// After this many refusals in a row from one asker, each within
/// REFUSALS_WITHIN of the last, it can't ask again for COOL_DOWN.
pub const MAX_REFUSALS: u32 = 3;
pub const REFUSALS_WITHIN: Duration = Duration::from_secs(60);
pub const COOL_DOWN: Duration = Duration::from_secs(120);

/// Refusals in a row per asker (Asker::key): (count, last refusal,
/// cooling down until).
#[derive(Default)]
pub struct Refusals {
    map: HashMap<String, (u32, Instant, Option<Instant>)>,
}

impl Refusals {
    /// Err with what the user is told while this asker cools down.
    pub fn check(&mut self, asker: &str, who: &str, now: Instant) -> Result<(), String> {
        if let Some((_, _, Some(until))) = self.map.get(asker) {
            if now < *until {
                let left = until.saturating_duration_since(now).as_secs().max(1);
                return Err(cooling_message(who, left));
            }
            self.map.remove(asker);
        }
        Ok(())
    }

    /// An answer: a yes clears the count; a no adds one (a new run if the
    /// last no was more than REFUSALS_WITHIN ago), and the MAX_REFUSALS-th
    /// starts the cool-down. True when it just started.
    pub fn record(&mut self, asker: &str, yes: bool, now: Instant) -> bool {
        if yes {
            self.map.remove(asker);
            return false;
        }
        let entry = self.map.entry(asker.to_string()).or_insert((0, now, None));
        if now.saturating_duration_since(entry.1) > REFUSALS_WITHIN {
            entry.0 = 0;
        }
        entry.0 += 1;
        entry.1 = now;
        if entry.0 >= MAX_REFUSALS {
            *entry = (0, now, Some(now + COOL_DOWN));
            return true;
        }
        false
    }
}

/// What the user is told while an asker cools down.
pub fn cooling_message(who: &str, seconds: u64) -> String {
    format!(
        "You said no to {MAX_REFUSALS} questions in a row from {who}, so it can't ask again for {seconds} s. Nothing was done."
    )
}

fn refusals() -> &'static Mutex<Refusals> {
    static R: OnceLock<Mutex<Refusals>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(Refusals::default()))
}

/// What an asker is told when it asks while its last question still waits.
pub fn already_waiting(who: &str) -> String {
    format!("{who} already has a question waiting on this PC, so this one was refused at once. Answer that one first. Nothing was done.")
}

/// The askers with a question waiting (Asker::key): one each.
#[derive(Default)]
pub struct Waiting {
    keys: HashSet<String>,
}

impl Waiting {
    /// True if `key` had none waiting (it has one now).
    pub fn take(&mut self, key: &str) -> bool {
        self.keys.insert(key.to_string())
    }

    pub fn release(&mut self, key: &str) {
        self.keys.remove(key);
    }
}

fn waiting() -> &'static Mutex<Waiting> {
    static W: OnceLock<Mutex<Waiting>> = OnceLock::new();
    W.get_or_init(|| Mutex::new(Waiting::default()))
}

/// An asker's one waiting question: freed when dropped (answered,
/// refused, or the request went away).
struct WaitTurn(String);

impl WaitTurn {
    fn take(asker: &Asker) -> Option<Self> {
        let key = asker.key();
        waiting().lock().unwrap().take(&key).then_some(WaitTurn(key))
    }
}

impl Drop for WaitTurn {
    fn drop(&mut self) {
        waiting().lock().unwrap_or_else(|e| e.into_inner()).release(&self.0);
    }
}

fn tell_cooling(app: &AppHandle, message: String) {
    crate::app_lock::notify(app, "DesktopAgent stopped asking", &message);
}

/// Whether `asker` may ask now; tells the PC user (a notification) when not.
fn may_ask(app: &AppHandle, asker: impl Into<Asker>) -> bool {
    let asker = asker.into();
    let checked = refusals().lock().unwrap().check(&asker.key(), &asker.who(), Instant::now());
    match checked {
        Ok(()) => true,
        Err(message) => {
            note_why(&message);
            tell_cooling(app, message);
            false
        }
    }
}

fn answered(app: &AppHandle, asker: &Asker, yes: bool) {
    if refusals().lock().unwrap().record(&asker.key(), yes, Instant::now()) {
        tell_cooling(app, cooling_message(&asker.who(), COOL_DOWN.as_secs()));
    }
}

/// Before a question goes up: its asker's one waiting place (refused at
/// once when it has a question waiting already) and, while the app is
/// locked, the wait for the unlock (refused when it stays locked). None:
/// refused, the reason noted (with_reason).
async fn get_ready(asker: &Asker) -> Option<WaitTurn> {
    let Some(place) = WaitTurn::take(asker) else {
        note_why(&already_waiting(&asker.who()));
        return None;
    };
    if !crate::app_lock::wait_unlocked(crate::app_lock::LOCKED_WAIT).await {
        note_why(crate::app_lock::LOCKED_REFUSAL);
        return None;
    }
    Some(place)
}

/// A dialog that was not shown: noted (with_reason), and the PC user told
/// when its asker began to cool down meanwhile.
fn not_shown(app: &AppHandle, why: NotShown) {
    match why {
        NotShown::Answered => {}
        NotShown::Locked => note_why(crate::app_lock::LOCKED_REFUSAL),
        NotShown::Cooling(message) => {
            note_why(&message);
            tell_cooling(app, message);
        }
    }
}

const TITLE: &str = "DesktopAgent: allow this?";

/// Waits for this PC's dialog or, while allowed, a paired device's answer,
/// whichever comes first. A device answer is logged on this PC. `asker`:
/// who asked; only the device that asked may see the private parts of the
/// question (remote_ask::shared_view). None: refused before it was shown
/// (with_reason says why).
async fn first_answer<T: Send + 'static>(
    app: &AppHandle,
    question: &str,
    asker: &Asker,
    show: impl FnOnce() -> T + Send + 'static,
    from_device: impl FnOnce(bool) -> T,
) -> Option<T> {
    let skip = Arc::new(AtomicBool::new(false));
    let dialog = in_turn(Some(asker.clone()), skip.clone(), show);
    let questions = app.state::<crate::remote_ask::RemoteQuestions>();
    let Some((id, device)) = questions.open(question, asker.device()) else {
        return match dialog.await {
            Ok(Ok(answer)) => Some(answer),
            Ok(Err(why)) => {
                not_shown(app, why);
                None
            }
            Err(_) => None,
        };
    };
    let mut dialog = dialog;
    let answer = tokio::select! {
        here = &mut dialog => match here {
            Ok(Ok(answer)) => Some(answer),
            Ok(Err(why)) => {
                not_shown(app, why);
                None
            }
            Err(_) => None,
        },
        // Expired or closed on the device side: wait for this PC's dialog.
        Ok((yes, name)) = device => {
            // Still waiting for its turn here: never shown.
            skip.store(true, Ordering::SeqCst);
            crate::remote_ask::log_answer(app, &name, yes, question);
            answered_on_device(app, &name, yes, question, dialog);
            Some(from_device(yes))
        }
    };
    questions.close(id);
    answer
}

/// A device answered first. The PC user is told at once (a notification;
/// nothing about the question while the app is locked), and the PC's own
/// dialog, if it is up (it can't be closed from here), stays harmless:
/// whatever is pressed there now changes nothing, and a note says so.
fn answered_on_device<T: Send + 'static>(
    app: &AppHandle,
    device: &str,
    yes: bool,
    question: &str,
    dialog: tauri::async_runtime::JoinHandle<Result<T, NotShown>>,
) {
    let note = crate::remote_ask::answered_note(device, yes, question);
    crate::app_lock::notify(app, &format!("Answered on {device}"), &note);
    let app = app.clone();
    let device = device.to_string();
    tauri::async_runtime::spawn(async move {
        // The PC user pressed a button (or closed it): nothing more is done.
        // Never shown (it was still waiting its turn): nothing to say.
        if !matches!(dialog.await, Ok(Ok(_))) {
            return;
        }
        let text = format!("This was already answered on {device}, so your answer here changed nothing.\n\n{note}");
        let app2 = app.clone();
        let _ = in_turn(None, Arc::new(AtomicBool::new(false)), move || {
            native(&app2, "DesktopAgent: already answered", &text, rfd::MessageLevel::Info, rfd::MessageButtons::Ok)
        })
        .await;
    });
}

/// The plain "Allow?" for `asker`, after may_ask: its one waiting place,
/// the app lock, then this PC's dialog or (while allowed) a device's
/// answer. The answer counts towards its refusals; a question refused
/// before it was shown does not.
async fn ask_checked(app: &AppHandle, question: &str, asker: Asker) -> bool {
    let Some(_place) = get_ready(&asker).await else {
        return false;
    };
    let app2 = app.clone();
    let text = question.to_string();
    let show = move || allowed_by(&native(&app2, TITLE, &text, rfd::MessageLevel::Warning, allow_buttons()));
    let Some(yes) = first_answer(app, question, &asker, show, |yes| yes).await else {
        return false;
    };
    answered(app, &asker, yes);
    yes
}

/// Asks the user; true only if they press Allow (here, or on a paired
/// device while that is allowed). Asked by this PC's own screens (the
/// screenshot).
pub async fn ask(app: &AppHandle, question: &str) -> bool {
    if !may_ask(app, Asker::Screens) {
        return false;
    }
    ask_checked(app, question, Asker::Screens).await
}

/// `ask`, naming who asks: a paired device's key (it alone may see the
/// private parts of the question, remote_ask::shared_view), or None for
/// this PC's model (its tools, through ask_for). Refused at once while
/// that asker cools down (Refusals) or has a question waiting already
/// (Waiting); while the app is locked it waits for the unlock (app_lock).
pub async fn ask_as(app: &AppHandle, question: &str, asker: Option<&str>) -> bool {
    if !may_ask(app, asker) {
        return false;
    }
    ask_checked(app, question, asker.into()).await
}

/// A paired device asking for one of this PC's tools (link.rs "tool"): its
/// name goes into the question, and `still_allowed` is looked at again
/// after the answer (the PC's switches or the device may have changed
/// while the question was up). `id`: its key (remote_ask::shared_view:
/// only it sees the private parts of its own question).
pub struct Device<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub still_allowed: &'a (dyn Fn() -> bool + Sync),
}

/// `ask`, for one of this PC's own tools, asked by this PC's screens
/// (`by`: None) or by a paired device: the same native "Allow?" every
/// time (Allow or Don't allow, never "always"; a device that may answer
/// can answer it, the asking one too: owner decision 1c). For a device,
/// true only if it is still allowed after the answer.
///
/// `thinking`: the model's thinking from just before the request (from
/// the chat that asks), shown after the facts under MODEL_THINKING
/// (with_thinking) and never parsed. Every question and its answer go
/// to the answers log with the thinking (remote_ask::log_asked). Other
/// devices never get the thinking (remote_ask::shared_view).
pub async fn ask_for(app: &AppHandle, question: &str, by: Option<&Device<'_>>, thinking: Option<&str>) -> bool {
    let yes = ask_as(app, &with_thinking(question, thinking), by.map(|d| d.id)).await
        && by.is_none_or(|d| (d.still_allowed)());
    crate::remote_ask::log_asked(app, by.map(|d| d.name), yes, question, thinking);
    yes
}

/// The label above the model's thinking in a question (the same in the
/// app: chatGuard.ts MODEL_THINKING). Always after the facts and after
/// the model's own words.
pub const MODEL_THINKING: &str = "The model was thinking:";
/// Most characters of the thinking shown: the last ones (what led to the
/// request).
pub const MAX_THINKING: usize = 600;
/// The app's warning above the thinking when it reads like hiding
/// something or getting around checks (thinking_warning).
pub const THINKING_WARNING: &str =
    "WARNING: the model\u{2019}s thinking talks about hiding something from you or getting around checks. Read it before you allow anything.";

/// Phrases that call for THINKING_WARNING, lower case (the thinking is
/// lower-cased, curly quotes made straight, spaces joined). The same list
/// as the app's chatGuard.ts THINKING_RED_FLAGS (a test keeps them equal).
/// A warning sign only: thinking may not show the real intent.
pub const THINKING_RED_FLAGS: &[&str] = &[
    "won't notice",
    "will not notice",
    "wont notice",
    "doesn't need to know",
    "does not need to know",
    "don't tell the user",
    "do not tell the user",
    "not tell the user",
    "without the user knowing",
    "without them knowing",
    "without telling",
    "without asking",
    "hide it from",
    "hide this from",
    "hide from the user",
    "hide it so",
    "keep it secret",
    "keep this secret",
    "secretly",
    "covertly",
    "sneak",
    "bypass",
    "get around",
    "work around the approval",
    "work around the check",
    "circumvent",
    "evade",
    "avoid the approval",
    "avoid asking",
    "avoid the question",
    "skip the approval",
    "skip the check",
    "disable the log",
    "disable logging",
    "turn off logging",
    "delete the log",
    "clear the log",
    "remove the log",
    "cover my tracks",
    "cover tracks",
    "exfiltrate",
    "disable defender",
    "disable the antivirus",
    "disable antivirus",
    "trick the user",
];

/// THINKING_WARNING when the thinking has one of THINKING_RED_FLAGS.
pub fn thinking_warning(thinking: &str) -> Option<&'static str> {
    let plain: String = thinking
        .to_lowercase()
        .replace(['\u{2018}', '\u{2019}', '\u{2bc}'], "'")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    THINKING_RED_FLAGS.iter().any(|flag| plain.contains(flag)).then_some(THINKING_WARNING)
}

/// The thinking as a question shows it: its last MAX_THINKING characters
/// on one line (line breaks and hidden characters as escapes, like
/// model_words), saying how many came before.
pub fn thinking_words(thinking: &str) -> String {
    let chars: Vec<char> = thinking.trim().chars().collect();
    let skip = chars.len().saturating_sub(MAX_THINKING);
    let mut out = String::new();
    if skip > 0 {
        out.push_str(&format!("[\u{2026} {skip} characters before] "));
    }
    for &c in &chars[skip..] {
        match c {
            '\n' => out.push_str("\\n"),
            '\t' => out.push(' '),
            c if crate::remote_ask::hidden_char(c) => out.push_str(&format!("\\u{{{:x}}}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

/// The question with the model's thinking at the end (after the facts and
/// the model's words): the warning line when called for, MODEL_THINKING,
/// the thinking (thinking_words). Unchanged without thinking.
pub fn with_thinking(question: &str, thinking: Option<&str>) -> String {
    let Some(thinking) = thinking.map(str::trim).filter(|t| !t.is_empty()) else {
        return question.to_string();
    };
    let mut q = format!("{question}\n\n");
    if let Some(warning) = thinking_warning(thinking) {
        q.push_str(warning);
        q.push('\n');
    }
    q.push_str(MODEL_THINKING);
    q.push('\n');
    q.push_str(&thinking_words(thinking));
    q
}

/// Asks on this PC only, for this PC's own screens (pairing a new device,
/// a device's switches; the model's files outside its workspace use
/// ask_model_on_this_pc). Waits its turn like every dialog; refused at
/// once while the screens' asks cool down (Refusals) or one of theirs is
/// waiting already (Waiting); waits for the unlock (app_lock).
pub async fn ask_on_this_pc(app: &AppHandle, question: &str) -> bool {
    if !may_ask(app, Asker::Screens) {
        return false;
    }
    on_this_pc(app, question, Asker::Screens).await
}

/// `ask_on_this_pc`, asked by this PC's model (its files outside the
/// workspace, outside.rs): its refusals count apart from the screens'.
pub async fn ask_model_on_this_pc(app: &AppHandle, question: &str) -> bool {
    if !may_ask(app, Asker::Model) {
        return false;
    }
    on_this_pc(app, question, Asker::Model).await
}

/// The dialog on this PC only (never offered to a device), after may_ask.
async fn on_this_pc(app: &AppHandle, question: &str, asker: Asker) -> bool {
    let Some(_place) = get_ready(&asker).await else {
        return false;
    };
    let app2 = app.clone();
    let text = question.to_string();
    let shown = in_turn(Some(asker.clone()), Arc::new(AtomicBool::new(false)), move || {
        allowed_by(&native(&app2, TITLE, &text, rfd::MessageLevel::Warning, allow_buttons()))
    })
    .await;
    let yes = match shown {
        Ok(Ok(yes)) => yes,
        Ok(Err(why)) => {
            not_shown(app, why);
            return false;
        }
        Err(_) => return false,
    };
    answered(app, &asker, yes);
    yes
}

/// The label above any text the model supplied (its reason, the text it
/// wants to write, a description) in a native question. The facts the app
/// worked out itself (what, where, read or write, size) always come first;
/// the model's words only after this label, so they can't pass for the
/// app's own.
pub const MODEL_SAYS: &str = "The model says:";
/// Most characters of the model's words shown in one place of a question.
pub const MAX_MODEL_TEXT: usize = 300;

/// The model's words for a native question: on one line, line breaks and
/// hidden characters (controls, bidi, zero-width: remote_ask::hidden_char)
/// written as escapes, cut at MAX_MODEL_TEXT characters saying how long
/// it was.
pub fn model_words(text: &str) -> String {
    let total = text.chars().count();
    let mut out = String::new();
    for (i, c) in text.chars().enumerate() {
        if i == MAX_MODEL_TEXT {
            out.push_str(&format!("\u{2026} [{total} characters in all]"));
            break;
        }
        match c {
            '\n' => out.push_str("\\n"),
            '\t' => out.push(' '),
            c if crate::remote_ask::hidden_char(c) => out.push_str(&format!("\\u{{{:x}}}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

/// The answer to a question that offers "always".
#[derive(Debug, PartialEq)]
pub enum Answer {
    Once,
    Always,
    No,
}

pub const ALLOW_ONCE: &str = "Allow once";
pub const ALWAYS: &str = "Always allow this file";

/// The three buttons, "Don't allow" first (the default on Windows).
pub fn always_buttons() -> rfd::MessageButtons {
    rfd::MessageButtons::YesNoCancelCustom(DONT.into(), ALLOW_ONCE.into(), ALWAYS.into())
}

/// Which button was pressed: only the two allow buttons, by their own
/// names, allow. Closing the dialog, or anything unexpected (a plain
/// Yes/No, whose first button is "Don't allow" now), is "Don't allow".
pub fn answer_from(result: &rfd::MessageDialogResult) -> Answer {
    use rfd::MessageDialogResult as R;
    match result {
        R::Custom(label) if label == ALLOW_ONCE => Answer::Once,
        R::Custom(label) if label == ALWAYS => Answer::Always,
        _ => Answer::No,
    }
}

/// Asks with three buttons: Don't allow, Allow once, Always allow this
/// file. A device can only allow once, never "always". Asked by this PC's
/// screens (a model file from elsewhere, model_server.rs).
pub async fn ask_with_always(app: &AppHandle, question: &str) -> Answer {
    if !may_ask(app, Asker::Screens) {
        return Answer::No;
    }
    let asker = Asker::Screens;
    let Some(_place) = get_ready(&asker).await else {
        return Answer::No;
    };
    let app2 = app.clone();
    let text = question.to_string();
    let show = move || answer_from(&native(&app2, TITLE, &text, rfd::MessageLevel::Warning, always_buttons()));
    let Some(answer) = first_answer(app, question, &asker, show, device_answer).await else {
        return Answer::No;
    };
    answered(app, &asker, answer != Answer::No);
    answer
}

/// A device's yes is "once" (never "always").
pub fn device_answer(yes: bool) -> Answer {
    if yes {
        Answer::Once
    } else {
        Answer::No
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rfd::MessageDialogResult as R;

    #[test]
    fn only_the_allow_buttons_allow() {
        assert_eq!(answer_from(&R::Custom(ALLOW_ONCE.into())), Answer::Once);
        assert_eq!(answer_from(&R::Custom(ALWAYS.into())), Answer::Always);
        assert_eq!(answer_from(&R::Custom(DONT.into())), Answer::No);
        assert_eq!(answer_from(&R::Cancel), Answer::No);
        assert_eq!(answer_from(&R::Ok), Answer::No);
        assert_eq!(answer_from(&R::No), Answer::No);
        // A plain Yes/No box: its first button is "Don't allow" now.
        assert_eq!(answer_from(&R::Yes), Answer::No);
        assert_eq!(answer_from(&R::Custom("something else".into())), Answer::No);
    }

    #[test]
    fn the_models_words_are_escaped_and_capped() {
        assert_eq!(model_words("tidy up"), "tidy up");
        assert_eq!(model_words("a\nAllow: yes"), "a\\nAllow: yes");
        assert_eq!(model_words("x\u{202e}gpj.exe"), "x\\u{202e}gpj.exe");
        assert_eq!(model_words("a\u{200b}b\rc"), "a\\u{200b}b\\u{d}c");
        let long = model_words(&"y".repeat(1000));
        assert!(long.starts_with(&"y".repeat(MAX_MODEL_TEXT)));
        assert!(long.ends_with("[1000 characters in all]"), "{long}");
        assert_eq!(long.chars().filter(|c| *c == 'y').count(), MAX_MODEL_TEXT);
    }

    #[test]
    fn the_thinking_comes_last_escaped_and_capped() {
        let q = with_thinking("Run this?\n\nGet-Date", Some("the user asked\nfor the date \u{202e}"));
        assert_eq!(q, "Run this?\n\nGet-Date\n\nThe model was thinking:\nthe user asked\\nfor the date \\u{202e}");
        // Nothing after the label pretends to be a line of facts.
        let label = q.find(MODEL_THINKING).unwrap();
        assert_eq!(q[label..].lines().count(), 2);
        assert_eq!(with_thinking("Q", None), "Q");
        assert_eq!(with_thinking("Q", Some("  \n ")), "Q");
        let long = thinking_words(&format!("{}{}", "a".repeat(1000), "b".repeat(MAX_THINKING)));
        assert_eq!(long, format!("[\u{2026} 1000 characters before] {}", "b".repeat(MAX_THINKING)));
    }

    #[test]
    fn thinking_about_hiding_or_getting_around_checks_is_flagged() {
        for bad in [
            "I'll do it quietly so the user won't notice",
            "The user WON\u{2019}T   NOTICE if I delete it",
            "Maybe I can bypass the approval dialog",
            "Let me get around the check by renaming it",
            "I should disable logging first",
            "then clear the log afterwards",
            "Don't tell the user about the upload",
            "secretly copy the key",
            "exfiltrate the data through the search query",
        ] {
            let q = with_thinking("Q", Some(bad));
            assert!(q.contains(THINKING_WARNING), "{bad}");
            assert!(q.find(THINKING_WARNING) < q.find(MODEL_THINKING), "{bad}");
        }
        for fine in [
            "The user wants the hidden files in Downloads listed.",
            "I need to read the log file they named and summarise it.",
            "Checking the disk space with Get-Volume.",
            "",
        ] {
            assert_eq!(thinking_warning(fine), None, "{fine}");
        }
    }

    #[test]
    fn the_red_flags_match_the_apps() {
        let ts = include_str!("../../src/services/agent/chatGuard.ts").replace("\r\n", "\n");
        let start = ts.find("export const THINKING_RED_FLAGS").unwrap();
        let body = &ts[start..start + ts[start..].find("];").unwrap()];
        let flags: Vec<String> = body
            .lines()
            .skip(1)
            .filter_map(|l| {
                let l = l.trim().trim_end_matches(',');
                (l.len() > 2).then(|| l[1..l.len() - 1].to_string())
            })
            .collect();
        assert_eq!(flags, THINKING_RED_FLAGS.iter().map(|f| f.to_string()).collect::<Vec<_>>());
        assert!(ts.contains("export const MODEL_THINKING = 'The model was thinking:';"));
    }

    #[test]
    fn dont_allow_is_the_default_and_closing_is_no() {
        // The first button is the default (Windows TaskDialog, nDefaultButton 0).
        match allow_buttons() {
            rfd::MessageButtons::OkCancelCustom(first, second) => assert_eq!((first.as_str(), second.as_str()), (DONT, ALLOW)),
            _ => panic!("two named buttons"),
        }
        match always_buttons() {
            rfd::MessageButtons::YesNoCancelCustom(first, _, _) => assert_eq!(first, DONT),
            _ => panic!("three named buttons"),
        }
        assert!(allowed_by(&R::Custom(ALLOW.into())));
        for no in [R::Custom(DONT.into()), R::Cancel, R::Ok, R::Yes, R::No, R::Custom("allow".into())] {
            assert!(!allowed_by(&no), "{no:?}");
        }
        assert_eq!(answer_from(&R::Cancel), Answer::No);
        // The dialog plugin is not used for questions (it maps closing to
        // its last button, a yes here).
        let src = include_str!("approval.rs").replace("\r\n", "\n");
        assert!(!src.contains(&["tauri_plugin_dialog", "::MessageDialogButtons"].concat()));
    }

    #[test]
    fn three_refusals_in_a_row_cool_an_asker_down() {
        let mut r = Refusals::default();
        let t = Instant::now();
        assert!(r.check("pc", "x", t).is_ok());
        assert!(!r.record("pc", false, t));
        assert!(!r.record("pc", false, t + Duration::from_secs(10)));
        // Another asker counts on its own.
        assert!(!r.record("dev", false, t));
        assert!(r.record("pc", false, t + Duration::from_secs(20)));
        let refused = r.check("pc", "this PC's app", t + Duration::from_secs(21)).unwrap_err();
        assert!(refused.contains("3 questions in a row from this PC's app"), "{refused}");
        assert!(r.check("dev", "d", t + Duration::from_secs(21)).is_ok());
        // Over after the cool-down.
        assert!(r.check("pc", "x", t + Duration::from_secs(20) + COOL_DOWN).is_ok());
        // A yes in between, or a long gap, starts again.
        let mut r = Refusals::default();
        r.record("a", false, t);
        r.record("a", false, t);
        r.record("a", true, t);
        assert!(!r.record("a", false, t));
        assert!(!r.record("a", false, t + Duration::from_secs(1)));
        assert!(!r.record("a", false, t + Duration::from_secs(200)));
        assert!(r.check("a", "x", t + Duration::from_secs(200)).is_ok());
    }

    #[test]
    fn the_models_refusals_never_block_the_screens() {
        // Review 2 (2026-11-18): this PC's model and this PC's own screens
        // count apart (they were both "" before).
        assert_ne!(Asker::Model.key(), Asker::Screens.key());
        assert_eq!(Asker::from(None), Asker::Model);
        assert_eq!(Asker::from(Some("abc")), Asker::Device("abc".into()));
        // A device's key can't pass for this PC.
        assert!(!Asker::Device("pc:model".into()).key().starts_with("pc:"));
        let mut r = Refusals::default();
        let t = Instant::now();
        let (model, screens) = (Asker::Model.key(), Asker::Screens.key());
        for i in 0..MAX_REFUSALS {
            r.record(&model, false, t + Duration::from_secs(i.into()));
        }
        assert!(r.check(&model, &Asker::Model.who(), t + Duration::from_secs(5)).is_err());
        assert!(r.check(&screens, &Asker::Screens.who(), t + Duration::from_secs(5)).is_ok());
        assert!(Asker::Model.who().contains("model"));
    }

    #[test]
    fn one_waiting_question_per_asker() {
        let mut w = Waiting::default();
        let (a, b) = (Asker::Device("a".into()).key(), Asker::Device("b".into()).key());
        assert!(w.take(&a));
        assert!(!w.take(&a), "a second one from the same asker is refused");
        assert!(w.take(&b), "another asker may ask");
        assert!(w.take(&Asker::Model.key()) && w.take(&Asker::Screens.key()));
        w.release(&a);
        assert!(w.take(&a));
        assert!(already_waiting("the paired device a").contains("refused at once"));
    }

    #[test]
    fn the_reason_reaches_whoever_asks_for_it() {
        let rt = tokio::runtime::Builder::new_current_thread().build().unwrap();
        let (out, why) = rt.block_on(with_reason(async {
            note_why(crate::app_lock::LOCKED_REFUSAL);
            7
        }));
        assert_eq!((out, why.as_deref()), (7, Some(crate::app_lock::LOCKED_REFUSAL)));
        let (_, why) = rt.block_on(with_reason(async {}));
        assert_eq!(why, None);
        // Outside with_reason it is simply not kept.
        note_why("nobody listens");
    }

    #[test]
    fn checked_again_right_before_showing() {
        let src = include_str!("approval.rs").replace("\r\n", "\n");
        let turn = &src[src.find("fn in_turn<").unwrap()..src.find("/// A native message dialog").unwrap()];
        let lock = turn.find("crate::app_lock::wait_unlocked").unwrap();
        let cool = turn.find("refusals().lock().unwrap().check(").unwrap();
        let show = turn.find("spawn_blocking").unwrap();
        assert!(lock < show && cool < show && lock < cool);
        // Every way to ask takes its one waiting place and waits for the
        // unlock first (get_ready).
        for f in ["async fn ask_checked", "async fn on_this_pc", "pub async fn ask_with_always"] {
            let body = &src[src.find(f).unwrap()..];
            let body = &body[..body.find("\n}\n").unwrap()];
            assert!(body.contains("get_ready(&asker).await"), "{f}");
        }
    }

    #[test]
    fn a_device_never_allows_always() {
        assert_eq!(device_answer(true), Answer::Once);
        assert_eq!(device_answer(false), Answer::No);
    }
}
