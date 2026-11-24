use crate::models::BookmarkNode;
use crate::ops::{load_cached_hayro_pdf, read_outlines_hayro};
use hayro::hayro_interpret::font::{Glyph, GlyphRun};
use hayro::hayro_interpret::hayro_cmap::BfString;
use hayro::hayro_interpret::{
    interpret_page, BlendMode, ClipPath, Context, Device, DrawMode, DrawProps, Image, ImageData,
    ImageDrawProps, InterpreterCache, InterpreterSettings, LumaData, SoftMask, TransformExt,
};
use hayro::hayro_syntax::Pdf;
use hayro::kurbo::{Affine, BezPath, Point, Rect};
use image::imageops::{resize, FilterType};
use image::{DynamicImage, ImageBuffer, ImageFormat, Luma, Rgb, Rgba};
use knit_core::{CancellationToken, JobProgress, JobReporter, KnitError, NoopReporter, Result};
use std::io::Cursor;
use std::path::Path;

/// Một đoạn text có tọa độ hình học trên trang PDF (đơn vị PDF pt, gốc trên-trái, +y đi xuống).
#[derive(Debug, Clone, PartialEq)]
pub struct PdfTextSpan {
    pub text: String,
    pub x_min: f32,
    pub y_top: f32,
    pub x_max: f32,
    pub y_bottom: f32,
    pub baseline_y: f32,
    pub font_size_pt: f32,
    pub is_bold: bool,
    pub is_italic: bool,
}

/// Ảnh raster nhúng trích xuất từ một trang PDF (đã chuyển sang PNG lossless).
#[derive(Debug, Clone, PartialEq)]
pub struct PdfExtractedImage {
    pub image_index: usize,
    pub x_min: f32,
    pub y_top: f32,
    pub x_max: f32,
    pub y_bottom: f32,
    pub width_px: u32,
    pub height_px: u32,
    pub png_bytes: Vec<u8>,
}

/// Chế độ xử lý ảnh khi trích xuất PDF.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PdfImageExtractMode {
    /// Bỏ qua lưu danh sách ảnh (chỉ đếm để nhận diện trang scan).
    None,
    /// Chỉ ghi nhận tọa độ & kích thước để dựng link Markdown mà không decode/nén PNG.
    MetadataOnly,
    /// Giải mã và nén PNG đầy đủ cho bước xuất ra đĩa.
    DecodePng,
}

/// Dữ liệu thô đã trích xuất của một trang PDF để tái cấu trúc Markdown.
#[derive(Debug, Clone)]
pub struct PdfExtractedPage {
    pub page_index: usize,
    pub width_pt: f32,
    pub height_pt: f32,
    pub spans: Vec<PdfTextSpan>,
    pub images: Vec<PdfExtractedImage>,
    pub raw_image_count: usize,
    pub is_likely_scanned: bool,
}

/// Toàn bộ dữ liệu trích xuất từ một tài liệu PDF.
#[derive(Debug, Clone)]
pub struct PdfExtractedDocument {
    pub page_count: usize,
    pub pages: Vec<PdfExtractedPage>,
    pub outlines: Vec<BookmarkNode>,
}

struct ActiveSpan {
    text: String,
    x_min: f64,
    y_top: f64,
    x_max: f64,
    y_bottom: f64,
    baseline_y: f64,
    font_size_pt: f64,
    is_bold: bool,
    pending_space: bool,
}

struct ExtractDevice {
    page_rect: Rect,
    image_mode: PdfImageExtractMode,
    skip_text: bool,
    spans: Vec<PdfTextSpan>,
    images: Vec<PdfExtractedImage>,
    raw_image_count: usize,
    max_image_area_ratio: f64,
    last_fill_sig: Option<(i32, i32, usize)>,
}

impl ExtractDevice {
    fn new(width_pt: f32, height_pt: f32, image_mode: PdfImageExtractMode, skip_text: bool) -> Self {
        Self {
            page_rect: Rect::new(0.0, 0.0, width_pt as f64, height_pt as f64),
            image_mode,
            skip_text,
            spans: Vec::new(),
            images: Vec::new(),
            raw_image_count: 0,
            max_image_area_ratio: 0.0,
            last_fill_sig: None,
        }
    }

    fn flush_active(spans: &mut Vec<PdfTextSpan>, active: &mut Option<ActiveSpan>) {
        if let Some(s) = active.take() {
            let trimmed = s.text.trim();
            if !trimmed.is_empty() {
                spans.push(PdfTextSpan {
                    text: trimmed.to_string(),
                    x_min: s.x_min as f32,
                    y_top: s.y_top as f32,
                    x_max: s.x_max as f32,
                    y_bottom: s.y_bottom as f32,
                    baseline_y: s.baseline_y as f32,
                    font_size_pt: s.font_size_pt as f32,
                    is_bold: s.is_bold,
                    is_italic: false,
                });
            }
        }
    }

    fn finalize(mut self) -> (Vec<PdfTextSpan>, Vec<PdfExtractedImage>, usize, f64) {
        self.dedup_faux_bold_spans();
        (
            self.spans,
            self.images,
            self.raw_image_count,
            self.max_image_area_ratio,
        )
    }

    /// Nhiều phần mềm in PDF vẽ chữ đậm giả bằng cách vẽ lặp cùng một chuỗi lệch <= 0.8pt.
    fn dedup_faux_bold_spans(&mut self) {
        if self.spans.len() < 2 {
            return;
        }
        let mut deduped: Vec<PdfTextSpan> = Vec::with_capacity(self.spans.len());
        for span in self.spans.drain(..) {
            if let Some(prev) = deduped.iter_mut().rev().take(6).find(|p| {
                (p.baseline_y - span.baseline_y).abs() <= 1.0
                    && (p.x_min - span.x_min).abs() <= 1.0
                    && p.text == span.text
            }) {
                prev.is_bold = true;
                continue;
            }
            deduped.push(span);
        }
        self.spans = deduped;
    }
}

impl<'a> Device<'a> for ExtractDevice {
    fn draw_path(&mut self, _: &BezPath, _: DrawProps<'a>, _: &DrawMode) {}
    fn push_clip_path(&mut self, _: &ClipPath) {}
    fn push_transparency_group(&mut self, _: f32, _: Option<SoftMask<'a>>, _: BlendMode) {}
    fn pop_clip(&mut self) {}
    fn pop_transparency_group(&mut self) {}

    fn draw_glyph_run(
        &mut self,
        glyph_run: &GlyphRun<'_, 'a>,
        props: DrawProps<'a>,
        draw_mode: &DrawMode,
    ) {
        if self.skip_text {
            return;
        }
        let glyphs = glyph_run.glyphs();
        if glyphs.is_empty() {
            return;
        }

        let first_origin = (props.transform * glyphs[0].transform()) * Point::ZERO;
        let sig = (
            (first_origin.x * 10.0).round() as i32,
            (first_origin.y * 10.0).round() as i32,
            glyphs.len(),
        );

        match draw_mode {
            DrawMode::Fill(_) => {
                self.last_fill_sig = Some(sig);
            }
            DrawMode::Stroke(_) => {
                if self.last_fill_sig == Some(sig) {
                    if let Some(last) = self.spans.last_mut() {
                        last.is_bold = true;
                    }
                    self.last_fill_sig = None;
                    return;
                }
                self.last_fill_sig = None;
            }
            DrawMode::FillAndStroke(_, _) => {
                self.last_fill_sig = Some(sig);
            }
            DrawMode::Invisible => {
                self.last_fill_sig = None;
            }
        }

        let is_fake_bold = matches!(draw_mode, DrawMode::FillAndStroke(_, _));
        let mut active: Option<ActiveSpan> = None;

        for glyph in glyphs {
            let total = props.transform * glyph.transform();
            let origin = total * Point::ZERO;

            if origin.x < self.page_rect.x0 - 12.0
                || origin.x > self.page_rect.x1 + 12.0
                || origin.y < self.page_rect.y0 - 12.0
                || origin.y > self.page_rect.y1 + 12.0
            {
                continue;
            }

            let raw_text = match glyph.as_unicode() {
                Some(BfString::Char(c)) => c.to_string(),
                Some(BfString::String(s)) => s,
                None => {
                    let code = glyph.char_code();
                    if (32..=126).contains(&code) {
                        ((code as u8) as char).to_string()
                    } else {
                        String::new()
                    }
                }
            };

            let cleaned: String = raw_text
                .chars()
                .filter(|&c| c != '\u{0000}' && c != '\u{FFFD}')
                .collect();
            if cleaned.is_empty() {
                continue;
            }

            let font_size = origin.distance(total * Point::new(0.0, 1000.0)).max(2.0);
            let adv_units = match &**glyph {
                Glyph::Outline(g) => g.advance_width().unwrap_or(500.0),
                Glyph::Type3(g) => g.advance_width().unwrap_or(500.0),
            } as f64;
            let adv_pt = total * Point::new(adv_units, 0.0);
            let adv_dx = (adv_pt.x - origin.x).abs();
            let glyph_width = if adv_dx >= 0.01 {
                adv_dx
            } else {
                font_size * 0.5
            };
            let gx_min = origin.x.min(adv_pt.x);
            let gx_max = if adv_dx >= 0.01 {
                origin.x.max(adv_pt.x)
            } else {
                origin.x + glyph_width
            };
            let gy_top = origin.y - font_size * 0.82;
            let gy_bottom = origin.y + font_size * 0.22;

            if cleaned.chars().all(|c| c.is_whitespace()) {
                if let Some(a) = active.as_mut() {
                    a.pending_space = true;
                }
                continue;
            }

            if let Some(a) = active.as_mut() {
                let ref_fs = a.font_size_pt.max(font_size);
                let same_line = (origin.y - a.baseline_y).abs() <= ref_fs * 0.35;
                let forward = gx_min >= a.x_min - ref_fs * 0.35;
                let gap = gx_min - a.x_max;
                if same_line && forward && gap <= ref_fs * 1.8 {
                    if (a.pending_space || gap > ref_fs * 0.22) && !a.text.ends_with(' ') {
                        a.text.push(' ');
                    }
                    a.text.push_str(&cleaned);
                    a.x_min = a.x_min.min(gx_min);
                    a.x_max = a.x_max.max(gx_max);
                    a.y_top = a.y_top.min(gy_top);
                    a.y_bottom = a.y_bottom.max(gy_bottom);
                    a.pending_space = false;
                    continue;
                }
            }

            Self::flush_active(&mut self.spans, &mut active);
            active = Some(ActiveSpan {
                text: cleaned,
                x_min: gx_min,
                y_top: gy_top,
                x_max: gx_max,
                y_bottom: gy_bottom,
                baseline_y: origin.y,
                font_size_pt: font_size,
                is_bold: is_fake_bold,
                pending_space: false,
            });
        }

        Self::flush_active(&mut self.spans, &mut active);
    }

    fn draw_image(&mut self, image: Image<'a, '_>, props: ImageDrawProps<'a>) {
        let img_w = image.width();
        let img_h = image.height();
        let local = Rect::new(0.0, 0.0, img_w as f64, img_h as f64);
        let bbox = props.transform.transform_rect_bbox(local);
        if !bbox.overlaps(self.page_rect) {
            return;
        }
        let clipped = bbox.intersect(self.page_rect);
        let page_area = (self.page_rect.width() * self.page_rect.height()).max(1.0);
        let area_ratio = (clipped.width() * clipped.height() / page_area).clamp(0.0, 1.0);

        match image {
            Image::Stencil(_) => {
                if img_w >= 100
                    && img_h >= 100
                    && clipped.width() >= 100.0
                    && clipped.height() >= 100.0
                {
                    self.raw_image_count += 1;
                    self.max_image_area_ratio = self.max_image_area_ratio.max(area_ratio);
                }
            }
            Image::Raster(r) => {
                if img_w < 8
                    || img_h < 8
                    || clipped.width() < 6.0
                    || clipped.height() < 6.0
                {
                    return;
                }
                self.raw_image_count += 1;
                self.max_image_area_ratio = self.max_image_area_ratio.max(area_ratio);

                let idx = self.images.len();
                match self.image_mode {
                    PdfImageExtractMode::None => {}
                    PdfImageExtractMode::MetadataOnly => {
                        self.images.push(PdfExtractedImage {
                            image_index: idx,
                            x_min: clipped.x0 as f32,
                            y_top: clipped.y0 as f32,
                            x_max: clipped.x1 as f32,
                            y_bottom: clipped.y1 as f32,
                            width_px: img_w,
                            height_px: img_h,
                            png_bytes: Vec::new(),
                        });
                    }
                    PdfImageExtractMode::DecodePng => {
                        let mut encoded: Option<(u32, u32, Vec<u8>)> = None;
                        r.with_rgba(
                            |img_data, alpha_data| {
                                encoded = encode_hayro_image_to_png(img_data, alpha_data);
                            },
                            None,
                        );
                        if let Some((width_px, height_px, png_bytes)) = encoded {
                            self.images.push(PdfExtractedImage {
                                image_index: idx,
                                x_min: clipped.x0 as f32,
                                y_top: clipped.y0 as f32,
                                x_max: clipped.x1 as f32,
                                y_bottom: clipped.y1 as f32,
                                width_px,
                                height_px,
                                png_bytes,
                            });
                        }
                    }
                }
            }
        }
    }
}

fn encode_hayro_image_to_png(
    img_data: ImageData,
    alpha_data: Option<LumaData>,
) -> Option<(u32, u32, Vec<u8>)> {
    let w = img_data.width();
    let h = img_data.height();
    if w == 0 || h == 0 {
        return None;
    }

    let aligned_alpha = alpha_data.and_then(|alpha| {
        if alpha.width == w && alpha.height == h && alpha.data.len() == (w * h) as usize {
            Some(alpha.data)
        } else if alpha.data.len() == (alpha.width * alpha.height) as usize
            && alpha.width > 0
            && alpha.height > 0
        {
            let buf: ImageBuffer<Luma<u8>, Vec<u8>> =
                ImageBuffer::from_raw(alpha.width, alpha.height, alpha.data)?;
            Some(resize(&buf, w, h, FilterType::Triangle).into_raw())
        } else {
            None
        }
    });

    let dynamic = match img_data {
        ImageData::Rgb(rgb) => {
            if rgb.data.len() != (w * h * 3) as usize {
                return None;
            }
            if let Some(alpha) = aligned_alpha {
                let mut rgba = Vec::with_capacity((w * h * 4) as usize);
                for (px, a) in rgb.data.chunks_exact(3).zip(alpha.into_iter()) {
                    rgba.extend_from_slice(&[px[0], px[1], px[2], a]);
                }
                let buf: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_raw(w, h, rgba)?;
                DynamicImage::ImageRgba8(buf)
            } else {
                let buf: ImageBuffer<Rgb<u8>, Vec<u8>> = ImageBuffer::from_raw(w, h, rgb.data)?;
                DynamicImage::ImageRgb8(buf)
            }
        }
        ImageData::Luma(luma) => {
            if luma.data.len() != (w * h) as usize {
                return None;
            }
            if let Some(alpha) = aligned_alpha {
                let mut rgba = Vec::with_capacity((w * h * 4) as usize);
                for (g, a) in luma.data.into_iter().zip(alpha.into_iter()) {
                    rgba.extend_from_slice(&[g, g, g, a]);
                }
                let buf: ImageBuffer<Rgba<u8>, Vec<u8>> = ImageBuffer::from_raw(w, h, rgba)?;
                DynamicImage::ImageRgba8(buf)
            } else {
                let buf: ImageBuffer<Luma<u8>, Vec<u8>> = ImageBuffer::from_raw(w, h, luma.data)?;
                DynamicImage::ImageLuma8(buf)
            }
        }
    };

    let mut out = Vec::new();
    dynamic
        .write_to(&mut Cursor::new(&mut out), ImageFormat::Png)
        .ok()?;
    Some((w, h, out))
}

/// Trích xuất text spans, ảnh raster nhúng (tùy chọn chế độ decode PNG) và PDF Outlines từ file PDF.
pub fn extract_pdf_for_markdown_with_mode(
    path: &Path,
    cancel: &CancellationToken,
    image_mode: PdfImageExtractMode,
    reporter: Option<&dyn JobReporter>,
) -> Result<PdfExtractedDocument> {
    let noop = NoopReporter;
    let rep: &dyn JobReporter = reporter.unwrap_or(&noop);
    if cancel.is_cancelled() {
        return Err(KnitError::Cancelled);
    }

    let pdf = load_cached_hayro_pdf(path)?;
    extract_loaded_pdf(&pdf, cancel, image_mode, rep)
}

/// Trích xuất text spans, ảnh raster nhúng (PNG đầy đủ) và PDF Outlines từ file PDF.
pub fn extract_pdf_for_markdown(
    path: &Path,
    cancel: &CancellationToken,
    extract_images: bool,
    reporter: Option<&dyn JobReporter>,
) -> Result<PdfExtractedDocument> {
    let mode = if extract_images {
        PdfImageExtractMode::DecodePng
    } else {
        PdfImageExtractMode::None
    };
    extract_pdf_for_markdown_with_mode(path, cancel, mode, reporter)
}

fn extract_loaded_pdf(
    pdf: &Pdf,
    cancel: &CancellationToken,
    image_mode: PdfImageExtractMode,
    reporter: &dyn JobReporter,
) -> Result<PdfExtractedDocument> {
    let raw_pages = pdf.pages();
    let total = raw_pages.len();
    let outlines = read_outlines_hayro(pdf);
    let mut interpreter_cache = InterpreterCache::new();
    let settings = InterpreterSettings::default();
    let mut pages = Vec::with_capacity(total);

    for (page_index, page) in raw_pages.iter().enumerate() {
        if cancel.is_cancelled() {
            return Err(KnitError::Cancelled);
        }
        if page_index > 0 && page_index % 40 == 0 {
            interpreter_cache = InterpreterCache::new();
        }

        let (width_pt, height_pt) = page.render_dimensions();
        let initial_transform: Affine = page.initial_transform(true).to_kurbo();
        let target = Rect::new(0.0, 0.0, width_pt as f64, height_pt as f64);
        let mut state = Context::new(
            initial_transform,
            target,
            &interpreter_cache,
            page.xref(),
            settings.clone(),
        );
        let mut device = ExtractDevice::new(width_pt, height_pt, image_mode, false);
        interpret_page(page, &mut state, &mut device);

        let (spans, images, raw_image_count, max_area_ratio) = device.finalize();
        let non_ws_chars: usize = spans
            .iter()
            .flat_map(|s| s.text.chars())
            .filter(|c| !c.is_whitespace())
            .count();
        let is_likely_scanned =
            non_ws_chars < 20 && raw_image_count > 0 && (non_ws_chars == 0 || max_area_ratio >= 0.25);

        pages.push(PdfExtractedPage {
            page_index,
            width_pt,
            height_pt,
            spans,
            images,
            raw_image_count,
            is_likely_scanned,
        });

        reporter.on_progress(JobProgress {
            phase: "extract".into(),
            done: (page_index + 1) as u64,
            total: total as u64,
            bytes_done: 0,
            bytes_total: 0,
            current_item: format!("Extracted PDF page {}/{}", page_index + 1, total),
        });
    }

    Ok(PdfExtractedDocument {
        page_count: total,
        pages,
        outlines,
    })
}

/// Chỉ trích xuất ảnh PNG trên các trang được chỉ định (bỏ qua hoàn toàn đọc glyph/text và các trang không có ảnh).
pub fn extract_pdf_images_only(
    path: &Path,
    page_filter: Option<&[usize]>,
    cancel: &CancellationToken,
    reporter: Option<&dyn JobReporter>,
) -> Result<(usize, Vec<(usize, PdfExtractedImage)>)> {
    let noop = NoopReporter;
    let rep: &dyn JobReporter = reporter.unwrap_or(&noop);
    if cancel.is_cancelled() {
        return Err(KnitError::Cancelled);
    }

    let pdf = load_cached_hayro_pdf(path)?;
    let raw_pages = pdf.pages();
    let total = raw_pages.len();

    if matches!(page_filter, Some(slice) if slice.is_empty()) {
        return Ok((total, Vec::new()));
    }

    let target_indices: Vec<usize> = match page_filter {
        Some(slice) => slice.iter().copied().filter(|&i| i < total).collect(),
        None => (0..total).collect(),
    };

    let mut interpreter_cache = InterpreterCache::new();
    let settings = InterpreterSettings::default();
    let mut out = Vec::new();
    let work_total = target_indices.len().max(1);

    for (done_idx, &page_index) in target_indices.iter().enumerate() {
        if cancel.is_cancelled() {
            return Err(KnitError::Cancelled);
        }
        if done_idx > 0 && done_idx % 40 == 0 {
            interpreter_cache = InterpreterCache::new();
        }
        let page = &raw_pages[page_index];
        let (width_pt, height_pt) = page.render_dimensions();
        let initial_transform: Affine = page.initial_transform(true).to_kurbo();
        let target = Rect::new(0.0, 0.0, width_pt as f64, height_pt as f64);
        let mut state = Context::new(
            initial_transform,
            target,
            &interpreter_cache,
            page.xref(),
            settings.clone(),
        );
        let mut device = ExtractDevice::new(width_pt, height_pt, PdfImageExtractMode::DecodePng, true);
        interpret_page(page, &mut state, &mut device);
        let (_, images, _, _) = device.finalize();
        for img in images {
            out.push((page_index, img));
        }

        rep.on_progress(JobProgress {
            phase: "extract_images".into(),
            done: (done_idx + 1) as u64,
            total: work_total as u64,
            bytes_done: 0,
            bytes_total: 0,
            current_item: format!("Extracted images on page {}/{}", page_index + 1, total),
        });
    }

    Ok((total, out))
}
