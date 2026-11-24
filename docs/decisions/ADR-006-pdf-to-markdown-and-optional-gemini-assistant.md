# ADR-006: Kiến trúc Chuyển đổi PDF → Markdown Thuần Rust Kèm Trợ lý Gemini Tùy chọn

## Status
Accepted (đã triển khai trong `crates/knit-pdf/src/extract.rs`, `crates/knit-docs/src/pdf_to_md.rs`, `crates/knit-docs/src/gemini.rs`, `src-tauri/src/lib.rs`, `src/views/Pdf2MdView.tsx`, `src/views/SettingsView.tsx`)

## Date
2026-11-23

## Context
Người dùng cần bổ sung công cụ **`PDF → Markdown` (`pdf2md`)** trong **Knit** với các yêu cầu từ phiên thiết kế `/grill-me`:
1. Đứng thành một công cụ riêng trên Sidebar, tối ưu cho quy trình **chỉnh sửa 1 file (Single-file workbench)** với xem trước PDF gốc song song trình soạn thảo Markdown.
2. Tuân thủ cam kết **100% tính năng lõi chạy offline**, bộ cài gọn nhẹ (`<= 30 MB`), không yêu cầu cài đặt Python/Poppler/OCR ngoài.
3. Cho phép dùng **Gemini API Key** như một **trợ lý tùy chọn (On-demand)** để dọn dẹp và tái cấu trúc văn bản Markdown thô (sửa ngắt dòng, thứ tự cột, bảng biểu, code block, LaTeX), thay vì gánh vai trò bộ chuyển đổi chính.
4. Cần bảo mật API Key an toàn trên Windows & Linux và đảm bảo an toàn nội dung (không mất chữ khi mạng lỗi, hết quota hoặc AI tóm tắt nhầm).

## Decision
1. **Lõi chuyển đổi chính (Offline Native — Pure Rust):**
   - Tầng đọc PDF nằm trong `crates/knit-pdf`, sử dụng `mmap` (`memmap2`) và `hayro` / `lopdf` để trích xuất text span kèm tọa độ bounding-box, kích thước font, cây `BookmarkNode` (`/Outlines`), phát hiện trang rỗng text (PDF scan), và trích xuất ảnh nhúng (khi bật tùy chọn xuất vào `<tên_file>_assets/`).
   - Tầng dựng Markdown nằm trong `crates/knit-docs`, xử lý sắp xếp thứ tự đọc (bao gồm bố cục nhiều cột), nối dòng, chuẩn hóa **Unicode NFC**, suy luận Heading/List/Code/Table, và ghi file theo chuẩn `AtomicOutput`.
   - Khi gặp PDF scan hoặc PDF lai có trang không chứa text layer, app nhận diện sớm và cảnh báo rõ trên `ErrorBanner` (v1 chưa thực hiện OCR ảnh scan).

2. **Trợ lý Gemini API (Optional On-Demand Text Refiner):**
   - Không chạy ngầm tự động khi mở file; người dùng luôn nhận kết quả Markdown offline trước và chủ động bấm **"Làm sạch đoạn/trang đang chọn"** hoặc **"Làm sạch toàn bộ"** trong editor.
   - Tài liệu dài được chia **chunk 3–5 trang/request**, kiểm tra `CancellationToken` giữa các batch.
   - Áp dụng **Sanity Check & Safe Fallback**: kiểm tra lỗi HTTP, cắt `MAX_TOKENS`, và sụt giảm độ dài bất thường; bất kỳ chunk nào lỗi hoặc nghi ngờ bị AI cắt bớt nội dung sẽ tự động giữ nguyên bản offline của chunk đó kèm cảnh báo, không làm hỏng phần còn lại và cho phép người dùng Undo trong editor.

3. **Lưu trữ & Bảo mật API Key:**
   - Key chỉ được lưu và sử dụng ở tầng Rust: ưu tiên OS Keychain (`secret-tool` trên Linux), có fallback sang file cấu hình riêng tư `ai_assistant.json` trong thư mục OS config với quyền truy cập chỉ dành cho user hiện tại (`0600` trên Unix).
   - Không lưu key trong `localStorage`, không trả key trần về frontend React, và che/khử key bằng `mask_api_key` / `redact_api_key` trước khi trả thông báo lỗi hay ghi log.
   - Yêu cầu HTTP tới Gemini API gọi trực tiếp từ tầng Rust thông qua `curl --config -` truyền `x-goog-api-key` và payload file tạm qua `stdin` (`CREATE_NO_WINDOW` trên Windows) để không làm lộ API key trên danh sách đối số tiến trình OS và giữ kích thước binary gọn nhẹ.

## Alternatives Considered

### Dùng Gemini (Multimodal PDF/Image) làm engine chuyển đổi chính
- **Pros:** Chất lượng bố cục cao cho cả PDF scan và bảng phức tạp.
- **Cons:** Phá vỡ cam kết offline-first trong `PRD.md`, tốn chi phí/token lớn, chậm với file hàng trăm trang, gửi toàn bộ tài liệu nhạy cảm ra ngoài mạng ngay cả khi không cần thiết.
- **Rejected.**

### Yêu cầu cài đặt công cụ ngoài (`pdftotext`, `marker`, `tesseract`) làm lõi chính
- **Pros:** Tận dụng được bộ parse C++/Python sẵn có.
- **Cons:** Tăng độ phức tạp cài đặt với người dùng phổ thông hoặc làm phình dung lượng gói phân phối.
- **Rejected cho v1** (có thể cân nhắc bổ sung thành tầng external OCR tùy chọn ở phiên bản sau nếu người dùng cần xử lý PDF scan).

## Consequences
- Tính năng `PDF → Markdown` hoạt động 100% offline ngay khi cài đặt app, không cần Internet hay API Key.
- Người dùng có nhu cầu xử lý PDF bố cục khó (nhiều cột, bảng rời rạc, công thức) có thể nhập Gemini Key trong `SettingsView` để nâng chất lượng bản Markdown theo từng phần hoặc toàn văn bản mà vẫn kiểm soát được chi phí và toàn vẹn nội dung.
- Cần thực hiện Technical Spike ở Pha 0 để xác nhận độ chính xác giải mã font/ToUnicode tiếng Việt và trích xuất tọa độ glyph từ `hayro`/`lopdf`.
