---
title: Knit docs2pdf Agent Integration & API Reference
description: Self-contained Tauri v2 IPC and pure-Rust knit-docs integration guide for converting Markdown, source code, HTML (including CDP slide-step decks), EPUB, and DOCX/PPTX files to PDF.
version: 0.2.0
crates: [knit-docs, knit-core, knit-desktop]
ipc_commands:
  - docs_engine_status
  - docs_read_text_file
  - docs_write_text_file
  - docs_preview_pdf_bytes
  - docs_preview_markdown
  - docs_convert_to_pdf
  - docs_convert_content_to_pdf
  - cancel_job
schema: docs/specs/docs2pdf.schema.json
architecture: docs/docs2pdf-architecture.md
deprecated: false
---

> Index: [`/llms.txt`](../llms.txt) · Machine-readable contract: [`docs/specs/docs2pdf.schema.json`](./specs/docs2pdf.schema.json) · Architecture & Mermaid diagrams: [`docs/docs2pdf-architecture.md`](./docs2pdf-architecture.md)

# Knit `docs2pdf` — Agent Integration & API Reference (`v0.2.0`)

Convert `md`, `markdown`, `txt`, `log`, `rst`, web source files (`css`, `js`, `mjs`, `cjs`, `ts`, `jsx`, `tsx`), `html`/`htm`/`xhtml` (including interactive slide decks via Chromium CDP), `epub`, `docx`, and `pptx` into PDF using either:
1. **Frontend Tauri IPC wrappers** in `src/lib/ipc.ts` (inside a Tauri v2 WebView where `__TAURI_INTERNALS__` exists), or
2. **Pure-Rust library calls** in `crates/knit-docs` (zero Tauri dependency).

---

## Quickstart: End-to-End Working Calls

### Path A: TypeScript / Tauri WebView (`@tauri-apps/api@^2.5.0`)

```ts
import {
  cancelActiveJob,
  convertDocContentToPdf,
  convertDocToPdf,
  getDocsEngineStatus,
  isJobCancelledError,
  isTauriRuntime,
  previewDocPdfBytes,
} from "../lib/ipc";
import type { DocConvertOptions, DocConvertResult } from "../types/ipc";

export async function compileMarkdownAndInspectOffice(
  markdownText: string,
  baseDir: string,
  outputPdfPath: string,
  optionalDocxPath?: string,
): Promise<DocConvertResult> {
  if (!isTauriRuntime()) {
    throw new Error("Tauri IPC is only available inside the Knit desktop window.");
  }

  const options: DocConvertOptions = {
    page_size: "a4",
    orientation: "portrait",
    margin_mm: 20,
    font_size_pt: 11,
    line_spacing: 1.4,
    title: "Architecture Summary",
    include_toc: true,
    toc_page: 1,
    page_numbering: {
      enabled: true,
      start_number: 1,
      start_from_page: 1,
      position: "bottom_center",
      format: "page_of_total",
    },
    theme: "github",
    font: "default",
    mermaid_svgs: {},
  };

  // 1. Live vector PDF bytes preview (preempts any prior pending preview)
  const previewBytes = await previewDocPdfBytes({
    content: markdownText,
    inputKind: "markdown",
    baseDir,
    options,
  });
  console.log(`Preview PDF size: ${previewBytes.byteLength} bytes`);

  // 2. Export edited buffer to PDF on disk
  const jobId = crypto.randomUUID();
  let result: DocConvertResult;
  try {
    result = await convertDocContentToPdf(
      jobId,
      markdownText,
      "markdown",
      baseDir,
      null,
      outputPdfPath,
      options,
      (ev) => {
        if (ev.kind === "progress") console.log(ev.data.phase, ev.data.done);
      },
    );
  } catch (err) {
    if (isJobCancelledError(String(err))) {
      await cancelActiveJob(jobId).catch(() => {});
    }
    throw err;
  }

  // 3. Optional Office conversion when LibreOffice is installed
  if (optionalDocxPath) {
    const engine = await getDocsEngineStatus();
    if (engine.libreoffice_available) {
      await convertDocToPdf(
        crypto.randomUUID(),
        optionalDocxPath,
        outputPdfPath.replace(/\.pdf$/i, "_office.pdf"),
        options,
      );
    }
  }
  return result;
}
```

### Path B: Pure-Rust Core Crate (`knit-docs = 0.2.0`, `knit-core = 0.1.0`)

```rust
use knit_core::{CancellationToken, NoopReporter};
use knit_docs::{
    convert_document_to_pdf, convert_text_to_pdf, detect_libreoffice, DocConvertOptions,
    DocConvertResult, DocInputKind, HtmlRenderMode, HtmlStepKind, HtmlStepTrigger,
};
use std::path::Path;

pub fn export_markdown_and_slides(
    markdown: &str,
    out_md_pdf: &Path,
    slides_html: &Path,
    out_slides_pdf: &Path,
) -> knit_core::Result<(DocConvertResult, DocConvertResult)> {
    let cancel = CancellationToken::new();
    let opts = DocConvertOptions::default();

    let md_res = convert_text_to_pdf(
        markdown,
        DocInputKind::Markdown,
        None,
        None,
        out_md_pdf,
        &opts,
        &cancel,
        &NoopReporter,
    )?;

    let mut slide_opts = DocConvertOptions::default();
    slide_opts.html_render_mode = HtmlRenderMode::SlideStep;
    slide_opts.html_step_trigger = HtmlStepTrigger {
        kind: HtmlStepKind::AutoKey,
        ..Default::default()
    };

    let lo = detect_libreoffice();
    println!("LibreOffice available: {}", lo.libreoffice_available);

    let slide_res = convert_document_to_pdf(
        slides_html,
        out_slides_pdf,
        &slide_opts,
        &cancel,
        &NoopReporter,
    )?;
    Ok((md_res, slide_res))
}
```

---

## Programmatic Equivalents for UI Actions

| UI Action in `Docs2PdfView` | Programmatic IPC Call (`src/lib/ipc.ts`) | Rust Backend Implementation |
|---|---|---|
| Check LibreOffice availability banner | `getDocsEngineStatus()` | `docs_engine_status` → `knit_docs::detect_libreoffice` |
| Load text/HTML/code file into Editor | `readDocTextFile(path)` | `docs_read_text_file` → `knit_docs::read_utf8_text` |
| Save edited buffer back to source file | `writeDocTextFile(path, content)` | `docs_write_text_file` → `knit_docs::write_utf8_text` |
| Render live `PdfJsPreview` bytes (all kinds) | `previewDocPdfBytes({ content, inputPath, inputKind, baseDir, options })` | `docs_preview_pdf_bytes` (1-permit semaphore + `docs_preview_cancel`) |
| Export directly from edited text buffer | `convertDocContentToPdf(jobId, content, kind, baseDir, inputPath, outPath, opts, onEvent)` | `docs_convert_content_to_pdf` → `knit_docs::convert_text_to_pdf` |
| Export EPUB / DOCX / PPTX / unmodified file | `convertDocToPdf(jobId, inputPath, outputPath, opts, onEvent)` | `docs_convert_to_pdf` → `knit_docs::convert_document_to_pdf` |
| Clear caches & free Typst/EPUB/Office RAM | `clearImagePreviewCache()` | `clear_image_preview_cache` → `evict_typst_cache` + `clear_epub_cache` + `clear_office_cache` |
| Cancel running conversion | `cancelActiveJob(jobId)` | `cancel_job` → `CancellationToken::cancel()` |

> **Deprecated API note:** `previewDocMarkdown` (`docs_preview_markdown` returning Base64 PNG strings capped at 20 pages) is superseded in the UI by `previewDocPdfBytes` (`docs_preview_pdf_bytes`) paired with client-side `pdfjs-dist` rendering (`PdfJsPreview`).
> **Source Code Files (`.css`, `.js`, `.mjs`, `.cjs`, `.ts`, `.jsx`, `.tsx`):** `DocInputKind::from_path` maps these to `"plain_text"`; the UI (`formatEditorContentForCompilation` in `src/views/Docs2PdfView.tsx`) wraps code buffers in safe backtick Markdown fences and compiles with `inputKind: "markdown"`.

---

## Configuration, Enums & Bounds Reference

### `DocConvertOptions`

| Field | Type / Values | Default | Behavior & Constraints |
|---|---|---|---|
| `page_size` | `"a4"` \| `"letter"` \| `"a5"` | `"a4"` | Mapped to Typst `"a4"`, `"us-letter"`, `"a5"` or CSS `@page`. |
| `orientation` | `"portrait"` \| `"landscape"` | `"portrait"` | Flips Typst page dimensions / `@page` orientation. |
| `margin_mm` | `number` | `20.0` | Clamped to `[5.0, 60.0]` mm in `typst_preamble` and `inject_browser_print_styles`. |
| `font_size_pt` | `number` | `11.0` | Clamped to `[7.0, 24.0]` pt in `typst_preamble`. |
| `line_spacing` | `number \| null` | `null` | When set, clamped to `[0.8, 3.0]`, mapped to Typst `leading` `[0.15, 2.4]em`. |
| `title` | `string \| null` | `null` | Prepends `= <title>` heading (EPUB falls back to archive metadata title if `null`). |
| `include_toc` | `boolean` | `false` | Inserts Typst `#outline(indent: auto)`. |
| `toc_page` | `integer` (`>= 1`) | `1` | `<= 1` places TOC at start; `> 1` triggers 2-pass `introspector.page(loc)` block insertion at target page. |
| `page_numbering` | `PageNumberingOptions` | `{ enabled: true, start_number: 1, start_from_page: 1, position: "bottom_center", format: "number_only" }` | `start_number` allows `>= 0` (0-based cover numbering); `start_from_page` clamped `.max(1)`. |
| `theme` | `"github"` \| `"academic"` \| `"minimal"` \| `"modern"` \| `"resume"` \| `"vs_code_light"` \| `"obsidian"` | `"github"` | Controls Typst colors, headings, quotes, and inline code highlight styles. |
| `font` | `"default"` \| `"afacad"` \| `"roboto"` \| `"lora"` \| `"libertinus_serif"` \| `"new_computer_modern"` \| `"dejavu_sans_mono"` | `"default"` | `"default"` selects font tuple per theme, always appending embedded Noto Emoji/Symbols fallbacks. |
| `mermaid_svgs` | `Record<string, string>` | `{}` | Map of Mermaid source diagram text → pre-rendered SVG markup injected into Typst virtual assets. |
| `html_render_mode` | `"auto"` \| `"document_print"` \| `"slide_step"` | `"auto"` | `"auto"` triggers CDP `slide_step` when `should_use_slide_step_auto` matches slide deck heuristics. |
| `html_step_trigger` | `HtmlStepTrigger` | `{ kind: "auto_key" }` | Configures slide progression: `auto_key` (`Space` fallback `ArrowRight`), `key` (`key` name), `click_selector` (`selector`), or `click_point` (`click_x`, `click_y` clamped `[0.0, 1.0]`). |
| `preview_max_chapters` | `integer \| null` | `null` | Optional chapter cap for fast EPUB preview truncation. |

---

## Exact Error String Mapping

| Exact Error Substring / Pattern | Source | Cause | Fix & Verification |
|---|---|---|---|
| `Path not found: <path>` | `crates/knit-docs/src/lib.rs` / `office.rs` | Input document missing on disk. | Check file existence before invoking `docs_convert_to_pdf`. |
| `Unsupported document format: <path>` | `crates/knit-docs/src/lib.rs` | Extension not recognized by `DocInputKind::from_path`. | Use supported extensions (`md`, `txt`, `css/js/ts/jsx/tsx`, `html`, `epub`, `docx`, `pptx`). |
| `Chi ho tro bien dich noi dung van ban cho Markdown, Plain Text hoac HTML` | `crates/knit-docs/src/lib.rs` | `compile_text_to_pdf_bytes` / `convert_text_to_pdf` called with `epub`, `docx`, or `pptx`. | Use `docs_convert_to_pdf` or pass `input_path` to `docs_preview_pdf_bytes` for binary formats. |
| `Loi bien dich Typst: <msgs>` | `crates/knit-docs/src/world.rs` | Typst compilation error (missing relative image, invalid markup). | Verify `base_dir` / relative image paths or inspect message details. |
| `Failed to open EPUB <path>: <err>` | `crates/knit-docs/src/html_epub.rs` | Corrupt or unreadable `.epub` ZIP container. | Validate `.epub` archive integrity. |
| `Missing EPUB path for preview` / `Missing Office path for preview` | `src-tauri/src/lib.rs` (`docs_preview_pdf_bytes`) | `inputPath` omitted when `inputKind` is `epub`, `docx`, or `pptx`. | Pass non-null `inputPath` in `previewDocPdfBytes`. |
| `LibreOffice (soffice) was not found on this system...` | `crates/knit-docs/src/office.rs` | `soffice` executable not found for `.docx`/`.pptx`. | Check `getDocsEngineStatus()` and prompt user to install LibreOffice. |
| `Qua thoi gian cho LibreOffice headless (120s)` / `LibreOffice khong tao duoc file PDF dau ra` | `crates/knit-docs/src/office.rs` | `soffice` exceeded `120s` timeout or exited without producing `.pdf`. | Test source file directly in LibreOffice; check permissions/locks. |
| `Chrome Page.printToPDF returned no PDF data` | `crates/knit-docs/src/cdp.rs` | Chromium CDP session failed to produce PDF payload. | Switch `html_render_mode` to `document_print` or inspect Chromium binary health. |
| `Job cancelled by user` | `crates/knit-core/src/error.rs` / `src-tauri/src/lib.rs` | Cancelled via `cancel_job` or preempted by newer `docs_preview_cancel`. | Ignore stale preview cancellation; display localized cancel state for exports. |
