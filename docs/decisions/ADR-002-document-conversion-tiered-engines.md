# ADR-002: Kiến trúc Chuyển đổi Tài liệu Phân tầng (Native Lightweight + Optional Office Engine)

## Status
Accepted

## Date
2026-11-13

## Context
Người dùng yêu cầu chuyển đổi sang PDF cho các định dạng: `md`, `html`, `epub`, `docx`, `pptx`, đồng thời giữ bộ cài gốc **gọn nhẹ** (~15–50 MB) và chạy offline hoàn toàn.
Tuy nhiên, không có thư viện thuần Rust (hay thuần Python) nào render trung thực layout phức tạp của `docx`/`pptx` (bảng biểu lồng nhau, SmartArt, slide master, phân trang Word) sang PDF mà không dựa vào bộ render cỡ LibreOffice (~200–400 MB) hoặc Chromium (~150 MB).

## Decision
Áp dụng kiến trúc chuyển đổi **2 tầng (`ConversionEngine`)**:
1. **Tầng Core Native (luôn sẵn sàng trong bộ cài gọn nhẹ):**
   - **Markdown (`md`, `txt`) → PDF:** Parse bằng `pulldown-cmark` → dựng tài liệu **Typst** (nhúng `typst` crate trực tiếp trong Rust) để xuất PDF đẹp, nhẹ, hỗ trợ bảng, code block, mục lục, font tiếng Việt mà không cần Chromium hay LaTeX ngoài.
   - **HTML / EPUB → PDF:**
     - Lộ trình ưu tiên kiểm chứng ở Spike (Milestone 0): dùng `ebook`/`epub` + HTML parser chuyển sang Typst cho tài liệu chữ/sách (EPUB/bài viết) **hoặc** tận dụng cơ chế in PDF qua WebView/headless browser hệ thống (Edge/Chrome có sẵn trên máy) khi người dùng cần giữ nguyên CSS phức tạp. Quyết định chi tiết giữa 2 nhánh cho HTML phức tạp sẽ chốt sau Spike `M0-S3`.
2. **Tầng Optional External Engine (`docx`, `pptx` → PDF):**
   - Bộ cài chính **không nhúng** LibreOffice.
   - App cung cấp `EngineDetector` tự quét `soffice` (LibreOffice) theo đường dẫn chuẩn trên Windows (`Program Files\LibreOffice\program\soffice.exe`, Registry) và Linux (`PATH`, `/usr/bin/soffice`, Flatpak/Snap), đồng thời cho phép người dùng tự trỏ đường dẫn hoặc mở hướng dẫn/tải module bổ sung nếu máy chưa có.
   - Gọi `soffice --headless --convert-to pdf` trong thư mục profile tạm cô lập (`-env:UserInstallation=...`) để tránh xung đột nếu người dùng đang mở LibreOffice cùng lúc.

## Alternatives Considered

### Nhúng sẵn LibreOffice Portable hoặc Chromium vào file cài đặt
- **Pros:** Hỗ trợ `docx`/`pptx` ngay từ lần chạy đầu.
- **Cons:** Bộ cài phình lên 150–400 MB+, vi phạm trực tiếp quyết định Q1 & Q2 của người dùng về file cài đặt gọn nhẹ.
- **Rejected.**

### Tự viết bộ parse `docx`/`pptx` thuần Rust sang PDF
- **Pros:** Không phụ thuộc ngoài.
- **Cons:** Chất lượng layout tệ với file thực tế (vỡ bảng, mất slide layout, lệch font), tốn hàng tháng phát triển mà kết quả vẫn thua xa LibreOffice.
- **Rejected.**

## Consequences
- Bộ cài gốc giữ được kích thước nhỏ (~15–25 MB) và 100% offline cho `md`/`html`/`epub`/ảnh/PDF/ZIP.
- Trên giao diện **Document → PDF**, cần hiển thị rõ huy hiệu trạng thái engine (*"Built-in"* cho MD/HTML/EPUB vs *"Cần LibreOffice (Đã tìm thấy / Chưa cài)"* cho DOCX/PPTX) để người dùng không bị bất ngờ.
- Khi gọi `soffice` trên Windows phải ẩn cửa sổ console (`CREATE_NO_WINDOW`) và đặt timeout + `CancellationToken`.

## Update (v0.2.0 / Review v1.17–v1.18)
- **Core Native (`knit-docs` + Typst):**
  - Mở rộng nhận diện thêm các tệp mã nguồn web (`.css`, `.js`, `.mjs`, `.cjs`, `.ts`, `.jsx`, `.tsx`) ánh xạ sang `DocInputKind::PlainText` và được UI tự bọc thành fenced code block Markdown an toàn khi biên dịch qua Typst (`formatEditorContentForCompilation`).
  - Nâng cấp bộ chuyển đổi EPUB (`crates/knit-docs/src/html_epub.rs`): bổ sung `parse_epub_css` để giữ hình ảnh drop-cap `.gif` và định dạng chương CSS, đồng thời duy trì bộ nhớ đệm 1 mục `LAST_PARSED_EPUB` (theo `(path, file_len, mtime_nanos)`) và gọi `comemo::evict(2)` (`ComemoEvictGuard`) sau mỗi lần biên dịch Typst.
- **Tầng HTML Browser + CDP WebSocket (`crates/knit-docs/src/cdp.rs`, `office.rs`):**
  - Khi người dùng mở tệp HTML (`.html`/`.htm`/`.xhtml`), ngoài nhánh fallback `html_to_typst`, `compile_html_via_browser_to_pdf_bytes` tự động phát hiện trình duyệt nhân Chromium có sẵn trên hệ thống (`detect_chromium_browser`) để render trung thực CSS trình duyệt.
  - Hỗ trợ `HtmlRenderMode` (`auto`, `document_print`, `slide_step`) và `HtmlStepTrigger` (`auto_key`, `key`, `click_selector`, `click_point`): ở chế độ `slide_step`, `knit-docs` mở Chromium headless với `--remote-debugging-port=0`, giao tiếp trực tiếp qua WebSocket CDP thuần `std` (`LocalWebSocket`), chụp từng bước bằng `Page.printToPDF`, phát hiện trang lặp/trang cuối qua dấu vân tay `fnv1a_64` rồi ghép lại thành PDF vector bằng `lopdf`.
- **Tầng External Office (`crates/knit-docs/src/office.rs`):**
  - Bổ sung `compile_office_to_pdf_bytes` cùng cache 1 mục `LAST_CONVERTED_OFFICE` (khóa `(path, file_len, mtime_nanos)`) giúp xem trước PDF chỉ đọc cho `.docx`/`.pptx` ngay trong workbench mà không cần gọi lại `soffice` khi bấm Export.
