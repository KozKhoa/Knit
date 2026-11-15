use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Nguồn gốc của một trang trong pipeline Image -> PDF hoặc PDF Editor.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PageSource {
    ImageFile { path: PathBuf },
    PdfPage { path: PathBuf, page_index: usize },
    AnimatedFrame { path: PathBuf, frame_index: usize },
}

/// Vùng crop chuẩn hóa [0.0, 1.0] theo kích thước ảnh gốc (sau EXIF orientation).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct CropRect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

/// Nhãn văn bản UTF-8 đặt lên trang ảnh (tọa độ chuẩn hóa [0.0, 1.0]).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TextAnnotation {
    pub id: String,
    pub text: String,
    pub x: f32,
    pub y: f32,
    /// Tỉ lệ chiều cao chữ so với chiều cao ảnh sau crop/rotate (vd: 0.04 = 4%).
    pub font_size_ratio: f32,
    /// Màu hex `#RRGGBB` hoặc `#RRGGBBAA`.
    pub color_hex: String,
}

/// Nét vẽ tự do (polyline) đặt lên trang ảnh (tọa độ chuẩn hóa [0.0, 1.0]).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StrokeAnnotation {
    pub id: String,
    pub points: Vec<[f32; 2]>,
    /// Độ dày nét tính theo tỉ lệ cạnh nhỏ nhất của ảnh (vd: 0.006).
    pub stroke_width_ratio: f32,
    pub color_hex: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct AnnotationLayer {
    #[serde(default)]
    pub texts: Vec<TextAnnotation>,
    #[serde(default)]
    pub strokes: Vec<StrokeAnnotation>,
}

/// Trạng thái biên tập không phá hủy của 1 trang.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PageDraft {
    pub id: String,
    pub source: PageSource,
    /// Góc xoay thêm (0, 90, 180, 270).
    #[serde(default)]
    pub rotation_deg: i32,
    #[serde(default)]
    pub crop: Option<CropRect>,
    #[serde(default)]
    pub annotations: AnnotationLayer,
    /// Thời lượng frame tính bằng mili-giây (nếu đến từ GIF/WebP động -> PDF /Dur).
    #[serde(default)]
    pub duration_ms: Option<u32>,
    pub label: String,
    #[serde(default)]
    pub width_px: u32,
    #[serde(default)]
    pub height_px: u32,
    #[serde(default)]
    pub file_size_bytes: u64,
}

impl PageDraft {
    pub fn has_pixel_edits(&self) -> bool {
        self.rotation_deg.rem_euclid(360) != 0
            || self.crop.is_some()
            || !self.annotations.texts.is_empty()
            || !self.annotations.strokes.is_empty()
    }
}

/// Node cây mục lục (PDF Outline / Bookmark), trỏ về 0-based page index.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BookmarkNode {
    pub title: String,
    pub target_page_index: usize,
    #[serde(default)]
    pub children: Vec<BookmarkNode>,
}

/// Màu nền trang PDF khi xuất theo khổ cố định (A4 / Letter).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PageBackground {
    /// Không tô nền (mặc định của trình đọc PDF / trong suốt).
    #[default]
    Transparent,
    White,
    Black,
    Custom { r: u8, g: u8, b: u8 },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum PageLayoutPolicy {
    /// Giữ nguyên tỉ lệ ảnh theo DPI (mặc định 72 DPI = 1px = 1pt), clamp trong [3.0, 14400.0] pt.
    OriginalSize { dpi: f32 },
    /// Khổ A4 (595.28 x 841.89 pt) với lề (pt) & màu nền tùy chọn, ảnh fit giữ tỉ lệ.
    FitA4 {
        margin_pt: f32,
        #[serde(default)]
        background: PageBackground,
    },
    /// Khổ Letter (612.0 x 792.0 pt) với lề (pt) & màu nền tùy chọn, ảnh fit giữ tỉ lệ.
    FitLetter {
        margin_pt: f32,
        #[serde(default)]
        background: PageBackground,
    },
}

impl Default for PageLayoutPolicy {
    fn default() -> Self {
        Self::OriginalSize { dpi: 72.0 }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AnimatedImagePolicy {
    #[default]
    FirstFrameOnly,
    UnpackAllFrames,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Image2PdfConfig {
    pub output_path: PathBuf,
    #[serde(default)]
    pub layout: PageLayoutPolicy,
    #[serde(default = "default_jpeg_quality")]
    pub jpeg_quality: u8,
    /// Nếu true, giữ nguyên stream JPEG (/DCTDecode) hoặc nén lossless PNG (/FlateDecode) cho trang chưa sửa.
    #[serde(default = "default_true")]
    pub lossless_passthrough: bool,
    #[serde(default)]
    pub animated_policy: AnimatedImagePolicy,
    #[serde(default)]
    pub max_mb: Option<f64>,
    #[serde(default)]
    pub max_pages_per_file: Option<usize>,
}

fn default_jpeg_quality() -> u8 {
    88
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageScanResult {
    pub pages: Vec<PageDraft>,
    pub bookmarks: Vec<BookmarkNode>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfInfo {
    pub path: PathBuf,
    pub page_count: usize,
    pub file_size_bytes: u64,
    pub bookmarks: Vec<BookmarkNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageSelection {
    pub file_index: usize,
    pub page_index: usize,
    #[serde(default)]
    pub rotation_deg: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfMergeConfig {
    pub inputs: Vec<PathBuf>,
    #[serde(default)]
    pub selected_pages: Option<Vec<PageSelection>>,
    pub output_path: PathBuf,
    #[serde(default = "default_true")]
    pub preserve_bookmarks: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfSplitGroup {
    pub name: String,
    pub pages: Vec<PageSelection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "rule", rename_all = "snake_case")]
pub enum PdfSplitRule {
    PageRanges { ranges: String },
    EveryNPages { n: usize },
    ExtractSelected { page_indices: Vec<usize> },
    MaxBytes { max_mb: f64 },
    CustomGroups { groups: Vec<PdfSplitGroup> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdfBuildResult {
    pub output_files: Vec<PathBuf>,
    pub total_pages: usize,
    pub total_bytes: u64,
    pub passthrough_pages: usize,
}
