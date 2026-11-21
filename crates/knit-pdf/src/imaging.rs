use crate::models::{
    AnimatedImagePolicy, AnnotationLayer, BookmarkNode, CropRect, ImageScanResult, PageDraft,
    PageSource, PdfExportMode,
};
use ab_glyph::{Font, FontArc, PxScale, ScaleFont};
use flate2::write::ZlibEncoder;
use flate2::Compression;
use image::codecs::gif::GifDecoder;
use image::codecs::jpeg::JpegEncoder;
use image::codecs::webp::WebPDecoder;
use image::metadata::Orientation;
use image::{AnimationDecoder, DynamicImage, ImageDecoder, ImageFormat, ImageReader, Rgba, RgbaImage};
use imageproc::drawing::{draw_filled_circle_mut, draw_line_segment_mut, draw_text_mut};
use knit_core::{
    natural_cmp, JobLogLevel, JobProgress, JobReporter, JobReporterExt, KnitError, NoopReporter,
    Result,
};
use rayon::prelude::*;
use std::collections::HashSet;
use std::fs::File;
use std::io::{BufReader, Cursor, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use uuid::Uuid;

pub const SUPPORTED_IMAGE_EXTS: &[&str] = &[
    "jpg", "jpeg", "jfif", "png", "webp", "avif", "gif", "bmp", "tiff", "tif", "svg",
];

pub fn is_supported_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|s| SUPPORTED_IMAGE_EXTS.contains(&s.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PdfColorSpace {
    DeviceRgb,
    DeviceGray,
}

#[derive(Debug)]
pub enum PreparedImage {
    JpegStream {
        bytes: Vec<u8>,
        width: u32,
        height: u32,
        color_space: PdfColorSpace,
        passthrough: bool,
    },
    FlateStream {
        zlib_bytes: Vec<u8>,
        width: u32,
        height: u32,
        color_space: PdfColorSpace,
        png_predictor_colors: Option<u8>,
        passthrough: bool,
    },
}

fn default_font() -> Result<&'static FontArc> {
    static FONT: OnceLock<FontArc> = OnceLock::new();
    if let Some(f) = FONT.get() {
        return Ok(f);
    }
    for data in typst_assets::fonts() {
        if let Ok(font) = FontArc::try_from_slice(data) {
            let _ = FONT.set(font);
            break;
        }
    }
    FONT.get()
        .ok_or_else(|| KnitError::InvalidInput("Khong tim thay font UTF-8 mac dinh".into()))
}

/// Đọc riêng các box header ISOBMFF (`ftyp`, `meta`, `moov`) của file AVIF,
/// bỏ qua `mdat` bằng `seek` để không nạp hàng chục MB pixel nén vào RAM khi scan.
fn read_avif_header_boxes(path: &Path) -> Result<Option<Vec<u8>>> {
    const MAX_HEADER_BOX_BYTES: u64 = 16 * 1024 * 1024;
    let mut file = BufReader::new(File::open(path)?);
    let mut header_buf = Vec::new();
    let mut has_ftyp = false;
    let mut has_meta_or_moov = false;

    loop {
        let mut hdr8 = [0u8; 8];
        match file.read_exact(&mut hdr8) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(e.into()),
        }

        let size32 = u32::from_be_bytes([hdr8[0], hdr8[1], hdr8[2], hdr8[3]]) as u64;
        let box_type = [hdr8[4], hdr8[5], hdr8[6], hdr8[7]];

        let (box_size, header_len, ext_hdr) = if size32 == 1 {
            let mut size64_bytes = [0u8; 8];
            if file.read_exact(&mut size64_bytes).is_err() {
                return Ok(None);
            }
            let size64 = u64::from_be_bytes(size64_bytes);
            if size64 < 16 {
                return Ok(None);
            }
            (size64, 16u64, Some(size64_bytes))
        } else if size32 == 0 {
            // Box kéo dài tới EOF: fallback đọc nguyên file nếu cần
            return Ok(None);
        } else {
            if size32 < 8 {
                return Ok(None);
            }
            (size32, 8u64, None)
        };

        let payload_len = box_size - header_len;
        let is_header_box = matches!(&box_type, b"ftyp" | b"meta" | b"moov");

        if is_header_box {
            if payload_len > MAX_HEADER_BOX_BYTES {
                return Ok(None);
            }
            if &box_type == b"ftyp" {
                has_ftyp = true;
            } else {
                has_meta_or_moov = true;
            }
            header_buf.extend_from_slice(&hdr8);
            if let Some(ext) = ext_hdr {
                header_buf.extend_from_slice(&ext);
            }
            let start = header_buf.len();
            header_buf.resize(start + payload_len as usize, 0);
            if file.read_exact(&mut header_buf[start..]).is_err() {
                return Ok(None);
            }
            if has_ftyp && has_meta_or_moov {
                // Phần lớn AVIF chỉ có ftyp + meta trước mdat; nếu không phải sequence có thể dừng sớm
                // trừ trường hợp ftyp báo sequence (avis) cần thêm moov.
                if &box_type != b"ftyp" && !header_buf.windows(4).any(|w| w == b"avis") {
                    break;
                }
            }
        } else {
            let Ok(offset) = i64::try_from(payload_len) else {
                return Ok(None);
            };
            if file.seek(SeekFrom::Current(offset)).is_err() {
                return Ok(None);
            }
        }
    }

    if has_ftyp && has_meta_or_moov {
        Ok(Some(header_buf))
    } else {
        Ok(None)
    }
}

fn read_exif_u16(buf: &[u8], off: usize, little: bool) -> Option<u16> {
    let bytes: [u8; 2] = buf.get(off..off + 2)?.try_into().ok()?;
    Some(if little {
        u16::from_le_bytes(bytes)
    } else {
        u16::from_be_bytes(bytes)
    })
}

fn read_exif_u32(buf: &[u8], off: usize, little: bool) -> Option<u32> {
    let bytes: [u8; 4] = buf.get(off..off + 4)?.try_into().ok()?;
    Some(if little {
        u32::from_le_bytes(bytes)
    } else {
        u32::from_be_bytes(bytes)
    })
}

fn parse_exif_orientation(payload: &[u8]) -> Option<u16> {
    let tiff = payload.strip_prefix(b"Exif\0\0")?;
    let little = match tiff.get(0..2)? {
        b"II" => true,
        b"MM" => false,
        _ => return None,
    };
    if read_exif_u16(tiff, 2, little)? != 0x002A {
        return None;
    }
    let ifd0 = read_exif_u32(tiff, 4, little)? as usize;
    let count = read_exif_u16(tiff, ifd0, little)?.min(128) as usize;
    for idx in 0..count {
        let entry = ifd0 + 2 + idx * 12;
        if entry + 12 > tiff.len() {
            break;
        }
        let tag = read_exif_u16(tiff, entry, little)?;
        if tag == 0x0112 {
            let field_type = read_exif_u16(tiff, entry + 2, little)?;
            let val_count = read_exif_u32(tiff, entry + 4, little)?;
            if field_type == 3 && val_count >= 1 {
                return read_exif_u16(tiff, entry + 8, little);
            }
        }
    }
    None
}

fn parse_exif_swaps_axes(payload: &[u8]) -> Option<bool> {
    parse_exif_orientation(payload).map(|orient| matches!(orient, 5..=8))
}

/// Đọc trực tiếp kích thước SOF và EXIF orientation từ phần header JPEG
/// thay vì đọc toàn bộ file vào RAM như `image::codecs::jpeg::JpegDecoder::new`.
fn read_jpeg_header_dimensions(path: &Path) -> Result<Option<(u32, u32)>> {
    let mut file = BufReader::new(File::open(path)?);
    let mut soi = [0u8; 2];
    if file.read_exact(&mut soi).is_err() || soi != [0xFF, 0xD8] {
        return Ok(None);
    }

    let mut swap_axes: Option<bool> = None;
    let mut one = [0u8; 1];

    loop {
        if file.read_exact(&mut one).is_err() || one[0] != 0xFF {
            return Ok(None);
        }
        let mut marker = one[0];
        while marker == 0xFF {
            if file.read_exact(&mut one).is_err() {
                return Ok(None);
            }
            marker = one[0];
        }

        if matches!(marker, 0x00 | 0xD9 | 0xDA) {
            return Ok(None);
        }
        if marker == 0xD8 || marker == 0x01 || (0xD0..=0xD7).contains(&marker) {
            continue;
        }

        let mut len_bytes = [0u8; 2];
        if file.read_exact(&mut len_bytes).is_err() {
            return Ok(None);
        }
        let seg_len = u16::from_be_bytes(len_bytes) as usize;
        if seg_len < 2 {
            return Ok(None);
        }
        let payload_len = seg_len - 2;

        if marker == 0xE1 && swap_axes.is_none() && (14..=256 * 1024).contains(&payload_len) {
            let mut payload = vec![0u8; payload_len];
            if file.read_exact(&mut payload).is_err() {
                return Ok(None);
            }
            swap_axes = parse_exif_swaps_axes(&payload);
            continue;
        }

        if matches!(marker, 0xC0..=0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF)
            && payload_len >= 5
        {
            let mut sof = [0u8; 5];
            if file.read_exact(&mut sof).is_err() {
                return Ok(None);
            }
            let h = u16::from_be_bytes([sof[1], sof[2]]) as u32;
            let w = u16::from_be_bytes([sof[3], sof[4]]) as u32;
            if w > 0 && h > 0 {
                return Ok(Some(if swap_axes.unwrap_or(false) {
                    (h, w)
                } else {
                    (w, h)
                }));
            }
            return Ok(None);
        }

        if file.seek(SeekFrom::Current(payload_len as i64)).is_err() {
            return Ok(None);
        }
    }
}

fn shared_svg_fontdb() -> &'static Arc<usvg::fontdb::Database> {
    static DB: OnceLock<Arc<usvg::fontdb::Database>> = OnceLock::new();
    DB.get_or_init(|| {
        let mut db = usvg::fontdb::Database::new();
        for data in typst_assets::fonts() {
            db.load_font_data(data.to_vec());
        }
        db.load_system_fonts();
        Arc::new(db)
    })
}

fn parse_svg_tree(bytes: &[u8], base_dir: Option<&Path>) -> Result<usvg::Tree> {
    let mut opt = usvg::Options::default();
    opt.fontdb = Arc::clone(shared_svg_fontdb());
    opt.resources_dir = base_dir.map(|p| p.to_path_buf());
    usvg::Tree::from_data(bytes, &opt)
        .map_err(|e| KnitError::InvalidInput(format!("SVG khong hop le: {e}")))
}

fn compute_svg_raster_size(svg_size: usvg::Size, target_max_side: Option<u32>) -> (u32, u32, f32, f32) {
    let w = svg_size.width().max(1.0);
    let h = svg_size.height().max(1.0);
    let max_dim = w.max(h);
    let scale = if let Some(max_s) = target_max_side {
        let target = max_s.max(1) as f32;
        (target / max_dim).min(4096.0 / max_dim)
    } else if max_dim < 128.0 {
        512.0 / max_dim
    } else if max_dim > 4096.0 {
        4096.0 / max_dim
    } else {
        1.0
    };
    let pw = (w * scale).round().clamp(1.0, 4096.0) as u32;
    let ph = (h * scale).round().clamp(1.0, 4096.0) as u32;
    (pw, ph, pw as f32 / w, ph as f32 / h)
}

fn inspect_svg_dimensions(path: &Path) -> Result<(u32, u32)> {
    let bytes = std::fs::read(path)?;
    let tree = parse_svg_tree(&bytes, path.parent())?;
    let (pw, ph, _, _) = compute_svg_raster_size(tree.size(), None);
    Ok((pw, ph))
}

fn decode_svg_from_bytes(
    bytes: &[u8],
    path: &Path,
    target_max_side: Option<u32>,
) -> Result<DynamicImage> {
    let tree = parse_svg_tree(bytes, path.parent())?;
    let (pw, ph, sx, sy) = compute_svg_raster_size(tree.size(), target_max_side);
    let mut pixmap = tiny_skia::Pixmap::new(pw, ph).ok_or_else(|| {
        KnitError::InvalidInput(format!("Khong the tao buffer raster cho SVG {}", path.display()))
    })?;
    resvg::render(&tree, tiny_skia::Transform::from_scale(sx, sy), &mut pixmap.as_mut());
    let src = pixmap.data();
    let mut straight = vec![0u8; src.len()];
    for (dst_px, src_px) in straight.chunks_exact_mut(4).zip(src.chunks_exact(4)) {
        let a = src_px[3];
        if a == 0 {
            dst_px.copy_from_slice(&[0, 0, 0, 0]);
        } else if a == 255 {
            dst_px.copy_from_slice(src_px);
        } else {
            let af = a as f32 / 255.0;
            dst_px[0] = (src_px[0] as f32 / af).round().clamp(0.0, 255.0) as u8;
            dst_px[1] = (src_px[1] as f32 / af).round().clamp(0.0, 255.0) as u8;
            dst_px[2] = (src_px[2] as f32 / af).round().clamp(0.0, 255.0) as u8;
            dst_px[3] = a;
        }
    }
    let rgba = RgbaImage::from_raw(pw, ph, straight).ok_or_else(|| {
        KnitError::InvalidInput(format!("SVG buffer khong khop {}", path.display()))
    })?;
    Ok(DynamicImage::ImageRgba8(rgba))
}

pub fn inspect_image_dimensions(path: &Path) -> Result<(u32, u32)> {
    let ext = ext_lower(path);
    if ext == "svg" {
        return inspect_svg_dimensions(path);
    }
    if matches!(ext.as_str(), "jpg" | "jpeg" | "jfif") {
        if let Some(dims) = read_jpeg_header_dimensions(path)? {
            return Ok(dims);
        }
    } else if ext == "avif" {
        if let Ok(Some(header_bytes)) = read_avif_header_boxes(path) {
            if let Ok(info) = oxideav_avif::info(&header_bytes) {
                return Ok((info.width, info.height));
            }
        }
        let bytes = std::fs::read(path)?;
        let info = oxideav_avif::info(&bytes)
            .map_err(|e| KnitError::InvalidInput(format!("AVIF loi ({}): {e}", path.display())))?;
        return Ok((info.width, info.height));
    }

    let mut reader = ImageReader::open(path)?;
    reader = reader
        .with_guessed_format()
        .map_err(|e| KnitError::InvalidInput(format!("Khong nhan dang duoc anh {}: {e}", path.display())))?;
    let mut decoder = reader
        .into_decoder()
        .map_err(|e| KnitError::InvalidInput(format!("Loi decode header anh {}: {e}", path.display())))?;
    let (w, h) = decoder.dimensions();
    let orient = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    match orient {
        Orientation::Rotate90
        | Orientation::Rotate270
        | Orientation::Rotate90FlipH
        | Orientation::Rotate270FlipH => Ok((h, w)),
        _ => Ok((w, h)),
    }
}

fn scan_files_parallel_drafts(
    paths: &[PathBuf],
    animated_policy: AnimatedImagePolicy,
    reporter: &dyn JobReporter,
) -> (Vec<Vec<PageDraft>>, Vec<String>) {
    let total = paths.len() as u64;
    let done_counter = AtomicUsize::new(0);

    let results: Vec<(Option<Vec<PageDraft>>, Option<String>)> = paths
        .par_iter()
        .map(|path| {
            let outcome = match build_image_drafts(path, animated_policy) {
                Ok(drafts) => (Some(drafts), None),
                Err(err) => {
                    let msg = format!("Skipping invalid image {}: {err}", path.display());
                    reporter.on_log(JobLogLevel::Warn, &msg);
                    (None, Some(msg))
                }
            };
            let done = done_counter.fetch_add(1, Ordering::Relaxed) + 1;
            let name = path
                .file_name()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            if outcome.0.is_some() {
                reporter.detailed(format!("Scanned image ({done}/{total}): {name}"));
            }
            reporter.on_progress(JobProgress {
                phase: "scan_images".to_string(),
                done: done as u64,
                total,
                bytes_done: 0,
                bytes_total: 0,
                current_item: name,
            });
            outcome
        })
        .collect();

    let mut chunks = Vec::with_capacity(results.len());
    let mut warnings = Vec::new();
    for (drafts, warn) in results {
        if let Some(w) = warn {
            warnings.push(w);
        }
        chunks.push(drafts.unwrap_or_default());
    }
    (chunks, warnings)
}

pub fn scan_image_files(
    paths: &[PathBuf],
    animated_policy: AnimatedImagePolicy,
) -> Result<ImageScanResult> {
    scan_image_files_with_reporter(paths, animated_policy, &NoopReporter)
}

pub fn scan_image_files_with_reporter(
    paths: &[PathBuf],
    animated_policy: AnimatedImagePolicy,
    reporter: &dyn JobReporter,
) -> Result<ImageScanResult> {
    let mut sorted = paths.to_vec();
    sorted.sort_by(|a, b| natural_cmp(&a.to_string_lossy(), &b.to_string_lossy()));

    let valid_paths: Vec<PathBuf> = sorted
        .into_iter()
        .filter(|path| path.is_file() && is_supported_image(path))
        .collect();

    let (chunks, warnings) = scan_files_parallel_drafts(&valid_paths, animated_policy, reporter);
    let pages = chunks.into_iter().flatten().collect();

    Ok(ImageScanResult {
        pages,
        bookmarks: Vec::new(),
        warnings,
    })
}

struct BookmarkBlueprint {
    title: String,
    start_file_idx: usize,
    end_file_idx: usize,
    is_cover: bool,
    children: Vec<BookmarkBlueprint>,
}

pub fn scan_image_folder(
    root: &Path,
    animated_policy: AnimatedImagePolicy,
) -> Result<ImageScanResult> {
    scan_image_folder_with_reporter(root, animated_policy, &NoopReporter)
}

pub fn scan_image_folder_with_reporter(
    root: &Path,
    animated_policy: AnimatedImagePolicy,
    reporter: &dyn JobReporter,
) -> Result<ImageScanResult> {
    if !root.is_dir() {
        return Err(KnitError::NotFound(root.display().to_string()));
    }

    let mut files_plan: Vec<PathBuf> = Vec::new();
    let mut bookmark_blueprints: Vec<BookmarkBlueprint> = Vec::new();
    let mut seen_covers: HashSet<PathBuf> = HashSet::new();

    // Cover ở cấp root nếu có (cover.jpg/png/webp...)
    let mut root_files = collect_dir_images(root)?;
    if let Some(cover_idx) = root_files.iter().position(|p| is_cover_name(p)) {
        let cover = root_files.remove(cover_idx);
        seen_covers.insert(cover.clone());
        let start_file_idx = files_plan.len();
        files_plan.push(cover);
        bookmark_blueprints.push(BookmarkBlueprint {
            title: "Cover".to_string(),
            start_file_idx,
            end_file_idx: files_plan.len(),
            is_cover: true,
            children: Vec::new(),
        });
    }

    files_plan.extend(root_files);

    let subdirs = collect_sorted_subdirs(root)?;
    for sub in subdirs {
        if let Some(bm) = collect_subtree_plan(&sub, &mut files_plan, &mut seen_covers)? {
            bookmark_blueprints.push(bm);
        }
    }

    // Kiểm tra kích thước ảnh & frame song song qua rayon nhưng vẫn giữ nguyên thứ tự cây thư mục
    let (chunks, warnings) = scan_files_parallel_drafts(&files_plan, animated_policy, reporter);

    let mut file_to_page_offset = Vec::with_capacity(chunks.len() + 1);
    let mut total_pages = 0usize;
    for chunk in &chunks {
        file_to_page_offset.push(total_pages);
        total_pages += chunk.len();
    }
    file_to_page_offset.push(total_pages);

    let mut pages = Vec::with_capacity(total_pages);
    for chunk in chunks {
        pages.extend(chunk);
    }

    let bookmarks = materialize_bookmarks(&bookmark_blueprints, &file_to_page_offset);

    Ok(ImageScanResult {
        pages,
        bookmarks,
        warnings,
    })
}

fn collect_subtree_plan(
    dir: &Path,
    files_plan: &mut Vec<PathBuf>,
    seen: &mut HashSet<PathBuf>,
) -> Result<Option<BookmarkBlueprint>> {
    let start_file_idx = files_plan.len();
    let mut files = collect_dir_images(dir)?;
    if let Some(cover_idx) = files.iter().position(|p| is_cover_name(p)) {
        let cover = files.remove(cover_idx);
        if seen.insert(cover.clone()) {
            files_plan.push(cover);
        }
    }
    for f in files {
        if seen.insert(f.clone()) {
            files_plan.push(f);
        }
    }

    let mut children = Vec::new();
    for sub in collect_sorted_subdirs(dir)? {
        if let Some(child_bm) = collect_subtree_plan(&sub, files_plan, seen)? {
            children.push(child_bm);
        }
    }

    let end_file_idx = files_plan.len();
    if end_file_idx == start_file_idx && children.is_empty() {
        return Ok(None);
    }

    let title = dir
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Section".to_string());
    Ok(Some(BookmarkBlueprint {
        title,
        start_file_idx,
        end_file_idx,
        is_cover: false,
        children,
    }))
}

fn materialize_bookmarks(
    blueprints: &[BookmarkBlueprint],
    file_to_page_offset: &[usize],
) -> Vec<BookmarkNode> {
    let mut out = Vec::with_capacity(blueprints.len());
    for bp in blueprints {
        let start_page = file_to_page_offset[bp.start_file_idx];
        let end_page = file_to_page_offset[bp.end_file_idx];
        let children = materialize_bookmarks(&bp.children, file_to_page_offset);
        if bp.is_cover && end_page <= start_page {
            continue;
        }
        if !bp.is_cover && end_page == start_page && children.is_empty() {
            continue;
        }
        out.push(BookmarkNode {
            title: bp.title.clone(),
            target_page_index: start_page,
            children,
        });
    }
    out
}

fn collect_dir_images(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() && is_supported_image(&path) {
            files.push(path);
        }
    }
    files.sort_by(|a, b| {
        let an = a.file_name().unwrap_or_default().to_string_lossy();
        let bn = b.file_name().unwrap_or_default().to_string_lossy();
        natural_cmp(&an, &bn)
    });
    Ok(files)
}

fn collect_sorted_subdirs(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut dirs = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with('.') {
                dirs.push(path);
            }
        }
    }
    dirs.sort_by(|a, b| {
        let an = a.file_name().unwrap_or_default().to_string_lossy();
        let bn = b.file_name().unwrap_or_default().to_string_lossy();
        natural_cmp(&an, &bn)
    });
    Ok(dirs)
}

fn is_cover_name(path: &Path) -> bool {
    path.file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.eq_ignore_ascii_case("cover"))
        .unwrap_or(false)
}

fn build_image_drafts(
    path: &Path,
    animated_policy: AnimatedImagePolicy,
) -> Result<Vec<PageDraft>> {
    let mut out = Vec::new();
    let file_name = path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "image".to_string());
    let file_size_bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);

    if animated_policy == AnimatedImagePolicy::UnpackAllFrames {
        if let Some(frames) = probe_animation_frames(path)? {
            out.reserve(frames.len());
            for (idx, (w, h, dur_ms)) in frames.into_iter().enumerate() {
                out.push(PageDraft {
                    id: Uuid::new_v4().to_string(),
                    source: PageSource::AnimatedFrame {
                        path: path.to_path_buf(),
                        frame_index: idx,
                    },
                    rotation_deg: 0,
                    crop: None,
                    annotations: AnnotationLayer::default(),
                    duration_ms: Some(dur_ms.max(20)),
                    label: format!("{file_name} #{}", idx + 1),
                    width_px: w,
                    height_px: h,
                    file_size_bytes,
                });
            }
            return Ok(out);
        }
    }

    let (w, h) = inspect_image_dimensions(path)?;
    out.push(PageDraft {
        id: Uuid::new_v4().to_string(),
        source: PageSource::ImageFile {
            path: path.to_path_buf(),
        },
        rotation_deg: 0,
        crop: None,
        annotations: AnnotationLayer::default(),
        duration_ms: None,
        label: file_name,
        width_px: w,
        height_px: h,
        file_size_bytes,
    });
    Ok(out)
}

/// Trả về danh sách `(width, height, duration_ms)` nếu file là GIF/WebP động (>1 frame).
/// Duyệt từng frame thay vì `collect_frames()` để giải phóng ngay pixel buffer sau mỗi frame.
pub(crate) fn probe_animation_frames(path: &Path) -> Result<Option<Vec<(u32, u32, u32)>>> {
    let ext = ext_lower(path);
    match ext.as_str() {
        "gif" => {
            let file = BufReader::new(File::open(path)?);
            let decoder = GifDecoder::new(file)
                .map_err(|e| KnitError::InvalidInput(format!("GIF loi {}: {e}", path.display())))?;
            let mut frames_meta = Vec::new();
            for frame_res in decoder.into_frames() {
                let f = frame_res.map_err(|e| {
                    KnitError::InvalidInput(format!("Loi doc frames GIF {}: {e}", path.display()))
                })?;
                let (num, den) = f.delay().numer_denom_ms();
                let ms = num / den.max(1);
                let buf = f.into_buffer();
                frames_meta.push((buf.width(), buf.height(), ms.max(20)));
            }
            if frames_meta.len() <= 1 {
                return Ok(None);
            }
            Ok(Some(frames_meta))
        }
        "webp" => {
            let file = BufReader::new(File::open(path)?);
            let decoder = WebPDecoder::new(file)
                .map_err(|e| KnitError::InvalidInput(format!("WebP loi {}: {e}", path.display())))?;
            if !decoder.has_animation() {
                return Ok(None);
            }
            let mut frames_meta = Vec::new();
            for frame_res in decoder.into_frames() {
                let f = frame_res.map_err(|e| {
                    KnitError::InvalidInput(format!("Loi doc frames WebP {}: {e}", path.display()))
                })?;
                let (num, den) = f.delay().numer_denom_ms();
                let ms = num / den.max(1);
                let buf = f.into_buffer();
                frames_meta.push((buf.width(), buf.height(), ms.max(20)));
            }
            if frames_meta.len() <= 1 {
                return Ok(None);
            }
            Ok(Some(frames_meta))
        }
        _ => Ok(None),
    }
}

fn remap_bookmarks_by_index(
    nodes: &[BookmarkNode],
    old_to_new: &[usize],
    new_len: usize,
) -> Vec<BookmarkNode> {
    if new_len == 0 {
        return Vec::new();
    }
    let max_idx = new_len - 1;
    nodes
        .iter()
        .map(|n| {
            let mapped = old_to_new
                .get(n.target_page_index)
                .copied()
                .unwrap_or(n.target_page_index)
                .min(max_idx);
            BookmarkNode {
                title: n.title.clone(),
                target_page_index: mapped,
                children: remap_bookmarks_by_index(&n.children, old_to_new, new_len),
            }
        })
        .collect()
}

/// Đồng bộ danh sách `PageDraft` và `BookmarkNode` theo `AnimatedImagePolicy`:
/// - `UnpackAllFrames`: tách các `ImageFile` GIF/WebP động thành từng `AnimatedFrame`.
/// - `FirstFrameOnly` / `EmbedRichMedia`: gộp lại các chuỗi `AnimatedFrame` liền kề cùng file về 1 `ImageFile`.
pub fn expand_drafts_for_animated_policy(
    drafts: &[PageDraft],
    bookmarks: &[BookmarkNode],
    policy: AnimatedImagePolicy,
) -> Result<(Vec<PageDraft>, Vec<BookmarkNode>)> {
    let mut out = Vec::with_capacity(drafts.len());
    let mut old_to_new = vec![0usize; drafts.len()];

    if policy == AnimatedImagePolicy::UnpackAllFrames {
        for (old_idx, draft) in drafts.iter().enumerate() {
            old_to_new[old_idx] = out.len();
            if let PageSource::ImageFile { ref path } = draft.source {
                let ext = ext_lower(path);
                if (ext == "gif" || ext == "webp") && path.is_file() {
                    if let Some(frames) = probe_animation_frames(path)? {
                        let base_label = draft.label.clone();
                        for (f_idx, (w, h, dur_ms)) in frames.into_iter().enumerate() {
                            out.push(PageDraft {
                                id: if f_idx == 0 {
                                    draft.id.clone()
                                } else {
                                    Uuid::new_v4().to_string()
                                },
                                source: PageSource::AnimatedFrame {
                                    path: path.clone(),
                                    frame_index: f_idx,
                                },
                                rotation_deg: draft.rotation_deg,
                                crop: draft.crop,
                                annotations: draft.annotations.clone(),
                                duration_ms: Some(dur_ms.max(20)),
                                label: format!("{base_label} #{}", f_idx + 1),
                                width_px: w,
                                height_px: h,
                                file_size_bytes: draft.file_size_bytes,
                            });
                        }
                        continue;
                    }
                }
            }
            out.push(draft.clone());
        }
    } else {
        let mut i = 0usize;
        while i < drafts.len() {
            let draft = &drafts[i];
            if let PageSource::AnimatedFrame { ref path, .. } = draft.source {
                let new_idx = out.len();
                let mut j = i;
                while j < drafts.len() {
                    if let PageSource::AnimatedFrame { path: ref p2, .. } = drafts[j].source {
                        if p2 == path {
                            old_to_new[j] = new_idx;
                            j += 1;
                            continue;
                        }
                    }
                    break;
                }
                let file_name = path
                    .file_name()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| draft.label.clone());
                out.push(PageDraft {
                    id: draft.id.clone(),
                    source: PageSource::ImageFile { path: path.clone() },
                    rotation_deg: draft.rotation_deg,
                    crop: draft.crop,
                    annotations: draft.annotations.clone(),
                    duration_ms: None,
                    label: file_name,
                    width_px: draft.width_px,
                    height_px: draft.height_px,
                    file_size_bytes: draft.file_size_bytes,
                });
                i = j;
            } else {
                old_to_new[i] = out.len();
                out.push(draft.clone());
                i += 1;
            }
        }
    }

    let remapped_bookmarks = remap_bookmarks_by_index(bookmarks, &old_to_new, out.len());
    Ok((out, remapped_bookmarks))
}

/// Chuẩn bị dữ liệu ảnh để nhúng vào PDF theo chế độ xử lý (mặc định `Balanced`).
pub fn prepare_page_for_pdf(
    draft: &PageDraft,
    jpeg_quality: u8,
    lossless_passthrough: bool,
) -> Result<PreparedImage> {
    prepare_page_for_pdf_with_mode(
        draft,
        jpeg_quality,
        lossless_passthrough,
        PdfExportMode::Balanced,
    )
}

/// Chuẩn bị dữ liệu ảnh theo 3 chế độ:
/// - `Fast`: đọc 1 lần, passthrough JPEG (`RGB`/`Gray`) & PNG (`IDAT` không alpha), bỏ decode kiểm tra sâu, zlib `fast`.
/// - `Balanced`: đọc 1 lần, kiểm tra header JPEG (`SOF`/`EXIF`/`APP14`) + PNG `IDAT` chuẩn, fallback decode an toàn.
/// - `Safe`: giải mã kiểm tra toàn vẹn dữ liệu ảnh trước khi đóng gói vào PDF.
pub fn prepare_page_for_pdf_with_mode(
    draft: &PageDraft,
    jpeg_quality: u8,
    lossless_passthrough: bool,
    mode: PdfExportMode,
) -> Result<PreparedImage> {
    let compression = match mode {
        PdfExportMode::Fast => Compression::fast(),
        PdfExportMode::Balanced | PdfExportMode::Safe => Compression::default(),
    };

    if !draft.has_pixel_edits() {
        if let PageSource::ImageFile { ref path } = draft.source {
            let allow_passthrough = lossless_passthrough || mode == PdfExportMode::Fast;
            if allow_passthrough {
                let bytes = std::fs::read(path)?;
                let is_jpeg = bytes.starts_with(&[0xFF, 0xD8]);
                let is_png = bytes.starts_with(b"\x89PNG\r\n\x1a\n");

                match mode {
                    PdfExportMode::Fast | PdfExportMode::Balanced => {
                        if is_jpeg {
                            match try_passthrough_jpeg_owned(bytes, mode == PdfExportMode::Balanced)
                            {
                                Ok(prepared) => return Ok(prepared),
                                Err(fallback_bytes) => {
                                    let dyn_img =
                                        load_image_from_bytes_with_exif(&fallback_bytes, path)?;
                                    drop(fallback_bytes);
                                    return encode_dynamic_for_pdf(
                                        dyn_img,
                                        draft,
                                        jpeg_quality,
                                        lossless_passthrough,
                                        compression,
                                    );
                                }
                            }
                        } else if is_png {
                            if let Some(prepared) = try_passthrough_png_from_bytes(&bytes) {
                                return Ok(prepared);
                            }
                            let dyn_img = load_image_from_bytes_with_exif(&bytes, path)?;
                            drop(bytes);
                            return encode_dynamic_for_pdf(
                                dyn_img,
                                draft,
                                jpeg_quality,
                                lossless_passthrough,
                                compression,
                            );
                        } else {
                            let dyn_img = load_image_from_bytes_with_exif(&bytes, path)?;
                            drop(bytes);
                            return encode_dynamic_for_pdf(
                                dyn_img,
                                draft,
                                jpeg_quality,
                                lossless_passthrough,
                                compression,
                            );
                        }
                    }
                    PdfExportMode::Safe => {
                        if is_jpeg && lossless_passthrough {
                            // Mode 3: phải giải mã toàn vẹn pixel để phát hiện file JPEG bị cụt/hỏng trước khi nhúng gốc.
                            let decoded = load_image_from_bytes_with_exif(&bytes, path)?;
                            let safe_hdr = parse_jpeg_header_from_slice(&bytes).filter(|hdr| {
                                hdr.orientation == 1
                                    && hdr.precision == 8
                                    && matches!(hdr.sof_marker, 0xC0 | 0xC1 | 0xC2)
                                    && matches!(hdr.components, 1 | 3)
                                    && !(hdr.components == 3 && hdr.adobe_transform == Some(0))
                            });
                            if let Some(hdr) = safe_hdr {
                                let color_space = if hdr.components == 1 {
                                    PdfColorSpace::DeviceGray
                                } else {
                                    PdfColorSpace::DeviceRgb
                                };
                                drop(decoded);
                                return Ok(PreparedImage::JpegStream {
                                    bytes,
                                    width: hdr.width,
                                    height: hdr.height,
                                    color_space,
                                    passthrough: true,
                                });
                            }
                            drop(bytes);
                            return encode_dynamic_for_pdf(
                                decoded,
                                draft,
                                jpeg_quality,
                                lossless_passthrough,
                                compression,
                            );
                        }
                        let dyn_img = load_image_from_bytes_with_exif(&bytes, path)?;
                        drop(bytes);
                        return encode_dynamic_for_pdf(
                            dyn_img,
                            draft,
                            jpeg_quality,
                            lossless_passthrough,
                            compression,
                        );
                    }
                }
            }
        }
    }

    let dyn_img = load_source_image(&draft.source)?;
    let edited = apply_edits(dyn_img, draft)?;
    encode_dynamic_for_pdf(
        edited,
        draft,
        jpeg_quality,
        lossless_passthrough,
        compression,
    )
}

fn encode_dynamic_for_pdf(
    img: DynamicImage,
    draft: &PageDraft,
    jpeg_quality: u8,
    lossless_passthrough: bool,
    compression: Compression,
) -> Result<PreparedImage> {
    if lossless_passthrough {
        let is_lossless_source = matches!(&draft.source, PageSource::ImageFile { path } if matches!(ext_lower(path).as_str(), "png" | "svg"));
        if is_lossless_source {
            if let DynamicImage::ImageLuma8(gray) = img {
                let (w, h) = (gray.width(), gray.height());
                let zlib_bytes = compress_zlib_with_level(gray.as_raw(), compression)?;
                drop(gray);
                return Ok(PreparedImage::FlateStream {
                    zlib_bytes,
                    width: w,
                    height: h,
                    color_space: PdfColorSpace::DeviceGray,
                    png_predictor_colors: None,
                    passthrough: false,
                });
            }
            let rgb = into_white_rgb(img);
            let (w, h) = (rgb.width(), rgb.height());
            let zlib_bytes = compress_zlib_with_level(rgb.as_raw(), compression)?;
            drop(rgb);
            return Ok(PreparedImage::FlateStream {
                zlib_bytes,
                width: w,
                height: h,
                color_space: PdfColorSpace::DeviceRgb,
                png_predictor_colors: None,
                passthrough: false,
            });
        }
    }

    let rgb = into_white_rgb(img);
    let (w, h) = (rgb.width(), rgb.height());
    let mut jpg_bytes = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut jpg_bytes, jpeg_quality.clamp(10, 100));
    encoder
        .encode_image(&DynamicImage::ImageRgb8(rgb))
        .map_err(|e| KnitError::InvalidInput(format!("Loi nen JPEG: {e}")))?;

    Ok(PreparedImage::JpegStream {
        bytes: jpg_bytes,
        width: w,
        height: h,
        color_space: PdfColorSpace::DeviceRgb,
        passthrough: false,
    })
}

struct JpegSliceHeader {
    width: u32,
    height: u32,
    components: u8,
    sof_marker: u8,
    precision: u8,
    orientation: u16,
    adobe_transform: Option<u8>,
}

fn parse_jpeg_header_from_slice(bytes: &[u8]) -> Option<JpegSliceHeader> {
    if bytes.get(0..2) != Some(&[0xFF, 0xD8]) {
        return None;
    }

    let mut pos = 2usize;
    let mut orientation: Option<u16> = None;
    let mut adobe_transform: Option<u8> = None;

    while pos < bytes.len() {
        if bytes[pos] != 0xFF {
            return None;
        }
        while pos < bytes.len() && bytes[pos] == 0xFF {
            pos += 1;
        }
        if pos >= bytes.len() {
            return None;
        }
        let marker = bytes[pos];
        pos += 1;

        if matches!(marker, 0x00 | 0xD9 | 0xDA) {
            return None;
        }
        if marker == 0xD8 || marker == 0x01 || (0xD0..=0xD7).contains(&marker) {
            continue;
        }

        let len_bytes = bytes.get(pos..pos + 2)?;
        let seg_len = u16::from_be_bytes([len_bytes[0], len_bytes[1]]) as usize;
        if seg_len < 2 {
            return None;
        }
        let payload_start = pos + 2;
        let payload_end = pos.checked_add(seg_len)?;
        let payload = bytes.get(payload_start..payload_end)?;
        pos = payload_end;

        if marker == 0xE1 && orientation.is_none() {
            orientation = parse_exif_orientation(payload);
        } else if marker == 0xEE
            && adobe_transform.is_none()
            && payload.len() >= 12
            && payload.starts_with(b"Adobe")
        {
            adobe_transform = Some(payload[11]);
        } else if matches!(marker, 0xC0..=0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF)
            && payload.len() >= 6
        {
            let precision = payload[0];
            let height = u16::from_be_bytes([payload[1], payload[2]]) as u32;
            let width = u16::from_be_bytes([payload[3], payload[4]]) as u32;
            let components = payload[5];
            if width == 0 || height == 0 {
                return None;
            }
            return Some(JpegSliceHeader {
                width,
                height,
                components,
                sof_marker: marker,
                precision,
                orientation: orientation.unwrap_or(1),
                adobe_transform,
            });
        }
    }

    None
}

fn try_passthrough_jpeg_owned(
    bytes: Vec<u8>,
    strict_adobe_check: bool,
) -> std::result::Result<PreparedImage, Vec<u8>> {
    let header = parse_jpeg_header_from_slice(&bytes).and_then(|hdr| {
        if hdr.orientation != 1
            || hdr.precision != 8
            || !matches!(hdr.sof_marker, 0xC0 | 0xC1 | 0xC2)
        {
            return None;
        }
        let color_space = match hdr.components {
            1 => PdfColorSpace::DeviceGray,
            3 => PdfColorSpace::DeviceRgb,
            _ => return None,
        };
        if strict_adobe_check && hdr.components == 3 && hdr.adobe_transform == Some(0) {
            return None;
        }
        Some((hdr.width, hdr.height, color_space))
    });

    match header {
        Some((width, height, color_space)) => Ok(PreparedImage::JpegStream {
            bytes,
            width,
            height,
            color_space,
            passthrough: true,
        }),
        None => Err(bytes),
    }
}

/// Nhúng thẳng dữ liệu nén `IDAT` của PNG 8-bit không alpha (`Gray8` hoặc `RGB8`, non-interlaced),
/// không giải mã bitmap và không nén zlib lại.
fn try_passthrough_png_from_bytes(bytes: &[u8]) -> Option<PreparedImage> {
    const PNG_SIG: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
    if bytes.get(0..8) != Some(PNG_SIG.as_slice()) {
        return None;
    }

    let mut pos = 8usize;
    let mut ihdr: Option<(u32, u32, PdfColorSpace, u8)> = None;
    let mut zlib_bytes = Vec::new();
    let mut saw_iend = false;

    while pos + 12 <= bytes.len() {
        let len = u32::from_be_bytes(bytes[pos..pos + 4].try_into().ok()?) as usize;
        let chunk_type: [u8; 4] = bytes[pos + 4..pos + 8].try_into().ok()?;
        let data_start = pos + 8;
        let data_end = data_start.checked_add(len)?;
        let next_pos = data_end.checked_add(4)?;
        if next_pos > bytes.len() {
            return None;
        }
        let data = &bytes[data_start..data_end];
        pos = next_pos;

        if ihdr.is_none() {
            if &chunk_type != b"IHDR" || data.len() != 13 {
                return None;
            }
            let width = u32::from_be_bytes(data[0..4].try_into().ok()?);
            let height = u32::from_be_bytes(data[4..8].try_into().ok()?);
            let bit_depth = data[8];
            let color_type = data[9];
            let compression = data[10];
            let filter = data[11];
            let interlace = data[12];

            if width == 0
                || height == 0
                || bit_depth != 8
                || compression != 0
                || filter != 0
                || interlace != 0
            {
                return None;
            }
            let (color_space, colors) = match color_type {
                0 => (PdfColorSpace::DeviceGray, 1),
                2 => (PdfColorSpace::DeviceRgb, 3),
                _ => return None,
            };
            ihdr = Some((width, height, color_space, colors));
            continue;
        }

        match &chunk_type {
            b"tRNS" => return None,
            b"IDAT" => zlib_bytes.extend_from_slice(data),
            b"IEND" => {
                saw_iend = true;
                break;
            }
            _ => {}
        }
    }

    let (width, height, color_space, colors) = ihdr?;
    if !saw_iend || zlib_bytes.is_empty() {
        return None;
    }

    Some(PreparedImage::FlateStream {
        zlib_bytes,
        width,
        height,
        color_space,
        png_predictor_colors: Some(colors),
        passthrough: true,
    })
}

pub fn load_source_image(source: &PageSource) -> Result<DynamicImage> {
    match source {
        PageSource::ImageFile { path } => load_image_with_exif(path),
        PageSource::AnimatedFrame { path, frame_index } => {
            load_animated_frame(path, *frame_index)
        }
        PageSource::PdfPage { .. } => Err(KnitError::InvalidInput(
            "PdfPage duoc xu ly truc tiep trong PDF ops".into(),
        )),
    }
}

fn load_image_from_bytes_with_exif(bytes: &[u8], path: &Path) -> Result<DynamicImage> {
    if ext_lower(path) == "svg" {
        return decode_svg_from_bytes(bytes, path, None);
    }
    if ext_lower(path) == "avif" || bytes.get(4..12) == Some(b"ftypavif") {
        let decoded = oxideav_avif::decode(bytes)
            .map_err(|e| KnitError::InvalidInput(format!("AVIF decode loi {}: {e}", path.display())))?;
        let rgba = decoded
            .try_to_rgba8()
            .map_err(|e| KnitError::InvalidInput(format!("AVIF RGBA loi {}: {e}", path.display())))?;
        let img = RgbaImage::from_raw(decoded.width(), decoded.height(), rgba).ok_or_else(|| {
            KnitError::InvalidInput(format!("AVIF buffer kich thuoc khong khop: {}", path.display()))
        })?;
        return Ok(DynamicImage::ImageRgba8(img));
    }

    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| KnitError::InvalidInput(format!("Khong doan duoc format {}: {e}", path.display())))?;
    let mut decoder = reader
        .into_decoder()
        .map_err(|e| KnitError::InvalidInput(format!("Loi tao decoder {}: {e}", path.display())))?;
    let orient = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let mut img = DynamicImage::from_decoder(decoder)
        .map_err(|e| KnitError::InvalidInput(format!("Loi giai ma anh {}: {e}", path.display())))?;
    img.apply_orientation(orient);
    Ok(img)
}

fn load_image_with_exif(path: &Path) -> Result<DynamicImage> {
    let ext = ext_lower(path);
    if ext == "svg" {
        let bytes = std::fs::read(path)?;
        return decode_svg_from_bytes(&bytes, path, None);
    }
    if ext == "avif" {
        let bytes = std::fs::read(path)?;
        return load_image_from_bytes_with_exif(&bytes, path);
    }

    let reader = ImageReader::open(path)?
        .with_guessed_format()
        .map_err(|e| KnitError::InvalidInput(format!("Khong doan duoc format {}: {e}", path.display())))?;
    let mut decoder = reader
        .into_decoder()
        .map_err(|e| KnitError::InvalidInput(format!("Loi tao decoder {}: {e}", path.display())))?;
    let orient = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let mut img = DynamicImage::from_decoder(decoder)
        .map_err(|e| KnitError::InvalidInput(format!("Loi giai ma anh {}: {e}", path.display())))?;
    img.apply_orientation(orient);
    Ok(img)
}

fn load_animated_frame(path: &Path, frame_index: usize) -> Result<DynamicImage> {
    let ext = ext_lower(path);
    match ext.as_str() {
        "gif" => {
            let file = BufReader::new(File::open(path)?);
            let decoder = GifDecoder::new(file)
                .map_err(|e| KnitError::InvalidInput(format!("GIF loi: {e}")))?;
            let frame = decoder
                .into_frames()
                .nth(frame_index)
                .ok_or_else(|| KnitError::InvalidInput(format!("Khong tim thay frame {frame_index}")))?
                .map_err(|e| KnitError::InvalidInput(format!("Loi frame GIF: {e}")))?;
            Ok(DynamicImage::ImageRgba8(frame.into_buffer()))
        }
        "webp" => {
            let file = BufReader::new(File::open(path)?);
            let decoder = WebPDecoder::new(file)
                .map_err(|e| KnitError::InvalidInput(format!("WebP loi: {e}")))?;
            let frame = decoder
                .into_frames()
                .nth(frame_index)
                .ok_or_else(|| KnitError::InvalidInput(format!("Khong tim thay frame {frame_index}")))?
                .map_err(|e| KnitError::InvalidInput(format!("Loi frame WebP: {e}")))?;
            Ok(DynamicImage::ImageRgba8(frame.into_buffer()))
        }
        _ => load_image_with_exif(path),
    }
}

/// Áp dụng thứ tự không phá hủy: Crop -> Rotate -> Rasterize Annotations (Text + Stroke).
pub fn apply_edits(mut img: DynamicImage, draft: &PageDraft) -> Result<DynamicImage> {
    if let Some(CropRect { x, y, width, height }) = draft.crop {
        let iw = img.width() as f32;
        let ih = img.height() as f32;
        let nx = x.clamp(0.0, 0.999);
        let ny = y.clamp(0.0, 0.999);
        let nw = width.clamp(0.001, (1.0 - nx).max(0.001));
        let nh = height.clamp(0.001, (1.0 - ny).max(0.001));

        let px = (nx * iw).round() as u32;
        let py = (ny * ih).round() as u32;
        let pw = ((nw * iw).round() as u32).max(1).min(img.width().saturating_sub(px).max(1));
        let ph = ((nh * ih).round() as u32).max(1).min(img.height().saturating_sub(py).max(1));
        img = img.crop_imm(px, py, pw, ph);
    }

    match draft.rotation_deg.rem_euclid(360) {
        90 => img = img.rotate90(),
        180 => img = img.rotate180(),
        270 => img = img.rotate270(),
        _ => {}
    }

    if !draft.annotations.strokes.is_empty() || !draft.annotations.texts.is_empty() {
        let mut rgba = img.to_rgba8();
        rasterize_annotations(&mut rgba, &draft.annotations)?;
        img = DynamicImage::ImageRgba8(rgba);
    }

    Ok(img)
}

pub fn rasterize_annotations(img: &mut RgbaImage, layer: &AnnotationLayer) -> Result<()> {
    let w = img.width() as f32;
    let h = img.height() as f32;
    let min_dim = w.min(h);

    for stroke in &layer.strokes {
        if stroke.points.is_empty() {
            continue;
        }
        let color = parse_hex_rgba(&stroke.color_hex);
        let radius = ((min_dim * stroke.stroke_width_ratio) * 0.5).round().max(1.0) as i32;

        if stroke.points.len() == 1 {
            let p = stroke.points[0];
            draw_filled_circle_mut(img, ((p[0] * w) as i32, (p[1] * h) as i32), radius, color);
            continue;
        }

        for pair in stroke.points.windows(2) {
            let p0 = (pair[0][0] * w, pair[0][1] * h);
            let p1 = (pair[1][0] * w, pair[1][1] * h);
            if radius <= 1 {
                draw_line_segment_mut(img, p0, p1, color);
            } else {
                let dx = p1.0 - p0.0;
                let dy = p1.1 - p0.1;
                let dist = (dx * dx + dy * dy).sqrt();
                let steps = (dist / (radius as f32 * 0.5).max(1.0)).ceil().max(1.0) as usize;
                for i in 0..=steps {
                    let t = i as f32 / steps as f32;
                    let cx = (p0.0 + dx * t).round() as i32;
                    let cy = (p0.1 + dy * t).round() as i32;
                    draw_filled_circle_mut(img, (cx, cy), radius, color);
                }
            }
        }
    }

    if !layer.texts.is_empty() {
        let font = default_font()?;
        for text in &layer.texts {
            if text.text.trim().is_empty() {
                continue;
            }
            let color = parse_hex_rgba(&text.color_hex);
            let max_px_h = (h * 0.5).max(1.0);
            let min_px_h = 10.0_f32.min(max_px_h);
            let px_height = (h * text.font_size_ratio).clamp(min_px_h, max_px_h);
            let scale = PxScale::from(px_height);
            let line_step = font.as_scaled(scale).height().ceil() as i32;
            let base_x = (text.x * w).round() as i32;
            let base_y = (text.y * h).round() as i32;

            for (idx, line) in text.text.lines().enumerate() {
                let y = base_y + (idx as i32) * line_step;
                draw_text_mut(img, color, base_x, y, scale, font, line);
            }
        }
    }

    Ok(())
}

fn load_resized_thumbnail(path: &Path, max_width: u32) -> Result<DynamicImage> {
    if ext_lower(path) == "svg" {
        let bytes = std::fs::read(path)?;
        return decode_svg_from_bytes(&bytes, path, (max_width > 0).then_some(max_width));
    }
    let img = load_image_with_exif(path)?;
    let (w, h) = (img.width(), img.height());
    if w > max_width && max_width > 0 {
        let target_h = ((h as f64) * (max_width as f64 / w as f64)).round().max(1.0) as u32;
        Ok(img.thumbnail(max_width, target_h))
    } else {
        Ok(img)
    }
}

pub fn render_image_thumbnail(path: &Path, max_width: u32) -> Result<Vec<u8>> {
    let resized = load_resized_thumbnail(path, max_width)?;
    let mut out = Vec::new();
    resized
        .write_to(&mut Cursor::new(&mut out), ImageFormat::Png)
        .map_err(|e| KnitError::InvalidInput(format!("Loi encode PNG thumbnail: {e}")))?;
    Ok(out)
}

/// Render thumbnail JPEG nhẹ & nhanh hơn nhiều so với PNG cho ảnh dung lượng lớn.
pub fn render_image_thumbnail_jpeg(path: &Path, max_width: u32, quality: u8) -> Result<Vec<u8>> {
    let resized = load_resized_thumbnail(path, max_width)?;
    let rgb = into_white_rgb(resized);
    let mut out = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut out, quality.clamp(40, 95));
    encoder
        .encode_image(&DynamicImage::ImageRgb8(rgb))
        .map_err(|e| KnitError::InvalidInput(format!("Loi encode JPEG thumbnail: {e}")))?;
    Ok(out)
}

/// Render ảnh preview/thumbnail của một `PageDraft` đã áp dụng đầy đủ crop, xoay và annotation.
pub fn render_page_draft_preview_jpeg(
    draft: &PageDraft,
    max_size: u32,
    quality: u8,
) -> Result<Vec<u8>> {
    let img = load_source_image(&draft.source)?;
    let edited = apply_edits(img, draft)?;
    let resized = if max_size > 0 && (edited.width() > max_size || edited.height() > max_size) {
        edited.thumbnail(max_size, max_size)
    } else {
        edited
    };
    let rgb = into_white_rgb(resized);
    let mut out = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut out, quality.clamp(40, 95));
    encoder
        .encode_image(&DynamicImage::ImageRgb8(rgb))
        .map_err(|e| KnitError::InvalidInput(format!("Loi encode JPEG preview: {e}")))?;
    Ok(out)
}

fn into_white_rgb(img: DynamicImage) -> image::RgbImage {
    match img {
        DynamicImage::ImageRgb8(rgb) => rgb,
        other => {
            let rgba = other.into_rgba8();
            let (w, h) = (rgba.width(), rgba.height());
            let mut rgb = image::RgbImage::new(w, h);
            for (x, y, pixel) in rgba.enumerate_pixels() {
                let a = pixel[3] as f32 / 255.0;
                let inv = 1.0 - a;
                let r = (pixel[0] as f32 * a + 255.0 * inv).round().clamp(0.0, 255.0) as u8;
                let g = (pixel[1] as f32 * a + 255.0 * inv).round().clamp(0.0, 255.0) as u8;
                let b = (pixel[2] as f32 * a + 255.0 * inv).round().clamp(0.0, 255.0) as u8;
                rgb.put_pixel(x, y, image::Rgb([r, g, b]));
            }
            rgb
        }
    }
}

fn compress_zlib_with_level(raw: &[u8], level: Compression) -> Result<Vec<u8>> {
    let mut enc = ZlibEncoder::new(Vec::new(), level);
    enc.write_all(raw)?;
    Ok(enc.finish()?)
}

fn parse_hex_rgba(hex: &str) -> Rgba<u8> {
    let s = hex.trim().trim_start_matches('#');
    match s.len() {
        6 => {
            let r = u8::from_str_radix(&s[0..2], 16).unwrap_or(0);
            let g = u8::from_str_radix(&s[2..4], 16).unwrap_or(0);
            let b = u8::from_str_radix(&s[4..6], 16).unwrap_or(0);
            Rgba([r, g, b, 255])
        }
        8 => {
            let r = u8::from_str_radix(&s[0..2], 16).unwrap_or(0);
            let g = u8::from_str_radix(&s[2..4], 16).unwrap_or(0);
            let b = u8::from_str_radix(&s[4..6], 16).unwrap_or(0);
            let a = u8::from_str_radix(&s[6..8], 16).unwrap_or(255);
            Rgba([r, g, b, a])
        }
        _ => Rgba([220, 53, 69, 255]),
    }
}

fn ext_lower(path: &Path) -> String {
    path.extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default()
}
