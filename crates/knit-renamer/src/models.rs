use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TargetType {
    Files,
    Folders,
    Both,
}

impl Default for TargetType {
    fn default() -> Self {
        Self::Both
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PatternKind {
    Glob,
    Regex,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FilterPattern {
    pub kind: PatternKind,
    pub pattern: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanFilter {
    pub target_type: TargetType,
    pub recursive: bool,
    pub max_depth: Option<usize>,
    pub ignore_hidden: bool,
    /// Đuôi file cho phép (ví dụ `["jpg", "png"]`), rỗng = không giới hạn đuôi.
    /// Lưu ý: nếu `target_type == Both`, thư mục không bị lọc theo đuôi file trừ khi người dùng bỏ chọn thư mục.
    pub include_extensions: Vec<String>,
    pub include_patterns: Vec<FilterPattern>,
    pub exclude_patterns: Vec<FilterPattern>,
}

impl Default for ScanFilter {
    fn default() -> Self {
        Self {
            target_type: TargetType::Both,
            recursive: false,
            max_depth: None,
            ignore_hidden: true,
            include_extensions: Vec::new(),
            include_patterns: Vec::new(),
            exclude_patterns: Vec::new(),
        }
    }
}

#[derive(Debug)]
pub struct FilterMatcher {
    pub(crate) include_exts: Vec<String>,
    pub(crate) includes: Vec<CompiledPattern>,
    pub(crate) excludes: Vec<CompiledPattern>,
}

#[derive(Debug)]
pub(crate) enum CompiledPattern {
    Glob(globset::GlobMatcher),
    Regex(regex::Regex),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FixedPresetKind {
    MangaChapter,
    MangaVolume,
    Pad2,
    Pad3,
    CleanTags,
    CleanWhitespace,
    NormalizeExtensions,
    Lowercase,
    Uppercase,
    Titlecase,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum RenameRule {
    FindReplace {
        find: String,
        replace: String,
        match_case: bool,
        use_regex: bool,
    },
    PerlPrename {
        expression: String,
    },
    FixedPreset {
        preset: FixedPresetKind,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RenameStatus {
    Unchanged,
    Pending,
    Conflict,
    Renamed,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenameItem {
    pub id: String,
    pub original_path: PathBuf,
    pub original_name: String,
    pub parent_dir: PathBuf,
    pub is_dir: bool,
    pub depth: usize,
    pub new_name: String,
    pub new_path: PathBuf,
    /// Checkbox chọn/bỏ chọn trên bảng Dry-Run Preview.
    pub selected: bool,
    pub status: RenameStatus,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RenamePlan {
    pub items: Vec<RenameItem>,
}

impl RenamePlan {
    pub fn total(&self) -> usize {
        self.items.len()
    }

    pub fn selected_pending_count(&self) -> usize {
        self.items
            .iter()
            .filter(|i| i.selected && i.status == RenameStatus::Pending)
            .count()
    }

    pub fn conflict_count(&self) -> usize {
        self.items
            .iter()
            .filter(|i| i.selected && i.status == RenameStatus::Conflict)
            .count()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPreset {
    pub id: String,
    pub title: String,
    pub description: String,
    pub rule: RenameRule,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UndoEntry {
    pub original_path: PathBuf,
    pub new_path: PathBuf,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UndoManifest {
    pub timestamp: String,
    pub entries: Vec<UndoEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenameExecutionResult {
    pub renamed_count: usize,
    pub skipped_count: usize,
    pub error_count: usize,
    pub undo_available: bool,
}
