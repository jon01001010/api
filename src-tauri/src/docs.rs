//! Documents in the workspace as plain text, so a model can read them:
//! Word (.docx), Excel (.xlsx), PowerPoint (.pptx), OpenDocument (.odt,
//! .ods, .odp) and PDF. Converted here on the PC, nothing is uploaded. Only
//! files in the app's own folder (the workspace): the tool never reads the
//! rest of the PC (SECURITY.md rule 6).

use std::io::Read;
use std::path::Path;

use quick_xml::events::Event;
use quick_xml::Reader;

/// Biggest document read (bytes on disk).
const MAX_FILE: u64 = 64 * 1024 * 1024;
/// Most bytes taken from one part inside a document (a "zip bomb" stops here).
const MAX_PART: u64 = 64 * 1024 * 1024;
/// Most text returned (characters); the tool reads longer ones in ranges.
const MAX_TEXT: usize = 2_000_000;

/// The document kinds read here, by file name.
pub fn kind_of(name: &str) -> Option<&'static str> {
    let ext = name.rsplit('.').next()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "docx" => "docx",
        "xlsx" => "xlsx",
        "pptx" => "pptx",
        "odt" | "ods" | "odp" => "odf",
        "pdf" => "pdf",
        _ => return None,
    })
}

/// Text inside the `text` tags of an XML part; a line break after each
/// `line` tag, a tab after each `cell` tag.
fn xml_text(xml: &[u8], text: &[&str], line: &[&str], cell: &[&str]) -> String {
    let mut reader = Reader::from_reader(xml);
    let mut out = String::new();
    let mut depth = 0usize;
    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                if text.contains(&e.name().0) {
                    depth += 1;
                }
            }
            Ok(Event::Empty(e)) => match e.name().0 {
                "w:tab" | "text:tab" => out.push('\t'),
                "w:br" | "text:line-break" => out.push('\n'),
                _ => {}
            },
            Ok(Event::Text(t)) if depth > 0 => out.push_str(&t.xml10_content()),
            Ok(Event::GeneralRef(r)) if depth > 0 => out.push_str(&reference(&r)),
            Ok(Event::End(e)) => {
                let n = e.name().0;
                if text.contains(&n) {
                    depth = depth.saturating_sub(1);
                }
                if line.contains(&n) {
                    out.push('\n');
                } else if cell.contains(&n) {
                    out.push('\t');
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        if out.len() > MAX_TEXT {
            break;
        }
        buf.clear();
    }
    out
}

/// `&amp;`, `&#233;` … inside text.
fn reference(r: &quick_xml::events::BytesRef) -> String {
    if let Ok(Some(c)) = r.resolve_char_ref() {
        return c.to_string();
    }
    match r.xml10_content().as_ref() {
        "amp" => "&",
        "lt" => "<",
        "gt" => ">",
        "quot" => "\"",
        "apos" => "'",
        _ => "",
    }
    .to_string()
}

type Zip = zip::ZipArchive<std::io::Cursor<Vec<u8>>>;

fn part(zip: &mut Zip, name: &str) -> Option<Vec<u8>> {
    let file = zip.by_name(name).ok()?;
    let mut out = Vec::new();
    file.take(MAX_PART).read_to_end(&mut out).ok()?;
    Some(out)
}

/// Part names like "ppt/slides/slide12.xml", in number order.
fn numbered(zip: &Zip, prefix: &str) -> Vec<String> {
    let mut names: Vec<(u32, String)> = zip
        .file_names()
        .filter_map(|n| {
            let n = n.ok()?;
            let rest = n.strip_prefix(prefix)?.strip_suffix(".xml")?;
            Some((rest.parse().ok()?, n.to_string()))
        })
        .collect();
    names.sort();
    names.into_iter().map(|(_, n)| n).collect()
}

fn docx(zip: &mut Zip) -> Result<String, String> {
    let xml = part(zip, "word/document.xml").ok_or("Not a Word document")?;
    Ok(xml_text(&xml, &["w:t"], &["w:p"], &["w:tc"]))
}

fn pptx(zip: &mut Zip) -> Result<String, String> {
    let slides = numbered(zip, "ppt/slides/slide");
    if slides.is_empty() {
        return Err("Not a PowerPoint file".into());
    }
    let mut out = String::new();
    for (i, name) in slides.iter().enumerate() {
        let xml = part(zip, name).unwrap_or_default();
        out.push_str(&format!("--- Slide {} ---\n", i + 1));
        out.push_str(&xml_text(&xml, &["a:t"], &["a:p"], &[]));
        out.push('\n');
    }
    Ok(out)
}

fn xlsx(zip: &mut Zip) -> Result<String, String> {
    // Shared strings: cells of type "s" hold an index into this list.
    let shared: Vec<String> = part(zip, "xl/sharedStrings.xml")
        .map(|xml| {
            xml_text(&xml, &["t"], &["si"], &[])
                .split('\n')
                .map(String::from)
                .collect()
        })
        .unwrap_or_default();
    let sheets = numbered(zip, "xl/worksheets/sheet");
    if sheets.is_empty() {
        return Err("Not an Excel file".into());
    }
    let mut out = String::new();
    for (i, name) in sheets.iter().enumerate() {
        let xml = part(zip, name).unwrap_or_default();
        out.push_str(&format!("--- Sheet {} ---\n", i + 1));
        let mut reader = Reader::from_reader(xml.as_slice());
        let (mut is_shared, mut in_value, mut row) = (false, false, Vec::<String>::new());
        let mut buf = Vec::new();
        loop {
            match reader.read_event_into(&mut buf) {
                Ok(Event::Start(e)) if e.name().0 == "c" => {
                    is_shared = e
                        .attributes()
                        .flatten()
                        .any(|a| a.key.0 == "t" && a.value.as_ref() == "s");
                }
                Ok(Event::Start(e)) if matches!(e.name().0, "v" | "t") => in_value = true,
                Ok(Event::Text(t)) if in_value => {
                    let v = t.xml10_content().into_owned();
                    row.push(if is_shared {
                        v.trim()
                            .parse::<usize>()
                            .ok()
                            .and_then(|i| shared.get(i).cloned())
                            .unwrap_or_default()
                    } else {
                        v
                    });
                }
                Ok(Event::End(e)) if matches!(e.name().0, "v" | "t") => in_value = false,
                Ok(Event::End(e)) if e.name().0 == "row" => {
                    out.push_str(&row.join("\t"));
                    out.push('\n');
                    row.clear();
                }
                Ok(Event::Eof) | Err(_) => break,
                _ => {}
            }
            if out.len() > MAX_TEXT {
                break;
            }
            buf.clear();
        }
    }
    Ok(out)
}

fn odf(zip: &mut Zip) -> Result<String, String> {
    let xml = part(zip, "content.xml").ok_or("Not an OpenDocument file")?;
    Ok(xml_text(
        &xml,
        &["text:p", "text:h", "text:span"],
        &["text:p", "text:h", "table:table-row"],
        &["table:table-cell"],
    ))
}

fn pdf(bytes: &[u8]) -> Result<String, String> {
    // A broken PDF must not close the app.
    std::panic::catch_unwind(|| pdf_extract::extract_text_from_mem(bytes))
        .map_err(|_| "This PDF could not be read".to_string())?
        .map_err(|e| format!("This PDF could not be read: {e}"))
}

/// The document's text (`name` decides the kind).
pub fn to_text(name: &str, bytes: Vec<u8>) -> Result<String, String> {
    let kind = kind_of(name).ok_or("Not a document DesktopAgent can read")?;
    let mut text = if kind == "pdf" {
        pdf(&bytes)?
    } else {
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes))
            .map_err(|_| "The file is damaged or not this kind of document".to_string())?;
        match kind {
            "docx" => docx(&mut zip)?,
            "pptx" => pptx(&mut zip)?,
            "xlsx" => xlsx(&mut zip)?,
            _ => odf(&mut zip)?,
        }
    };
    if text.len() > MAX_TEXT {
        let mut end = MAX_TEXT;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
        text.push_str("\n[… cut: the document is longer]");
    }
    Ok(text)
}

/// Reads a workspace document as text (app folder only, no question needed).
#[tauri::command]
pub async fn doc_to_text(app: tauri::AppHandle, path: String) -> Result<String, String> {
    use tauri::Manager;
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let located = crate::files::locate(&root, &path)?;
    if !located.own {
        return Err("Only documents in the workspace can be read".into());
    }
    let real = located.real;
    tauri::async_runtime::spawn_blocking(move || {
        let size = std::fs::metadata(&real).map_err(|e| e.to_string())?.len();
        if size > MAX_FILE {
            return Err("The document is too big (over 64 MB)".to_string());
        }
        let bytes = std::fs::read(&real).map_err(|e| e.to_string())?;
        let name = Path::new(&real)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        to_text(&name, bytes)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn zip_of(parts: &[(&str, &str)]) -> Vec<u8> {
        let mut out = std::io::Cursor::new(Vec::new());
        {
            let mut z = zip::ZipWriter::new(&mut out);
            for (name, body) in parts {
                z.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
                z.write_all(body.as_bytes()).unwrap();
            }
            z.finish().unwrap();
        }
        out.into_inner()
    }

    #[test]
    fn reads_word_with_paragraphs_and_symbols() {
        let doc = zip_of(&[(
            "word/document.xml",
            r#"<w:document><w:body><w:p><w:r><w:t>Hello &amp; welcome</w:t></w:r></w:p><w:p><w:r><w:t>Line two</w:t><w:tab/><w:t>tabbed</w:t></w:r></w:p></w:body></w:document>"#,
        )]);
        assert_eq!(to_text("a.docx", doc).unwrap(), "Hello & welcome\nLine two\ttabbed\n");
    }

    #[test]
    fn reads_slides_in_order() {
        let ppt = zip_of(&[
            ("ppt/slides/slide10.xml", "<p:sld><a:p><a:t>Ten</a:t></a:p></p:sld>"),
            ("ppt/slides/slide2.xml", "<p:sld><a:p><a:t>Two</a:t></a:p></p:sld>"),
        ]);
        let text = to_text("deck.pptx", ppt).unwrap();
        assert!(text.find("Two").unwrap() < text.find("Ten").unwrap());
        assert!(text.contains("--- Slide 2 ---\nTen"));
    }

    #[test]
    fn reads_sheets_with_shared_strings_and_numbers() {
        let xls = zip_of(&[
            ("xl/sharedStrings.xml", "<sst><si><t>Name</t></si><si><t>Tea</t></si></sst>"),
            (
                "xl/worksheets/sheet1.xml",
                r#"<worksheet><sheetData><row><c t="s"><v>0</v></c><c><v>Price</v></c></row><row><c t="s"><v>1</v></c><c><v>3.5</v></c></row></sheetData></worksheet>"#,
            ),
        ]);
        assert_eq!(
            to_text("book.xlsx", xls).unwrap(),
            "--- Sheet 1 ---\nName\tPrice\nTea\t3.5\n"
        );
    }

    /// By hand, on real files: DOCS=folder cargo test real_documents -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_documents() {
        let dir = std::env::var("DOCS").expect("DOCS=folder");
        for entry in std::fs::read_dir(dir).unwrap().flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if kind_of(&name).is_some() {
                let text = to_text(&name, std::fs::read(entry.path()).unwrap());
                println!("== {name} ==\n{text:?}");
            }
        }
    }

    #[test]
    fn odf_and_refusals() {
        let odt = zip_of(&[(
            "content.xml",
            "<office:document-content><office:body><text:p>Open <text:span>doc</text:span></text:p></office:body></office:document-content>",
        )]);
        assert_eq!(to_text("x.odt", odt).unwrap(), "Open doc\n");
        assert!(to_text("x.exe", vec![1, 2]).is_err());
        assert!(to_text("x.docx", b"not a zip".to_vec()).is_err());
        assert!(to_text("x.pdf", b"%PDF-broken".to_vec()).is_err());
        assert_eq!(kind_of("Report.PDF"), Some("pdf"));
    }
}
