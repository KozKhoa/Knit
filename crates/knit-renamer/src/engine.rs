use std::collections::HashMap;
use std::sync::OnceLock;

use knit_core::{KnitError, Result};
use regex::{Regex, RegexBuilder};

use crate::models::{FixedPresetKind, RenameRule};

pub type FixedPreset = FixedPresetKind;

fn expand_char_range(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        if i + 2 < chars.len() && chars[i + 1] == '-' {
            let start = chars[i] as u32;
            let end = chars[i + 2] as u32;
            if start <= end {
                for cp in start..=end {
                    if let Some(c) = char::from_u32(cp) {
                        out.push(c);
                    }
                }
            } else {
                for cp in (end..=start).rev() {
                    if let Some(c) = char::from_u32(cp) {
                        out.push(c);
                    }
                }
            }
            i += 3;
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

/// Chuyển `$1`, `\1` kiểu Perl sang `${1}` cho Rust `regex::Regex::replace`.
fn convert_perl_replacement(repl: &str) -> String {
    static RE_DOLLAR: OnceLock<Regex> = OnceLock::new();
    static RE_BSLASH: OnceLock<Regex> = OnceLock::new();

    let re_d = RE_DOLLAR.get_or_init(|| Regex::new(r"\$(\d+)").unwrap());
    let re_b = RE_BSLASH.get_or_init(|| Regex::new(r"\\(\d+)").unwrap());

    let step1 = re_d.replace_all(repl, "$${${1}}");
    re_b.replace_all(&step1, "$${${1}}").to_string()
}

enum RuleOp {
    Sub {
        re: Regex,
        repl: String,
        global: bool,
    },
    Trans {
        map: HashMap<char, Option<char>>,
    },
}

pub struct PrenameEngine {
    ops: Vec<RuleOp>,
}

impl PrenameEngine {
    pub fn new(expression: &str) -> Result<Self> {
        let mut ops = Vec::new();
        for part in split_semicolons(expression) {
            let trimmed = part.trim();
            if trimmed.is_empty() {
                continue;
            }
            ops.push(parse_single_rule(trimmed)?);
        }
        Ok(Self { ops })
    }

    pub fn apply(&self, input: &str) -> String {
        let mut cur = input.to_string();
        for op in &self.ops {
            cur = match op {
                RuleOp::Sub { re, repl, global } => {
                    if *global {
                        re.replace_all(&cur, repl.as_str()).to_string()
                    } else {
                        re.replace(&cur, repl.as_str()).to_string()
                    }
                }
                RuleOp::Trans { map } => cur
                    .chars()
                    .filter_map(|c| match map.get(&c) {
                        Some(Some(mapped)) => Some(*mapped),
                        Some(None) => None,
                        None => Some(c),
                    })
                    .collect(),
            };
        }
        cur
    }
}

fn split_semicolons(expr: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut cur = String::new();
    let mut escaped = false;
    for ch in expr.chars() {
        if escaped {
            cur.push(ch);
            escaped = false;
        } else if ch == '\\' {
            cur.push(ch);
            escaped = true;
        } else if ch == ';' {
            parts.push(std::mem::take(&mut cur));
        } else {
            cur.push(ch);
        }
    }
    if !cur.is_empty() {
        parts.push(cur);
    }
    parts
}

fn parse_delimited(body: &str) -> Option<(String, String, String)> {
    const DELIMS: &[char] = &['/', '|', '#', ',', ';', ':', '!', '~', '_', '@'];
    let mut chars = body.chars();
    let delim = chars.next()?;
    if !DELIMS.contains(&delim) {
        return None;
    }

    let mut segs = Vec::new();
    let mut cur = String::new();
    let mut escaped = false;
    for ch in chars {
        if escaped {
            cur.push('\\');
            cur.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if ch == delim && segs.len() < 2 {
            segs.push(std::mem::take(&mut cur));
            continue;
        }
        cur.push(ch);
    }
    if escaped {
        cur.push('\\');
    }
    if segs.len() != 2 {
        return None;
    }
    if !cur.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    Some((segs.remove(0), segs.remove(0), cur))
}

fn parse_single_rule(expr: &str) -> Result<RuleOp> {
    if let Some(rest) = expr.strip_prefix('s') {
        if let Some((pat, repl, flags)) = parse_delimited(rest) {
            let mut builder = RegexBuilder::new(&pat);
            let mut global = false;
            for f in flags.chars() {
                match f {
                    'i' => {
                        builder.case_insensitive(true);
                    }
                    'g' => global = true,
                    'm' => {
                        builder.multi_line(true);
                    }
                    's' => {
                        builder.dot_matches_new_line(true);
                    }
                    'x' => {
                        builder.ignore_whitespace(true);
                    }
                    'a' => {
                        builder.unicode(false);
                    }
                    _ => {}
                }
            }
            let re = builder
                .build()
                .map_err(|e| KnitError::InvalidInput(format!("Regex không hợp lệ: {e}")))?;
            return Ok(RuleOp::Sub {
                re,
                repl: convert_perl_replacement(&repl),
                global,
            });
        }
    }

    let tr_body = expr.strip_prefix("tr").or_else(|| expr.strip_prefix('y'));
    if let Some(rest) = tr_body {
        if let Some((from_raw, to_raw, flags)) = parse_delimited(rest) {
            let from_chars: Vec<char> = expand_char_range(&from_raw).chars().collect();
            let to_chars: Vec<char> = expand_char_range(&to_raw).chars().collect();
            let delete_unmapped = flags.contains('d');

            let mut map = HashMap::new();
            for (idx, &fc) in from_chars.iter().enumerate() {
                if let Some(&tc) = to_chars.get(idx) {
                    map.insert(fc, Some(tc));
                } else if delete_unmapped {
                    map.insert(fc, None);
                } else if let Some(&last) = to_chars.last() {
                    map.insert(fc, Some(last));
                }
            }
            return Ok(RuleOp::Trans { map });
        }
    }

    Err(KnitError::InvalidInput(format!(
        "Cú pháp prename không hợp lệ: '{expr}'. Dùng dạng s/pattern/replace/flags hoặc y/from/to/flags"
    )))
}

pub fn preset_manga_chapter(name: &str) -> String {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r"(?i)^(?:(?:ch(?:ap(?:ter)?)?|chương|chuong|c|ep(?:isode)?|#)\s*\.?\s*)(\d+(?:\.\d+)?)(.*)$").unwrap()
    });
    if let Some(caps) = re.captures(name.trim()) {
        let num_fmt = pad_decimal(&caps[1], 2);
        let rest = caps[2].trim();
        if rest.is_empty() {
            format!("chapter {num_fmt}")
        } else {
            format!("chapter {num_fmt} {rest}")
        }
    } else {
        name.to_string()
    }
}

pub fn preset_manga_volume(name: &str) -> String {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r"(?i)^(?:(?:vol(?:ume)?|tập|tap|v|book|quyển|quyen)\s*\.?\s*)(\d+(?:\.\d+)?)(.*)$").unwrap()
    });
    if let Some(caps) = re.captures(name.trim()) {
        let num_fmt = pad_decimal(&caps[1], 2);
        let rest = caps[2].trim();
        if rest.is_empty() {
            format!("volume {num_fmt}")
        } else {
            format!("volume {num_fmt} {rest}")
        }
    } else {
        name.to_string()
    }
}

fn pad_decimal(val: &str, width: usize) -> String {
    if let Some((i_part, d_part)) = val.split_once('.') {
        let num: usize = i_part.parse().unwrap_or(0);
        format!("{num:0width$}.{d_part}")
    } else {
        let num: usize = val.parse().unwrap_or(0);
        format!("{num:0width$}")
    }
}

pub fn preset_zero_pad(name: &str, width: usize) -> String {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"\d+(?:\.\d+)?").unwrap());
    re.replace_all(name, |caps: &regex::Captures<'_>| pad_decimal(&caps[0], width))
        .to_string()
}

pub fn preset_clean_tags(name: &str) -> String {
    static RE_TAGS: OnceLock<Regex> = OnceLock::new();
    static RE_WS: OnceLock<Regex> = OnceLock::new();
    let re_tags = RE_TAGS.get_or_init(|| Regex::new(r"\[.*?\]|\(.*?\)|\{.*?\}").unwrap());
    let re_ws = RE_WS.get_or_init(|| Regex::new(r"\s+").unwrap());
    let stripped = re_tags.replace_all(name, "");
    let cleaned = re_ws.replace_all(&stripped, " ").trim().to_string();
    if cleaned.is_empty() {
        name.to_string()
    } else {
        cleaned
    }
}

pub fn preset_clean_whitespace(name: &str) -> String {
    static RE_WS: OnceLock<Regex> = OnceLock::new();
    let re_ws = RE_WS.get_or_init(|| Regex::new(r"\s+").unwrap());
    let replaced = name.replace('_', " ");
    re_ws.replace_all(&replaced, " ").trim().to_string()
}

pub fn preset_normalize_extensions(name: &str) -> String {
    const EXT_MAP: &[(&str, &str)] = &[
        (".jpeg", ".jpg"),
        (".jpe", ".jpg"),
        (".jfif", ".jpg"),
        (".PNG", ".png"),
        (".JPG", ".jpg"),
        (".JPEG", ".jpg"),
        (".WEBP", ".webp"),
        (".GIF", ".gif"),
        (".BMP", ".bmp"),
        (".TIFF", ".tif"),
        (".tif", ".tif"),
    ];
    for (old_ext, new_ext) in EXT_MAP {
        if let Some(stem) = name.strip_suffix(old_ext) {
            return format!("{stem}{new_ext}");
        }
    }
    name.to_string()
}

fn to_title_case(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut cap_next = true;
    for ch in s.chars() {
        if ch.is_alphanumeric() {
            if cap_next {
                out.extend(ch.to_uppercase());
                cap_next = false;
            } else {
                out.extend(ch.to_lowercase());
            }
        } else {
            out.push(ch);
            cap_next = true;
        }
    }
    out
}

pub fn compile_rule(rule: &RenameRule) -> Result<Box<dyn Fn(&str) -> String + Send + Sync>> {
    match rule {
        RenameRule::FixedPreset { preset } => {
            let p = *preset;
            Ok(Box::new(move |s: &str| match p {
                FixedPresetKind::MangaChapter => preset_manga_chapter(s),
                FixedPresetKind::MangaVolume => preset_manga_volume(s),
                FixedPresetKind::Pad2 => preset_zero_pad(s, 2),
                FixedPresetKind::Pad3 => preset_zero_pad(s, 3),
                FixedPresetKind::CleanTags => preset_clean_tags(s),
                FixedPresetKind::CleanWhitespace => preset_clean_whitespace(s),
                FixedPresetKind::NormalizeExtensions => preset_normalize_extensions(s),
                FixedPresetKind::Lowercase => s.to_lowercase(),
                FixedPresetKind::Uppercase => s.to_uppercase(),
                FixedPresetKind::Titlecase => to_title_case(s),
            }))
        }
        RenameRule::FindReplace {
            find,
            replace,
            match_case,
            use_regex,
        } => {
            if find.is_empty() {
                return Ok(Box::new(|s: &str| s.to_string()));
            }
            let repl = replace.clone();
            if *use_regex {
                let re = RegexBuilder::new(find)
                    .case_insensitive(!match_case)
                    .build()
                    .map_err(|e| KnitError::InvalidInput(format!("Regex không hợp lệ: {e}")))?;
                Ok(Box::new(move |s: &str| re.replace_all(s, repl.as_str()).to_string()))
            } else if *match_case {
                let find_owned = find.clone();
                Ok(Box::new(move |s: &str| s.replace(&find_owned, &repl)))
            } else {
                let escaped = regex::escape(find);
                let re = RegexBuilder::new(&escaped)
                    .case_insensitive(true)
                    .build()
                    .map_err(|e| KnitError::InvalidInput(format!("Regex không hợp lệ: {e}")))?;
                Ok(Box::new(move |s: &str| re.replace_all(s, regex::NoExpand(&repl)).to_string()))
            }
        }
        RenameRule::PerlPrename { expression } => {
            let engine = PrenameEngine::new(expression)?;
            Ok(Box::new(move |s: &str| engine.apply(s)))
        }
    }
}
