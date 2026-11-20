use knit_core::{CancellationToken, NoopReporter};
use knit_docs::{
    compile_text_to_pdf_bytes, convert_document_to_pdf, detect_libreoffice, html_to_typst,
    markdown_to_typst, DocConvertOptions, DocFont, DocInputKind, DocTheme,
};
use tempfile::tempdir;

#[test]
fn markdown_with_vietnamese_gfm_table_and_code_compiles_to_pdf() {
    let tmp = tempdir().unwrap();
    let md_path = tmp.path().join("guide.md");
    let out_pdf = tmp.path().join("guide.pdf");

    let md = r#"# Hướng dẫn Knit

Đây là tài liệu thử nghiệm **tiếng Việt có dấu** (ă â đ ê ô ơ ư), `inline_code`, và ký tự đặc biệt $100 = [test].

| Cột 1 | Cột 2 |
| --- | --- |
| Dữ liệu A | Giá trị 1 |
| Dữ liệu B | Giá trị 2 |

```rust
fn main() {
    println!("Hello #Knit $100");
}
```
"#;
    std::fs::write(&md_path, md).unwrap();

    let res = convert_document_to_pdf(
        &md_path,
        &out_pdf,
        &DocConvertOptions::default(),
        &CancellationToken::new(),
        &NoopReporter,
    )
    .unwrap();

    assert_eq!(res.kind, DocInputKind::Markdown);
    assert!(!res.used_external_engine);
    assert!(res.page_count.unwrap_or(0) >= 1);
    let pdf = std::fs::read(&out_pdf).unwrap();
    assert!(pdf.starts_with(b"%PDF-"));
}

#[test]
fn plain_text_and_html_convert_cleanly() {
    let tmp = tempdir().unwrap();
    let txt_path = tmp.path().join("notes.txt");
    let txt_pdf = tmp.path().join("notes.pdf");
    std::fs::write(&txt_path, "Dòng 1: Xin chào\nDòng 2: a < b & c > d\n").unwrap();

    let txt_res = convert_document_to_pdf(
        &txt_path,
        &txt_pdf,
        &DocConvertOptions::default(),
        &CancellationToken::new(),
        &NoopReporter,
    )
    .unwrap();
    assert_eq!(txt_res.kind, DocInputKind::PlainText);
    assert!(std::fs::read(&txt_pdf).unwrap().starts_with(b"%PDF-"));

    let html_path = tmp.path().join("page.html");
    let html_pdf = tmp.path().join("page.pdf");
    let html = "<html><head><script>alert(1)</script></head><body><h1>Tiêu đề HTML</h1><p>Đoạn <b>in đậm</b> &amp; <i>in nghiêng</i></p><pre>let x = 1;</pre></body></html>";
    std::fs::write(&html_path, html).unwrap();

    let html_res = convert_document_to_pdf(
        &html_path,
        &html_pdf,
        &DocConvertOptions::default(),
        &CancellationToken::new(),
        &NoopReporter,
    )
    .unwrap();
    assert_eq!(html_res.kind, DocInputKind::Html);
    assert!(std::fs::read(&html_pdf).unwrap().starts_with(b"%PDF-"));
}

#[test]
fn libreoffice_detector_runs_without_panicking() {
    let status = detect_libreoffice();
    assert!(!status.checked_paths.is_empty());
    // Helpers also generate valid non-empty Typst markup
    let typ = markdown_to_typst("# Hello", &DocConvertOptions::default());
    assert!(typ.contains("= Hello"));
    let html_typ = html_to_typst("<h2>Sub</h2><p>Body</p>", &DocConvertOptions::default());
    assert!(html_typ.contains("== Sub"));
}

#[test]
fn markdown_decodes_png_saved_with_jpg_extension_without_error() {
    let tmp = tempdir().unwrap();
    let img_dir = tmp.path().join("docs/screenshots");
    std::fs::create_dir_all(&img_dir).unwrap();

    // Generate genuine PNG bytes, but save with `.jpg` extension (the 89 50 4E 47 mismatch bug)
    let mut img = image::RgbaImage::new(40, 24);
    for px in img.pixels_mut() {
        *px = image::Rgba([0, 123, 255, 255]);
    }
    let fake_jpg = img_dir.join("mobile_shot.jpg");
    img.save_with_format(&fake_jpg, image::ImageFormat::Png).unwrap();
    assert!(std::fs::read(&fake_jpg).unwrap().starts_with(b"\x89PNG"));

    let md_path = tmp.path().join("report.md");
    let out_pdf = tmp.path().join("report.pdf");
    std::fs::write(
        &md_path,
        "# Test Report\n\n![Mobile screenshot](docs/screenshots/mobile_shot.jpg)\n",
    )
    .unwrap();

    let res = convert_document_to_pdf(
        &md_path,
        &out_pdf,
        &DocConvertOptions::default(),
        &CancellationToken::new(),
        &NoopReporter,
    )
    .unwrap();
    assert!(res.page_count.unwrap_or(0) >= 1);
    assert!(std::fs::read(&out_pdf).unwrap().starts_with(b"%PDF-"));
}

#[test]
fn all_themes_and_embedded_fonts_compile_cleanly() {
    let sample_md = "# Tiêu đề Chính\n\n## Mục Con\n\nĐoạn văn mẫu tiếng Việt **in đậm**, *in nghiêng*, `inline code`, [liên kết](https://example.com).\n\n> Trích dẫn kiểm thử theme.\n";

    let themes = [
        DocTheme::GitHub,
        DocTheme::Academic,
        DocTheme::Minimal,
        DocTheme::Modern,
        DocTheme::Resume,
        DocTheme::VsCodeLight,
        DocTheme::Obsidian,
    ];
    for theme in themes {
        let opts = DocConvertOptions {
            theme,
            ..DocConvertOptions::default()
        };
        let (bytes, pages) =
            compile_text_to_pdf_bytes(sample_md, DocInputKind::Markdown, None, &opts).unwrap();
        assert!(pages >= 1);
        assert!(bytes.starts_with(b"%PDF-"));
    }

    let fonts = [
        DocFont::Default,
        DocFont::Afacad,
        DocFont::Roboto,
        DocFont::Lora,
        DocFont::LibertinusSerif,
        DocFont::NewComputerModern,
        DocFont::DejaVuSansMono,
    ];
    for font in fonts {
        let opts = DocConvertOptions {
            font,
            ..DocConvertOptions::default()
        };
        let (bytes, pages) =
            compile_text_to_pdf_bytes(sample_md, DocInputKind::Markdown, None, &opts).unwrap();
        assert!(pages >= 1);
        assert!(bytes.starts_with(b"%PDF-"));
    }
}

#[test]
fn yaml_frontmatter_renders_as_nested_table_and_compiles_to_pdf() {
    let md = "\
---
name: requirements-analysis
description: Diagnose requirements problems and guide discovery of real needs and constraints
license: MIT
metadata:
  author: jwynia
  version: \"1.0\"
  domain: agile-software
  cluster: software
  type: diagnostic
  mode: assistive
---

# Requirements Analysis

Body content after frontmatter.
";
    let typst = markdown_to_typst(md, &DocConvertOptions::default());
    assert!(typst.contains("#table("));
    assert!(typst.contains("[#strong[name]]"));
    assert!(typst.contains("[#strong[metadata]]"));
    assert!(typst.contains("[#strong[author]], [jwynia]"));
    assert!(typst.contains("= Requirements Analysis"));

    let (pdf_bytes, pages) =
        compile_text_to_pdf_bytes(md, DocInputKind::Markdown, None, &DocConvertOptions::default())
            .unwrap();
    assert!(pages >= 1);
    assert!(pdf_bytes.starts_with(b"%PDF-"));
}

#[test]
fn hw03_placeholder_tags_and_emph_dot_zip_compile_cleanly() {
    let md = "- Filename format: <StudentID>_HW03_AI_GUIUsability_<SelfAssessedGrade>.zip\n\n**bold**.zip and `code`.zip and *emph*.png\n";
    let typst = markdown_to_typst(md, &DocConvertOptions::default());
    assert!(typst.contains("\\<StudentID\\>"));
    assert!(typst.contains("\\<SelfAssessedGrade\\>"));
    assert!(typst.contains("];.zip"));

    let (pdf_bytes, pages) =
        compile_text_to_pdf_bytes(md, DocInputKind::Markdown, None, &DocConvertOptions::default())
            .unwrap();
    assert!(pages >= 1);
    assert!(pdf_bytes.starts_with(b"%PDF-"));

    let hw03 = std::path::Path::new("/home/khoa/Downloads/2026.HW03.md");
    if hw03.is_file() {
        let content = knit_docs::read_utf8_text(hw03).unwrap();
        let (hw_bytes, hw_pages) = compile_text_to_pdf_bytes(
            &content,
            DocInputKind::Markdown,
            hw03.parent(),
            &DocConvertOptions::default(),
        )
        .unwrap();
        assert!(hw_pages >= 1);
        assert!(hw_bytes.starts_with(b"%PDF-"));
    }
}

#[test]
fn task_lists_emojis_inline_triple_backticks_and_mermaid_svg_compile_cleanly() {
    let md = "\
### **Definition of Done (DoD)**

* [ ] Dữ liệu sinh viên FIT HCMUS 📋
* [x] Bộ đếm SLA ✅ 🚀 🔥

Inline ```text some random text ``` section.

```mermaid
graph TD
A[Start] --> B[End]
```
";
    let mut mermaid_svgs = std::collections::HashMap::new();
    mermaid_svgs.insert(
        "graph TD\nA[Start] --> B[End]".to_string(),
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" viewBox="0 0 120 60"><rect width="120" height="60" fill="#eef2ff"/><text x="12" y="34" font-size="14">Start to End</text></svg>"##.to_string(),
    );
    let opts = DocConvertOptions {
        mermaid_svgs,
        ..DocConvertOptions::default()
    };
    let (typst, assets) = knit_docs::markdown_to_typst_with_assets(md, &opts);
    assert!(typst.contains("line(end: (0.18em, 0.18em)"));
    assert!(typst.contains("__knit_mermaid_0.svg"));
    assert_eq!(assets.len(), 1);

    let (pdf_bytes, pages) = compile_text_to_pdf_bytes(md, DocInputKind::Markdown, None, &opts).unwrap();
    assert!(pages >= 1);
    assert!(pdf_bytes.starts_with(b"%PDF-"));
}

#[test]
fn tall_mermaid_scales_to_fit_and_long_unbreakable_strings_wrap_in_tables() {
    let md = "\
## Diagram

```mermaid
flowchart TD
A[Top] --> B[Bottom]
```

| Key | Value |
| --- | --- |
| `cache_key` | `BuildStoryTree:storiesVer=${storiesVer}:storyNodeVer=${storyNodeVer}:storyId=${storyId}:isGettingContent=${isGettingContent}` |
| Plain | BuildStoryTree:storiesVer=10:storyNodeVer=7:storyId=1234567890abcdef:isGettingContent=true |
";
    let mut mermaid_svgs = std::collections::HashMap::new();
    // Extra-tall SVG (width=300, height=1200) that would overflow A4 height if only width is bounded
    mermaid_svgs.insert(
        "flowchart TD\nA[Top] --> B[Bottom]".to_string(),
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="300" height="1200" viewBox="0 0 300 1200"><rect width="300" height="1200" fill="#eef2ff"/><text x="20" y="1160" font-size="18">Bottom Label</text></svg>"##.to_string(),
    );
    let opts = DocConvertOptions {
        mermaid_svgs,
        ..DocConvertOptions::default()
    };
    let (typst, _) = knit_docs::markdown_to_typst_with_assets(md, &opts);
    assert!(typst.contains("fit: \"contain\""));
    assert!(typst.contains("(1fr, 1fr)"));
    assert!(typst.contains('\u{200B}'));

    let (pdf_bytes, pages) =
        compile_text_to_pdf_bytes(md, DocInputKind::Markdown, None, &opts).unwrap();
    assert!(pages >= 1);
    assert!(pdf_bytes.starts_with(b"%PDF-"));
}

#[test]
fn dejavu_sans_mono_font_deserializes_from_frontend_key_and_renders() {
    let parsed: DocFont = serde_json::from_str("\"dejavu_sans_mono\"").unwrap();
    assert_eq!(parsed, DocFont::DejaVuSansMono);
    let legacy_alias: DocFont = serde_json::from_str("\"deja_vu_sans_mono\"").unwrap();
    assert_eq!(legacy_alias, DocFont::DejaVuSansMono);

    let opts = DocConvertOptions {
        font: parsed,
        ..DocConvertOptions::default()
    };
    let (pdf_bytes, pages) =
        compile_text_to_pdf_bytes("# Test Mono\n\n`println!(\"ok\")`", DocInputKind::Markdown, None, &opts)
            .unwrap();
    assert!(pages >= 1);
    assert!(pdf_bytes.starts_with(b"%PDF-"));
}

#[test]
fn orientation_line_spacing_page_numbering_and_toc_at_page_n_work() {
    use knit_docs::{
        PageNumberFormat, PageNumberPosition, PageNumberingOptions, PageOrientation,
    };

    let mut md = String::from("# Trang Bìa Mở Đầu\n\nĐây là đoạn giới thiệu ngắn ở trang 1.\n\n");
    for idx in 1..=28 {
        md.push_str(&format!(
            "## Mục Số {idx}\n\nĐoạn nội dung mẫu thứ {idx} với đủ độ dài để dàn trải qua nhiều trang trong PDF kiểm thử bố cục và mục lục.\n\n"
        ));
    }

    let opts = DocConvertOptions {
        orientation: PageOrientation::Landscape,
        line_spacing: Some(1.75),
        include_toc: true,
        toc_page: 2,
        page_numbering: PageNumberingOptions {
            enabled: true,
            start_number: 1,
            start_from_page: 2,
            position: PageNumberPosition::TopRight,
            format: PageNumberFormat::PageOfTotal,
            label_prefix: Some("Trang".into()),
        },
        ..DocConvertOptions::default()
    };

    let typ = markdown_to_typst(&md, &opts);
    assert!(typ.contains("flipped: true"));
    assert!(typ.contains("#set par(leading:"));
    assert!(typ.contains("header: context"));
    assert!(typ.contains("if p >= 2"));

    let (pdf_bytes, pages) =
        compile_text_to_pdf_bytes(&md, DocInputKind::Markdown, None, &opts).unwrap();
    assert!(pages >= 3, "expected >= 3 pages, got {pages}");
    assert!(pdf_bytes.starts_with(b"%PDF-"));
}

#[test]
fn page_numbering_can_start_at_zero() {
    let mut md = String::from("# Intro\n\nFirst page\n\n");
    for idx in 1..=28 {
        md.push_str(&format!(
            "## Section {idx}\n\nSample paragraph {idx} with enough body text to span multiple pages so zero-based numbering is exercised.\n\n"
        ));
    }
    let opts = DocConvertOptions {
        page_numbering: knit_docs::PageNumberingOptions {
            enabled: true,
            start_number: 0,
            start_from_page: 1,
            position: knit_docs::PageNumberPosition::BottomCenter,
            format: knit_docs::PageNumberFormat::PageOfTotal,
            label_prefix: None,
        },
        ..DocConvertOptions::default()
    };

    let typ = markdown_to_typst(&md, &opts);
    assert!(typ.contains("+ 0"));
    let (pdf_bytes, pages) =
        compile_text_to_pdf_bytes(&md, DocInputKind::Markdown, None, &opts).unwrap();
    assert!(pages >= 2, "expected >= 2 pages, got {pages}");
    assert!(pdf_bytes.starts_with(b"%PDF-"));
}

#[test]
fn repeated_page_numbering_updates_evict_cache_and_honor_cancellation() {
    let mut md = String::from("# Memory Hygiene Test\n\n");
    for idx in 1..=20 {
        md.push_str(&format!("## Chapter {idx}\n\nParagraph content for chapter {idx}.\n\n"));
    }

    for start_num in 0..5 {
        let opts = DocConvertOptions {
            page_numbering: knit_docs::PageNumberingOptions {
                enabled: true,
                start_number: start_num,
                start_from_page: 1,
                position: knit_docs::PageNumberPosition::BottomRight,
                format: knit_docs::PageNumberFormat::PageOfTotal,
                label_prefix: None,
            },
            ..DocConvertOptions::default()
        };
        let (bytes, pages) = knit_docs::compile_text_to_pdf_bytes_with_cancel(
            &md,
            DocInputKind::Markdown,
            None,
            &opts,
            None,
        )
        .unwrap();
        assert!(pages >= 1);
        assert!(bytes.starts_with(b"%PDF-"));
    }

    knit_docs::evict_typst_cache();
    knit_docs::clear_epub_cache();

    let tok = CancellationToken::new();
    tok.cancel();
    let cancelled_res = knit_docs::compile_text_to_pdf_bytes_with_cancel(
        &md,
        DocInputKind::Markdown,
        None,
        &DocConvertOptions::default(),
        Some(&tok),
    );
    assert!(matches!(cancelled_res, Err(knit_core::KnitError::Cancelled)));
}
