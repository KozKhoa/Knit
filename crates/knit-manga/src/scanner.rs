use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::OnceLock;

use knit_core::{
    natural_cmp, natural_sort_by, safe_join_within, JobReporter, JobReporterExt, KnitError, Result,
};
use regex::Regex;
use serde_json::Value;

use crate::models::{Chapter, MangaScanMode, NodeKind, NodeRef, Story, StoryInfo};
use crate::naming::parse_node_folder_name;

const IMG_EXTS: &[&str] = &["jpg", "jpeg", "png", "webp", "avif", "gif"];

fn is_image_name(name: &str) -> bool {
    if name.starts_with('.') {
        return false;
    }
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|ext| IMG_EXTS.contains(&ext.to_ascii_lowercase().as_str()))
}

fn cover_priority(name: &str) -> Option<(u8, &str)> {
    static RE_COVER: OnceLock<Regex> = OnceLock::new();
    let re = RE_COVER
        .get_or_init(|| Regex::new(r"(?i)^(cover_art|cover|poster)\.(jpe?g|png|webp|avif)$").unwrap());
    let caps = re.captures(name)?;
    let prio = match caps[1].to_ascii_lowercase().as_str() {
        "cover_art" => 0,
        "cover" => 1,
        _ => 2,
    };
    Some((prio, name))
}

fn json_first_str(map: &serde_json::Map<String, Value>, keys: &[&str], default: &str) -> String {
    for k in keys {
        if let Some(v) = map.get(*k) {
            match v {
                Value::String(s) if !s.trim().is_empty() => return s.clone(),
                Value::Number(n) => return n.to_string(),
                Value::Bool(b) => return b.to_string(),
                _ => {}
            }
        }
    }
    default.to_string()
}

fn json_to_list(map: &serde_json::Map<String, Value>, keys: &[&str]) -> Vec<String> {
    static RE_SPLIT: OnceLock<Regex> = OnceLock::new();
    let re_split = RE_SPLIT.get_or_init(|| Regex::new(r"[,;\n|]+").unwrap());

    for k in keys {
        if let Some(v) = map.get(*k) {
            match v {
                Value::Array(arr) => {
                    let out: Vec<String> = arr
                        .iter()
                        .filter_map(|x| match x {
                            Value::String(s) => Some(s.trim().to_string()),
                            Value::Number(n) => Some(n.to_string()),
                            _ => None,
                        })
                        .filter(|s| !s.is_empty())
                        .collect();
                    if !out.is_empty() {
                        return out;
                    }
                }
                Value::String(s) if !s.trim().is_empty() => {
                    let out: Vec<String> = re_split
                        .split(s)
                        .map(|p| p.trim().to_string())
                        .filter(|p| !p.is_empty())
                        .collect();
                    if !out.is_empty() {
                        return out;
                    }
                }
                _ => {}
            }
        }
    }
    Vec::new()
}

pub fn read_story_info(story_dir: &Path, warnings: &mut Vec<String>) -> Option<StoryInfo> {
    let info_path = story_dir.join("info.json");
    if !info_path.is_file() {
        return None;
    }

    let raw_bytes = match fs::read(&info_path) {
        Ok(b) => b,
        Err(e) => {
            warnings.push(format!("Không đọc được info.json: {e}"));
            return None;
        }
    };

    let raw_str = String::from_utf8_lossy(&raw_bytes);
    let trimmed = raw_str.strip_prefix('\u{feff}').unwrap_or(&raw_str);
    let val: Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(e) => {
            warnings.push(format!("Không đọc được info.json: {e}"));
            return None;
        }
    };
    let obj = val.as_object()?;

    let title = obj
        .get("title")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let nation = obj
        .get("nation")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let raw_cover_art = obj
        .get("cover_art")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Some(StoryInfo {
        title,
        summary: json_first_str(obj, &["description", "summary"], ""),
        genres: json_to_list(obj, &["genres", "genre"]),
        authors: json_to_list(obj, &["author", "authors", "author_ids", "authorIds"]),
        other_titles: json_to_list(obj, &["other_titles", "other_title", "otherTitles"]),
        nation,
        nation_id: json_first_str(obj, &["nation_id", "nationId"], ""),
        poster_id: json_first_str(obj, &["poster_id", "posterId"], ""),
        story_type: json_first_str(obj, &["type", "story_type"], "manga"),
        status: json_first_str(obj, &["status", "story_status"], "ongoing"),
        raw_cover_art,
        raw: Some(val),
    })
}

fn find_cover(story_dir: &Path, root_files: &[String], info: Option<&StoryInfo>) -> Option<String> {
    let mut covers: Vec<(u8, String)> = root_files
        .iter()
        .filter_map(|n| cover_priority(n).map(|(p, _)| (p, n.clone())))
        .collect();
    if !covers.is_empty() {
        covers.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| natural_cmp(&a.1, &b.1)));
        return Some(covers.remove(0).1);
    }

    if let Some(rel) = info.and_then(|i| i.raw_cover_art.as_deref()) {
        let rel_clean = rel.replace('\\', "/").trim_matches('/').to_string();
        if !rel_clean.is_empty() {
            if let Ok(full) = safe_join_within(story_dir, &rel_clean) {
                if full.is_file() {
                    return Some(rel_clean);
                }
            }
        }
    }
    None
}

struct ScanCtx<'a> {
    warnings: &'a mut Vec<String>,
    collapse: bool,
    skip_rel: &'a HashSet<String>,
}

fn scan_nodes(
    cur: &Path,
    rel: &str,
    chain: &[NodeRef],
    ctx: &mut ScanCtx<'_>,
) -> Vec<Chapter> {
    let read_dir = match fs::read_dir(cur) {
        Ok(rd) => rd,
        Err(e) => {
            let label = if rel.is_empty() {
                cur.display().to_string()
            } else {
                rel.to_string()
            };
            ctx.warnings
                .push(format!("Không đọc được thư mục '{label}': {e}"));
            return Vec::new();
        }
    };

    let mut images = Vec::new();
    let mut subdirs = Vec::new();

    for entry in read_dir.flatten() {
        let Ok(ft) = entry.file_type() else { continue };
        let name = entry.file_name().to_string_lossy().to_string();
        if ft.is_file() && is_image_name(&name) {
            let rel_path = if rel.is_empty() {
                name.clone()
            } else {
                format!("{rel}/{name}")
            };
            if !ctx.skip_rel.contains(&rel_path) {
                images.push(name);
            }
        } else if ft.is_dir() && !ft.is_symlink() && !name.starts_with('.') {
            subdirs.push(name);
        }
    }

    natural_sort_by(&mut images, |s| s);
    natural_sort_by(&mut subdirs, |s| s);

    if !images.is_empty() {
        if !subdirs.is_empty() {
            let preview: Vec<&str> = subdirs.iter().take(3).map(|s| s.as_str()).collect();
            let suffix = if subdirs.len() > 3 { "..." } else { "" };
            let label = if rel.is_empty() { "(gốc)" } else { rel };
            ctx.warnings.push(format!(
                "'{label}' vừa có ảnh vừa có thư mục con -> bỏ qua thư mục con: {}{suffix}",
                preview.join(", ")
            ));
        }
        let eff = if chain.is_empty() {
            vec![NodeRef {
                kind: NodeKind::Chapter,
                order_index: 1.0,
                title: "Chapter 1".to_string(),
            }]
        } else {
            chain.to_vec()
        };
        return vec![Chapter {
            chain: eff,
            folder: rel.to_string(),
            path: cur.to_path_buf(),
            images,
        }];
    }

    let mut out = Vec::new();
    for name in subdirs {
        let parsed = parse_node_folder_name(&name);
        let mut next_chain = chain.to_vec();
        if parsed.is_valid {
            if let Some(order) = parsed.order_index {
                let node = NodeRef {
                    kind: parsed.kind,
                    order_index: order,
                    title: parsed.title,
                };
                let same_as_parent = chain.last().is_some_and(|last| {
                    last.kind == node.kind && (last.order_index - node.order_index).abs() < 1e-9
                });
                if !(ctx.collapse && same_as_parent) {
                    next_chain.push(node);
                }
            }
        }
        let next_rel = if rel.is_empty() {
            name.clone()
        } else {
            format!("{rel}/{name}")
        };
        out.extend(scan_nodes(&cur.join(&name), &next_rel, &next_chain, ctx));
    }
    out
}

pub fn inspect_story(
    story_dir: &Path,
    dir_name: Option<&str>,
    chapter_limit: Option<usize>,
    collapse_dupes: bool,
) -> Story {
    let resolved_dir_name = dir_name
        .map(|s| s.to_string())
        .or_else(|| {
            story_dir
                .file_name()
                .and_then(|n| n.to_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| "story".to_string());

    let mut warnings = Vec::new();
    let info = read_story_info(story_dir, &mut warnings);
    let info_file = if story_dir.join("info.json").is_file() {
        Some("info.json".to_string())
    } else {
        None
    };

    let mut root_files = Vec::new();
    if let Ok(rd) = fs::read_dir(story_dir) {
        for entry in rd.flatten() {
            if entry.file_type().is_ok_and(|ft| ft.is_file()) {
                root_files.push(entry.file_name().to_string_lossy().to_string());
            }
        }
    }

    let cover = find_cover(story_dir, &root_files, info.as_ref());
    let mut skip_rel: HashSet<String> = root_files
        .iter()
        .filter(|n| cover_priority(n).is_some())
        .cloned()
        .collect();
    if let Some(c) = &cover {
        skip_rel.insert(c.clone());
    }

    let mut chapters = {
        let mut ctx = ScanCtx {
            warnings: &mut warnings,
            collapse: collapse_dupes,
            skip_rel: &skip_rel,
        };
        scan_nodes(story_dir, "", &[], &mut ctx)
    };

    chapters.sort_by(|a, b| {
        for (ra, rb) in a.chain.iter().zip(b.chain.iter()) {
            let ord = ra
                .order_index
                .partial_cmp(&rb.order_index)
                .unwrap_or(std::cmp::Ordering::Equal);
            if ord != std::cmp::Ordering::Equal {
                return ord;
            }
        }
        a.chain.len().cmp(&b.chain.len())
    });

    if let Some(lim) = chapter_limit.filter(|&l| l > 0) {
        chapters.truncate(lim);
    }

    // Cảnh báo trùng (type, order_index)
    let mut groups: HashMap<Vec<(NodeKind, i64)>, Vec<&Chapter>> = HashMap::new();
    for ch in &chapters {
        let key: Vec<(NodeKind, i64)> = ch
            .chain
            .iter()
            .map(|r| (r.kind, (r.order_index * 1_000_000.0).round() as i64))
            .collect();
        groups.entry(key).or_default().push(ch);
    }
    for group in groups.values() {
        if group.len() > 1 {
            let label = group[0]
                .chain
                .iter()
                .map(|r| r.title.as_str())
                .collect::<Vec<_>>()
                .join(" > ");
            let folders = group
                .iter()
                .take(3)
                .map(|c| {
                    if c.folder.is_empty() {
                        "(gốc)"
                    } else {
                        c.folder.as_str()
                    }
                })
                .collect::<Vec<_>>()
                .join(", ");
            warnings.push(format!(
                "{} thư mục cùng thành '{label}': {folders}",
                group.len()
            ));
        }
    }

    if chapters.is_empty() {
        warnings.push("Không tìm thấy ảnh trang nào".to_string());
    }

    let mut total_bytes = 0u64;
    if let Some(ref cover_rel) = cover {
        let mut cover_path = story_dir.to_path_buf();
        for part in cover_rel.split('/') {
            cover_path.push(part);
        }
        if let Ok(m) = fs::metadata(&cover_path) {
            total_bytes = total_bytes.saturating_add(m.len());
        }
    }
    if let Some(ref info_rel) = info_file {
        if let Ok(m) = fs::metadata(story_dir.join(info_rel)) {
            total_bytes = total_bytes.saturating_add(m.len());
        }
    }
    for ch in &chapters {
        for img in &ch.images {
            if let Ok(m) = fs::metadata(ch.path.join(img)) {
                total_bytes = total_bytes.saturating_add(m.len());
            }
        }
    }

    Story {
        dir_name: resolved_dir_name,
        path: story_dir.to_path_buf(),
        info,
        info_file,
        cover,
        chapters,
        warnings,
        total_bytes,
    }
}

pub fn looks_like_single_story(source: &Path) -> bool {
    let Ok(rd) = fs::read_dir(source) else {
        return true;
    };

    let mut subdirs = Vec::new();
    for entry in rd.flatten() {
        let Ok(ft) = entry.file_type() else { continue };
        let name = entry.file_name().to_string_lossy().to_string();
        if ft.is_file() {
            if name == "info.json" || is_image_name(&name) {
                return true;
            }
        } else if ft.is_dir() && !ft.is_symlink() && !name.starts_with('.') {
            subdirs.push(entry.path());
        }
    }

    if subdirs.is_empty() {
        return true;
    }
    if subdirs.iter().any(|d| d.join("info.json").is_file()) {
        return false;
    }

    let valid = subdirs
        .iter()
        .filter(|d| {
            d.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| parse_node_folder_name(n).is_valid)
        })
        .count();
    (valid * 2) >= subdirs.len()
}

pub fn scan_stories(
    source: &Path,
    mode: MangaScanMode,
    story_filter: Option<&str>,
    limit: usize,
    chapter_limit: Option<usize>,
    collapse_dupes: bool,
    reporter: &dyn JobReporter,
) -> Result<Vec<Story>> {
    if !source.is_dir() {
        return Err(KnitError::NotFound(source.display().to_string()));
    }

    let effective_mode = match mode {
        MangaScanMode::Auto => {
            if looks_like_single_story(source) {
                MangaScanMode::Single
            } else {
                MangaScanMode::Library
            }
        }
        other => other,
    };
    reporter.info(format!("Manga scan mode: {effective_mode:?}"));

    let targets: Vec<(String, std::path::PathBuf)> = match effective_mode {
        MangaScanMode::Single => {
            let name = source
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("story")
                .to_string();
            vec![(name, source.to_path_buf())]
        }
        MangaScanMode::Library => {
            let mut names = Vec::new();
            for entry in fs::read_dir(source)?.flatten() {
                if let Ok(ft) = entry.file_type() {
                    if ft.is_dir() && !ft.is_symlink() {
                        let n = entry.file_name().to_string_lossy().to_string();
                        if !n.starts_with('.') {
                            names.push(n);
                        }
                    }
                }
            }
            natural_sort_by(&mut names, |s| s);
            if let Some(f) = story_filter.map(str::trim).filter(|s| !s.is_empty()) {
                let needle = f.to_lowercase();
                names.retain(|n| n.to_lowercase().contains(&needle));
            }
            if limit > 0 {
                names.truncate(limit);
            }
            names
                .into_iter()
                .map(|n| {
                    let p = source.join(&n);
                    (n, p)
                })
                .collect()
        }
        MangaScanMode::Auto => unreachable!(),
    };

    Ok(targets
        .into_iter()
        .map(|(n, p)| inspect_story(&p, Some(&n), chapter_limit, collapse_dupes))
        .collect())
}
