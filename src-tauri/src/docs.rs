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
/// Most parts (files) inside a document, and most bytes unpacked from all
/// of them together (security review 2026-11-17: a document of many
/// parts, or many slides, can't fill the PC's memory).
const MAX_ENTRIES: usize = 10_000;
const MAX_UNPACKED: u64 = 256 * 1024 * 1024;
pub const TOO_MANY_PARTS: &str = "The document has too many parts inside; it isn't read";
pub const TOO_BIG_INSIDE: &str = "The document is too large inside (over 256 MB unpacked); it isn't read";

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

/// A zipped document and how many more bytes may be unpacked from it.
struct Doc {
    zip: Zip,
    left: u64,
}

/// Opens a zipped document: at most `max_entries` parts, `unpacked`
/// bytes from all of them.
fn open_doc(bytes: Vec<u8>, max_entries: usize, unpacked: u64) -> Result<Doc, String> {
    let zip = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|_| "The file is damaged or not this kind of document".to_string())?;
    if zip.len() > max_entries {
        return Err(TOO_MANY_PARTS.into());
    }
    Ok(Doc { zip, left: unpacked })
}

/// One part (None: not there or unreadable), cut at MAX_PART; Err when it
/// would take the whole document past its unpacked budget.
fn part(doc: &mut Doc, name: &str) -> Result<Option<Vec<u8>>, String> {
    let Ok(file) = doc.zip.by_name(name) else {
        return Ok(None);
    };
    let budget = doc.left.min(MAX_PART);
    let mut out = Vec::new();
    if file.take(budget + 1).read_to_end(&mut out).is_err() {
        return Ok(None);
    }
    if out.len() as u64 > budget {
        if budget == doc.left {
            return Err(TOO_BIG_INSIDE.into());
        }
        out.truncate(budget as usize);
    }
    doc.left -= out.len() as u64;
    Ok(Some(out))
}

/// Part names like "ppt/slides/slide12.xml", in number order.
fn numbered(doc: &Doc, prefix: &str) -> Vec<String> {
    let mut names: Vec<(u32, String)> = doc
        .zip
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

fn docx(doc: &mut Doc) -> Result<String, String> {
    let xml = part(doc, "word/document.xml")?.ok_or("Not a Word document")?;
    Ok(xml_text(&xml, &["w:t"], &["w:p"], &["w:tc"]))
}

fn pptx(doc: &mut Doc) -> Result<String, String> {
    let slides = numbered(doc, "ppt/slides/slide");
    if slides.is_empty() {
        return Err("Not a PowerPoint file".into());
    }
    let mut out = String::new();
    for (i, name) in slides.iter().enumerate() {
        // Enough already (as xlsx): the rest is never unpacked.
        if out.len() > MAX_TEXT {
            break;
        }
        let xml = part(doc, name)?.unwrap_or_default();
        out.push_str(&format!("--- Slide {} ---\n", i + 1));
        out.push_str(&xml_text(&xml, &["a:t"], &["a:p"], &[]));
        out.push('\n');
    }
    Ok(out)
}

fn xlsx(doc: &mut Doc) -> Result<String, String> {
    // Shared strings: cells of type "s" hold an index into this list.
    let shared: Vec<String> = part(doc, "xl/sharedStrings.xml")?
        .map(|xml| {
            xml_text(&xml, &["t"], &["si"], &[])
                .split('\n')
                .map(String::from)
                .collect()
        })
        .unwrap_or_default();
    let sheets = numbered(doc, "xl/worksheets/sheet");
    if sheets.is_empty() {
        return Err("Not an Excel file".into());
    }
    let mut out = String::new();
    for (i, name) in sheets.iter().enumerate() {
        if out.len() > MAX_TEXT {
            break;
        }
        let xml = part(doc, name)?.unwrap_or_default();
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

fn odf(doc: &mut Doc) -> Result<String, String> {
    let xml = part(doc, "content.xml")?.ok_or("Not an OpenDocument file")?;
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
        let mut doc = open_doc(bytes, MAX_ENTRIES, MAX_UNPACKED)?;
        match kind {
            "docx" => docx(&mut doc)?,
            "pptx" => pptx(&mut doc)?,
            "xlsx" => xlsx(&mut doc)?,
            _ => odf(&mut doc)?,
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
    tauri::async_runtime::spawn_blocking(move || read_document(&real))
        .await
        .map_err(|e| e.to_string())?
}

/// A document file's text, with the size cap: the PC's own tool and a
/// paired device's read (pc_files.rs) both come here. Blocks: call it off
/// the async runtime.
pub fn read_document(real: &Path) -> Result<String, String> {
    let size = std::fs::metadata(real).map_err(|e| e.to_string())?.len();
    if size > MAX_FILE {
        return Err("The document is too big (over 64 MB)".to_string());
    }
    let bytes = std::fs::read(real).map_err(|e| e.to_string())?;
    let name = real
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    to_text(&name, bytes)
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

    #[test]
    fn slides_stop_once_there_is_enough_text() {
        let big = format!("<p:sld><a:p><a:t>{}</a:t></a:p></p:sld>", "x".repeat(MAX_TEXT / 2 + 10));
        let ppt = zip_of(&[
            ("ppt/slides/slide1.xml", big.as_str()),
            ("ppt/slides/slide2.xml", big.as_str()),
            ("ppt/slides/slide3.xml", big.as_str()),
        ]);
        let mut doc = open_doc(ppt, MAX_ENTRIES, MAX_UNPACKED).unwrap();
        let text = pptx(&mut doc).unwrap();
        assert_eq!(text.matches("--- Slide").count(), 2);
        // The third slide was never unpacked.
        assert_eq!(MAX_UNPACKED - doc.left, 2 * big.len() as u64);
    }

    #[test]
    fn many_parts_or_too_much_unpacked_is_refused() {
        let parts: Vec<(String, String)> = (0..20).map(|i| (format!("ppt/slides/slide{i}.xml"), "<a:t>x</a:t>".to_string())).collect();
        let refs: Vec<(&str, &str)> = parts.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();
        let many = zip_of(&refs);
        assert_eq!(open_doc(many.clone(), 10, MAX_UNPACKED).err().unwrap(), TOO_MANY_PARTS);
        assert!(open_doc(many, 20, MAX_UNPACKED).is_ok());
        let body = format!("<w:document><w:p><w:t>{}</w:t></w:p></w:document>", "a".repeat(5000));
        let word = zip_of(&[("word/document.xml", body.as_str())]);
        let mut doc = open_doc(word.clone(), MAX_ENTRIES, 1000).unwrap();
        assert_eq!(docx(&mut doc).unwrap_err(), TOO_BIG_INSIDE);
        let mut doc = open_doc(word, MAX_ENTRIES, 100_000).unwrap();
        assert!(docx(&mut doc).unwrap().starts_with("aaa"));
    }
}
