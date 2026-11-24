# Báo cáo phản hồi & thay đổi — Review Version 1.21

Tài liệu này tổng hợp các thay đổi đã áp dụng cho 7 đầu mục trong [version-1-21.md](file:///home/khoa/Code/Personal%20Project/Knit/user-review/version-1-21.md), giải thích nguyên nhân kỹ thuật đằng sau mỗi vấn đề, lý do lựa chọn giải pháp kiến trúc và kết quả kiểm chứng sau lần chỉnh sửa cuối cùng.

---

## 1. Đóng gói file `.md` và thư mục `_assets/` vào chung một thư mục khi có ảnh

- **Vấn đề trước đó:** Khi xuất PDF sang Markdown có ảnh đính kèm, hệ thống ghi `<stem>.md` và `<stem>_assets/` nằm rời nhau trực tiếp trong thư mục đích, làm lộn xộn thư mục output khi xuất nhiều tài liệu.
- **Nguyên nhân kỹ thuật:** Hàm `commit_markdown_and_assets_atomically` trong `crates/knit-docs/src/pdf_to_md.rs` ghi thẳng `output_md_path` tại `parent` và tạo `parent.join(target_assets_name)` thay vì tạo thư mục gói `<parent>/<stem>/`. Ngoài ra phần kiểm tra xung đột đầu ra ở `Pdf2MdView.tsx` chỉ kiểm tra đường dẫn phẳng `targetPath`.
- **Thay đổi đã áp dụng:**
  - Trong `crates/knit-docs/src/pdf_to_md.rs`: thêm `derive_package_dir_name` (re-export tại `crates/knit-docs/src/lib.rs`) và cập nhật `commit_markdown_and_assets_atomically` để khi `!written_images.is_empty()` sẽ đóng gói thành `<parent>/<stem>/<stem>.md` và `<parent>/<stem>/<stem>_assets/page_xxx_img_yy.png` (có kiểm tra tránh lồng lặp nếu thư mục cha đã trùng tên `<stem>`, đồng thời giữ nguyên staging `.tmp` + `atomic_write_file` nguyên tử). Khi không có ảnh (`written_images.is_empty()`), giữ nguyên xuất phẳng `<parent>/<stem>.md`.
  - Trong `src/views/Pdf2MdView.tsx`: thêm `buildPackagedExportPath` để `handleExportClick` kiểm tra xung đột cả đường dẫn phẳng lẫn đường dẫn đóng gói trong thư mục khi bật trích xuất ảnh.
  - Cập nhật unit test `pdf_to_md_extracts_vietnamese_tables_lists_and_embedded_images` trong `crates/knit-docs/tests/docs_tests.rs`.
- **Lý do chọn cách làm này:** Chỉ đóng gói thư mục khi thực sự có ảnh giúp thư mục output gọn gàng, dễ di chuyển/chia sẻ trọn bộ tài liệu + ảnh mà không tạo thêm cấp thư mục thừa cho các file Markdown thuần chữ.

---

## 2. Chiều cao khung soạn thảo Markdown kéo giãn tối đa 4000px kể cả với file ngắn

- **Vấn đề trước đó:** Khung làm việc bị giới hạn chiều cao tối đa `1100px`; và ngay cả khi kéo giãn cao hơn nội dung 25 dòng (~775px), phần vùng soạn thảo thực tế của CodeMirror chỉ cao vừa khít 25 dòng.
- **Nguyên nhân kỹ thuật:** `Pdf2MdView.tsx` cấu hình `useVerticalResize({ ..., max: 1100 })`, đồng thời wrapper chứa `MarkdownCodeEditor` thiếu `flex-col` và `editorBaseTheme` trong `MarkdownCodeEditor.tsx` chưa đặt bố cục flex (`display: flex; flex-direction: column` trên `.cm-editor`, `flex: 1 1 auto; align-items: stretch` trên `.cm-scroller`, và `minHeight: 100%` trên `.cm-content` + `.cm-gutters`), khiến vùng nội dung CodeMirror co lại theo số dòng thực tế.
- **Thay đổi đã áp dụng:**
  - Nâng `max` của `useVerticalResize` trong `src/views/Pdf2MdView.tsx` từ `1100` lên `4000`, đồng thời đặt `flex h-full min-h-0 flex-1 flex-col` cho card và container bọc `MarkdownCodeEditor`.
  - Cập nhật `editorBaseTheme` trong `src/components/MarkdownCodeEditor.tsx` để `.cm-editor`, `.cm-scroller`, `.cm-content` và `.cm-gutters` giãn đầy 100% chiều cao container được cấp phát.
- **Lý do chọn cách làm này:** Xử lý bằng CSS flex/min-height trực tiếp trên theme của CodeMirror giữ nguyên cơ chế cuộn ảo của trình soạn thảo mà vẫn cho phép người dùng kéo chiều cao lên tới 4000px và nhấp chuột thoải mái ở phần khoảng trống bên dưới dòng cuối.

---

## 3. Hiển thị đường dẫn file PDF dạng `~/...` và luôn giữ đầy đủ tên file

- **Vấn đề trước đó:** Thanh thông tin chỉ hiển thị tên file (`fileBasename(sourcePath)`), không thấy thư mục chứa file đang mở.
- **Nguyên nhân kỹ thuật:** `Pdf2MdView.tsx` chưa truy vấn thư mục home của hệ điều hành và chỉ render trực tiếp `fileBasename(sourcePath)` trong một thẻ `<span>` đơn.
- **Thay đổi đã áp dụng:**
  - Thêm command `get_home_dir` trong `src-tauri/src/lib.rs` (đọc `HOME` / `USERPROFILE`) và wrapper cache `getHomeDir()` trong `src/lib/ipc.ts`.
  - Tạo module thuần `src/lib/pathDisplay.ts` (`formatHomePath`, `splitDisplayPdfPath`) + unit test `src/lib/pathDisplay.test.ts` để rút gọn tiền tố home thành `~` và tách riêng phần thư mục (`dirPart`) với tên file (`fileName`).
  - Trong `src/views/Pdf2MdView.tsx`, hiển thị `dirPart` với `min-w-0 truncate` và `fileName` với `shrink-0` (kèm `title={sourcePath}` đầy đủ).
- **Lý do chọn cách làm này:** Tách thành hai `<span>` trong flex container đảm bảo khi cửa sổ hẹp chỉ phần thư mục ở giữa/đầu bị rút gọn `...`, còn tên file PDF luôn hiển thị đầy đủ 100%.

---

## 4. Tối ưu RAM và độ mượt khi cuộn/tương tác với PDF nặng (1000MB+)

- **Vấn đề trước đó:** Khi mở file PDF lớn (trên vài trăm MB / hàng trăm đến hàng nghìn trang), thao tác cuộn và tương tác giao diện bị giật lag rõ rệt và mức RAM tăng thêm ~500MB.
- **Nguyên nhân kỹ thuật:**
  1. `PdfLazyFilePreview.tsx` mount toàn bộ `totalPages` component `LazyPreviewPage` và `IntersectionObserver` vào DOM cùng lúc, và kích hoạt nhiều lệnh render đồng thời khi cuộn nhanh.
  2. `render_pdf_page_preview_file` trong `src-tauri/src/lib.rs` xuất và giải mã từng trang preview sang PNG (kích thước lớn, nén/giải mã chậm hơn JPEG nhiều lần) thay vì JPEG như `render_pdf_thumbnail_file`.
  3. `extract_loaded_pdf` và `extract_pdf_images_only` trong `crates/knit-pdf/src/extract.rs` giữ một `InterpreterCache` duy nhất suốt toàn bộ hàng trăm/nghìn trang tài liệu, đồng thời `HAYRO_CACHE_CAP` trong `crates/knit-pdf/src/ops.rs` giữ tới 4 file PDF đã parse.
  4. `Pdf2MdView.tsx` gọi `.trim().split(/\s+/).length` cấp phát mảng từ trên mỗi lần đổi text, và `MarkdownCodeEditor.tsx` chạy `collectSyntaxDiagnostics` trên cả tài liệu khổng lồ.
- **Thay đổi đã áp dụng:**
  - `src-tauri/src/lib.rs`: chuyển `render_pdf_page_preview_file` sang dùng `render_pdf_thumbnail_jpeg(..., 84)` và file cache `.jpg`.
  - `src/components/PdfLazyFilePreview.tsx`: chuyển sang danh sách trang ảo hóa theo cửa sổ cuộn (`startPage..endPage` với overscan ±4 trang, chiều cao slot cố định `slotHeight` để không nhảy layout khi ảnh tải xong), debounce 45ms trước khi gọi IPC render trang mới và throttle `onScroll` bằng `requestAnimationFrame`.
  - `crates/knit-pdf/src/extract.rs`: làm mới `InterpreterCache::new()` định kỳ mỗi 40 trang trong `extract_loaded_pdf` và `extract_pdf_images_only`.
  - `crates/knit-pdf/src/ops.rs`: hạ `HAYRO_CACHE_CAP` từ `4` xuống `2`.
  - `src/views/Pdf2MdView.tsx` & `src/components/MarkdownCodeEditor.tsx`: thay đếm từ bằng `countWordsFast` không cấp phát bộ nhớ, và bỏ qua `collectSyntaxDiagnostics` khi tài liệu vượt `300_000` ký tự.
- **Lý do chọn cách làm này:** Kết hợp `mmap` phía Rust + JPEG disk cache + virtualized scroll window phía WebView giúp giữ lượng DOM node và bitmap giải mã ở mức hằng số bất kể PDF dài 50 trang hay 2.000 trang, đồng thời giải phóng tài nguyên `hayro` định kỳ thay vì phình RAM tuyến tính theo số trang.

---

## 5. Không render lại PDF khi toggle checkbox `Trích xuất ảnh` / `Đánh dấu trang`

- **Vấn đề trước đó:** Mỗi lần bấm toggle checkbox trích xuất ảnh hoặc đánh dấu trang (`<!-- page: N -->`), app lại chạy trích xuất lại toàn bộ file PDF từ đầu.
- **Nguyên nhân kỹ thuật:** `Pdf2MdView.tsx` gọi trực tiếp `loadPdfWithMode(...)` -> `inspectAndExtractPdfToMd` mà backend chưa có tầng cache kết quả trích xuất cấu trúc trung gian (`PdfExtractedDocument`), nên mọi thay đổi tùy chọn định dạng đều phải chạy lại `interpret_page` qua từng trang.
- **Thay đổi đã áp dụng:**
  - `crates/knit-docs/src/pdf_to_md.rs`: bổ sung LRU cache nhẹ (tối đa 2 tài liệu) lưu `Arc<PdfExtractedDocument>` trích xuất ở chế độ `PdfImageExtractMode::MetadataOnly` (chỉ giữ text spans + tọa độ ảnh, không giữ PDF bytes hay PNG bytes), kèm `inspect_and_extract_pdf_to_markdown_cached` và `evict_pdf_to_md_cache_paths` / `clear_pdf_to_md_cache`. Khi toggle tùy chọn, `reconstruct_markdown_from_extracted` chỉ format lại Markdown từ cache trong vài mili-giây.
  - `src-tauri/src/lib.rs`: cập nhật `pdf2md_inspect_and_extract` nhận `force_reextract: Option<bool>` (chỉ ép đọc lại từ đĩa khi người dùng bấm nút **Tách lại từ PDF**) và dọn cache `knit_docs` trong `pdf_release_cached_files`.
  - `src/views/Pdf2MdView.tsx` & `src/i18n/{types,vi,en}.ts`: theo dõi `lastExtractedMarkdownRef`; nếu người dùng chưa sửa tay/tinh chỉnh AI thì toggle áp dụng tức thì từ cache; nếu đã có chỉnh sửa trong editor thì mở `ConfirmModal` hỏi xác nhận trước khi ghi đè.
- **Lý do chọn cách làm này:** Cache riêng lớp metadata nhẹ thay vì dựng lại toàn bộ chuỗi bằng regex ở frontend đảm bảo nhất quán 100% với quy tắc định dạng của lõi Rust (ví dụ chèn lại link ảnh đúng vị trí Y trên trang), trong khi bảo vệ người dùng khỏi mất công sửa tay nhờ `ConfirmModal`.

---

## 6. Chính sách dùng RAM & giới hạn dung lượng file import

- **Vấn đề trước đó:** Người dùng đặt câu hỏi có nên dùng RAM để giữ file PDF/MD/ảnh và đặt giới hạn dung lượng import để tránh render lại khi thao tác hay không.
- **Nguyên nhân kỹ thuật:** Trước đây không giữ cấu trúc trích xuất trung gian nhưng cũng không cảnh báo khi mở file rất lớn ở chế độ `Đầy đủ` (`full`), dễ gây hiểu nhầm rằng app đang nạp cả file PDF 1GB vào RAM.
- **Thay đổi đã áp dụng:**
  - **Kiến trúc bộ nhớ (không giữ PDF/PNG thô trong RAM):** Giữ PDF đọc qua `mmap` read-only trên đĩa và preview JPEG cache trên đĩa; chỉ cache phần `PdfExtractedDocument` dạng `MetadataOnly` (vài MB cho text spans + bounding box) phục vụ tái cấu trúc Markdown tức thì khi toggle tùy chọn, và chỉ giải mã PNG thật khi bấm Export.
  - **Không chặn cứng dung lượng + Banner gợi ý mềm >= 300MB:** Bổ sung banner `data-testid="pdf2md-large-file-banner"` trong `src/views/Pdf2MdView.tsx` (kèm khóa song ngữ trong `src/i18n/{types,vi,en}.ts`) khi file `>= 300 MB` đang mở ở chế độ `Đầy đủ`, cung cấp nút chuyển nhanh sang `Chỉ chuyển Markdown` hoặc `Xuất trực tiếp`.
- **Lý do chọn cách làm này:** Giữ khả năng mở file 1GB+ mà không chặn cứng người dùng, đồng thời tránh bùng nổ RAM như khi giữ toàn bộ bytes PDF hoặc PNG giải mã trong bộ nhớ.

---

## 7. Sửa lỗi mất chữ đầu dòng, cắt đôi đoạn và gộp mục lục trên file tiểu thuyết (`1_2.md`)

- **Vấn đề trước đó:** Khi chuyển đổi file tiểu thuyết `/home/khoa/Story/Novel/Konosuba - Akatsuki Natsume/1.pdf` (đối chiếu `/home/khoa/Downloads/1.md` và `/home/khoa/Downloads/1_2.md`), nhiều dòng bị cắt đôi khiến chữ như `Mở đầu` tách thành `### Mở` và `### đầu`, tiêu đề `Tập 1` bị tách thành `# Tậ` và `# p 1`, đoạn văn bị cắt nửa trái/nửa phải, và các dòng Mục lục bị gộp lẫn lộn.
- **Nguyên nhân kỹ thuật:**
  1. Hàm `split_two_column_zones` trong `crates/knit-docs/src/pdf_to_md.rs` kiểm tra từng `PdfTextSpan` riêng lẻ theo dải giữa trang (`0.43..0.57 * page_width`). Với các file PDF phát ra từng từ/nhóm ký tự thành các span ngắn, gần như không có span đơn lẻ nào vắt qua toàn bộ dải giữa, nên mọi trang văn xuôi 1 cột đều bị nhận diện nhầm là trang 2 cột — toàn bộ nửa trái của trang bị gom đọc trước rồi mới đến nửa phải.
  2. Các dòng Mục lục có chuỗi dấu chấm dẫn (`Mở đầu .......... 10`) ngoài việc bị cắt đôi bởi lỗi tách cột giả còn bị vòng lặp gộp đoạn văn trong `convert_lines_to_blocks` nhập chung thành một đoạn văn dài (và có thể có ký tự zero-width `\u{200B}` giữa các dấu chấm).
- **Thay đổi đã áp dụng:**
  - Viết lại `split_two_column_zones` trong `crates/knit-docs/src/pdf_to_md.rs` để kiểm tra theo **từng dòng ngang** (`cluster_spans_into_lines`): xác minh sự tồn tại thực sự của rãnh dọc giữa hai cột (`center_gap >= (font_size_pt * 2.0).max(16.0)`) và đếm số dòng bắc cầu qua giữa trang với khoảng cách từ bình thường (`bridging_lines`); nếu có dòng bắc cầu bình thường hoặc dòng mục lục dot-leader, giữ nguyên toàn trang là 1 cột.
  - Thêm `is_toc_leader_line` (xử lý được cả dấu chấm rời, `…` và `\u{200B}`) để loại trừ mục lục khỏi `split_line_into_table_cells`, xuất mỗi dòng mục lục thành mục danh sách `- <mục>` riêng biệt trong `convert_lines_to_blocks`, và ngắt đoạn văn trước dòng mục lục.
  - Bổ sung unit test hồi quy `pdf_to_md_preserves_single_column_multi_span_lines_and_toc_leaders_and_caches_options` trong `crates/knit-docs/tests/docs_tests.rs`.
- **Lý do chọn cách làm này:** Kiểm chứng rãnh dọc ở mức dòng ngang phân biệt chính xác văn xuôi 1 cột nhiều span ngắn với tài liệu 2 cột thật (cả trường hợp thẳng hàng lẫn lệch baseline), giải quyết triệt để gốc rễ hiện tượng cắt đôi tiêu đề, mất nửa dòng và hỏng mục lục.

---

## 8. Tổng hợp tệp đã chỉnh sửa / tạo mới

- **Backend Rust:**
  - `crates/knit-pdf/src/ops.rs` (Thu gọn `HAYRO_CACHE_CAP` từ 4 xuống 2 để hạn chế giữ nhiều PDF lớn đồng thời)
  - `crates/knit-pdf/src/extract.rs` (Làm mới `InterpreterCache` định kỳ mỗi 40 trang trong `extract_loaded_pdf` và `extract_pdf_images_only`)
  - `crates/knit-docs/src/pdf_to_md.rs` (Đóng gói thư mục khi có ảnh, cache `MetadataOnly`, sửa `split_two_column_zones` theo dòng ngang và xử lý dòng Mục lục)
  - `crates/knit-docs/src/lib.rs` (Export thêm `derive_package_dir_name`, `inspect_and_extract_pdf_to_markdown_cached`, `evict_pdf_to_md_cache_paths`, `clear_pdf_to_md_cache`)
  - `crates/knit-docs/tests/docs_tests.rs` (Cập nhật test đóng gói thư mục và thêm test hồi quy tách cột + mục lục + cache tùy chọn)
  - `src-tauri/src/lib.rs` (Chuyển `render_pdf_page_preview_file` sang JPEG cache, thêm `get_home_dir`, hỗ trợ `force_reextract` và dọn cache `knit_docs`)
- **Frontend & Helpers:**
  - `src/lib/pathDisplay.ts` & `src/lib/pathDisplay.test.ts` (Helper rút gọn `~/...` giữ nguyên tên file và unit tests)
  - `src/lib/ipc.ts` (Thêm `getHomeDir` có cache và tham số `forceReextract` cho `inspectAndExtractPdfToMd`)
  - `src/components/MarkdownCodeEditor.tsx` (Theme flex/min-height kéo giãn 100% chiều cao, bỏ qua lint với file > 300k ký tự)
  - `src/components/PdfLazyFilePreview.tsx` (Ảo hóa danh sách trang theo cửa sổ cuộn, slot cố định, debounce render và throttle rAF)
  - `src/views/Pdf2MdView.tsx` (Nâng max height lên `4000`, hiển thị path `~/...`, `ConfirmModal` khi toggle lúc đã sửa tay, banner cảnh báo mềm >= 300MB, kiểm tra xung đột đường dẫn đóng gói, đếm từ zero-alloc)
  - `src/i18n/{types,vi,en}.ts` (Khóa dịch song ngữ Việt - Anh cho modal xác nhận toggle và cảnh báo file lớn)
  - `src/components/Review120Components.test.tsx` (Bổ sung test hiển thị path `~/...`, banner file >= 300MB và `ConfirmModal` khi toggle sau chỉnh sửa)

---

## 9. Kết quả kiểm thử (sau lần chỉnh sửa cuối cùng)

Lệnh đã chạy: `cargo test --workspace && cargo check -p knit-desktop && pnpm build && pnpm test`

| Hạng mục kiểm tra | Lệnh thực thi | Kết quả | Ghi chú |
|---|---|---|---|
| Rust Core Crates Test | `cargo test --workspace` | **70 passed, 0 failed** | `knit-archive` (5), `knit-core` (7), `knit-docs` (4 unit + 23 integration), `knit-manga` (5), `knit-pdf` (20), `knit-renamer` (6) |
| Tauri Desktop Crate Check | `cargo check -p knit-desktop` | **Pass (exit 0)** | 0 warnings, toàn bộ IPC handlers & capabilities hợp lệ |
| Frontend TypeCheck & Build | `pnpm build` | **Pass (exit 0)** | `tsc --noEmit` & `vite build` thành công (`built in 19.86s`) |
| Frontend Vitest Suite | `pnpm test` | **28 files passed, 114 tests passed** | Bao gồm `pathDisplay.test.ts` và các test bổ sung trong `Review120Components.test.tsx` |

### Phạm vi kiểm thử thực tế chưa tự động hóa được trong CLI:
- Kéo thả thanh resize chiều cao thực tế lên tới `4000px` với file Markdown ngắn trên desktop WebView để kiểm tra bằng mắt độ giãn của CodeMirror và thao tác click dưới dòng cuối.
- Mở trực tiếp file PDF dung lượng lớn (`> 1GB`) và file `/home/khoa/Story/Novel/Konosuba - Akatsuki Natsume/1.pdf` trên ứng dụng desktop chạy thật để xác nhận mức RSS thực tế, độ mượt cuộn preview ảo hóa và chất lượng nội dung `.md` xuất ra trọn vẹn.
