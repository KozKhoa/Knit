# Báo cáo phản hồi & thay đổi — Review Version 1.17

Tài liệu này tổng hợp các thay đổi đã áp dụng cho toàn bộ 6 đầu mục trong `user-review/version-1-17.md`, giải thích nguyên nhân kỹ thuật đằng sau mỗi thay đổi, lý do lựa chọn phương án kiến trúc và kết quả kiểm thử sau lần chỉnh sửa cuối cùng.

---

## 1. PDF Merge — Hiển thị đường dẫn trên cùng một dòng khi trùng tên tệp & chỉ gắn Info badge khi trùng chính xác cùng một tệp

- **Vấn đề trước đó:** Khi nạp hai file PDF cùng tên ở hai thư mục khác nhau vào `PDF Merge`, danh sách file đã nạp (`LoadedPdfList`) tô nền/viền vàng cảnh báo, gắn badge `AlertTriangle` (`Trùng tên` / `Duplicate name`) và đẩy đường dẫn file xuống dòng thứ hai (`mt-0.5`), khiến chiều cao các dòng không đều nhau.
- **Nguyên nhân kỹ thuật:** `src/views/pdf-ops/LoadedPdfList.tsx` gom nhóm theo `baseName.toLowerCase()` để gắn cùng lúc trạng thái cảnh báo, badge và dòng đường dẫn phụ phía dưới.
- **Thay đổi đã áp dụng:**
  - Cập nhật `src/views/pdf-ops/LoadedPdfList.tsx` để phân biệt rạch ròi 2 trạng thái:
    - `sameNameSet` (cùng tên file theo `baseName.toLowerCase()`): hiển thị đường dẫn `f.path` nằm gọn trên **cùng một hàng ngang** ngay bên cạnh tên file (`truncate`, không xuống dòng làm lệch chiều cao hàng) và bỏ toàn bộ viền/nền vàng warning.
    - `exactDuplicatePaths` (cùng đường dẫn chuẩn hóa qua `normalizeComparePath(f.path)`): chỉ khi nạp trùng chính xác cùng một file mới hiển thị badge **Info** màu xanh dương phẳng (`<Info />` + `Trùng tệp` / `Duplicate file`).
  - Bổ sung khóa dịch song ngữ `pdfOps.duplicateFileBadge` trong `src/i18n/{types,vi,en}.ts`.
  - Cập nhật unit test trong `src/components/Review113Components.test.tsx`.
- **Lý do chọn cách làm này:** Hai file khác thư mục có cùng tên hoàn toàn hợp lệ (người dùng chỉ cần nhìn nhanh đường dẫn trên cùng dòng để phân biệt), còn nạp nhầm đúng 1 file 2 lần là thông tin hữu ích dạng Info chứ không phải lỗi nghiêm trọng; bố cục 1 dòng duy nhất giữ chiều cao mọi hàng đồng nhất hoàn toàn.

---

## 2. Image2PDF — Bỏ checkbox `Auto-update bookmarks when deleting pages` bị trùng ở cột mục lục

- **Vấn đề trước đó:** Khi mở panel cây mục lục (`showBookmarks`) trong công cụ `Images to PDF`, checkbox `Tự động cập nhật mục lục khi xóa ảnh` (`Auto-update bookmarks when deleting pages`) bị lặp lại ở 2 nơi: trên thanh công cụ ngang và ở phía trên khung `BookmarkTreeEditor` bên phải.
- **Nguyên nhân kỹ thuật:** `src/views/Image2PdfView.tsx` render cùng state `autoUpdateBookmarksOnDelete` ở hai vị trí (trên thanh toolbar cạnh nút Đóng/Mở mục lục và thêm một card `<label>` phía trên `BookmarkTreeEditor`).
- **Thay đổi đã áp dụng:** Xóa thẻ `<label>` chứa checkbox trùng ở cột bên phải phía trên `BookmarkTreeEditor` trong `src/views/Image2PdfView.tsx`, giữ lại duy nhất checkbox trên thanh công cụ ngang cạnh nút Đóng/Mở mục lục theo xác nhận của người dùng; đồng thời bổ sung assertion kiểm tra trong `src/views/Image2PdfView.test.tsx`.
- **Lý do chọn cách làm này:** Giữ checkbox ở thanh công cụ ngang giúp thao tác tập trung tại một chỗ, dễ nhìn và giải phóng không gian dọc cho cây mục lục.

---

## 3. Docs to PDF — Hỗ trợ xem trước (Preview PDF) chỉ đọc khi nạp tệp DOCX / PPTX

- **Vấn đề trước đó:** Khi nạp tệp `.docx` hoặc `.pptx` trong `Docs to PDF`, khung Preview PDF bị ẩn hoàn toàn và giao diện chỉ hiển thị thông báo không hỗ trợ chỉnh sửa/xem trước; đồng thời các tùy chọn định dạng riêng của Typst (Theme, Font, Lề...) vẫn bật dễ gây hiểu nhầm.
- **Nguyên nhân kỹ thuật:**
  - `src/views/Docs2PdfView.tsx` chỉ đặt `isPreviewableDoc = true` cho `markdown`, `plain_text`, `html` và `epub`.
  - Command `docs_preview_pdf_bytes` trong `src-tauri/src/lib.rs` chưa xử lý `DocInputKind::Docx | DocInputKind::Pptx`.
  - `crates/knit-docs/src/office.rs` chưa tách hàm trả `Vec<u8>` kèm cache cho file Office vừa kết xuất.
- **Thay đổi đã áp dụng:**
  - **Backend Rust (`crates/knit-docs/src/office.rs`, `src/lib.rs`, `src-tauri/src/lib.rs`):**
    - Tách hàm `compile_office_to_pdf_bytes` kèm bộ nhớ đệm 1 mục (`LAST_CONVERTED_OFFICE`, khóa theo `(path, file_len, mtime_nanos)`) và `clear_office_cache()` (được gọi trong `clear_image_preview_cache`).
    - Mở rộng `docs_preview_pdf_bytes` hỗ trợ `DocInputKind::Docx | DocInputKind::Pptx`.
  - **Frontend (`src/views/Docs2PdfView.tsx`, `src/views/docs2pdf/Docs2PdfSettingsCard.tsx`):**
    - Bật `isPreviewableDoc` cho `(isOfficeFile && Boolean(inputPath))` trong khi giữ `isEditableText = false` (ẩn hoàn toàn khung Editor, chỉ hiện khung Preview PDF).
    - Bổ sung prop `disabled={isOfficeFile}` vào `<Docs2PdfSettingsCard />` để tự động vô hiệu hóa (`<fieldset disabled>`) các tùy chọn định dạng riêng của Typst khi đang mở tệp Office.
  - Bổ sung unit test trong `src/components/Review117Components.test.tsx`.
- **Lý do chọn cách làm này:** Dùng chung cơ chế cache `(path, file_len, mtime_nanos)` giúp xem trước rồi bấm Export không phải gọi lại `soffice --headless` lần thứ hai, còn disable bảng cài đặt Typst ngăn người dùng nhầm lẫn vì LibreOffice giữ nguyên layout gốc của file Office.

---

## 4. Docs to PDF — Sửa hiển thị ảnh `.gif` drop-cap và định dạng CSS trong tệp EPUB

- **Vấn đề trước đó:** Khi chuyển đổi hoặc xem trước một số EPUB tiếng Việt (như *Đồi Gió Hú - Emily Bronte.epub*) có chữ hoa trang trí đầu chương dạng `.gif` và CSS trình bày chương, kết quả mất ảnh drop-cap `.gif`, rớt ký tự đầu ra dòng riêng và mất cấu trúc định dạng chương.
- **Nguyên nhân kỹ thuật:**
  - Sau khi kiểm tra cấu trúc nội bộ của `Đồi Gió Hú - Emily Bronte.epub`, chữ hoa đầu chương không dùng thẻ `<img src="...">` mà dùng CSS class trong `OEBPS/css/motsach.css` (ví dụ `#dropcap { float: left; ... }`, `.dropcap_T { background-image: url(../images/T.gif); }`, `span.hidden { color: white; }`) kết hợp HTML `<div class='ms_text'><div id ='dropcap' class='dropcap_T'><span class='hidden'>T</span></div>ôi vừa trở về nhà...</div>`.
  - `crates/knit-docs/src/html_epub.rs` trước đây bỏ qua hoàn toàn các file `.css` trong EPUB, xóa `<div id='dropcap'>`, giữ nguyên text bên trong `<span class='hidden'>`, rồi chèn ngắt đoạn `\n\n` sau `</div>`, khiến chữ hoa bị tách xuống dòng và mất ảnh `.gif`. Đồng thời các thẻ `<img>` thông thường đều bị ép `width: 85%` khiến icon/ảnh nhỏ bị phóng to biến dạng.
- **Thay đổi đã áp dụng:**
  - Cập nhật `crates/knit-docs/src/html_epub.rs`:
    - Quét và phân tích các tài nguyên `text/css` trong EPUB qua `parse_epub_css` để lập bản đồ `bg_images_by_class` / `bg_images_by_id` (giải quyết đường dẫn ảnh tương đối như `url(../images/T.gif)` thành `OEBPS/images/T.gif`).
    - Triển khai `html_fragment_to_typst_with_css`: nhận diện khối drop-cap (`#dropcap` hoặc `.dropcap_*`), loại bỏ `<span class="hidden">...</span>` tránh lặp chữ cái đầu, và dựng bố cục Typst `#grid(columns: (52pt, 1fr), ... image(..., width: 52pt), [...])` để đặt ảnh `.gif` drop-cap gọn bên trái đoạn văn mở đầu chương.
    - Chuyển các lớp chương/tiêu đề/tác giả/ngắt đoạn phổ biến (`.ms_chapter`, `.epub_ms_title`, `.epub_ms_author`, `.ms_quote`, `.story_poem`, `.ms_break`) sang heading, căn giữa và in nghiêng chuẩn Typst.
    - Cải tiến kích thước `<img>` thường bằng `calc.min(nat.width, size.width * 0.85)` để ảnh nhỏ giữ kích thước thật, ảnh lớn co vừa khung trang.
  - Bổ sung integration test `epub_css_dropcap_gif_and_chapter_classes_render_into_pdf` trong `crates/knit-docs/tests/docs_tests.rs`.
- **Lý do chọn cách làm này:** Phân tích CSS từ chính gói EPUB kết hợp bố cục `#grid` của Typst cho phép tái hiện sát giao diện E-book Viewer mà vẫn giữ hiệu năng biên dịch ngoại tuyến 100% của Typst.

---

## 5. Docs to PDF — Kết xuất HTML chuẩn giao diện/CSS trình duyệt & sửa triệt để lỗi Typst `unclosed delimiter`

- **Vấn đề trước đó:**
  1. Khi nạp tệp HTML (như slide thuyết trình `slides/index.html` có CSS variables, flexbox, màu nền, `@media print`), kết quả PDF bị mất toàn bộ giao diện/màu sắc CSS so với khi mở trên trình duyệt.
  2. File HTML trên còn báo lỗi `Invalid input: Loi bien dich Typst: unclosed delimiter` lặp lại 8 lần.
- **Nguyên nhân kỹ thuật:**
  - **Mất giao diện CSS:** `html_to_typst` chỉ rút trích text thô và bỏ toàn bộ `<style>`/`<head>` nên không thể tái hiện màu nền, bố cục slide 16:9 hay CSS hiện đại.
  - **Lỗi `unclosed delimiter`:** Phát hiện 2 nguyên nhân gốc:
    1. Trong `html_epub.rs`, marker `KNITTOK{n}END` được dán liền vào chuỗi văn bản rồi đi qua `insert_wrap_opportunities` (`markdown.rs`); khi token không khoảng trắng dài `> 16` ký tự, hàm chèn `\u{200B}` cắt đôi tên marker (`KNITTOK11E\u{200B}ND`), làm bước `.replace()` bỏ sót dấu đóng `]`.
    2. Trong `markdown.rs`, `escape_typst_text` chưa escape chuỗi `//` (ví dụ `<strong>01 // Docker...</strong>`); trong cú pháp Typst, `//` bắt đầu comment hết dòng nên nuốt luôn dấu `];` đóng của `#strong[...]` ở cuối dòng đó.
- **Thay đổi đã áp dụng:**
  - **Kết xuất HTML qua Headless Chromium (`crates/knit-docs/src/office.rs`, `src/lib.rs`, `Cargo.toml`):**
    - Bổ sung `detect_chromium_browser()` (dò `google-chrome`, `chromium`, `brave-browser`, `microsoft-edge` đa nền tảng) và `compile_html_via_browser_to_pdf_bytes(...)`.
    - Khi có trình duyệt nhân Chromium trên máy, tạo tệp HTML tạm `.knit_html_render_*.html` ngay trong `base_dir` (để giữ nguyên liên kết ảnh/CSS/JS tương đối, tự dọn qua `TempFileCleanupGuard`), tự chèn `<style data-knit-print>` bật `print-color-adjust: exact !important` (kèm `@page { size: 1920px 1080px; margin: 0; }` cho slide 16:9 cố định hoặc theo `opts.page_size`/`opts.orientation`) và `<script data-knit-print>` vô hiệu hóa `alert`/`confirm`/`prompt` tránh treo headless, rồi gọi `--headless --print-to-pdf=...`.
    - Nếu hệ thống chưa cài trình duyệt Chromium (hoặc quá trình in lỗi), tự động fallback sạch về bộ biên dịch Typst.
  - **Sửa lỗi Typst `unclosed delimiter` (`crates/knit-docs/src/html_epub.rs`, `src/markdown.rs`):**
    - Triệt tiêu lỗi cắt marker bằng `escape_typst_preserving_markers` và stack cân bằng thẻ mở/đóng `open_stack` trước ranh giới block.
    - Cập nhật `escape_typst_text` trong `crates/knit-docs/src/markdown.rs` để escape các dấu `/` đứng kề nhau (`//` -> `\/\/`), ngăn `//` tạo comment nuốt dấu đóng `]`.
  - Cập nhật nhãn engine `"Chromium"` trên UI `src/views/Docs2PdfView.tsx` và bổ sung test `html_with_adjacent_inline_tags_and_multiline_heading_compiles_typst_without_unclosed_delimiter` trong `crates/knit-docs/tests/docs_tests.rs` (kiểm tra luôn với file `slides/index.html` thực tế).
- **Lý do chọn cách làm này:** Chỉ có engine trình duyệt thực thụ (Blink/Chromium) mới kết xuất chính xác 100% CSS Grid/Flexbox, CSS custom properties, SVG inline và `@media print` của các trang web/slide hiện đại, trong khi việc vá triệt để `html_epub.rs` + `markdown.rs` đảm bảo nhánh fallback Typst cũng không bao giờ vấp lỗi `unclosed delimiter`.

---

## 6. PDF Merge — Sửa tràn RAM khi nạp, gộp, xóa tệp và mở modal xem trước (Preview) các tệp PDF dung lượng GB+

- **Vấn đề trước đó:** Khi nạp tệp PDF dung lượng cả GB (ví dụ 2.8 GB) trong `Merge PDF`, RAM tăng tương ứng kích thước file; đặc biệt khi double click vào thẻ file để mở modal xem trước, RAM tăng đột ngột lên 5 GB+ gây đơ và crash app dù chỉ mở rồi đóng ngay, và sau khi xóa tệp khỏi danh sách thì RAM vẫn không giảm.
- **Nguyên nhân kỹ thuật:**
  1. **Double click mở `PdfFilePreviewModal` tràn +5 GB RAM:** `src/components/PdfFilePreviewModal.tsx` gọi `readPdfFileBytes` (`std::fs::read` đọc trọn 2.8 GB vào Rust heap -> truyền `ArrayBuffer` 2.8 GB sang WebView -> `PdfJsPreview` nhân đôi qua `pdfBytes.slice()` -> Worker PDF.js copy tiếp), tạo 3–4 bản sao nhiều GB trong RAM.
  2. **`inspect_pdf` và `merge_pdfs` giữ stream trong heap:**
     - `inspect_pdf` trước đây dùng `lopdf::Document::load_mem_with_options`, khiến `lopdf` parse toàn bộ stream bằng `data.to_vec()` trên nhiều luồng `rayon` trước khi filter loại bỏ (tốn GB heap trong arena đa luồng), và khi filter dùng `std::mem::replace` còn làm `ObjStm`/page tree không load sạch.
     - `merge_pdfs` gọi `Document::load_mem(&mmap)`, giữ toàn bộ `stream.content` (2.8 GB) trong `doc.objects` đồng thời trước khi ghi ra file đích.
  3. **Xóa tệp hoặc đóng preview không giải phóng cache `Mmap` và heap glibc:** `PdfOpsView.tsx` chỉ xóa state React khi bỏ file, không evict `Arc<Pdf>` khỏi `HAYRO_PDF_CACHE` và không gọi `malloc_trim(0)`.
- **Thay đổi đã áp dụng:**
  - **Streaming On-Demand cho `PdfFilePreviewModal` (`src/components/PdfFilePreviewModal.tsx`):**
    - Gỡ bỏ hoàn toàn việc đọc `readPdfFileBytes` và `PdfJsPreview` byte array.
    - Chuyển sang component `LazyPdfModalPage` dùng `IntersectionObserver` kết xuất từng trang theo vùng nhìn thấy thông qua `renderPdfPagePreviewFile(pdfInfo.path, pageIndex, renderWidth)` (chạy trên `hayro` + `Mmap` từ ổ cứng, unmount `<img>` khi trang cuộn ra khỏi khung nhìn); vẫn giữ đầy đủ thanh Zoom In / Zoom Out / Fit Width, `Ctrl/Cmd + Scroll` zoom (`0.4`–`3.0`) và bộ đếm trang, đồng thời gọi `releasePdfCachedFiles([])` khi đóng modal.
  - **Zero-copy `inspect_pdf` & Streaming Slice trong `merge_pdfs` (`crates/knit-pdf/src/ops.rs`, `packer.rs`, `lib.rs`):**
    - Viết `read_outlines_hayro` để `inspect_pdf` đọc số trang và toàn bộ cây `/Outlines` trực tiếp từ `load_cached_hayro_pdf(path)` (zero-copy trên `Mmap`, gần như 0 MB heap) và tái sử dụng cache cho thumbnail.
    - Trong `merge_pdfs`, thay `Document::load_mem` bằng `filter_deferred_heavy_streams` (giải phóng ngay `stream.content > 16KB` trên worker thread, ghi nhớ độ dài vào `KnitOrigLen`, sau đó dùng `find_stream_data_slice` cắt slice byte gốc trực tiếp từ `mmap` ghi thẳng xuống đĩa qua `StreamingPdfWriter::write_lopdf_stream_with_slice`), kèm `trim_heap_if_supported()` (`malloc_trim(0)`).
  - **Dọn cache tức thì khi xóa file (`crates/knit-pdf/src/ops.rs`, `src-tauri/src/lib.rs`, `src/lib/ipc.ts`, `src/views/PdfOpsView.tsx`):**
    - Thêm `evict_pdf_reader_cache_paths` và Tauri command `pdf_release_cached_files`; gọi tự động khi xóa từng file PDF, khi bấm Clear All (`clearImagePreviewCache`), và khi đóng `PdfFilePreviewModal`.
  - Bổ sung integration test `merge_deferred_large_streams_and_evict_pdf_cache` (`crates/knit-pdf/tests/pdf_tests.rs`) và unit test `PdfFilePreviewModal` trong `src/components/Review117Components.test.tsx`.
- **Lý do chọn cách làm này:** Kết xuất trang xem trước theo demand qua `Mmap` + `IntersectionObserver` biến chi phí RAM của modal preview từ $O(\text{tổng dung lượng file})$ (nhiều GB) xuống mức hằng số $O(1)$ (~vài chục MB cho 2–4 trang đang hiển thị), trong khi cơ chế deferred mmap slice giữ toàn vẹn dữ liệu PDF nguồn khi gộp mà không lưu buffer hàng GB trong heap.

---

## 7. Tổng hợp tệp đã chỉnh sửa / tạo mới

- **Backend Rust:**
  - `crates/knit-docs/Cargo.toml`, `Cargo.lock` (Khai báo `lopdf.workspace = true` cho `knit-docs` và `zip.workspace = true` ở `dev-dependencies`)
  - `crates/knit-docs/src/office.rs` (`compile_office_to_pdf_bytes`, `clear_office_cache`, `detect_chromium_browser`, `compile_html_via_browser_to_pdf_bytes`, `inject_browser_print_styles`)
  - `crates/knit-docs/src/html_epub.rs` (`parse_epub_css`, `html_fragment_to_typst_with_css` hỗ trợ drop-cap `.gif` CSS & class EPUB, `escape_typst_preserving_markers` và stack cân bằng thẻ inline)
  - `crates/knit-docs/src/markdown.rs` (Escape `//` thành `\/\/` trong `escape_typst_text` để không tạo comment Typst nuốt dấu đóng `]`)
  - `crates/knit-docs/src/lib.rs` (Kết nối Chromium HTML renderer + fallback Typst một lần, export hàm mới)
  - `crates/knit-docs/tests/docs_tests.rs` (Thêm tests cho HTML inline adjacent / `slides/index.html` và EPUB drop-cap `.gif`)
  - `crates/knit-pdf/src/packer.rs` (Thêm `StreamingPdfWriter::write_lopdf_stream_with_slice`)
  - `crates/knit-pdf/src/ops.rs` (`read_outlines_hayro` cho `inspect_pdf`, `evict_pdf_reader_cache_paths`, `filter_deferred_heavy_streams` & `find_stream_data_slice` cho `merge_pdfs`)
  - `crates/knit-pdf/src/lib.rs` (Export `evict_pdf_reader_cache_paths`)
  - `crates/knit-pdf/tests/pdf_tests.rs` (Thêm test `merge_deferred_large_streams_and_evict_pdf_cache`)
  - `src-tauri/src/lib.rs` (Thêm `pdf_release_cached_files`, mở rộng `docs_preview_pdf_bytes` cho DOCX/PPTX, dọn `clear_office_cache`)
- **Frontend & Helpers:**
  - `src/views/pdf-ops/LoadedPdfList.tsx` (Hiển thị path cùng dòng khi trùng tên, badge Info chỉ cho file trùng chính xác path)
  - `src/views/Image2PdfView.tsx` (Xóa checkbox `autoUpdateBookmarksOnDelete` trùng ở cột mục lục bên phải)
  - `src/views/docs2pdf/Docs2PdfSettingsCard.tsx`, `src/views/Docs2PdfView.tsx` (Preview PDF chỉ đọc cho DOCX/PPTX, disable cấu hình Typst khi mở Office, nhãn engine Chromium)
  - `src/components/PdfFilePreviewModal.tsx` (Chuyển sang virtual scroll kết xuất từng trang theo demand qua `renderPdfPagePreviewFile` + `IntersectionObserver`, giải phóng RAM khi đóng)
  - `src/lib/ipc.ts`, `src/views/PdfOpsView.tsx` (Thêm và gọi `releasePdfCachedFiles` / `clearImagePreviewCache` khi xóa file hoặc Clear All)
  - `src/i18n/{types,vi,en}.ts` (Thêm `pdfOps.duplicateFileBadge`)
  - `src/components/Review113Components.test.tsx`, `src/views/Image2PdfView.test.tsx` (Cập nhật tests cho mục 1 và mục 2)
  - `src/components/Review117Components.test.tsx` *(tạo mới)* (Unit tests cho preview Office ở `Docs2PdfView` và streaming `PdfFilePreviewModal`)

---

## 8. Kết quả kiểm thử (sau lần chỉnh sửa cuối cùng)

Lệnh đã chạy: `cargo test --workspace && cargo check -p knit-desktop && pnpm build && pnpm test`

| Hạng mục kiểm tra | Lệnh thực thi | Kết quả | Ghi chú |
|---|---|---|---|
| Rust Core Crates Test | `cargo test --workspace` | **58 passed, 0 failed** | `knit-archive` (5), `knit-core` (7), `knit-docs` (1 unit + 15 integration = 16), `knit-manga` (5), `knit-pdf` (19), `knit-renamer` (6), `knit-desktop-lib` (0 failed) |
| Tauri Desktop Crate Check | `cargo check -p knit-desktop` | **Pass (exit 0)** | 0 warnings, IPC handlers hợp lệ (`2.05s`) |
| Frontend TypeCheck & Build | `pnpm build` | **Pass (exit 0)** | `tsc --noEmit` & `vite build` (`3300 modules transformed`, `19.76s`) |
| Frontend Vitest Suite | `pnpm test` | **24 files passed, 89 tests passed** | 0 failed, 0 skipped (`5.45s`) |

### Phạm vi kiểm thử thực tế chưa tự động hóa được trong CLI:
- Kiểm tra trực quan trên giao diện Tauri với các tệp người dùng nêu thực tế: mở `Đồi Gió Hú - Emily Bronte.epub` để đối chiếu ảnh drop-cap `.gif` với E-book Viewer; mở và xuất `slides/index.html` qua Chromium để xác nhận màu nền/CSS slide 16:9; mở `.docx`/`.pptx` để xem trước qua LibreOffice; và kiểm tra mức tiêu thụ RAM thực tế (qua cột RSS/PSS của app và System Monitor) khi nạp, double click xem trước, gộp rồi xóa các file PDF dung lượng 2.8 GB+.
