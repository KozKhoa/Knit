use crate::models::{
    AnimatedImagePolicy, AnnotationLayer, BookmarkNode, CropRect, ImageScanResult, PageDraft,
    PageSource,
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
use knit_core::{natural_cmp, KnitError, Result};
use std::collections::HashSet;
use std::fs::File;
use std::io::{BufReader, Cursor, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use uuid::Uuid;

pub const SUPPORTED_IMAGE_EXTS: &[&str] = &[
    "jpg", "jpeg", "jfif", "png", "webp", "avif", "gif", "bmp", "tiff", "tif",
];

pub fn is_supported_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|s| SUPPORTED_IMAGE_EXTS.contains(&s.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

#[derive(Debug)]
pub enum PreparedImage {
    JpegStream {
        bytes: Vec<u8>,
        width: u32,
        height: u32,
        passthrough: bool,
    },
    FlateRgbStream {
        zlib_bytes: Vec<u8>,
        width: u32,
        height: u32,
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

pub fn inspect_image_dimensions(path: &Path) -> Result<(u32, u32)> {
    let ext = ext_lower(path);
    if ext == "avif" {
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

pub fn scan_image_files(
    paths: &[PathBuf],
    animated_policy: AnimatedImagePolicy,
) -> Result<ImageScanResult> {
    let mut sorted = paths.to_vec();
    sorted.sort_by(|a, b| natural_cmp(&a.to_string_lossy(), &b.to_string_lossy()));

    let mut pages = Vec::new();
    for path in sorted {
        if !path.is_file() || !is_supported_image(&path) {
            continue;
        }
        append_image_drafts(&path, animated_policy, &mut pages)?;
    }

    Ok(ImageScanResult {
        pages,
        bookmarks: Vec::new(),
    })
}

pub fn scan_image_folder(
    root: &Path,
    animated_policy: AnimatedImagePolicy,
) -> Result<ImageScanResult> {
    if !root.is_dir() {
        return Err(KnitError::NotFound(root.display().to_string()));
    }

    let mut pages = Vec::new();
    let mut bookmarks = Vec::new();
    let mut seen_covers: HashSet<PathBuf> = HashSet::new();

    // Cover ở cấp root nếu có (cover.jpg/png/webp...)
    let mut root_files = collect_dir_images(root)?;
    if let Some(cover_idx) = root_files.iter().position(|p| is_cover_name(p)) {
        let cover = root_files.remove(cover_idx);
        seen_covers.insert(cover.clone());
        let start = pages.len();
        append_image_drafts(&cover, animated_policy, &mut pages)?;
        if pages.len() > start {
            bookmarks.push(BookmarkNode {
                title: "Cover".to_string(),
                target_page_index: start,
                children: Vec::new(),
            });
        }
    }

    for img in root_files {
        append_image_drafts(&img, animated_policy, &mut pages)?;
    }

    let subdirs = collect_sorted_subdirs(root)?;
    for sub in subdirs {
        if let Some(bm) = scan_subtree(&sub, animated_policy, &mut pages, &mut seen_covers)? {
            bookmarks.push(bm);
        }
    }

    Ok(ImageScanResult { pages, bookmarks })
}

fn scan_subtree(
    dir: &Path,
    animated_policy: AnimatedImagePolicy,
    pages: &mut Vec<PageDraft>,
    seen: &mut HashSet<PathBuf>,
) -> Result<Option<BookmarkNode>> {
    let start_idx = pages.len();
    let mut files = collect_dir_images(dir)?;
    if let Some(cover_idx) = files.iter().position(|p| is_cover_name(p)) {
        let cover = files.remove(cover_idx);
        if seen.insert(cover.clone()) {
            append_image_drafts(&cover, animated_policy, pages)?;
        }
    }
    for f in files {
        if seen.insert(f.clone()) {
            append_image_drafts(&f, animated_policy, pages)?;
        }
    }

    let mut children = Vec::new();
    for sub in collect_sorted_subdirs(dir)? {
        if let Some(child_bm) = scan_subtree(&sub, animated_policy, pages, seen)? {
            children.push(child_bm);
        }
    }

    if pages.len() == start_idx && children.is_empty() {
        return Ok(None);
    }

    let title = dir
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Section".to_string());
    Ok(Some(BookmarkNode {
        title,
        target_page_index: start_idx,
        children,
    }))
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

fn append_image_drafts(
    path: &Path,
    animated_policy: AnimatedImagePolicy,
    out: &mut Vec<PageDraft>,
) -> Result<()> {
    let file_name = path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "image".to_string());

    if animated_policy == AnimatedImagePolicy::UnpackAllFrames {
        if let Some(frames) = probe_animation_frames(path)? {
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
                });
            }
            return Ok(());
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
    });
    Ok(())
}

/// Trả về danh sách `(width, height, duration_ms)` nếu file là GIF/WebP động (>1 frame).
fn probe_animation_frames(path: &Path) -> Result<Option<Vec<(u32, u32, u32)>>> {
    let ext = ext_lower(path);
    match ext.as_str() {
        "gif" => {
            let file = BufReader::new(File::open(path)?);
            let decoder = GifDecoder::new(file)
                .map_err(|e| KnitError::InvalidInput(format!("GIF loi {}: {e}", path.display())))?;
            let frames = decoder.into_frames().collect_frames().map_err(|e| {
                KnitError::InvalidInput(format!("Loi doc frames GIF {}: {e}", path.display()))
            })?;
            if frames.len() <= 1 {
                return Ok(None);
            }
            Ok(Some(
                frames
                    .into_iter()
                    .map(|f| {
                        let (num, den) = f.delay().numer_denom_ms();
                        let ms = num / den.max(1);
                        let buf = f.into_buffer();
                        (buf.width(), buf.height(), ms.max(20))
                    })
                    .collect(),
            ))
        }
        "webp" => {
            let file = BufReader::new(File::open(path)?);
            let decoder = WebPDecoder::new(file)
                .map_err(|e| KnitError::InvalidInput(format!("WebP loi {}: {e}", path.display())))?;
            if !decoder.has_animation() {
                return Ok(None);
            }
            let frames = decoder.into_frames().collect_frames().map_err(|e| {
                KnitError::InvalidInput(format!("Loi doc frames WebP {}: {e}", path.display()))
            })?;
            if frames.len() <= 1 {
                return Ok(None);
            }
            Ok(Some(
                frames
                    .into_iter()
                    .map(|f| {
                        let (num, den) = f.delay().numer_denom_ms();
                        let ms = num / den.max(1);
                        let buf = f.into_buffer();
                        (buf.width(), buf.height(), ms.max(20))
                    })
                    .collect(),
            ))
        }
        _ => Ok(None),
    }
}

/// Chuẩn bị dữ liệu ảnh để nhúng vào PDF:
/// - Nếu `lossless_passthrough == true` và trang chưa bị sửa pixel (crop/rotate/draw/text):
///   - JPEG chuẩn (EXIF Orientation == NoTransforms) -> nhúng thẳng `/DCTDecode` 0 re-encode.
///   - PNG -> giải mã & nén thẳng RGB24 `/FlateDecode` lossless 100%.
/// - Ngược lại: decode -> apply_edits -> JPEG hoặc FlateRGB.
pub fn prepare_page_for_pdf(
    draft: &PageDraft,
    jpeg_quality: u8,
    lossless_passthrough: bool,
) -> Result<PreparedImage> {
    if lossless_passthrough && !draft.has_pixel_edits() {
        if let PageSource::ImageFile { ref path } = draft.source {
            let ext = ext_lower(path);
            if matches!(ext.as_str(), "jpg" | "jpeg" | "jfif") {
                if let Ok(Some(jpeg)) = try_passthrough_jpeg(path) {
                    return Ok(jpeg);
                }
            } else if ext == "png" {
                let dyn_img = load_source_image(&draft.source)?;
                let rgb = alpha_to_white_rgb(&dyn_img);
                let (w, h) = (rgb.width(), rgb.height());
                let zlib_bytes = compress_zlib(rgb.as_raw())?;
                return Ok(PreparedImage::FlateRgbStream {
                    zlib_bytes,
                    width: w,
                    height: h,
                });
            }
        }
    }

    let dyn_img = load_source_image(&draft.source)?;
    let edited = apply_edits(dyn_img, draft)?;
    let rgb = alpha_to_white_rgb(&edited);
    let (w, h) = (rgb.width(), rgb.height());

    if lossless_passthrough && draft.has_pixel_edits() {
        // Khi người dùng chỉnh sửa trên PNG, giữ nguyên lossless Flate nếu gốc là PNG
        if matches!(&draft.source, PageSource::ImageFile { path } if ext_lower(path) == "png") {
            let zlib_bytes = compress_zlib(rgb.as_raw())?;
            return Ok(PreparedImage::FlateRgbStream {
                zlib_bytes,
                width: w,
                height: h,
            });
        }
    }

    let mut jpg_bytes = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut jpg_bytes, jpeg_quality.clamp(10, 100));
    encoder
        .encode_image(&DynamicImage::ImageRgb8(rgb))
        .map_err(|e| KnitError::InvalidInput(format!("Loi nen JPEG: {e}")))?;

    Ok(PreparedImage::JpegStream {
        bytes: jpg_bytes,
        width: w,
        height: h,
        passthrough: false,
    })
}

fn try_passthrough_jpeg(path: &Path) -> Result<Option<PreparedImage>> {
    let reader = ImageReader::open(path)?
        .with_guessed_format()
        .map_err(|e| KnitError::InvalidInput(e.to_string()))?;
    if reader.format() != Some(ImageFormat::Jpeg) {
        return Ok(None);
    }
    let mut decoder = reader
        .into_decoder()
        .map_err(|e| KnitError::InvalidInput(e.to_string()))?;
    let orient = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    if orient != Orientation::NoTransforms {
        return Ok(None);
    }
    // PDF DeviceRGB không chấp nhận JPEG CMYK trực tiếp -> kiểm tra ColorType
    let color = decoder.color_type();
    if !matches!(
        color,
        image::ColorType::Rgb8 | image::ColorType::L8
    ) {
        return Ok(None);
    }
    // L8 là Grayscale; hiện chúng ta đặt ColorSpace DeviceRGB ở packer nên chỉ passthrough Rgb8
    if color != image::ColorType::Rgb8 {
        return Ok(None);
    }
    let (width, height) = decoder.dimensions();
    let bytes = std::fs::read(path)?;
    Ok(Some(PreparedImage::JpegStream {
        bytes,
        width,
        height,
        passthrough: true,
    }))
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

fn load_image_with_exif(path: &Path) -> Result<DynamicImage> {
    let ext = ext_lower(path);
    if ext == "avif" {
        let bytes = std::fs::read(path)?;
        let decoded = oxideav_avif::decode(&bytes)
            .map_err(|e| KnitError::InvalidInput(format!("AVIF decode loi {}: {e}", path.display())))?;
        let rgba = decoded
            .try_to_rgba8()
            .map_err(|e| KnitError::InvalidInput(format!("AVIF RGBA loi {}: {e}", path.display())))?;
        let img = RgbaImage::from_raw(decoded.width(), decoded.height(), rgba).ok_or_else(|| {
            KnitError::InvalidInput(format!("AVIF buffer kich thuoc khong khop: {}", path.display()))
        })?;
        return Ok(DynamicImage::ImageRgba8(img));
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
        let nw = width.clamp(0.001, 1.0 - nx);
        let nh = height.clamp(0.001, 1.0 - ny);

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
            let px_height = (h * text.font_size_ratio).clamp(10.0, h * 0.5);
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
    let rgb = match resized {
        DynamicImage::ImageRgb8(rgb) => rgb,
        other => alpha_to_white_rgb(&other),
    };
    let mut out = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut out, quality.clamp(40, 95));
    encoder
        .encode_image(&DynamicImage::ImageRgb8(rgb))
        .map_err(|e| KnitError::InvalidInput(format!("Loi encode JPEG thumbnail: {e}")))?;
    Ok(out)
}

fn alpha_to_white_rgb(img: &DynamicImage) -> image::RgbImage {
    match img {
        DynamicImage::ImageRgb8(rgb) => rgb.clone(),
        other => {
            let rgba = other.to_rgba8();
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

fn compress_zlib(raw: &[u8]) -> Result<Vec<u8>> {
    let mut enc = ZlibEncoder::new(Vec::new(), Compression::default());
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
