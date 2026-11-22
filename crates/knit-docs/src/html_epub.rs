use crate::markdown::{escape_typst_text, typst_preamble, typst_string_literal};
use crate::models::{DocConvertOptions, DocConvertResult, DocInputKind};
use crate::world::{compile_typst_with_prepared_assets, prepare_typst_images};
use epub::doc::EpubDoc;
use knit_core::{
    atomic_write_file, CancellationToken, JobProgress, JobReporter, JobReporterExt, KnitError,
    Result,
};
use regex::Regex;
use std::collections::HashMap;
use std::fmt::Write as _;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::UNIX_EPOCH;
use typst::foundations::Bytes;

struct CachedEpubPayload {
    path: PathBuf,
    file_len: u64,
    mtime_nanos: u128,
    title: Option<String>,
    body_markup: String,
    prepared_virtual: Arc<HashMap<String, Bytes>>,
}

#[derive(Default, Clone)]
pub struct EpubCssRules {
    pub bg_images_by_class: HashMap<String, String>,
    pub bg_images_by_id: HashMap<String, String>,
    pub hidden_classes: Vec<String>,
}

static LAST_PARSED_EPUB: OnceLock<Mutex<Option<Arc<CachedEpubPayload>>>> = OnceLock::new();

/// Giải phóng bộ nhớ đệm EPUB đã phân tích gần nhất.
pub fn clear_epub_cache() {
    if let Some(lock) = LAST_PARSED_EPUB.get() {
        if let Ok(mut guard) = lock.lock() {
            *guard = None;
        }
    }
}

pub fn html_to_typst(html: &str, opts: &DocConvertOptions) -> String {
    let mut out = typst_preamble(opts);
    let body = html_fragment_to_typst(html, None);
    if opts.include_toc && opts.toc_page > 1 {
        let mut blk_idx = 0usize;
        for chunk in body.split("\n\n") {
            let trimmed = chunk.trim();
            if trimmed.is_empty() {
                continue;
            }
            let _ = writeln!(out, "#metadata({blk_idx}) <knit-blk>\n{trimmed}\n");
            blk_idx += 1;
        }
    } else {
        out.push_str(&body);
    }
    out
}

pub fn html_fragment_to_typst(html: &str, virtual_img_prefix: Option<&str>) -> String {
    html_fragment_to_typst_with_css(html, virtual_img_prefix, None)
}

fn collapse_whitespace(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_ws = false;
    for ch in s.chars() {
        if ch.is_whitespace() {
            if !prev_ws {
                out.push(' ');
                prev_ws = true;
            }
        } else {
            out.push(ch);
            prev_ws = false;
        }
    }
    out.trim().to_string()
}

fn extract_attr(attrs: &str, name: &str) -> Option<String> {
    let re_str = format!(r#"(?i)(?:^|\s){name}\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))"#);
    let re = Regex::new(&re_str).ok()?;
    let caps = re.captures(attrs)?;
    caps.get(1)
        .or_else(|| caps.get(2))
        .or_else(|| caps.get(3))
        .map(|m| m.as_str().trim().to_string())
}

fn parse_epub_css(css_text: &str, css_dir: &str, out: &mut EpubCssRules) {
    static RE_COMMENTS: OnceLock<Regex> = OnceLock::new();
    static RE_RULE: OnceLock<Regex> = OnceLock::new();
    static RE_URL: OnceLock<Regex> = OnceLock::new();

    let re_comments = RE_COMMENTS.get_or_init(|| Regex::new(r"(?s)/\*.*?\*/").unwrap());
    let re_rule = RE_RULE.get_or_init(|| Regex::new(r"(?s)([^{}]+)\{([^}]*)\}").unwrap());
    let re_url = RE_URL.get_or_init(|| {
        Regex::new(r#"(?i)background(?:-image)?\s*:[^;]*url\(\s*["']?([^"')]+)["']?\s*\)"#).unwrap()
    });

    let clean = re_comments.replace_all(css_text, "");
    for caps in re_rule.captures_iter(&clean) {
        let selectors = caps[1].trim();
        let body = caps[2].trim();

        let resolved_url = re_url
            .captures(body)
            .map(|c| resolve_virtual_rel(css_dir, c[1].trim()));

        let body_lower = body.to_ascii_lowercase();
        let is_hidden_rule = body_lower.contains("display:none")
            || body_lower.contains("display: none")
            || body_lower.contains("visibility:hidden")
            || body_lower.contains("visibility: hidden");

        for raw_sel in selectors.split(',') {
            let sel = raw_sel.trim();
            if let Some(ref url) = resolved_url {
                if let Some(cls) = sel.strip_prefix('.') {
                    if !cls.contains(char::is_whitespace) {
                        out.bg_images_by_class.insert(cls.to_string(), url.clone());
                    }
                } else if let Some(id_name) = sel.strip_prefix('#') {
                    if !id_name.contains(char::is_whitespace) {
                        out.bg_images_by_id.insert(id_name.to_string(), url.clone());
                    }
                }
            }
            if is_hidden_rule {
                if let Some(cls) = sel.strip_prefix('.') {
                    if !cls.contains(char::is_whitespace) {
                        out.hidden_classes.push(cls.to_string());
                    }
                }
            }
        }
    }
}

/// Escape văn bản sang Typst nhưng giữ nguyên hoàn toàn các placeholder nội bộ `KNIT...END`,
/// tránh lỗi `insert_wrap_opportunities` chèn `\u{200B}` cắt ngang tên marker làm hỏng dấu đóng `[...]`.
fn escape_typst_preserving_markers(input: &str) -> String {
    static RE_MARKER: OnceLock<Regex> = OnceLock::new();
    let re = RE_MARKER.get_or_init(|| Regex::new(r"KNIT(?:TOK|PRE|HDR|IMG)\d+END").unwrap());

    let mut out = String::with_capacity(input.len() + 16);
    let mut last = 0usize;
    for m in re.find_iter(input) {
        if m.start() > last {
            let decoded = decode_html_entities(&input[last..m.start()]);
            out.push_str(&escape_typst_text(&decoded));
        }
        out.push_str(m.as_str());
        last = m.end();
    }
    if last < input.len() {
        let decoded = decode_html_entities(&input[last..]);
        out.push_str(&escape_typst_text(&decoded));
    }
    out
}

fn convert_inline_fragment(inner_html: &str) -> String {
    static RE_INLINE_TAGS: OnceLock<Regex> = OnceLock::new();
    let re_tags =
        RE_INLINE_TAGS.get_or_init(|| Regex::new(r"(?is)<(/?)([a-z0-9]+)\b[^>]*>").unwrap());

    let mut inline_tokens: Vec<(String, String)> = Vec::new();
    let mut open_stack: Vec<&'static str> = Vec::new();

    let work = re_tags
        .replace_all(inner_html, |caps: &regex::Captures| {
            let is_close = &caps[1] == "/";
            let tag = caps[2].to_ascii_lowercase();
            match (is_close, tag.as_str()) {
                (false, "br") => "\\\n".to_string(),
                (false, "b" | "strong") => {
                    let m = format!("KNITTOK{}END", inline_tokens.len());
                    open_stack.push("strong");
                    inline_tokens.push((m.clone(), "#strong[".into()));
                    m
                }
                (true, "b" | "strong") => {
                    if let Some(pos) = open_stack.iter().rposition(|&t| t == "strong") {
                        let close_count = open_stack.len() - pos;
                        open_stack.truncate(pos);
                        let m = format!("KNITTOK{}END", inline_tokens.len());
                        inline_tokens.push((m.clone(), "];".repeat(close_count)));
                        m
                    } else {
                        String::new()
                    }
                }
                (false, "i" | "em") => {
                    let m = format!("KNITTOK{}END", inline_tokens.len());
                    open_stack.push("emph");
                    inline_tokens.push((m.clone(), "#emph[".into()));
                    m
                }
                (true, "i" | "em") => {
                    if let Some(pos) = open_stack.iter().rposition(|&t| t == "emph") {
                        let close_count = open_stack.len() - pos;
                        open_stack.truncate(pos);
                        let m = format!("KNITTOK{}END", inline_tokens.len());
                        inline_tokens.push((m.clone(), "];".repeat(close_count)));
                        m
                    } else {
                        String::new()
                    }
                }
                _ => String::new(),
            }
        })
        .into_owned();

    let mut escaped = escape_typst_preserving_markers(&work);
    for (marker, replacement) in inline_tokens {
        escaped = escaped.replace(&marker, &replacement);
    }
    if !open_stack.is_empty() {
        escaped.push_str(&"];".repeat(open_stack.len()));
    }
    collapse_whitespace_preserving_breaks(&escaped)
}

fn collapse_whitespace_preserving_breaks(s: &str) -> String {
    let mut lines: Vec<String> = Vec::new();
    for line in s.lines() {
        let trimmed = collapse_whitespace(line);
        if !trimmed.is_empty() {
            lines.push(trimmed);
        }
    }
    lines.join("\n")
}

pub fn html_fragment_to_typst_with_css(
    html: &str,
    virtual_img_prefix: Option<&str>,
    css: Option<&EpubCssRules>,
) -> String {
    static RE_STRIP_BLOCKS: OnceLock<Regex> = OnceLock::new();
    static RE_HIDDEN_SPAN: OnceLock<Regex> = OnceLock::new();
    static RE_PRE: OnceLock<Regex> = OnceLock::new();
    static RE_HEADING: OnceLock<Regex> = OnceLock::new();
    static RE_DIV_CHAPTER: OnceLock<Regex> = OnceLock::new();
    static RE_DIV_TITLE: OnceLock<Regex> = OnceLock::new();
    static RE_DIV_AUTHOR: OnceLock<Regex> = OnceLock::new();
    static RE_DIV_BREAK: OnceLock<Regex> = OnceLock::new();
    static RE_DROPCAP_PAR: OnceLock<Regex> = OnceLock::new();
    static RE_IMG: OnceLock<Regex> = OnceLock::new();
    static RE_TAGS: OnceLock<Regex> = OnceLock::new();
    static RE_MULTI_NL: OnceLock<Regex> = OnceLock::new();

    let re_strip = RE_STRIP_BLOCKS.get_or_init(|| {
        Regex::new(r"(?is)<!--.*?-->|<script\b[^>]*>.*?</script>|<style\b[^>]*>.*?</style>|<head\b[^>]*>.*?</head>")
            .unwrap()
    });
    let re_hidden_span = RE_HIDDEN_SPAN.get_or_init(|| {
        Regex::new(r#"(?is)<span\b[^>]*class\s*=\s*["'][^"']*\bhidden\b[^"']*["'][^>]*>.*?</span>"#)
            .unwrap()
    });
    let re_pre = RE_PRE.get_or_init(|| Regex::new(r"(?is)<pre\b[^>]*>(.*?)</pre>").unwrap());
    let re_heading =
        RE_HEADING.get_or_init(|| Regex::new(r"(?is)<h([1-6])\b[^>]*>(.*?)</h[1-6]>").unwrap());
    let re_div_chapter = RE_DIV_CHAPTER.get_or_init(|| {
        Regex::new(r#"(?is)<div\b[^>]*class\s*=\s*["'][^"']*\b(?:ms_chapter|chapter)\b[^"']*["'][^>]*>(.*?)</div>"#).unwrap()
    });
    let re_div_title = RE_DIV_TITLE.get_or_init(|| {
        Regex::new(r#"(?is)<div\b[^>]*class\s*=\s*["'][^"']*\b(?:epub_ms_title|ms_title)\b[^"']*["'][^>]*>(.*?)</div>"#).unwrap()
    });
    let re_div_author = RE_DIV_AUTHOR.get_or_init(|| {
        Regex::new(r#"(?is)<div\b[^>]*class\s*=\s*["'][^"']*\b(?:epub_ms_author|ms_author)\b[^"']*["'][^>]*>(.*?)</div>"#).unwrap()
    });
    let re_div_break = RE_DIV_BREAK.get_or_init(|| {
        Regex::new(r#"(?is)<div\b[^>]*class\s*=\s*["'][^"']*\bms_break\b[^"']*["'][^>]*>(.*?)</div>"#).unwrap()
    });
    let re_dropcap_par = RE_DROPCAP_PAR.get_or_init(|| {
        Regex::new(
            r#"(?is)<div\b([^>]*)>\s*<div\b([^>]*(?:\bid\s*=\s*["']?dropcap["']?|\bclass\s*=\s*["'][^"']*dropcap_[^"']*["'])[^>]*)>.*?</div>\s*(.*?)</div>"#,
        )
        .unwrap()
    });
    let re_img =
        RE_IMG.get_or_init(|| Regex::new(r#"(?is)<img\b[^>]*src\s*=\s*["']([^"']+)["'][^>]*>"#).unwrap());
    let re_tags = RE_TAGS.get_or_init(|| Regex::new(r"(?is)<(/?)([a-z0-9]+)\b[^>]*>").unwrap());
    let re_nl = RE_MULTI_NL.get_or_init(|| Regex::new(r"\n{3,}").unwrap());

    let mut work = re_strip.replace_all(html, "").into_owned();

    // Lưu trữ các khối đặc biệt (pre, heading, image, dropcap) để tránh escape sai cú pháp Typst
    let mut pre_blocks: Vec<String> = Vec::new();
    let mut heading_blocks: Vec<String> = Vec::new();
    let mut img_blocks: Vec<String> = Vec::new();

    // Xử lý khối mở đầu chương có drop-cap GIF trước khi dọn thẻ <div> / <span class='hidden'>
    work = re_dropcap_par
        .replace_all(&work, |caps: &regex::Captures| {
            let dc_attrs = &caps[2];
            let rest_html = &caps[3];

            let mut img_virtual: Option<String> = None;
            if let Some(cls_str) = extract_attr(dc_attrs, "class") {
                for cls in cls_str.split_whitespace() {
                    if let Some(rules) = css {
                        if let Some(path) = rules.bg_images_by_class.get(cls) {
                            img_virtual = Some(path.clone());
                            break;
                        }
                    }
                    if let Some(letter) = cls.strip_prefix("dropcap_") {
                        let rel = format!("../images/{letter}.gif");
                        img_virtual = Some(match virtual_img_prefix {
                            Some(prefix) => resolve_virtual_rel(prefix, &rel),
                            None => rel,
                        });
                        break;
                    }
                }
            }
            if img_virtual.is_none() {
                if let (Some(rules), Some(id_val)) = (css, extract_attr(dc_attrs, "id")) {
                    if let Some(path) = rules.bg_images_by_id.get(&id_val) {
                        img_virtual = Some(path.clone());
                    }
                }
            }

            let Some(img_path) = img_virtual else {
                return caps[0].to_string();
            };

            let body_typst = convert_inline_fragment(rest_html);
            let idx = img_blocks.len();
            let lit = typst_string_literal(&img_path);
            img_blocks.push(format!(
                "\n#grid(columns: (52pt, 1fr), column-gutter: 10pt, align: (top, top), box(inset: (top: 2pt), image({lit}, width: 52pt)), [{body_typst}])\n\n"
            ));
            format!("\nKNITIMG{idx}END\n")
        })
        .into_owned();

    // Xóa các phần tử ẩn (ví dụ `<span class='hidden'>T</span>`)
    work = re_hidden_span.replace_all(&work, "").into_owned();

    // Tách khối <pre> bằng placeholder trước khi xử lý tag
    work = re_pre
        .replace_all(&work, |caps: &regex::Captures| {
            let inner = strip_all_tags(&caps[1]);
            let decoded = decode_html_entities(&inner);
            let idx = pre_blocks.len();
            pre_blocks.push(format!(
                "\n#block(fill: rgb(\"#F8F9FA\"), stroke: 0.5pt + rgb(\"#DEE2E6\"), inset: 8pt, radius: 4pt, width: 100%)[#raw(block: true, {})]\n",
                typst_string_literal(decoded.trim())
            ));
            format!("\nKNITPRE{idx}END\n")
        })
        .into_owned();

    // Tách tiêu đề từ EPUB div classes & HTML heading
    work = re_div_title
        .replace_all(&work, |caps: &regex::Captures| {
            let text = collapse_whitespace(&decode_html_entities(&strip_all_tags(&caps[1])));
            if text.is_empty() {
                return String::new();
            }
            let idx = heading_blocks.len();
            heading_blocks.push(format!("\n= {}\n\n", escape_typst_text(&text)));
            format!("\nKNITHDR{idx}END\n")
        })
        .into_owned();

    work = re_div_chapter
        .replace_all(&work, |caps: &regex::Captures| {
            let text = collapse_whitespace(&decode_html_entities(&strip_all_tags(&caps[1])));
            if text.is_empty() {
                return String::new();
            }
            let idx = heading_blocks.len();
            heading_blocks.push(format!("\n== {}\n\n", escape_typst_text(&text)));
            format!("\nKNITHDR{idx}END\n")
        })
        .into_owned();

    work = re_div_author
        .replace_all(&work, |caps: &regex::Captures| {
            let text = collapse_whitespace(&decode_html_entities(&strip_all_tags(&caps[1])));
            if text.is_empty() {
                return String::new();
            }
            let idx = pre_blocks.len();
            pre_blocks.push(format!(
                "\n#align(center)[#emph[{}]]\n\n",
                escape_typst_text(&text)
            ));
            format!("\nKNITPRE{idx}END\n")
        })
        .into_owned();

    work = re_div_break
        .replace_all(&work, |caps: &regex::Captures| {
            let text = collapse_whitespace(&decode_html_entities(&strip_all_tags(&caps[1])));
            let idx = pre_blocks.len();
            if text.is_empty() {
                pre_blocks.push("\n#align(center)[#line(length: 30%, stroke: 0.5pt + rgb(\"#ADB5BD\"))]\n\n".to_string());
            } else {
                pre_blocks.push(format!(
                    "\n#align(center)[#text(fill: rgb(\"#6C757D\"))[{}]]\n\n",
                    escape_typst_text(&text)
                ));
            }
            format!("\nKNITPRE{idx}END\n")
        })
        .into_owned();

    // Tách heading HTML chuẩn (h1..h6)
    work = re_heading
        .replace_all(&work, |caps: &regex::Captures| {
            let level: usize = caps[1].parse().unwrap_or(1);
            let text = collapse_whitespace(&decode_html_entities(&strip_all_tags(&caps[2])));
            let idx = heading_blocks.len();
            let eq = "=".repeat(level.clamp(1, 6));
            heading_blocks.push(format!("\n{eq} {}\n\n", escape_typst_text(&text)));
            format!("\nKNITHDR{idx}END\n")
        })
        .into_owned();

    // Tách <img> — dùng kích thước tự nhiên nếu ảnh nhỏ (GIF/icon/QR), co tối đa 85% chiều rộng trang nếu ảnh lớn
    work = re_img
        .replace_all(&work, |caps: &regex::Captures| {
            let src = caps[1].trim();
            if src.starts_with("http://") || src.starts_with("https://") || src.starts_with("data:") {
                return String::new();
            }
            let resolved = match virtual_img_prefix {
                Some(prefix) => resolve_virtual_rel(prefix, src),
                None => src.to_string(),
            };
            let idx = img_blocks.len();
            let lit = typst_string_literal(&resolved);
            img_blocks.push(format!(
                "\n#figure(layout(size => context {{\n  let nat = measure(image({lit}))\n  let w = calc.min(nat.width, size.width * 0.85)\n  image({lit}, width: w)\n}}))\n"
            ));
            format!("\nKNITIMG{idx}END\n")
        })
        .into_owned();

    // Thay thế tag dòng và khối cơ bản, kèm cân bằng stack mở/đóng cho <b>/<strong>/<i>/<em>
    let mut inline_tokens: Vec<(String, String)> = Vec::new();
    let mut open_stack: Vec<&'static str> = Vec::new();
    work = re_tags
        .replace_all(&work, |caps: &regex::Captures| {
            let is_close = &caps[1] == "/";
            let tag = caps[2].to_ascii_lowercase();
            let is_italic_block_div = !is_close
                && tag == "div"
                && extract_attr(&caps[0], "class")
                    .is_some_and(|c| c.contains("ms_quote") || c.contains("story_poem"));

            match (is_close, tag.as_str()) {
                (false, "br") | (false, "hr") => "\n".to_string(),
                (false, "p" | "div" | "section" | "article" | "tr") => {
                    let close_pending = if !open_stack.is_empty() {
                        let m = format!("KNITTOK{}END", inline_tokens.len());
                        inline_tokens.push((m.clone(), "];".repeat(open_stack.len())));
                        open_stack.clear();
                        m
                    } else {
                        String::new()
                    };
                    if is_italic_block_div {
                        let m = format!("KNITTOK{}END", inline_tokens.len());
                        open_stack.push("emph");
                        inline_tokens.push((m.clone(), "#emph[".into()));
                        format!("{close_pending}\n{m}")
                    } else {
                        format!("{close_pending}\n")
                    }
                }
                (true, "p" | "div" | "section" | "article" | "tr" | "ul" | "ol") => {
                    if !open_stack.is_empty() {
                        let m = format!("KNITTOK{}END", inline_tokens.len());
                        inline_tokens.push((m.clone(), "];".repeat(open_stack.len())));
                        open_stack.clear();
                        format!("{m}\n\n")
                    } else {
                        "\n\n".to_string()
                    }
                }
                (false, "li") => {
                    if !open_stack.is_empty() {
                        let m = format!("KNITTOK{}END", inline_tokens.len());
                        inline_tokens.push((m.clone(), "];".repeat(open_stack.len())));
                        open_stack.clear();
                        format!("{m}\n- ")
                    } else {
                        "\n- ".to_string()
                    }
                }
                (false, "td" | "th") => " | ".to_string(),
                (false, "b" | "strong") => {
                    let m = format!("KNITTOK{}END", inline_tokens.len());
                    open_stack.push("strong");
                    inline_tokens.push((m.clone(), "#strong[".into()));
                    m
                }
                (true, "b" | "strong") => {
                    if let Some(pos) = open_stack.iter().rposition(|&t| t == "strong") {
                        let close_count = open_stack.len() - pos;
                        open_stack.truncate(pos);
                        let m = format!("KNITTOK{}END", inline_tokens.len());
                        inline_tokens.push((m.clone(), "];".repeat(close_count)));
                        m
                    } else {
                        String::new()
                    }
                }
                (false, "i" | "em") => {
                    let m = format!("KNITTOK{}END", inline_tokens.len());
                    open_stack.push("emph");
                    inline_tokens.push((m.clone(), "#emph[".into()));
                    m
                }
                (true, "i" | "em") => {
                    if let Some(pos) = open_stack.iter().rposition(|&t| t == "emph") {
                        let close_count = open_stack.len() - pos;
                        open_stack.truncate(pos);
                        let m = format!("KNITTOK{}END", inline_tokens.len());
                        inline_tokens.push((m.clone(), "];".repeat(close_count)));
                        m
                    } else {
                        String::new()
                    }
                }
                _ => String::new(),
            }
        })
        .into_owned();

    if !open_stack.is_empty() {
        let m = format!("KNITTOK{}END", inline_tokens.len());
        inline_tokens.push((m.clone(), "];".repeat(open_stack.len())));
        work.push_str(&m);
    }

    let mut escaped = escape_typst_preserving_markers(&work);

    for (marker, replacement) in inline_tokens {
        escaped = escaped.replace(&marker, &replacement);
    }
    for (idx, block) in pre_blocks.iter().enumerate() {
        escaped = escaped.replace(&format!("KNITPRE{idx}END"), block);
    }
    for (idx, block) in heading_blocks.iter().enumerate() {
        escaped = escaped.replace(&format!("KNITHDR{idx}END"), block);
    }
    for (idx, block) in img_blocks.iter().enumerate() {
        escaped = escaped.replace(&format!("KNITIMG{idx}END"), block);
    }

    re_nl.replace_all(escaped.trim(), "\n\n").into_owned()
}

fn load_or_parse_epub(
    input_path: &Path,
    cancel: &CancellationToken,
    reporter: &dyn JobReporter,
) -> Result<Arc<CachedEpubPayload>> {
    let meta = std::fs::metadata(input_path)?;
    let file_len = meta.len();
    let mtime_nanos = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);

    let cache_lock = LAST_PARSED_EPUB.get_or_init(|| Mutex::new(None));
    if let Ok(guard) = cache_lock.lock() {
        if let Some(existing) = guard.as_ref() {
            if existing.path == input_path
                && existing.file_len == file_len
                && existing.mtime_nanos == mtime_nanos
            {
                return Ok(Arc::clone(existing));
            }
        }
    }

    reporter.info("Extracting and reading EPUB structure");
    let mut doc = EpubDoc::new(input_path).map_err(|e| {
        KnitError::InvalidInput(format!("Failed to open EPUB {}: {e}", input_path.display()))
    })?;

    let title = doc.get_title();

    // Thu thập ảnh và quy tắc CSS trong EPUB
    let mut virtual_files: HashMap<String, Bytes> = HashMap::new();
    let mut css_rules = EpubCssRules::default();
    let res_entries: Vec<(String, std::path::PathBuf, String)> = doc
        .resources
        .iter()
        .map(|(id, item)| (id.clone(), item.path.clone(), item.mime.clone()))
        .collect();
    for (_id, rel_path, mime) in res_entries {
        if cancel.is_cancelled() {
            return Err(KnitError::Cancelled);
        }
        let path_str = rel_path.to_string_lossy().replace('\\', "/");
        if mime.starts_with("image/") {
            if let Some(bytes) = doc.get_resource_by_path(&rel_path) {
                virtual_files.insert(path_str, Bytes::new(bytes));
            }
        } else if mime == "text/css" || path_str.to_ascii_lowercase().ends_with(".css") {
            if let Some(bytes) = doc.get_resource_by_path(&rel_path) {
                let css_dir = rel_path
                    .parent()
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_default();
                let css_str = String::from_utf8_lossy(&bytes);
                parse_epub_css(&css_str, &css_dir, &mut css_rules);
            }
        }
    }

    let mut raw_body = String::new();
    let mut blk_idx = 0usize;
    let num_chapters = doc.get_num_chapters();

    for i in 0..num_chapters {
        if cancel.is_cancelled() {
            return Err(KnitError::Cancelled);
        }
        reporter.on_progress(JobProgress {
            phase: "epub".into(),
            done: (i + 1) as u64,
            total: num_chapters.max(1) as u64,
            bytes_done: 0,
            bytes_total: 0,
            current_item: format!("Chapter {}/{}", i + 1, num_chapters),
        });
        if !doc.set_current_chapter(i) {
            continue;
        }
        let chapter_dir = doc
            .get_current_path()
            .and_then(|p| p.parent().map(|d| d.to_string_lossy().replace('\\', "/")));
        if let Some((xhtml, _mime)) = doc.get_current_str() {
            let converted =
                html_fragment_to_typst_with_css(&xhtml, chapter_dir.as_deref(), Some(&css_rules));
            if !converted.trim().is_empty() {
                if blk_idx > 0 {
                    raw_body.push_str("\n#pagebreak(weak: true)\n");
                }
                let _ = writeln!(raw_body, "#metadata({blk_idx}) <knit-blk>");
                blk_idx += 1;
                let _ = writeln!(raw_body, "{converted}\n");
            }
        }
    }

    if cancel.is_cancelled() {
        return Err(KnitError::Cancelled);
    }

    let body_markup = prepare_typst_images(&raw_body, None, &mut virtual_files);
    let payload = Arc::new(CachedEpubPayload {
        path: input_path.to_path_buf(),
        file_len,
        mtime_nanos,
        title,
        body_markup,
        prepared_virtual: Arc::new(virtual_files),
    });

    if let Ok(mut guard) = cache_lock.lock() {
        *guard = Some(Arc::clone(&payload));
    }

    Ok(payload)
}

pub fn compile_epub_to_pdf_bytes(
    input_path: &Path,
    opts: &DocConvertOptions,
    cancel: &CancellationToken,
    reporter: &dyn JobReporter,
) -> Result<(Vec<u8>, usize)> {
    if cancel.is_cancelled() {
        return Err(KnitError::Cancelled);
    }
    let cached = load_or_parse_epub(input_path, cancel, reporter)?;
    if cancel.is_cancelled() {
        return Err(KnitError::Cancelled);
    }

    let mut effective_opts = opts.clone();
    if effective_opts.title.is_none() {
        effective_opts.title = cached.title.clone();
    }

    let preamble = typst_preamble(&effective_opts);
    let mut markup = String::with_capacity(preamble.len() + cached.body_markup.len());
    markup.push_str(&preamble);
    markup.push_str(&cached.body_markup);

    reporter.info("Compiling EPUB to PDF (Typst)");
    let toc_target = if effective_opts.include_toc && effective_opts.toc_page > 1 {
        Some(effective_opts.toc_page)
    } else {
        None
    };
    compile_typst_with_prepared_assets(
        &markup,
        None,
        Arc::clone(&cached.prepared_virtual),
        toc_target,
        Some(cancel),
    )
}

pub fn convert_epub_to_pdf(
    input_path: &Path,
    output_path: &Path,
    opts: &DocConvertOptions,
    cancel: &CancellationToken,
    reporter: &dyn JobReporter,
) -> Result<DocConvertResult> {
    let (pdf_bytes, pages) = compile_epub_to_pdf_bytes(input_path, opts, cancel, reporter)?;
    atomic_write_file(output_path, |f| Ok(f.write_all(&pdf_bytes)?))?;

    Ok(DocConvertResult {
        input_path: input_path.to_path_buf(),
        output_path: output_path.to_path_buf(),
        kind: DocInputKind::Epub,
        page_count: Some(pages),
        bytes_written: pdf_bytes.len() as u64,
        used_external_engine: false,
    })
}

fn resolve_virtual_rel(base_dir: &str, rel: &str) -> String {
    let clean_rel = rel.trim_start_matches("./");
    let mut parts: Vec<&str> = base_dir
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();
    for seg in clean_rel.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    parts.join("/")
}

fn strip_all_tags(s: &str) -> String {
    static RE_ANY: OnceLock<Regex> = OnceLock::new();
    let re = RE_ANY.get_or_init(|| Regex::new(r"(?is)<[^>]+>").unwrap());
    re.replace_all(s, "").into_owned()
}

fn decode_html_entities(s: &str) -> String {
    s.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
}
