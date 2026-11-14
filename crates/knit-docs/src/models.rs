use serde::{Deserialize, Serialize};
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
    DejaVuSansMono,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocConvertOptions {
    #[serde(default)]
    pub page_size: PageSizePreset,
    #[serde(default = "default_margin_mm")]
    pub margin_mm: f32,
    #[serde(default = "default_font_size_pt")]
    pub font_size_pt: f32,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub include_toc: bool,
    #[serde(default)]
    pub theme: DocTheme,
    #[serde(default)]
    pub font: DocFont,
}

impl Default for DocConvertOptions {
    fn default() -> Self {
        Self {
            page_size: PageSizePreset::A4,
            margin_mm: default_margin_mm(),
            font_size_pt: default_font_size_pt(),
            title: None,
            include_toc: false,
            theme: DocTheme::GitHub,
            font: DocFont::Default,
        }
    }
}

fn default_margin_mm() -> f32 {
    20.0
}

fn default_font_size_pt() -> f32 {
    11.0
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
