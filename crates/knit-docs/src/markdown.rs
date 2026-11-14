use crate::models::{DocConvertOptions, DocFont, DocTheme};
use pulldown_cmark::{CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use std::fmt::Write as _;

fn typst_font_tuple(font: DocFont, theme: DocTheme) -> &'static str {
    match font {
        DocFont::Afacad => "(\"Afacad\", \"Roboto\", \"Libertinus Serif\")",
        DocFont::Roboto => "(\"Roboto\", \"Afacad\", \"Libertinus Serif\")",
        DocFont::Lora => "(\"Lora\", \"Libertinus Serif\", \"New Computer Modern\")",
        DocFont::LibertinusSerif => "(\"Libertinus Serif\", \"New Computer Modern\")",
        DocFont::NewComputerModern => "(\"New Computer Modern\", \"Libertinus Serif\")",
        DocFont::DejaVuSansMono => "(\"DejaVu Sans Mono\", \"Libertinus Serif\")",
        DocFont::Default => match theme {
            DocTheme::GitHub => "(\"Roboto\", \"Afacad\", \"Libertinus Serif\")",
            DocTheme::Modern => "(\"Afacad\", \"Roboto\", \"Libertinus Serif\")",
            DocTheme::Resume => "(\"Roboto\", \"Libertinus Serif\")",
            DocTheme::Academic | DocTheme::Minimal => "(\"Libertinus Serif\", \"New Computer Modern\")",
        },
    }
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
            let _ = writeln!(s, "#show raw.where(block: false): it => box(fill: rgb(\"#EFF1F3\"), inset: (x: 3pt, y: 1.5pt), radius: 3pt, it)");
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
            let _ = writeln!(s, "#show raw.where(block: false): it => box(fill: rgb(\"#EFF6FF\"), inset: (x: 3pt, y: 1.5pt), radius: 3pt, text(fill: rgb(\"#1E40AF\"), it))");
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
        "#set text(font: (\"DejaVu Sans Mono\", \"Libertinus Serif\"), size: {}pt)",
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

pub fn markdown_to_typst(md: &str, opts: &DocConvertOptions) -> String {
    let mut out = typst_preamble(opts);
    let mut cm_opts = Options::empty();
    cm_opts.insert(Options::ENABLE_TABLES);
    cm_opts.insert(Options::ENABLE_STRIKETHROUGH);
    cm_opts.insert(Options::ENABLE_TASKLISTS);

    let parser = Parser::new_ext(md, cm_opts);

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
                    let lang_arg = code_lang
                        .as_deref()
                        .filter(|l| !l.trim().is_empty())
                        .map(|l| format!(", lang: {}", typst_string_literal(l.trim())))
                        .unwrap_or_default();
                    let _ = writeln!(
                        out,
                        "\n#block(fill: rgb(\"#F8F9FA\"), stroke: 0.5pt + rgb(\"#DEE2E6\"), inset: 8pt, radius: 4pt, width: 100%)[#raw(block: true{lang_arg}, {})]\n",
                        typst_string_literal(code_buf.trim_end_matches('\n'))
                    );
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
                    let _ = write!(link_text, "#raw({})", typst_string_literal(&t));
                }
                Event::End(TagEnd::Link) => {
                    in_link = false;
                    let target = if link_url.starts_with("http://") || link_url.starts_with("https://") {
                        format!(
                            "#link({})[{}]",
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
                TagEnd::BlockQuote(_) => out.push_str("]\n\n"),
                TagEnd::List(_) => {
                    list_stack.pop();
                    if list_stack.is_empty() {
                        out.push_str("\n\n");
                    }
                }
                TagEnd::Item => {}
                TagEnd::Strong | TagEnd::Emphasis | TagEnd::Strikethrough => {
                    let buf = if in_cell { &mut current_cell } else { &mut out };
                    buf.push(']');
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
                let raw = format!("#raw({})", typst_string_literal(&code));
                if in_cell {
                    current_cell.push_str(&raw);
                } else {
                    out.push_str(&raw);
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
                out.push_str(if checked { "[x] " } else { "[ ] " });
            }
            _ => {}
        }
    }

    out
}
