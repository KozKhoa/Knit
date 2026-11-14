# TASK.md — Kế hoạch Triển khai Theo Giai đoạn (Execution Plan)

> **Lưu ý:** Kế hoạch bắt đầu bằng **Milestone 0 (Technical Spikes)** nhằm kiểm chứng các rủi ro kỹ thuật đặc thù của Rust + Tauri v2 trên Windows & Linux trước khi xây dựng toàn bộ 6 module.

---

## Milestone 0: Technical Spikes (Kiểm chứng Rủi ro Cốt lõi)
*Mục tiêu: Trả lời bằng PoC chạy thật các câu hỏi kỹ thuật có nguy cơ làm lệch kiến trúc.*

- [x] **M0-S1 (AVIF & Image Decoding Cross-Compile):** Đã kiểm chứng `image 0.25` + `oxideav-avif 0.0.18` (pure-Rust, MIT, không phụ thuộc C/nasm).
- [x] **M0-S2 (PDF Engine Choice):** Đã kiểm chứng `lopdf 0.47` (nhúng JPEG `/DCTDecode`, `/Outlines` UTF-16BE, merge/split) + `hayro 0.9` (render thumbnail PDF pure-Rust).
- [x] **M0-S3 (Document → PDF Pipeline):** Đã kiểm chứng `typst 0.15` + `typst-pdf 0.15` + `typst-assets 0.15` + `pulldown-cmark 0.13` + `epub 2.1`.
- [x] **M0-S4 (Tauri v2 Minimal Bundle + AppImage):** Đã build release local trên Fedora 44 (`Knit-0.1.0-1.x86_64.rpm` = **20.67 MiB**, đạt mục tiêu `<= 30 MB` cho installer nén; ELF binary `target/release/knit-desktop` = `45,559,640 bytes`); cấu hình `release.yml` cho `.exe` (NSIS), `.AppImage`, `.deb`.

---

## Milestone 1: Nền tảng Workspace & Desktop Shell
*Mục tiêu: Dựng khung ứng dụng hoàn chỉnh, chưa có nghiệp vụ sâu nhưng có đầy đủ luồng job, log, theme và navigation.*

- [x] **M1-1:** Khởi tạo Cargo workspace (`crates/knit-core`, `crates/knit-pdf`, `crates/knit-docs`, `crates/knit-archive`, `crates/knit-manga`, `crates/knit-renamer`, `src-tauri`) và cấu hình `package.json` (React + TypeScript + Tailwind + Lucide icons).
- [x] **M1-2:** Hiện thực `knit-core`: `JobProgress`, `JobReporter`, `ThrottledReporter`, `CancellationToken`, `atomic_write_file`, `natural_cmp`, `sanitize_filename`, Unicode NFC, kiểm tra `ensure_disk_space`, config chuẩn OS.
- [x] **M1-3:** Hiện thực `src-tauri`: `AppState`, 21 IPC commands/channels (`ThrottledReporter` ~10Hz), `protocol-asset` & native file/folder/save dialogs (`capabilities/default.json`, app icons); đã biên dịch & link thành công trên Fedora 44 (`webkit2gtk4.1-devel gtk3-devel libsoup3-devel librsvg2-devel`).
- [x] **M1-4:** Xây dựng Desktop App Shell theo [DESIGIN.md](DESIGIN.md): Sidebar 6 module, Header progress/cancel, Dropzone dùng chung, Log Drawer, History List (mở thư mục), Empty/Error states.

---

## Milestone 2: Image → PDF & Trình chỉnh sửa Canvas (`knit-pdf`)
*Mục tiêu: Hoàn thiện module chủ lực với chỉnh sửa không phá hủy và xuất PDF tốc độ cao.*

- [x] **M2-1:** Quét ảnh lẻ/thư mục (`jpg`, `jpeg`, `jfif`, `png`, `webp`, `avif`, `gif`, `bmp`, `tiff`), nhận diện `cover`, sinh cây `BookmarkNode` gợi ý, thumbnail helper cho AVIF/TIFF/animated frames.
- [x] **M2-2:** Lõi xử lý ảnh & `PageDraft`: xoay, chuẩn hóa EXIF, xử lý nền trắng alpha, `AnimatedImagePolicy` (frame đầu hoặc tách frame kèm `/Dur`), nhánh **Lossless Passthrough** cho JPEG/PNG không sửa, giới hạn kích thước trang `[3.0, 14400.0]` pt, `FitA4`/`FitLetter` + margin.
- [x] **M2-3:** Rust rasterizer cho `CropRect` + `AnnotationLayer` (`TextAnnotation` dùng font UTF-8 nhúng từ `typst-assets` + `StrokeAnnotation`) theo hệ tọa độ chuẩn hóa `[0.0, 1.0]`.
- [x] **M2-4:** Chia part theo `max_mb` + `remap_tree` cho cây bookmark.
- [x] **M2-5:** Frontend UI: Lưới thumbnail sắp xếp/xoay/xóa trang, cây Bookmark editor (thêm/sửa/xóa/lồng cấp), Modal Canvas Editor (Crop + Chèn chữ + Vẽ tự do + Undo nét/chữ).
- [x] **M2-6:** Unit test & visual/coordinate parity test (`hayro` render verification trong `crates/knit-pdf/tests/pdf_tests.rs`).

---

## Milestone 3: PDF Merge & Split (`knit-pdf`)
*Mục tiêu: Ghép và tách PDF trực quan.*

- [x] **M3-1:** Backend đọc metadata/số trang/outline từ nhiều PDF đầu vào (`inspect_pdf`); render ảnh preview từng trang bằng `hayro` (`render_pdf_thumbnail`).
- [x] **M3-2:** Backend Merge PDF theo thứ tự `PageSelection` đã sắp xếp/xoay/chọn lọc + gộp/remapping `BookmarkNode` (`merge_pdfs`).
- [x] **M3-3:** Backend Split PDF theo 4 chế độ (`PageRanges`, `EveryNPages`, `ExtractSelected`, `MaxBytes`) (`split_pdf`).
- [x] **M3-4:** Frontend UI cho Merge & Split (`src/views/PdfOpsView.tsx`).

---

## Milestone 4: Document → PDF (`knit-docs`)
*Mục tiêu: Chuyển đổi tài liệu gọn nhẹ offline.*

- [x] **M4-1:** `md` / `txt` → PDF qua `pulldown-cmark` + `typst` crate (tiếng Việt, hình ảnh tham chiếu tương đối có `safe_join_within`, bảng GFM, khối code).
- [x] **M4-2:** `html` & `epub` → PDF qua bộ chuyển HTML/EPUB sang Typst (giữ cấu trúc chương EPUB & ảnh nhúng).
- [x] **M4-3:** `detect_libreoffice` & runner cho `docx` / `pptx` qua LibreOffice `soffice` (profile cô lập `tempfile::TempDir`, timeout + hủy).
- [x] **M4-4:** Frontend UI `src/views/Docs2PdfView.tsx` + banner trạng thái `EngineStatus`.

---

## Milestone 5: Archive & Manga Packager (`knit-archive` + `knit-manga`)
*Mục tiêu: Nén đa định dạng bảo mật và thay thế hoàn toàn `zip_pack`.*

- [x] **M5-1:** `knit-archive`: Nén file/folder ra `.zip` (mức nén, mật khẩu **AES-256** & **ZipCrypto**), `.tar`, `.tar.gz`, `.tar.zst`; chuẩn hóa POSIX `/` trong archive.
- [x] **M5-2:** `knit-manga`: Port `scanner` (`Auto`/`Single`/`Library`), `naming` (NFC + regex tiếng Việt/Anh/Nhật), đọc `info.json` (`utf-8-sig`), cảnh báo thiếu ảnh/trùng node/path traversal.
- [x] **M5-3:** `knit-manga`: `csv_builder` xuất `stories.csv` RFC 4180 + `pack_stories` (`STORE` cho ảnh, `Deflate` cho CSV/JSON, `max_gb` giữ nguyên truyện).
- [x] **M5-4:** Unit tests kiểm chứng `stories.csv`, BOM JSON, traversal guard, `STORE` compression và `group_by_size`.
- [x] **M5-5:** Frontend UI cho Archive (`src/views/ArchiveView.tsx`) và Manga Packager (`src/views/MangaPackView.tsx`).

---

## Milestone 6: Batch Renamer (`knit-renamer`)
*Mục tiêu: Đổi tên hàng loạt an toàn với bộ lọc hai lớp.*

- [x] **M6-1:** `ScanFilter` engine: quét `Files`/`Folders`/`Both`, `recursive`, `max_depth`, ẩn file dot, Include & Exclude theo đuôi file và glob/regex.
- [x] **M6-2:** `RenameRule` engine: Find & Replace, Perl Prename (`s///`, `y///`/`tr///`, nối lệnh `;`), 10 Fixed Presets + User Presets lưu JSON (`PresetStore`).
- [x] **M6-3:** `RenamePlan` safety: Collision detection (case-insensitive), xử lý đổi hoa-thường 2 bước, thực thi **Bottom-Up** (theo `depth` giảm dần), ghi & thực thi `UndoManifest`.
- [x] **M6-4:** Frontend UI (`src/views/RenamerView.tsx`): Thanh filter Include/Exclude, bảng Dry-Run Preview có **Checkbox từng dòng**, trình quản lý User Presets và nút Undo lần chạy gần nhất.

---

## Milestone 7: Đóng gói, Kiểm thử Chéo & Phát hành v1.0
*Mục tiêu: Đảm bảo người dùng phổ thông tải về chạy ngay trên Windows & Linux.*

- [x] **M7-1:** Thiết lập GitHub Actions CI (`.github/workflows/ci.yml`) chạy `cargo test`, frontend build/test và `cargo check -p knit-desktop` trên `windows-latest` & `ubuntu-latest`.
- [x] **M7-2:** Release workflow (`.github/workflows/release.yml`) đóng gói `.exe` (NSIS) cho Windows và `.AppImage` + `.deb` cho Linux.
- [ ] **M7-3:** Đã build & đóng gói thành công binary `target/release/knit-desktop` và gói `Knit-0.1.0-1.x86_64.rpm` trên Linux Fedora 44; còn lại chạy CI `.github/workflows/release.yml` để tạo `.exe` (NSIS) / `.AppImage` / `.deb` và kiểm thử thủ công trên máy sạch Windows & Linux.
