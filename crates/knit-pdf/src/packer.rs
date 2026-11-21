use crate::bookmarks::remap_tree;
use crate::imaging::{
    expand_drafts_for_animated_policy, prepare_page_for_pdf_with_mode, probe_animation_frames,
    PdfColorSpace, PreparedImage,
};
use crate::models::{
    AnimatedImagePolicy, BookmarkNode, Image2PdfConfig, PageBackground, PageDraft,
    PageLayoutPolicy, PageSource, PdfBuildResult, PdfExportMode,
};
use knit_core::{
    ensure_disk_space, CancellationToken, JobProgress, JobReporter, JobReporterExt, KnitError,
    Result,
};
use rayon::prelude::*;
use std::fs::{self, File};
use std::io::{self, BufWriter, Write};
use std::path::{Path, PathBuf};

pub const ISO_MIN_PT: f32 = 3.0;
pub const ISO_MAX_PT: f32 = 14400.0;
const A4_WIDTH_PT: f32 = 595.28;
const A4_HEIGHT_PT: f32 = 841.89;
const LETTER_WIDTH_PT: f32 = 612.0;
const LETTER_HEIGHT_PT: f32 = 792.0;

const PDF_HEADER: &[u8] = b"%PDF-1.5\n%\xE2\xE3\xCF\xD3\n";
const STREAM_BUF_CAPACITY: usize = 256 * 1024;
const PAGE_STRUCT_OVERHEAD: u64 = 700;
const TAIL_OVERHEAD: u64 = 2048;

struct PreparedDraftResult {
    image: PreparedImage,
    duration_ms: Option<u32>,
    label: String,
    passthrough: bool,
    embedded_gif: Option<(Vec<u8>, String)>,
}

pub(crate) struct TempFilesGuard {
    paths: Vec<PathBuf>,
    pub(crate) committed: bool,
}

impl TempFilesGuard {
    pub(crate) fn new() -> Self {
        Self {
            paths: Vec::new(),
            committed: false,
        }
    }

    pub(crate) fn register(&mut self, path: PathBuf) {
        self.paths.push(path);
    }
}

impl Drop for TempFilesGuard {
    fn drop(&mut self) {
        if !self.committed {
            for p in &self.paths {
                let _ = fs::remove_file(p);
            }
        }
    }
}

pub(crate) struct CountingWriter<W: Write> {
    inner: W,
    bytes_written: u64,
}

impl<W: Write> CountingWriter<W> {
    pub(crate) fn new(inner: W) -> Self {
        Self {
            inner,
            bytes_written: 0,
        }
    }
}

impl<W: Write> Write for CountingWriter<W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let n = self.inner.write(buf)?;
        self.bytes_written += n as u64;
        Ok(n)
    }

    fn write_all(&mut self, buf: &[u8]) -> io::Result<()> {
        self.inner.write_all(buf)?;
        self.bytes_written += buf.len() as u64;
        Ok(())
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

/// Ghi file PDF trực tiếp ra writer/ổ cứng theo từng object/trang, tránh giữ bản sao stream hoặc toàn bộ file PDF trong RAM.
pub(crate) struct StreamingPdfWriter<W: Write = BufWriter<File>> {
    w: CountingWriter<W>,
    offsets: Vec<u64>,
    next_id: u32,
    page_ids: Vec<u32>,
}

impl StreamingPdfWriter<BufWriter<File>> {
    pub(crate) fn create(path: &Path) -> Result<Self> {
        let file = File::create(path)?;
        Self::from_writer(BufWriter::with_capacity(STREAM_BUF_CAPACITY, file))
    }
}

impl<W: Write> StreamingPdfWriter<W> {
    pub(crate) fn from_writer(writer: W) -> Result<Self> {
        let mut w = CountingWriter::new(writer);
        w.write_all(PDF_HEADER)?;
        // Object ID 1 được dành riêng cho /Type /Pages (sẽ ghi ở `finish` sau khi có đủ Kids).
        Ok(Self {
            w,
            offsets: vec![0, 0],
            next_id: 2,
            page_ids: Vec::new(),
        })
    }

    pub(crate) fn bytes_written(&self) -> u64 {
        self.w.bytes_written
    }

    pub(crate) fn page_count(&self) -> usize {
        self.page_ids.len()
    }

    pub(crate) fn set_page_ids(&mut self, page_ids: Vec<u32>) {
        self.page_ids = page_ids;
    }

    pub(crate) fn alloc_id(&mut self) -> u32 {
        let id = self.next_id;
        self.next_id = self
            .next_id
            .checked_add(1)
            .expect("PDF object id overflow");
        if self.offsets.len() <= id as usize {
            self.offsets.resize(id as usize + 1, 0);
        }
        id
    }

    fn begin_obj(&mut self, id: u32) -> io::Result<()> {
        if self.offsets.len() <= id as usize {
            self.offsets.resize(id as usize + 1, 0);
        }
        self.offsets[id as usize] = self.w.bytes_written;
        writeln!(self.w, "{id} 0 obj")
    }

    pub(crate) fn write_lopdf_object(&mut self, id: u32, obj: &lopdf::Object) -> Result<()> {
        self.begin_obj(id)?;
        lopdf::Writer::write_object(&mut self.w, obj)
            .map_err(|e| KnitError::InvalidInput(format!("Loi ghi PDF object {id}: {e}")))?;
        writeln!(self.w, "\nendobj")?;
        Ok(())
    }

    fn write_page(
        &mut self,
        image: PreparedImage,
        layout: PageLayoutPolicy,
        duration_ms: Option<u32>,
        embedded_gif: Option<(Vec<u8>, String)>,
    ) -> Result<()> {
        let img_id = self.alloc_id();
        self.begin_obj(img_id)?;

        let (img_w, img_h) = match image {
            PreparedImage::JpegStream {
                bytes,
                width,
                height,
                color_space,
                ..
            } => {
                let cs_name = pdf_color_space_name(color_space);
                writeln!(
                    self.w,
                    "<< /Type /XObject /Subtype /Image /Width {width} /Height {height} /ColorSpace {cs_name} /BitsPerComponent 8 /Filter /DCTDecode /Length {} >>",
                    bytes.len()
                )?;
                self.w.write_all(b"stream\n")?;
                self.w.write_all(&bytes)?;
                self.w.write_all(b"\nendstream\nendobj\n")?;
                // Giải phóng ngay buffer ảnh sau khi đã đẩy vào BufWriter.
                drop(bytes);
                (width, height)
            }
            PreparedImage::FlateStream {
                zlib_bytes,
                width,
                height,
                color_space,
                png_predictor_colors,
                ..
            } => {
                let cs_name = pdf_color_space_name(color_space);
                if let Some(colors) = png_predictor_colors {
                    writeln!(
                        self.w,
                        "<< /Type /XObject /Subtype /Image /Width {width} /Height {height} /ColorSpace {cs_name} /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors {colors} /BitsPerComponent 8 /Columns {width} >> /Length {} >>",
                        zlib_bytes.len()
                    )?;
                } else {
                    writeln!(
                        self.w,
                        "<< /Type /XObject /Subtype /Image /Width {width} /Height {height} /ColorSpace {cs_name} /BitsPerComponent 8 /Filter /FlateDecode /Length {} >>",
                        zlib_bytes.len()
                    )?;
                }
                self.w.write_all(b"stream\n")?;
                self.w.write_all(&zlib_bytes)?;
                self.w.write_all(b"\nendstream\nendobj\n")?;
                drop(zlib_bytes);
                (width, height)
            }
        };

        let (page_w, page_h, draw_x, draw_y, draw_w, draw_h) =
            compute_page_box(img_w, img_h, layout);
        let bg_cmd = page_background_command(layout, page_w, page_h);
        let content_str = format!(
            "{bg_cmd}q {draw_w:.4} 0 0 {draw_h:.4} {draw_x:.4} {draw_y:.4} cm /Im0 Do Q"
        );
        let content_bytes = content_str.as_bytes();

        let content_id = self.alloc_id();
        self.begin_obj(content_id)?;
        writeln!(self.w, "<< /Length {} >>", content_bytes.len())?;
        self.w.write_all(b"stream\n")?;
        self.w.write_all(content_bytes)?;
        self.w.write_all(b"\nendstream\nendobj\n")?;

        let resources_id = self.alloc_id();
        self.begin_obj(resources_id)?;
        writeln!(self.w, "<< /XObject << /Im0 {img_id} 0 R >> >>\nendobj")?;

        let page_id = self.alloc_id();
        let annot_ids = if let Some((gif_bytes, gif_name)) = embedded_gif {
            let ef_stream_id = self.alloc_id();
            self.begin_obj(ef_stream_id)?;
            writeln!(
                self.w,
                "<< /Type /EmbeddedFile /Subtype /image#2Fgif /Params << /Size {} >> /Length {} >>",
                gif_bytes.len(),
                gif_bytes.len()
            )?;
            self.w.write_all(b"stream\n")?;
            self.w.write_all(&gif_bytes)?;
            self.w.write_all(b"\nendstream\nendobj\n")?;
            drop(gif_bytes);

            let filespec_id = self.alloc_id();
            self.begin_obj(filespec_id)?;
            write!(self.w, "<< /Type /Filespec /F ")?;
            write_pdf_string(&mut self.w, &gif_name)?;
            write!(self.w, " /UF ")?;
            write_pdf_string(&mut self.w, &gif_name)?;
            writeln!(
                self.w,
                " /EF << /F {ef_stream_id} 0 R /UF {ef_stream_id} 0 R >> >>\nendobj"
            )?;

            let media_clip_id = self.alloc_id();
            self.begin_obj(media_clip_id)?;
            write!(self.w, "<< /Type /MediaClip /S /MCD /N ")?;
            write_pdf_string(&mut self.w, &gif_name)?;
            writeln!(
                self.w,
                " /CT (image/gif) /D {filespec_id} 0 R /P << /TF (TEMPNEVER) >> >>\nendobj"
            )?;

            let rendition_id = self.alloc_id();
            self.begin_obj(rendition_id)?;
            write!(self.w, "<< /Type /Rendition /S /MR /N ")?;
            write_pdf_string(&mut self.w, &gif_name)?;
            writeln!(self.w, " /C {media_clip_id} 0 R >>\nendobj")?;

            let x2 = draw_x + draw_w;
            let y2 = draw_y + draw_h;
            let screen_annot_id = self.alloc_id();
            self.begin_obj(screen_annot_id)?;
            write!(
                self.w,
                "<< /Type /Annot /Subtype /Screen /Rect [{draw_x:.4} {draw_y:.4} {x2:.4} {y2:.4}] /F 4 /P {page_id} 0 R /T "
            )?;
            write_pdf_string(&mut self.w, &gif_name)?;
            writeln!(
                self.w,
                " /A << /S /Rendition /OP 0 /R {rendition_id} 0 R /AN {screen_annot_id} 0 R >> /AA << /PO << /S /Rendition /OP 0 /R {rendition_id} 0 R /AN {screen_annot_id} 0 R >> /PV << /S /Rendition /OP 0 /R {rendition_id} 0 R /AN {screen_annot_id} 0 R >> >> >>\nendobj"
            )?;

            let richmedia_config_id = self.alloc_id();
            self.begin_obj(richmedia_config_id)?;
            writeln!(
                self.w,
                "<< /Type /RichMediaConfiguration /Subtype /Video /Instances [<< /Type /RichMediaInstance /Subtype /Video /Asset {filespec_id} 0 R >>] >>\nendobj"
            )?;

            let richmedia_content_id = self.alloc_id();
            self.begin_obj(richmedia_content_id)?;
            write!(self.w, "<< /Type /RichMediaContent /Assets << /Names [")?;
            write_pdf_string(&mut self.w, &gif_name)?;
            writeln!(
                self.w,
                " {filespec_id} 0 R] >> /Configurations [{richmedia_config_id} 0 R] >>\nendobj"
            )?;

            let richmedia_settings_id = self.alloc_id();
            self.begin_obj(richmedia_settings_id)?;
            writeln!(
                self.w,
                "<< /Type /RichMediaSettings /Activation << /Condition /PO /Presentation << /Style /Embedded >> >> /Deactivation << /Condition /PC >> >>\nendobj"
            )?;

            let richmedia_annot_id = self.alloc_id();
            self.begin_obj(richmedia_annot_id)?;
            writeln!(
                self.w,
                "<< /Type /Annot /Subtype /RichMedia /Rect [{draw_x:.4} {draw_y:.4} {x2:.4} {y2:.4}] /F 4 /P {page_id} 0 R /RichMediaContent {richmedia_content_id} 0 R /RichMediaSettings {richmedia_settings_id} 0 R >>\nendobj"
            )?;

            Some((screen_annot_id, richmedia_annot_id))
        } else {
            None
        };

        self.begin_obj(page_id)?;
        write!(
            self.w,
            "<< /Type /Page /Parent 1 0 R /MediaBox [0 0 {page_w} {page_h}] /Resources {resources_id} 0 R /Contents {content_id} 0 R"
        )?;
        if let Some((screen_id, richmedia_id)) = annot_ids {
            write!(self.w, " /Annots [{screen_id} 0 R {richmedia_id} 0 R]")?;
        }
        if let Some(ms) = duration_ms {
            write!(self.w, " /Dur {:.6}", (ms as f32) / 1000.0)?;
        }
        writeln!(self.w, " >>\nendobj")?;

        self.page_ids.push(page_id);
        Ok(())
    }

    fn write_outline_items(
        &mut self,
        parent_id: u32,
        nodes: &[BookmarkNode],
    ) -> io::Result<(u32, u32, usize)> {
        let ids: Vec<u32> = (0..nodes.len()).map(|_| self.alloc_id()).collect();
        let first_id = ids[0];
        let last_id = *ids.last().unwrap();

        for (i, node) in nodes.iter().enumerate() {
            let item_id = ids[i];
            let prev_id = i.checked_sub(1).map(|p| ids[p]);
            let next_id = ids.get(i + 1).copied();

            let children_meta = if !node.children.is_empty() {
                Some(self.write_outline_items(item_id, &node.children)?)
            } else {
                None
            };

            let target_idx = node
                .target_page_index
                .min(self.page_ids.len().saturating_sub(1));
            let page_id = self.page_ids[target_idx];
            let action_id = self.alloc_id();
            self.begin_obj(action_id)?;
            writeln!(self.w, "<< /S /GoTo /D [{page_id} 0 R /Fit] >>\nendobj")?;

            self.begin_obj(item_id)?;
            write!(self.w, "<< /Parent {parent_id} 0 R /Title ")?;
            write_pdf_string(&mut self.w, &node.title)?;
            write!(self.w, " /A {action_id} 0 R /F 0 /C [0 0 0]")?;
            if let Some(prev) = prev_id {
                write!(self.w, " /Prev {prev} 0 R")?;
            }
            if let Some(next) = next_id {
                write!(self.w, " /Next {next} 0 R")?;
            }
            if let Some((c_first, c_last, c_count)) = children_meta {
                write!(
                    self.w,
                    " /First {c_first} 0 R /Last {c_last} 0 R /Count {c_count}"
                )?;
            }
            writeln!(self.w, " >>\nendobj")?;
        }

        Ok((first_id, last_id, nodes.len()))
    }

    pub(crate) fn finish(mut self, bookmarks: &[BookmarkNode]) -> Result<u64> {
        // Ghi object 1 (/Pages) với đầy đủ danh sách Kids.
        self.begin_obj(1)?;
        self.w.write_all(b"<< /Type /Pages /Kids [")?;
        for (idx, page_id) in self.page_ids.iter().enumerate() {
            if idx > 0 {
                self.w.write_all(b" ")?;
            }
            write!(self.w, "{page_id} 0 R")?;
        }
        writeln!(self.w, "] /Count {} >>\nendobj", self.page_ids.len())?;

        let outlines_id = if !bookmarks.is_empty() && !self.page_ids.is_empty() {
            let oid = self.alloc_id();
            let (first, last, count) = self.write_outline_items(oid, bookmarks)?;
            self.begin_obj(oid)?;
            writeln!(
                self.w,
                "<< /Type /Outlines /First {first} 0 R /Last {last} 0 R /Count {count} >>\nendobj"
            )?;
            Some(oid)
        } else {
            None
        };

        let catalog_id = self.alloc_id();
        self.begin_obj(catalog_id)?;
        write!(self.w, "<< /Type /Catalog /Pages 1 0 R")?;
        if let Some(oid) = outlines_id {
            write!(self.w, " /Outlines {oid} 0 R")?;
        }
        writeln!(self.w, " >>\nendobj")?;

        let xref_offset = self.w.bytes_written;
        let total_objects = self.next_id;
        writeln!(self.w, "xref")?;
        writeln!(self.w, "0 {total_objects}")?;
        writeln!(self.w, "0000000000 65535 f ")?;
        for id in 1..total_objects {
            let offset = self.offsets[id as usize];
            writeln!(self.w, "{offset:010} 00000 n ")?;
        }

        writeln!(
            self.w,
            "trailer\n<< /Size {total_objects} /Root {catalog_id} 0 R >>\nstartxref\n{xref_offset}\n%%EOF"
        )?;
        self.w.flush()?;
        Ok(self.w.bytes_written)
    }
}

fn write_pdf_string<W: Write>(w: &mut W, text: &str) -> io::Result<()> {
    if text.bytes().all(|b| (0x20..=0x7E).contains(&b)) {
        w.write_all(b"(")?;
        for &b in text.as_bytes() {
            match b {
                b'\\' => w.write_all(b"\\\\")?,
                b'(' => w.write_all(b"\\(")?,
                b')' => w.write_all(b"\\)")?,
                _ => w.write_all(&[b])?,
            }
        }
        w.write_all(b")")
    } else {
        w.write_all(b"<FEFF")?;
        for unit in text.encode_utf16() {
            write!(w, "{unit:04X}")?;
        }
        w.write_all(b">")
    }
}

fn pdf_color_space_name(cs: PdfColorSpace) -> &'static str {
    match cs {
        PdfColorSpace::DeviceRgb => "/DeviceRGB",
        PdfColorSpace::DeviceGray => "/DeviceGray",
    }
}

/// Dựng 1 hoặc nhiều file PDF (khi bật `max_mb` / `max_pages_per_file`) bằng cách ghi streaming từng trang ra file,
/// giữ RAM ở mức thấp ổn định kể cả khi xử lý tập ảnh nhiều GB.
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

    let mode = config.export_mode;
    if let Some(parent) = config.output_path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
            if mode != PdfExportMode::Fast {
                let est_input_bytes: u64 = drafts
                    .iter()
                    .map(estimate_draft_input_bytes)
                    .sum::<u64>()
                    .saturating_add(65536);
                let needed = if mode == PdfExportMode::Safe {
                    est_input_bytes.saturating_mul(2)
                } else {
                    est_input_bytes
                };
                ensure_disk_space(parent, needed)?;
            }
        }
    }

    let (effective_drafts, effective_bookmarks) =
        expand_drafts_for_animated_policy(drafts, bookmarks, config.animated_policy)?;
    let drafts = effective_drafts.as_slice();
    let bookmarks = effective_bookmarks.as_slice();

    // Mode 1 (Fast): luôn xuất 1 file PDF duy nhất, bỏ qua split rules.
    let (max_bytes, max_pages_per_file) = if mode == PdfExportMode::Fast {
        (None, None)
    } else {
        (
            config
                .max_mb
                .filter(|&mb| mb > 0.0)
                .map(|mb| (mb * 1024.0 * 1024.0) as usize),
            config.max_pages_per_file.filter(|&n| n > 0),
        )
    };
    let total = drafts.len();

    let mode_label = match mode {
        PdfExportMode::Fast => "Fast",
        PdfExportMode::Balanced => "Balanced",
        PdfExportMode::Safe => "Safe",
    };
    reporter.info(format!(
        "Processing & writing {} images -> PDF (mode: {})",
        total, mode_label
    ));

    let cpus = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    let (worker_threads, batch_size) = match mode {
        PdfExportMode::Fast => (cpus.clamp(4, 8), 24usize),
        PdfExportMode::Balanced => (cpus.clamp(2, 4), (cpus.clamp(2, 4) * 2).clamp(4, 8)),
        PdfExportMode::Safe => (cpus.clamp(2, 4), 4usize),
    };
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(worker_threads)
        .build()
        .ok();

    let mut guard = TempFilesGuard::new();
    let mut part_index = 1usize;
    let first_tmp = part_temp_path(&config.output_path, part_index);
    guard.register(first_tmp.clone());

    let mut current_tmp = first_tmp;
    let mut current_part_start = 0usize;
    let mut writer = Some(StreamingPdfWriter::create(&current_tmp)?);
    let mut finished_parts: Vec<PathBuf> = Vec::new();
    let mut total_bytes = 0u64;
    let mut passthrough_pages = 0usize;
    let mut global_page_idx = 0usize;

    for chunk in drafts.chunks(batch_size) {
        if cancel.is_cancelled() {
            return Err(KnitError::Cancelled);
        }

        let prepare_chunk = || -> Vec<Result<PreparedDraftResult>> {
            chunk
                .par_iter()
                .map(|draft| {
                    if cancel.is_cancelled() {
                        return Err(KnitError::Cancelled);
                    }
                    let image = prepare_page_for_pdf_with_mode(
                        draft,
                        config.jpeg_quality,
                        config.lossless_passthrough,
                        mode,
                    )?;
                    let passthrough = matches!(
                        image,
                        PreparedImage::JpegStream {
                            passthrough: true,
                            ..
                        } | PreparedImage::FlateStream {
                            passthrough: true,
                            ..
                        }
                    );
                    let embedded_gif = if config.animated_policy == AnimatedImagePolicy::EmbedRichMedia {
                        if let PageSource::ImageFile { ref path } = draft.source {
                            let is_gif = path
                                .extension()
                                .and_then(|e| e.to_str())
                                .is_some_and(|e| e.eq_ignore_ascii_case("gif"));
                            if is_gif && probe_animation_frames(path).ok().flatten().is_some() {
                                let gif_bytes = std::fs::read(path)?;
                                let gif_name = path
                                    .file_name()
                                    .and_then(|n| n.to_str())
                                    .unwrap_or("animation.gif")
                                    .to_string();
                                Some((gif_bytes, gif_name))
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    } else {
                        None
                    };
                    Ok(PreparedDraftResult {
                        image,
                        duration_ms: draft.duration_ms,
                        label: draft.label.clone(),
                        passthrough,
                        embedded_gif,
                    })
                })
                .collect()
        };

        let chunk_results = match pool.as_ref() {
            Some(p) => p.install(prepare_chunk),
            None => prepare_chunk(),
        };

        for res in chunk_results {
            if cancel.is_cancelled() {
                return Err(KnitError::Cancelled);
            }
            let item = res?;
            if item.passthrough {
                passthrough_pages += 1;
            }

            let stream_len = match &item.image {
                PreparedImage::JpegStream { bytes, .. } => bytes.len() as u64,
                PreparedImage::FlateStream { zlib_bytes, .. } => zlib_bytes.len() as u64,
            } + item
                .embedded_gif
                .as_ref()
                .map(|(b, _)| b.len() as u64)
                .unwrap_or(0);

            let cur_writer = writer.as_ref().expect("active StreamingPdfWriter");
            let exceeds_pages =
                max_pages_per_file.is_some_and(|limit| cur_writer.page_count() >= limit);
            let exceeds_bytes = max_bytes.is_some_and(|limit| {
                cur_writer.page_count() > 0
                    && cur_writer.bytes_written() + stream_len + PAGE_STRUCT_OVERHEAD + TAIL_OVERHEAD
                        > limit as u64
            });

            if exceeds_pages || exceeds_bytes {
                let done_writer = writer.take().expect("active StreamingPdfWriter");
                let part_bookmarks = remap_tree(bookmarks, current_part_start, global_page_idx);
                reporter.normal(format!(
                    "Finished part {} ({} pages)",
                    part_index,
                    global_page_idx - current_part_start
                ));
                total_bytes += done_writer.finish(&part_bookmarks)?;
                finished_parts.push(current_tmp.clone());

                part_index += 1;
                current_part_start = global_page_idx;
                current_tmp = part_temp_path(&config.output_path, part_index);
                guard.register(current_tmp.clone());
                writer = Some(StreamingPdfWriter::create(&current_tmp)?);
            }

            writer
                .as_mut()
                .expect("active StreamingPdfWriter")
                .write_page(item.image, config.layout, item.duration_ms, item.embedded_gif)?;

            global_page_idx += 1;
            if mode != PdfExportMode::Fast {
                reporter.detailed(format!(
                    "Processed page {global_page_idx}/{total}: {} ({})",
                    item.label,
                    if item.passthrough {
                        "passthrough"
                    } else {
                        "encode"
                    }
                ));
            }
            reporter.on_progress(JobProgress {
                phase: "pack".into(),
                done: global_page_idx as u64,
                total: total as u64,
                bytes_done: 0,
                bytes_total: 0,
                current_item: item.label,
            });
        }

        if global_page_idx % 64 < batch_size {
            trim_heap_if_supported();
        }
    }

    if cancel.is_cancelled() {
        return Err(KnitError::Cancelled);
    }

    if let Some(last_writer) = writer.take() {
        let part_bookmarks = remap_tree(bookmarks, current_part_start, global_page_idx);
        reporter.normal(format!(
            "Finalizing PDF ({} pages): {}",
            global_page_idx - current_part_start,
            config
                .output_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("output.pdf")
        ));
        total_bytes += last_writer.finish(&part_bookmarks)?;
        finished_parts.push(current_tmp);
    }

    let multi = finished_parts.len() > 1;
    let mut output_files = Vec::with_capacity(finished_parts.len());
    for (idx, tmp_path) in finished_parts.iter().enumerate() {
        let target_path = if multi {
            part_output_path(&config.output_path, idx + 1)
        } else {
            config.output_path.clone()
        };
        if target_path.exists() {
            let _ = fs::remove_file(&target_path);
        }
        fs::rename(tmp_path, &target_path)?;
        output_files.push(target_path);
    }
    guard.committed = true;

    reporter.on_progress(JobProgress {
        phase: "done".into(),
        done: total as u64,
        total: total as u64,
        bytes_done: total_bytes,
        bytes_total: total_bytes,
        current_item: "PDF creation complete".into(),
    });

    Ok(PdfBuildResult {
        output_files,
        total_pages: total,
        total_bytes,
        passthrough_pages,
    })
}

fn estimate_draft_input_bytes(draft: &PageDraft) -> u64 {
    if draft.file_size_bytes > 0 {
        return draft.file_size_bytes;
    }
    let path = match &draft.source {
        PageSource::ImageFile { path }
        | PageSource::AnimatedFrame { path, .. }
        | PageSource::PdfPage { path, .. } => path,
    };
    fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}

pub(crate) fn part_temp_path(base: &Path, part_1based: usize) -> PathBuf {
    let file_name = base
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("output.pdf");
    let tmp_name = format!(
        ".{file_name}.knit_tmp.{}.p{part_1based:02}",
        std::process::id()
    );
    base.with_file_name(tmp_name)
}

#[cfg(all(target_os = "linux", target_env = "gnu"))]
pub(crate) fn trim_heap_if_supported() {
    extern "C" {
        fn malloc_trim(pad: usize) -> std::ffi::c_int;
    }
    unsafe {
        let _ = malloc_trim(0);
    }
}

#[cfg(not(all(target_os = "linux", target_env = "gnu")))]
pub(crate) fn trim_heap_if_supported() {}

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

fn fit_page_box(
    iw: f32,
    ih: f32,
    page_w: f32,
    page_h: f32,
    margin_pt: f32,
) -> (f32, f32, f32, f32, f32, f32) {
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
