use std::collections::{HashMap, HashSet};
use std::path::Path;

use globset::GlobBuilder;
use knit_core::{natural_cmp, KnitError, Result};
use regex::RegexBuilder;
use uuid::Uuid;
use walkdir::WalkDir;

use crate::models::{
    CompiledPattern, FilterMatcher, FilterPattern, PatternKind, RenameItem, RenamePlan,
    RenameStatus, ScanFilter, TargetType,
};

impl FilterMatcher {
    pub fn compile(filter: &ScanFilter) -> Result<Self> {
        let include_exts = filter
            .include_extensions
            .iter()
            .map(|e| e.trim().trim_start_matches('.').to_ascii_lowercase())
            .filter(|e| !e.is_empty())
            .collect();

        let includes = compile_patterns(&filter.include_patterns)?;
        let excludes = compile_patterns(&filter.exclude_patterns)?;

        Ok(Self {
            include_exts,
            includes,
            excludes,
        })
    }

    pub fn matches(&self, name: &str, is_dir: bool) -> bool {
        if !is_dir && !self.include_exts.is_empty() {
            let ext = Path::new(name)
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase())
                .unwrap_or_default();
            if !self.include_exts.contains(&ext) {
                return false;
            }
        }

        if !self.includes.is_empty() && !self.includes.iter().any(|p| p.is_match(name)) {
            return false;
        }
        if self.excludes.iter().any(|p| p.is_match(name)) {
            return false;
        }
        true
    }
}

impl CompiledPattern {
    fn is_match(&self, name: &str) -> bool {
        match self {
            Self::Glob(g) => g.is_match(name),
            Self::Regex(r) => r.is_match(name),
        }
    }
}

fn compile_patterns(patterns: &[FilterPattern]) -> Result<Vec<CompiledPattern>> {
    let mut out = Vec::new();
    for p in patterns {
        let pat = p.pattern.trim();
        if pat.is_empty() {
            continue;
        }
        match p.kind {
            PatternKind::Glob => {
                let glob = GlobBuilder::new(pat)
                    .case_insensitive(true)
                    .build()
                    .map_err(|e| KnitError::InvalidInput(format!("Glob không hợp lệ '{pat}': {e}")))?;
                out.push(CompiledPattern::Glob(glob.compile_matcher()));
            }
            PatternKind::Regex => {
                let re = RegexBuilder::new(pat)
                    .case_insensitive(true)
                    .build()
                    .map_err(|e| KnitError::InvalidInput(format!("Regex không hợp lệ '{pat}': {e}")))?;
                out.push(CompiledPattern::Regex(re));
            }
        }
    }
    Ok(out)
}

pub fn scan_items(root: &Path, filter: &ScanFilter) -> Result<Vec<RenameItem>> {
    if !root.exists() {
        return Err(KnitError::NotFound(root.display().to_string()));
    }

    let matcher = FilterMatcher::compile(filter)?;
    let mut items = Vec::new();

    if root.is_file() {
        let name = root
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string();
        if !matches!(filter.target_type, TargetType::Folders) && matcher.matches(&name, false) {
            let parent = root.parent().unwrap_or_else(|| Path::new("")).to_path_buf();
            items.push(RenameItem {
                id: Uuid::new_v4().to_string(),
                original_path: root.to_path_buf(),
                original_name: name.clone(),
                parent_dir: parent,
                is_dir: false,
                depth: 0,
                new_name: name,
                new_path: root.to_path_buf(),
                selected: true,
                status: RenameStatus::Unchanged,
                error_message: None,
            });
        }
        return Ok(items);
    }

    let max_depth = if !filter.recursive {
        1
    } else {
        filter.max_depth.filter(|&d| d > 0).unwrap_or(usize::MAX)
    };

    let walker = WalkDir::new(root)
        .min_depth(1)
        .max_depth(max_depth)
        .follow_links(false);

    for entry in walker {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().to_string();
        if filter.ignore_hidden && name.starts_with('.') {
            continue;
        }
        let is_dir = entry.file_type().is_dir();
        if matches!(filter.target_type, TargetType::Files) && is_dir {
            continue;
        }
        if matches!(filter.target_type, TargetType::Folders) && !is_dir {
            continue;
        }
        if !matcher.matches(&name, is_dir) {
            continue;
        }
        let path = entry.path().to_path_buf();
        let parent = path.parent().unwrap_or(root).to_path_buf();
        items.push(RenameItem {
            id: Uuid::new_v4().to_string(),
            original_path: path.clone(),
            original_name: name.clone(),
            parent_dir: parent,
            is_dir,
            depth: entry.depth(),
            new_name: name,
            new_path: path,
            selected: true,
            status: RenameStatus::Unchanged,
            error_message: None,
        });
    }

    items.sort_by(|a, b| {
        natural_cmp(
            &a.original_path.to_string_lossy(),
            &b.original_path.to_string_lossy(),
        )
    });
    Ok(items)
}

pub fn build_rename_plan<F>(mut items: Vec<RenameItem>, transform: F) -> RenamePlan
where
    F: Fn(&str) -> String,
{
    for item in &mut items {
        let raw_new = transform(&item.original_name);
        let trimmed = raw_new.trim();
        let new_name = if trimmed.is_empty() {
            item.original_name.clone()
        } else {
            trimmed.to_string()
        };
        item.new_path = item.parent_dir.join(&new_name);
        item.new_name = new_name;
        item.error_message = None;
        if item.new_name == item.original_name {
            item.status = RenameStatus::Unchanged;
        } else {
            item.status = RenameStatus::Pending;
        }
    }

    // Thứ tự Bottom-Up: node sâu nhất trước (file/thư mục con trước thư mục cha), cùng depth thì file trước thư mục
    items.sort_by(|a, b| {
        b.depth
            .cmp(&a.depth)
            .then_with(|| a.is_dir.cmp(&b.is_dir))
            .then_with(|| {
                natural_cmp(
                    &a.original_path.to_string_lossy(),
                    &b.original_path.to_string_lossy(),
                )
            })
    });

    let mut plan = RenamePlan { items };
    recompute_collisions(&mut plan);
    plan
}

/// Kiểm tra xung đột tên theo chuẩn case-insensitive (bảo vệ Windows/NTFS/exFAT)
/// dựa trên tập các dòng đang được tick `selected = true`.
pub fn recompute_collisions(plan: &mut RenamePlan) {
    let mut target_counts: HashMap<String, usize> = HashMap::new();
    let mut vacated_keys: HashSet<String> = HashSet::new();

    for item in &mut plan.items {
        item.error_message = None;
        if item.new_name == item.original_name {
            item.status = RenameStatus::Unchanged;
            continue;
        }
        item.status = RenameStatus::Pending;
        if item.selected {
            let new_key = item.new_path.to_string_lossy().to_lowercase();
            let orig_key = item.original_path.to_string_lossy().to_lowercase();
            *target_counts.entry(new_key.clone()).or_insert(0) += 1;
            if orig_key != new_key {
                vacated_keys.insert(orig_key);
            }
        }
    }

    let mut dir_entries_cache: HashMap<&Path, Option<HashSet<String>>> = HashMap::new();

    for item in &mut plan.items {
        if item.status != RenameStatus::Pending || !item.selected {
            continue;
        }
        let new_key = item.new_path.to_string_lossy().to_lowercase();
        let orig_key = item.original_path.to_string_lossy().to_lowercase();

        if target_counts.get(&new_key).copied().unwrap_or(0) > 1 {
            item.status = RenameStatus::Conflict;
            item.error_message =
                Some("Xung đột: nhiều file/folder cùng đổi sang tên này".to_string());
            continue;
        }

        let same_casefold_file = new_key == orig_key;
        if !same_casefold_file && !vacated_keys.contains(&new_key) {
            let parent = item.parent_dir.as_path();
            let exists_on_disk = match dir_entries_cache
                .entry(parent)
                .or_insert_with(|| {
                    std::fs::read_dir(parent).ok().map(|rd| {
                        rd.filter_map(|e| e.ok())
                            .map(|e| {
                                let name = e.file_name().to_string_lossy().into_owned();
                                if cfg!(unix) {
                                    name
                                } else {
                                    name.to_lowercase()
                                }
                            })
                            .collect::<HashSet<String>>()
                    })
                }) {
                Some(set) => {
                    if cfg!(unix) {
                        set.contains(&item.new_name)
                    } else {
                        set.contains(&item.new_name.to_lowercase())
                    }
                }
                None => item.new_path.exists(),
            };

            if exists_on_disk {
                item.status = RenameStatus::Conflict;
                item.error_message = Some(format!(
                    "Xung đột: đã tồn tại '{}' trên ổ đĩa",
                    item.new_name
                ));
            }
        }
    }
}
