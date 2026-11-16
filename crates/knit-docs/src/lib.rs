pub mod html_epub;
pub mod markdown;
pub mod models;
pub mod office;
pub mod world;

pub use html_epub::{compile_epub_to_pdf_bytes, convert_epub_to_pdf, html_to_typst};
pub use markdown::{markdown_to_typst, markdown_to_typst_with_assets, txt_to_typst};
pub use models::{
    DocConvertOptions, DocConvertResult, DocFont, DocInputKind, DocTheme, EngineStatus,
    PageNumberFormat, PageNumberPosition, PageNumberingOptions, PageOrientation, PageSizePreset,
};
pub use office::{convert_office_to_pdf, detect_libreoffice};
pub use world::{compile_typst_to_pdf, compile_typst_to_pdf_with_toc};

use knit_core::{
    atomic_write_file, ensure_disk_space, CancellationToken, JobProgress, JobReporter,
    JobReporterExt, KnitError, Result,
};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};

fn build_typst_markup_with_assets(
    content: &str,
    kind: DocInputKind,
    opts: &DocConvertOptions,
) -> Result<(String, HashMap<String, Vec<u8>>)> {
    match kind {
        DocInputKind::Markdown => Ok(markdown_to_typst_with_assets(content, opts)),
        DocInputKind::PlainText => Ok((txt_to_typst(content, opts), HashMap::new())),
        DocInputKind::Html => Ok((html_to_typst(content, opts), HashMap::new())),
        _ => Err(KnitError::InvalidInput(
            "Chi ho tro bien dich noi dung van ban cho Markdown, Plain Text hoac HTML".into(),
        )),
    }
}

/// Biên dịch nội dung văn bản (Markdown / PlainText / HTML) trong bộ nhớ ra bytes PDF + số trang.
pub fn compile_text_to_pdf_bytes(
    content: &str,
    kind: DocInputKind,
    base_dir: Option<&Path>,
    opts: &DocConvertOptions,
) -> Result<(Vec<u8>, usize)> {
    let (markup, assets) = build_typst_markup_with_assets(content, kind, opts)?;
    let effective_base = match kind {
        DocInputKind::Markdown | DocInputKind::Html => base_dir,
        _ => None,
    };
    let toc_target = if opts.include_toc && opts.toc_page > 1 {
        Some(opts.toc_page)
    } else {
        None
    };
    compile_typst_to_pdf_with_toc(&markup, effective_base, &assets, toc_target)
}

/// Chuyển nội dung văn bản trong bộ nhớ thành file PDF (dùng cho editor có chỉnh sửa trực tiếp).
pub fn convert_text_to_pdf(
    content: &str,
    kind: DocInputKind,
    base_dir: Option<&Path>,
    input_path: Option<&Path>,
    output_path: &Path,
    opts: &DocConvertOptions,
    cancel: &CancellationToken,
    reporter: &dyn JobReporter,
) -> Result<DocConvertResult> {
    if cancel.is_cancelled() {
        return Err(KnitError::Cancelled);
    }

    if let Some(parent) = output_path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
            ensure_disk_space(parent, 4 * 1024 * 1024)?;
        }
    }

    reporter.info(format!("Dang chuyen doi {:?} -> PDF (Typst)", kind));
    reporter.normal(format!(
        "Biên dịch tài liệu ({:?}, khổ {:?}, hướng {:?})",
        kind, opts.page_size, opts.orientation
    ));
    let (pdf_bytes, pages) = compile_text_to_pdf_bytes(content, kind, base_dir, opts)?;
    reporter.detailed(format!(
        "Đã biên dịch Typst xong: {} trang ({} bytes) -> {}",
        pages,
        pdf_bytes.len(),
        output_path.display()
    ));
    atomic_write_file(output_path, |f| Ok(f.write_all(&pdf_bytes)?))?;

    reporter.on_progress(JobProgress {
        phase: "done".into(),
        done: 1,
        total: 1,
        bytes_done: 0,
        bytes_total: 0,
        current_item: output_path.display().to_string(),
    });

    Ok(DocConvertResult {
        input_path: input_path.map(Path::to_path_buf).unwrap_or_else(PathBuf::new),
        output_path: output_path.to_path_buf(),
        kind,
        page_count: Some(pages),
        bytes_written: pdf_bytes.len() as u64,
        used_external_engine: false,
    })
}

pub fn convert_document_to_pdf(
    input_path: &Path,
    output_path: &Path,
    opts: &DocConvertOptions,
    cancel: &CancellationToken,
    reporter: &dyn JobReporter,
) -> Result<DocConvertResult> {
    if !input_path.is_file() {
        return Err(KnitError::NotFound(input_path.display().to_string()));
    }
    if cancel.is_cancelled() {
        return Err(KnitError::Cancelled);
    }

    let kind = DocInputKind::from_path(input_path).ok_or_else(|| {
        KnitError::InvalidInput(format!(
            "Dinh dang tai lieu khong duoc ho tro: {}",
            input_path.display()
        ))
    })?;

    if let Some(parent) = output_path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
            ensure_disk_space(parent, 4 * 1024 * 1024)?;
        }
    }

    let res = match kind {
        DocInputKind::Markdown | DocInputKind::PlainText | DocInputKind::Html => {
            let content = read_utf8_text(input_path)?;
            return convert_text_to_pdf(
                &content,
                kind,
                input_path.parent(),
                Some(input_path),
                output_path,
                opts,
                cancel,
                reporter,
            );
        }
        DocInputKind::Epub => convert_epub_to_pdf(input_path, output_path, opts, cancel, reporter),
        DocInputKind::Docx | DocInputKind::Pptx => {
            convert_office_to_pdf(input_path, output_path, cancel, reporter)
        }
    };

    if res.is_ok() {
        reporter.on_progress(JobProgress {
            phase: "done".into(),
            done: 1,
            total: 1,
            bytes_done: 0,
            bytes_total: 0,
            current_item: output_path.display().to_string(),
        });
    }
    res
}

pub fn read_utf8_text(path: &Path) -> Result<String> {
    if !path.is_file() {
        return Err(KnitError::NotFound(path.display().to_string()));
    }
    let raw = std::fs::read(path)?;
    let s = String::from_utf8(raw)
        .unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned());
    Ok(s.strip_prefix('\u{FEFF}').unwrap_or(&s).to_string())
}

pub fn write_utf8_text(path: &Path, content: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    atomic_write_file(path, |f| Ok(f.write_all(content.as_bytes())?))
}
