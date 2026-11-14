use crate::bookmarks::{read_outlines, remap_tree, write_outlines};
use crate::models::{
    BookmarkNode, PageSelection, PdfBuildResult, PdfInfo, PdfMergeConfig, PdfSplitRule,
};
use hayro::hayro_interpret::InterpreterSettings;
use hayro::hayro_syntax::Pdf;
use hayro::vello_cpu::color::palette::css::WHITE;
use hayro::{PixmapSettings, RenderCache, RenderSettings};
use knit_core::{
    atomic_write_file, ensure_disk_space, CancellationToken, JobProgress, JobReporter,
    JobReporterExt, KnitError, Result,
};
use lopdf::{dictionary, Document, Object, ObjectId};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub fn inspect_pdf(path: &Path) -> Result<PdfInfo> {
    if !path.is_file() {
        return Err(KnitError::NotFound(path.display().to_string()));
    }
    let meta = std::fs::metadata(path)?;
    let doc = Document::load(path)
        .map_err(|e| KnitError::InvalidInput(format!("Khong mo duoc PDF {}: {e}", path.display())))?;
    let page_count = doc.get_pages().len();
    let bookmarks = read_outlines(&doc);
    Ok(PdfInfo {
        path: path.to_path_buf(),
        page_count,
        file_size_bytes: meta.len(),
        bookmarks,
    })
}

/// Render 1 trang PDF sang PNG thumbnail bằng engine pure-Rust `hayro`.
pub fn render_pdf_thumbnail(path: &Path, page_index: usize, max_width: u32) -> Result<Vec<u8>> {
    let bytes = std::fs::read(path)?;
    let pdf = Pdf::new(Arc::new(bytes))
        .map_err(|_| KnitError::InvalidInput(format!("Khong doc duoc PDF {}", path.display())))?;
    let pages = pdf.pages();
    let page = pages.get(page_index).ok_or_else(|| {
        KnitError::InvalidInput(format!("Trang {} khong ton tai (tong {})", page_index + 1, pages.len()))
    })?;
    render_pdf_page_png(page, max_width)
}

/// Render hàng loạt trang từ bytes PDF (trong bộ nhớ) sang PNG thumbnails + trả về tổng số trang.
pub fn render_pdf_bytes_thumbnails(
    bytes: &[u8],
    max_pages: Option<usize>,
    max_width: u32,
) -> Result<(usize, Vec<Vec<u8>>)> {
    let pdf = Pdf::new(Arc::new(bytes.to_vec()))
        .map_err(|_| KnitError::InvalidInput("Khong doc duoc du lieu PDF".into()))?;
    let pages = pdf.pages();
    let total = pages.len();
    let limit = max_pages.map(|m| m.min(total)).unwrap_or(total);
    let mut rendered = Vec::with_capacity(limit);
    for page in pages.iter().take(limit) {
        rendered.push(render_pdf_page_png(page, max_width)?);
    }
    Ok((total, rendered))
}

fn render_pdf_page_png(page: &hayro::hayro_syntax::page::Page<'_>, max_width: u32) -> Result<Vec<u8>> {
    let (pw, _ph) = page.render_dimensions();
    let scale = if pw > 0.0 && max_width > 0 {
        (max_width as f32 / pw).clamp(0.1, 4.0)
    } else {
        1.0
    };
    let cache = RenderCache::new();
    let pixmap = hayro::render(
        page,
        &cache,
        &InterpreterSettings::default(),
        &RenderSettings::default(),
        &PixmapSettings {
            x_scale: scale,
            y_scale: scale,
            bg_color: WHITE,
        },
    );
    pixmap
        .into_png()
        .map_err(|e| KnitError::InvalidInput(format!("Loi tao PNG thumbnail: {e}")))
}

/// Parse chuỗi chọn trang 1-based như `"1-3, 5, 8-6"` thành danh sách index 0-based.
pub fn parse_page_ranges(spec: &str, total_pages: usize) -> Result<Vec<usize>> {
    if total_pages == 0 {
        return Err(KnitError::InvalidInput("PDF khong co trang nao".into()));
    }
    let mut out = Vec::new();
    for raw_part in spec.split(',') {
        let part = raw_part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some((a, b)) = part.split_once('-') {
            let start = parse_one_based(a.trim(), total_pages)?;
            let end = parse_one_based(b.trim(), total_pages)?;
            if start <= end {
                for p in start..=end {
                    out.push(p - 1);
                }
            } else {
                for p in (end..=start).rev() {
                    out.push(p - 1);
                }
            }
        } else {
            let p = parse_one_based(part, total_pages)?;
            out.push(p - 1);
        }
    }
    if out.is_empty() {
        return Err(KnitError::InvalidInput("Khong co trang hop le nao duoc chon".into()));
    }
    Ok(out)
}

fn parse_one_based(token: &str, total_pages: usize) -> Result<usize> {
    let val: usize = token
        .parse()
        .map_err(|_| KnitError::InvalidInput(format!("So trang khong hop le: '{token}'")))?;
    if val == 0 || val > total_pages {
        return Err(KnitError::InvalidInput(format!(
            "So trang {val} nam ngoai pham vi 1..={total_pages}"
        )));
    }
    Ok(val)
}

/// Hợp nhất nhiều PDF (hỗ trợ chọn trang, sắp xếp lại, xoay góc mod 360, và giữ/ánh xạ bookmark).
pub fn merge_pdfs(
    config: &PdfMergeConfig,
    cancel: &CancellationToken,
    reporter: &dyn JobReporter,
) -> Result<PdfBuildResult> {
    if config.inputs.is_empty() {
        return Err(KnitError::InvalidInput("Can it nhat 1 file PDF de gop".into()));
    }
    if cancel.is_cancelled() {
        return Err(KnitError::Cancelled);
    }

    reporter.info("Dang nap cac file PDF dau vao");
    let mut docs = Vec::with_capacity(config.inputs.len());
    let mut total_input_bytes = 0u64;
    for path in &config.inputs {
        if !path.is_file() {
            return Err(KnitError::NotFound(path.display().to_string()));
        }
        total_input_bytes += std::fs::metadata(path)?.len();
        let doc = Document::load(path)
            .map_err(|e| KnitError::InvalidInput(format!("Loi doc PDF {}: {e}", path.display())))?;
        docs.push(doc);
    }

    if let Some(parent) = config.output_path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
            ensure_disk_space(parent, total_input_bytes.saturating_mul(2))?;
        }
    }

    let selections: Vec<PageSelection> = match &config.selected_pages {
        Some(sel) if !sel.is_empty() => sel.clone(),
        _ => {
            let mut all = Vec::new();
            for (file_index, doc) in docs.iter().enumerate() {
                for page_index in 0..doc.get_pages().len() {
                    all.push(PageSelection {
                        file_index,
                        page_index,
                        rotation_deg: 0,
                    });
                }
            }
            all
        }
    };

    if selections.is_empty() {
        return Err(KnitError::InvalidInput("Khong co trang nao duoc chon de gop".into()));
    }

    // Materialize inherited Resources/MediaBox before renumbering, then renumber each doc cleanly
    let mut next_id = 1u32;
    let mut per_doc_pages: Vec<Vec<ObjectId>> = Vec::with_capacity(docs.len());
    let mut per_doc_bookmarks: Vec<Vec<BookmarkNode>> = Vec::with_capacity(docs.len());

    let total_docs = docs.len();
    for (i, doc) in docs.iter_mut().enumerate() {
        if cancel.is_cancelled() {
            return Err(KnitError::Cancelled);
        }
        reporter.on_progress(JobProgress {
            phase: "prepare".into(),
            done: (i + 1) as u64,
            total: total_docs as u64,
            bytes_done: 0,
            bytes_total: 0,
            current_item: format!("Chuan bi file {}/{}", i + 1, total_docs),
        });
        if config.preserve_bookmarks {
            per_doc_bookmarks.push(read_outlines(doc));
        } else {
            per_doc_bookmarks.push(Vec::new());
        }
        let page_ids: Vec<ObjectId> = doc.get_pages().into_values().collect();
        for &pid in &page_ids {
            materialize_inherited_page_attrs(doc, pid)?;
        }
        doc.renumber_objects_with(next_id);
        next_id = doc.max_id.saturating_add(1);
        let renumbered_pages: Vec<ObjectId> = doc.get_pages().into_values().collect();
        per_doc_pages.push(renumbered_pages);
    }

    let mut merged = Document::with_version("1.5");
    for doc in &docs {
        for (&obj_id, obj) in &doc.objects {
            if is_catalog_or_pages(obj) {
                continue;
            }
            merged.objects.insert(obj_id, obj.clone());
        }
    }
    merged.max_id = next_id;
    let new_pages_id = merged.new_object_id();

    let mut final_page_ids = Vec::with_capacity(selections.len());
    // Map (file_index, original_page_index) -> first merged page index
    let mut page_index_map: HashMap<(usize, usize), usize> = HashMap::new();

    for (merged_idx, sel) in selections.iter().enumerate() {
        if cancel.is_cancelled() {
            return Err(KnitError::Cancelled);
        }
        let doc_pages = per_doc_pages.get(sel.file_index).ok_or_else(|| {
            KnitError::InvalidInput(format!("file_index {} khong hop le", sel.file_index))
        })?;
        let orig_page_id = *doc_pages.get(sel.page_index).ok_or_else(|| {
            KnitError::InvalidInput(format!(
                "page_index {} khong ton tai trong file {}",
                sel.page_index, sel.file_index
            ))
        })?;

        // Nếu cùng 1 trang được chọn lặp lại, clone dictionary trang mới để không đè /Parent
        let target_page_id = if final_page_ids.contains(&orig_page_id) {
            let cloned_obj = merged
                .get_object(orig_page_id)
                .map_err(|e| KnitError::InvalidInput(e.to_string()))?
                .clone();
            merged.add_object(cloned_obj)
        } else {
            orig_page_id
        };

        if let Ok(Object::Dictionary(ref mut dict)) = merged.get_object_mut(target_page_id) {
            dict.set("Parent", new_pages_id);
            if sel.rotation_deg.rem_euclid(360) != 0 {
                let existing_rot = dict
                    .get(b"Rotate")
                    .ok()
                    .and_then(|o| o.as_i64().ok())
                    .unwrap_or(0);
                let new_rot = (existing_rot + sel.rotation_deg as i64).rem_euclid(360);
                dict.set("Rotate", Object::Integer(new_rot));
            }
        }

        page_index_map
            .entry((sel.file_index, sel.page_index))
            .or_insert(merged_idx);
        final_page_ids.push(target_page_id);
    }

    merged.objects.insert(
        new_pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => final_page_ids.iter().copied().map(Object::Reference).collect::<Vec<_>>(),
            "Count" => final_page_ids.len() as i64,
        }),
    );

    let catalog_id = merged.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => new_pages_id,
    });
    merged.trailer.set("Root", catalog_id);

    if config.preserve_bookmarks {
        let mut combined_bookmarks = Vec::new();
        for (file_idx, tree) in per_doc_bookmarks.iter().enumerate() {
            combined_bookmarks.extend(remap_bookmarks_for_selection(tree, file_idx, &page_index_map));
        }
        write_outlines(&mut merged, &final_page_ids, &combined_bookmarks);
    }

    merged.prune_objects();

    let mut bytes = Vec::new();
    merged
        .save_to(&mut bytes)
        .map_err(|e| KnitError::InvalidInput(format!("Loi luu PDF sau khi gop: {e}")))?;
    atomic_write_file(&config.output_path, |f| Ok(f.write_all(&bytes)?))?;

    Ok(PdfBuildResult {
        output_files: vec![config.output_path.clone()],
        total_pages: final_page_ids.len(),
        total_bytes: bytes.len() as u64,
        passthrough_pages: 0,
    })
}

/// Tách 1 file PDF theo `PdfSplitRule` (`PageRanges`, `EveryNPages`, `ExtractSelected`, `MaxBytes`).
pub fn split_pdf(
    input_path: &Path,
    output_dir: &Path,
    stem: &str,
    rule: &PdfSplitRule,
    cancel: &CancellationToken,
    reporter: &dyn JobReporter,
) -> Result<PdfBuildResult> {
    if !input_path.is_file() {
        return Err(KnitError::NotFound(input_path.display().to_string()));
    }
    if cancel.is_cancelled() {
        return Err(KnitError::Cancelled);
    }

    std::fs::create_dir_all(output_dir)?;
    let input_size = std::fs::metadata(input_path)?.len();
    ensure_disk_space(output_dir, input_size.saturating_mul(2))?;

    reporter.info("Dang doc file PDF can tach");
    let doc = Document::load(input_path)
        .map_err(|e| KnitError::InvalidInput(format!("Loi mo PDF: {e}")))?;
    let total_pages = doc.get_pages().len();
    if total_pages == 0 {
        return Err(KnitError::InvalidInput("PDF rong, khong co trang".into()));
    }
    let bookmarks = read_outlines(&doc);

    let safe_stem = if stem.trim().is_empty() {
        input_path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "split".to_string())
    } else {
        stem.trim().to_string()
    };

    let groups: Vec<(PathBuf, Vec<(usize, i32)>)> = match rule {
        PdfSplitRule::PageRanges { ranges } => {
            let indices = parse_page_ranges(ranges, total_pages)?;
            vec![(
                output_dir.join(format!("{safe_stem}_extracted.pdf")),
                indices.into_iter().map(|i| (i, 0)).collect(),
            )]
        }
        PdfSplitRule::ExtractSelected { page_indices } => {
            if page_indices.is_empty() {
                return Err(KnitError::InvalidInput("Chua chon trang nao de trich xuat".into()));
            }
            for &idx in page_indices {
                if idx >= total_pages {
                    return Err(KnitError::InvalidInput(format!(
                        "Trang {} vuot qua tong so trang {total_pages}",
                        idx + 1
                    )));
                }
            }
            vec![(
                output_dir.join(format!("{safe_stem}_selected.pdf")),
                page_indices.iter().map(|&i| (i, 0)).collect(),
            )]
        }
        PdfSplitRule::EveryNPages { n } => {
            let step = (*n).max(1);
            let mut groups = Vec::new();
            let mut part = 1usize;
            for start in (0..total_pages).step_by(step) {
                let end = (start + step).min(total_pages);
                groups.push((
                    output_dir.join(format!("{safe_stem}_part{part:02}.pdf")),
                    (start..end).map(|i| (i, 0)).collect(),
                ));
                part += 1;
            }
            groups
        }
        PdfSplitRule::MaxBytes { max_mb } => {
            if *max_mb <= 0.0 {
                return Err(KnitError::InvalidInput("max_mb phai lon hon 0".into()));
            }
            let limit = (*max_mb * 1024.0 * 1024.0) as usize;
            return split_pdf_by_max_bytes(&doc, &bookmarks, total_pages, output_dir, &safe_stem, limit, cancel, reporter);
        }
        PdfSplitRule::CustomGroups { groups: custom_groups } => {
            let non_empty: Vec<_> = custom_groups.iter().filter(|g| !g.pages.is_empty()).collect();
            if non_empty.is_empty() {
                return Err(KnitError::InvalidInput("Chua co trang nao trong cac section dau ra".into()));
            }
            let mut seen_names: HashMap<String, usize> = HashMap::new();
            let mut resolved_groups = Vec::with_capacity(non_empty.len());
            for (idx, g) in non_empty.iter().enumerate() {
                let mut pairs = Vec::with_capacity(g.pages.len());
                for sel in &g.pages {
                    if sel.page_index >= total_pages {
                        return Err(KnitError::InvalidInput(format!(
                            "Trang {} vuot qua tong so trang {total_pages}",
                            sel.page_index + 1
                        )));
                    }
                    pairs.push((sel.page_index, sel.rotation_deg));
                }
                let base_name = sanitize_split_group_name(&g.name, idx + 1);
                let occ = seen_names.entry(base_name.clone()).or_insert(0);
                *occ += 1;
                let unique_name = if *occ == 1 {
                    base_name
                } else {
                    format!("{base_name}_{}", *occ)
                };
                resolved_groups.push((output_dir.join(format!("{unique_name}.pdf")), pairs));
            }
            resolved_groups
        }
    };

    let mut output_files = Vec::new();
    let mut total_out_pages = 0usize;
    let mut total_bytes = 0u64;
    let total_parts = groups.len();

    for (idx, (out_path, page_items)) in groups.into_iter().enumerate() {
        if cancel.is_cancelled() {
            return Err(KnitError::Cancelled);
        }
        reporter.on_progress(JobProgress {
            phase: "split".into(),
            done: (idx + 1) as u64,
            total: total_parts as u64,
            bytes_done: 0,
            bytes_total: 0,
            current_item: format!("Dang ghi phan {}/{}", idx + 1, total_parts),
        });
        let bytes = build_subset_pdf_bytes(&doc, &bookmarks, &page_items)?;
        total_out_pages += page_items.len();
        total_bytes += bytes.len() as u64;
        atomic_write_file(&out_path, |f| Ok(f.write_all(&bytes)?))?;
        output_files.push(out_path);
    }

    Ok(PdfBuildResult {
        output_files,
        total_pages: total_out_pages,
        total_bytes,
        passthrough_pages: 0,
    })
}

fn sanitize_split_group_name(raw: &str, fallback_idx: usize) -> String {
    let trimmed = raw.trim().strip_suffix(".pdf").unwrap_or(raw.trim());
    let cleaned: String = trimmed
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            _ => c,
        })
        .collect();
    let final_str = cleaned.trim().trim_matches('.');
    if final_str.is_empty() {
        format!("section_{fallback_idx:02}")
    } else {
        final_str.to_string()
    }
}

fn split_pdf_by_max_bytes(
    doc: &Document,
    bookmarks: &[BookmarkNode],
    total_pages: usize,
    output_dir: &Path,
    safe_stem: &str,
    limit: usize,
    cancel: &CancellationToken,
    reporter: &dyn JobReporter,
) -> Result<PdfBuildResult> {
    let mut output_files = Vec::new();
    let mut total_bytes = 0u64;
    let mut start = 0usize;
    let mut part = 1usize;

    while start < total_pages {
        if cancel.is_cancelled() {
            return Err(KnitError::Cancelled);
        }
        // Binary search longest range [start..=hi] fitting within `limit`
        let mut lo = start;
        let mut hi = total_pages - 1;
        let mut best = start;
        let mut best_bytes = build_subset_pdf_bytes(doc, bookmarks, &[(start, 0)])?;

        if best_bytes.len() <= limit && lo < hi {
            lo = start + 1;
            while lo <= hi {
                let mid = (lo + hi) / 2;
                let range: Vec<(usize, i32)> = (start..=mid).map(|i| (i, 0)).collect();
                let candidate = build_subset_pdf_bytes(doc, bookmarks, &range)?;
                if candidate.len() <= limit {
                    best = mid;
                    best_bytes = candidate;
                    lo = mid + 1;
                } else {
                    if mid == 0 {
                        break;
                    }
                    hi = mid - 1;
                }
            }
        }

        let out_path = output_dir.join(format!("{safe_stem}_part{part:02}.pdf"));
        total_bytes += best_bytes.len() as u64;
        atomic_write_file(&out_path, |f| Ok(f.write_all(&best_bytes)?))?;
        output_files.push(out_path);
        reporter.on_progress(JobProgress {
            phase: "split".into(),
            done: (best + 1) as u64,
            total: total_pages as u64,
            bytes_done: 0,
            bytes_total: 0,
            current_item: format!("Da tach den trang {}/{}", best + 1, total_pages),
        });
        start = best + 1;
        part += 1;
    }

    Ok(PdfBuildResult {
        output_files,
        total_pages,
        total_bytes,
        passthrough_pages: 0,
    })
}

fn build_subset_pdf_bytes(
    orig: &Document,
    bookmarks: &[BookmarkNode],
    items: &[(usize, i32)],
) -> Result<Vec<u8>> {
    let mut doc = orig.clone();
    let all_pages: Vec<ObjectId> = doc.get_pages().into_values().collect();
    for &pid in &all_pages {
        materialize_inherited_page_attrs(&mut doc, pid)?;
    }

    // Tạo trang Pages root mới chỉ chứa các trang được chọn
    let pages_id = doc.new_object_id();
    let mut selected_ids = Vec::with_capacity(items.len());
    let mut index_map = HashMap::new();

    for (new_idx, &(orig_idx, rot_delta)) in items.iter().enumerate() {
        let orig_pid = *all_pages.get(orig_idx).ok_or_else(|| {
            KnitError::InvalidInput(format!("Trang {} khong ton tai", orig_idx + 1))
        })?;
        let pid = if selected_ids.contains(&orig_pid) {
            let cloned = doc
                .get_object(orig_pid)
                .map_err(|e| KnitError::InvalidInput(e.to_string()))?
                .clone();
            doc.add_object(cloned)
        } else {
            orig_pid
        };
        if let Ok(Object::Dictionary(ref mut d)) = doc.get_object_mut(pid) {
            d.set("Parent", pages_id);
            if rot_delta.rem_euclid(360) != 0 {
                let existing_rot = d.get(b"Rotate").and_then(|o| o.as_i64()).unwrap_or(0);
                let new_rot = (existing_rot + rot_delta as i64).rem_euclid(360);
                d.set("Rotate", new_rot);
            }
        }
        index_map.entry(orig_idx).or_insert(new_idx);
        selected_ids.push(pid);
    }

    // Xóa cấu trúc Catalog/Outlines cũ trước khi prune
    doc.bookmarks.clear();
    doc.bookmark_table.clear();
    doc.max_bookmark_id = 0;

    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => selected_ids.iter().copied().map(Object::Reference).collect::<Vec<_>>(),
            "Count" => selected_ids.len() as i64,
        }),
    );
    let catalog_id = doc.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    doc.trailer.set("Root", catalog_id);

    // Remap bookmarks: nếu indices liên tục thì dùng remap_tree, không thì dùng index_map tổng quát
    let mapped_bookmarks = remap_bookmarks_with_single_map(bookmarks, &index_map);
    write_outlines(&mut doc, &selected_ids, &mapped_bookmarks);

    doc.prune_objects();
    let mut bytes = Vec::new();
    doc.save_to(&mut bytes)
        .map_err(|e| KnitError::InvalidInput(format!("Loi ghi PDF tach: {e}")))?;
    Ok(bytes)
}

fn remap_bookmarks_for_selection(
    nodes: &[BookmarkNode],
    file_idx: usize,
    map: &HashMap<(usize, usize), usize>,
) -> Vec<BookmarkNode> {
    let mut out = Vec::new();
    for node in nodes {
        let children = remap_bookmarks_for_selection(&node.children, file_idx, map);
        let mapped_self = map.get(&(file_idx, node.target_page_index)).copied();
        if let Some(target) = mapped_self.or_else(|| children.first().map(|c| c.target_page_index)) {
            out.push(BookmarkNode {
                title: node.title.clone(),
                target_page_index: target,
                children,
            });
        }
    }
    out
}

fn remap_bookmarks_with_single_map(
    nodes: &[BookmarkNode],
    map: &HashMap<usize, usize>,
) -> Vec<BookmarkNode> {
    let mut out = Vec::new();
    for node in nodes {
        let children = remap_bookmarks_with_single_map(&node.children, map);
        let mapped_self = map.get(&node.target_page_index).copied();
        if let Some(target) = mapped_self.or_else(|| children.first().map(|c| c.target_page_index)) {
            out.push(BookmarkNode {
                title: node.title.clone(),
                target_page_index: target,
                children,
            });
        }
    }
    out
}

fn is_catalog_or_pages(obj: &Object) -> bool {
    if let Ok(dict) = obj.as_dict() {
        if let Ok(t) = dict.get(b"Type").and_then(|o| o.as_name()) {
            return matches!(t, b"Catalog" | b"Pages" | b"Outlines");
        }
    }
    false
}

/// Đảm bảo mỗi trang có đầy đủ `/Resources` và `/MediaBox` tự thân (không phụ thuộc cha `/Pages`).
fn materialize_inherited_page_attrs(doc: &mut Document, page_id: ObjectId) -> Result<()> {
    let inherited_res = match doc.get_page_resources(page_id) {
        Ok((Some(d), _)) => Some(Object::Dictionary(d.clone())),
        _ => None,
    };

    let inherited_mediabox = find_inherited_attr(doc, page_id, b"MediaBox");
    let inherited_cropbox = find_inherited_attr(doc, page_id, b"CropBox");

    if let Ok(Object::Dictionary(ref mut page_dict)) = doc.get_object_mut(page_id) {
        if !page_dict.has(b"Resources") {
            if let Some(res) = inherited_res {
                page_dict.set("Resources", res);
            }
        }
        if !page_dict.has(b"MediaBox") {
            if let Some(mb) = inherited_mediabox {
                page_dict.set("MediaBox", mb);
            }
        }
        if !page_dict.has(b"CropBox") {
            if let Some(cb) = inherited_cropbox {
                page_dict.set("CropBox", cb);
            }
        }
    }
    Ok(())
}

fn find_inherited_attr(doc: &Document, start_id: ObjectId, key: &[u8]) -> Option<Object> {
    let mut curr = Some(start_id);
    let mut guard = 0;
    while let Some(id) = curr {
        guard += 1;
        if guard > 64 {
            break;
        }
        let dict = doc.get_dictionary(id).ok()?;
        if let Ok(val) = dict.get(key) {
            return Some(val.clone());
        }
        curr = dict.get(b"Parent").and_then(|o| o.as_reference()).ok();
    }
    None
}

// Keep unused-warning clean if remap_tree is imported only for public API consistency
#[allow(dead_code)]
fn _keep_remap_tree_in_scope(nodes: &[BookmarkNode]) -> Vec<BookmarkNode> {
    remap_tree(nodes, 0, usize::MAX)
}
