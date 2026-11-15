use crate::bookmarks::{remap_tree, write_outlines};
use crate::imaging::{prepare_page_for_pdf, PreparedImage};
use crate::models::{
    BookmarkNode, Image2PdfConfig, PageBackground, PageDraft, PageLayoutPolicy, PdfBuildResult,
};
use knit_core::{
    atomic_write_file, ensure_disk_space, CancellationToken, JobProgress, JobReporter,
    JobReporterExt, KnitError, Result,
};
use lopdf::{dictionary, Document, Object, Stream};
use rayon::prelude::*;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

pub const ISO_MIN_PT: f32 = 3.0;
pub const ISO_MAX_PT: f32 = 14400.0;
const A4_WIDTH_PT: f32 = 595.28;
const A4_HEIGHT_PT: f32 = 841.89;
const LETTER_WIDTH_PT: f32 = 612.0;
const LETTER_HEIGHT_PT: f32 = 792.0;

struct RenderedPageData {
    image: PreparedImage,
    duration_ms: Option<u32>,
}

/// Dựng 1 hoặc nhiều file PDF (khi bật `max_mb`) từ danh sách `PageDraft` và `BookmarkNode`.
pub fn build_pdf_from_drafts(
    drafts: &[PageDraft],
    bookmarks: &[BookmarkNode],
    config: &Image2PdfConfig,
    cancel: &CancellationToken,
    reporter: &dyn JobReporter,
) -> Result<PdfBuildResult> {
    if drafts.is_empty() {
        return Err(KnitError::InvalidInput("Khong co trang nao de tao PDF".into()));
    }
    if cancel.is_cancelled() {
        return Err(KnitError::Cancelled);
    }

    reporter.info("Dang xu ly anh va chuan bi trang PDF");
    let total = drafts.len();
    let completed = AtomicUsize::new(0);
    let report_lock = Mutex::new(());

    let prepared_res: Vec<Result<RenderedPageData>> = drafts
        .par_iter()
        .map(|draft| {
            if cancel.is_cancelled() {
                return Err(KnitError::Cancelled);
            }
            let image = prepare_page_for_pdf(
                draft,
                config.jpeg_quality,
                config.lossless_passthrough,
            )?;
            let done = completed.fetch_add(1, Ordering::SeqCst) + 1;
            let guard = if done == total {
                report_lock.lock().ok()
            } else {
                report_lock.try_lock().ok()
            };
            if let Some(_g) = guard {
                reporter.on_progress(JobProgress {
                    phase: "render".into(),
                    done: done as u64,
                    total: total as u64,
                    bytes_done: 0,
                    bytes_total: 0,
                    current_item: draft.label.clone(),
                });
            }
            Ok(RenderedPageData {
                image,
                duration_ms: draft.duration_ms,
            })
        })
        .collect();

    let mut prepared = Vec::with_capacity(total);
    let mut passthrough_pages = 0usize;
    for r in prepared_res {
        let item = r?;
        if matches!(item.image, PreparedImage::JpegStream { passthrough: true, .. }) {
            passthrough_pages += 1;
        }
        prepared.push(item);
    }

    if cancel.is_cancelled() {
        return Err(KnitError::Cancelled);
    }

    let est_bytes: u64 = prepared
        .iter()
        .map(|p| match &p.image {
            PreparedImage::JpegStream { bytes, .. } => bytes.len() as u64,
            PreparedImage::FlateRgbStream { zlib_bytes, .. } => zlib_bytes.len() as u64,
        })
        .sum::<u64>()
        + 65536;

    if let Some(parent) = config.output_path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
            ensure_disk_space(parent, est_bytes.saturating_mul(2))?;
        }
    }

    let max_bytes = config
        .max_mb
        .filter(|&mb| mb > 0.0)
        .map(|mb| (mb * 1024.0 * 1024.0) as usize);
    let max_pages_per_file = config.max_pages_per_file.filter(|&n| n > 0);

    let mut output_files = Vec::new();
    let mut total_bytes = 0u64;

    if max_bytes.is_some() || max_pages_per_file.is_some() {
        reporter.info("Dang dong goi va tach PDF theo gioi han da chon");
        let chunks = partition_pages(&prepared, max_bytes, max_pages_per_file);
        let multi = chunks.len() > 1;
        for (part_idx, (start, end)) in chunks.into_iter().enumerate() {
            if cancel.is_cancelled() {
                return Err(KnitError::Cancelled);
            }
            let out_path = if multi {
                part_output_path(&config.output_path, part_idx + 1)
            } else {
                config.output_path.clone()
            };
            let part_bookmarks = remap_tree(bookmarks, start, end);
            let pdf_bytes = assemble_pdf_bytes(&prepared[start..end], &part_bookmarks, config.layout)?;
            total_bytes += pdf_bytes.len() as u64;
            atomic_write_file(&out_path, |f| Ok(f.write_all(&pdf_bytes)?))?;
            output_files.push(out_path);
        }
    } else {
        reporter.info("Dang dong goi file PDF");
        let pdf_bytes = assemble_pdf_bytes(&prepared, bookmarks, config.layout)?;
        total_bytes = pdf_bytes.len() as u64;
        atomic_write_file(&config.output_path, |f| Ok(f.write_all(&pdf_bytes)?))?;
        output_files.push(config.output_path.clone());
    }

    reporter.on_progress(JobProgress {
        phase: "done".into(),
        done: total as u64,
        total: total as u64,
        bytes_done: total_bytes,
        bytes_total: total_bytes,
        current_item: "Hoan tat tao PDF".into(),
    });
    Ok(PdfBuildResult {
        output_files,
        total_pages: total,
        total_bytes,
        passthrough_pages,
    })
}

fn partition_pages(
    pages: &[RenderedPageData],
    max_bytes: Option<usize>,
    max_pages_per_file: Option<usize>,
) -> Vec<(usize, usize)> {
    const OVERHEAD_PER_PAGE: usize = 700;
    const BASE_OVERHEAD: usize = 2048;

    let mut ranges = Vec::new();
    let mut start = 0usize;
    let mut acc = BASE_OVERHEAD;

    for (idx, p) in pages.iter().enumerate() {
        let stream_len = match &p.image {
            PreparedImage::JpegStream { bytes, .. } => bytes.len(),
            PreparedImage::FlateRgbStream { zlib_bytes, .. } => zlib_bytes.len(),
        };
        let page_cost = stream_len + OVERHEAD_PER_PAGE;
        let current_count = idx - start;
        let exceeds_pages = max_pages_per_file.is_some_and(|limit| current_count >= limit);
        let exceeds_bytes = max_bytes.is_some_and(|limit| idx > start && acc + page_cost > limit);

        if exceeds_pages || exceeds_bytes {
            ranges.push((start, idx));
            start = idx;
            acc = BASE_OVERHEAD + page_cost;
        } else {
            acc += page_cost;
        }
    }

    if start < pages.len() {
        ranges.push((start, pages.len()));
    }
    ranges
}

fn assemble_pdf_bytes(
    pages: &[RenderedPageData],
    bookmarks: &[BookmarkNode],
    layout: PageLayoutPolicy,
) -> Result<Vec<u8>> {
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let mut page_ids = Vec::with_capacity(pages.len());

    for item in pages {
        let (img_dict, raw_stream, img_w, img_h) = match &item.image {
            PreparedImage::JpegStream {
                bytes,
                width,
                height,
                ..
            } => {
                let d = dictionary! {
                    "Type" => "XObject",
                    "Subtype" => "Image",
                    "Width" => *width as i64,
                    "Height" => *height as i64,
                    "ColorSpace" => "DeviceRGB",
                    "BitsPerComponent" => 8,
                    "Filter" => "DCTDecode",
                    "Length" => bytes.len() as i64,
                };
                (d, bytes.clone(), *width, *height)
            }
            PreparedImage::FlateRgbStream {
                zlib_bytes,
                width,
                height,
            } => {
                let d = dictionary! {
                    "Type" => "XObject",
                    "Subtype" => "Image",
                    "Width" => *width as i64,
                    "Height" => *height as i64,
                    "ColorSpace" => "DeviceRGB",
                    "BitsPerComponent" => 8,
                    "Filter" => "FlateDecode",
                    "Length" => zlib_bytes.len() as i64,
                };
                (d, zlib_bytes.clone(), *width, *height)
            }
        };

        let img_id = doc.add_object(Stream::new(img_dict, raw_stream));
        let (page_w, page_h, draw_x, draw_y, draw_w, draw_h) = compute_page_box(img_w, img_h, layout);

        let bg_cmd = page_background_command(layout, page_w, page_h);
        let content_str = format!(
            "{bg_cmd}q {draw_w:.4} 0 0 {draw_h:.4} {draw_x:.4} {draw_y:.4} cm /Im0 Do Q"
        );
        let content_id = doc.add_object(Stream::new(dictionary! {}, content_str.into_bytes()));
        let resources_id = doc.add_object(dictionary! {
            "XObject" => dictionary! { "Im0" => img_id }
        });

        let mut page_dict = dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.0.into(), 0.0.into(), page_w.into(), page_h.into()],
            "Resources" => resources_id,
            "Contents" => content_id,
        };
        if let Some(ms) = item.duration_ms {
            page_dict.set("Dur", Object::Real((ms as f32) / 1000.0));
        }

        let page_id = doc.add_object(page_dict);
        page_ids.push(page_id);
    }

    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => page_ids.iter().copied().map(Object::Reference).collect::<Vec<_>>(),
            "Count" => page_ids.len() as i64,
        }),
    );

    let catalog_id = doc.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    doc.trailer.set("Root", catalog_id);

    write_outlines(&mut doc, &page_ids, bookmarks);

    let mut out = Vec::new();
    doc.save_to(&mut out)
        .map_err(|e| KnitError::InvalidInput(format!("Loi ghi PDF: {e}")))?;
    Ok(out)
}

/// Tính `(page_w, page_h, draw_x, draw_y, draw_w, draw_h)` theo đơn vị point (1/72 inch),
/// tuân thủ chặt giới hạn `[3.0, 14400.0]` pt của chuẩn ISO 32000-1.
pub fn compute_page_box(
    img_w: u32,
    img_h: u32,
    layout: PageLayoutPolicy,
) -> (f32, f32, f32, f32, f32, f32) {
    let iw = (img_w.max(1)) as f32;
    let ih = (img_h.max(1)) as f32;

    match layout {
        PageLayoutPolicy::OriginalSize { dpi } => {
            let eff_dpi = if dpi > 1.0 { dpi } else { 72.0 };
            let mut w = iw * 72.0 / eff_dpi;
            let mut h = ih * 72.0 / eff_dpi;

            let max_dim = w.max(h);
            if max_dim > ISO_MAX_PT {
                let s = ISO_MAX_PT / max_dim;
                w *= s;
                h *= s;
            }
            let min_dim = w.min(h);
            if min_dim < ISO_MIN_PT {
                let s = (ISO_MIN_PT / min_dim).min(ISO_MAX_PT / w.max(h));
                w *= s;
                h *= s;
            }
            w = w.clamp(ISO_MIN_PT, ISO_MAX_PT);
            h = h.clamp(ISO_MIN_PT, ISO_MAX_PT);
            (w, h, 0.0, 0.0, w, h)
        }
        PageLayoutPolicy::FitA4 { margin_pt, .. } => {
            fit_page_box(iw, ih, A4_WIDTH_PT, A4_HEIGHT_PT, margin_pt)
        }
        PageLayoutPolicy::FitLetter { margin_pt, .. } => {
            fit_page_box(iw, ih, LETTER_WIDTH_PT, LETTER_HEIGHT_PT, margin_pt)
        }
    }
}

fn page_background_command(layout: PageLayoutPolicy, page_w: f32, page_h: f32) -> String {
    let background = match layout {
        PageLayoutPolicy::FitA4 { background, .. }
        | PageLayoutPolicy::FitLetter { background, .. } => background,
        PageLayoutPolicy::OriginalSize { .. } => PageBackground::Transparent,
    };
    match background {
        PageBackground::Transparent => String::new(),
        PageBackground::White => format!("q 1 1 1 rg 0 0 {page_w:.4} {page_h:.4} re f Q "),
        PageBackground::Black => format!("q 0 0 0 rg 0 0 {page_w:.4} {page_h:.4} re f Q "),
        PageBackground::Custom { r, g, b } => format!(
            "q {:.4} {:.4} {:.4} rg 0 0 {page_w:.4} {page_h:.4} re f Q ",
            f32::from(r) / 255.0,
            f32::from(g) / 255.0,
            f32::from(b) / 255.0
        ),
    }
}

fn fit_page_box(iw: f32, ih: f32, page_w: f32, page_h: f32, margin_pt: f32) -> (f32, f32, f32, f32, f32, f32) {
    let m = margin_pt.clamp(0.0, (page_w.min(page_h) * 0.4).max(0.0));
    let avail_w = (page_w - 2.0 * m).max(ISO_MIN_PT);
    let avail_h = (page_h - 2.0 * m).max(ISO_MIN_PT);
    let scale = (avail_w / iw).min(avail_h / ih);
    let draw_w = iw * scale;
    let draw_h = ih * scale;
    let draw_x = (page_w - draw_w) * 0.5;
    let draw_y = (page_h - draw_h) * 0.5;
    (page_w, page_h, draw_x, draw_y, draw_w, draw_h)
}

fn part_output_path(base: &Path, part_1based: usize) -> PathBuf {
    let parent = base.parent().unwrap_or_else(|| Path::new("."));
    let stem = base
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "output".to_string());
    let ext = base
        .extension()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "pdf".to_string());
    parent.join(format!("{stem}_part{part_1based:02}.{ext}"))
}
