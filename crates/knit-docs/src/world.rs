use image::ImageFormat;
use knit_core::{safe_join_within, KnitError, Result};
use regex::Regex;
use std::collections::HashMap;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use typst::diag::{FileError, FileResult};
use typst::foundations::{Bytes, Datetime, Duration};
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World};
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
    virtual_files: HashMap<String, Bytes>,
}

impl KnitTypstWorld {
    pub fn new(
        markup: &str,
        base_dir: Option<&Path>,
        virtual_files: HashMap<String, Bytes>,
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

/// Biên dịch mã nguồn Typst thành bytes PDF và số trang.
/// Đồng thời chuẩn hóa định dạng ảnh theo magic bytes (khắc phục lỗi `.jpg` nhưng chứa dữ liệu PNG/WebP/BMP...).
pub fn compile_typst_to_pdf(
    markup: &str,
    base_dir: Option<&Path>,
    virtual_files: &HashMap<String, Vec<u8>>,
) -> Result<(Vec<u8>, usize)> {
    let mut prepared_virtual: HashMap<String, Bytes> = virtual_files
        .iter()
        .map(|(k, v)| (k.clone(), Bytes::new(v.clone())))
        .collect();
    let prepared_markup = prepare_typst_images(markup, base_dir, &mut prepared_virtual);

    let world = KnitTypstWorld::new(&prepared_markup, base_dir, prepared_virtual);
    let warned = typst::compile::<PagedDocument>(&world);
    let doc = warned.output.map_err(|errs| {
        let msgs: Vec<String> = errs.iter().map(|e| e.message.to_string()).collect();
        KnitError::InvalidInput(format!("Loi bien dich Typst: {}", msgs.join("; ")))
    })?;
    let pages = doc.pages().len();
    let pdf_bytes = typst_pdf::pdf(&doc, &typst_pdf::PdfOptions::default()).map_err(|errs| {
        let msgs: Vec<String> = errs.iter().map(|e| e.message.to_string()).collect();
        KnitError::InvalidInput(format!("Loi xuat PDF tu Typst: {}", msgs.join("; ")))
    })?;
    Ok((pdf_bytes, pages))
}

fn prepare_typst_images(
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
        let Some(raw) = resolved_bytes else {
            return caps[0].to_string();
        };

        if let Some((canonical_ext, final_bytes)) = normalize_image_payload(&unescaped, &raw) {
            let virtual_name = format!("__knit_img_{counter}.{canonical_ext}");
            counter += 1;
            virtual_files.insert(virtual_name.clone(), Bytes::new(final_bytes));
            mapped.insert(unescaped, virtual_name.clone());
            format!("image(\"{virtual_name}\"")
        } else {
            caps[0].to_string()
        }
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
