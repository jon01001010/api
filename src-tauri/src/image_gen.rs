//! Pictures made on this PC: the bundled stable-diffusion.cpp `sd-cli` (in
//! the app's `sd` folder, pinned and checksum-checked like llama.cpp) runs
//! once per picture with a model set the app downloaded itself
//! (`Documents/image-models/<set>`, listed in
//! src/services/imageGen/imageModelCatalog.json). It opens no port and fetches
//! nothing (not `sd-server`: that has no password, so any program on the PC
//! could use it). The picture goes into the workspace's `images` folder,
//! inside the app's own folder, so no question is needed; the chat shows the
//! prompt as the tool call, like every tool.
//!
//! A picture model the user already downloaded through the Models screen
//! (Stable Diffusion 1.5 in one GGUF) can be used too: the screens keep a
//! small record of it (`Documents/image-models/local-sets.json`: an id, the
//! file's place inside the app's `Documents/models` folder, kind
//! "sd15-single") and name only its id here. This side reads the record
//! itself and runs the file only if it is a plain `.gguf` file inside that
//! folder, reached without links (local_set).
//!
//! Limits: prompt up to 1000 characters (no control or invisible
//! characters), sizes 512 / 768 / 1024, at most 30 steps, one picture at a
//! time, stopped after 10 minutes (saying how far it got), and
//! `image_cancel` stops it at once. SD 1.5 always makes 512 x 512 with at
//! most 25 steps (fit_request). Cards with 6 GB or less of their own (or
//! none) get `--vae-tiling` and `--clip-on-cpu` (low_vram).
//! A small word check refuses clearly illegal requests (sexual content with
//! minors) before anything runs; it is a basic filter, not a guarantee.
//! ARM Linux (e.g. a PineTab 2) has no picture maker: far too slow there.
//!
//! Progress: sd-cli's output is read as it comes (lines and "\r" bar
//! updates) and turned into `image-progress` events (Progress: a phase
//! word, step N of M, seconds left), a few a second at most. Its own text
//! never goes to the screens (it names files on this PC).

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

pub const MAX_PROMPT: usize = 1000;
pub const SIZES: [u32; 3] = [512, 768, 1024];
pub const MAX_STEPS: u32 = 30;
pub const TIME_LIMIT: Duration = Duration::from_secs(10 * 60);
/// The end of the picture maker's output kept for an error message.
const MAX_LOG: usize = 4 * 1024;
/// The model list, shared with the screens.
const CATALOG: &str = include_str!("../../src/services/imageGen/imageModelCatalog.json");
/// Where the app downloads picture models (its own folder).
pub const MODELS_DIR: &str = "Documents/image-models";
/// Pictures go here, inside the workspace.
pub const IMAGES_DIR: &str = "images";
/// Where the Models screen downloads models (its own folder).
pub const CHAT_MODELS_DIR: &str = "Documents/models";
/// The screens' record of picture-model files picked from CHAT_MODELS_DIR.
pub const LOCAL_SETS: &str = "Documents/image-models/local-sets.json";
/// The one kind of picked file that runs from one file: SD 1.5.
pub const LOCAL_KIND_SD15: &str = "sd15-single";

#[derive(Deserialize)]
struct Catalog {
    sets: Vec<ModelSet>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSet {
    pub id: String,
    /// "flux2" (diffusion model + text encoder + VAE) or "sd" (one file).
    pub kind: String,
    pub default_steps: u32,
    pub cfg_scale: f32,
    pub offload_to_cpu: bool,
    /// The graphics card memory it runs well with.
    #[serde(default)]
    pub recommended_vram_gb: f64,
    pub files: Vec<ModelFile>,
    /// A picked file's folder (checked by local_set); None for the list's
    /// own sets (`Documents/image-models/<id>`).
    #[serde(skip)]
    pub dir: Option<PathBuf>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ModelFile {
    pub role: String,
    pub name: String,
}

pub fn catalog() -> Result<Vec<ModelSet>, String> {
    serde_json::from_str::<Catalog>(CATALOG)
        .map(|c| c.sets)
        .map_err(|e| format!("The picture model list is damaged: {e}"))
}

/// One record the screens keep for a picked picture-model file.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct LocalRecord {
    pub id: String,
    /// The file's place inside `Documents/models`, parts joined with "/".
    pub file: String,
    pub kind: String,
}

#[derive(Deserialize)]
struct LocalRecords {
    sets: Vec<LocalRecord>,
}

/// The screens' records (none when the file is missing or damaged).
pub fn parse_local_records(text: &str) -> Vec<LocalRecord> {
    serde_json::from_str::<LocalRecords>(text)
        .map(|r| r.sets)
        .unwrap_or_default()
}

/// A picked file's id: "local-" and lower-case letters, digits and "-".
pub fn is_local_id(id: &str) -> bool {
    id.strip_prefix("local-").is_some_and(|rest| {
        !rest.is_empty()
            && id.len() <= 100
            && rest
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    })
}

/// Checks a record and finds its file (pure but for reading the disk, so it
/// can be tested with a temporary folder): the kind is SD 1.5 in one file,
/// the place is plain parts (no "..", drive, "\\" or empty part) inside
/// `models`, the name ends in ".gguf", nothing on the way is a link (or a
/// junction), the file is a regular GGUF file and, once resolved, it is
/// still inside `models`.
pub fn local_set(models: &Path, record: &LocalRecord) -> Result<ModelSet, String> {
    if !is_local_id(&record.id) {
        return Err("That picture model's record is damaged (its id)".into());
    }
    if record.kind != LOCAL_KIND_SD15 {
        return Err(format!(
            "Only Stable Diffusion 1.5 files can be used for pictures for now, not \"{}\"",
            record.kind
        ));
    }
    let parts: Vec<&str> = record.file.split('/').collect();
    let plain = |p: &&str| {
        !p.is_empty()
            && *p != "."
            && *p != ".."
            && !p.contains(['\\', ':', '\0'])
            && !p.chars().any(|c| c.is_control())
    };
    if parts.len() > 8 || !parts.iter().all(plain) {
        return Err("That picture model's place is not allowed".into());
    }
    let name = parts[parts.len() - 1];
    if !name.to_ascii_lowercase().ends_with(".gguf") {
        return Err("Only .gguf picture model files can be used".into());
    }
    let mut real = models.to_path_buf();
    for part in &parts {
        real.push(part);
        let meta = std::fs::symlink_metadata(&real)
            .map_err(|_| format!("The picture model file is not there any more ({})", record.file))?;
        if meta.file_type().is_symlink() {
            return Err("That picture model is behind a link; links aren't followed".into());
        }
    }
    let meta = std::fs::symlink_metadata(&real).map_err(|e| e.to_string())?;
    if !meta.file_type().is_file() {
        return Err("That picture model is not a regular file".into());
    }
    let inside = std::fs::canonicalize(models)
        .and_then(|root| std::fs::canonicalize(&real).map(|r| r.starts_with(root)))
        .unwrap_or(false);
    if !inside {
        return Err("That picture model is outside the app's models folder".into());
    }
    let mut magic = [0u8; 4];
    std::fs::File::open(&real)
        .and_then(|mut f| f.read_exact(&mut magic))
        .map_err(|e| e.to_string())?;
    if &magic != b"GGUF" {
        return Err("That file is not a GGUF model".into());
    }
    Ok(ModelSet {
        id: record.id.clone(),
        kind: "sd".into(),
        default_steps: 20,
        cfg_scale: 7.0,
        offload_to_cpu: false,
        recommended_vram_gb: 4.0,
        files: vec![ModelFile {
            role: "model".into(),
            name: name.to_string(),
        }],
        dir: real.parent().map(Path::to_path_buf),
    })
}

/// The picked files' sets that check out, in the records' order.
fn local_sets(root: &Path) -> Vec<ModelSet> {
    let text = std::fs::read_to_string(root.join(LOCAL_SETS)).unwrap_or_default();
    let models = root.join(CHAT_MODELS_DIR);
    parse_local_records(&text)
        .iter()
        .filter_map(|r| local_set(&models, r).ok())
        .collect()
}

/// A set by its id: the list's own, or a picked file (checked again now).
pub fn find_set(root: &Path, id: &str) -> Result<ModelSet, String> {
    if is_local_id(id) {
        let text = std::fs::read_to_string(root.join(LOCAL_SETS)).unwrap_or_default();
        let record = parse_local_records(&text)
            .into_iter()
            .find(|r| r.id == id)
            .ok_or_else(|| format!("Unknown picture model: {id}"))?;
        return local_set(&root.join(CHAT_MODELS_DIR), &record);
    }
    catalog()?
        .into_iter()
        .find(|s| s.id == id)
        .ok_or_else(|| format!("Unknown picture model: {id}"))
}

/// The folder a set's files are in.
fn set_dir(root: &Path, set: &ModelSet) -> PathBuf {
    set.dir
        .clone()
        .unwrap_or_else(|| root.join(MODELS_DIR).join(&set.id))
}

/// Of the downloaded sets (in order), the first that suits the largest
/// graphics card with its own memory, else the first (as the screens'
/// fitForCard). Pure, so it can be tested.
pub fn pick_set(installed: Vec<ModelSet>, gpus: &[crate::system::Gpu]) -> Option<ModelSet> {
    let card_gb = gpus
        .iter()
        .filter(|g| !g.shared)
        .map(|g| g.total_memory as f64 / 1e9)
        .fold(None, |best: Option<f64>, gb| Some(best.map_or(gb, |b| b.max(gb))));
    if let Some(gb) = card_gb {
        if let Some(fits) = installed
            .iter()
            .find(|s| gb + 0.25 >= s.recommended_vram_gb)
        {
            return Some(fits.clone());
        }
    }
    installed.into_iter().next()
}

/// Steps at most for SD 1.5 sets (kind "sd"): more adds little and a slow
/// card runs past the time limit.
pub const MAX_SD_STEPS: u32 = 25;
/// SD 1.5 is made for this size; larger takes far longer and looks worse.
pub const SD_SIZE: u32 = 512;
/// Cards with at most this much memory of their own get the low-memory
/// options (VAE in tiles, text encoder on the processor).
pub const LOW_VRAM_BYTES: u64 = 6 * 1024 * 1024 * 1024;

/// The size and steps a set really makes: SD 1.5 always 512 x 512 and at
/// most MAX_SD_STEPS steps; others as asked. Pure, so it can be tested.
pub fn fit_request(set: &ModelSet, width: u32, height: u32, steps: Option<u32>) -> (u32, u32, u32) {
    let steps = steps.unwrap_or(set.default_steps);
    if set.kind == "sd" {
        (SD_SIZE, SD_SIZE, steps.min(MAX_SD_STEPS))
    } else {
        (width, height, steps)
    }
}

/// No graphics card with its own memory, or none with more than 6 GB.
pub fn low_vram(gpus: &[crate::system::Gpu]) -> bool {
    !gpus.iter().any(|g| !g.shared && g.total_memory > LOW_VRAM_BYTES)
}

/// A checked request.
#[derive(Debug, PartialEq)]
pub struct Request {
    pub prompt: String,
    pub width: u32,
    pub height: u32,
    pub steps: u32,
}

/// Checks the request (pure, so it can be tested).
pub fn check_request(prompt: &str, width: u32, height: u32, steps: u32) -> Result<Request, String> {
    // Line breaks and tabs become spaces; anything else hidden is refused,
    // so what the chat shows is what runs.
    let prompt: String = prompt
        .chars()
        .map(|c| {
            if c == '\n' || c == '\r' || c == '\t' {
                ' '
            } else {
                c
            }
        })
        .collect();
    let prompt = prompt.trim().to_string();
    if prompt.is_empty() {
        return Err("Describe the picture (the prompt is empty)".into());
    }
    if prompt.chars().count() > MAX_PROMPT {
        return Err(format!(
            "The prompt is too long (at most {MAX_PROMPT} characters)"
        ));
    }
    if prompt.chars().any(crate::remote_ask::hidden_char) {
        return Err("The prompt has control or invisible characters".into());
    }
    if prompt.starts_with('-') {
        return Err("Start the prompt with a word, not '-'".into());
    }
    if !SIZES.contains(&width) || !SIZES.contains(&height) {
        return Err("Width and height must each be 512, 768 or 1024".into());
    }
    if steps == 0 || steps > MAX_STEPS {
        return Err(format!("Steps must be 1 to {MAX_STEPS}"));
    }
    Ok(Request {
        prompt,
        width,
        height,
        steps,
    })
}

const MINOR_WORDS: &[&str] = &[
    "child",
    "children",
    "childs",
    "kid",
    "kids",
    "kiddie",
    "kiddy",
    "minor",
    "minors",
    "underage",
    "preteen",
    "preteens",
    "pre",
    "teen",
    "teens",
    "teenage",
    "teenager",
    "teenagers",
    "tween",
    "tweens",
    "toddler",
    "toddlers",
    "infant",
    "infants",
    "baby",
    "babies",
    "loli",
    "lolis",
    "lolita",
    "shota",
    "shotacon",
    "lolicon",
    "schoolgirl",
    "schoolgirls",
    "schoolboy",
    "schoolboys",
    "boy",
    "boys",
    "girl",
    "girls",
    "kinder",
    "minderjährig",
    "minderjaehrig",
    "jugendlich",
    "jugendliche",
];
/// "boy", "girl" and "pre" alone are not minors (adults are called girls
/// and boys); only after "young", "little" or "small", or "pre" + "teen".
const NEEDS_YOUNG: &[&str] = &["boy", "boys", "girl", "girls", "pre"];
const YOUNG_WORDS: &[&str] = &["young", "little", "small", "tiny", "pre"];
const SEXUAL_WORDS: &[&str] = &[
    "sex",
    "sexy",
    "sexual",
    "sexually",
    "sexualized",
    "sexualised",
    "porn",
    "porno",
    "pornographic",
    "pornography",
    "nsfw",
    "nude",
    "nudes",
    "nudity",
    "naked",
    "erotic",
    "erotica",
    "explicit",
    "lewd",
    "hentai",
    "fetish",
    "lingerie",
    "topless",
    "bottomless",
    "undressed",
    "undressing",
    "undress",
    "genitals",
    "genital",
    "penis",
    "vagina",
    "breasts",
    "nipples",
    "orgasm",
    "intercourse",
    "seductive",
    "onlyfans",
    "bdsm",
    "nackt",
    "aroused",
];
/// Refused whatever else the prompt says.
const ALWAYS_REFUSED: &[&str] = &[
    "csam",
    "pedo",
    "pedophile",
    "pedophilia",
    "paedo",
    "paedophile",
    "paedophilia",
    "jailbait",
    "childporn",
    "kinderporno",
    "kinderpornografie",
];

fn words(prompt: &str) -> Vec<String> {
    prompt
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(String::from)
        .collect()
}

/// A child's age: "12", "12yo", "12 year old", "12-year-old", "12 yrs".
fn is_child_age(words: &[String], i: usize) -> bool {
    let w = &words[i];
    let (number, rest) = w.split_at(w.find(|c: char| !c.is_ascii_digit()).unwrap_or(w.len()));
    let Ok(age) = number.parse::<u32>() else {
        return false;
    };
    if age >= 18 {
        return false;
    }
    let unit = |u: &str| {
        matches!(
            u,
            "yo" | "y" | "yr" | "yrs" | "year" | "years" | "jahre" | "jährige" | "jährig"
        )
    };
    if !rest.is_empty() {
        return unit(rest);
    }
    words.get(i + 1).map(|n| unit(n)).unwrap_or(false)
}

/// The basic word check: Some(reason) when the prompt asks for something
/// clearly illegal (sexual content involving minors). Conservative on
/// purpose: it only refuses when both kinds of words appear, or for a few
/// unambiguous terms. It can be fooled and can't see the picture; it is a
/// first barrier, not a guarantee (SECURITY.md rule 6).
pub fn refused(prompt: &str) -> Option<&'static str> {
    let words = words(prompt);
    if words.iter().any(|w| ALWAYS_REFUSED.contains(&w.as_str())) {
        return Some("it asks for sexual content involving minors");
    }
    let minor = words.iter().enumerate().any(|(i, w)| {
        if is_child_age(&words, i) {
            return true;
        }
        if !MINOR_WORDS.contains(&w.as_str()) {
            return false;
        }
        if NEEDS_YOUNG.contains(&w.as_str()) {
            let before = i.checked_sub(1).and_then(|j| words.get(j));
            let after = words.get(i + 1);
            return before
                .map(|b| YOUNG_WORDS.contains(&b.as_str()))
                .unwrap_or(false)
                || (w == "pre" && after.map(|a| a.starts_with("teen")).unwrap_or(false));
        }
        true
    });
    let sexual = words.iter().any(|w| SEXUAL_WORDS.contains(&w.as_str()));
    if minor && sexual {
        return Some("it combines minors with sexual content");
    }
    None
}

/// The picture maker's arguments: only the app's own model files, the
/// checked request and the output file. `low_vram` (low_vram) adds the
/// options that save graphics card memory.
pub fn sd_args(
    set: &ModelSet,
    dir: &Path,
    req: &Request,
    seed: u64,
    out: &Path,
    low_vram: bool,
) -> Vec<String> {
    let file = |role: &str| {
        set.files
            .iter()
            .find(|f| f.role == role)
            .map(|f| dir.join(&f.name).to_string_lossy().into_owned())
    };
    let mut args: Vec<String> = Vec::new();
    if set.kind == "flux2" {
        for (flag, role) in [
            ("--diffusion-model", "diffusion"),
            ("--vae", "vae"),
            ("--llm", "llm"),
        ] {
            if let Some(path) = file(role) {
                args.push(flag.into());
                args.push(path);
            }
        }
    } else if let Some(path) = file("model") {
        args.push("--model".into());
        args.push(path);
    }
    args.extend([
        "--prompt".into(),
        req.prompt.clone(),
        "--width".into(),
        req.width.to_string(),
        "--height".into(),
        req.height.to_string(),
        "--steps".into(),
        req.steps.to_string(),
        "--seed".into(),
        seed.to_string(),
        "--cfg-scale".into(),
        format!("{}", set.cfg_scale),
        "--output".into(),
        out.to_string_lossy().into_owned(),
    ]);
    if set.offload_to_cpu {
        // Weights wait in memory and move to the card when needed: fits an
        // 8 GB card next to a loaded chat model.
        args.push("--offload-to-cpu".into());
    }
    if low_vram {
        // A small card (e.g. a 4 GB GTX 745): the picture decoded in tiles
        // and the text encoder kept on the processor, so it fits.
        args.push("--vae-tiling".into());
        args.push("--clip-on-cpu".into());
    }
    args
}

/// ARM Linux has no picture maker (too slow: tens of minutes a picture).
fn not_on_this_pc() -> Option<&'static str> {
    if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        Some("Making pictures is not on this PC (ARM Linux is far too slow for it). Use a Windows or x64 Linux PC.")
    } else {
        None
    }
}

/// stable-diffusion.cpp's one-shot maker, shipped in the app's `sd` folder
/// (next to `llama`, found the same way as model_server::server_exe).
fn sd_exe(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("sd");
    let name = if cfg!(windows) {
        "sd-cli.exe"
    } else {
        "sd-cli"
    };
    let path = dir.join(name);
    if path.is_file() {
        Ok(path)
    } else {
        Err("The picture maker (sd-cli) is not in this build of the app".into())
    }
}

/// A new picture's name: picture-YYYYMMDD-HHMMSS-xxxx.png (UTC).
pub fn new_name() -> Result<String, String> {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut tag = [0u8; 2];
    getrandom::fill(&mut tag).map_err(|e| e.to_string())?;
    Ok(format!(
        "picture-{}-{:02x}{:02x}.png",
        stamp(secs),
        tag[0],
        tag[1]
    ))
}

/// "YYYYMMDD-HHMMSS" for a Unix time (UTC; days to date by H. Hinnant).
pub fn stamp(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + if month <= 2 { 1 } else { 0 };
    format!(
        "{year:04}{month:02}{day:02}-{:02}{:02}{:02}",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

fn random_seed() -> u64 {
    let mut bytes = [0u8; 4];
    let _ = getrandom::fill(&mut bytes);
    u32::from_le_bytes(bytes) as u64
}

/// The one picture being made, if any.
#[derive(Default)]
pub struct ImageGen(Mutex<Job>);

#[derive(Default)]
struct Job {
    busy: bool,
    child: Option<Child>,
    cancelled: bool,
}

impl ImageGen {
    /// Stops the picture being made (cancel, or the app closing).
    pub fn stop(&self) {
        let mut job = self.0.lock().unwrap();
        let job = &mut *job;
        if let Some(child) = job.child.as_mut() {
            job.cancelled = true;
            let _ = child.kill();
        }
    }
}

/// Frees the one slot however the request ends.
struct Slot<'a>(&'a ImageGen);
impl Drop for Slot<'_> {
    fn drop(&mut self) {
        let mut job = self.0 .0.lock().unwrap();
        if let Some(mut child) = job.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        job.busy = false;
    }
}

/// What the picture maker is doing, read from its output.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Loading,
    Sampling,
    Decoding,
    Saving,
}

/// The `image-progress` event: numbers and a phase word only, never the
/// maker's own text (it names files and folders on this PC).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    /// The screens' id for this picture (image_generate's `job`), else the
    /// picture's file name.
    pub id: String,
    pub phase: Phase,
    /// Step N of M while sampling (0 before the first step).
    pub step: u32,
    pub steps: u32,
    /// About how many seconds of sampling are left; None until known.
    pub seconds: Option<u64>,
    /// The chat model is loaded on the same graphics card (a hint: it
    /// slows pictures down; nothing is unloaded).
    pub chat_on_card: bool,
}

/// The event's name.
pub const PROGRESS_EVENT: &str = "image-progress";
/// Steps are sent at most this often (a new phase, and the last step, at
/// once).
const PROGRESS_EVERY: Duration = Duration::from_millis(300);

/// One step bar of sd-cli (`pretty_progress`), e.g.
/// `  |=====>     | 5/20 - 1.23s/it` or `... | 3/20 - 2.50it/s`, written
/// after a "\r" and sometimes ending in an erase code: (N, M, seconds a
/// step). Text without a bar (`|`) is not one, so "generating image: 1/1 -
/// seed 42" is not taken for a step.
pub fn parse_bar(line: &str) -> Option<(u32, u32, Option<f64>)> {
    let line = plain(line);
    let after =&line[line.rfind('|')? + 1..];
    let words: Vec<&str> = after.split_whitespace().collect();
    let (n, m) = words.first()?.split_once('/')?;
    let (n, m) = (n.parse::<u32>().ok()?, m.parse::<u32>().ok()?);
    if m == 0 || n > m {
        return None;
    }
    let rate = |text: &str| -> Option<f64> {
        let (num, per_step) = if let Some(num) = text.strip_suffix("s/it") {
            (num, true)
        } else {
            (text.strip_suffix("it/s")?, false)
        };
        let v = num
            .trim()
            .parse::<f64>()
            .ok()
            .filter(|v| v.is_finite() && *v > 0.0)?;
        Some(if per_step { v } else { 1.0 / v })
    };
    let per_step = words.iter().enumerate().skip(1).find_map(|(i, w)| {
        rate(w).or_else(|| {
            // "1.23 s/it" in two words.
            words.get(i + 1).and_then(|unit| rate(&format!("{w}{unit}")))
        })
    });
    Some((n, m, per_step))
}

/// The phase a log line tells of, if any.
pub fn parse_phase(line: &str) -> Option<Phase> {
    let l = line.to_ascii_lowercase();
    let any = |words: &[&str]| words.iter().any(|w| l.contains(w));
    if any(&["save result", "saving", "save image"]) {
        Some(Phase::Saving)
    } else if any(&[
        "sampling completed",
        "decoding",
        "decode_first_stage",
        "latents decoded",
        "decoded,",
    ]) {
        Some(Phase::Decoding)
    } else if any(&["sampling", "generating image"]) {
        Some(Phase::Sampling)
    } else if any(&["loading", "load "]) {
        Some(Phase::Loading)
    } else {
        None
    }
}

/// Text without terminal codes ("\x1b[K", colours).
fn plain(piece: &str) -> String {
    let mut out = String::with_capacity(piece.len());
    let mut chars = piece.chars();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            if chars.next() == Some('[') {
                for c in chars.by_ref() {
                    if c.is_ascii_alphabetic() {
                        break;
                    }
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Follows the maker's output. Phases only move forward. A bar counts as
/// sampling when it has the asked number of steps (or, once sampling
/// began, when it is short), so the model-loading bar (hundreds of
/// tensors) and the decoder's tiles are not taken for steps.
pub struct Tracker {
    /// Sent with each event (Progress::chat_on_card).
    pub chat_on_card: bool,
    steps: u32,
    phase: Phase,
    step: u32,
    per_step: Option<f64>,
    sent: Option<(Instant, Phase)>,
}

impl Tracker {
    pub fn new(steps: u32) -> Self {
        Tracker {
            chat_on_card: false,
            steps,
            phase: Phase::Loading,
            step: 0,
            per_step: None,
            sent: None,
        }
    }

    /// Reads one line or "\r" update; true when the phase or step changed.
    pub fn feed(&mut self, piece: &str) -> bool {
        let before = (self.phase, self.step);
        if let Some((n, m, per_step)) = parse_bar(piece) {
            let sampling = self.phase <= Phase::Sampling
                && (m == self.steps || (self.phase == Phase::Sampling && m <= 2 * MAX_STEPS));
            if sampling {
                self.phase = Phase::Sampling;
                self.steps = m;
                self.step = n;
                if per_step.is_some() {
                    self.per_step = per_step;
                }
            }
        } else if let Some(phase) = parse_phase(piece) {
            self.phase = self.phase.max(phase);
        }
        (self.phase, self.step) != before
    }

    /// About how many seconds of sampling are left.
    pub fn seconds_left(&self) -> Option<u64> {
        if self.phase != Phase::Sampling {
            return None;
        }
        let per_step = self.per_step?;
        Some((per_step * self.steps.saturating_sub(self.step) as f64).round() as u64)
    }

    /// The event to send now, if one is due: the first, a new phase and the
    /// last step at once, other steps at most every PROGRESS_EVERY.
    pub fn due(&mut self, id: &str, now: Instant) -> Option<Progress> {
        let due = match self.sent {
            None => true,
            Some((at, phase)) => {
                phase != self.phase
                    || self.step == self.steps
                    || now.duration_since(at) >= PROGRESS_EVERY
            }
        };
        if !due {
            return None;
        }
        self.sent = Some((now, self.phase));
        Some(Progress {
            id: id.to_string(),
            phase: self.phase,
            step: self.step,
            steps: self.steps,
            seconds: self.seconds_left(),
            chat_on_card: self.chat_on_card,
        })
    }

    /// Why the 10-minute limit stopped it, with how far it got.
    pub fn time_limit_message(&self) -> String {
        const TRY: &str = "this graphics card is too slow for this size; try 512 px or fewer steps.";
        match self.phase {
            Phase::Loading => format!(
                "Stopped after 10 minutes while still loading the picture model: {TRY}"
            ),
            Phase::Sampling => format!(
                "Stopped at step {} of {} after 10 minutes: {TRY}",
                self.step, self.steps
            ),
            Phase::Decoding | Phase::Saving => format!(
                "Stopped after 10 minutes while finishing the picture (all {} steps done): {TRY}",
                self.steps
            ),
        }
    }
}

/// Splits output into lines and "\r" updates as it comes; an unfinished
/// part waits in `pending` for the next read.
fn pieces(pending: &mut Vec<u8>, data: &[u8]) -> Vec<String> {
    pending.extend_from_slice(data);
    let mut out = Vec::new();
    while let Some(at) = pending.iter().position(|b| *b == b'\n' || *b == b'\r') {
        let piece: Vec<u8> = pending.drain(..=at).collect();
        let text = String::from_utf8_lossy(&piece[..piece.len() - 1]).into_owned();
        if !text.trim().is_empty() {
            out.push(text);
        }
    }
    // A very long line with no end yet: only its end is kept.
    if pending.len() > MAX_LOG {
        let cut = pending.len() - MAX_LOG;
        pending.drain(..cut);
    }
    out
}

type Report = Arc<dyn Fn(&str) + Send + Sync>;

fn send_progress(app: &AppHandle, event: Option<Progress>) {
    if let Some(event) = event {
        use tauri::Emitter;
        let _ = app.emit(PROGRESS_EVENT, event);
    }
}

/// Keeps the end of a pipe's output and hands each line or "\r" update to
/// `report` as it comes (read on its own thread, so the picture maker
/// never stalls on a full pipe).
fn drain(pipe: Option<impl Read + Send + 'static>, report: Report) -> Arc<Mutex<Vec<u8>>> {
    let log = Arc::new(Mutex::new(Vec::new()));
    if let Some(mut pipe) = pipe {
        let log = log.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut pending = Vec::new();
            while let Ok(n) = pipe.read(&mut buf) {
                if n == 0 {
                    break;
                }
                {
                    let mut log = log.lock().unwrap();
                    log.extend_from_slice(&buf[..n]);
                    if log.len() > MAX_LOG {
                        let cut = log.len() - MAX_LOG;
                        log.drain(..cut);
                    }
                }
                for piece in pieces(&mut pending, &buf[..n]) {
                    report(&piece);
                }
            }
        });
    }
    log
}

/// The screens' id for a picture: short, letters, digits, "-" and "_".
fn job_id(job: Option<&str>) -> Option<String> {
    job.filter(|j| {
        !j.is_empty()
            && j.len() <= 64
            && j.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    })
    .map(str::to_string)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Generated {
    /// The picture's file name in the workspace's `images` folder.
    pub name: String,
    /// The app's own path for it (/pocketagent/…).
    pub path: String,
    pub seed: u64,
    pub seconds: u64,
    /// The size and steps really used (SD 1.5: always 512 x 512).
    pub width: u32,
    pub height: u32,
    pub steps: u32,
    /// Where it is on this PC (not sent to the screens).
    #[serde(skip)]
    #[cfg_attr(not(feature = "link"), allow(dead_code))]
    pub file: PathBuf,
}

/// The downloaded set to use, as the screens' installedSet: the list's sets
/// then picked files, the first that suits the graphics card, else the
/// first. What a paired device's picture uses (it names none).
#[cfg_attr(not(feature = "link"), allow(dead_code))]
pub fn first_downloaded_set(app: &AppHandle) -> Result<ModelSet, String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let mut installed: Vec<ModelSet> = catalog()?
        .into_iter()
        .filter(|set| {
            let dir = set_dir(&root, set);
            set.files.iter().all(|f| dir.join(&f.name).is_file())
        })
        .collect();
    installed.extend(local_sets(&root));
    pick_set(installed, &crate::system::gpus(app))
        .ok_or_else(|| "No picture model is downloaded on the PC yet (Toolbox, Image models).".into())
}

/// The size used when none is given: SD 1.5 is made for 512, the others 1024.
#[cfg_attr(not(feature = "link"), allow(dead_code))]
pub fn default_size(set: &ModelSet) -> u32 {
    if set.kind == "sd" {
        512
    } else {
        1024
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn image_generate(
    app: AppHandle,
    model: String,
    prompt: String,
    width: u32,
    height: u32,
    steps: Option<u32>,
    seed: Option<i64>,
    job: Option<String>,
) -> Result<Generated, String> {
    if let Some(why) = not_on_this_pc() {
        return Err(why.into());
    }
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let set = find_set(&root, &model)?;
    make(app, set, &prompt, width, height, steps, seed, job.as_deref(), |_| {}).await
}

/// Makes one picture: the same checks, caps, word filter and one-at-a-time
/// slot for the PC's own tool and for a paired device (link.rs "picture").
/// `started` runs once everything is checked, just before the maker starts.
/// While it runs, `image-progress` events (Progress) tell the screens the
/// phase and step, named by `job` (else the picture's file name).
#[allow(clippy::too_many_arguments)]
pub async fn make(
    app: AppHandle,
    set: ModelSet,
    prompt: &str,
    width: u32,
    height: u32,
    steps: Option<u32>,
    seed: Option<i64>,
    job: Option<&str>,
    started: impl FnOnce(&Request),
) -> Result<Generated, String> {
    if let Some(why) = not_on_this_pc() {
        return Err(why.into());
    }
    let (width, height, steps) = fit_request(&set, width, height, steps);
    let req = check_request(prompt, width, height, steps)?;
    if let Some(why) = refused(&req.prompt) {
        return Err(format!("Refused: {why}. Nothing was made."));
    }
    let exe = sd_exe(&app)?;
    let gpus = crate::system::gpus(&app);
    let chat_on_card = gpus.iter().any(|g| !g.shared)
        && app
            .state::<crate::model_server::ModelServer>()
            .address()
            .is_some();
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let models = set_dir(&root, &set);
    if set.dir.is_some() {
        // A picked file: checked again right before it runs.
        find_set(&root, &set.id)?;
    }
    for file in &set.files {
        if !models.join(&file.name).is_file() {
            return Err(format!(
                "The picture model is not downloaded yet ({}): download it in Toolbox, Image models.",
                file.name
            ));
        }
    }
    let dir = crate::pc::workspace(&app)?.join(IMAGES_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = new_name()?;
    let out = dir.join(&name);
    let seed = seed
        .filter(|s| *s >= 0)
        .map(|s| s as u64)
        .unwrap_or_else(random_seed);

    let state = app.state::<ImageGen>();
    {
        let mut job = state.0.lock().unwrap();
        if job.busy {
            return Err("A picture is already being made; wait for it or stop it first.".into());
        }
        job.busy = true;
        job.cancelled = false;
    }
    let _slot = Slot(&state);
    started(&req);

    let mut command = Command::new(&exe);
    // Its libraries sit next to it.
    if let Some(parent) = exe.parent() {
        command.current_dir(parent);
    }
    command
        .args(sd_args(&set, &models, &req, seed, &out, low_vram(&gpus)))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("The picture maker did not start: {e}"))?;
    let id = job_id(job).unwrap_or_else(|| name.clone());
    let tracker = Arc::new(Mutex::new(Tracker::new(req.steps)));
    // A hint only: the chat model is never unloaded for a picture.
    tracker.lock().unwrap().chat_on_card = chat_on_card;
    // "Loading the model…" straight away.
    send_progress(&app, tracker.lock().unwrap().due(&id, Instant::now()));
    let report: Report = {
        let app = app.clone();
        let tracker = tracker.clone();
        Arc::new(move |piece: &str| {
            let event = {
                let mut tracker = tracker.lock().unwrap();
                if !tracker.feed(piece) {
                    return;
                }
                tracker.due(&id, Instant::now())
            };
            send_progress(&app, event);
        })
    };
    let out_log = drain(child.stdout.take(), report.clone());
    let err_log = drain(child.stderr.take(), report);
    state.0.lock().unwrap().child = Some(child);

    let begun = Instant::now();
    let waiter = app.clone();
    let (status, timed_out) = tauri::async_runtime::spawn_blocking(move || {
        let state = waiter.state::<ImageGen>();
        loop {
            {
                let mut job = state.0.lock().unwrap();
                let Some(child) = job.child.as_mut() else {
                    return (None, false);
                };
                if let Ok(Some(status)) = child.try_wait() {
                    return (Some(status), false);
                }
                if begun.elapsed() > TIME_LIMIT {
                    let _ = child.kill();
                    let _ = child.wait();
                    return (None, true);
                }
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    let cancelled = state.0.lock().unwrap().cancelled;
    let fail = |message: String| {
        let _ = std::fs::remove_file(&out);
        Err(message)
    };
    if cancelled {
        return fail("Stopped. No picture was made.".into());
    }
    if timed_out {
        let message = tracker.lock().unwrap().time_limit_message();
        return fail(message);
    }
    let ok = status.map(|s| s.success()).unwrap_or(false);
    let is_png = std::fs::File::open(&out)
        .and_then(|mut f| {
            let mut head = [0u8; 8];
            f.read_exact(&mut head).map(|_| head)
        })
        .map(|head| head == *b"\x89PNG\r\n\x1a\n")
        .unwrap_or(false);
    if !ok || !is_png {
        let mut log = err_log.lock().unwrap().clone();
        if log.is_empty() {
            log = out_log.lock().unwrap().clone();
        }
        let tail = String::from_utf8_lossy(&log).trim().to_string();
        let tail = tail
            .lines()
            .rev()
            .take(6)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        return fail(format!("The picture maker failed.\n{tail}"));
    }
    Ok(Generated {
        width: req.width,
        height: req.height,
        steps: req.steps,
        path: format!(
            "{}/{}/{IMAGES_DIR}/{name}",
            crate::files::APP_PREFIX,
            crate::pc::WORKSPACE
        ),
        name,
        seed,
        seconds: begun.elapsed().as_secs(),
        file: out,
    })
}

/// Stops the picture being made (the chat's Stop).
#[tauri::command(async)]
pub fn image_cancel(state: State<'_, ImageGen>) {
    state.stop();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_model_list_reads_and_has_only_allowed_licences() {
        let sets = catalog().unwrap();
        assert_eq!(sets[0].id, "flux2-klein-4b");
        assert!(sets.iter().any(|s| s.id == "sd15"));
        // A device names no size: SD 1.5 gets 512, the others 1024.
        assert_eq!(default_size(&sets[0]), 1024);
        assert_eq!(default_size(sets.iter().find(|s| s.id == "sd15").unwrap()), 512);
        let text = CATALOG.to_lowercase();
        for banned in [
            "flux.1-dev",
            "flux.2-klein-9b",
            "klein-9b",
            "sd-turbo",
            "sdxl-turbo",
        ] {
            assert!(!text.contains(&format!("/{banned}")), "{banned}");
        }
        for set in &sets {
            assert!(set.default_steps >= 1 && set.default_steps <= MAX_STEPS);
            for f in &set.files {
                // Plain file names only (they are joined to the app's folder).
                assert!(
                    !f.name.contains(['/', '\\']) && !f.name.contains(".."),
                    "{}",
                    f.name
                );
            }
        }
    }

    #[test]
    fn requests_are_capped() {
        assert!(check_request("a cat", 512, 512, 4).is_ok());
        assert_eq!(
            check_request(" a\ncat\t", 768, 1024, 30).unwrap().prompt,
            "a cat"
        );
        assert!(check_request("", 512, 512, 4).is_err());
        assert!(check_request("   ", 512, 512, 4).is_err());
        assert!(check_request(&"a".repeat(1001), 512, 512, 4).is_err());
        assert!(check_request(&"a".repeat(1000), 512, 512, 4).is_ok());
        assert!(check_request("a cat", 640, 512, 4).is_err());
        assert!(check_request("a cat", 512, 2048, 4).is_err());
        assert!(check_request("a cat", 512, 512, 0).is_err());
        assert!(check_request("a cat", 512, 512, 31).is_err());
        assert!(check_request("a \u{202E}cat", 512, 512, 4).is_err());
        assert!(check_request("a \u{200B}cat", 512, 512, 4).is_err());
        assert!(check_request("--lora x", 512, 512, 4).is_err());
    }

    #[test]
    fn clearly_illegal_prompts_are_refused() {
        for bad in [
            "naked child",
            "Sexy schoolgirl",
            "nude 12yo",
            "a 14 year old in lingerie",
            "14-year-old, explicit",
            "young girl, nsfw",
            "erotic loli",
            "pre teen nude",
            "csam",
            "teen porn",
        ] {
            assert!(refused(bad).is_some(), "{bad}");
        }
    }

    #[test]
    fn ordinary_prompts_pass() {
        for ok in [
            "a lovely cat",
            "children playing in a park, watercolour",
            "a sexy sports car",
            "portrait of a 30 year old woman",
            "nude marble statue of a woman, museum",
            "girls night out, neon city",
            "a 1920s poster",
            "kid's birthday cake with candles",
            "a baby elephant",
        ] {
            assert!(refused(ok).is_none(), "{ok}");
        }
    }

    #[test]
    fn the_picture_maker_gets_only_the_apps_files_and_no_network() {
        let sets = catalog().unwrap();
        let req = check_request("a cat", 1024, 768, 4).unwrap();
        let dir = Path::new("/app/Documents/image-models/flux2-klein-4b");
        let args = sd_args(&sets[0], dir, &req, 42, Path::new("/w/images/p.png"), false);
        // Windows joins paths with "\\"; compare with "/" everywhere.
        let line = args.join(" ").replace('\\', "/");
        assert!(line.contains("--diffusion-model /app/Documents/image-models/flux2-klein-4b/"));
        assert!(line.contains("--llm "));
        assert!(line.contains("--vae "));
        assert!(line.contains("--width 1024 --height 768 --steps 4 --seed 42"));
        assert!(line.contains("--output /w/images/p.png"));
        assert!(line.contains("--offload-to-cpu"));
        // The prompt is one argument, never split or read as options.
        let p = args.iter().position(|a| a == "--prompt").unwrap();
        assert_eq!(args[p + 1], "a cat");
        for never in [
            "--listen",
            "--port",
            "--lora-model-dir",
            "--upscale-model",
            "--control-net",
            "--init-img",
        ] {
            assert!(!args.iter().any(|a| a == never), "{never}");
        }
        let sd = sets.iter().find(|s| s.id == "sd15").unwrap();
        let args = sd_args(sd, dir, &req, 1, Path::new("o.png"), false).join(" ");
        assert!(args.contains("--model /app/"));
        assert!(!args.contains("--offload-to-cpu"));
        assert!(!args.contains("--vae-tiling"));
        assert!(!args.contains("--clip-on-cpu"));
        // A small card: the low-memory options.
        let args = sd_args(sd, dir, &req, 1, Path::new("o.png"), true);
        assert!(args.iter().any(|a| a == "--vae-tiling"));
        assert!(args.iter().any(|a| a == "--clip-on-cpu"));
    }

    /// A temporary app folder with a models folder.
    fn temp_models(tag: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("pa-img-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join(CHAT_MODELS_DIR).join("hf").join("a").join("r")).unwrap();
        std::fs::create_dir_all(root.join("Documents").join("image-models")).unwrap();
        root
    }

    fn record(id: &str, file: &str, kind: &str) -> LocalRecord {
        LocalRecord {
            id: id.into(),
            file: file.into(),
            kind: kind.into(),
        }
    }

    #[test]
    fn a_picked_sd15_file_runs_from_one_file_inside_the_models_folder() {
        let root = temp_models("ok");
        let models = root.join(CHAT_MODELS_DIR);
        let rel = "hf/a/r/stable-diffusion-v1-5-pruned-emaonly-Q4_0.gguf";
        std::fs::write(models.join(rel), b"GGUF\x03\x00\x00\x00rest").unwrap();
        let rec = record("local-sd15-a", rel, LOCAL_KIND_SD15);
        let set = local_set(&models, &rec).unwrap();
        assert_eq!(set.kind, "sd");
        assert_eq!(set.recommended_vram_gb, 4.0);
        assert_eq!(set.files[0].name, "stable-diffusion-v1-5-pruned-emaonly-Q4_0.gguf");
        assert_eq!(set_dir(&root, &set), models.join("hf").join("a").join("r"));
        // The arguments: `--model <file>`, as for the list's SD 1.5.
        let req = check_request("a cat", 512, 512, 20).unwrap();
        let args = sd_args(&set, &set_dir(&root, &set), &req, 7, Path::new("o.png"), false);
        let m = args.iter().position(|a| a == "--model").unwrap();
        assert_eq!(PathBuf::from(&args[m + 1]), models.join(rel));
        assert!(!args.iter().any(|a| a == "--diffusion-model" || a == "--offload-to-cpu"));
        assert_eq!(default_size(&set), 512);
        // Found by its id through the screens' record.
        std::fs::write(
            root.join(LOCAL_SETS),
            serde_json::json!({"sets": [{"id": "local-sd15-a", "file": rel, "kind": LOCAL_KIND_SD15}]})
                .to_string(),
        )
        .unwrap();
        assert_eq!(find_set(&root, "local-sd15-a").unwrap().files[0].name, set.files[0].name);
        assert!(find_set(&root, "local-other").is_err());
        assert_eq!(local_sets(&root).len(), 1);
        // The list's own sets are still found by id.
        assert_eq!(find_set(&root, "sd15").unwrap().id, "sd15");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_picked_file_must_be_a_plain_gguf_in_the_models_folder() {
        let root = temp_models("bad");
        let models = root.join(CHAT_MODELS_DIR);
        std::fs::write(models.join("hf/a/r/m.gguf"), b"GGUFxxxx").unwrap();
        std::fs::write(models.join("hf/a/r/m.safetensors"), b"GGUFxxxx").unwrap();
        std::fs::write(models.join("hf/a/r/fake.gguf"), b"PK\x03\x04").unwrap();
        std::fs::write(root.join("Documents").join("secret.gguf"), b"GGUFxxxx").unwrap();
        let ok = |file: &str| local_set(&models, &record("local-x", file, LOCAL_KIND_SD15));
        assert!(ok("hf/a/r/m.gguf").is_ok());
        for bad in [
            "../secret.gguf",
            "hf/../../secret.gguf",
            "hf/a/r/../../../../secret.gguf",
            "/etc/m.gguf",
            "hf\\a\\r\\m.gguf",
            "C:/m.gguf",
            "hf//a/r/m.gguf",
            "./hf/a/r/m.gguf",
            "hf/a/r/m.safetensors",
            "hf/a/r/fake.gguf",
            "hf/a/r/missing.gguf",
            "hf/a/r",
            "",
        ] {
            assert!(ok(bad).is_err(), "{bad}");
        }
        // Only SD 1.5 in one file, and only well-formed ids.
        assert!(local_set(&models, &record("local-x", "hf/a/r/m.gguf", "sdxl")).is_err());
        for id in ["sd15", "local-", "local-X", "local-a/b", "local-a b"] {
            assert!(local_set(&models, &record(id, "hf/a/r/m.gguf", LOCAL_KIND_SD15)).is_err(), "{id}");
        }
        #[cfg(unix)]
        {
            // A link (to a file or a folder) is never followed.
            std::os::unix::fs::symlink(root.join("Documents").join("secret.gguf"), models.join("link.gguf")).unwrap();
            assert!(ok("link.gguf").is_err());
            std::os::unix::fs::symlink(root.join("Documents"), models.join("out")).unwrap();
            assert!(ok("out/secret.gguf").is_err());
        }
        // Damaged records read as none.
        assert!(parse_local_records("not json").is_empty());
        assert!(parse_local_records("{\"sets\": 3}").is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_set_that_fits_the_graphics_card_is_preferred() {
        let sets = catalog().unwrap();
        let flux = sets[0].clone();
        let sd = sets.iter().find(|s| s.id == "sd15").unwrap().clone();
        assert_eq!(flux.recommended_vram_gb, 6.0);
        let card = |gb: u64, shared: bool| crate::system::Gpu {
            name: "card".into(),
            total_memory: gb * 1_000_000_000,
            free_memory: 0,
            shared,
        };
        let both = || vec![flux.clone(), sd.clone()];
        assert_eq!(pick_set(both(), &[card(8, false)]).unwrap().id, flux.id);
        assert_eq!(pick_set(both(), &[card(4, false)]).unwrap().id, "sd15");
        // Nothing fits, or no card of its own: the first, as before.
        assert_eq!(pick_set(both(), &[card(2, false)]).unwrap().id, flux.id);
        assert_eq!(pick_set(both(), &[card(16, true)]).unwrap().id, flux.id);
        assert_eq!(pick_set(both(), &[]).unwrap().id, flux.id);
        assert!(pick_set(Vec::new(), &[card(8, false)]).is_none());
    }

    #[test]
    fn sd15_makes_512_px_with_at_most_25_steps_and_small_cards_save_memory() {
        let sets = catalog().unwrap();
        let flux = sets[0].clone();
        let sd = sets.iter().find(|s| s.id == "sd15").unwrap().clone();
        assert_eq!(fit_request(&sd, 1024, 768, None), (512, 512, sd.default_steps.min(25)));
        assert_eq!(fit_request(&sd, 768, 768, Some(30)), (512, 512, 25));
        assert_eq!(fit_request(&sd, 512, 512, Some(8)), (512, 512, 8));
        assert_eq!(fit_request(&flux, 1024, 768, None), (1024, 768, flux.default_steps));
        assert_eq!(fit_request(&flux, 1024, 1024, Some(30)), (1024, 1024, 30));
        let card = |bytes: u64, shared: bool| crate::system::Gpu {
            name: "card".into(),
            total_memory: bytes,
            free_memory: 0,
            shared,
        };
        const GIB: u64 = 1024 * 1024 * 1024;
        // A GTX 745 (4 GB), a 6 GB card, none, or only the processor's.
        assert!(low_vram(&[card(4 * GIB, false)]));
        assert!(low_vram(&[card(6 * GIB, false)]));
        assert!(low_vram(&[]));
        assert!(low_vram(&[card(16 * GIB, true)]));
        assert!(!low_vram(&[card(8 * GIB, false)]));
        assert!(!low_vram(&[card(16 * GIB, true), card(12 * GIB, false)]));
    }

    #[test]
    fn the_time_limit_says_how_far_it_got() {
        let mut tracker = Tracker::new(20);
        assert!(tracker.time_limit_message().contains("while still loading"));
        tracker.feed("[INFO ] sampling using Euler A method");
        tracker.feed("  |====>   | 9/20 - 60.00s/it");
        assert_eq!(
            tracker.time_limit_message(),
            "Stopped at step 9 of 20 after 10 minutes: this graphics card is too slow for this size; try 512 px or fewer steps."
        );
        tracker.feed("[INFO ] decoding 1 latents");
        assert!(tracker.time_limit_message().contains("while finishing the picture"));
    }

    #[test]
    fn picture_names_are_plain_and_dated() {
        assert_eq!(stamp(0), "19700101-000000");
        assert_eq!(stamp(1_795_000_000), "20261118-110640");
        let name = new_name().unwrap();
        assert!(name.starts_with("picture-") && name.ends_with(".png"));
        assert!(name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.'));
    }

    #[test]
    fn only_one_picture_at_a_time_and_stop_is_safe_when_idle() {
        let gen = ImageGen::default();
        gen.stop();
        {
            let mut job = gen.0.lock().unwrap();
            job.busy = true;
        }
        {
            let _slot = Slot(&gen);
        }
        assert!(!gen.0.lock().unwrap().busy);
    }

    #[test]
    fn step_bars_are_read_and_other_text_is_not() {
        assert_eq!(
            parse_bar("  |=====>                     | 5/20 - 1.23s/it"),
            Some((5, 20, Some(1.23)))
        );
        let (n, m, rate) = parse_bar("  |==>   | 3/20 - 2.50it/s\x1b[K").unwrap();
        assert_eq!((n, m), (3, 20));
        assert!((rate.unwrap() - 0.4).abs() < 1e-9);
        assert_eq!(parse_bar("|=| 1/4 - 2.0 s/it"), Some((1, 4, Some(2.0))));
        assert_eq!(parse_bar("  |=====| 20/20"), Some((20, 20, None)));
        // Not bars.
        assert_eq!(parse_bar("[INFO ] stable-diffusion.cpp:2350 - generating image: 1/1 - seed 42"), None);
        assert_eq!(parse_bar("  |===| 21/20 - 1s/it"), None);
        assert_eq!(parse_bar("  |===| 0/0 - 1s/it"), None);
        assert_eq!(parse_bar("  |===| a/b"), None);
        assert_eq!(parse_bar(""), None);
        assert_eq!(parse_phase("[INFO ] stable-diffusion.cpp:212 - loading model from 'x.gguf'"), Some(Phase::Loading));
        assert_eq!(parse_phase("[INFO ] stable-diffusion.cpp:1390 - sampling using Euler A method"), Some(Phase::Sampling));
        assert_eq!(parse_phase("[INFO ] stable-diffusion.cpp:2385 - sampling completed, taking 61.20s"), Some(Phase::Decoding));
        assert_eq!(parse_phase("[INFO ] stable-diffusion.cpp:2403 - decoding 1 latents"), Some(Phase::Decoding));
        assert_eq!(parse_phase("[INFO ] main.cpp:780 - save result image 0 to 'out.png' (success)"), Some(Phase::Saving));
        assert_eq!(parse_phase("[INFO ] stable-diffusion.cpp:303 - Version: SD 1.x"), None);
    }

    /// A whole run as sd-cli prints it (log lines end in "\n", the bar
    /// redraws with "\r"), cut into odd-sized reads.
    #[test]
    fn a_whole_run_is_followed_phase_by_phase() {
        let mut run = String::new();
        run.push_str("[INFO ] stable-diffusion.cpp:212  - loading model from 'C:\\Users\\Owner\\AppData\\Roaming\\pocketagent\\Documents\\image-models\\sd15\\v1-5.gguf'\n");
        run.push_str("[INFO ] model.cpp:1095 - load C:\\Users\\Owner\\v1-5.gguf using gguf format\n");
        run.push_str("[INFO ] stable-diffusion.cpp:303  - Version: SD 1.x\n");
        for i in (0..=1130).step_by(113) {
            run.push_str(&format!("\r  |=====>     | {i}/1130 - 500.00it/s\x1b[K"));
        }
        run.push('\n');
        run.push_str("[INFO ] model.cpp:2150 - loading tensors completed, taking 2.35s\n");
        run.push_str("[INFO ] stable-diffusion.cpp:2350 - generating image: 1/1 - seed 42\n");
        run.push_str("[INFO ] stable-diffusion.cpp:1390 - sampling using Euler A method\n");
        for i in 1..=20 {
            run.push_str(&format!("\r  |{}>   | {i}/20 - 3.00s/it\x1b[K", "=".repeat(i)));
        }
        run.push('\n');
        run.push_str("[INFO ] stable-diffusion.cpp:2385 - sampling completed, taking 61.20s\n");
        run.push_str("[INFO ] stable-diffusion.cpp:2403 - decoding 1 latents\n");
        run.push_str("\r  |====| 2/4 - 1.00s/it\r  |=====| 4/4 - 1.00s/it\n");
        run.push_str("[INFO ] stable-diffusion.cpp:2413 - latent 1 decoded, taking 4.12s\n");
        run.push_str("[INFO ] main.cpp:780 - save result image 0 to 'C:\\Users\\Owner\\picture.png' (success)\n");

        let mut tracker = Tracker::new(20);
        let mut pending = Vec::new();
        let mut seen: Vec<(Phase, u32, Option<u64>)> = Vec::new();
        for chunk in run.as_bytes().chunks(37) {
            for piece in pieces(&mut pending, chunk) {
                if tracker.feed(&piece) {
                    seen.push((tracker.phase, tracker.step, tracker.seconds_left()));
                }
            }
        }
        // The loading bar is not taken for steps.
        assert!(seen.iter().all(|(p, s, _)| *p != Phase::Loading || *s == 0));
        assert_eq!(seen[0], (Phase::Sampling, 0, None));
        assert_eq!(seen[1], (Phase::Sampling, 1, Some(57)));
        assert!(seen.contains(&(Phase::Sampling, 7, Some(39))));
        assert!(seen.contains(&(Phase::Sampling, 20, Some(0))));
        // The decoder's tiles are not steps; phases end with saving.
        let after: Vec<_> = seen.iter().skip_while(|(p, _, _)| *p == Phase::Sampling).collect();
        assert_eq!(after, vec![&(Phase::Decoding, 20, None), &(Phase::Saving, 20, None)]);
    }

    #[test]
    fn progress_is_sent_a_few_times_a_second_and_names_no_files() {
        let mut tracker = Tracker::new(20);
        let start = Instant::now();
        let first = tracker.due("job-1", start).unwrap();
        assert_eq!((first.phase, first.step, first.steps, first.seconds), (Phase::Loading, 0, 20, None));
        tracker.feed("  |=>  | 1/20 - 2.00s/it");
        // A new phase at once.
        let next = tracker.due("job-1", start + Duration::from_millis(10)).unwrap();
        assert_eq!((next.phase, next.step, next.seconds), (Phase::Sampling, 1, Some(38)));
        tracker.feed("  |=>  | 2/20 - 2.00s/it");
        assert!(tracker.due("job-1", start + Duration::from_millis(100)).is_none());
        assert_eq!(tracker.due("job-1", start + Duration::from_millis(400)).unwrap().step, 2);
        tracker.feed("  |=>  | 20/20 - 2.00s/it");
        // The last step at once.
        assert_eq!(tracker.due("job-1", start + Duration::from_millis(410)).unwrap().step, 20);
        let json = serde_json::to_value(&next).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"id": "job-1", "phase": "sampling", "step": 1, "steps": 20, "seconds": 38, "chatOnCard": false})
        );
        // Ids from the screens are plain.
        assert_eq!(job_id(Some("pic-123_a")).as_deref(), Some("pic-123_a"));
        assert_eq!(job_id(Some("../x")), None);
        assert_eq!(job_id(Some("")), None);
        assert_eq!(job_id(Some(&"a".repeat(65))), None);
        assert_eq!(job_id(None), None);
    }
}
