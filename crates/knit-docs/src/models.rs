use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DocInputKind {
    Markdown,
    PlainText,
    Html,
    Epub,
    Docx,
    Pptx,
}

impl DocInputKind {
    pub fn from_path(path: &Path) -> Option<Self> {
        let ext = path.extension()?.to_string_lossy().to_ascii_lowercase();
        match ext.as_str() {
            "md" | "markdown" => Some(Self::Markdown),
            "txt" | "log" | "rst" => Some(Self::PlainText),
            "html" | "htm" | "xhtml" => Some(Self::Html),
            "epub" => Some(Self::Epub),
            "docx" => Some(Self::Docx),
            "pptx" => Some(Self::Pptx),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum PageSizePreset {
    #[default]
    A4,
    Letter,
    A5,
}

impl PageSizePreset {
    pub fn typst_name(self) -> &'static str {
        match self {
            Self::A4 => "a4",
            Self::Letter => "us-letter",
            Self::A5 => "a5",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum DocTheme {
    #[default]
    #[serde(rename = "github")]
    GitHub,
    Academic,
    Minimal,
    Modern,
    Resume,
    VsCodeLight,
    Obsidian,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum DocFont {
    #[default]
    Default,
    Afacad,
    Roboto,
    Lora,
    LibertinusSerif,
    NewComputerModern,
    #[serde(rename = "dejavu_sans_mono", alias = "deja_vu_sans_mono")]
    DejaVuSansMono,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum PageOrientation {
    #[default]
    Portrait,
    Landscape,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum PageNumberPosition {
    #[default]
    BottomCenter,
    BottomRight,
    BottomLeft,
    TopCenter,
    TopLeft,
    TopRight,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum PageNumberFormat {
    #[default]
    NumberOnly,
    PageOfTotal,
    PageLabel,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PageNumberingOptions {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_one_u32")]
    pub start_number: u32,
    #[serde(default = "default_one_u32")]
    pub start_from_page: u32,
    #[serde(default)]
    pub position: PageNumberPosition,
    #[serde(default)]
    pub format: PageNumberFormat,
    #[serde(default)]
    pub label_prefix: Option<String>,
}

impl Default for PageNumberingOptions {
    fn default() -> Self {
        Self {
            enabled: true,
            start_number: 1,
            start_from_page: 1,
            position: PageNumberPosition::BottomCenter,
            format: PageNumberFormat::NumberOnly,
            label_prefix: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocConvertOptions {
    #[serde(default)]
    pub page_size: PageSizePreset,
    #[serde(default)]
    pub orientation: PageOrientation,
    #[serde(default = "default_margin_mm")]
    pub margin_mm: f32,
    #[serde(default = "default_font_size_pt")]
    pub font_size_pt: f32,
    #[serde(default)]
    pub line_spacing: Option<f32>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub include_toc: bool,
    #[serde(default = "default_toc_page")]
    pub toc_page: usize,
    #[serde(default)]
    pub page_numbering: PageNumberingOptions,
    #[serde(default)]
    pub theme: DocTheme,
    #[serde(default)]
    pub font: DocFont,
    #[serde(default)]
    pub mermaid_svgs: HashMap<String, String>,
}

impl Default for DocConvertOptions {
    fn default() -> Self {
        Self {
            page_size: PageSizePreset::A4,
            orientation: PageOrientation::Portrait,
            margin_mm: default_margin_mm(),
            font_size_pt: default_font_size_pt(),
            line_spacing: None,
            title: None,
            include_toc: false,
            toc_page: default_toc_page(),
            page_numbering: PageNumberingOptions::default(),
            theme: DocTheme::GitHub,
            font: DocFont::Default,
            mermaid_svgs: HashMap::new(),
        }
    }
}

fn default_margin_mm() -> f32 {
    20.0
}

fn default_font_size_pt() -> f32 {
    11.0
}

fn default_true() -> bool {
    true
}

fn default_one_u32() -> u32 {
    1
}

fn default_toc_page() -> usize {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineStatus {
    pub libreoffice_available: bool,
    pub executable_path: Option<PathBuf>,
    pub version_text: Option<String>,
    pub checked_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocConvertResult {
    pub input_path: PathBuf,
    pub output_path: PathBuf,
    pub kind: DocInputKind,
    pub page_count: Option<usize>,
    pub bytes_written: u64,
    pub used_external_engine: bool,
}
