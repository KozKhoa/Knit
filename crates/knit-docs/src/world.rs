use image::ImageFormat;
use knit_core::{safe_join_within, CancellationToken, KnitError, Result};
use regex::Regex;
use std::collections::HashMap;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use typst::diag::{FileError, FileResult};
use typst::foundations::{Bytes, Datetime, Duration, Label, Selector};
use typst::introspection::Introspector;
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World, WorldExt};
use typst_layout::PagedDocument;

const AFACAD_REGULAR_TTF: &[u8] =
    include_bytes!("../../../src/assets/fonts/Afacad-VariableFont_wght.ttf");
const AFACAD_ITALIC_TTF: &[u8] =
    include_bytes!("../../../src/assets/fonts/Afacad-Italic-VariableFont_wght.ttf");
const ROBOTO_REGULAR_TTF: &[u8] =
    include_bytes!("../../../src/assets/fonts/Roboto-VariableFont_wdth,wght.ttf");
const ROBOTO_ITALIC_TTF: &[u8] =
    include_bytes!("../../../src/assets/fonts/Roboto-Italic-VariableFont_wdth,wght.ttf");
const LORA_REGULAR_TTF: &[u8] =
    include_bytes!("../../../src/assets/fonts/Lora-VariableFont_wght.ttf");
const LORA_ITALIC_TTF: &[u8] =
    include_bytes!("../../../src/assets/fonts/Lora-Italic-VariableFont_wght.ttf");
const NOTO_EMOJI_TTF: &[u8] =
    include_bytes!("../../../src/assets/fonts/NotoEmoji-Regular.ttf");
const NOTO_SYMBOLS_TTF: &[u8] =
    include_bytes!("../../../src/assets/fonts/NotoSansSymbols[wght].ttf");
const NOTO_SYMBOLS2_TTF: &[u8] =
    include_bytes!("../../../src/assets/fonts/NotoSansSymbols2-Regular.ttf");

struct FontCatalog {
    book: LazyHash<FontBook>,
    fonts: Vec<Font>,
}

fn push_font_bytes(book: &mut FontBook, fonts: &mut Vec<Font>, data: Vec<u8>) {
    let bytes = Bytes::new(data);
    for font in Font::iter(bytes) {
        book.push(font.info().clone());
        fonts.push(font);
    }
}

fn load_system_emoji_fonts(book: &mut FontBook, fonts: &mut Vec<Font>) {
    let mut dirs_to_scan: Vec<PathBuf> = vec![
        PathBuf::from("/usr/share/fonts"),
        PathBuf::from("/usr/local/share/fonts"),
        PathBuf::from("/System/Library/Fonts"),
        PathBuf::from("/Library/Fonts"),
        PathBuf::from("C:\\Windows\\Fonts"),
    ];
    if let Ok(home) = std::env::var("HOME") {
        let home_path = PathBuf::from(home);
        dirs_to_scan.push(home_path.join(".local/share/fonts"));
        dirs_to_scan.push(home_path.join(".fonts"));
        dirs_to_scan.push(home_path.join("Library/Fonts"));
    }

    let mut stack = dirs_to_scan;
    let mut loaded = 0usize;
    while let Some(dir) = stack.pop() {
        if loaded >= 16 || !dir.is_dir() {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
                continue;
            };
            let ext_lower = ext.to_ascii_lowercase();
            if ext_lower != "ttf" && ext_lower != "otf" && ext_lower != "ttc" {
                continue;
            }
            let name_lower = path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|s| s.to_ascii_lowercase())
                .unwrap_or_default();
            let is_emoji_or_symbol = name_lower.contains("emoji")
                || name_lower.contains("seguiemj")
                || name_lower.contains("seguisym")
                || name_lower.contains("twemoji")
                || name_lower.contains("symbola");
            if !is_emoji_or_symbol {
                continue;
            }
            if let Ok(raw) = std::fs::read(&path) {
                push_font_bytes(book, fonts, raw);
                loaded += 1;
                if loaded >= 16 {
                    break;
                }
            }
        }
    }
}

fn shared_fonts() -> &'static FontCatalog {
    static CATALOG: OnceLock<FontCatalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        let mut book = FontBook::new();
        let mut fonts = Vec::new();

        for data in typst_assets::fonts() {
            push_font_bytes(&mut book, &mut fonts, data.to_vec());
        }

        for embedded in [
            AFACAD_REGULAR_TTF,
            AFACAD_ITALIC_TTF,
            ROBOTO_REGULAR_TTF,
            ROBOTO_ITALIC_TTF,
            LORA_REGULAR_TTF,
            LORA_ITALIC_TTF,
            NOTO_EMOJI_TTF,
            NOTO_SYMBOLS2_TTF,
            NOTO_SYMBOLS_TTF,
        ] {
            push_font_bytes(&mut book, &mut fonts, embedded.to_vec());
        }

        load_system_emoji_fonts(&mut book, &mut fonts);

        FontCatalog {
            book: LazyHash::new(book),
            fonts,
        }
    })
}

pub struct KnitTypstWorld {
    library: LazyHash<Library>,
    catalog: &'static FontCatalog,
    main_id: FileId,
    source: Source,
    base_dir: Option<PathBuf>,
    virtual_files: Arc<HashMap<String, Bytes>>,
}

impl KnitTypstWorld {
    pub fn new(
        markup: &str,
        base_dir: Option<&Path>,
        virtual_files: Arc<HashMap<String, Bytes>>,
    ) -> Self {
        let catalog = shared_fonts();
        let main_id = RootedPath::new(
            VirtualRoot::Project,
            VirtualPath::new("main.typ").expect("valid virtual main path"),
        )
        .intern();
        let source = Source::new(main_id, markup.to_string());

        Self {
            library: LazyHash::new(Library::builder().build()),
            catalog,
            main_id,
            source,
            base_dir: base_dir.map(Path::to_path_buf),
            virtual_files,
        }
    }
}

impl World for KnitTypstWorld {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        &self.catalog.book
    }

    fn main(&self) -> FileId {
        self.main_id
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.main_id {
            Ok(self.source.clone())
        } else {
            Err(FileError::NotFound(id.vpath().get_with_slash().into()))
        }
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        if id == self.main_id {
            return Ok(Bytes::from_string(self.source.text().to_string()));
        }
        let rel = id.vpath().get_without_slash();
        if let Some(bytes) = self.virtual_files.get(rel) {
            return Ok(bytes.clone());
        }
        if let Some(ref base) = self.base_dir {
            if let Ok(resolved) = safe_join_within(base, rel) {
                if resolved.is_file() {
                    if let Ok(raw) = std::fs::read(&resolved) {
                        return Ok(Bytes::new(raw));
                    }
                }
            }
        }
        Err(FileError::NotFound(id.vpath().get_with_slash().into()))
    }

    fn font(&self, index: usize) -> Option<Font> {
        self.catalog.fonts.get(index).cloned()
    }

    fn today(&self, _offset: Option<Duration>) -> Option<Datetime> {
        Datetime::from_ymd(2026, 1, 1)
    }
}

struct ComemoEvictGuard(usize);

impl Drop for ComemoEvictGuard {
    fn drop(&mut self) {
        comemo::evict(self.0);
    }
}

/// Dọn toàn bộ global memoization cache của Typst (`comemo`).
pub fn evict_typst_cache() {
    comemo::evict(0);
}

/// Biên dịch mã nguồn Typst thành bytes PDF và số trang.
/// Đồng thời chuẩn hóa định dạng ảnh theo magic bytes (khắc phục lỗi `.jpg` nhưng chứa dữ liệu PNG/WebP/BMP...).
pub fn compile_typst_to_pdf(
    markup: &str,
    base_dir: Option<&Path>,
    virtual_files: &HashMap<String, Vec<u8>>,
) -> Result<(Vec<u8>, usize)> {
    compile_typst_to_pdf_with_toc(markup, base_dir, virtual_files, None)
}

fn format_typst_compile_error(
    errs: &[typst::diag::SourceDiagnostic],
    world: Option<&KnitTypstWorld>,
    fallback_prefix: &str,
) -> KnitError {
    let msgs: Vec<String> = errs
        .iter()
        .map(|e| {
            let msg = e.message.to_string();
            if let Some(rest) = msg.strip_prefix("file not found") {
                return format!("Not found{rest}");
            }
            if let Some(w) = world {
                if let Some(range) = w.range(e.span) {
                    let full_text = w.source.text();
                    let start = range.start.min(full_text.len());
                    let prefix = &full_text[..start];
                    let line_idx = prefix.bytes().filter(|&b| b == b'\n').count();
                    let line_no = line_idx + 1;
                    let col_no = prefix
                        .rsplit('\n')
                        .next()
                        .map(|s| s.chars().count() + 1)
                        .unwrap_or(1);
                    let line_text = full_text.lines().nth(line_idx).unwrap_or("").trim();
                    let snippet: String = line_text.chars().take(72).collect();
                    if snippet.is_empty() {
                        return format!("{msg} (Typst line {line_no}:{col_no})");
                    }
                    return format!("{msg} (Typst line {line_no}:{col_no}, near `{snippet}`)");
                }
            }
            msg
        })
        .collect();
    let joined = msgs.join("; ");
    if msgs.iter().all(|m| m.starts_with("Not found")) {
        KnitError::InvalidInput(joined)
    } else {
        KnitError::InvalidInput(format!("{fallback_prefix}: {joined}"))
    }
}

fn compile_typst_doc(
    markup: &str,
    base_dir: Option<&Path>,
    virtual_files: &Arc<HashMap<String, Bytes>>,
) -> Result<PagedDocument> {
    let world = KnitTypstWorld::new(markup, base_dir, Arc::clone(virtual_files));
    let warned = typst::compile::<PagedDocument>(&world);
    let res = warned.output.map_err(|errs| {
        format_typst_compile_error(&errs, Some(&world), "Typst compilation failed")
    });
    drop(world);
    res
}

fn strip_knit_blk_markers(markup: &str) -> String {
    static RE_BLK: OnceLock<Regex> = OnceLock::new();
    let re = RE_BLK.get_or_init(|| Regex::new(r"(?m)^#metadata\(\d+\)\s*<knit-blk>\r?\n?").unwrap());
    re.replace_all(markup, "").into_owned()
}

fn query_label_pages(doc: &PagedDocument, label_name: &'static str) -> Vec<usize> {
    let Some(label) = Label::new(typst::utils::PicoStr::constant(label_name)) else {
        return Vec::new();
    };
    let selector = Selector::Label(label);
    let introspector = doc.introspector();
    introspector
        .query(&selector)
        .into_iter()
        .filter_map(|elem| elem.location().and_then(|loc| introspector.page(loc)).map(|p| p.get()))
        .collect()
}

fn query_block_pages(doc: &PagedDocument) -> Vec<(usize, usize)> {
    let Some(label) = Label::new(typst::utils::PicoStr::constant("knit-blk")) else {
        return Vec::new();
    };
    let selector = Selector::Label(label);
    let introspector = doc.introspector();
    introspector
        .query(&selector)
        .into_iter()
        .filter_map(|elem| {
            let page = elem
                .location()
                .and_then(|loc| introspector.page(loc))
                .map(|p| p.get())?;
            let id = elem
                .to_packed::<typst::introspection::MetadataElem>()
                .and_then(|m| match m.value {
                    typst::foundations::Value::Int(n) if n >= 0 => Some(n as usize),
                    _ => None,
                })?;
            Some((id, page))
        })
        .collect()
}

/// Biên dịch Typst có hỗ trợ chèn Mục lục (`#outline`) tại trang thứ `toc_page` (1-based).
pub fn compile_typst_to_pdf_with_toc(
    markup: &str,
    base_dir: Option<&Path>,
    virtual_files: &HashMap<String, Vec<u8>>,
    toc_page: Option<usize>,
) -> Result<(Vec<u8>, usize)> {
    compile_typst_to_pdf_with_toc_cancellable(markup, base_dir, virtual_files, toc_page, None)
}

pub fn compile_typst_to_pdf_with_toc_cancellable(
    markup: &str,
    base_dir: Option<&Path>,
    virtual_files: &HashMap<String, Vec<u8>>,
    toc_page: Option<usize>,
    cancel: Option<&CancellationToken>,
) -> Result<(Vec<u8>, usize)> {
    if let Some(tok) = cancel {
        if tok.is_cancelled() {
            return Err(KnitError::Cancelled);
        }
    }
    let mut prepared_virtual: HashMap<String, Bytes> = virtual_files
        .iter()
        .map(|(k, v)| (k.clone(), Bytes::new(v.clone())))
        .collect();
    let prepared_markup = prepare_typst_images(markup, base_dir, &mut prepared_virtual);
    compile_typst_with_prepared_assets(
        &prepared_markup,
        base_dir,
        Arc::new(prepared_virtual),
        toc_page,
        cancel,
    )
}

pub(crate) fn compile_typst_with_prepared_assets(
    prepared_markup: &str,
    base_dir: Option<&Path>,
    prepared_virtual: Arc<HashMap<String, Bytes>>,
    toc_page: Option<usize>,
    cancel: Option<&CancellationToken>,
) -> Result<(Vec<u8>, usize)> {
    // Evict stale memoized artifacts from previous compilations when this scope exits.
    let _evict_guard = ComemoEvictGuard(2);

    let check_cancel = || -> Result<()> {
        if let Some(tok) = cancel {
            if tok.is_cancelled() {
                return Err(KnitError::Cancelled);
            }
        }
        Ok(())
    };

    check_cancel()?;

    let final_doc = if let Some(target_page) =
        toc_page.filter(|&p| p > 1 && prepared_markup.contains("<knit-blk>"))
    {
        let pass1 = compile_typst_doc(prepared_markup, base_dir, &prepared_virtual)?;
        check_cancel()?;
        let pages_of_blocks = query_block_pages(&pass1);
        drop(pass1);

        let build_with_split = |block_id: Option<usize>| -> String {
            let toc_snippet = "\n#pagebreak(weak: true)\n#metadata(0) <knit-toc>\n#outline(indent: auto)\n#pagebreak(weak: true)\n";
            let inserted = match block_id {
                Some(k) => {
                    let needle = format!("#metadata({k}) <knit-blk>");
                    if let Some(pos) = prepared_markup.find(&needle) {
                        let mut s =
                            String::with_capacity(prepared_markup.len() + toc_snippet.len());
                        s.push_str(&prepared_markup[..pos]);
                        s.push_str(toc_snippet);
                        s.push_str(&prepared_markup[pos..]);
                        s
                    } else {
                        format!("{prepared_markup}\n#pagebreak(weak: true)\n#metadata(0) <knit-toc>\n#outline(indent: auto)\n")
                    }
                }
                None => format!(
                    "{prepared_markup}\n#pagebreak(weak: true)\n#metadata(0) <knit-toc>\n#outline(indent: auto)\n"
                ),
            };
            strip_knit_blk_markers(&inserted)
        };

        let mut split_pos = pages_of_blocks.iter().position(|&(_, p)| p >= target_page);
        let mut candidate_markup = build_with_split(split_pos.map(|i| pages_of_blocks[i].0));
        let mut candidate_doc =
            compile_typst_doc(&candidate_markup, base_dir, &prepared_virtual)?;
        check_cancel()?;

        if let (Some(pos), Some(&toc_actual)) = (
            split_pos,
            query_label_pages(&candidate_doc, "knit-toc").first(),
        ) {
            if toc_actual > target_page && pos > 0 {
                drop(candidate_doc);
                split_pos = Some(pos - 1);
                candidate_markup = build_with_split(split_pos.map(|i| pages_of_blocks[i].0));
                candidate_doc =
                    compile_typst_doc(&candidate_markup, base_dir, &prepared_virtual)?;
                check_cancel()?;
            }
        }
        candidate_doc
    } else {
        let clean;
        let markup_ref = if prepared_markup.contains("<knit-blk>") {
            clean = strip_knit_blk_markers(prepared_markup);
            clean.as_str()
        } else {
            prepared_markup
        };
        compile_typst_doc(markup_ref, base_dir, &prepared_virtual)?
    };

    check_cancel()?;
    let pages = final_doc.pages().len();
    let pdf_bytes = typst_pdf::pdf(&final_doc, &typst_pdf::PdfOptions::default())
        .map_err(|errs| format_typst_compile_error(&errs, None, "Typst PDF export failed"))?;
    drop(final_doc);
    Ok((pdf_bytes, pages))
}

fn escape_xml_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(ch),
        }
    }
    out
}

fn truncate_middle(s: &str, max_chars: usize) -> String {
    let count = s.chars().count();
    if count <= max_chars || max_chars < 10 {
        return s.to_string();
    }
    let keep_head = (max_chars - 3) / 3;
    let keep_tail = max_chars - 3 - keep_head;
    let head: String = s.chars().take(keep_head).collect();
    let tail: String = s.chars().skip(count - keep_tail).collect();
    format!("{head}...{tail}")
}

fn make_missing_image_placeholder_svg(raw_path: &str) -> Vec<u8> {
    let display = truncate_middle(raw_path.trim(), 58);
    let escaped = escape_xml_text(&display);
    format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="520" height="82" viewBox="0 0 520 82">
  <rect x="1" y="1" width="518" height="80" rx="4" fill="#FFF8E1" stroke="#FFC107" stroke-width="1.5" stroke-dasharray="6 4"/>
  <circle cx="28" cy="41" r="11" fill="#DC3545"/>
  <text x="28" y="46" font-family="sans-serif" font-size="14" font-weight="700" fill="#FFFFFF" text-anchor="middle">!</text>
  <text x="50" y="33" font-family="sans-serif" font-size="13" font-weight="700" fill="#856404">Not found</text>
  <text x="50" y="54" font-family="monospace" font-size="11" fill="#495057">{escaped}</text>
</svg>"##
    )
    .into_bytes()
}

pub(crate) fn prepare_typst_images(
    markup: &str,
    base_dir: Option<&Path>,
    virtual_files: &mut HashMap<String, Bytes>,
) -> String {
    static RE_IMAGE_CALL: OnceLock<Regex> = OnceLock::new();
    let re = RE_IMAGE_CALL.get_or_init(|| Regex::new(r#"image\("((?:[^"\\]|\\.)*)""#).unwrap());

    let mut counter = 0usize;
    let mut mapped: HashMap<String, String> = HashMap::new();

    re.replace_all(markup, |caps: &regex::Captures| {
        let raw_literal = &caps[1];
        let unescaped = unescape_typst_string(raw_literal);

        if let Some(cached_virtual) = mapped.get(&unescaped) {
            return format!("image(\"{cached_virtual}\"");
        }

        let resolved_bytes = load_image_bytes(&unescaped, base_dir, virtual_files);
        if let Some(raw) = resolved_bytes {
            if let Some((canonical_ext, final_bytes)) = normalize_image_payload(&unescaped, &raw) {
                let virtual_name = format!("__knit_img_{counter}.{canonical_ext}");
                counter += 1;
                virtual_files.insert(virtual_name.clone(), Bytes::new(final_bytes));
                mapped.insert(unescaped, virtual_name.clone());
                return format!("image(\"{virtual_name}\"");
            }
        }

        let missing_name = format!("__knit_missing_{counter}.svg");
        counter += 1;
        virtual_files.insert(
            missing_name.clone(),
            Bytes::new(make_missing_image_placeholder_svg(&unescaped)),
        );
        mapped.insert(unescaped, missing_name.clone());
        format!("image(\"{missing_name}\"")
    })
    .into_owned()
}

fn load_image_bytes(
    rel_path: &str,
    base_dir: Option<&Path>,
    virtual_files: &HashMap<String, Bytes>,
) -> Option<Vec<u8>> {
    let trimmed = rel_path.trim_start_matches("./");
    if let Some(b) = virtual_files.get(rel_path).or_else(|| virtual_files.get(trimmed)) {
        return Some(b.as_slice().to_vec());
    }
    let base = base_dir?;
    let try_paths = [
        rel_path.to_string(),
        percent_decode_simple(rel_path),
    ];
    for candidate in &try_paths {
        if let Ok(resolved) = safe_join_within(base, candidate) {
            if resolved.is_file() {
                if let Ok(raw) = std::fs::read(&resolved) {
                    return Some(raw);
                }
            }
        }
    }
    None
}

/// Kiểm tra magic bytes thực sự của ảnh; nếu sai đuôi file hoặc là định dạng không chuẩn với Typst (BMP/TIFF/WebP...),
/// chuẩn hóa về đuôi & dữ liệu khớp hoàn toàn để Typst giải mã an toàn.
fn normalize_image_payload(orig_path: &str, raw: &[u8]) -> Option<(&'static str, Vec<u8>)> {
    let trimmed = raw.iter().position(|&b| !b.is_ascii_whitespace()).map(|i| &raw[i..])?;
    if trimmed.starts_with(b"<svg") || trimmed.starts_with(b"<?xml") {
        let lower_head = String::from_utf8_lossy(&trimmed[..trimmed.len().min(256)]).to_ascii_lowercase();
        if lower_head.contains("<svg") {
            return Some(("svg", raw.to_vec()));
        }
    }

    match image::guess_format(raw) {
        Ok(ImageFormat::Png) => Some(("png", raw.to_vec())),
        Ok(ImageFormat::Jpeg) => Some(("jpg", raw.to_vec())),
        Ok(ImageFormat::Gif) => Some(("gif", raw.to_vec())),
        Ok(_) => {
            // WebP, BMP, TIFF, ICO, etc.: transcode to lossless PNG for universal Typst compatibility
            let decoded = image::load_from_memory(raw).ok()?;
            let mut png_out = Vec::new();
            decoded.write_to(&mut Cursor::new(&mut png_out), ImageFormat::Png).ok()?;
            Some(("png", png_out))
        }
        Err(_) => {
            // Check extension fallback only if bytes aren't sniffable
            let ext = Path::new(orig_path)
                .extension()
                .and_then(|e| e.to_str())
                .map(|s| s.to_ascii_lowercase());
            match ext.as_deref() {
                Some("svg") => Some(("svg", raw.to_vec())),
                _ => None,
            }
        }
    }
}

fn unescape_typst_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            if let Some(next) = chars.next() {
                match next {
                    '\\' => out.push('\\'),
                    '"' => out.push('"'),
                    'n' => out.push('\n'),
                    't' => out.push('\t'),
                    other => {
                        out.push('\\');
                        out.push(other);
                    }
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn percent_decode_simple(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push((h << 4) | l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::markdown::markdown_to_typst;
    use crate::models::DocConvertOptions;

    #[test]
    fn toc_page_inserts_in_middle_of_document_not_just_start_or_end() {
        let mut md = String::from("# Intro Page\n\nIntroductory text.\n\n");
        for idx in 1..=65 {
            md.push_str(&format!(
                "## Section {idx}\n\nParagraph content for section {idx} with enough text to span across multiple pages cleanly during Typst layout.\n\n"
            ));
        }

        let opts = DocConvertOptions {
            include_toc: true,
            toc_page: 3,
            ..DocConvertOptions::default()
        };
        let markup = markdown_to_typst(&md, &opts);
        let mut virtual_files = HashMap::new();
        let prepared = prepare_typst_images(&markup, None, &mut virtual_files);
        let virtual_files = Arc::new(virtual_files);
        let pass1 = compile_typst_doc(&prepared, None, &virtual_files).unwrap();
        let total_pages_without_toc = pass1.pages().len();
        assert!(
            total_pages_without_toc >= 5,
            "expected at least 5 pages, got {total_pages_without_toc}"
        );

        let block_pages = query_block_pages(&pass1);
        assert!(
            block_pages.iter().any(|&(_, p)| p == 2)
                && block_pages.iter().any(|&(_, p)| p >= 4),
            "expected blocks spread across multiple pages, got: {block_pages:?}"
        );

        // Verify compile_typst_to_pdf_with_toc places <knit-toc> on page 3 (strictly in the middle)
        let (pdf_bytes, final_pages) =
            compile_typst_to_pdf_with_toc(&markup, None, &HashMap::new(), Some(3)).unwrap();
        assert!(pdf_bytes.starts_with(b"%PDF-"));
        assert!(final_pages > total_pages_without_toc);

        // Re-run the split check to inspect the actual page of <knit-toc>
        let split_pos = block_pages.iter().position(|&(_, p)| p >= 3).unwrap();
        let needle = format!("#metadata({}) <knit-blk>", block_pages[split_pos].0);
        let pos = prepared.find(&needle).unwrap();
        let toc_snippet = "\n#pagebreak(weak: true)\n#metadata(0) <knit-toc>\n#outline(indent: auto)\n#pagebreak(weak: true)\n";
        let mut inserted = String::new();
        inserted.push_str(&prepared[..pos]);
        inserted.push_str(toc_snippet);
        inserted.push_str(&prepared[pos..]);
        let candidate = compile_typst_doc(&strip_knit_blk_markers(&inserted), None, &virtual_files).unwrap();
        let toc_pages = query_label_pages(&candidate, "knit-toc");
        assert_eq!(toc_pages, vec![3], "TOC should land on page 3, got {toc_pages:?}");
    }
}
