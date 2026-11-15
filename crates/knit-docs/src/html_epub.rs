use crate::markdown::{escape_typst_text, typst_preamble, typst_string_literal};
use crate::models::{DocConvertOptions, DocConvertResult, DocInputKind};
use crate::world::compile_typst_to_pdf_with_toc;
use epub::doc::EpubDoc;
use knit_core::{
    atomic_write_file, CancellationToken, JobProgress, JobReporter, JobReporterExt, KnitError,
    Result,
};
use regex::Regex;
use std::collections::HashMap;
use std::fmt::Write as _;
use std::io::Write;
use std::path::Path;
use std::sync::OnceLock;

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
    static RE_STRIP_BLOCKS: OnceLock<Regex> = OnceLock::new();
    static RE_PRE: OnceLock<Regex> = OnceLock::new();
    static RE_HEADING: OnceLock<Regex> = OnceLock::new();
    static RE_IMG: OnceLock<Regex> = OnceLock::new();
    static RE_TAGS: OnceLock<Regex> = OnceLock::new();
    static RE_MULTI_NL: OnceLock<Regex> = OnceLock::new();

    let re_strip = RE_STRIP_BLOCKS.get_or_init(|| {
        Regex::new(r"(?is)<script\b[^>]*>.*?</script>|<style\b[^>]*>.*?</style>|<head\b[^>]*>.*?</head>").unwrap()
    });
    let re_pre = RE_PRE.get_or_init(|| Regex::new(r"(?is)<pre\b[^>]*>(.*?)</pre>").unwrap());
    let re_heading =
        RE_HEADING.get_or_init(|| Regex::new(r"(?is)<h([1-6])\b[^>]*>(.*?)</h[1-6]>").unwrap());
    let re_img =
        RE_IMG.get_or_init(|| Regex::new(r#"(?is)<img\b[^>]*src\s*=\s*["']([^"']+)["'][^>]*>"#).unwrap());
    let re_tags = RE_TAGS.get_or_init(|| Regex::new(r"(?is)<(/?)([a-z0-9]+)\b[^>]*>").unwrap());
    let re_nl = RE_MULTI_NL.get_or_init(|| Regex::new(r"\n{3,}").unwrap());

    let mut work = re_strip.replace_all(html, "").into_owned();

    // Tách khối <pre> bằng placeholder trước khi xử lý tag
    let mut pre_blocks: Vec<String> = Vec::new();
    work = re_pre
        .replace_all(&work, |caps: &regex::Captures| {
            let inner = strip_all_tags(&caps[1]);
            let decoded = decode_html_entities(&inner);
            let idx = pre_blocks.len();
            pre_blocks.push(format!(
                "\n#block(fill: rgb(\"#F8F9FA\"), stroke: 0.5pt + rgb(\"#DEE2E6\"), inset: 8pt, radius: 4pt, width: 100%)[#raw(block: true, {})]\n",
                typst_string_literal(decoded.trim())
            ));
            format!("KNITPRE{idx}END")
        })
        .into_owned();

    // Tách heading
    let mut heading_blocks: Vec<String> = Vec::new();
    work = re_heading
        .replace_all(&work, |caps: &regex::Captures| {
            let level: usize = caps[1].parse().unwrap_or(1);
            let text = decode_html_entities(&strip_all_tags(&caps[2])).trim().to_string();
            let idx = heading_blocks.len();
            let eq = "=".repeat(level.clamp(1, 6));
            heading_blocks.push(format!("\n{eq} {}\n\n", escape_typst_text(&text)));
            format!("KNITHDR{idx}END")
        })
        .into_owned();

    // Tách <img>
    let mut img_blocks: Vec<String> = Vec::new();
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
            img_blocks.push(format!(
                "\n#figure(image({}, width: 85%))\n",
                typst_string_literal(&resolved)
            ));
            format!("KNITIMG{idx}END")
        })
        .into_owned();

    // Thay thế tag dòng và khối cơ bản bằng marker an toàn trước khi escape văn bản
    let mut inline_tokens: Vec<(String, String)> = Vec::new();
    work = re_tags
        .replace_all(&work, |caps: &regex::Captures| {
            let is_close = &caps[1] == "/";
            let tag = caps[2].to_ascii_lowercase();
            let tok = match (is_close, tag.as_str()) {
                (false, "br") | (false, "hr") => "\n",
                (false, "p" | "div" | "section" | "article" | "tr") => "\n",
                (true, "p" | "div" | "section" | "article" | "tr" | "ul" | "ol") => "\n\n",
                (false, "li") => "\n- ",
                (false, "td" | "th") => " | ",
                (false, "b" | "strong") => {
                    let m = format!("KNITTOK{}END", inline_tokens.len());
                    inline_tokens.push((m.clone(), "#strong[".into()));
                    return m;
                }
                (true, "b" | "strong" | "i" | "em") => {
                    let m = format!("KNITTOK{}END", inline_tokens.len());
                    inline_tokens.push((m.clone(), "]".into()));
                    return m;
                }
                (false, "i" | "em") => {
                    let m = format!("KNITTOK{}END", inline_tokens.len());
                    inline_tokens.push((m.clone(), "#emph[".into()));
                    return m;
                }
                _ => "",
            };
            tok.to_string()
        })
        .into_owned();

    let decoded = decode_html_entities(&work);
    let mut escaped = escape_typst_text(&decoded);

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

pub fn compile_epub_to_pdf_bytes(
    input_path: &Path,
    opts: &DocConvertOptions,
    cancel: &CancellationToken,
    reporter: &dyn JobReporter,
) -> Result<(Vec<u8>, usize)> {
    reporter.info("Dang giai nen va doc cau truc EPUB");
    let mut doc = EpubDoc::new(input_path)
        .map_err(|e| KnitError::InvalidInput(format!("Loi mo EPUB {}: {e}", input_path.display())))?;

    let mut effective_opts = opts.clone();
    if effective_opts.title.is_none() {
        effective_opts.title = doc.get_title();
    }

    // Thu thập ảnh/tài nguyên nhúng trong EPUB vào virtual filesystem của Typst
    let mut virtual_files: HashMap<String, Vec<u8>> = HashMap::new();
    let res_entries: Vec<(String, std::path::PathBuf, String)> = doc
        .resources
        .iter()
        .map(|(id, item)| (id.clone(), item.path.clone(), item.mime.clone()))
        .collect();
    for (_id, rel_path, mime) in res_entries {
        if mime.starts_with("image/") {
            if let Some(bytes) = doc.get_resource_by_path(&rel_path) {
                let key = rel_path.to_string_lossy().replace('\\', "/");
                virtual_files.insert(key, bytes);
            }
        }
    }

    let mut markup = typst_preamble(&effective_opts);
    let emit_blk_markers = effective_opts.include_toc && effective_opts.toc_page > 1;
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
            current_item: format!("Chuong {}/{}", i + 1, num_chapters),
        });
        if !doc.set_current_chapter(i) {
            continue;
        }
        let chapter_dir = doc
            .get_current_path()
            .and_then(|p| p.parent().map(|d| d.to_string_lossy().replace('\\', "/")));
        if let Some((xhtml, _mime)) = doc.get_current_str() {
            let converted = html_fragment_to_typst(&xhtml, chapter_dir.as_deref());
            if !converted.trim().is_empty() {
                if i > 0 {
                    markup.push_str("\n#pagebreak(weak: true)\n");
                }
                if emit_blk_markers {
                    let _ = writeln!(markup, "#metadata({blk_idx}) <knit-blk>");
                    blk_idx += 1;
                }
                let _ = writeln!(markup, "{converted}\n");
            }
        }
    }

    reporter.info("Dang bien dich EPUB sang PDF (Typst)");
    let toc_target = if effective_opts.include_toc && effective_opts.toc_page > 1 {
        Some(effective_opts.toc_page)
    } else {
        None
    };
    compile_typst_to_pdf_with_toc(&markup, None, &virtual_files, toc_target)
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
