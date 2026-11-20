use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MangaScanMode {
    Auto,
    Single,
    Library,
}

impl Default for MangaScanMode {
    fn default() -> Self {
        Self::Auto
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    Chapter,
    Volume,
    Arc,
}

impl NodeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Chapter => "chapter",
            Self::Volume => "volume",
            Self::Arc => "arc",
        }
    }

    pub fn display_prefix(self) -> &'static str {
        match self {
            Self::Chapter => "Chapter",
            Self::Volume => "Volume",
            Self::Arc => "Arc",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NodeRef {
    pub kind: NodeKind,
    pub order_index: f64,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoryInfo {
    pub title: String,
    pub summary: String,
    pub genres: Vec<String>,
    pub authors: Vec<String>,
    pub other_titles: Vec<String>,
    pub nation: String,
    pub nation_id: String,
    pub poster_id: String,
    pub story_type: String,
    pub status: String,
    #[serde(skip)]
    pub raw_cover_art: Option<String>,
    #[serde(skip)]
    pub raw: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Chapter {
    pub chain: Vec<NodeRef>,
    /// Đường dẫn tương đối dùng '/' ("" nếu nằm ngay gốc).
    pub folder: String,
    pub path: PathBuf,
    pub images: Vec<String>,
}

impl Chapter {
    pub fn title(&self) -> &str {
        self.chain.last().map(|n| n.title.as_str()).unwrap_or("")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Story {
    pub dir_name: String,
    pub path: PathBuf,
    pub info: Option<StoryInfo>,
    pub info_file: Option<String>,
    /// Đường dẫn tương đối dùng '/' trong thư mục truyện.
    pub cover: Option<String>,
    pub chapters: Vec<Chapter>,
    pub warnings: Vec<String>,
    #[serde(default)]
    pub total_bytes: u64,
}

impl Story {
    pub fn effective_title(&self) -> &str {
        self.info
            .as_ref()
            .map(|i| i.title.as_str())
            .filter(|t| !t.is_empty())
            .unwrap_or(&self.dir_name)
    }

    pub fn image_count(&self) -> usize {
        self.chapters.iter().map(|c| c.images.len()).sum()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MangaPackOptions {
    /// Bật chế độ xuất tương thích Mangament Server (`stories.csv` + `info.json`).
    pub mangament_package_mode: bool,
    /// Mức nén cho ảnh (`0` = STORE khuyến nghị; `1..=9` = DEFLATE).
    pub image_compression: u8,
    /// Chia nhiều ZIP nếu > `max_gb` (<= 0.0: 1 file ZIP duy nhất).
    pub max_gb: f64,
}

impl Default for MangaPackOptions {
    fn default() -> Self {
        Self {
            mangament_package_mode: false,
            image_compression: 0,
            max_gb: 0.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MangaPackSummary {
    pub created_files: Vec<PathBuf>,
    pub stories_count: usize,
    pub total_files: usize,
    pub total_input_bytes: u64,
}
