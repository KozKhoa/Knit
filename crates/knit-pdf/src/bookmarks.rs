use crate::models::BookmarkNode;
use lopdf::{Bookmark, Dictionary, Document, Object, ObjectId};
use std::collections::HashMap;

/// Cắt và ánh xạ lại cây bookmark cho một đoạn trang `[start_idx, end_idx)` (0-based, end_idx exclusive).
/// Giữ lại các nhánh cha nếu bản thân nó hoặc ít nhất một node con cháu nằm trong đoạn.
pub fn remap_tree(nodes: &[BookmarkNode], start_idx: usize, end_idx: usize) -> Vec<BookmarkNode> {
    let mut out = Vec::new();
    for node in nodes {
        let children = remap_tree(&node.children, start_idx, end_idx);
        let self_in_range =
            node.target_page_index >= start_idx && node.target_page_index < end_idx;

        if self_in_range || !children.is_empty() {
            let new_target = if self_in_range {
                node.target_page_index - start_idx
            } else {
                children[0].target_page_index
            };
            out.push(BookmarkNode {
                title: node.title.clone(),
                target_page_index: new_target,
                children,
            });
        }
    }
    out
}

/// Ghi cây BookmarkNode vào `lopdf::Document` (hỗ trợ UTF-16BE tiếng Việt thông qua `lopdf::Document::add_bookmark`).
pub fn write_outlines(
    doc: &mut Document,
    page_ids: &[ObjectId],
    bookmarks: &[BookmarkNode],
) {
    if bookmarks.is_empty() || page_ids.is_empty() {
        return;
    }

    fn insert_recursive(
        doc: &mut Document,
        page_ids: &[ObjectId],
        nodes: &[BookmarkNode],
        parent_id: Option<u32>,
    ) {
        for node in nodes {
            let idx = node.target_page_index.min(page_ids.len() - 1);
            let page_id = page_ids[idx];
            let bm = Bookmark::new(node.title.clone(), [0.0, 0.0, 0.0], 0, page_id);
            let bm_id = doc.add_bookmark(bm, parent_id);
            if !node.children.is_empty() {
                insert_recursive(doc, page_ids, &node.children, Some(bm_id));
            }
        }
    }

    insert_recursive(doc, page_ids, bookmarks, None);
    if let Some(outlines_id) = doc.build_outline() {
        if let Ok(catalog_id) = doc.trailer.get(b"Root").and_then(|o| o.as_reference()) {
            if let Ok(Object::Dictionary(ref mut catalog)) = doc.get_object_mut(catalog_id) {
                catalog.set("Outlines", outlines_id);
            }
        }
    }
}

/// Đọc cây `/Outlines` hiện có từ một PDF thành `Vec<BookmarkNode>` với `target_page_index` 0-based.
pub fn read_outlines(doc: &Document) -> Vec<BookmarkNode> {
    let page_map: HashMap<ObjectId, usize> = doc
        .get_pages()
        .into_iter()
        .enumerate()
        .map(|(idx, (_, obj_id))| (obj_id, idx))
        .collect();

    let Ok(catalog) = doc.catalog() else {
        return Vec::new();
    };
    let Ok(outlines_dict) = doc.get_dict_in_dict(catalog, b"Outlines") else {
        return Vec::new();
    };
    let Ok(first_ref) = outlines_dict.get(b"First").and_then(|o| o.as_reference()) else {
        return Vec::new();
    };

    let mut visited = std::collections::HashSet::new();
    read_outline_siblings(doc, first_ref, &page_map, &mut visited, 0)
}

fn read_outline_siblings(
    doc: &Document,
    first_id: ObjectId,
    page_map: &HashMap<ObjectId, usize>,
    visited: &mut std::collections::HashSet<ObjectId>,
    depth: usize,
) -> Vec<BookmarkNode> {
    if depth > 64 {
        return Vec::new();
    }
    let mut nodes = Vec::new();
    let mut curr = Some(first_id);

    while let Some(obj_id) = curr {
        if !visited.insert(obj_id) {
            break;
        }
        let Ok(dict) = doc.get_dictionary(obj_id) else {
            break;
        };

        let title = decode_pdf_title(doc, dict).unwrap_or_else(|| "Bookmark".to_string());
        let children = match dict.get(b"First").and_then(|o| o.as_reference()) {
            Ok(child_first) => read_outline_siblings(doc, child_first, page_map, visited, depth + 1),
            Err(_) => Vec::new(),
        };

        let target = resolve_outline_target(doc, dict, page_map)
            .or_else(|| children.first().map(|c| c.target_page_index))
            .unwrap_or(0);

        nodes.push(BookmarkNode {
            title,
            target_page_index: target,
            children,
        });

        curr = dict.get(b"Next").and_then(|o| o.as_reference()).ok();
    }

    nodes
}

fn decode_pdf_title(doc: &Document, dict: &Dictionary) -> Option<String> {
    let title_obj = dict.get_deref(b"Title", doc).ok()?;
    let bytes = title_obj.as_str().ok()?;
    if bytes.starts_with(&[0xFE, 0xFF]) && bytes.len() >= 2 {
        let u16s: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        Some(String::from_utf16_lossy(&u16s))
    } else if bytes.starts_with(&[0xFF, 0xFE]) && bytes.len() >= 2 {
        let u16s: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        Some(String::from_utf16_lossy(&u16s))
    } else {
        Some(String::from_utf8_lossy(bytes).into_owned())
    }
}

fn resolve_outline_target(
    doc: &Document,
    dict: &Dictionary,
    page_map: &HashMap<ObjectId, usize>,
) -> Option<usize> {
    let dest_obj = if let Ok(dest) = dict.get_deref(b"Dest", doc) {
        dest
    } else if let Ok(action) = doc.get_dict_in_dict(dict, b"A") {
        action.get_deref(b"D", doc).ok()?
    } else {
        return None;
    };

    let arr = dest_obj.as_array().ok()?;
    let page_ref = arr.first()?.as_reference().ok()?;
    page_map.get(&page_ref).copied()
}
