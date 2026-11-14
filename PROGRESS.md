# PROGRESS.md — Nhật ký Tiến độ Dự án Knit

## Tổng quan Trạng thái
- **Giai đoạn hiện tại:** Hoàn tất toàn bộ 6 core crates (`knit-core`, `knit-archive`, `knit-manga`, `knit-renamer`, `knit-pdf`, `knit-docs`), Frontend React/TypeScript/Tailwind Workbench, lớp vỏ `src-tauri` Desktop Shell và GitHub Actions CI/Release.
- **Cập nhật lần cuối:** 2026-11-14

| Milestone | Trạng thái | Ghi chú |
|---|---|---|
| Phase 0: Grill, Domain Model, ADRs & Plan | Done | Hoàn tất PRD, ARCHITECTURE, RULES, TASK, glossary & ADR-001..005. |
| Milestone 0: Technical Spikes | Done | Đã kiểm chứng `oxideav-avif`, `lopdf` + `hayro`, `typst 0.15` + `zip` AES-256; S4 đo thực tế trên Fedora 44 (`Knit-0.1.0-1.x86_64.rpm` = 20.67 MiB <= 30 MB; ELF `knit-desktop` = 45,559,640 bytes). |
| Milestone 1: Workspace & Desktop Shell | Done | 6 crates + `src-tauri` + React/TS/Tailwind Workbench Shell + icons + capabilities. |
| Milestone 2: Image → PDF & Canvas Editor | Done | `knit-pdf` + `Image2PdfView` + `ImageCanvasEditorModal` (Crop, Text, Freehand Draw) + `BookmarkTreeEditor`. |
| Milestone 3: PDF Merge & Split | Done | `merge_pdfs`, `split_pdf`, `hayro` thumbnail renderer, `PdfOpsView`. |
| Milestone 4: Document → PDF | Done | `knit-docs` (Typst native cho MD/TXT/HTML/EPUB + `soffice` headless detector/runner cho DOCX/PPTX) + `Docs2PdfView`. |
| Milestone 5: Archive & Manga Packager | Done | `knit-archive` + `knit-manga` + `ArchiveView` + `MangaPackView`. |
| Milestone 6: Batch Renamer | Done | `knit-renamer` + `RenamerView` (2-layer filter, Prename, Presets, Bottom-Up, Undo). |
| Milestone 7: Cross-Platform Packaging & Release | In Progress | Đã tạo `.github/workflows/ci.yml` & `release.yml`, đồng thời build & đóng gói thành công trên Linux Fedora 44 (`knit-desktop` + `.rpm`); còn lại chạy CI `.exe` (NSIS) / `.AppImage` / `.deb` và QA thủ công trên máy sạch. |

---

## Nhật ký Phiên làm việc
- **2026-11-14:**
  - Chạy kiểm chứng thành công toàn bộ 29 unit/integration tests trên 6 pure-Rust core crates (`cargo test`).
  - Sửa lỗi sắp xếp Bottom-Up trong `knit-renamer` (ưu tiên `depth` giảm dần trước khi xét file/dir) và chuẩn hóa placeholder không xung đột escape Typst trong `knit-docs`.
  - Hoàn thiện frontend React/TypeScript/Tailwind theo `DESIGIN.md` (`tsc --noEmit`, `vite build`, và Vitest đều pass).
  - Hoàn thiện `src-tauri` (21 IPC commands, `ThrottledReporter`, icons), CI/Release workflows, và sửa bug loop `roots` trong `renamer_preview`.
  - Sau khi cài `webkit2gtk4.1-devel gtk3-devel libsoup3-devel librsvg2-devel`, đã build thành công `target/release/knit-desktop` (`45,559,640 bytes`) và `target/release/bundle/rpm/Knit-0.1.0-1.x86_64.rpm` (`20.67 MiB`).
