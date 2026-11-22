use crate::bookmarks::{read_outlines, remap_tree};
use crate::models::{
    BookmarkNode, PageSelection, PdfBuildResult, PdfInfo, PdfMergeConfig, PdfSplitRule,
};
use crate::packer::{part_temp_path, trim_heap_if_supported, StreamingPdfWriter, TempFilesGuard};
use hayro::hayro_interpret::InterpreterSettings;
use hayro::hayro_syntax::object::{
    Array as HayroArray, Dict as HayroDict, ObjectIdentifier as HayroObjId, String as HayroString,
};
use hayro::hayro_syntax::Pdf;
use hayro::vello_cpu::color::palette::css::WHITE;
use hayro::{PixmapSettings, RenderCache, RenderSettings};
use knit_core::{
    ensure_disk_space, CancellationToken, JobProgress, JobReporter, JobReporterExt, KnitError,
    Result,
};
use lopdf::xref::XrefEntry;
use lopdf::{Document, LoadOptions, Object, ObjectId};
use memmap2::Mmap;
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::UNIX_EPOCH;

#[derive(Clone, PartialEq, Eq)]
struct PdfCacheKey {
    canonical: PathBuf,
    len: u64,
    mtime_nanos: u128,
}

const HAYRO_CACHE_CAP: usize = 4;

fn hayro_pdf_cache() -> &'static Mutex<Vec<(PdfCacheKey, Arc<Pdf>)>> {
    static CACHE: OnceLock<Mutex<Vec<(PdfCacheKey, Arc<Pdf>)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(Vec::with_capacity(HAYRO_CACHE_CAP)))
}

/// Giải phóng toàn bộ cache `hayro::Pdf` đã parse và trả bộ nhớ arena về OS.
pub fn clear_pdf_reader_cache() {
    if let Ok(mut guard) = hayro_pdf_cache().lock() {
        guard.clear();
    }
    trim_heap_if_supported();
}

/// Giải phóng cache `hayro::Pdf` theo danh sách đường dẫn cụ thể (nếu `paths` rỗng thì chỉ trim heap).
pub fn evict_pdf_reader_cache_paths(paths: &[PathBuf]) {
    if !paths.is_empty() {
        if let Ok(mut guard) = hayro_pdf_cache().lock() {
            let targets: Vec<PathBuf> = paths
                .iter()
                .map(|p| p.canonicalize().unwrap_or_else(|_| p.to_path_buf()))
                .collect();
            guard.retain(|(key, _)| !targets.contains(&key.canonical));
        }
    }
    trim_heap_if_supported();
}

fn load_cached_hayro_pdf(path: &Path) -> Result<Arc<Pdf>> {
    let meta = fs::metadata(path)?;
    let mtime_nanos = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let key = PdfCacheKey {
        canonical: path.canonicalize().unwrap_or_else(|_| path.to_path_buf()),
        len: meta.len(),
        mtime_nanos,
    };

    if let Ok(mut guard) = hayro_pdf_cache().lock() {
        if let Some(pos) = guard.iter().position(|(k, _)| k == &key) {
            let entry = guard.remove(pos);
            let pdf = Arc::clone(&entry.1);
            guard.push(entry);
            return Ok(pdf);
        }
    }

    let mmap = mmap_pdf_readonly(path)?;
    let parsed = Arc::new(
        Pdf::new(Arc::new(mmap))
            .map_err(|_| KnitError::InvalidInput(format!("Khong doc duoc PDF {}", path.display())))?,
    );

    if let Ok(mut guard) = hayro_pdf_cache().lock() {
        if let Some(pos) = guard.iter().position(|(k, _)| k == &key) {
            guard.remove(pos);
        } else if guard.len() >= HAYRO_CACHE_CAP {
            guard.remove(0);
        }
        guard.push((key, Arc::clone(&parsed)));
    }
    Ok(parsed)
}

fn mmap_pdf_readonly(path: &Path) -> Result<Mmap> {
    let file = File::open(path)?;
    if file.metadata()?.len() == 0 {
        return Err(KnitError::InvalidInput(format!(
            "Tep PDF rong: {}",
            path.display()
        )));
    }
    // SAFETY: tệp chỉ được mở read-only để ánh xạ đọc cấu trúc/render PDF, không bị sửa đổi đồng thời trong tiến trình này.
    unsafe { Mmap::map(&file) }.map_err(KnitError::Io)
}

const KNIT_DEFERRED_STREAM_LEN_KEY: &str = "KnitOrigLen";

fn filter_inspect_objects(id: ObjectId, obj: &mut Object) -> Option<(ObjectId, Object)> {
    if let Object::Stream(ref stream) = obj {
        // Giữ nguyên ObjStm để lopdf giải nén các object cấu trúc; bỏ qua stream ảnh/nội dung nặng.
        if !stream.dict.has_type(b"ObjStm") {
            return None;
        }
    }
    Some((id, obj.clone()))
}

/// Với `merge_pdfs` / `split_pdf`, giải phóng ngay `stream.content` của các stream lớn (>16KB)
/// để tránh giữ toàn bộ payload GB+ trong heap Rust; độ dài gốc được giữ trong `KnitOrigLen`
/// và dữ liệu gốc sẽ được cắt trực tiếp từ `mmap` khi ghi ra ổ đĩa.
fn filter_deferred_heavy_streams(id: ObjectId, obj: &mut Object) -> Option<(ObjectId, Object)> {
    if let Object::Stream(ref mut stream) = obj {
        if !stream.dict.has_type(b"ObjStm") && stream.content.len() > 16 * 1024 {
            let orig_len = stream.content.len() as i64;
            stream
                .dict
                .set(KNIT_DEFERRED_STREAM_LEN_KEY, Object::Integer(orig_len));
            // Thay thế bằng 1 byte để không kích hoạt zero_length_streams của lopdf.
            stream.content = vec![0];
        }
    }
    Some((id, obj.clone()))
}

fn find_stream_data_slice(pdf_buf: &[u8], obj_offset: usize, expected_len: usize) -> Option<&[u8]> {
    if obj_offset >= pdf_buf.len() {
        return None;
    }
    let mut i = obj_offset;
    let len = pdf_buf.len();

    let skip_ws_and_comments = |mut p: usize| -> usize {
        while p < len {
            let b = pdf_buf[p];
            if b == b'%' {
                while p < len && pdf_buf[p] != b'\n' && pdf_buf[p] != b'\r' {
                    p += 1;
                }
            } else if b" \t\n\r\0\x0C".contains(&b) {
                p += 1;
            } else {
                break;
            }
        }
        p
    };

    // Bỏ qua `<obj_num> <gen_num> obj` nếu có
    i = skip_ws_and_comments(i);
    if i < len && pdf_buf[i].is_ascii_digit() {
        while i < len && pdf_buf[i].is_ascii_digit() {
            i += 1;
        }
        i = skip_ws_and_comments(i);
        while i < len && pdf_buf[i].is_ascii_digit() {
            i += 1;
        }
        i = skip_ws_and_comments(i);
        if pdf_buf[i..].starts_with(b"obj") {
            i += 3;
        }
        i = skip_ws_and_comments(i);
    }

    if !pdf_buf[i..].starts_with(b"<<") {
        return None;
    }

    let mut depth = 0i32;
    while i < len {
        match pdf_buf[i] {
            b'<' if i + 1 < len && pdf_buf[i + 1] == b'<' => {
                depth += 1;
                i += 2;
            }
            b'>' if i + 1 < len && pdf_buf[i + 1] == b'>' => {
                depth -= 1;
                i += 2;
                if depth <= 0 {
                    break;
                }
            }
            b'(' => {
                // Literal string: hỗ trợ ngoặc lồng và escape backslash
                i += 1;
                let mut paren_depth = 1i32;
                while i < len && paren_depth > 0 {
                    match pdf_buf[i] {
                        b'\\' => i += 2,
                        b'(' => {
                            paren_depth += 1;
                            i += 1;
                        }
                        b')' => {
                            paren_depth -= 1;
                            i += 1;
                        }
                        _ => i += 1,
                    }
                }
            }
            b'<' => {
                // Hex string
                i += 1;
                while i < len && pdf_buf[i] != b'>' {
                    i += 1;
                }
                if i < len {
                    i += 1;
                }
            }
            b'%' => {
                while i < len && pdf_buf[i] != b'\n' && pdf_buf[i] != b'\r' {
                    i += 1;
                }
            }
            _ => i += 1,
        }
    }

    if depth != 0 {
        return None;
    }

    i = skip_ws_and_comments(i);
    if !pdf_buf[i..].starts_with(b"stream") {
        return None;
    }
    i += 6;
    while i < len && (pdf_buf[i] == b' ' || pdf_buf[i] == b'\t') {
        i += 1;
    }
    if i + 1 < len && pdf_buf[i] == b'\r' && pdf_buf[i + 1] == b'\n' {
        i += 2;
    } else if i < len && (pdf_buf[i] == b'\n' || pdf_buf[i] == b'\r') {
        i += 1;
    } else {
        return None;
    }

    let data_end = i.checked_add(expected_len)?;
    if data_end > len {
        return None;
    }

    let mut tail = data_end;
    if tail + 1 < len && pdf_buf[tail] == b'\r' && pdf_buf[tail + 1] == b'\n' {
        tail += 2;
    } else if tail < len && (pdf_buf[tail] == b'\n' || pdf_buf[tail] == b'\r') {
        tail += 1;
    }
    if !pdf_buf[tail..].starts_with(b"endstream") && !pdf_buf[data_end..].starts_with(b"endstream") {
        return None;
    }

    Some(&pdf_buf[i..data_end])
}

fn decode_hayro_pdf_string(raw: &[u8]) -> String {
    if raw.starts_with(&[0xFE, 0xFF]) && raw.len() >= 2 {
        let u16s: Vec<u16> = raw[2..]
            .chunks_exact(2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16_lossy(&u16s)
    } else if raw.starts_with(&[0xFF, 0xFE]) && raw.len() >= 2 {
        let u16s: Vec<u16> = raw[2..]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16_lossy(&u16s)
    } else {
        String::from_utf8_lossy(raw).into_owned()
    }
}

fn read_outlines_hayro(pdf: &Pdf) -> Vec<BookmarkNode> {
    let page_map: HashMap<HayroObjId, usize> = pdf
        .pages()
        .iter()
        .enumerate()
        .filter_map(|(idx, p)| p.raw().obj_id().map(|id| (id, idx)))
        .collect();

    let Some(catalog) = pdf.xref().get::<HayroDict>(pdf.xref().root_id()) else {
        return Vec::new();
    };
    let Some(outlines_dict) = catalog.get::<HayroDict>(b"Outlines") else {
        return Vec::new();
    };
    let Some(first_ref) = outlines_dict.get_ref(b"First") else {
        return Vec::new();
    };

    let mut visited = HashSet::new();
    read_hayro_outline_siblings(pdf, first_ref.into(), &page_map, &mut visited, 0)
}

fn read_hayro_outline_siblings(
    pdf: &Pdf,
    first_id: HayroObjId,
    page_map: &HashMap<HayroObjId, usize>,
    visited: &mut HashSet<HayroObjId>,
    depth: usize,
) -> Vec<BookmarkNode> {
    if depth > 64 {
        return Vec::new();
    }
    let mut nodes = Vec::new();
    let mut curr = Some(first_id);

    while let Some(obj_id) = curr {
        if !visited.insert(obj_id) {
            break;
        }
        let Some(dict) = pdf.xref().get::<HayroDict>(obj_id) else {
            break;
        };

        let title = dict
            .get::<HayroString>(b"Title")
            .map(|s| decode_hayro_pdf_string(s.as_bytes()))
            .unwrap_or_else(|| "Bookmark".to_string());

        let children = match dict.get_ref(b"First") {
            Some(child_first) => {
                read_hayro_outline_siblings(pdf, child_first.into(), page_map, visited, depth + 1)
            }
            None => Vec::new(),
        };

        let target = resolve_hayro_outline_target(&dict, page_map)
            .or_else(|| children.first().map(|c| c.target_page_index))
            .unwrap_or(0);

        nodes.push(BookmarkNode {
            title,
            target_page_index: target,
            children,
        });

        curr = dict.get_ref(b"Next").map(Into::into);
    }

    nodes
}

fn resolve_hayro_outline_target(
    dict: &HayroDict<'_>,
    page_map: &HashMap<HayroObjId, usize>,
) -> Option<usize> {
    let dest_arr = dict
        .get::<HayroArray>(b"Dest")
        .or_else(|| dict.get::<HayroDict>(b"A").and_then(|a| a.get::<HayroArray>(b"D")))?;
    let page_ref = dest_arr.raw_iter().next()?.as_obj_ref()?;
    let oid: HayroObjId = page_ref.into();
    page_map.get(&oid).copied()
}

pub fn inspect_pdf(path: &Path) -> Result<PdfInfo> {
    if !path.is_file() {
        return Err(KnitError::NotFound(path.display().to_string()));
    }
    let meta = fs::metadata(path)?;

    // Đọc cấu trúc & mục lục zero-copy qua hayro (Mmap) để không bao giờ cấp phát payload stream vào RAM.
    if let Ok(pdf) = load_cached_hayro_pdf(path) {
        let page_count = pdf.pages().len();
        let bookmarks = read_outlines_hayro(&pdf);
        return Ok(PdfInfo {
            path: path.to_path_buf(),
            page_count,
            file_size_bytes: meta.len(),
            bookmarks,
        });
    }

    let mmap = mmap_pdf_readonly(path)?;
    if let Ok(pdf_meta) = Document::load_metadata_mem(&mmap) {
        let page_count = pdf_meta.page_count as usize;
        let has_outlines = mmap.windows(9).any(|w| w == b"/Outlines");
        let bookmarks = if has_outlines {
            let filtered =
                Document::load_mem_with_options(&mmap, LoadOptions::with_filter(filter_inspect_objects));
            match filtered {
                Ok(d) => read_outlines(&d),
                Err(_) => Vec::new(),
            }
        } else {
            Vec::new()
        };
        drop(mmap);
        trim_heap_if_supported();
        return Ok(PdfInfo {
            path: path.to_path_buf(),
            page_count,
            file_size_bytes: meta.len(),
            bookmarks,
        });
    }

    let filtered = Document::load_mem_with_options(&mmap, LoadOptions::with_filter(filter_inspect_objects));
    let doc = match filtered {
        Ok(d) if !d.get_pages().is_empty() => d,
        _ => Document::load_mem(&mmap).map_err(|e| {
            KnitError::InvalidInput(format!("Khong mo duoc PDF {}: {e}", path.display()))
        })?,
    };
    drop(mmap);

    let page_count = doc.get_pages().len();
    let bookmarks = read_outlines(&doc);
    drop(doc);
    trim_heap_if_supported();
    Ok(PdfInfo {
        path: path.to_path_buf(),
        page_count,
        file_size_bytes: meta.len(),
        bookmarks,
    })
}

/// Render 1 trang PDF sang PNG thumbnail bằng engine pure-Rust `hayro` qua mmap + LRU cache (tránh parse lại xref/page-tree nhiều lần).
pub fn render_pdf_thumbnail(path: &Path, page_index: usize, max_width: u32) -> Result<Vec<u8>> {
    let pdf = load_cached_hayro_pdf(path)?;
    let pages = pdf.pages();
    let page = pages.get(page_index).ok_or_else(|| {
        KnitError::InvalidInput(format!(
            "Trang {} khong ton tai (tong {})",
            page_index + 1,
            pages.len()
        ))
    })?;
    render_pdf_page_png(page, max_width)
}

/// Render 1 trang PDF sang JPEG thumbnail nhẹ bằng engine pure-Rust `hayro` qua mmap + LRU cache (dùng cho disk cache).
pub fn render_pdf_thumbnail_jpeg(
    path: &Path,
    page_index: usize,
    max_width: u32,
    quality: u8,
) -> Result<Vec<u8>> {
    let pdf = load_cached_hayro_pdf(path)?;
    let pages = pdf.pages();
    let page = pages.get(page_index).ok_or_else(|| {
        KnitError::InvalidInput(format!(
            "Trang {} khong ton tai (tong {})",
            page_index + 1,
            pages.len()
        ))
    })?;
    let (pw, _ph) = page.render_dimensions();
    let scale = if pw > 0.0 && max_width > 0 {
        (max_width as f32 / pw).clamp(0.1, 4.0)
    } else {
        1.0
    };
    let cache = RenderCache::new();
    let pixmap = hayro::render(
        page,
        &cache,
        &InterpreterSettings::default(),
        &RenderSettings::default(),
        &PixmapSettings {
            x_scale: scale,
            y_scale: scale,
            bg_color: WHITE,
        },
    );
    let w = pixmap.width() as u32;
    let h = pixmap.height() as u32;
    let rgba = pixmap.data_as_u8_slice();
    let mut rgb = Vec::with_capacity((w * h * 3) as usize);
    for px in rgba.chunks_exact(4) {
        rgb.push(px[0]);
        rgb.push(px[1]);
        rgb.push(px[2]);
    }
    let img_buf = image::RgbImage::from_raw(w, h, rgb)
        .ok_or_else(|| KnitError::InvalidInput("Khong tao duoc buffer anh PDF".into()))?;
    let mut out = Vec::new();
    let mut enc =
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality.clamp(30, 95));
    enc.encode_image(&image::DynamicImage::ImageRgb8(img_buf))
        .map_err(|e| KnitError::InvalidInput(format!("Loi nen JPEG PDF thumbnail: {e}")))?;
    Ok(out)
}

/// Render hàng loạt trang từ bytes PDF (trong bộ nhớ) sang PNG thumbnails + trả về tổng số trang.
pub fn render_pdf_bytes_thumbnails(
    bytes: &[u8],
    max_pages: Option<usize>,
    max_width: u32,
) -> Result<(usize, Vec<Vec<u8>>)> {
    let pdf = Pdf::new(Arc::new(bytes.to_vec()))
        .map_err(|_| KnitError::InvalidInput("Khong doc duoc du lieu PDF".into()))?;
    let pages = pdf.pages();
    let total = pages.len();
    let limit = max_pages.map(|m| m.min(total)).unwrap_or(total);
    let mut rendered = Vec::with_capacity(limit);
    for page in pages.iter().take(limit) {
        rendered.push(render_pdf_page_png(page, max_width)?);
    }
    Ok((total, rendered))
}

fn render_pdf_page_png(
    page: &hayro::hayro_syntax::page::Page<'_>,
    max_width: u32,
) -> Result<Vec<u8>> {
    let (pw, _ph) = page.render_dimensions();
    let scale = if pw > 0.0 && max_width > 0 {
        (max_width as f32 / pw).clamp(0.1, 4.0)
    } else {
        1.0
    };
    let cache = RenderCache::new();
    let pixmap = hayro::render(
        page,
        &cache,
        &InterpreterSettings::default(),
        &RenderSettings::default(),
        &PixmapSettings {
            x_scale: scale,
            y_scale: scale,
            bg_color: WHITE,
        },
    );
    pixmap
        .into_png()
        .map_err(|e| KnitError::InvalidInput(format!("Loi tao PNG thumbnail: {e}")))
}

/// Parse chuỗi chọn trang 1-based như `"1-3, 5, 8-6"` thành danh sách index 0-based.
pub fn parse_page_ranges(spec: &str, total_pages: usize) -> Result<Vec<usize>> {
    if total_pages == 0 {
        return Err(KnitError::InvalidInput("PDF khong co trang nao".into()));
    }
    let mut out = Vec::new();
    for raw_part in spec.split(',') {
        let part = raw_part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some((a, b)) = part.split_once('-') {
            let start = parse_one_based(a.trim(), total_pages)?;
            let end = parse_one_based(b.trim(), total_pages)?;
            if start <= end {
                for p in start..=end {
                    out.push(p - 1);
                }
            } else {
                for p in (end..=start).rev() {
                    out.push(p - 1);
                }
            }
        } else {
            let p = parse_one_based(part, total_pages)?;
            out.push(p - 1);
        }
    }
    if out.is_empty() {
        return Err(KnitError::InvalidInput(
            "Khong co trang hop le nao duoc chon".into(),
        ));
    }
    Ok(out)
}

fn parse_one_based(token: &str, total_pages: usize) -> Result<usize> {
    let val: usize = token
        .parse()
        .map_err(|_| KnitError::InvalidInput(format!("So trang khong hop le: '{token}'")))?;
    if val == 0 || val > total_pages {
        return Err(KnitError::InvalidInput(format!(
            "So trang {val} nam ngoai pham vi 1..={total_pages}"
        )));
    }
    Ok(val)
}

/// Hợp nhất nhiều PDF theo cơ chế streaming từng tệp một:
/// chỉ giữ tối đa 1 tệp nguồn tại một thời điểm, ghi thẳng object ra ổ cứng qua `StreamingPdfWriter`
/// thay vì nạp toàn bộ + clone `merged: Document` + serialize `Vec<u8>`.
pub fn merge_pdfs(
    config: &PdfMergeConfig,
    cancel: &CancellationToken,
    reporter: &dyn JobReporter,
) -> Result<PdfBuildResult> {
    if config.inputs.is_empty() {
        return Err(KnitError::InvalidInput(
            "Can it nhat 1 file PDF de gop".into(),
        ));
    }
    if cancel.is_cancelled() {
        return Err(KnitError::Cancelled);
    }

    let mut total_input_bytes = 0u64;
    for path in &config.inputs {
        if !path.is_file() {
            return Err(KnitError::NotFound(path.display().to_string()));
        }
        total_input_bytes += fs::metadata(path)?.len();
    }

    if let Some(parent) = config.output_path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
            ensure_disk_space(parent, total_input_bytes.saturating_add(65536))?;
        }
    }

    let explicit_selections = config
        .selected_pages
        .as_ref()
        .filter(|sel| !sel.is_empty());

    let total_docs = config.inputs.len();
    let mut by_file: Vec<Vec<(usize, usize, i32)>> = vec![Vec::new(); total_docs];
    if let Some(sels) = explicit_selections {
        for (sel_idx, sel) in sels.iter().enumerate() {
            if sel.file_index >= total_docs {
                return Err(KnitError::InvalidInput(format!(
                    "file_index {} khong hop le",
                    sel.file_index
                )));
            }
            by_file[sel.file_index].push((sel_idx, sel.page_index, sel.rotation_deg));
        }
    }

    let mut final_page_ids: Vec<u32> = explicit_selections
        .map(|s| vec![0u32; s.len()])
        .unwrap_or_default();
    let mut page_index_map: HashMap<(usize, usize), usize> = HashMap::new();
    let mut per_doc_bookmarks: Vec<Vec<BookmarkNode>> = vec![Vec::new(); total_docs];

    let mut guard = TempFilesGuard::new();
    let tmp_path = part_temp_path(&config.output_path, 1);
    guard.register(tmp_path.clone());
    let mut writer = StreamingPdfWriter::create(&tmp_path)?;

    let mut running_merged_idx = 0usize;
    let total_selected_count = explicit_selections.map(|s| s.len()).unwrap_or(0);
    let mut merged_done = 0usize;

    reporter.info(format!("Merging {} PDF files (streaming)", total_docs));

    for (file_idx, path) in config.inputs.iter().enumerate() {
        if cancel.is_cancelled() {
            return Err(KnitError::Cancelled);
        }
        if explicit_selections.is_some() && by_file[file_idx].is_empty() {
            continue;
        }

        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("pdf");
        reporter.normal(format!(
            "Processing PDF {}/{}: {}",
            file_idx + 1,
            total_docs,
            file_name
        ));

        let mmap = mmap_pdf_readonly(path)?;
        let pdf_start = mmap.windows(5).position(|w| w == b"%PDF-").unwrap_or(0);
        let pdf_buf = &mmap[pdf_start..];
        let mut doc = Document::load_mem_with_options(
            pdf_buf,
            LoadOptions::with_filter(filter_deferred_heavy_streams),
        )
        .map_err(|e| KnitError::InvalidInput(format!("Failed to load PDF {}: {e}", path.display())))?;
        trim_heap_if_supported();

        if config.preserve_bookmarks && config.custom_bookmarks.is_none() {
            per_doc_bookmarks[file_idx] = read_outlines(&doc);
        }

        let doc_pages: Vec<ObjectId> = doc.get_pages().into_values().collect();
        let file_items: Vec<(usize, usize, i32)> = if explicit_selections.is_some() {
            std::mem::take(&mut by_file[file_idx])
        } else {
            let mut items = Vec::with_capacity(doc_pages.len());
            for page_idx in 0..doc_pages.len() {
                let sel_idx = running_merged_idx;
                running_merged_idx += 1;
                items.push((sel_idx, page_idx, 0));
                final_page_ids.push(0);
            }
            items
        };

        if file_items.is_empty() {
            drop(doc);
            drop(mmap);
            continue;
        }

        for &(_, page_idx, _) in &file_items {
            if page_idx >= doc_pages.len() {
                return Err(KnitError::InvalidInput(format!(
                    "page_index {} khong ton tai trong file {}",
                    page_idx, file_idx
                )));
            }
        }

        let unique_orig_pages: Vec<ObjectId> = {
            let mut seen = HashSet::new();
            let mut list = Vec::new();
            for &(_, page_idx, _) in &file_items {
                let pid = doc_pages[page_idx];
                if seen.insert(pid) {
                    list.push(pid);
                }
            }
            list
        };
        for &pid in &unique_orig_pages {
            materialize_inherited_page_attrs(&mut doc, pid)?;
        }

        let occurrences: Vec<(usize, ObjectId, i32)> = file_items
            .iter()
            .map(|&(sel_idx, page_idx, rot)| (sel_idx, doc_pages[page_idx], rot))
            .collect();
        for &(sel_idx, page_idx, _) in &file_items {
            page_index_map
                .entry((file_idx, page_idx))
                .or_insert(sel_idx);
        }

        let written_pairs = stream_doc_occurrences_to_writer(
            &mut doc,
            Some(pdf_buf),
            &unique_orig_pages,
            &occurrences,
            true,
            &mut writer,
            cancel,
        )?;
        for (sel_idx, new_pid) in written_pairs {
            final_page_ids[sel_idx] = new_pid;
            merged_done += 1;
            if total_selected_count > 0 {
                reporter.detailed(format!(
                    "Merged page {merged_done}/{total_selected_count}: File {}",
                    file_idx + 1
                ));
            }
        }

        drop(doc);
        drop(mmap);
        trim_heap_if_supported();
        reporter.on_progress(JobProgress {
            phase: "merge".into(),
            done: (file_idx + 1) as u64,
            total: total_docs as u64,
            bytes_done: 0,
            bytes_total: 0,
            current_item: format!("Merged file {}/{}: {}", file_idx + 1, total_docs, file_name),
        });
    }

    if final_page_ids.is_empty() {
        return Err(KnitError::InvalidInput(
            "No pages selected to merge".into(),
        ));
    }

    let final_bookmarks = if config.preserve_bookmarks {
        if let Some(ref custom) = config.custom_bookmarks {
            custom.clone()
        } else {
            let mut combined = Vec::new();
            for (file_idx, tree) in per_doc_bookmarks.iter().enumerate() {
                combined.extend(remap_bookmarks_for_selection(tree, file_idx, &page_index_map));
            }
            combined
        }
    } else {
        Vec::new()
    };

    writer.set_page_ids(final_page_ids.clone());
    let total_bytes = writer.finish(&final_bookmarks)?;

    if config.output_path.exists() {
        let _ = fs::remove_file(&config.output_path);
    }
    fs::rename(&tmp_path, &config.output_path)?;
    guard.committed = true;

    reporter.on_progress(JobProgress {
        phase: "done".into(),
        done: total_docs as u64,
        total: total_docs as u64,
        bytes_done: total_bytes,
        bytes_total: total_bytes,
        current_item: "PDF merge complete".into(),
    });

    Ok(PdfBuildResult {
        output_files: vec![config.output_path.clone()],
        total_pages: final_page_ids.len(),
        total_bytes,
        passthrough_pages: 0,
    })
}

/// Tách 1 file PDF theo `PdfSplitRule` (`PageRanges`, `EveryNPages`, `ExtractSelected`, `MaxBytes`, `CustomGroups`).
pub fn split_pdf(
    input_path: &Path,
    output_dir: &Path,
    stem: &str,
    rule: &PdfSplitRule,
    cancel: &CancellationToken,
    reporter: &dyn JobReporter,
) -> Result<PdfBuildResult> {
    if !input_path.is_file() {
        return Err(KnitError::NotFound(input_path.display().to_string()));
    }
    if cancel.is_cancelled() {
        return Err(KnitError::Cancelled);
    }

    fs::create_dir_all(output_dir)?;
    let input_size = fs::metadata(input_path)?.len();
    ensure_disk_space(output_dir, input_size.saturating_add(65536))?;

    reporter.info("Reading source PDF for splitting");
    let mmap = mmap_pdf_readonly(input_path)?;
    let mut doc = Document::load_mem(&mmap)
        .map_err(|e| KnitError::InvalidInput(format!("Failed to open PDF: {e}")))?;
    drop(mmap);

    let all_pages: Vec<ObjectId> = doc.get_pages().into_values().collect();
    let total_pages = all_pages.len();
    if total_pages == 0 {
        return Err(KnitError::InvalidInput("PDF is empty (0 pages)".into()));
    }
    for &pid in &all_pages {
        materialize_inherited_page_attrs(&mut doc, pid)?;
    }
    let bookmarks = read_outlines(&doc);

    let safe_stem = if stem.trim().is_empty() {
        input_path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "split".to_string())
    } else {
        stem.trim().to_string()
    };

    let groups: Vec<(PathBuf, Vec<(usize, i32)>)> = match rule {
        PdfSplitRule::PageRanges { ranges } => {
            let indices = parse_page_ranges(ranges, total_pages)?;
            vec![(
                output_dir.join(format!("{safe_stem}_extracted.pdf")),
                indices.into_iter().map(|i| (i, 0)).collect(),
            )]
        }
        PdfSplitRule::ExtractSelected { page_indices } => {
            if page_indices.is_empty() {
                return Err(KnitError::InvalidInput(
                    "Chua chon trang nao de trich xuat".into(),
                ));
            }
            for &idx in page_indices {
                if idx >= total_pages {
                    return Err(KnitError::InvalidInput(format!(
                        "Trang {} vuot qua tong so trang {total_pages}",
                        idx + 1
                    )));
                }
            }
            vec![(
                output_dir.join(format!("{safe_stem}_selected.pdf")),
                page_indices.iter().map(|&i| (i, 0)).collect(),
            )]
        }
        PdfSplitRule::EveryNPages { n } => {
            let step = (*n).max(1);
            let mut groups = Vec::new();
            let mut part = 1usize;
            for start in (0..total_pages).step_by(step) {
                let end = (start + step).min(total_pages);
                groups.push((
                    output_dir.join(format!("{safe_stem}_part{part:02}.pdf")),
                    (start..end).map(|i| (i, 0)).collect(),
                ));
                part += 1;
            }
            groups
        }
        PdfSplitRule::MaxBytes { max_mb } => {
            if *max_mb <= 0.0 {
                return Err(KnitError::InvalidInput("max_mb phai lon hon 0".into()));
            }
            let limit = (*max_mb * 1024.0 * 1024.0) as usize;
            return split_pdf_by_max_bytes(
                &mut doc,
                &all_pages,
                &bookmarks,
                total_pages,
                output_dir,
                &safe_stem,
                limit,
                cancel,
                reporter,
            );
        }
        PdfSplitRule::CustomGroups {
            groups: custom_groups,
        } => {
            let non_empty: Vec<_> = custom_groups.iter().filter(|g| !g.pages.is_empty()).collect();
            if non_empty.is_empty() {
                return Err(KnitError::InvalidInput(
                    "Chua co trang nao trong cac section dau ra".into(),
                ));
            }
            let mut seen_names: HashMap<String, usize> = HashMap::new();
            let mut resolved_groups = Vec::with_capacity(non_empty.len());
            for (idx, g) in non_empty.iter().enumerate() {
                let mut pairs = Vec::with_capacity(g.pages.len());
                for sel in &g.pages {
                    if sel.page_index >= total_pages {
                        return Err(KnitError::InvalidInput(format!(
                            "Trang {} vuot qua tong so trang {total_pages}",
                            sel.page_index + 1
                        )));
                    }
                    pairs.push((sel.page_index, sel.rotation_deg));
                }
                let base_name = sanitize_split_group_name(&g.name, idx + 1);
                let occ = seen_names.entry(base_name.clone()).or_insert(0);
                *occ += 1;
                let unique_name = if *occ == 1 {
                    base_name
                } else {
                    format!("{base_name}_{}", *occ)
                };
                resolved_groups.push((output_dir.join(format!("{unique_name}.pdf")), pairs));
            }
            resolved_groups
        }
    };

    let mut output_files = Vec::new();
    let mut total_out_pages = 0usize;
    let mut total_bytes = 0u64;
    let total_parts = groups.len();

    for (idx, (out_path, page_items)) in groups.into_iter().enumerate() {
        if cancel.is_cancelled() {
            return Err(KnitError::Cancelled);
        }
        reporter.normal(format!(
            "Splitting part {}/{} ({} pages): {}",
            idx + 1,
            total_parts,
            page_items.len(),
            out_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("split.pdf")
        ));
        reporter.on_progress(JobProgress {
            phase: "split".into(),
            done: (idx + 1) as u64,
            total: total_parts as u64,
            bytes_done: 0,
            bytes_total: 0,
            current_item: format!("Writing part {}/{}", idx + 1, total_parts),
        });
        let written =
            stream_subset_pdf_to_path(&mut doc, &all_pages, &bookmarks, &page_items, &out_path, cancel)?;
        total_out_pages += page_items.len();
        total_bytes += written;
        output_files.push(out_path);
    }

    Ok(PdfBuildResult {
        output_files,
        total_pages: total_out_pages,
        total_bytes,
        passthrough_pages: 0,
    })
}

/// Tách nhiều tệp PDF cùng lúc (hỗ trợ cả `CustomGroups` gộp/chia chéo trang từ nhiều tệp
/// lẫn tách hàng loạt theo quy tắc cho từng tệp nguồn).
pub fn split_multi_pdf(
    inputs: &[PathBuf],
    stems: &[String],
    output_dir: &Path,
    rule: &PdfSplitRule,
    cancel: &CancellationToken,
    reporter: &dyn JobReporter,
) -> Result<PdfBuildResult> {
    if inputs.is_empty() {
        return Err(KnitError::InvalidInput("Can it nhat 1 file PDF".into()));
    }
    fs::create_dir_all(output_dir)?;

    if let PdfSplitRule::CustomGroups { groups } = rule {
        let non_empty: Vec<_> = groups.iter().filter(|g| !g.pages.is_empty()).collect();
        if non_empty.is_empty() {
            return Err(KnitError::InvalidInput(
                "Chua co trang nao trong cac section dau ra".into(),
            ));
        }
        let mut seen_names: HashMap<String, usize> = HashMap::new();
        let mut output_files = Vec::with_capacity(non_empty.len());
        let mut total_pages = 0usize;
        let mut total_bytes = 0u64;
        let total_parts = non_empty.len();

        for (idx, g) in non_empty.iter().enumerate() {
            if cancel.is_cancelled() {
                return Err(KnitError::Cancelled);
            }
            let base_name = sanitize_split_group_name(&g.name, idx + 1);
            let occ = seen_names.entry(base_name.clone()).or_insert(0);
            *occ += 1;
            let unique_name = if *occ == 1 {
                base_name
            } else {
                format!("{base_name}_{}", *occ)
            };
            let out_path = output_dir.join(format!("{unique_name}.pdf"));

            let mut local_index_by_file: HashMap<usize, usize> = HashMap::new();
            let mut local_inputs: Vec<PathBuf> = Vec::new();
            let mut remapped_pages: Vec<PageSelection> = Vec::with_capacity(g.pages.len());

            for sel in &g.pages {
                let src = inputs.get(sel.file_index).ok_or_else(|| {
                    KnitError::InvalidInput(format!("file_index {} khong hop le", sel.file_index))
                })?;
                let local_file_idx = *local_index_by_file.entry(sel.file_index).or_insert_with(|| {
                    let next = local_inputs.len();
                    local_inputs.push(src.clone());
                    next
                });
                remapped_pages.push(PageSelection {
                    file_index: local_file_idx,
                    page_index: sel.page_index,
                    rotation_deg: sel.rotation_deg,
                });
            }

            reporter.normal(format!(
                "Splitting part {}/{} ({} pages): {unique_name}.pdf",
                idx + 1,
                total_parts,
                remapped_pages.len()
            ));
            reporter.on_progress(JobProgress {
                phase: "split".into(),
                done: (idx + 1) as u64,
                total: total_parts as u64,
                bytes_done: 0,
                bytes_total: 0,
                current_item: format!("Writing part {}/{}", idx + 1, total_parts),
            });

            let res = merge_pdfs(
                &PdfMergeConfig {
                    inputs: local_inputs,
                    selected_pages: Some(remapped_pages),
                    output_path: out_path.clone(),
                    preserve_bookmarks: true,
                    custom_bookmarks: None,
                },
                cancel,
                reporter,
            )?;
            total_pages += res.total_pages;
            total_bytes += res.total_bytes;
            output_files.extend(res.output_files);
        }

        return Ok(PdfBuildResult {
            output_files,
            total_pages,
            total_bytes,
            passthrough_pages: 0,
        });
    }

    let mut output_files = Vec::new();
    let mut total_pages = 0usize;
    let mut total_bytes = 0u64;
    let total_files = inputs.len();

    for (idx, input_path) in inputs.iter().enumerate() {
        if cancel.is_cancelled() {
            return Err(KnitError::Cancelled);
        }
        let stem = stems
            .get(idx)
            .map(|s| s.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| {
                input_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("split")
            });
        reporter.normal(format!(
            "Splitting source PDF {}/{}: {}",
            idx + 1,
            total_files,
            input_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("input.pdf")
        ));
        let res = split_pdf(input_path, output_dir, stem, rule, cancel, reporter)?;
        total_pages += res.total_pages;
        total_bytes += res.total_bytes;
        output_files.extend(res.output_files);
        reporter.on_progress(JobProgress {
            phase: "split".into(),
            done: (idx + 1) as u64,
            total: total_files as u64,
            bytes_done: 0,
            bytes_total: 0,
            current_item: format!("Finished splitting file {}/{}", idx + 1, total_files),
        });
    }

    Ok(PdfBuildResult {
        output_files,
        total_pages,
        total_bytes,
        passthrough_pages: 0,
    })
}

fn sanitize_split_group_name(raw: &str, fallback_idx: usize) -> String {
    let trimmed = raw.trim().strip_suffix(".pdf").unwrap_or(raw.trim());
    let cleaned: String = trimmed
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            _ => c,
        })
        .collect();
    let final_str = cleaned.trim().trim_matches('.');
    if final_str.is_empty() {
        format!("section_{fallback_idx:02}")
    } else {
        final_str.to_string()
    }
}

#[allow(clippy::too_many_arguments)]
fn split_pdf_by_max_bytes(
    doc: &mut Document,
    all_pages: &[ObjectId],
    bookmarks: &[BookmarkNode],
    total_pages: usize,
    output_dir: &Path,
    safe_stem: &str,
    limit: usize,
    cancel: &CancellationToken,
    reporter: &dyn JobReporter,
) -> Result<PdfBuildResult> {
    let mut output_files = Vec::new();
    let mut total_bytes = 0u64;
    let mut start = 0usize;
    let mut part = 1usize;

    while start < total_pages {
        if cancel.is_cancelled() {
            return Err(KnitError::Cancelled);
        }
        let mut lo = start;
        let mut hi = total_pages - 1;
        let mut best = start;
        let single_size =
            measure_subset_pdf_bytes(doc, all_pages, bookmarks, &[(start, 0)], cancel)?;

        if single_size <= limit as u64 && lo < hi {
            lo = start + 1;
            while lo <= hi {
                if cancel.is_cancelled() {
                    return Err(KnitError::Cancelled);
                }
                let mid = (lo + hi) / 2;
                let range: Vec<(usize, i32)> = (start..=mid).map(|i| (i, 0)).collect();
                let candidate_len =
                    measure_subset_pdf_bytes(doc, all_pages, bookmarks, &range, cancel)?;
                if candidate_len <= limit as u64 {
                    best = mid;
                    lo = mid + 1;
                } else {
                    if mid == 0 {
                        break;
                    }
                    hi = mid - 1;
                }
            }
        }

        let out_path = output_dir.join(format!("{safe_stem}_part{part:02}.pdf"));
        let final_range: Vec<(usize, i32)> = (start..=best).map(|i| (i, 0)).collect();
        let written = stream_subset_pdf_to_path(
            doc,
            all_pages,
            bookmarks,
            &final_range,
            &out_path,
            cancel,
        )?;
        total_bytes += written;
        output_files.push(out_path);
        reporter.normal(format!(
            "Wrote part {} (pages {}..={}) -> {}",
            part,
            start + 1,
            best + 1,
            output_files
                .last()
                .and_then(|p| p.file_name())
                .and_then(|n| n.to_str())
                .unwrap_or("part.pdf")
        ));
        reporter.on_progress(JobProgress {
            phase: "split".into(),
            done: (best + 1) as u64,
            total: total_pages as u64,
            bytes_done: 0,
            bytes_total: 0,
            current_item: format!("Split up to page {}/{}", best + 1, total_pages),
        });
        start = best + 1;
        part += 1;
    }

    Ok(PdfBuildResult {
        output_files,
        total_pages,
        total_bytes,
        passthrough_pages: 0,
    })
}

fn measure_subset_pdf_bytes(
    doc: &mut Document,
    all_pages: &[ObjectId],
    bookmarks: &[BookmarkNode],
    items: &[(usize, i32)],
    cancel: &CancellationToken,
) -> Result<u64> {
    let mut writer = StreamingPdfWriter::from_writer(io::sink())?;
    stream_subset_pdf_with_writer(doc, all_pages, bookmarks, items, &mut writer, cancel)?;
    let mapped_bookmarks = build_subset_bookmarks(bookmarks, items);
    writer.finish(&mapped_bookmarks)
}

fn stream_subset_pdf_to_path(
    doc: &mut Document,
    all_pages: &[ObjectId],
    bookmarks: &[BookmarkNode],
    items: &[(usize, i32)],
    out_path: &Path,
    cancel: &CancellationToken,
) -> Result<u64> {
    let mut guard = TempFilesGuard::new();
    let tmp_path = part_temp_path(out_path, 1);
    guard.register(tmp_path.clone());
    let mut writer = StreamingPdfWriter::create(&tmp_path)?;
    stream_subset_pdf_with_writer(doc, all_pages, bookmarks, items, &mut writer, cancel)?;
    let mapped_bookmarks = build_subset_bookmarks(bookmarks, items);
    let total_bytes = writer.finish(&mapped_bookmarks)?;
    if out_path.exists() {
        let _ = fs::remove_file(out_path);
    }
    fs::rename(&tmp_path, out_path)?;
    guard.committed = true;
    Ok(total_bytes)
}

fn build_subset_bookmarks(bookmarks: &[BookmarkNode], items: &[(usize, i32)]) -> Vec<BookmarkNode> {
    let mut index_map = HashMap::with_capacity(items.len());
    for (new_idx, &(orig_idx, _)) in items.iter().enumerate() {
        index_map.entry(orig_idx).or_insert(new_idx);
    }
    remap_bookmarks_with_single_map(bookmarks, &index_map)
}

fn stream_subset_pdf_with_writer<W: Write>(
    doc: &mut Document,
    all_pages: &[ObjectId],
    _bookmarks: &[BookmarkNode],
    items: &[(usize, i32)],
    writer: &mut StreamingPdfWriter<W>,
    cancel: &CancellationToken,
) -> Result<()> {
    let mut unique_orig_pages = Vec::new();
    let mut seen = HashSet::new();
    let mut occurrences = Vec::with_capacity(items.len());
    for (new_idx, &(orig_idx, rot_delta)) in items.iter().enumerate() {
        let orig_pid = *all_pages.get(orig_idx).ok_or_else(|| {
            KnitError::InvalidInput(format!("Trang {} khong ton tai", orig_idx + 1))
        })?;
        if seen.insert(orig_pid) {
            unique_orig_pages.push(orig_pid);
        }
        occurrences.push((new_idx, orig_pid, rot_delta));
    }

    let written_pairs = stream_doc_occurrences_to_writer(
        doc,
        None,
        &unique_orig_pages,
        &occurrences,
        false,
        writer,
        cancel,
    )?;
    let mut page_ids = vec![0u32; items.len()];
    for (idx, pid) in written_pairs {
        page_ids[idx] = pid;
    }
    writer.set_page_ids(page_ids);
    Ok(())
}

/// Ghi các trang được chọn + toàn bộ object con cháu (Fonts, XObjects, Contents, Resources...) của 1 `Document`
/// thẳng vào `StreamingPdfWriter`. Nếu `consume_doc == true` (dùng trong `merge_pdfs`), mỗi object ghi xong sẽ bị gỡ
/// khỏi `doc.objects` và giải phóng ngay khỏi RAM. Khi `pdf_buf` được truyền vào, các stream nặng có gắn `KnitOrigLen`
/// sẽ được cắt slice trực tiếp từ mmap ghi thẳng xuống đĩa không qua cấp phát bộ nhớ heap.
fn stream_doc_occurrences_to_writer<W: Write>(
    doc: &mut Document,
    pdf_buf: Option<&[u8]>,
    unique_orig_pages: &[ObjectId],
    occurrences: &[(usize, ObjectId, i32)],
    consume_doc: bool,
    writer: &mut StreamingPdfWriter<W>,
    cancel: &CancellationToken,
) -> Result<Vec<(usize, u32)>> {
    let non_page_order = collect_reachable_objects_for_pages(doc, unique_orig_pages);

    let mut id_map: HashMap<ObjectId, ObjectId> =
        HashMap::with_capacity(unique_orig_pages.len() + non_page_order.len());
    let mut allocated_occ_ids: Vec<(usize, ObjectId, i32, u32)> =
        Vec::with_capacity(occurrences.len());

    for &(sel_idx, orig_pid, rot_deg) in occurrences {
        let new_pid = writer.alloc_id();
        id_map.entry(orig_pid).or_insert((new_pid, 0));
        allocated_occ_ids.push((sel_idx, orig_pid, rot_deg, new_pid));
    }
    for &old_id in &non_page_order {
        let new_id = writer.alloc_id();
        id_map.insert(old_id, (new_id, 0));
    }

    for old_id in non_page_order {
        if cancel.is_cancelled() {
            return Err(KnitError::Cancelled);
        }
        let opt_obj = if consume_doc {
            doc.objects.remove(&old_id)
        } else {
            doc.objects.get(&old_id).cloned()
        };
        if let Some(mut obj) = opt_obj {
            rewrite_object_refs(&mut obj, &id_map);
            let new_id = id_map[&old_id].0;
            let mut deferred_len: Option<usize> = None;
            let mut streamed_from_mmap = false;
            if let (Some(buf), Object::Stream(ref mut stream)) = (pdf_buf, &mut obj) {
                if let Some(Object::Integer(orig_len)) =
                    stream.dict.remove(KNIT_DEFERRED_STREAM_LEN_KEY.as_bytes())
                {
                    let expected_len = usize::try_from(orig_len).map_err(|_| {
                        KnitError::InvalidInput("Invalid deferred PDF stream length".into())
                    })?;
                    deferred_len = Some(expected_len);
                    if let Some(XrefEntry::Normal { offset, .. }) = doc.reference_table.get(old_id.0) {
                        if let Some(raw_slice) = find_stream_data_slice(buf, *offset as usize, expected_len) {
                            let dict = std::mem::take(&mut stream.dict);
                            writer.write_lopdf_stream_with_slice(new_id, dict, raw_slice)?;
                            streamed_from_mmap = true;
                        }
                    }
                }
            }
            if !streamed_from_mmap {
                if deferred_len.is_some() {
                    return Err(KnitError::InvalidInput(format!(
                        "Khong the doc stream goc tu mmap cho object {:?}",
                        old_id
                    )));
                }
                if let Object::Stream(ref mut stream) = obj {
                    stream
                        .dict
                        .set("Length", Object::Integer(stream.content.len() as i64));
                }
                writer.write_lopdf_object(new_id, &obj)?;
            }
        }
    }

    // Chuẩn bị base Page dict (đã rewrite ref & gắn /Parent 1 0 R) cho từng trang gốc, tránh clone lại toàn cây doc.
    let mut base_page_dicts: HashMap<ObjectId, Object> =
        HashMap::with_capacity(unique_orig_pages.len());
    for &orig_pid in unique_orig_pages {
        let opt_page = if consume_doc {
            doc.objects.remove(&orig_pid)
        } else {
            doc.objects.get(&orig_pid).cloned()
        };
        if let Some(mut page_obj) = opt_page {
            if let Object::Dictionary(ref mut dict) = page_obj {
                dict.remove(b"Parent");
                dict.remove(b"B");
            }
            rewrite_object_refs(&mut page_obj, &id_map);
            if let Object::Dictionary(ref mut dict) = page_obj {
                dict.set("Parent", Object::Reference((1, 0)));
            }
            base_page_dicts.insert(orig_pid, page_obj);
        }
    }

    let mut remaining_counts: HashMap<ObjectId, usize> = HashMap::new();
    for &(_, orig_pid, _, _) in &allocated_occ_ids {
        *remaining_counts.entry(orig_pid).or_insert(0) += 1;
    }

    let mut out_pairs = Vec::with_capacity(allocated_occ_ids.len());
    for (sel_idx, orig_pid, rot_deg, new_pid) in allocated_occ_ids {
        if cancel.is_cancelled() {
            return Err(KnitError::Cancelled);
        }
        let rem = remaining_counts.get_mut(&orig_pid).expect("remaining count");
        *rem -= 1;
        let mut page_obj = if *rem == 0 {
            base_page_dicts.remove(&orig_pid).ok_or_else(|| {
                KnitError::InvalidInput(format!("Thieu Page object {:?}", orig_pid))
            })?
        } else {
            base_page_dicts
                .get(&orig_pid)
                .cloned()
                .ok_or_else(|| KnitError::InvalidInput(format!("Thieu Page object {:?}", orig_pid)))?
        };

        if rot_deg.rem_euclid(360) != 0 {
            if let Object::Dictionary(ref mut dict) = page_obj {
                let existing_rot = dict
                    .get(b"Rotate")
                    .ok()
                    .and_then(|o| o.as_i64().ok())
                    .unwrap_or(0);
                let new_rot = (existing_rot + rot_deg as i64).rem_euclid(360);
                dict.set("Rotate", Object::Integer(new_rot));
            }
        }
        writer.write_lopdf_object(new_pid, &page_obj)?;
        out_pairs.push((sel_idx, new_pid));
    }

    Ok(out_pairs)
}

fn collect_reachable_objects_for_pages(
    doc: &Document,
    selected_page_ids: &[ObjectId],
) -> Vec<ObjectId> {
    let selected_set: HashSet<ObjectId> = selected_page_ids.iter().copied().collect();
    let mut visited: HashSet<ObjectId> = selected_set.clone();
    let mut queue: VecDeque<ObjectId> = VecDeque::new();
    let mut non_page_order: Vec<ObjectId> = Vec::new();

    for &pid in selected_page_ids {
        if let Some(Object::Dictionary(dict)) = doc.objects.get(&pid) {
            for (key, val) in dict.iter() {
                if key == b"Parent" || key == b"B" || key == b"StructParents" {
                    continue;
                }
                enqueue_refs_in_object(doc, val, &selected_set, &mut visited, &mut queue);
            }
        }
    }

    while let Some(oid) = queue.pop_front() {
        let Some(obj) = doc.objects.get(&oid) else {
            continue;
        };
        if is_catalog_or_pages(obj) {
            continue;
        }
        non_page_order.push(oid);
        enqueue_refs_in_object(doc, obj, &selected_set, &mut visited, &mut queue);
    }

    non_page_order
}

fn enqueue_refs_in_object(
    doc: &Document,
    obj: &Object,
    selected_set: &HashSet<ObjectId>,
    visited: &mut HashSet<ObjectId>,
    queue: &mut VecDeque<ObjectId>,
) {
    match obj {
        Object::Reference(id) => {
            if visited.contains(id) {
                return;
            }
            if let Some(target) = doc.objects.get(id) {
                if is_catalog_or_pages(target) || (is_page_dict(target) && !selected_set.contains(id))
                {
                    return;
                }
                visited.insert(*id);
                queue.push_back(*id);
            }
        }
        Object::Array(arr) => {
            for item in arr {
                enqueue_refs_in_object(doc, item, selected_set, visited, queue);
            }
        }
        Object::Dictionary(dict) => {
            let skip_parent = dict
                .get(b"Type")
                .and_then(|o| o.as_name())
                .is_ok_and(|t| t == b"Page");
            for (key, val) in dict.iter() {
                if skip_parent && (key == b"Parent" || key == b"B") {
                    continue;
                }
                enqueue_refs_in_object(doc, val, selected_set, visited, queue);
            }
        }
        Object::Stream(stream) => {
            for (_, val) in stream.dict.iter() {
                enqueue_refs_in_object(doc, val, selected_set, visited, queue);
            }
        }
        _ => {}
    }
}

fn rewrite_object_refs(obj: &mut Object, id_map: &HashMap<ObjectId, ObjectId>) {
    match obj {
        Object::Reference(ref mut id) => {
            if let Some(&mapped) = id_map.get(id) {
                *id = mapped;
            } else {
                *obj = Object::Null;
            }
        }
        Object::Array(ref mut arr) => {
            for item in arr.iter_mut() {
                rewrite_object_refs(item, id_map);
            }
        }
        Object::Dictionary(ref mut dict) => {
            for (_, val) in dict.iter_mut() {
                rewrite_object_refs(val, id_map);
            }
        }
        Object::Stream(ref mut stream) => {
            for (_, val) in stream.dict.iter_mut() {
                rewrite_object_refs(val, id_map);
            }
        }
        _ => {}
    }
}

fn remap_bookmarks_for_selection(
    nodes: &[BookmarkNode],
    file_idx: usize,
    map: &HashMap<(usize, usize), usize>,
) -> Vec<BookmarkNode> {
    let mut out = Vec::new();
    for node in nodes {
        let children = remap_bookmarks_for_selection(&node.children, file_idx, map);
        let mapped_self = map.get(&(file_idx, node.target_page_index)).copied();
        if let Some(target) = mapped_self.or_else(|| children.first().map(|c| c.target_page_index)) {
            out.push(BookmarkNode {
                title: node.title.clone(),
                target_page_index: target,
                children,
            });
        }
    }
    out
}

fn remap_bookmarks_with_single_map(
    nodes: &[BookmarkNode],
    map: &HashMap<usize, usize>,
) -> Vec<BookmarkNode> {
    let mut out = Vec::new();
    for node in nodes {
        let children = remap_bookmarks_with_single_map(&node.children, map);
        let mapped_self = map.get(&node.target_page_index).copied();
        if let Some(target) = mapped_self.or_else(|| children.first().map(|c| c.target_page_index)) {
            out.push(BookmarkNode {
                title: node.title.clone(),
                target_page_index: target,
                children,
            });
        }
    }
    out
}

fn is_catalog_or_pages(obj: &Object) -> bool {
    if let Ok(dict) = obj.as_dict() {
        if let Ok(t) = dict.get(b"Type").and_then(|o| o.as_name()) {
            return matches!(t, b"Catalog" | b"Pages" | b"Outlines");
        }
    }
    false
}

fn is_page_dict(obj: &Object) -> bool {
    if let Ok(dict) = obj.as_dict() {
        if let Ok(t) = dict.get(b"Type").and_then(|o| o.as_name()) {
            return t == b"Page";
        }
    }
    false
}

/// Đảm bảo mỗi trang có đầy đủ `/Resources` và `/MediaBox` tự thân (không phụ thuộc cha `/Pages`).
fn materialize_inherited_page_attrs(doc: &mut Document, page_id: ObjectId) -> Result<()> {
    let inherited_res = match doc.get_page_resources(page_id) {
        Ok((Some(d), _)) => Some(Object::Dictionary(d.clone())),
        _ => None,
    };

    let inherited_mediabox = find_inherited_attr(doc, page_id, b"MediaBox");
    let inherited_cropbox = find_inherited_attr(doc, page_id, b"CropBox");

    if let Ok(Object::Dictionary(ref mut page_dict)) = doc.get_object_mut(page_id) {
        if !page_dict.has(b"Resources") {
            if let Some(res) = inherited_res {
                page_dict.set("Resources", res);
            }
        }
        if !page_dict.has(b"MediaBox") {
            if let Some(mb) = inherited_mediabox {
                page_dict.set("MediaBox", mb);
            }
        }
        if !page_dict.has(b"CropBox") {
            if let Some(cb) = inherited_cropbox {
                page_dict.set("CropBox", cb);
            }
        }
    }
    Ok(())
}

fn find_inherited_attr(doc: &Document, start_id: ObjectId, key: &[u8]) -> Option<Object> {
    let mut curr = Some(start_id);
    let mut guard = 0;
    while let Some(id) = curr {
        guard += 1;
        if guard > 64 {
            break;
        }
        let dict = doc.get_dictionary(id).ok()?;
        if let Ok(val) = dict.get(key) {
            return Some(val.clone());
        }
        curr = dict.get(b"Parent").and_then(|o| o.as_reference()).ok();
    }
    None
}

// Keep unused-warning clean if remap_tree is imported only for public API consistency
#[allow(dead_code)]
fn _keep_remap_tree_in_scope(nodes: &[BookmarkNode]) -> Vec<BookmarkNode> {
    remap_tree(nodes, 0, usize::MAX)
}
