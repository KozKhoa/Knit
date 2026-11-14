use std::sync::OnceLock;

use knit_core::nfc_normalize;
use regex::Regex;

use crate::models::NodeKind;

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedName {
    pub is_valid: bool,
    pub kind: NodeKind,
    pub order_index: Option<f64>,
    pub title: String,
}

/// Định dạng số giống `fmt_num` trong MangamentTools (`1.0` -> `"1"`, `1.5` -> `"1.5"`).
pub fn fmt_num(n: f64) -> String {
    if (n - n.round()).abs() < 1e-9 {
        format!("{}", n.round() as i64)
    } else {
        let s = format!("{n:.6}");
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    }
}

fn kind_from_raw(raw: &str) -> NodeKind {
    match raw.to_lowercase().as_str() {
        "volume" | "vol" | "tập" | "tap" => NodeKind::Volume,
        "arc" | "hồi" | "hoi" => NodeKind::Arc,
        _ => NodeKind::Chapter,
    }
}

fn make_parsed(raw_type: &str, order: f64) -> ParsedName {
    let kind = kind_from_raw(raw_type);
    ParsedName {
        is_valid: true,
        kind,
        order_index: Some(order),
        title: format!("{} {}", kind.display_prefix(), fmt_num(order)),
    }
}

/// Parse tên thư mục kiểu `'chapter 01'`, `'Vol.2'`, `'Chương 10'`, `'05'`...
pub fn parse_node_folder_name(folder_name: &str) -> ParsedName {
    static RE_FULL: OnceLock<Regex> = OnceLock::new();
    static RE_BARE: OnceLock<Regex> = OnceLock::new();
    static RE_NUM: OnceLock<Regex> = OnceLock::new();

    let re_full = RE_FULL.get_or_init(|| {
        Regex::new(r"(?i)^(chapter|chap|ch|c|chương|chuong|volume|vol|tập|tap|arc|hồi|hoi)[\s_.:-]*([0-9]+(?:\.[0-9]+)?)").unwrap()
    });
    let re_bare = RE_BARE.get_or_init(|| {
        Regex::new(r"(?i)^(chapter|chap|ch|chương|chuong|volume|vol|tập|tap|arc|hồi|hoi)$").unwrap()
    });
    let re_num = RE_NUM.get_or_init(|| Regex::new(r"^([0-9]+(?:\.[0-9]+)?)$").unwrap());

    let normalized = nfc_normalize(folder_name);
    let name = normalized.trim();

    if let Some(caps) = re_full.captures(name) {
        if let Ok(order) = caps[2].parse::<f64>() {
            return make_parsed(&caps[1], order);
        }
    }
    if let Some(caps) = re_bare.captures(name) {
        return make_parsed(&caps[1], 1.0);
    }
    if let Some(caps) = re_num.captures(name) {
        if let Ok(order) = caps[1].parse::<f64>() {
            return ParsedName {
                is_valid: true,
                kind: NodeKind::Chapter,
                order_index: Some(order),
                title: format!("Chapter {}", fmt_num(order)),
            };
        }
    }

    ParsedName {
        is_valid: false,
        kind: NodeKind::Chapter,
        order_index: None,
        title: name.to_string(),
    }
}
