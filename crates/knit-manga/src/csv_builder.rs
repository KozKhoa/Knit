use knit_core::Result;

use crate::models::{NodeRef, Story};
use crate::naming::fmt_num;

const BASE_HEADERS: &[&str] = &[
    "title",
    "other_titles",
    "story_type",
    "story_status",
    "nation",
    "nation_id",
    "poster_id",
    "author",
    "genres",
    "summary",
    "cover_art_path",
];
const NODE_HEADERS: &[&str] = &[
    "story_node_title",
    "story_node_type",
    "story_node_order_index",
];
const CONTENT_HEADERS: &[&str] = &[
    "story_node_content_order_index",
    "story_node_content_image_path",
];

pub fn posix_join(parts: &[&str]) -> String {
    parts
        .iter()
        .copied()
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("/")
}

pub fn max_depth(stories: &[Story]) -> usize {
    stories
        .iter()
        .flat_map(|s| s.chapters.iter())
        .map(|c| c.chain.len().max(1))
        .max()
        .unwrap_or(1)
}

fn story_fields(s: &Story) -> Vec<String> {
    match &s.info {
        Some(i) => vec![
            s.effective_title().to_string(),
            i.other_titles.join(", "),
            i.story_type.clone(),
            i.status.clone(),
            i.nation.clone(),
            i.nation_id.clone(),
            i.poster_id.clone(),
            i.authors.join(", "),
            i.genres.join(", "),
            i.summary.clone(),
            s.cover
                .as_deref()
                .map(|c| posix_join(&[&s.dir_name, c]))
                .unwrap_or_default(),
        ],
        None => vec![
            s.effective_title().to_string(),
            String::new(),
            "manga".to_string(),
            "ongoing".to_string(),
            String::new(),
            String::new(),
            String::new(),
            String::new(),
            String::new(),
            String::new(),
            s.cover
                .as_deref()
                .map(|c| posix_join(&[&s.dir_name, c]))
                .unwrap_or_default(),
        ],
    }
}

/// Căn chuỗi node về phía PHẢI giống `zip_pack/csv_builder.py`.
fn node_cols(chain: &[NodeRef], depth: usize) -> Vec<String> {
    let shift = depth.saturating_sub(chain.len());
    let mut cols = Vec::with_capacity(depth * 3);
    for lvl in 0..depth {
        if lvl >= shift {
            let r = &chain[lvl - shift];
            cols.push(r.title.clone());
            cols.push(r.kind.as_str().to_string());
            cols.push(fmt_num(r.order_index));
        } else {
            cols.push(String::new());
            cols.push(String::new());
            cols.push(String::new());
        }
    }
    cols
}

pub fn build_csv_bytes(stories: &[Story]) -> Result<Vec<u8>> {
    let depth = max_depth(stories);
    let mut wtr = csv::WriterBuilder::new()
        .terminator(csv::Terminator::Any(b'\n'))
        .from_writer(Vec::new());

    let mut header: Vec<&str> = Vec::with_capacity(BASE_HEADERS.len() + depth * 3 + 2);
    header.extend_from_slice(BASE_HEADERS);
    for _ in 0..depth {
        header.extend_from_slice(NODE_HEADERS);
    }
    header.extend_from_slice(CONTENT_HEADERS);
    wtr.write_record(&header)
        .map_err(|e| knit_core::KnitError::Internal(e.to_string()))?;

    for s in stories {
        let base = story_fields(s);
        if s.chapters.is_empty() {
            let mut row = base;
            row.resize(row.len() + depth * 3 + 2, String::new());
            wtr.write_record(&row)
                .map_err(|e| knit_core::KnitError::Internal(e.to_string()))?;
            continue;
        }
        for ch in &s.chapters {
            let cols = node_cols(&ch.chain, depth);
            if ch.images.is_empty() {
                let mut row = base.clone();
                row.extend(cols);
                row.push(String::new());
                row.push(String::new());
                wtr.write_record(&row)
                    .map_err(|e| knit_core::KnitError::Internal(e.to_string()))?;
                continue;
            }
            for (n, img) in ch.images.iter().enumerate() {
                let mut row = base.clone();
                row.extend(cols.iter().cloned());
                row.push((n + 1).to_string());
                row.push(posix_join(&[&s.dir_name, &ch.folder, img]));
                wtr.write_record(&row)
                    .map_err(|e| knit_core::KnitError::Internal(e.to_string()))?;
            }
        }
    }

    wtr.into_inner()
        .map_err(|e| knit_core::KnitError::Internal(e.to_string()))
}

pub fn preview_csv(stories: &[Story], max_lines: usize) -> Result<String> {
    let bytes = build_csv_bytes(stories)?;
    let full = String::from_utf8_lossy(&bytes);
    let lines: Vec<&str> = full.lines().take(max_lines).collect();
    Ok(lines.join("\n"))
}
