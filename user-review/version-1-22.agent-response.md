# Báo cáo phản hồi & thay đổi — Review Version 1.22

Tài liệu này tổng hợp các thay đổi đã áp dụng cho 6 đầu mục trong `user-review/version-1-22.md`, giải thích nguyên nhân kỹ thuật đằng sau mỗi thay đổi, lý do lựa chọn phương án triển khai và kết quả kiểm thử sau lần chỉnh sửa cuối cùng.

---

## 1. Chọn model Gemini mặc định, tải danh sách model từ API và dùng đúng model khi Test

- **Vấn đề trước đó:** Giao diện Cài đặt Gemini trước đây cố định model `gemini-2.5-flash` ở chế độ chỉ đọc (`status.model`). Người dùng không thể chọn model khác (như `gemini-2.5-pro`, `gemini-2.0-flash`, ...) hoặc thử kết nối với một model tùy chỉnh khi `gemini-2.5-flash` chưa được tài khoản/khu vực kích hoạt hoặc cần độ chính xác cao hơn.
- **Nguyên nhân kỹ thuật:** `StoredAssistantConfig` trong `crates/knit-docs/src/gemini.rs` chỉ lưu bản cấu hình thô chưa có helper cập nhật riêng trường `model`, `test_gemini_connection` chỉ nhận `candidate_key` và dùng cứng model mặc định/đã lưu, đồng thời chưa có endpoint lấy danh sách model từ `GET /v1beta/models`.
- **Thay đổi đã áp dụng:**
  - `crates/knit-docs/src/gemini.rs` & `lib.rs`: Thêm hằng `DEFAULT_GEMINI_MODELS` (6 model phổ biến gồm `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.5-flash-lite`, `gemini-2.0-flash`, `gemini-1.5-flash`, `gemini-1.5-pro`), hàm `save_gemini_model` (lưu bền vào tệp cấu hình 0600), `list_gemini_models` (gọi `GET /v1beta/models`, lọc các model hỗ trợ `generateContent`, trả về mã model đã chuẩn hóa bỏ tiền tố `models/`), cập nhật `test_gemini_connection(candidate_key, candidate_model)` và `refine_markdown_with_gemini` sử dụng model đang cấu hình.
  - `src-tauri/src/lib.rs` & `src/lib/ipc.ts`: Thêm các command Tauri `gemini_save_model`, `gemini_list_models` và tham số `model?: string | null` cho `gemini_test_key` / `testGeminiKey`.
  - `src/views/SettingsView.tsx` & `src/i18n/{types,vi,en}.ts`: Thêm `<Select>` chọn model từ danh sách preset/API, nút **Tải model từ API** (`settings-gemini-fetch-models-btn`), ô nhập model tùy chỉnh + nút **Áp dụng model**, và truyền model đang chọn hoặc đang nhập vào `testGeminiKey(candidate, modelToTest)`.
- **Lý do chọn cách làm này:** Kết hợp danh sách gợi ý sẵn (`DEFAULT_GEMINI_MODELS`), tải trực tiếp danh sách khả dụng từ API và nhập tự do giúp vừa dùng được ngay ngoại tuyến trước khi kiểm tra mạng, vừa linh hoạt khi Google ra mắt model mới.

---

## 2. Sửa lỗi Typst `"expected colon"` trên `/home/khoa/Downloads/1.md` và hiển thị dòng lỗi + bấm nhảy tới vị trí lỗi

- **Vấn đề trước đó:** Khi xem trước hoặc xuất tệp Markdown như `/home/khoa/Downloads/1.md`, Typst báo lỗi `Typst compilation failed: expected colon` nhưng không cho biết nằm ở dòng nào để người dùng tìm và sửa.
- **Nguyên nhân kỹ thuật:**
  1. Trong `/home/khoa/Downloads/1.md` (dòng 5814), chuỗi `<br>/ \Z O<br>` được chuyển đổi thành một dòng Typst bắt đầu bằng `/ \Z O`. Trong cú pháp Typst, dòng bắt đầu bằng `/ ` mở đầu một **Term List** (`/ term: description`), nên Typst báo lỗi `expected colon` vì thiếu dấu `:` sau `/ ...`. Hàm `escape_typst_text` trong `crates/knit-docs/src/markdown.rs` chưa escape ký tự `/`.
  2. `format_typst_compile_error` trong `crates/knit-docs/src/world.rs` chỉ in chuỗi `e.message` mà không tra cứu span trong `KnitTypstWorld`, và `DocsSplitWorkbench.tsx` chưa phân giải lỗi biên dịch thành vị trí nhảy trong CodeMirror.
- **Thay đổi đã áp dụng:**
  - `crates/knit-docs/src/markdown.rs`: Escape mọi ký tự `/` thành `\/` trong `escape_typst_text` (tránh Typst hiểu nhầm dòng `/ ...` là term list; không escape `-` vì `\-` trong Typst là soft hyphen).
  - `crates/knit-docs/src/world.rs`: Cập nhật `format_typst_compile_error` nhận `Option<&KnitTypstWorld>`, sử dụng `typst::WorldExt::range` để lấy số dòng/cột Typst và đoạn trích (`Typst line L:C, near \`...\``) đưa vào thông điệp lỗi.
  - `src/components/MarkdownCodeEditor.tsx` & `src/views/docs2pdf/DocsSplitWorkbench.tsx`: Mở rộng callback `onDiagnosticsDetailChange` báo `EditorSyntaxSummary` (`count`, `firstLine`, `firstFrom`, `firstTo`, `firstMessage`); cập nhật badge `editor-syntax-error-badge` hiển thị số dòng lỗi đầu tiên và nhảy con trỏ tới đó khi bấm, đồng thời thêm `preview-error-jump-badge` trích đoạn `near \`...\`` từ `previewError` để tìm kiếm trong `editorText` và cuộn tới dòng tương ứng qua `editorRef.current?.jumpToRange`.
- **Lý do chọn cách làm này:** Escape `/` trực tiếp ở bộ sinh markup Typst xử lý tận gốc lỗi term list cho mọi trường hợp có `<br>/ ...`, còn trả về vị trí + snippet trong thông điệp lỗi kết hợp với jump badge giúp mọi lỗi Typst hiếm gặp khác đều định vị nhanh ngay trong trình soạn thảo.

---

## 3. Sửa lỗi Gemini Refine báo hoàn tất thành công khi thực chất bị lỗi (0 đoạn được làm đẹp)

- **Vấn đề trước đó:** Khi gọi Gemini Refine bị lỗi API (ví dụ sai model `HTTP 404`, sai key `HTTP 401/403`, hoặc mất mạng tất cả các chunk), backend vẫn nuốt lỗi vào `warnings`, trả về `refined_chunks: 0`, còn `Pdf2MdView.tsx` báo trạng thái hoàn tất (`success`) và ghi đè lịch sử Undo AI.
- **Nguyên nhân kỹ thuật:** Vòng lặp chunk trong `refine_markdown_with_gemini_using` (`crates/knit-docs/src/gemini.rs`) luôn fallback về text gốc cho mọi lỗi HTTP/mạng mà không fail-fast khi gặp lỗi cấu hình bất biến, đồng thời không kiểm tra trường hợp `refined_chunks == 0 && transport_errors > 0`. Ở frontend, `Pdf2MdView.tsx` không tách nhánh xử lý khi `res.refined_chunks === 0`.
- **Thay đổi đã áp dụng:**
  - `crates/knit-docs/src/gemini.rs`: Thêm kiểm tra `is_fatal_gemini_api_error` fail-fast ngay với lỗi HTTP 400/401/403/404 hoặc key/model không hợp lệ, và trả về `Err(KnitError::InvalidInput(...))` nếu `refined_chunks == 0 && transport_errors > 0` (trong khi vẫn giữ fallback an toàn khi LLM trả nội dung rút gọn quá ngắn để giữ nguyên test sanity hiện có).
  - `src/views/Pdf2MdView.tsx`: Kiểm tra `if (res.refined_chunks === 0)` trước khi cập nhật `markdown` hay snapshot Undo AI; xóa notice tạm, hiển thị lỗi qua `ErrorBanner` (`setErrorMsg`) và gọi `onFinishJob(..., "error", ...)`.
- **Lý do chọn cách làm này:** Phân biệt lỗi transport/HTTP fatal với fallback sanity cho phép báo lỗi ngay lập tức và chính xác khi API lỗi, không làm mất công việc đang sửa hoặc đánh lừa người dùng rằng tiến trình đã thành công.

---

## 4. Docs2Pdf (chế độ không có editor): Cố định cột cài đặt phải khi cuộn, kéo rộng/hẹp và giới hạn chiều cao theo cột cài đặt

- **Vấn đề trước đó:** Với các tệp xem trước không mở editor (EPUB, DOCX, PPTX), bố cục 2 cột trong `Docs2PdfView` dùng tỷ lệ cột cứng (`col-span-7` / `col-span-5`), cột cài đặt bên phải không bám dính khi cuộn xuống dưới, và người dùng có thể kéo chiều cao khung Preview vượt quá chiều cao tự nhiên của cụm cài đặt.
- **Nguyên nhân kỹ thuật:** Container `docs2pdf-no-editor-split-layout` trong `src/views/Docs2PdfView.tsx` chưa gắn `useHorizontalRatioResize`, `PaneResizeHandle`, class `sticky`, và `useVerticalResize` đang đặt trần cố định `4000px`.
- **Thay đổi đã áp dụng:**
  - `src/views/Docs2PdfView.tsx`: Chuyển `docs2pdf-no-editor-split-layout` sang grid động `--docs-no-editor-left` kèm `PaneResizeHandle` dọc (`useHorizontalRatioResize`, `min: 0.35`, `max: 0.75`, lưu qua `knit.docs.noEditorPreviewRatio`).
  - Gắn `min-[1200px]:sticky min-[1200px]:top-4` lên `docs2pdf-no-editor-controls-col` để cột phải bám theo khi cuộn.
  - Dùng `ResizeObserver` trên `noEditorControlsInnerRef` đo chiều cao tự nhiên cụm điều khiển bên phải (`controlsNaturalHeightPx`) làm `max` động cho `useVerticalResize` khi đang ở chế độ no-editor split (`effectiveMaxHeightPx`).
- **Lý do chọn cách làm này:** Tái sử dụng đúng `useHorizontalRatioResize` và `PaneResizeHandle` chuẩn của dự án đảm bảo đồng bộ UX kéo thả giữa mọi công cụ và tránh re-render React liên tục trong lúc kéo.

---

## 5. Cân bằng chiều cao các nút trên thanh công cụ cây Bookmark (`BookmarkTreeEditor`)

- **Vấn đề trước đó:** Trên thanh công cụ đầu `BookmarkTreeEditor`, `<Select size="sm">` dùng chiều cao `2rem` (`.knit-control-sm`), trong khi nhóm phân đoạn vị trí chèn (`Đầu cây` / `Cuối cây`), nút `Hoàn tác`, `Thu gọn` / `Mở tất cả`, và `Thêm mục gốc` dùng padding tự do nên chiều cao lệch nhau.
- **Nguyên nhân kỹ thuật:** Các phần tử nút và segmented group chưa thống nhất class chuẩn `.knit-control-sm` định nghĩa trong `src/styles/tokens.css`.
- **Thay đổi đã áp dụng:**
  - `src/components/BookmarkTreeEditor.tsx`: Gắn class `knit-control-sm` đồng bộ cho segmented group vị trí thêm (cùng nút con `h-6`), nút `Hoàn tác`, `Thu gọn`/`Mở tất cả`, và `Thêm mục gốc`.
- **Lý do chọn cách làm này:** Tái sử dụng token chiều cao chuẩn `2rem` của design system thay cho giá trị px rời rạc giúp tất cả control cùng hàng thẳng trục hoàn toàn theo `knit-ui-patterns`.

---

## 6. Cải tiến tương tác cây Bookmark theo phong cách KDE Dolphin Details View

- **Vấn đề trước đó:** Cây bookmark dùng cơ chế giữ chuột `400ms` mới vào chế độ chọn, khiến thao tác chậm, đồng thời khi chỉ chọn 1 hàng lại hiển thị thanh chọn và khóa các thao tác sửa trực tiếp.
- **Nguyên nhân kỹ thuật:** `BookmarkTreeEditor.tsx` gắn `longPressTimerRef` 400ms trong `handleRowPointerDown`, đặt `inSelectionMode = selectedKeys.size > 0`, và thiếu các phím tắt phổ biến (`Ctrl+A`, `F2`, `Delete`, `ArrowUp`/`ArrowDown`).
- **Thay đổi đã áp dụng:**
  - `src/components/BookmarkTreeEditor.tsx` & `src/i18n/{vi,en}.ts`: Loại bỏ hoàn toàn bộ đếm nhấn giữ 400ms (`longPressTimerRef`).
  - Quy ước `inSelectionMode = selectedKeys.size > 1`: bấm đơn (`Click`) chọn ngay 1 hàng nhưng giữ nguyên khả năng sửa tên inline (nháy đúp hoặc `F2`), sửa số trang, thêm mục con và thêm mục gốc; chọn từ 2 hàng trở lên mới bật `bookmark-selection-bar`.
  - Hỗ trợ đầy đủ thao tác KDE Dolphin Details View: `Ctrl+Click` bật/tắt chọn từng hàng, `Shift+Click` chọn theo khoảng, `Ctrl+A` chọn tất cả hàng đang hiển thị, `F2` sửa tên hàng đang chọn, `Delete` xóa hàng/nhóm hàng đang chọn, `ArrowUp`/`ArrowDown` (và `Shift+ArrowUp`/`ArrowDown`) di chuyển vùng chọn, `Esc` bỏ chọn, và kéo tối thiểu `5px` từ bất kỳ vị trí nào trên hàng để kéo sắp xếp (kéo cả nhóm nếu hàng nằm trong nhóm nhiều lựa chọn).
- **Lý do chọn cách làm này:** Mô hình tương tác chọn trực tiếp + phím tắt chuẩn file manager loại bỏ độ trễ 400ms, giảm thao tác thừa và quen thuộc ngay lập tức với người dùng desktop Linux/Windows.

---

## 7. Tổng hợp tệp đã chỉnh sửa / tạo mới

- **Backend Rust:**
  - [crates/knit-docs/src/gemini.rs](file:///home/khoa/Code/Personal%20Project/Knit/crates/knit-docs/src/gemini.rs) (Lưu & tải danh sách model Gemini, `test_gemini_connection` theo model, fail-fast lỗi fatal HTTP & 0-chunk transport errors)
  - [crates/knit-docs/src/lib.rs](file:///home/khoa/Code/Personal%20Project/Knit/crates/knit-docs/src/lib.rs) (Re-export `DEFAULT_GEMINI_MODELS`, `save_gemini_model`, `list_gemini_models`)
  - [crates/knit-docs/src/markdown.rs](file:///home/khoa/Code/Personal%20Project/Knit/crates/knit-docs/src/markdown.rs) (Escape `/` thành `\/` trong `escape_typst_text`)
  - [crates/knit-docs/src/world.rs](file:///home/khoa/Code/Personal%20Project/Knit/crates/knit-docs/src/world.rs) (`format_typst_compile_error` bổ sung dòng/cột Typst và snippet nguồn bằng `WorldExt::range`)
  - [crates/knit-docs/tests/docs_tests.rs](file:///home/khoa/Code/Personal%20Project/Knit/crates/knit-docs/tests/docs_tests.rs) (Regression tests cho `/ \Z O`, dòng lỗi Typst, và Gemini HTTP 404/transport errors)
  - [src-tauri/src/lib.rs](file:///home/khoa/Code/Personal%20Project/Knit/src-tauri/src/lib.rs) (Commands `gemini_save_model`, `gemini_list_models`, cập nhật `gemini_test_key`)
- **Frontend & Tests:**
  - [src/lib/ipc.ts](file:///home/khoa/Code/Personal%20Project/Knit/src/lib/ipc.ts) (`DEFAULT_GEMINI_MODELS`, `saveGeminiModel`, `listGeminiModels`, `testGeminiKey`)
  - [src/views/SettingsView.tsx](file:///home/khoa/Code/Personal%20Project/Knit/src/views/SettingsView.tsx) (Chọn model Gemini, tải model từ API, model tùy chỉnh)
  - [src/views/Pdf2MdView.tsx](file:///home/khoa/Code/Personal%20Project/Knit/src/views/Pdf2MdView.tsx) (Xử lý `refined_chunks === 0` thành lỗi & giữ nguyên Markdown)
  - [src/views/Docs2PdfView.tsx](file:///home/khoa/Code/Personal%20Project/Knit/src/views/Docs2PdfView.tsx) (No-editor split column resize, sticky right panel, `ResizeObserver` height cap)
  - [src/components/MarkdownCodeEditor.tsx](file:///home/khoa/Code/Personal%20Project/Knit/src/components/MarkdownCodeEditor.tsx) (`EditorSyntaxSummary` & `onDiagnosticsDetailChange`)
  - [src/views/docs2pdf/DocsSplitWorkbench.tsx](file:///home/khoa/Code/Personal%20Project/Knit/src/views/docs2pdf/DocsSplitWorkbench.tsx) (Hiển thị dòng lỗi & nhảy tới dòng trên `editor-syntax-error-badge` và `preview-error-jump-badge`)
  - [src/components/BookmarkTreeEditor.tsx](file:///home/khoa/Code/Personal%20Project/Knit/src/components/BookmarkTreeEditor.tsx) (Đồng bộ chiều cao toolbar `knit-control-sm` và tương tác KDE Dolphin Details View)
  - [src/i18n/types.ts](file:///home/khoa/Code/Personal%20Project/Knit/src/i18n/types.ts), [src/i18n/vi.ts](file:///home/khoa/Code/Personal%20Project/Knit/src/i18n/vi.ts), [src/i18n/en.ts](file:///home/khoa/Code/Personal%20Project/Knit/src/i18n/en.ts) (Khóa dịch song ngữ Việt - Anh mới)
  - [src/components/Review118Components.test.tsx](file:///home/khoa/Code/Personal%20Project/Knit/src/components/Review118Components.test.tsx), [src/components/Review119Components.test.tsx](file:///home/khoa/Code/Personal%20Project/Knit/src/components/Review119Components.test.tsx), [src/components/Review120Components.test.tsx](file:///home/khoa/Code/Personal%20Project/Knit/src/components/Review120Components.test.tsx) (Cập nhật & bổ sung Vitest regression tests)

---

## 8. Kết quả kiểm thử (sau lần chỉnh sửa cuối cùng)

Lệnh đã chạy: `cargo test --workspace && cargo check -p knit-desktop && pnpm build && pnpm test && python3 .agents/skills/knit-qa-gate/scripts/audit-rules.py`

| Hạng mục kiểm tra | Lệnh thực thi | Kết quả | Ghi chú |
|---|---|---|---|
| Rust Core Crates Test | `cargo test --workspace` | **72 passed, 0 failed** | `knit-archive`: 5, `knit-core`: 7, `knit-docs`: 4 unit + 25 integration, `knit-manga`: 5, `knit-pdf`: 20, `knit-renamer`: 6 |
| Tauri Desktop Crate Check | `cargo check -p knit-desktop` | **Pass (exit 0)** | Biên dịch kiểm tra IPC handlers hợp lệ |
| Frontend TypeCheck & Build | `pnpm build` | **Pass (exit 0)** | `tsc --noEmit` & `vite build` thành công (3305 modules) |
| Frontend Vitest Suite | `pnpm test` | **28 files passed, 117 tests passed** | Bao gồm toàn bộ tests cũ + tests hồi quy cho Review 1.22 |
| RULES.md Compliance Audit | `python3 .agents/skills/knit-qa-gate/scripts/audit-rules.py` | **PASSED (exit 0)** | 0 tham chiếu `tauri` trong `crates/knit-*`, 0 emoji thô trong `src/`, hợp đồng ghi nguyên tử hợp lệ |

### Phạm vi kiểm thử thực tế chưa tự động hóa được trong CLI:
- Kéo thả thực tế thanh chia dọc (`PaneResizeHandle`) và thanh chỉnh chiều cao theo kích thước cụm cài đặt thực tế khi xem trước file EPUB/DOCX lớn trên cửa sổ desktop (`>=1200px`).
- Tương tác chuột & bàn phím liên hoàn (kéo thả cả nhóm hàng sau khi chọn, double-click sửa tên, cuộn giữ sticky) trên KDE/Linux desktop thực tế.
- Tải danh sách model thật từ endpoint Google Gemini (`GET /v1beta/models`) với API key thật và xác minh chuyển đổi tệp `/home/khoa/Downloads/1.md` đầy đủ trên UI.
