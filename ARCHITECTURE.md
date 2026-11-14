# Knit — Kiến trúc Hệ thống (ARCHITECTURE)

> **Tham chiếu:** [PRD.md](PRD.md) | [docs/glossary.md](docs/glossary.md) | [docs/decisions/](docs/decisions/)

---

## 1. Tổng quan Kiến trúc (Rust Workspace + Tauri v2)

Knit tách biệt hoàn toàn **lõi xử lý miền nghiệp vụ (Pure Rust Crates)** khỏi **lớp giao diện Desktop (Tauri v2 + React/TypeScript)** để đảm bảo:
1. Toàn bộ logic chuyển đổi, đóng gói, parse `info.json`/`stories.csv`, đổi tên file được unit test độc lập qua `cargo test` mà không cần khởi chạy GUI.
2. Dễ bảo trì, ranh giới module rõ ràng, và sẵn sàng mở rộng thêm CLI ở v2 nếu cần.

```
┌────────────────────────────────────────────────────────────────────┐
│                  Frontend (WebView2 / WebKitGTK)                   │
│  React + TypeScript + Tailwind (tokens từ DESIGIN.md)              │
│  - Drag-Drop Grid & Bookmark Tree Editor                           │
│  - HTML5 Canvas Editor (Crop, Text, Freehand Draw -> Normalized)   │
│  - Renamer Preview Table (Checkbox per-item + Filter Builder)      │
│  - Job Progress, Terminal Log, History Drawer                      │
└───────────────────────────────┬────────────────────────────────────┘
                                │ Tauri IPC (Commands + Channel/Events)
┌───────────────────────────────▼────────────────────────────────────┐
│                   Desktop Adapter (src-tauri)                      │
│  - Window lifecycle, OS file dialogs, Drag-drop path resolution    │
│  - Thumbnail cache server / asset protocol                         │
│  - JobManager (Background Tokio/Rayon tasks + CancellationToken)   │
└───────────────────────────────┬────────────────────────────────────┘
                                │ Pure Rust API Calls
┌───────────────────────────────▼────────────────────────────────────┐
│                      Core Workspace (crates/)                      │
│  ├── knit-core     (Job types, Progress, Cancellation, FS/Atomic,  │
│  │                  NaturalSort, Unicode NFC, DiskCheck, Config)   │
│  ├── knit-pdf      (Image decode/encode, Lossless passthrough,     │
│  │                  PageDraft rasterizer, Merge/Split, Outlines)   │
│  ├── knit-docs     (MD/HTML/EPUB -> PDF via Typst/Native;          │
│  │                  External LibreOffice detector & runner)        │
│  ├── knit-archive  (ZIP w/ AES-256 & ZipCrypto, TAR/GZ/ZST)        │
│  ├── knit-manga    (Manga scanner, NodeRef parser, info.json,      │
│  │                  stories.csv builder, multi-part ZIP packer)    │
│  └── knit-renamer  (ScanFilter, PrenameEngine s/// y///, Presets,  │
│                     Collision detection, Bottom-Up apply & Undo)   │
└────────────────────────────────────────────────────────────────────┘
```

---

## 2. Cấu trúc Thư mục Dự kiến (Repository Layout)

```text
Knit/
├── Cargo.toml                  # Cargo workspace root
├── package.json                # Frontend dependencies & scripts
├── PRD.md
├── ARCHITECTURE.md
├── RULES.md
├── TASK.md
├── PROGRESS.md
├── AGENT.md
├── DESIGIN.md                  # Design tokens & flat aesthetic reference
├── docs/
│   ├── glossary.md             # Ubiquitous Language
│   └── decisions/              # Architecture Decision Records (ADR-001..005)
├── crates/
│   ├── knit-core/
│   ├── knit-pdf/
│   ├── knit-docs/
│   ├── knit-archive/
│   ├── knit-manga/
│   └── knit-renamer/
├── src-tauri/                  # Tauri v2 backend shell & IPC handlers
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
└── src/                        # React + TypeScript + Tailwind UI
    ├── styles/tokens.css       # Mapping từ DESIGIN.md
    ├── components/             # Shared UI (Sidebar, Dropzone, LogConsole, PreviewTree...)
    ├── features/
    │   ├── image2pdf/          # Grid, Bookmark Editor, Canvas Crop/Text/Draw Modal
    │   ├── pdf-ops/            # Merge & Split UI
    │   ├── doc2pdf/            # Doc converter + EngineStatus banner
    │   ├── archive/            # ZIP/TAR + password UI
    │   ├── manga-pack/         # Tree preview, warnings, Mangament toggle
    │   └── renamer/            # Include/Exclude filter bar, Dry-Run table, Presets, Undo
    └── lib/ipc.ts              # Typed wrappers cho Tauri invoke/events
```

---

## 3. Luồng Dữ liệu Chính & Hợp đồng Quan trọng

### 3.1. Luồng `JobManager` & Hủy Tác vụ
- Mọi thao tác dài hạn trả về `JobId` ngay lập tức; UI không bao giờ bị treo chờ kết quả đồng bộ.
- Tiến trình bắn qua Tauri `Channel` hoặc `Event` được throttle (~10 lần/giây) giống cơ chế của `zip_pack` trong `MangamentTools` để tránh nghẽn WebView khi xử lý hàng nghìn trang ảnh.
- Khi nhận tín hiệu từ `CancellationToken`, worker dừng tại ranh giới file/trang kế tiếp, xóa toàn bộ file `.tmp` / `.part` / output dở dang của phiên đó và báo trạng thái `Cancelled`.

### 3.2. Luồng `PageDraft` (Image → PDF & Canvas Editor)
1. Người dùng thả ảnh/thư mục vào UI → Rust quét (`NaturalSortKey`, tạo `BookmarkNode` gợi ý nếu từ thư mục), sinh thumbnail độ phân giải vừa phải lưu trong cache tạm của phiên.
2. UI chỉ hiển thị thumbnail; khi mở cửa sổ **Chỉnh sửa ảnh (Crop / Chữ / Vẽ)** cho 1 trang, Canvas nạp ảnh preview độ phân giải cao và lưu chỉnh sửa dưới dạng tham số **chuẩn hóa `[0.0, 1.0]`** trong `PageDraft` (`rotation`, `crop_rect`, `annotations`).
3. Khi bấm **Export PDF**:
   - Kiểm tra dung lượng trống đích (`free_bytes >= estimated_need`).
   - Chia nhóm trang nếu có `MaxBytes` (`split_indices`).
   - Song song trên `rayon` thread pool:
     - Trang không biến đổi & là JPEG/PNG hợp lệ → **Lossless Passthrough**.
     - Trang WebP/AVIF/GIF hoặc có xoay/crop/annotation → giải mã, chuẩn hóa EXIF/alpha (nền trắng), cắt/vẽ bằng Rust renderer (font UTF-8 nhúng sẵn cho text), encode JPEG/PNG tạm theo part.
   - Đóng gói PDF bằng `knit-pdf`, chạy `remap_tree` cho `BookmarkNode`, ghi `/Outlines` (và `/Dur` nếu tách khung GIF/WebP), rồi `AtomicOutput` rename sang file `.pdf` đích.

### 3.3. Luồng Chuyển đổi Tài liệu (`knit-docs`)
- **Markdown / TXT:** `pulldown-cmark` → sinh mã nguồn Typst kèm template mặc định sạch sẽ + font tiếng Việt → biên dịch bằng `typst` crate thành PDF hoàn toàn trong bộ nhớ/Rust.
- **HTML / EPUB:** Kiểm chứng phương án tối ưu ở **Milestone 0 Spike (`M0-S3`)**:
  - Ưu tiên 1: Pipeline thuần Rust (`epub`/HTML AST → Typst cho sách/tài liệu cấu trúc + phát hiện Chromium/Edge/WebView print cho HTML CSS phức tạp nếu cần).
- **DOCX / PPTX:** `EngineDetector` tìm `soffice`; chạy headless với profile tạm cô lập (`-env:UserInstallation=file://...`), ẩn terminal trên Windows (`CREATE_NO_WINDOW`), chuyển output qua tên tạm rồi move sang đích.

### 3.4. Luồng Manga Packager (`knit-manga`) & `Mangament` Compatibility
- Quét cấu trúc thư mục: chuẩn hóa Unicode **NFC**, parse tên folder `Volume / Arc / Chapter` (`naming.py` port), đọc `info.json` (`utf-8-sig`), xác định ảnh bìa (`cover_art`, `cover`, `poster`) với kiểm tra chống path traversal.
- Nhóm các `Story` nguyên vẹn theo `max_gb` (không cắt đôi 1 truyện).
- Nếu `MangamentPackageMode = true`: sinh `stories.csv` cho từng file ZIP part theo đúng thứ tự cột `BASE_HEADERS` + `NODE_HEADERS * max_depth` (căn phải) + `CONTENT_HEADERS`.
- Ảnh đóng gói bằng `zip::CompressionMethod::Stored`; `stories.csv` và `info.json` nén `Deflate`.

---

## 4. Áp dụng Thiết kế từ [DESIGIN.md](DESIGIN.md) cho Desktop App

[DESIGIN.md](DESIGIN.md) chứa bộ design tokens (Corporate Flat) định hướng phong cách giao diện của Knit:
- **Áp dụng trực tiếp:** Bảng màu (`#007BFF`, `#343A40`, `#FFFFFF`, `#F8F9FA`, `#28A745`, `#FFC107`, `#DC3545`, `#17A2B8`), font **Lato** (UI) + **JetBrains Mono** (đường dẫn, regex, log, kích thước), bo góc **4px**, đổ bóng siêu nhẹ (`<= 0 2px 8px rgba(0,0,0,0.08)`), phẳng không gradient trang trí, **không dùng emoji trong UI** (dùng bộ icon **Lucide**), đầy đủ Empty State / Error State / Skeleton.
- **Điều chỉnh cho Desktop App:** Bỏ qua các quy tắc landing-page marketing trong `DESIGIN.md` (như Hero split-screen, zig-zag feature rows). Thay bằng bố cục Desktop Workbench: **Sidebar điều hướng 6 tool + Top Action Bar + Vùng làm việc Dropzone/Preview/Canvas + Bottom Log/Status Drawer**.

---

## 5. Đóng gói & CI/CD Đa nền tảng (Windows & Linux)

- **Windows (`x86_64-pc-windows-msvc`):** Xuất bộ cài `.exe` (NSIS) và/hoặc portable `.exe` qua GitHub Actions (`windows-latest`), dựa vào WebView2 sẵn có trên Windows 10/11.
- **Linux (`x86_64-unknown-linux-gnu`):** Xuất `.AppImage` và `.deb` qua GitHub Actions (`ubuntu-22.04` hoặc `ubuntu-24.04` để đảm bảo tương thích glibc rộng), lưu ý đóng gói tương thích `webkit2gtk-4.1` và cấu hình liên kết tĩnh/tự chứa cho bộ giải mã AVIF (kiểm chứng ở Milestone 0).
