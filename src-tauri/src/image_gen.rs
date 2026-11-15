//! Pictures made on this PC: the bundled stable-diffusion.cpp `sd-cli` (in
//! the app's `sd` folder, pinned and checksum-checked like llama.cpp) runs
//! once per picture with a model set the app downloaded itself
//! (`Documents/image-models/<set>`, listed in
//! src/services/imageGen/imageModels.json). It opens no port and fetches
//! nothing (not `sd-server`: that has no password, so any program on the PC
//! could use it). The picture goes into the workspace's `images` folder,
//! inside the app's own folder, so no question is needed; the chat shows the
//! prompt as the tool call, like every tool.
//!
//! Limits: prompt up to 1000 characters (no control or invisible
//! characters), sizes 512 / 768 / 1024, at most 30 steps, one picture at a
//! time, stopped after 10 minutes, and `image_cancel` stops it at once.
//! A small word check refuses clearly illegal requests (sexual content with
//! minors) before anything runs; it is a basic filter, not a guarantee.
//! ARM Linux (e.g. a PineTab 2) has no picture maker: far too slow there.

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
const CATALOG: &str = include_str!("../../src/services/imageGen/imageModels.json");
/// Where the app downloads picture models (its own folder).
pub const MODELS_DIR: &str = "Documents/image-models";
/// Pictures go here, inside the workspace.
pub const IMAGES_DIR: &str = "images";

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
    pub files: Vec<ModelFile>,
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
/// checked request and the output file.
pub fn sd_args(set: &ModelSet, dir: &Path, req: &Request, seed: u64, out: &Path) -> Vec<String> {
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
fn new_name() -> Result<String, String> {
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

/// Keeps the end of a pipe's output (read on its own thread, so the picture
/// maker never stalls on a full pipe).
fn drain(pipe: Option<impl Read + Send + 'static>) -> Arc<Mutex<Vec<u8>>> {
    let log = Arc::new(Mutex::new(Vec::new()));
    if let Some(mut pipe) = pipe {
        let log = log.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n) = pipe.read(&mut buf) {
                if n == 0 {
                    break;
                }
                let mut log = log.lock().unwrap();
                log.extend_from_slice(&buf[..n]);
                if log.len() > MAX_LOG {
                    let cut = log.len() - MAX_LOG;
                    log.drain(..cut);
                }
            }
        });
    }
    log
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Generated {
    /// The picture's file name in the workspace's `images` folder.
    name: String,
    /// The app's own path for it (/pocketagent/…).
    path: String,
    seed: u64,
    seconds: u64,
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
) -> Result<Generated, String> {
    if let Some(why) = not_on_this_pc() {
        return Err(why.into());
    }
    let set = catalog()?
        .into_iter()
        .find(|s| s.id == model)
        .ok_or_else(|| format!("Unknown picture model: {model}"))?;
    let req = check_request(&prompt, width, height, steps.unwrap_or(set.default_steps))?;
    if let Some(why) = refused(&req.prompt) {
        return Err(format!("Refused: {why}. Nothing was made."));
    }
    let exe = sd_exe(&app)?;
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let models = root.join(MODELS_DIR).join(&set.id);
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

    let mut command = Command::new(&exe);
    // Its libraries sit next to it.
    if let Some(parent) = exe.parent() {
        command.current_dir(parent);
    }
    command
        .args(sd_args(&set, &models, &req, seed, &out))
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
    let out_log = drain(child.stdout.take());
    let err_log = drain(child.stderr.take());
    state.0.lock().unwrap().child = Some(child);

    let started = Instant::now();
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
                if started.elapsed() > TIME_LIMIT {
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
        return fail("Stopped after 10 minutes. Try a smaller size or fewer steps.".into());
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
        path: format!(
            "{}/{}/{IMAGES_DIR}/{name}",
            crate::files::APP_PREFIX,
            crate::pc::WORKSPACE
        ),
        name,
        seed,
        seconds: started.elapsed().as_secs(),
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
        let args = sd_args(&sets[0], dir, &req, 42, Path::new("/w/images/p.png"));
        let line = args.join(" ");
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
        let args = sd_args(sd, dir, &req, 1, Path::new("o.png")).join(" ");
        assert!(args.contains("--model /app/"));
        assert!(!args.contains("--offload-to-cpu"));
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
}
