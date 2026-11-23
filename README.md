# Knit

Bộ công cụ desktop đa năng chạy **offline 100%** cho **Windows** và **Linux** (**Rust Workspace + Tauri v2 + React/TypeScript/Tailwind**), được thiết kế gọn nhẹ để thay thế các web tool bị giới hạn lượt dùng (iLovePDF, CloudConvert, MarkdownToPDF) và thay thế bộ công cụ `MangamentTools`.

## Tính năng chính (v1)
1. **Image → PDF & Canvas Editor (`knit-pdf`):** Hỗ trợ `jpg`, `jpeg`, `jfif`, `png`, `webp`, `avif`, `gif`, `bmp`, `tiff` (kể cả tách khung ảnh động kèm `/Dur`); sắp xếp/xoay trang, khổ giấy/lề, chia `max_mb`, trình chỉnh sửa cây **Bookmark**, **Lossless Passthrough** cho JPEG/PNG chưa sửa, và **Canvas Editor** không phá hủy (**crop cơ bản, chèn text UTF-8, vẽ tự do lên ảnh**).
2. **PDF Merge & Split (`knit-pdf`):** Ghép nhiều file PDF (chọn/sắp xếp/xoay từng trang, bảo toàn Bookmark) và tách PDF theo khoảng trang, mỗi N trang, chọn trang hoặc theo dung lượng, render thumbnail pure-Rust bằng `hayro`.
3. **Document → PDF (`knit-docs`):** Chuyển `md`, `txt`, `html`, `epub` native offline bằng `typst` (nhúng sẵn font UTF-8 hỗ trợ tiếng Việt); hỗ trợ `docx`, `pptx` qua *optional engine* (tự động dò `soffice`/LibreOffice với profile cô lập).
4. **Archive Packager (`knit-archive`):** Nén file/folder sang `.zip` (mật khẩu **AES-256 / ZipCrypto**), `.tar`, `.tar.gz`, `.tar.zst`.
5. **Manga Packager (`knit-manga`):** Quét cây Volume/Arc/Chapter, nhận diện ảnh bìa, chuẩn hóa NFC, đóng gói `.zip`/`.cbz` (`STORE`), chia part theo `max_gb`, có công tắc **MangamentPackageMode** xuất `stories.csv` + `info.json`.
6. **Batch Renamer (`knit-renamer`):** Đổi tên file/folder hàng loạt với bộ lọc hai lớp (Include/Exclude + Checkbox từng dòng trên Dry-Run Preview), Find/Replace, Perl Prename (`s///`, `y///`), 10 Fixed Presets, User Presets JSON, xử lý Bottom-Up & Undo.

## Phát triển & Kiểm thử Cục bộ
```bash
# Chạy toàn bộ test của 6 core crates
cargo test

# Kiểm tra TypeScript, build frontend & chạy Vitest
pnpm install
pnpm build
pnpm test

# Chạy / đóng gói ứng dụng Desktop Tauri
# (Trên Linux Fedora cần: sudo dnf install webkit2gtk4.1-devel gtk3-devel libsoup3-devel librsvg2-devel)
# (Trên Ubuntu cần: sudo apt-get install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf)
pnpm tauri dev
pnpm tauri build
```

## Hệ thống Tài liệu Dự án
- [PRD.md](PRD.md) — Yêu cầu sản phẩm và phạm vi v1
- [ARCHITECTURE.md](ARCHITECTURE.md) — Kiến trúc Rust Workspace + Tauri v2 và luồng dữ liệu
- [RULES.md](RULES.md) — Quy chuẩn an toàn file, tách lớp, UI và kiểm thử
- [TASK.md](TASK.md) — Lộ trình triển khai theo Milestone
- [PROGRESS.md](PROGRESS.md) — Tiến độ thực hiện
- [AGENT.md](AGENT.md) — Hướng dẫn cho coding agents
- [DESIGIN.md](DESIGIN.md) — Design tokens & Flat UI guidelines
- [docs/glossary.md](docs/glossary.md) — Từ điển thuật ngữ miền nghiệp vụ
- [docs/decisions/](docs/decisions/) — Architecture Decision Records (`ADR-001`..`ADR-005`)
- [llms.txt](llms.txt) — Mục lục tài liệu tối ưu cho coding agents (chuẩn `llmstxt.org`)

### Tài liệu Chuyên sâu theo Từng Tool (`Architecture` · `Agent Guide` · `JSON Schema` · `Functional Tests`)
1. **Image → PDF (`image2pdf`):** [Architecture](docs/image2pdf-architecture.md) · [Agent Guide](docs/image2pdf-agent-guide.md) · [Schema](docs/specs/image2pdf.schema.json) · [Functional Tests](docs/image2pdf-functional-tests.md)
2. **PDF Merge & Split (`pdf-ops`):** [Architecture](docs/pdf-ops-architecture.md) · [Agent Guide](docs/pdf-ops-agent-guide.md) · [Schema](docs/specs/pdf-ops.schema.json) · [Functional Tests](docs/pdf-ops-functional-tests.md)
3. **Document → PDF (`docs2pdf`):** [Architecture](docs/docs2pdf-architecture.md) · [Agent Guide](docs/docs2pdf-agent-guide.md) · [Schema](docs/specs/docs2pdf.schema.json) · [Functional Tests](docs/docs2pdf-functional-tests.md)
4. **Archive Packager (`archive`):** [Architecture](docs/archive-architecture.md) · [Agent Guide](docs/archive-agent-guide.md) · [Schema](docs/specs/archive.schema.json) · [Functional Tests](docs/archive-functional-tests.md)
5. **Manga Packager (`manga-pack`):** [Architecture](docs/manga-pack-architecture.md) · [Agent Guide](docs/manga-pack-agent-guide.md) · [Schema](docs/specs/manga-pack.schema.json) · [Functional Tests](docs/manga-pack-functional-tests.md)
6. **Batch Renamer (`renamer`):** [Architecture](docs/renamer-architecture.md) · [Agent Guide](docs/renamer-agent-guide.md) · [Schema](docs/specs/renamer.schema.json) · [Functional Tests](docs/renamer-functional-tests.md)
