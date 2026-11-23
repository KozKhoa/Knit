# Knit — Mục lục Tài liệu Kỹ thuật (`docs/`)

Thư mục `docs/` được tổ chức theo vai trò để dễ tra cứu và tách biệt tài liệu đã triển khai với các đề xuất mới.

---

## 1. Cấu trúc Thư mục

| Đường dẫn | Nội dung |
|---|---|
| [`glossary.md`](./glossary.md) | Từ điển thuật ngữ miền nghiệp vụ (Ubiquitous Language) dùng chung toàn dự án. |
| [`decisions/`](./decisions/) | Các Architecture Decision Records (`ADR-001`..`ADR-006`). |
| [`tools/`](./tools/) | Bộ tài liệu chuyên sâu cho từng công cụ đã triển khai (`Architecture`, `Agent Guide`, `Functional Tests`). |
| [`specs/`](./specs/) | Hợp đồng dữ liệu & IPC chuẩn JSON Schema (`*.schema.json`). |
| [`diagrams/`](./diagrams/) | Mã nguồn sơ đồ kiến trúc, sequence, flowchart, class dạng Mermaid (`*.mmd`). |
| [`proposals/`](./proposals/) | Biên bản hỏi đáp (`/grill-me`), khảo sát và đề xuất thiết kế trước khi implement. |
| [`visual/`](./visual/) | Tài liệu trực quan HTML (Archify architecture explainer). |

---

## 2. Tài liệu theo Từng Công cụ (`tools/`)

| Công cụ | Architecture | Agent Guide | JSON Schema | Functional Tests |
|---|---|---|---|---|
| **Image → PDF** (`image2pdf`) | [Architecture](./tools/image2pdf/image2pdf-architecture.md) | [Agent Guide](./tools/image2pdf/image2pdf-agent-guide.md) | [Schema](./specs/image2pdf.schema.json) | [Tests](./tools/image2pdf/image2pdf-functional-tests.md) |
| **PDF Merge & Split** (`pdf-ops`) | [Architecture](./tools/pdf-ops/pdf-ops-architecture.md) | [Agent Guide](./tools/pdf-ops/pdf-ops-agent-guide.md) | [Schema](./specs/pdf-ops.schema.json) | [Tests](./tools/pdf-ops/pdf-ops-functional-tests.md) |
| **Document → PDF** (`docs2pdf`) | [Architecture](./tools/docs2pdf/docs2pdf-architecture.md) | [Agent Guide](./tools/docs2pdf/docs2pdf-agent-guide.md) | [Schema](./specs/docs2pdf.schema.json) | [Tests](./tools/docs2pdf/docs2pdf-functional-tests.md) |
| **Archive Packager** (`archive`) | [Architecture](./tools/archive/archive-architecture.md) | [Agent Guide](./tools/archive/archive-agent-guide.md) | [Schema](./specs/archive.schema.json) | [Tests](./tools/archive/archive-functional-tests.md) |
| **Manga Packager** (`manga-pack`) | [Architecture](./tools/manga-pack/manga-pack-architecture.md) | [Agent Guide](./tools/manga-pack/manga-pack-agent-guide.md) | [Schema](./specs/manga-pack.schema.json) | [Tests](./tools/manga-pack/manga-pack-functional-tests.md) |
| **Batch Renamer** (`renamer`) | [Architecture](./tools/renamer/renamer-architecture.md) | [Agent Guide](./tools/renamer/renamer-agent-guide.md) | [Schema](./specs/renamer.schema.json) | [Tests](./tools/renamer/renamer-functional-tests.md) |

---

## 3. Quyết định Kiến trúc (`decisions/`) & Đề xuất (`proposals/`)

- **ADRs:**
  - [ADR-001: Rust Workspace + Tauri v2 Desktop Stack](./decisions/ADR-001-rust-tauri-v2-desktop-stack.md)
  - [ADR-002: Document Conversion Tiered Engines](./decisions/ADR-002-document-conversion-tiered-engines.md)
  - [ADR-003: Non-destructive PageDraft & Canvas Pipeline](./decisions/ADR-003-non-destructive-page-draft-and-canvas-pipeline.md)
  - [ADR-004: Archive & Mangament Compatibility](./decisions/ADR-004-archive-and-mangament-compatibility.md)
  - [ADR-005: Batch Renamer Safety & Filter Model](./decisions/ADR-005-batch-renamer-safety-and-filter-model.md)
  - [ADR-006: PDF → Markdown & Optional Gemini Assistant *(Proposed)*](./decisions/ADR-006-pdf-to-markdown-and-optional-gemini-assistant.md)
- **Đề xuất & Biên bản `/grill-me`:**
  - [Biên bản Thiết kế `pdf2md` + Gemini Assistant](./proposals/pdf2md-grill-report.md)
- **Tài liệu trực quan:**
  - [Archify Architecture Design Docs (HTML)](./visual/ARCHITECTURE_DESIGN_DOCS.html)
