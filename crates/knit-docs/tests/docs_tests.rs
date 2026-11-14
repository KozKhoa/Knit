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
    let sample_md = "# Tiêu đề Chính\n\n## Mục Con\n\nĐoạn văn mẫu tiếng Việt **in đậm**, *in nghiêng*, `inline code`.\n";

    let themes = [
        DocTheme::GitHub,
        DocTheme::Academic,
        DocTheme::Minimal,
        DocTheme::Modern,
        DocTheme::Resume,
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
