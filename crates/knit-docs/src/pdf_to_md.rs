use knit_core::{
    atomic_write_file, ensure_disk_space, nfc_normalize, sanitize_filename, CancellationToken,
    JobProgress, JobReporter, KnitError, NoopReporter, Result,
};
use knit_pdf::{
    extract_pdf_for_markdown_with_mode, extract_pdf_images_only, inspect_pdf, BookmarkNode,
    PdfExtractedDocument, PdfImageExtractMode, PdfTextSpan,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

fn default_true() -> bool {
    true
}

/// Tùy chọn chuyển đổi PDF sang Markdown thuần offline.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PdfToMdOptions {
    #[serde(default = "default_true")]
    pub extract_images: bool,
    #[serde(default = "default_true")]
    pub include_page_markers: bool,
}

impl Default for PdfToMdOptions {
    fn default() -> Self {
        Self {
            extract_images: true,
            include_page_markers: true,
        }
    }
}

/// Markdown tái cấu trúc theo từng trang để hỗ trợ chẩn đoán trang scan và phân đoạn.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PdfPageMarkdown {
    pub page_index: usize,
    pub markdown: String,
    pub word_count: usize,
    pub image_count: usize,
    pub is_likely_scanned: bool,
}

/// Kết quả kiểm tra và chuyển đổi offline PDF -> Markdown.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PdfToMdInspectResult {
    pub source_path: PathBuf,
    pub page_count: usize,
    pub file_size_bytes: u64,
    pub outlines: Vec<BookmarkNode>,
    pub scanned_page_indices: Vec<usize>,
    pub is_scanned_document: bool,
    pub extracted_image_count: usize,
    pub markdown: String,
    pub pages: Vec<PdfPageMarkdown>,
}

/// Kết quả xuất file Markdown + thư mục ảnh đính kèm ra đĩa.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PdfToMdExportResult {
    pub output_path: PathBuf,
    pub asset_dir: Option<PathBuf>,
    pub written_image_count: usize,
    pub bytes_written: u64,
    pub page_count: usize,
}

#[derive(Debug, Clone)]
struct LogicalLine {
    spans: Vec<PdfTextSpan>,
    text: String,
    x_min: f32,
    y_top: f32,
    y_bottom: f32,
    font_size_pt: f32,
    is_bold: bool,
}

enum FlowItem {
    Heading {
        level: u8,
        text: String,
    },
    Table {
        rows: Vec<Vec<String>>,
    },
    ListItem {
        text: String,
    },
    Paragraph {
        text: String,
    },
    Image {
        page_one_based: usize,
        image_one_based: usize,
        rel_path: String,
    },
    ScannedNotice {
        page_one_based: usize,
    },
}

struct PositionedBlock {
    y_top: f32,
    item: FlowItem,
}

/// Tên thư mục đóng gói đầu ra khi xuất kèm assets.
pub fn derive_package_dir_name(stem_hint: &str) -> String {
    let base = sanitize_filename(stem_hint, 80);
    if base.is_empty() {
        "document".to_string()
    } else {
        base
    }
}

/// Tên thư mục asset tương đối dựa theo tên file chuẩn hóa.
pub fn derive_assets_dir_name(stem_hint: &str) -> String {
    format!("{}_assets", derive_package_dir_name(stem_hint))
}

#[derive(Clone, PartialEq, Eq)]
struct ExtractedCacheKey {
    canonical: PathBuf,
    len: u64,
    mtime_nanos: u128,
}

const PDF2MD_CACHE_CAP: usize = 2;

fn pdf2md_extracted_cache() -> &'static Mutex<Vec<(ExtractedCacheKey, Arc<PdfExtractedDocument>)>> {
    static CACHE: OnceLock<Mutex<Vec<(ExtractedCacheKey, Arc<PdfExtractedDocument>)>>> =
        OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(Vec::with_capacity(PDF2MD_CACHE_CAP)))
}

/// Xóa toàn bộ cache trích xuất Markdown nhẹ (`MetadataOnly`) trong bộ nhớ.
pub fn clear_pdf_to_md_cache() {
    if let Ok(mut guard) = pdf2md_extracted_cache().lock() {
        guard.clear();
    }
}

/// Xóa cache trích xuất Markdown theo danh sách đường dẫn (nếu rỗng thì xóa toàn bộ).
pub fn evict_pdf_to_md_cache_paths(paths: &[PathBuf]) {
    if let Ok(mut guard) = pdf2md_extracted_cache().lock() {
        if paths.is_empty() {
            guard.clear();
        } else {
            let targets: Vec<PathBuf> = paths
                .iter()
                .map(|p| p.canonicalize().unwrap_or_else(|_| p.to_path_buf()))
                .collect();
            guard.retain(|(k, _)| !targets.contains(&k.canonical));
        }
    }
}

/// Kiểm tra tệp PDF và tái cấu trúc nội dung sang GitHub-Flavored Markdown thuần Rust
/// (tái sử dụng cache `MetadataOnly` để toggle tùy chọn tức thì mà không giải mã lại PDF).
pub fn inspect_and_extract_pdf_to_markdown_cached(
    pdf_path: &Path,
    options: &PdfToMdOptions,
    force_reextract: bool,
    cancel: &CancellationToken,
    reporter: Option<&dyn JobReporter>,
) -> Result<PdfToMdInspectResult> {
    let noop = NoopReporter;
    let rep: &dyn JobReporter = reporter.unwrap_or(&noop);
    let meta = fs::metadata(pdf_path)?;
    let file_size_bytes = meta.len();
    let mtime_nanos = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let key = ExtractedCacheKey {
        canonical: pdf_path
            .canonicalize()
            .unwrap_or_else(|_| pdf_path.to_path_buf()),
        len: file_size_bytes,
        mtime_nanos,
    };

    let cached_doc = if !force_reextract {
        pdf2md_extracted_cache().lock().ok().and_then(|mut guard| {
            let pos = guard.iter().position(|(k, _)| k == &key)?;
            let entry = guard.remove(pos);
            let doc = Arc::clone(&entry.1);
            guard.push(entry);
            Some(doc)
        })
    } else {
        None
    };

    let doc = match cached_doc {
        Some(doc) => doc,
        None => {
            // Luôn trích xuất với MetadataOnly (không giải mã PNG bytes) để vừa tiết kiệm RAM
            // vừa cho phép bật/tắt `extract_images` và `include_page_markers` tức thì từ cache.
            let extracted = extract_pdf_for_markdown_with_mode(
                pdf_path,
                cancel,
                PdfImageExtractMode::MetadataOnly,
                Some(rep),
            )?;
            let arc_doc = Arc::new(extracted);
            if let Ok(mut guard) = pdf2md_extracted_cache().lock() {
                if let Some(pos) = guard.iter().position(|(k, _)| k == &key) {
                    guard.remove(pos);
                } else if guard.len() >= PDF2MD_CACHE_CAP {
                    guard.remove(0);
                }
                guard.push((key, Arc::clone(&arc_doc)));
            }
            arc_doc
        }
    };

    if cancel.is_cancelled() {
        return Err(KnitError::Cancelled);
    }

    let raw_stem = pdf_path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "document".to_string());
    let assets_dir_name = derive_assets_dir_name(&raw_stem);

    reconstruct_markdown_from_extracted(
        &doc,
        pdf_path,
        file_size_bytes,
        &assets_dir_name,
        options,
        cancel,
        rep,
    )
}

/// Kiểm tra tệp PDF và tái cấu trúc nội dung sang GitHub-Flavored Markdown thuần Rust
/// (không giải mã pixel ảnh ở bước inspect để mở nhanh và tiết kiệm RAM trên file lớn).
pub fn inspect_and_extract_pdf_to_markdown(
    pdf_path: &Path,
    options: &PdfToMdOptions,
    cancel: &CancellationToken,
    reporter: Option<&dyn JobReporter>,
) -> Result<PdfToMdInspectResult> {
    inspect_and_extract_pdf_to_markdown_cached(pdf_path, options, false, cancel, reporter)
}

pub(crate) fn reconstruct_markdown_from_extracted(
    doc: &PdfExtractedDocument,
    source_path: &Path,
    file_size_bytes: u64,
    assets_dir_name: &str,
    options: &PdfToMdOptions,
    cancel: &CancellationToken,
    reporter: &dyn JobReporter,
) -> Result<PdfToMdInspectResult> {
    let body_font_size = estimate_body_font_size(doc);
    let repeated_margins = detect_repeated_margin_lines(doc);
    let outline_index = build_outline_lookup(&doc.outlines);

    let mut page_results = Vec::with_capacity(doc.page_count);
    let mut scanned_page_indices = Vec::new();
    let mut extracted_image_count = 0usize;
    let mut doc_sections = Vec::with_capacity(doc.page_count);

    for (idx, page) in doc.pages.iter().enumerate() {
        if cancel.is_cancelled() {
            return Err(KnitError::Cancelled);
        }

        if page.is_likely_scanned {
            scanned_page_indices.push(page.page_index);
        }
        let img_count = if options.extract_images {
            page.images.len()
        } else {
            0
        };
        extracted_image_count += img_count;

        let body_md = reconstruct_single_page(
            page,
            body_font_size,
            &repeated_margins,
            &outline_index,
            assets_dir_name,
            options,
        );

        let full_page_md = if options.include_page_markers {
            if body_md.is_empty() {
                format!("<!-- page: {} -->", page.page_index + 1)
            } else {
                format!("<!-- page: {} -->\n\n{}", page.page_index + 1, body_md)
            }
        } else {
            body_md
        };

        let word_count = full_page_md.split_whitespace().count();
        doc_sections.push(full_page_md.clone());
        page_results.push(PdfPageMarkdown {
            page_index: page.page_index,
            markdown: full_page_md,
            word_count,
            image_count: img_count,
            is_likely_scanned: page.is_likely_scanned,
        });

        reporter.on_progress(JobProgress {
            phase: "reconstruct".into(),
            done: (idx + 1) as u64,
            total: doc.page_count.max(1) as u64,
            bytes_done: 0,
            bytes_total: 0,
            current_item: format!("Formatted page {}/{}", idx + 1, doc.page_count),
        });
    }

    let joined = doc_sections
        .into_iter()
        .filter(|s| !s.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    let markdown = nfc_normalize(&collapse_excess_blank_lines(&joined));

    let is_scanned_document = doc.page_count > 0
        && !scanned_page_indices.is_empty()
        && scanned_page_indices.len() * 2 >= doc.page_count;

    Ok(PdfToMdInspectResult {
        source_path: source_path.to_path_buf(),
        page_count: doc.page_count,
        file_size_bytes,
        outlines: doc.outlines.clone(),
        scanned_page_indices,
        is_scanned_document,
        extracted_image_count,
        markdown,
        pages: page_results,
    })
}

fn collect_png_asset_entries(doc: &PdfExtractedDocument) -> Vec<(String, Vec<u8>)> {
    let mut written_images = Vec::new();
    for page in &doc.pages {
        for img in &page.images {
            if img.png_bytes.is_empty() {
                continue;
            }
            let filename = format!(
                "page_{:03}_img_{:02}.png",
                page.page_index + 1,
                img.image_index + 1
            );
            written_images.push((filename, img.png_bytes.clone()));
        }
    }
    written_images
}

/// Chuyển đổi và xuất thẳng PDF -> `.md` (+ `_assets/`) trong 1 lượt quét duy nhất mà không cần đưa Markdown về frontend.
pub fn convert_pdf_to_markdown_file(
    source_pdf: &Path,
    output_md_path: &Path,
    options: &PdfToMdOptions,
    cancel: &CancellationToken,
    reporter: Option<&dyn JobReporter>,
) -> Result<PdfToMdExportResult> {
    let noop = NoopReporter;
    let rep: &dyn JobReporter = reporter.unwrap_or(&noop);
    if cancel.is_cancelled() {
        return Err(KnitError::Cancelled);
    }

    let meta = fs::metadata(source_pdf)?;
    let image_mode = if options.extract_images {
        PdfImageExtractMode::DecodePng
    } else {
        PdfImageExtractMode::None
    };
    let doc = extract_pdf_for_markdown_with_mode(source_pdf, cancel, image_mode, Some(rep))?;

    let out_stem_raw = output_md_path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "document".to_string());
    let target_assets_name = derive_assets_dir_name(&out_stem_raw);

    let inspected = reconstruct_markdown_from_extracted(
        &doc,
        source_pdf,
        meta.len(),
        &target_assets_name,
        options,
        cancel,
        rep,
    )?;

    let written_images = if options.extract_images {
        collect_png_asset_entries(&doc)
    } else {
        Vec::new()
    };

    commit_markdown_and_assets_atomically(
        output_md_path,
        &target_assets_name,
        &inspected.markdown,
        &written_images,
        doc.page_count,
        cancel,
        rep,
    )
}

/// Xuất file `.md` (từ nội dung đã chỉnh sửa) và thư mục `<stem>_assets/` một cách nguyên tử, dọn rác nếu lỗi/hủy.
/// Không giải mã lại text/font của PDF; nếu `extract_images = false` (hoặc danh sách trang chứa ảnh rỗng) sẽ ghi thẳng ra đĩa tức thì.
pub fn export_pdf_markdown_to_path_with_pages(
    source_pdf: &Path,
    output_md_path: &Path,
    markdown: &str,
    extract_images: bool,
    image_page_indices: Option<&[usize]>,
    cancel: &CancellationToken,
    reporter: Option<&dyn JobReporter>,
) -> Result<PdfToMdExportResult> {
    let noop = NoopReporter;
    let rep: &dyn JobReporter = reporter.unwrap_or(&noop);
    if cancel.is_cancelled() {
        return Err(KnitError::Cancelled);
    }

    let out_stem_raw = output_md_path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "document".to_string());
    let target_assets_name = derive_assets_dir_name(&out_stem_raw);

    let src_stem_raw = source_pdf
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "document".to_string());
    let source_assets_name = derive_assets_dir_name(&src_stem_raw);

    let normalized_md = if source_assets_name != target_assets_name {
        let from_prefix = format!("]({source_assets_name}/page_");
        let to_prefix = format!("]({target_assets_name}/page_");
        nfc_normalize(&markdown.replace(&from_prefix, &to_prefix))
    } else {
        nfc_normalize(markdown)
    };

    let (page_count, written_images) = if extract_images && !matches!(image_page_indices, Some(s) if s.is_empty()) {
        let (total_pages, extracted) =
            extract_pdf_images_only(source_pdf, image_page_indices, cancel, Some(rep))?;
        let mut entries = Vec::with_capacity(extracted.len());
        for (page_idx, img) in extracted {
            if img.png_bytes.is_empty() {
                continue;
            }
            let filename = format!("page_{:03}_img_{:02}.png", page_idx + 1, img.image_index + 1);
            entries.push((filename, img.png_bytes));
        }
        (total_pages, entries)
    } else {
        let info = inspect_pdf(source_pdf)?;
        (info.page_count, Vec::new())
    };

    commit_markdown_and_assets_atomically(
        output_md_path,
        &target_assets_name,
        &normalized_md,
        &written_images,
        page_count,
        cancel,
        rep,
    )
}

/// Xuất file `.md` (từ nội dung đã chỉnh sửa) và thư mục `<stem>_assets/` (nếu có ảnh) một cách nguyên tử, dọn rác nếu lỗi/hủy.
pub fn export_pdf_markdown_to_path(
    source_pdf: &Path,
    output_md_path: &Path,
    markdown: &str,
    extract_images: bool,
    cancel: &CancellationToken,
    reporter: Option<&dyn JobReporter>,
) -> Result<PdfToMdExportResult> {
    export_pdf_markdown_to_path_with_pages(
        source_pdf,
        output_md_path,
        markdown,
        extract_images,
        None,
        cancel,
        reporter,
    )
}

fn commit_markdown_and_assets_atomically(
    output_md_path: &Path,
    target_assets_name: &str,
    normalized_md: &str,
    written_images: &[(String, Vec<u8>)],
    page_count: usize,
    cancel: &CancellationToken,
    rep: &dyn JobReporter,
) -> Result<PdfToMdExportResult> {
    let parent = output_md_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));

    let (effective_dir, final_md_path) = if !written_images.is_empty() {
        let out_stem_raw = output_md_path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "document".to_string());
        let pkg_dir_name = derive_package_dir_name(&out_stem_raw);
        let already_packaged = parent
            .file_name()
            .and_then(|s| s.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case(&pkg_dir_name));
        let pkg_dir = if already_packaged {
            parent.to_path_buf()
        } else {
            parent.join(&pkg_dir_name)
        };
        let md_file_name = output_md_path
            .file_name()
            .unwrap_or_else(|| std::ffi::OsStr::new("document.md"));
        let packaged_md = pkg_dir.join(md_file_name);
        (pkg_dir, packaged_md)
    } else {
        (parent.to_path_buf(), output_md_path.to_path_buf())
    };

    fs::create_dir_all(&effective_dir)?;

    let md_bytes = normalized_md.as_bytes();
    let images_total_bytes: u64 = written_images.iter().map(|(_, b)| b.len() as u64).sum();
    let needed_bytes = (md_bytes.len() as u64)
        .saturating_add(images_total_bytes)
        .saturating_add(64 * 1024);
    ensure_disk_space(&effective_dir, needed_bytes)?;

    let mut asset_dir_out: Option<PathBuf> = None;
    let mut written_image_count = 0usize;
    let mut staged_assets_tmp: Option<PathBuf> = None;

    if !written_images.is_empty() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let staging = effective_dir.join(format!(
            ".{target_assets_name}.tmp.{}.{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&staging)?;
        staged_assets_tmp = Some(staging.clone());

        for (idx, (filename, bytes)) in written_images.iter().enumerate() {
            if cancel.is_cancelled() {
                let _ = fs::remove_dir_all(&staging);
                return Err(KnitError::Cancelled);
            }
            let img_path = staging.join(filename);
            if let Err(err) = File::create(&img_path).and_then(|mut f| {
                f.write_all(bytes)?;
                f.sync_all()
            }) {
                let _ = fs::remove_dir_all(&staging);
                return Err(KnitError::Io(err));
            }
            written_image_count += 1;
            rep.on_progress(JobProgress {
                phase: "assets".into(),
                done: (idx + 1) as u64,
                total: written_images.len() as u64,
                bytes_done: 0,
                bytes_total: 0,
                current_item: format!("Writing image {filename}"),
            });
        }

        if cancel.is_cancelled() {
            let _ = fs::remove_dir_all(&staging);
            return Err(KnitError::Cancelled);
        }
    }

    let md_write_res = atomic_write_file(&final_md_path, |file| {
        file.write_all(md_bytes)?;
        Ok(())
    });
    if let Err(err) = md_write_res {
        if let Some(ref staging) = staged_assets_tmp {
            let _ = fs::remove_dir_all(staging);
        }
        return Err(err);
    }

    if let Some(staging) = staged_assets_tmp {
        let final_assets_dir = effective_dir.join(target_assets_name);
        if final_assets_dir.exists() {
            fs::create_dir_all(&final_assets_dir)?;
            for (filename, _) in written_images {
                let src = staging.join(filename);
                let dst = final_assets_dir.join(filename);
                if dst.exists() {
                    let _ = fs::remove_file(&dst);
                }
                fs::rename(&src, &dst)?;
            }
            let _ = fs::remove_dir_all(&staging);
        } else {
            fs::rename(&staging, &final_assets_dir)?;
        }
        asset_dir_out = Some(final_assets_dir);
    }

    Ok(PdfToMdExportResult {
        output_path: final_md_path,
        asset_dir: asset_dir_out,
        written_image_count,
        bytes_written: md_bytes.len() as u64 + images_total_bytes,
        page_count,
    })
}

fn estimate_body_font_size(doc: &PdfExtractedDocument) -> f32 {
    let mut histogram: HashMap<i32, usize> = HashMap::new();
    for page in &doc.pages {
        for span in &page.spans {
            let weight = span.text.chars().filter(|c| !c.is_whitespace()).count();
            if weight == 0 || span.font_size_pt < 6.0 || span.font_size_pt > 28.0 {
                continue;
            }
            let bucket = (span.font_size_pt * 2.0).round() as i32;
            *histogram.entry(bucket).or_default() += weight;
        }
    }
    histogram
        .into_iter()
        .max_by_key(|&(_, count)| count)
        .map(|(bucket, _)| bucket as f32 / 2.0)
        .unwrap_or(11.0)
}

fn detect_repeated_margin_lines(doc: &PdfExtractedDocument) -> Vec<String> {
    if doc.page_count < 3 {
        return Vec::new();
    }
    let mut freq: HashMap<String, usize> = HashMap::new();
    for page in &doc.pages {
        let top_cut = page.height_pt * 0.11;
        let bottom_cut = page.height_pt * 0.89;
        let lines = cluster_spans_into_lines(&page.spans);
        let mut seen_on_page = Vec::new();
        for line in lines {
            if line.y_top <= top_cut || line.y_bottom >= bottom_cut {
                let sig = normalize_margin_signature(&line.text);
                if !sig.is_empty() && !seen_on_page.contains(&sig) {
                    seen_on_page.push(sig);
                }
            }
        }
        for sig in seen_on_page {
            *freq.entry(sig).or_default() += 1;
        }
    }

    let threshold = ((doc.page_count as f32) * 0.60).ceil() as usize;
    freq.into_iter()
        .filter(|(_, count)| *count >= threshold.max(3))
        .map(|(sig, _)| sig)
        .collect()
}

fn normalize_margin_signature(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.len() > 100 {
        return String::new();
    }
    let mut out = String::with_capacity(trimmed.len());
    let mut in_digit = false;
    for ch in trimmed.chars() {
        if ch.is_ascii_digit() {
            if !in_digit {
                out.push('#');
                in_digit = true;
            }
        } else {
            in_digit = false;
            out.extend(ch.to_lowercase());
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn is_standalone_page_number_margin(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.len() > 28 {
        return false;
    }
    let stripped = trimmed
        .trim_matches(|c: char| c == '-' || c == '—' || c == '|' || c == '/' || c.is_whitespace());
    if !stripped.is_empty() && stripped.chars().all(|c| c.is_ascii_digit()) {
        return true;
    }
    let lower = trimmed.to_ascii_lowercase();
    if (lower.starts_with("page ") || lower.starts_with("trang "))
        && lower.chars().any(|c| c.is_ascii_digit())
    {
        let words: Vec<&str> = lower.split_whitespace().collect();
        return words.len() <= 4;
    }
    false
}

fn build_outline_lookup(nodes: &[BookmarkNode]) -> Vec<(usize, u8, String)> {
    fn walk(nodes: &[BookmarkNode], depth: u8, out: &mut Vec<(usize, u8, String)>) {
        for node in nodes {
            let norm = normalize_heading_key(&node.title);
            if !norm.is_empty() {
                out.push((node.target_page_index, depth.saturating_add(1).clamp(1, 6), norm));
            }
            walk(&node.children, depth.saturating_add(1), out);
        }
    }
    let mut out = Vec::new();
    walk(nodes, 0, &mut out);
    out
}

fn normalize_heading_key(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn reconstruct_single_page(
    page: &knit_pdf::PdfExtractedPage,
    body_font_size: f32,
    repeated_margins: &[String],
    outlines: &[(usize, u8, String)],
    assets_dir_name: &str,
    options: &PdfToMdOptions,
) -> String {
    let mut filtered_spans: Vec<PdfTextSpan> = Vec::with_capacity(page.spans.len());
    let top_cut = page.height_pt * 0.11;
    let bottom_cut = page.height_pt * 0.89;

    // Lọc các dòng header/footer lặp lại và số trang đứng độc lập ở mép trang
    let raw_lines = cluster_spans_into_lines(&page.spans);
    for line in raw_lines {
        let in_margin = line.y_top <= top_cut || line.y_bottom >= bottom_cut;
        if in_margin {
            let sig = normalize_margin_signature(&line.text);
            if (!sig.is_empty() && repeated_margins.iter().any(|m| m == &sig))
                || is_standalone_page_number_margin(&line.text)
            {
                continue;
            }
        }
        filtered_spans.extend(line.spans);
    }

    let zones = split_two_column_zones(&filtered_spans, page.width_pt);
    let mut blocks: Vec<PositionedBlock> = Vec::new();

    for zone_spans in zones {
        let zone_lines = cluster_spans_into_lines(&zone_spans);
        let mut zone_blocks = convert_lines_to_blocks(
            &zone_lines,
            page.page_index,
            body_font_size,
            outlines,
        );
        blocks.append(&mut zone_blocks);
    }

    if options.extract_images && !page.images.is_empty() {
        for img in &page.images {
            let filename = format!(
                "page_{:03}_img_{:02}.png",
                page.page_index + 1,
                img.image_index + 1
            );
            blocks.push(PositionedBlock {
                y_top: img.y_top,
                item: FlowItem::Image {
                    page_one_based: page.page_index + 1,
                    image_one_based: img.image_index + 1,
                    rel_path: format!("{assets_dir_name}/{filename}"),
                },
            });
        }
    } else if page.is_likely_scanned && filtered_spans.is_empty() {
        blocks.push(PositionedBlock {
            y_top: 0.0,
            item: FlowItem::ScannedNotice {
                page_one_based: page.page_index + 1,
            },
        });
    }

    // Bảo toàn thứ tự dọc giữa khối văn bản và ảnh nếu trang 1 cột; với 2 cột giữ thứ tự cột + chèn ảnh theo Y
    if page.spans.is_empty() && page.images.is_empty() && page.is_likely_scanned {
        blocks.push(PositionedBlock {
            y_top: 0.0,
            item: FlowItem::ScannedNotice {
                page_one_based: page.page_index + 1,
            },
        });
    }

    render_positioned_blocks(&mut blocks)
}

fn is_toc_leader_line(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.len() > 512 {
        return false;
    }
    let compact: String = trimmed
        .chars()
        .filter(|&c| !c.is_whitespace() && !matches!(c, '\u{200B}' | '\u{200C}' | '\u{200D}' | '\u{FEFF}'))
        .collect();
    if compact.contains("....")
        || compact.contains("……")
        || compact.contains("….")
        || compact.contains(".…")
    {
        return true;
    }
    let dot_count = compact.chars().filter(|&c| c == '.' || c == '…').count();
    if dot_count >= 4 {
        if let Some(last_tok) = trimmed.split_whitespace().last() {
            let clean = last_tok.trim_start_matches(|c: char| {
                c == '.' || c == '…' || matches!(c, '\u{200B}' | '\u{200C}' | '\u{200D}' | '\u{FEFF}')
            });
            if !clean.is_empty() && clean.len() <= 4 && clean.chars().all(|c| c.is_ascii_digit()) {
                return true;
            }
        }
    }
    false
}

fn split_two_column_zones(spans: &[PdfTextSpan], page_width: f32) -> Vec<Vec<PdfTextSpan>> {
    if spans.len() < 8 || page_width < 200.0 {
        return vec![spans.to_vec()];
    }

    let raw_lines = cluster_spans_into_lines(spans);
    if raw_lines.len() < 6 {
        return vec![spans.to_vec()];
    }

    let gutter_left = page_width * 0.43;
    let gutter_right = page_width * 0.57;
    let mid_x = page_width * 0.50;

    let mut two_col_rows = 0usize;
    let mut left_only_lines = 0usize;
    let mut right_only_lines = 0usize;
    let mut bridging_lines: Vec<(f32, f32)> = Vec::new();
    let mut col_y_min = f32::INFINITY;
    let mut col_y_max = f32::NEG_INFINITY;
    let mut left_y_min = f32::INFINITY;
    let mut left_y_max = f32::NEG_INFINITY;
    let mut right_y_min = f32::INFINITY;
    let mut right_y_max = f32::NEG_INFINITY;

    for line in &raw_lines {
        let is_toc = is_toc_leader_line(&line.text);
        let has_crossing_span = line
            .spans
            .iter()
            .any(|s| s.x_min < mid_x - 2.0 && s.x_max > mid_x + 2.0);
        let line_x_max = line
            .spans
            .iter()
            .map(|s| s.x_max)
            .fold(f32::NEG_INFINITY, f32::max);

        let left_max = line
            .spans
            .iter()
            .filter(|s| (s.x_min + s.x_max) * 0.5 < mid_x)
            .map(|s| s.x_max)
            .fold(f32::NEG_INFINITY, f32::max);
        let right_min = line
            .spans
            .iter()
            .filter(|s| (s.x_min + s.x_max) * 0.5 >= mid_x)
            .map(|s| s.x_min)
            .fold(f32::INFINITY, f32::min);

        let has_left = left_max.is_finite();
        let has_right = right_min.is_finite();

        if has_left && has_right {
            let center_gap = right_min - left_max;
            let gutter_min = (line.font_size_pt * 2.0).max(16.0);
            let word_gap_max = (line.font_size_pt * 1.65).max(12.0);
            if !is_toc
                && !has_crossing_span
                && center_gap >= gutter_min
                && left_max <= gutter_right
                && right_min >= gutter_left
            {
                two_col_rows += 1;
                col_y_min = col_y_min.min(line.y_top);
                col_y_max = col_y_max.max(line.y_bottom);
            } else if has_crossing_span || center_gap <= word_gap_max || is_toc {
                bridging_lines.push((line.y_top, line.y_bottom));
            } else {
                bridging_lines.push((line.y_top, line.y_bottom));
            }
        } else if has_crossing_span || is_toc {
            bridging_lines.push((line.y_top, line.y_bottom));
        } else if has_left && line_x_max <= mid_x + 6.0 {
            left_only_lines += 1;
            left_y_min = left_y_min.min(line.y_top);
            left_y_max = left_y_max.max(line.y_bottom);
        } else if has_right && line.x_min >= mid_x - 6.0 {
            right_only_lines += 1;
            right_y_min = right_y_min.min(line.y_top);
            right_y_max = right_y_max.max(line.y_bottom);
        }
    }

    let staggered_overlap = left_only_lines >= 4
        && right_only_lines >= 4
        && left_y_min < right_y_max
        && right_y_min < left_y_max;
    if staggered_overlap {
        col_y_min = col_y_min.min(left_y_min).min(right_y_min);
        col_y_max = col_y_max.max(left_y_max).max(right_y_max);
    }

    let total_col_evidence = two_col_rows + if staggered_overlap { left_only_lines + right_only_lines } else { 0 };
    if two_col_rows < 3 && !staggered_overlap {
        return vec![spans.to_vec()];
    }

    let bridging_in_band = bridging_lines
        .iter()
        .filter(|&&(yt, yb)| yt >= col_y_min - 4.0 && yb <= col_y_max + 4.0)
        .count();
    if bridging_in_band > 1 || bridging_in_band * 6 >= total_col_evidence.max(1) {
        return vec![spans.to_vec()];
    }

    let mut left_candidates = Vec::new();
    let mut right_candidates = Vec::new();
    let mut full_width = Vec::new();

    for span in spans {
        let crosses_mid = span.x_min < gutter_left && span.x_max > gutter_right;
        if crosses_mid {
            full_width.push(span.clone());
        } else if span.x_max <= mid_x + 6.0 {
            left_candidates.push(span.clone());
        } else if span.x_min >= mid_x - 6.0 {
            right_candidates.push(span.clone());
        } else {
            full_width.push(span.clone());
        }
    }

    if left_candidates.len() < 4 || right_candidates.len() < 4 {
        return vec![spans.to_vec()];
    }

    let mut top_full = Vec::new();
    let mut mid_left = left_candidates;
    let mut mid_right = right_candidates;
    let mut bot_full = Vec::new();

    for span in full_width {
        if span.y_bottom <= col_y_min + 4.0 {
            top_full.push(span);
        } else if span.y_top >= col_y_max - 4.0 {
            bot_full.push(span);
        } else if (span.x_min + span.x_max) * 0.5 < mid_x {
            mid_left.push(span);
        } else {
            mid_right.push(span);
        }
    }

    let mut zones = Vec::new();
    if !top_full.is_empty() {
        zones.push(top_full);
    }
    zones.push(mid_left);
    zones.push(mid_right);
    if !bot_full.is_empty() {
        zones.push(bot_full);
    }
    zones
}

fn cluster_spans_into_lines(spans: &[PdfTextSpan]) -> Vec<LogicalLine> {
    if spans.is_empty() {
        return Vec::new();
    }
    let mut sorted = spans.to_vec();
    sorted.sort_by(|a, b| {
        a.baseline_y
            .total_cmp(&b.baseline_y)
            .then_with(|| a.x_min.total_cmp(&b.x_min))
    });

    let mut raw_groups: Vec<Vec<PdfTextSpan>> = Vec::new();
    for span in sorted {
        if let Some(last_group) = raw_groups.last_mut() {
            let ref_y = last_group[0].baseline_y;
            let ref_fs = last_group[0].font_size_pt.max(span.font_size_pt).max(4.0);
            if (span.baseline_y - ref_y).abs() <= ref_fs * 0.42 {
                last_group.push(span);
                continue;
            }
        }
        raw_groups.push(vec![span]);
    }

    raw_groups
        .into_iter()
        .map(|mut group| {
            group.sort_by(|a, b| a.x_min.total_cmp(&b.x_min));
            let mut text = String::new();
            let mut x_min = f32::INFINITY;
            let mut y_top = f32::INFINITY;
            let mut y_bottom = f32::NEG_INFINITY;
            let mut weight_sum = 0.0f32;
            let mut fs_weighted = 0.0f32;
            let mut bold_chars = 0usize;
            let mut total_chars = 0usize;

            for (i, s) in group.iter().enumerate() {
                if i > 0 && !text.ends_with(' ') && !s.text.starts_with(' ') {
                    let gap = s.x_min - group[i - 1].x_max;
                    let fs = s.font_size_pt.max(group[i - 1].font_size_pt);
                    if gap > fs * 0.16 {
                        text.push(' ');
                    }
                }
                text.push_str(s.text.trim());
                x_min = x_min.min(s.x_min);
                y_top = y_top.min(s.y_top);
                y_bottom = y_bottom.max(s.y_bottom);
                let w = s.text.chars().filter(|c| !c.is_whitespace()).count().max(1);
                weight_sum += w as f32;
                fs_weighted += s.font_size_pt * (w as f32);
                total_chars += w;
                if s.is_bold {
                    bold_chars += w;
                }
            }

            let font_size_pt = if weight_sum > 0.0 {
                fs_weighted / weight_sum
            } else {
                group[0].font_size_pt
            };

            LogicalLine {
                spans: group,
                text: text.split_whitespace().collect::<Vec<_>>().join(" "),
                x_min,
                y_top,
                y_bottom,
                font_size_pt,
                is_bold: total_chars > 0 && bold_chars * 2 >= total_chars,
            }
        })
        .filter(|l| !l.text.is_empty())
        .collect()
}

fn split_line_into_table_cells(line: &LogicalLine) -> Option<Vec<(f32, String)>> {
    if line.spans.len() < 2 || is_toc_leader_line(&line.text) {
        return None;
    }
    let gap_threshold = (line.font_size_pt * 1.45).max(12.0);
    let mut cells: Vec<(f32, String)> = Vec::new();
    let mut cur_x = line.spans[0].x_min;
    let mut cur_text = line.spans[0].text.trim().to_string();
    let mut prev_x_max = line.spans[0].x_max;

    for s in line.spans.iter().skip(1) {
        let gap = s.x_min - prev_x_max;
        if gap >= gap_threshold {
            let cleaned = cur_text.split_whitespace().collect::<Vec<_>>().join(" ");
            if !cleaned.is_empty() {
                cells.push((cur_x, cleaned));
            }
            cur_x = s.x_min;
            cur_text = s.text.trim().to_string();
        } else {
            if !cur_text.is_empty() && !cur_text.ends_with(' ') && gap > line.font_size_pt * 0.16 {
                cur_text.push(' ');
            }
            cur_text.push_str(s.text.trim());
        }
        prev_x_max = prev_x_max.max(s.x_max);
    }

    let cleaned = cur_text.split_whitespace().collect::<Vec<_>>().join(" ");
    if !cleaned.is_empty() {
        cells.push((cur_x, cleaned));
    }

    if cells.len() < 2 || cells.len() > 10 {
        return None;
    }
    if looks_like_bullet_or_list_prefix(&cells[0].1) {
        return None;
    }
    Some(cells)
}

fn looks_like_bullet_or_list_prefix(s: &str) -> bool {
    let t = s.trim();
    if matches!(t, "•" | "◦" | "▪" | "‣" | "●" | "○" | "■" | "-" | "*") {
        return true;
    }
    if t.len() <= 5 && (t.ends_with('.') || t.ends_with(')')) {
        let core = &t[..t.len() - 1];
        if !core.is_empty() && core.chars().all(|c| c.is_ascii_digit()) {
            return true;
        }
    }
    false
}

fn try_consume_table(lines: &[LogicalLine], start: usize) -> Option<(usize, FlowItem)> {
    let mut row_cells = Vec::new();
    let mut col_anchors: Vec<f32> = Vec::new();
    let mut idx = start;

    while idx < lines.len() {
        let Some(cells) = split_line_into_table_cells(&lines[idx]) else {
            break;
        };
        if idx > start {
            let vgap = lines[idx].y_top - lines[idx - 1].y_bottom;
            if vgap > lines[idx].font_size_pt.max(10.0) * 3.2 {
                break;
            }
        }
        for (x, _) in &cells {
            if let Some(existing) = col_anchors.iter_mut().find(|a| (**a - *x).abs() <= 20.0) {
                *existing = (*existing + *x) * 0.5;
            } else {
                col_anchors.push(*x);
            }
        }
        row_cells.push(cells);
        idx += 1;
    }

    if row_cells.len() < 2 {
        return None;
    }

    col_anchors.sort_by(|a, b| a.total_cmp(b));
    let num_cols = col_anchors.len();
    if !(2..=8).contains(&num_cols) {
        return None;
    }

    // Kiểm tra các dòng bảng thực sự phân bố ổn định vào các cột
    let multi_col_rows = row_cells.iter().filter(|r| r.len() >= 2).count();
    if multi_col_rows < 2 {
        return None;
    }

    let mut rows = Vec::with_capacity(row_cells.len());
    for cells in row_cells {
        let mut row = vec![String::new(); num_cols];
        for (x, txt) in cells {
            let col_idx = col_anchors
                .iter()
                .enumerate()
                .min_by(|(_, a), (_, b)| ((*a - x).abs()).total_cmp(&((*b - x).abs())))
                .map(|(i, _)| i)
                .unwrap_or(0);
            let escaped = txt.replace('|', "\\|");
            if row[col_idx].is_empty() {
                row[col_idx] = escaped;
            } else {
                row[col_idx].push(' ');
                row[col_idx].push_str(&escaped);
            }
        }
        rows.push(row);
    }

    Some((idx - start, FlowItem::Table { rows }))
}

fn convert_lines_to_blocks(
    lines: &[LogicalLine],
    page_index: usize,
    body_font_size: f32,
    outlines: &[(usize, u8, String)],
) -> Vec<PositionedBlock> {
    let mut blocks: Vec<PositionedBlock> = Vec::new();
    let mut i = 0usize;

    while i < lines.len() {
        if let Some((consumed, table)) = try_consume_table(lines, i) {
            blocks.push(PositionedBlock {
                y_top: lines[i].y_top,
                item: table,
            });
            i += consumed;
            continue;
        }

        let line = &lines[i];
        if is_toc_leader_line(&line.text) {
            let entry = normalize_list_line(&line.text)
                .unwrap_or_else(|| format!("- {}", line.text.trim()));
            blocks.push(PositionedBlock {
                y_top: line.y_top,
                item: FlowItem::ListItem { text: entry },
            });
            i += 1;
            continue;
        }

        if let Some(level) = detect_heading_level(line, page_index, body_font_size, outlines) {
            blocks.push(PositionedBlock {
                y_top: line.y_top,
                item: FlowItem::Heading {
                    level,
                    text: line.text.clone(),
                },
            });
            i += 1;
            continue;
        }

        if let Some(list_start) = normalize_list_line(&line.text) {
            let mut combined = list_start;
            let base_x = line.x_min;
            let y_top = line.y_top;
            let mut prev = line;
            let mut j = i + 1;
            while j < lines.len() {
                let next = &lines[j];
                if try_consume_table(lines, j).is_some()
                    || detect_heading_level(next, page_index, body_font_size, outlines).is_some()
                    || normalize_list_line(&next.text).is_some()
                {
                    break;
                }
                let vgap = next.y_top - prev.y_bottom;
                if vgap > prev.font_size_pt.max(10.0) * 1.4 || next.x_min <= base_x + 4.0 {
                    break;
                }
                combined = join_wrapped_lines(&combined, &next.text);
                prev = next;
                j += 1;
            }
            blocks.push(PositionedBlock {
                y_top,
                item: FlowItem::ListItem { text: combined },
            });
            i = j;
            continue;
        }

        // Gộp các dòng thuộc cùng một đoạn văn và xử lý nối từ gạch nối (de-hyphenation)
        let y_top = line.y_top;
        let para_x_min = line.x_min;
        let mut text = line.text.clone();
        let mut prev = line;
        let mut j = i + 1;

        while j < lines.len() {
            let next = &lines[j];
            if is_toc_leader_line(&next.text)
                || try_consume_table(lines, j).is_some()
                || detect_heading_level(next, page_index, body_font_size, outlines).is_some()
                || normalize_list_line(&next.text).is_some()
            {
                break;
            }
            let ref_fs = prev.font_size_pt.max(next.font_size_pt).max(9.0);
            let vgap = next.y_top - prev.y_bottom;
            if vgap > ref_fs * 1.55 {
                break;
            }
            // Nếu thụt đầu dòng rõ rệt cho đoạn mới ở câu đã kết thúc, tách đoạn
            let prev_ends_sentence = prev.text.ends_with('.')
                || prev.text.ends_with('!')
                || prev.text.ends_with('?')
                || prev.text.ends_with(':');
            let indented_new_para = (next.x_min - para_x_min) > ref_fs * 1.1;
            if prev_ends_sentence && indented_new_para {
                break;
            }
            text = join_wrapped_lines(&text, &next.text);
            prev = next;
            j += 1;
        }

        blocks.push(PositionedBlock {
            y_top,
            item: FlowItem::Paragraph { text },
        });
        i = j;
    }

    blocks
}

fn detect_heading_level(
    line: &LogicalLine,
    page_index: usize,
    body_font_size: f32,
    outlines: &[(usize, u8, String)],
) -> Option<u8> {
    let text = line.text.trim();
    if text.is_empty() || text.len() > 140 {
        return None;
    }

    let key = normalize_heading_key(text);
    for (target_page, level, title) in outlines {
        if (*target_page == page_index || target_page.abs_diff(page_index) <= 1)
            && !title.is_empty()
            && (title == &key || key.ends_with(title.as_str()) && key.len() <= title.len() + 8)
        {
            return Some(*level);
        }
    }

    if text.len() > 105 || normalize_list_line(text).is_some() {
        return None;
    }

    let ratio = line.font_size_pt / body_font_size.max(6.0);
    if ratio >= 1.65 {
        return Some(1);
    }
    if ratio >= 1.38 {
        return Some(2);
    }
    if ratio >= 1.18 {
        return Some(3);
    }
    if ratio >= 1.07 && line.is_bold && !text.ends_with(',') && !text.ends_with(';') {
        return Some(3);
    }
    None
}

fn normalize_list_line(text: &str) -> Option<String> {
    let t = text.trim();
    for bullet in ["•", "◦", "▪", "‣", "●", "○", "■", "–"] {
        if let Some(rest) = t.strip_prefix(bullet) {
            let trimmed = rest.trim_start();
            if !trimmed.is_empty() {
                return Some(format!("- {trimmed}"));
            }
        }
    }
    if let Some(rest) = t.strip_prefix("- ") {
        if !rest.trim().is_empty() {
            return Some(format!("- {}", rest.trim()));
        }
    }
    if let Some(rest) = t.strip_prefix("* ") {
        if !rest.trim().is_empty() {
            return Some(format!("- {}", rest.trim()));
        }
    }

    // Kiểm tra danh sách đánh số kiểu "1. ..." hoặc "1) ..."
    let bytes = t.as_bytes();
    let mut digits_end = 0usize;
    while digits_end < bytes.len() && digits_end < 4 && bytes[digits_end].is_ascii_digit() {
        digits_end += 1;
    }
    if digits_end > 0 && digits_end + 1 < bytes.len() {
        let sep = bytes[digits_end];
        if (sep == b'.' || sep == b')') && bytes[digits_end + 1] == b' ' {
            let rest = t[digits_end + 2..].trim_start();
            if !rest.is_empty() {
                let num = &t[..digits_end];
                return Some(format!("{num}. {rest}"));
            }
        }
    }

    None
}

fn join_wrapped_lines(prev: &str, next: &str) -> String {
    let prev_t = prev.trim_end();
    let next_t = next.trim_start();
    if prev_t.is_empty() {
        return next_t.to_string();
    }
    if next_t.is_empty() {
        return prev_t.to_string();
    }

    if let Some(stripped) = prev_t.strip_suffix('\u{00AD}') {
        return format!("{stripped}{next_t}");
    }

    if let Some(stripped) = prev_t.strip_suffix('-') {
        let before_hyphen_is_alpha = stripped.chars().next_back().is_some_and(|c| c.is_alphabetic());
        let next_starts_lower = next_t.chars().next().is_some_and(|c| c.is_lowercase());
        if before_hyphen_is_alpha && next_starts_lower {
            return format!("{stripped}{next_t}");
        }
    }

    format!("{prev_t} {next_t}")
}

fn render_positioned_blocks(blocks: &mut [PositionedBlock]) -> String {
    if blocks.is_empty() {
        return String::new();
    }
    // Chèn ảnh theo đúng trục Y vào vị trí gần nhất nếu có khối văn bản; nếu tất cả là ảnh vẫn ổn định
    let mut non_images: Vec<&PositionedBlock> = Vec::new();
    let mut images: Vec<&PositionedBlock> = Vec::new();
    for b in blocks.iter() {
        if matches!(b.item, FlowItem::Image { .. }) {
            images.push(b);
        } else {
            non_images.push(b);
        }
    }
    images.sort_by(|a, b| a.y_top.total_cmp(&b.y_top));

    let mut ordered: Vec<&PositionedBlock> = Vec::with_capacity(blocks.len());
    let mut img_idx = 0usize;
    for text_block in &non_images {
        while img_idx < images.len() && images[img_idx].y_top <= text_block.y_top {
            ordered.push(images[img_idx]);
            img_idx += 1;
        }
        ordered.push(text_block);
    }
    while img_idx < images.len() {
        ordered.push(images[img_idx]);
        img_idx += 1;
    }

    let mut parts: Vec<String> = Vec::new();
    let mut idx = 0usize;
    while idx < ordered.len() {
        match &ordered[idx].item {
            FlowItem::Heading { level, text } => {
                let hashes = "#".repeat((*level).clamp(1, 6) as usize);
                parts.push(format!("{hashes} {text}"));
                idx += 1;
            }
            FlowItem::Table { rows } => {
                parts.push(format_gfm_table(rows));
                idx += 1;
            }
            FlowItem::ListItem { .. } => {
                let mut list_buf = Vec::new();
                while idx < ordered.len() {
                    if let FlowItem::ListItem { text } = &ordered[idx].item {
                        list_buf.push(text.as_str());
                        idx += 1;
                    } else {
                        break;
                    }
                }
                parts.push(list_buf.join("\n"));
            }
            FlowItem::Paragraph { text } => {
                parts.push(text.clone());
                idx += 1;
            }
            FlowItem::Image {
                page_one_based,
                image_one_based,
                rel_path,
                ..
            } => {
                parts.push(format!(
                    "![Image p.{page_one_based} #{image_one_based}]({rel_path})"
                ));
                idx += 1;
            }
            FlowItem::ScannedNotice { page_one_based } => {
                parts.push(format!(
                    "<!-- Scanned page {page_one_based}: no selectable text layer -->"
                ));
                idx += 1;
            }
        }
    }

    let _ = &mut *blocks;
    parts.join("\n\n")
}

fn format_gfm_table(rows: &[Vec<String>]) -> String {
    if rows.is_empty() {
        return String::new();
    }
    let col_count = rows.iter().map(|r| r.len()).max().unwrap_or(0);
    if col_count == 0 {
        return String::new();
    }
    let mut out = Vec::with_capacity(rows.len() + 1);
    for (r_idx, row) in rows.iter().enumerate() {
        let mut padded = Vec::with_capacity(col_count);
        for c in 0..col_count {
            let cell = row.get(c).map(|s| s.trim()).unwrap_or("");
            padded.push(cell);
        }
        out.push(format!("| {} |", padded.join(" | ")));
        if r_idx == 0 {
            let sep = vec!["---"; col_count].join(" | ");
            out.push(format!("| {sep} |"));
        }
    }
    out.join("\n")
}

fn collapse_excess_blank_lines(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut blank_run = 0usize;
    for line in input.lines() {
        if line.trim().is_empty() {
            blank_run += 1;
            if blank_run <= 1 {
                out.push('\n');
            }
        } else {
            blank_run = 0;
            if !out.is_empty() && !out.ends_with('\n') {
                out.push('\n');
            }
            out.push_str(line.trim_end());
            out.push('\n');
        }
    }
    out.trim().to_string()
}

pub fn count_page_markers(markdown: &str) -> usize {
    markdown
        .lines()
        .filter(|l| {
            let t = l.trim();
            t.starts_with("<!-- page:") && t.ends_with("-->")
        })
        .count()
}
