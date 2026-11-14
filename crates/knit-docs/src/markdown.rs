use crate::models::{DocConvertOptions, DocFont, DocTheme};
use pulldown_cmark::{CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use std::collections::HashMap;
use std::fmt::Write as _;

const EMOJI_FALLBACK_FONTS: &str = "\"Noto Emoji\", \"Noto Sans Symbols 2\", \"Noto Sans Symbols\", \"Noto Color Emoji\", \"Apple Color Emoji\", \"Segoe UI Emoji\", \"Twemoji Mozilla\"";

fn typst_font_tuple(font: DocFont, theme: DocTheme) -> String {
    let primary = match font {
        DocFont::Afacad => "\"Afacad\", \"Roboto\", \"Libertinus Serif\"",
        DocFont::Roboto => "\"Roboto\", \"Afacad\", \"Libertinus Serif\"",
        DocFont::Lora => "\"Lora\", \"Libertinus Serif\", \"New Computer Modern\"",
        DocFont::LibertinusSerif => "\"Libertinus Serif\", \"New Computer Modern\"",
        DocFont::NewComputerModern => "\"New Computer Modern\", \"Libertinus Serif\"",
        DocFont::DejaVuSansMono => "\"DejaVu Sans Mono\", \"Libertinus Serif\"",
        DocFont::Default => match theme {
            DocTheme::GitHub | DocTheme::VsCodeLight => "\"Roboto\", \"Afacad\", \"Libertinus Serif\"",
            DocTheme::Modern | DocTheme::Obsidian => "\"Afacad\", \"Roboto\", \"Libertinus Serif\"",
            DocTheme::Resume => "\"Roboto\", \"Libertinus Serif\"",
            DocTheme::Academic | DocTheme::Minimal => "\"Libertinus Serif\", \"New Computer Modern\"",
        },
    };
    format!("({primary}, {EMOJI_FALLBACK_FONTS})")
}

pub(crate) fn typst_preamble(opts: &DocConvertOptions) -> String {
    let mut s = String::new();
    let margin = opts.margin_mm.clamp(5.0, 60.0);
    let font_size = opts.font_size_pt.clamp(7.0, 24.0);
    let font_tuple = typst_font_tuple(opts.font, opts.theme);

    let _ = writeln!(
        s,
        "#set page(paper: \"{}\", margin: {}mm, numbering: \"1\")",
        opts.page_size.typst_name(),
        margin
    );

    match opts.theme {
        DocTheme::GitHub => {
            let _ = writeln!(
                s,
                "#set text(font: {font_tuple}, size: {font_size}pt, fill: rgb(\"#24292F\"))"
            );
            let _ = writeln!(s, "#set par(justify: false, leading: 0.65em, spacing: 0.9em)");
            let _ = writeln!(s, "#set heading(numbering: none)");
            let _ = writeln!(
                s,
                "#show heading.where(level: 1): it => block(below: 0.7em, above: 1.1em, width: 100%, stroke: (bottom: 0.75pt + rgb(\"#D0D7DE\")), inset: (bottom: 0.3em), text(size: 1.45em, weight: \"bold\", fill: rgb(\"#1F2328\"), it.body))"
            );
            let _ = writeln!(
                s,
                "#show heading.where(level: 2): it => block(below: 0.55em, above: 0.95em, width: 100%, stroke: (bottom: 0.5pt + rgb(\"#D8DEE4\")), inset: (bottom: 0.25em), text(size: 1.2em, weight: \"semibold\", fill: rgb(\"#1F2328\"), it.body))"
            );
            let _ = writeln!(s, "#show link: set text(fill: rgb(\"#0969DA\"))");
            let _ = writeln!(s, "#show raw.where(block: false): it => highlight(fill: rgb(\"#EAECEF\"), stroke: 0.4pt + rgb(\"#D0D7DE\"), extent: 2pt, radius: 3pt, it)");
        }
        DocTheme::Academic => {
            let _ = writeln!(
                s,
                "#set text(font: {font_tuple}, size: {font_size}pt, fill: rgb(\"#1A1A1A\"))"
            );
            let _ = writeln!(s, "#set par(justify: true, leading: 0.75em, spacing: 0.95em)");
            let _ = writeln!(s, "#set heading(numbering: \"1.1\")");
            let _ = writeln!(
                s,
                "#show heading.where(level: 1): it => block(below: 0.8em, above: 1.2em, width: 100%, stroke: (bottom: 1pt + rgb(\"#1A1A1A\")), inset: (bottom: 0.25em), text(size: 1.35em, weight: \"bold\", it))"
            );
            let _ = writeln!(s, "#show heading.where(level: 2): set text(size: 1.15em, weight: \"bold\")");
            let _ = writeln!(s, "#show link: set text(fill: rgb(\"#1D4ED8\"))");
            let _ = writeln!(s, "#show raw.where(block: false): it => highlight(fill: rgb(\"#F3F4F6\"), stroke: 0.4pt + rgb(\"#D1D5DB\"), extent: 2pt, radius: 3pt, it)");
        }
        DocTheme::Minimal => {
            let _ = writeln!(
                s,
                "#set text(font: {font_tuple}, size: {font_size}pt, fill: rgb(\"#343A40\"))"
            );
            let _ = writeln!(s, "#set par(justify: false, leading: 0.78em, spacing: 1.05em)");
            let _ = writeln!(s, "#set heading(numbering: none)");
            let _ = writeln!(
                s,
                "#show heading.where(level: 1): it => block(below: 0.75em, above: 1.3em, text(size: 1.35em, weight: \"semibold\", fill: rgb(\"#212529\"), it.body))"
            );
            let _ = writeln!(
                s,
                "#show heading.where(level: 2): it => block(below: 0.55em, above: 1.0em, text(size: 1.12em, weight: \"medium\", fill: rgb(\"#495057\"), it.body))"
            );
            let _ = writeln!(s, "#show link: set text(fill: rgb(\"#495057\"))");
            let _ = writeln!(s, "#show raw.where(block: false): it => highlight(fill: rgb(\"#F1F3F5\"), stroke: 0.4pt + rgb(\"#DEE2E6\"), extent: 2pt, radius: 3pt, it)");
        }
        DocTheme::Modern => {
            let _ = writeln!(
                s,
                "#set text(font: {font_tuple}, size: {font_size}pt, fill: rgb(\"#1F2937\"))"
            );
            let _ = writeln!(s, "#set par(justify: false, leading: 0.68em, spacing: 0.95em)");
            let _ = writeln!(s, "#set heading(numbering: none)");
            let _ = writeln!(
                s,
                "#show heading.where(level: 1): it => block(below: 0.75em, above: 1.15em, width: 100%, stroke: (left: 3pt + rgb(\"#007BFF\")), inset: (left: 8pt, y: 2pt), fill: rgb(\"#F8FAFC\"), text(size: 1.42em, weight: \"bold\", fill: rgb(\"#111827\"), it.body))"
            );
            let _ = writeln!(
                s,
                "#show heading.where(level: 2): it => block(below: 0.5em, above: 0.95em, text(size: 1.18em, weight: \"bold\", fill: rgb(\"#0069D9\"), it.body))"
            );
            let _ = writeln!(s, "#show link: set text(fill: rgb(\"#007BFF\"))");
            let _ = writeln!(s, "#show raw.where(block: false): it => highlight(fill: rgb(\"#DBEAFE\"), stroke: 0.4pt + rgb(\"#93C5FD\"), extent: 2pt, radius: 3pt, text(fill: rgb(\"#1E3A8A\"), it))");
        }
        DocTheme::Resume => {
            let _ = writeln!(
                s,
                "#set text(font: {font_tuple}, size: {font_size}pt, fill: rgb(\"#212529\"))"
            );
            let _ = writeln!(s, "#set par(justify: false, leading: 0.55em, spacing: 0.72em)");
            let _ = writeln!(s, "#set heading(numbering: none)");
            let _ = writeln!(
                s,
                "#show heading.where(level: 1): it => block(below: 0.45em, above: 0.6em, width: 100%, stroke: (bottom: 1.5pt + rgb(\"#343A40\")), inset: (bottom: 0.2em), text(size: 1.55em, weight: \"bold\", fill: rgb(\"#212529\"), it.body))"
            );
            let _ = writeln!(
                s,
                "#show heading.where(level: 2): it => block(below: 0.4em, above: 0.8em, width: 100%, stroke: (bottom: 0.75pt + rgb(\"#007BFF\")), inset: (bottom: 0.15em), text(size: 1.08em, weight: \"bold\", fill: rgb(\"#0069D9\"), upper(it.body)))"
            );
            let _ = writeln!(s, "#show link: set text(fill: rgb(\"#007BFF\"))");
            let _ = writeln!(s, "#show raw.where(block: false): it => highlight(fill: rgb(\"#E9ECEF\"), stroke: 0.4pt + rgb(\"#CED4DA\"), extent: 2pt, radius: 3pt, it)");
        }
        DocTheme::VsCodeLight => {
            let _ = writeln!(
                s,
                "#set text(font: {font_tuple}, size: {font_size}pt, fill: rgb(\"#242424\"))"
            );
            let _ = writeln!(s, "#set par(justify: false, leading: 0.65em, spacing: 0.9em)");
            let _ = writeln!(s, "#set heading(numbering: none)");
            let _ = writeln!(
                s,
                "#show heading.where(level: 1): it => block(below: 0.65em, above: 1.05em, width: 100%, stroke: (bottom: 0.75pt + rgb(\"#E1E4E8\")), inset: (bottom: 0.28em), text(size: 1.48em, weight: \"semibold\", fill: rgb(\"#1B1F23\"), it.body))"
            );
            let _ = writeln!(
                s,
                "#show heading.where(level: 2): it => block(below: 0.5em, above: 0.9em, width: 100%, stroke: (bottom: 0.5pt + rgb(\"#EAECEF\")), inset: (bottom: 0.22em), text(size: 1.22em, weight: \"semibold\", fill: rgb(\"#1B1F23\"), it.body))"
            );
            let _ = writeln!(s, "#show link: set text(fill: rgb(\"#006AB1\"))");
            let _ = writeln!(
                s,
                "#show quote: it => block(inset: (left: 10pt, y: 4pt, right: 6pt), stroke: (left: 3pt + rgb(\"#007ACC\")), fill: rgb(\"#F3F8FD\"), it.body)"
            );
            let _ = writeln!(
                s,
                "#show raw.where(block: false): it => highlight(fill: rgb(\"#EDEDED\"), stroke: 0.4pt + rgb(\"#D4D4D4\"), extent: 2pt, radius: 3pt, text(fill: rgb(\"#A31515\"), it))"
            );
        }
        DocTheme::Obsidian => {
            let _ = writeln!(
                s,
                "#set text(font: {font_tuple}, size: {font_size}pt, fill: rgb(\"#222222\"))"
            );
            let _ = writeln!(s, "#set par(justify: false, leading: 0.68em, spacing: 0.95em)");
            let _ = writeln!(s, "#set heading(numbering: none)");
            let _ = writeln!(
                s,
                "#show heading.where(level: 1): it => block(below: 0.7em, above: 1.15em, text(size: 1.5em, weight: \"bold\", fill: rgb(\"#5B21B6\"), it.body))"
            );
            let _ = writeln!(
                s,
                "#show heading.where(level: 2): it => block(below: 0.55em, above: 0.95em, text(size: 1.24em, weight: \"semibold\", fill: rgb(\"#7C3AED\"), it.body))"
            );
            let _ = writeln!(
                s,
                "#show heading.where(level: 3): it => block(below: 0.45em, above: 0.8em, text(size: 1.08em, weight: \"semibold\", fill: rgb(\"#6D28D9\"), it.body))"
            );
            let _ = writeln!(s, "#show link: set text(fill: rgb(\"#7C3AED\"))");
            let _ = writeln!(
                s,
                "#show quote: it => block(inset: (left: 10pt, y: 5pt, right: 8pt), stroke: (left: 3pt + rgb(\"#7C3AED\")), fill: rgb(\"#F5F3FF\"), radius: (right: 4pt), it.body)"
            );
            let _ = writeln!(
                s,
                "#show raw.where(block: false): it => highlight(fill: rgb(\"#EDE9FE\"), stroke: 0.4pt + rgb(\"#C4B5FD\"), extent: 2pt, radius: 3pt, text(fill: rgb(\"#5B21B6\"), it))"
            );
        }
    }

    if let Some(ref title) = opts.title {
        if !title.trim().is_empty() {
            let _ = writeln!(s, "= {}\n", escape_typst_text(title.trim()));
        }
    }
    if opts.include_toc {
        let _ = writeln!(s, "#outline(indent: auto)\n#pagebreak(weak: true)");
    }
    s
}

pub(crate) fn escape_typst_text(input: &str) -> String {
    let mut out = String::with_capacity(input.len() + 8);
    for ch in input.chars() {
        match ch {
            '\\' | '#' | '$' | '@' | '*' | '_' | '`' | '<' | '>' | '[' | ']' | '=' | '~' => {
                out.push('\\');
                out.push(ch);
            }
            _ => out.push(ch),
        }
    }
    out
}

pub(crate) fn typst_string_literal(input: &str) -> String {
    let mut out = String::with_capacity(input.len() + 4);
    out.push('"');
    for ch in input.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\r' => {}
            _ => out.push(ch),
        }
    }
    out.push('"');
    out
}

pub fn txt_to_typst(txt: &str, opts: &DocConvertOptions) -> String {
    let mut out = typst_preamble(opts);
    let _ = writeln!(
        out,
        "#set text(font: (\"DejaVu Sans Mono\", \"Libertinus Serif\", {EMOJI_FALLBACK_FONTS}), size: {}pt)",
        (opts.font_size_pt - 1.0).clamp(7.0, 20.0)
    );
    for line in txt.lines() {
        if line.is_empty() {
            out.push_str("\n\n");
        } else {
            out.push_str(&escape_typst_text(line));
            out.push_str("\\\n");
        }
    }
    out
}

#[derive(Debug, Clone)]
enum YamlVal {
    Scalar(String),
    List(Vec<String>),
    Map(Vec<(String, YamlVal)>),
}

fn unquote_yaml(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.len() >= 2
        && ((trimmed.starts_with('"') && trimmed.ends_with('"'))
            || (trimmed.starts_with('\'') && trimmed.ends_with('\'')))
    {
        return trimmed[1..trimmed.len() - 1].to_string();
    }
    trimmed.to_string()
}

fn count_indent_cols(line: &str) -> usize {
    line.chars()
        .take_while(|c| *c == ' ' || *c == '\t')
        .map(|c| if c == '\t' { 2 } else { 1 })
        .sum()
}

fn extract_yaml_frontmatter(md: &str) -> Option<(Vec<(String, YamlVal)>, &str)> {
    let stripped = md.strip_prefix('\u{FEFF}').unwrap_or(md);
    let mut lines_iter = stripped.split_inclusive('\n');
    let mut offset = 0usize;

    // Allow optional blank lines before opening `---`
    let mut found_open = false;
    for line in &mut lines_iter {
        offset += line.len();
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        if t == "---" {
            found_open = true;
            break;
        }
        return None;
    }
    if !found_open {
        return None;
    }

    let mut yaml_lines: Vec<&str> = Vec::new();
    let mut found_close = false;
    for line in lines_iter {
        offset += line.len();
        let t = line.trim();
        if t == "---" || t == "..." {
            found_close = true;
            break;
        }
        yaml_lines.push(line.trim_end_matches(&['\r', '\n'][..]));
    }
    if !found_close || yaml_lines.is_empty() {
        return None;
    }

    let (entries, _) = parse_yaml_block(&yaml_lines, 0, None);
    if entries.is_empty() {
        return None;
    }
    Some((entries, &stripped[offset..]))
}

fn parse_yaml_block(
    lines: &[&str],
    start: usize,
    base_indent: Option<usize>,
) -> (Vec<(String, YamlVal)>, usize) {
    let mut entries = Vec::new();
    let mut i = start;
    let mut expected_indent = base_indent;

    while i < lines.len() {
        let raw = lines[i];
        let trimmed = raw.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            i += 1;
            continue;
        }
        let indent = count_indent_cols(raw);
        let root_indent = match expected_indent {
            Some(ind) => {
                if indent < ind {
                    break;
                }
                ind
            }
            None => {
                expected_indent = Some(indent);
                indent
            }
        };
        if indent > root_indent {
            // Indented continuation without a parent key: skip safely
            i += 1;
            continue;
        }
        if trimmed.starts_with("- ") {
            break;
        }
        let Some((k_raw, v_raw)) = trimmed.split_once(':') else {
            i += 1;
            continue;
        };
        let key = unquote_yaml(k_raw);
        let val_trimmed = v_raw.trim();
        i += 1;

        if !val_trimmed.is_empty() {
            if val_trimmed.starts_with('[') && val_trimmed.ends_with(']') && val_trimmed.len() >= 2 {
                let items = val_trimmed[1..val_trimmed.len() - 1]
                    .split(',')
                    .map(unquote_yaml)
                    .filter(|s| !s.is_empty())
                    .collect();
                entries.push((key, YamlVal::List(items)));
            } else {
                entries.push((key, YamlVal::Scalar(unquote_yaml(val_trimmed))));
            }
        } else {
            // Peek next non-empty line to check if nested map or list
            let mut peek = i;
            while peek < lines.len() && (lines[peek].trim().is_empty() || lines[peek].trim().starts_with('#')) {
                peek += 1;
            }
            if peek < lines.len() {
                let next_indent = count_indent_cols(lines[peek]);
                let next_trimmed = lines[peek].trim();
                if next_indent > root_indent {
                    if next_trimmed.starts_with("- ") {
                        let mut items = Vec::new();
                        let mut j = peek;
                        while j < lines.len() {
                            let l = lines[j];
                            let lt = l.trim();
                            if lt.is_empty() || lt.starts_with('#') {
                                j += 1;
                                continue;
                            }
                            if count_indent_cols(l) < next_indent || !lt.starts_with("- ") {
                                break;
                            }
                            items.push(unquote_yaml(lt.trim_start_matches("- ").trim()));
                            j += 1;
                        }
                        i = j;
                        entries.push((key, YamlVal::List(items)));
                    } else {
                        let (sub_entries, next_i) = parse_yaml_block(lines, peek, Some(next_indent));
                        i = next_i;
                        entries.push((key, YamlVal::Map(sub_entries)));
                    }
                    continue;
                }
            }
            entries.push((key, YamlVal::Scalar(String::new())));
        }
    }

    (entries, i)
}

fn render_yaml_val_typst(val: &YamlVal) -> String {
    match val {
        YamlVal::Scalar(s) => {
            if s.is_empty() {
                "\"\"".to_string()
            } else {
                escape_typst_text(s)
            }
        }
        YamlVal::List(items) => {
            if items.is_empty() {
                "[]".to_string()
            } else {
                items
                    .iter()
                    .map(|it| format!("- {}", escape_typst_text(it)))
                    .collect::<Vec<_>>()
                    .join("\n")
            }
        }
        YamlVal::Map(entries) => render_yaml_table_typst(entries, true),
    }
}

fn render_yaml_table_typst(entries: &[(String, YamlVal)], nested: bool) -> String {
    let mut out = String::new();
    let stroke = if nested { "0.4pt + rgb(\"#DEE2E6\")" } else { "0.5pt + rgb(\"#CED4DA\")" };
    let inset = if nested { "4pt" } else { "6pt" };
    let _ = write!(
        out,
        "#table(columns: (auto, 1fr), align: (left, left), stroke: {stroke}, inset: {inset}, fill: (x, _y) => if x == 0 {{ rgb(\"#F8F9FA\") }} else {{ white }}, "
    );
    for (k, v) in entries {
        let _ = write!(
            out,
            "[#strong[{}]], [{}], ",
            escape_typst_text(k),
            render_yaml_val_typst(v)
        );
    }
    out.push(')');
    out
}

fn checkbox_typst(checked: bool) -> &'static str {
    if checked {
        "#box(width: 0.85em, height: 0.85em, baseline: 12%, radius: 2pt, fill: rgb(\"#0969DA\"), stroke: 0.9pt + rgb(\"#0969DA\"), { place(dx: 0.16em, dy: 0.45em, line(end: (0.18em, 0.18em), stroke: 1.3pt + white)); place(dx: 0.34em, dy: 0.63em, line(end: (0.34em, -0.36em), stroke: 1.3pt + white)) });#h(0.4em);"
    } else {
        "#box(width: 0.85em, height: 0.85em, baseline: 12%, radius: 2pt, stroke: 0.9pt + rgb(\"#6C757D\"));#h(0.4em);"
    }
}

fn handle_inline_html(html: &str) -> String {
    let trimmed = html.trim();
    if trimmed.is_empty() || trimmed.starts_with("<!--") {
        return String::new();
    }
    let lower = trimmed.to_ascii_lowercase();
    if matches!(lower.as_str(), "<br>" | "<br/>" | "<br />") {
        return "\\\n".to_string();
    }
    if matches!(lower.as_str(), "<hr>" | "<hr/>" | "<hr />") {
        return "\n#line(length: 100%, stroke: 0.5pt + rgb(\"#DEE2E6\"))\n\n".to_string();
    }
    if matches!(lower.as_str(), "<b>" | "<strong>") {
        return "#strong[".to_string();
    }
    if matches!(lower.as_str(), "</b>" | "</strong>") {
        return "];".to_string();
    }
    if matches!(lower.as_str(), "<i>" | "<em>") {
        return "#emph[".to_string();
    }
    if matches!(lower.as_str(), "</i>" | "</em>") {
        return "];".to_string();
    }
    let inner = lower
        .trim_start_matches('<')
        .trim_end_matches('>')
        .trim_start_matches('/')
        .split_whitespace()
        .next()
        .unwrap_or("")
        .trim_end_matches('/');
    const KNOWN_HTML_TAGS: &[&str] = &[
        "u", "s", "del", "ins", "code", "kbd", "sup", "sub", "mark", "small", "span", "div", "p",
        "a", "img", "table", "thead", "tbody", "tr", "td", "th", "ul", "ol", "li", "h1", "h2",
        "h3", "h4", "h5", "h6", "details", "summary", "center", "blockquote", "pre", "font",
    ];
    if KNOWN_HTML_TAGS.contains(&inner) {
        return String::new();
    }
    // Literal placeholder like <StudentID> or <SelfAssessedGrade>
    escape_typst_text(html)
}

pub fn markdown_to_typst(md: &str, opts: &DocConvertOptions) -> String {
    markdown_to_typst_with_assets(md, opts).0
}

pub fn markdown_to_typst_with_assets(
    md: &str,
    opts: &DocConvertOptions,
) -> (String, HashMap<String, Vec<u8>>) {
    let mut out = typst_preamble(opts);
    let mut assets: HashMap<String, Vec<u8>> = HashMap::new();
    let mut mermaid_idx = 0usize;
    let body_md = if let Some((frontmatter, rest)) = extract_yaml_frontmatter(md) {
        let _ = writeln!(out, "{}\n", render_yaml_table_typst(&frontmatter, false));
        rest
    } else {
        md
    };

    let mut cm_opts = Options::empty();
    cm_opts.insert(Options::ENABLE_TABLES);
    cm_opts.insert(Options::ENABLE_STRIKETHROUGH);
    cm_opts.insert(Options::ENABLE_TASKLISTS);

    let parser = Parser::new_ext(body_md, cm_opts);

    let mut list_stack: Vec<Option<u64>> = Vec::new();
    let mut in_code_block = false;
    let mut code_lang: Option<String> = None;
    let mut code_buf = String::new();
    let mut in_table = false;
    let mut table_cols: usize = 0;
    let mut table_cells: Vec<String> = Vec::new();
    let mut current_cell = String::new();
    let mut in_cell = false;
    let mut in_link = false;
    let mut link_url = String::new();
    let mut link_text = String::new();
    let mut in_image = false;
    let mut image_url = String::new();
    let mut image_alt = String::new();

    for event in parser {
        if in_code_block {
            match event {
                Event::Text(t) | Event::Code(t) => code_buf.push_str(&t),
                Event::SoftBreak | Event::HardBreak => code_buf.push('\n'),
                Event::End(TagEnd::CodeBlock) => {
                    in_code_block = false;
                    let lang_trimmed = code_lang.as_deref().map(str::trim).unwrap_or("");
                    if lang_trimmed.eq_ignore_ascii_case("mermaid") {
                        let key = code_buf.replace("\r\n", "\n").trim().to_string();
                        if let Some(svg_content) = opts.mermaid_svgs.get(&key) {
                            let vname = format!("__knit_mermaid_{mermaid_idx}.svg");
                            mermaid_idx += 1;
                            assets.insert(vname.clone(), svg_content.as_bytes().to_vec());
                            let _ = writeln!(
                                out,
                                "\n#figure(image({}, width: 92%))\n",
                                typst_string_literal(&vname)
                            );
                        } else {
                            let _ = writeln!(
                                out,
                                "\n#block(fill: rgb(\"#F1F5F9\"), stroke: 0.6pt + rgb(\"#CBD5E1\"), inset: 9pt, radius: 4pt, width: 100%, breakable: true)[#raw(block: true, lang: \"mermaid\", {})]\n",
                                typst_string_literal(code_buf.trim_end_matches('\n'))
                            );
                        }
                    } else {
                        let lang_arg = (!lang_trimmed.is_empty())
                            .then(|| format!(", lang: {}", typst_string_literal(lang_trimmed)))
                            .unwrap_or_default();
                        let _ = writeln!(
                            out,
                            "\n#block(fill: rgb(\"#F1F5F9\"), stroke: 0.6pt + rgb(\"#CBD5E1\"), inset: 9pt, radius: 4pt, width: 100%, breakable: true)[#raw(block: true{lang_arg}, {})]\n",
                            typst_string_literal(code_buf.trim_end_matches('\n'))
                        );
                    }
                    code_buf.clear();
                    code_lang = None;
                }
                _ => {}
            }
            continue;
        }

        if in_image {
            match event {
                Event::Text(t) => image_alt.push_str(&t),
                Event::End(TagEnd::Image) => {
                    in_image = false;
                    if !image_url.starts_with("http://") && !image_url.starts_with("https://") {
                        let clean_path = image_url.trim();
                        if !clean_path.is_empty() {
                            let alt_trimmed = image_alt.trim();
                            if alt_trimmed.is_empty() {
                                let _ = writeln!(
                                    out,
                                    "\n#figure(image({}, width: 90%))\n",
                                    typst_string_literal(clean_path),
                                );
                            } else {
                                let _ = writeln!(
                                    out,
                                    "\n#figure(image({}, width: 90%), caption: [{}])\n",
                                    typst_string_literal(clean_path),
                                    escape_typst_text(alt_trimmed)
                                );
                            }
                        }
                    } else if !image_alt.is_empty() {
                        let _ = writeln!(out, "[Image: {}]", escape_typst_text(&image_alt));
                    }
                    image_url.clear();
                    image_alt.clear();
                }
                _ => {}
            }
            continue;
        }

        if in_link {
            match event {
                Event::Text(t) => link_text.push_str(&escape_typst_text(&t)),
                Event::Code(t) => {
                    let _ = write!(link_text, "#raw({});", typst_string_literal(&t));
                }
                Event::InlineHtml(html) => link_text.push_str(&handle_inline_html(&html)),
                Event::End(TagEnd::Link) => {
                    in_link = false;
                    let target = if link_url.starts_with("http://") || link_url.starts_with("https://") {
                        format!(
                            "#link({})[{}];",
                            typst_string_literal(&link_url),
                            link_text
                        )
                    } else {
                        link_text.clone()
                    };
                    if in_cell {
                        current_cell.push_str(&target);
                    } else {
                        out.push_str(&target);
                    }
                    link_url.clear();
                    link_text.clear();
                }
                _ => {}
            }
            continue;
        }

        match event {
            Event::Start(tag) => match tag {
                Tag::Heading { level, .. } => {
                    let depth = match level {
                        HeadingLevel::H1 => 1,
                        HeadingLevel::H2 => 2,
                        HeadingLevel::H3 => 3,
                        HeadingLevel::H4 => 4,
                        HeadingLevel::H5 => 5,
                        HeadingLevel::H6 => 6,
                    };
                    out.push('\n');
                    for _ in 0..depth {
                        out.push('=');
                    }
                    out.push(' ');
                }
                Tag::Paragraph => {}
                Tag::BlockQuote(_) => out.push_str("\n#quote(block: true)["),
                Tag::CodeBlock(kind) => {
                    in_code_block = true;
                    code_buf.clear();
                    code_lang = match kind {
                        CodeBlockKind::Fenced(lang) => Some(lang.to_string()),
                        CodeBlockKind::Indented => None,
                    };
                }
                Tag::List(start_num) => {
                    list_stack.push(start_num);
                }
                Tag::Item => {
                    let indent = "  ".repeat(list_stack.len().saturating_sub(1));
                    let marker = match list_stack.last().copied().flatten() {
                        Some(_) => "+ ",
                        None => "- ",
                    };
                    out.push('\n');
                    out.push_str(&indent);
                    out.push_str(marker);
                }
                Tag::Strong => {
                    let buf = if in_cell { &mut current_cell } else { &mut out };
                    buf.push_str("#strong[");
                }
                Tag::Emphasis => {
                    let buf = if in_cell { &mut current_cell } else { &mut out };
                    buf.push_str("#emph[");
                }
                Tag::Strikethrough => {
                    let buf = if in_cell { &mut current_cell } else { &mut out };
                    buf.push_str("#strike[");
                }
                Tag::Link { dest_url, .. } => {
                    in_link = true;
                    link_url = dest_url.to_string();
                    link_text.clear();
                }
                Tag::Image { dest_url, .. } => {
                    in_image = true;
                    image_url = dest_url.to_string();
                    image_alt.clear();
                }
                Tag::Table(alignments) => {
                    in_table = true;
                    table_cols = alignments.len().max(1);
                    table_cells.clear();
                }
                Tag::TableHead | Tag::TableRow => {}
                Tag::TableCell => {
                    in_cell = true;
                    current_cell.clear();
                }
                _ => {}
            },
            Event::End(tag_end) => match tag_end {
                TagEnd::Heading(_) => out.push_str("\n\n"),
                TagEnd::Paragraph => {
                    if list_stack.is_empty() && !in_table {
                        out.push_str("\n\n");
                    }
                }
                TagEnd::BlockQuote(_) => out.push_str("];\n\n"),
                TagEnd::List(_) => {
                    list_stack.pop();
                    if list_stack.is_empty() {
                        out.push_str("\n\n");
                    }
                }
                TagEnd::Item => {}
                TagEnd::Strong | TagEnd::Emphasis | TagEnd::Strikethrough => {
                    let buf = if in_cell { &mut current_cell } else { &mut out };
                    buf.push_str("];");
                }
                TagEnd::TableCell => {
                    in_cell = false;
                    table_cells.push(std::mem::take(&mut current_cell));
                }
                TagEnd::Table => {
                    in_table = false;
                    if !table_cells.is_empty() {
                        let _ = write!(
                            out,
                            "\n#table(columns: {}, stroke: 0.5pt + rgb(\"#DEE2E6\"), inset: 6pt, ",
                            table_cols
                        );
                        for cell in &table_cells {
                            let _ = write!(out, "[{}], ", cell);
                        }
                        out.push_str(")\n\n");
                    }
                    table_cells.clear();
                }
                _ => {}
            },
            Event::Text(text) => {
                let escaped = escape_typst_text(&text);
                if in_cell {
                    current_cell.push_str(&escaped);
                } else {
                    out.push_str(&escaped);
                }
            }
            Event::Code(code) => {
                let raw = format!("#raw({});", typst_string_literal(&code));
                if in_cell {
                    current_cell.push_str(&raw);
                } else {
                    out.push_str(&raw);
                }
            }
            Event::InlineHtml(html) => {
                let rendered = handle_inline_html(&html);
                if in_cell {
                    current_cell.push_str(&rendered);
                } else {
                    out.push_str(&rendered);
                }
            }
            Event::SoftBreak => {
                if in_cell {
                    current_cell.push(' ');
                } else {
                    out.push(' ');
                }
            }
            Event::HardBreak => {
                if in_cell {
                    current_cell.push_str("\\\n");
                } else {
                    out.push_str("\\\n");
                }
            }
            Event::Rule => out.push_str("\n#line(length: 100%, stroke: 0.5pt + rgb(\"#DEE2E6\"))\n\n"),
            Event::TaskListMarker(checked) => {
                let marker = checkbox_typst(checked);
                if in_cell {
                    current_cell.push_str(marker);
                } else {
                    out.push_str(marker);
                }
            }
            _ => {}
        }
    }

    (out, assets)
}
