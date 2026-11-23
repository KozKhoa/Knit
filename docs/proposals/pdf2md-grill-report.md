---
title: Biên bản Hỏi đáp (/grill-me) & Báo cáo Thiết kế Tool PDF → Markdown (pdf2md)
status: Approved Design Baseline (Pre-Implementation)
date: 2026-11-23
crates: [knit-pdf, knit-docs, knit-core, knit-desktop]
related_adr: docs/decisions/ADR-006-pdf-to-markdown-and-optional-gemini-assistant.md
---

# Biên bản Hỏi đáp (`/grill-me`) & Báo cáo Thiết kế `PDF → Markdown` (`pdf2md`)

Tài liệu này ghi lại toàn bộ kết quả phỏng vấn thiết kế theo quy trình `/grill-me` và bản thiết kế kỹ thuật thống nhất trước khi tiến hành triển khai công cụ **`PDF → Markdown`** kết hợp trợ lý **Gemini API (tùy chọn)** trong **Knit**.

---

## 1. Tổng hợp Kết quả Hỏi đáp (`/grill-me`)

| # | Nhánh quyết định | Câu hỏi | Quyết định đã chốt |
|---|---|---|---|
| **Q1** | Vị trí UI & Chế độ làm việc | Đặt tool `PDF → Markdown` ở đâu trên giao diện? | **Thêm tool riêng trên Sidebar (`pdf2md`)**, tập trung **chế độ chỉnh sửa 1 file** (Single-file workbench, chưa làm batch nhiều file ở v1). |
| **Q2** | Engine lõi Offline | Chọn kiến trúc nào cho engine chính chạy offline? | **Thuần Rust 100%** (dùng `hayro` / `lopdf` đọc text/glyph theo tọa độ + `BookmarkNode` `/Outlines`), tự chạy ngay không cần cài phần mềm ngoài. |
| **Q3** | Vai trò của Gemini API | Khi bật Gemini API key, AI đảm nhận tác vụ hỗ trợ nào? | **Làm sạch & tái cấu trúc bản Markdown thô** (sửa ngắt dòng, thứ tự cột, phục hồi bảng/list/code/LaTeX từ text offline). Chưa làm OCR ảnh scan hay tự sinh metadata trong v1. |
| **Q4** | Cơ chế kích hoạt Gemini | Luồng gọi Gemini hoạt động khi nào? | **On-demand:** Mở PDF luôn chạy Rust offline ra Markdown trước ngay lập tức; người dùng chủ động bấm **"Làm sạch toàn bộ"** hoặc **"Làm sạch trang/đoạn đang chọn"** bằng Gemini trong editor. |
| **Q5** | Ảnh nhúng trong PDF | Xử lý hình ảnh nhúng bên trong PDF thế nào ở v1? | **Tùy chọn bật/tắt (Checkbox):** Cho phép trích ảnh nhúng ra thư mục `<tên_file>_assets/` cạnh file `.md` (kèm link tương đối) hoặc tắt để chỉ lấy thuần text. |
| **Q6** | Lưu trữ & Bảo mật Key | Lưu trữ và bảo mật Gemini API Key theo cơ chế nào? | **Quản lý ở tầng Rust trong `SettingsView`:** Ưu tiên OS Keychain (`keyring`) và fallback sang file config riêng trong thư mục OS config (quyền đọc/ghi chỉ user, `0600` trên Linux). Không lưu `localStorage`, không trả key trần về UI, không ghi key vào log. |
| **Q7** | Chunking, Chất lượng & Lỗi AI | Xử lý thế nào khi tài liệu dài hoặc gặp lỗi mạng, quota (`429`), hủy giữa chừng, AI cắt bớt chữ? | **Chia chunk 3–5 trang + Sanity check độ dài + Fallback an toàn:** Chunk nào lỗi hoặc nghi AI lược mất nhiều chữ thì giữ nguyên bản offline của chunk đó, cảnh báo rõ trong log/banner và giữ Undo/so sánh trong editor. |
| **Q8** | PDF Scan & PDF Lai | Phản ứng thế nào khi người dùng mở PDF scan hoặc PDF lai (có trang chỉ có ảnh)? | **Nhận diện sớm khi import/trích xuất:** Báo rõ *"Trang/PDF này là ảnh scan không có text layer"* trên `ErrorBanner`/cảnh báo (vì v1 chưa bật OCR), vẫn hiển thị PDF preview và trích xuất các trang có text (nếu là PDF lai). |

---

## 2. Kiến trúc & Ranh giới Tách lớp (Tuân thủ `RULES.md`)

### 2.1. Phân công theo từng lớp

1. **Lõi Pure Rust (`crates/knit-pdf` & `crates/knit-docs` — tuyệt đối không import `tauri`):**
   - **`crates/knit-pdf` (Trích xuất dữ liệu PDF thô có cấu trúc):**
     - Mở PDF chỉ đọc qua `mmap_pdf_readonly` / `load_cached_hayro_pdf` (`crates/knit-pdf/src/ops.rs`), tuyệt đối không đọc cả file vào RAM bằng `std::fs::read`.
     - Trích xuất từng trang: text span kèm tọa độ bounding-box (`x`, `y`, `width`, `height`), font metadata (`font_size`, bold/italic/monospace nếu suy luận được), đánh dấu trang rỗng text (`is_scanned_candidate`), kết hợp đọc cây mục lục `read_outlines` (`crates/knit-pdf/src/bookmarks.rs`).
     - Hỗ trợ trích xuất ảnh nhúng theo trang (khi người dùng bật tùy chọn trích ảnh), chuẩn hóa định dạng ảnh an toàn (`png`/`jpg`) và sanitize tên file theo quy chuẩn Windows/Linux.
   - **`crates/knit-docs` (Dựng Markdown offline + Chunking + Sanity check):**
     - Sắp xếp text block theo thứ tự đọc tự nhiên (hỗ trợ multi-column layout), nối dòng gãy/gạch nối, phát hiện header/footer lặp theo trang, suy luận Heading (`#`, `##`, `###` từ cỡ chữ & `BookmarkNode`), List, Code Block, Table cơ bản, chuẩn hóa **Unicode NFC** (`unicode-normalization`).
     - Gắn marker ranh giới trang nhẹ (ví dụ nội bộ hoặc cấu trúc `PageMarkdownChunk`) để hỗ trợ: (a) chọn đúng trang hiện tại trong editor để gửi Gemini, (b) chia chunk 3–5 trang, và (c) kiểm tra `CancellationToken` tại ranh giới từng trang.
     - Ghi file `.md` (và thư mục `<tên_file>_assets/`) qua `atomic_write_file` / file tạm `.tmp` của `knit-core`, kiểm tra `ensure_disk_space` trước khi xuất, dọn sạch tạm khi lỗi hoặc `Cancelled`.
2. **Tầng Gemini Client & Key Storage (tách riêng khỏi lõi offline):**
   - Đặt trong module riêng (ví dụ `crates/knit-docs/src/gemini.rs` hoặc adapter trong `src-tauri`, dùng trait/interface sạch để lõi offline không phụ thuộc mạng).
   - Dùng HTTP client dựa trên `rustls` (như `ureq` hoặc `reqwest` với `rustls-tls`) — tránh phụ thuộc OpenSSL hệ thống khi đóng gói `.AppImage` trên Linux.
   - Quản lý API Key qua OS Keychain (`keyring`) + fallback tệp config riêng trong thư mục cấu hình OS (`dirs`, quyền `0600` trên Linux). Frontend chỉ nhận trạng thái `has_api_key: bool` và chuỗi mask (ví dụ `AIza...xxxx`), **không bao giờ** nhận lại key trần.
3. **Tauri Shell (`src-tauri/src/lib.rs`):**
   - Chỉ nhận command, bọc `tauri::async_runtime::spawn_blocking`, đăng ký `CancellationToken` vào `AppState.jobs`, đẩy `JobProgress` (throttled) và `JobLog` (che sạch API key khỏi URL/header/error), gọi `trim_heap_if_supported()` sau tác vụ nặng.
4. **Frontend React (`src/`):**
   - Thêm `"pdf2md"` vào `ToolId` (`src/types/ipc.ts`), `NAV_META` (`src/components/WorkbenchShell.tsx`), và render `Pdf2MdView` trong `src/App.tsx`.
   - Thêm mục **AI Assistant (Optional)** trong `src/views/SettingsView.tsx`.
   - Bổ sung i18n đầy đủ ở `src/i18n/types.ts`, `src/i18n/vi.ts`, `src/i18n/en.ts`.

---

## 3. Luồng Dữ liệu & Trải nghiệm Người dùng (`Pdf2MdView`)

### 3.1. Luồng chính (Offline-First)
1. **Import PDF:** Người dùng kéo-thả hoặc chọn 1 file `.pdf` qua `Dropzone`.
2. **Inspect & Trích xuất Offline ngay:**
   - Rust đọc metadata, số trang, kiểm tra tỷ lệ trang có text vs trang scan.
   - Nếu có trang scan (0 text): hiển thị cảnh báo rõ trên `ErrorBanner` (*"Phát hiện X/Y trang là ảnh scan không có text layer — v1 chỉ trích xuất được phần có text"*), vẫn giữ preview PDF bình thường.
   - Bố cục **Split-View** (tương tự `DocsSplitWorkbench` trong `Docs2PdfView`):
     - **Trái:** `PdfJsPreview` xem PDF gốc (đồng bộ số trang đang xem).
     - **Phải:** `MarkdownCodeEditor` (`@codemirror/lang-markdown`) hiển thị ngay bản Markdown trích xuất offline, cho phép chỉnh sửa tự do, tìm kiếm (`DocumentFindBar`), Undo/Redo.
3. **Tùy chọn ảnh nhúng:** Checkbox *"Trích ảnh nhúng vào `<tên_file>_assets/`"*.
4. **Export (`.md`):** Dùng `ExportFilenameControl` + `ExportConflictModal` (chống ghi đè ngoài ý muốn), ghi nguyên tử `.md` và thư mục ảnh (nếu bật).

### 3.2. Luồng Trợ lý Gemini (On-Demand, Optional)
- Chỉ kích hoạt khi người dùng đã lưu Gemini API Key trong `SettingsView`; nếu chưa có key, nút AI hiển thị trạng thái gợi ý cấu hình (nhưng không làm phiền luồng offline).
- **2 hành động AI rõ ràng trên thanh công cụ Editor:**
  1. **"Làm sạch đoạn/trang đang chọn"**: Gửi đúng đoạn text được bôi đen (hoặc text của trang đang xem) kèm prompt khóa chặt nội dung.
  2. **"Làm sạch toàn bộ tài liệu"**:
     - Chia tài liệu thành các chunk **3–5 trang/batch** (kèm 2–3 dòng ngữ cảnh cuối batch trước để nối tiếp bảng/đoạn văn vắt trang).
     - Kiểm tra `CancellationToken` giữa mỗi batch; phát tiến trình `%` theo batch về thanh progress.
     - **Sanity check từng chunk:** Nếu HTTP lỗi (`401`/`403`/`429`/timeout), AI trả về rỗng, bị cắt `MAX_TOKENS`, hoặc độ dài ký tự đầu ra hụt bất thường so với đầu vào (dấu hiệu AI tóm tắt/lược bớt nội dung) → **giữ nguyên bản offline của chunk đó**, ghi cảnh báo rõ ràng trong `JobLog` và `ErrorBanner`.
     - Cập nhật vào `MarkdownCodeEditor` dưới dạng thao tác có thể **Undo** (hoặc nút *Khôi phục bản thô offline*) để người dùng luôn đối chiếu và không mất dữ liệu.

---

## 4. Các Rủi ro Kỹ thuật Cần Kiểm chứng ở Bước Spike Trước khi Code Full

1. **Khả năng trích xuất tọa độ glyph từ `hayro` vs `lopdf`:**
   - Cần chạy spike nhỏ trên 3–5 file PDF thực tế (tiếng Việt UTF-8 dấu tổ hợp/dựng sẵn, PDF 2 cột, PDF có bảng biểu và code block) để xác nhận `hayro` (hay `lopdf` + `ToUnicode` CMap) lấy tọa độ ký tự và dấu tiếng Việt chính xác đến mức nào, có cần bổ sung crate hỗ trợ CMap/text layout thuần Rust hay không.
2. **Chất lượng trích xuất ảnh nhúng:**
   - Kiểm tra xử lý màu/alpha/CCITT/JBIG2/DCTDecode trong PDF khi lưu thành PNG/JPEG vào `<tên_file>_assets/` để không lỗi màu hoặc tốn RAM với ảnh lớn.
3. **Cross-compile `keyring` + HTTP `rustls` trên Linux AppImage & Windows:**
   - Xác nhận không kéo thêm thư viện C/OpenSSL động ngoài ý muốn gây phình bộ cài (`<= 30 MB` theo `PRD.md`) hoặc lỗi chạy trên Linux không có Secret Service daemon.

---

## 5. Lộ trình Triển khai Đề xuất (Khi Bắt đầu Code)

1. **Pha 0 — Spike & ADR:** Kiểm chứng trích xuất text/tọa độ tiếng Việt trên `hayro`/`lopdf` và cập nhật [ADR-006](../decisions/ADR-006-pdf-to-markdown-and-optional-gemini-assistant.md) từ `Proposed` sang `Accepted`.
2. **Pha 1 — Lõi Pure Rust (`knit-pdf` + `knit-docs`):** Viết extractor tọa độ + Markdown formatter + image extractor + chunker/sanity check + bộ unit test (NFC tiếng Việt, multi-column, hủy job dọn `.tmp`, PDF scan, fallback chunk lỗi).
3. **Pha 2 — Tầng Gemini & Key Store:** Module `keyring` + fallback file `0600` + Gemini `generateContent` client (`rustls`) + test mock/unit cho sanity check & mask key.
4. **Pha 3 — Tauri IPC (`src-tauri`):** Commands inspect PDF, extract offline, extract images, refine toàn bộ / từng phần (có `CancellationToken`), settings lưu/kiểm tra Gemini key.
5. **Pha 4 — UI & i18n (`src/`):** `Pdf2MdView` (split-view `PdfJsPreview` + `MarkdownCodeEditor`), mục AI Assistant trong `SettingsView`, cập nhật `WorkbenchShell` + `App.tsx` + `vi.ts`/`en.ts`.
6. **Pha 5 — QA Gate:** Chạy đủ `cargo test --workspace`, `cargo check -p knit-desktop`, `pnpm build`, `pnpm test`, và đối chiếu `RULES.md` / `DESIGIN.md`.
