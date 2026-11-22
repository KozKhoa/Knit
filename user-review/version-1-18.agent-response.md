# Báo cáo phản hồi & thay đổi — Review Version 1.18

Tài liệu này tổng hợp các thay đổi đã áp dụng cho toàn bộ 7 đầu mục trong `user-review/version-1-18.md`, giải thích nguyên nhân kỹ thuật đằng sau mỗi thay đổi, lý do lựa chọn phương án kiến trúc và kết quả kiểm thử sau lần chỉnh sửa cuối cùng.

---

## 1. PDF Merge — Cho cỡ chữ thẻ thông báo Duplicate & Path scale nhỏ hơn một bậc so với cỡ chữ ứng dụng

- **Vấn đề trước đó:** Trong danh sách tệp PDF đã nạp của `PDF Merge`, badge `Trùng tệp` / `Duplicate file` và thẻ đường dẫn `f.path` dùng kích thước pixel cứng nên không thay đổi theo tùy chọn cỡ chữ toàn ứng dụng (`--knit-app-font-size`).
- **Nguyên nhân kỹ thuật:** Trong `src/views/pdf-ops/LoadedPdfList.tsx`, dòng item dùng `text-xs`, badge duplicate dùng `text-[10px]` và thẻ đường dẫn dùng `text-[11px]`; vì đơn vị `px` không kế thừa từ `html { font-size: var(--knit-app-font-size); }`, chúng giữ nguyên kích thước cố định khi người dùng tăng/giảm cỡ chữ trong Settings.
- **Thay đổi đã áp dụng:**
  - Cập nhật `src/views/pdf-ops/LoadedPdfList.tsx`: đổi class dòng item, badge `duplicate-pdf-badge-${idx}` và đường dẫn `duplicate-pdf-path-${idx}` sang `text-sm` (`0.875rem` — đúng một bậc nhỏ hơn `text-base` / `1rem` của ứng dụng, icon `<Info />` chỉnh `h-3.5 w-3.5`), đảm bảo tự động co giãn tỷ lệ theo `--knit-app-font-size`.
  - Bổ sung unit test xác nhận trong `src/components/Review118Components.test.tsx`.
- **Lý do chọn cách làm này:** Trong hệ thống typography `tokens.css` (nơi `html` gắn `--knit-app-font-size`), mọi token Tailwind theo đơn vị `rem` (`text-sm = 0.875rem`) tự động scale đồng bộ và chính xác hơn một bậc so với chữ chuẩn `1rem`, không cần lắng nghe JS hoặc inline style rườm rà.

---

## 2. Docs to PDF — Tự động nhận diện & hỗ trợ cú pháp Editor đa ngôn ngữ (`html`, `css`, `js`, `ts`, `jsx`, `tsx`, `markdown`, `plain_text`)

- **Vấn đề trước đó:** Khi nạp tệp `.html` (hoặc tệp mã web/JS/TS) vào `Docs to PDF`, trình soạn thảo bên trái vẫn khóa cứng parser `markdown()` và hiển thị tiêu đề cố định `Soạn thảo Markdown / Văn bản` cùng nút `Lưu (.md)`.
- **Nguyên nhân kỹ thuật:**
  - `src/components/MarkdownCodeEditor.tsx` khởi tạo `EditorState` chỉ với một extension tĩnh `markdown()`.
  - `SUPPORTED_DOC_RE` trong `src/views/Docs2PdfView.tsx` và `DocInputKind::from_path` trong `crates/knit-docs/src/models.rs` chưa nhận phần mở rộng `.css`, `.js`, `.mjs`, `.cjs`, `.ts`, `.jsx`, `.tsx`.
- **Thay đổi đã áp dụng:**
  - **Cập nhật phụ thuộc (`package.json`, `pnpm-lock.yaml`):** Bổ sung `@codemirror/lang-html`, `@codemirror/lang-css`, `@codemirror/lang-javascript`, `@codemirror/lint` (đã có sẵn trong store `.pnpm`).
  - **CodeMirror Dynamic Language (`src/components/MarkdownCodeEditor.tsx`):**
    - Định nghĩa `EditorLanguage` (`markdown | html | css | javascript | typescript | jsx | tsx | plain_text`) và hàm `detectEditorLanguage(path, content)` tự nhận diện từ đuôi tệp hoặc nội dung HTML khởi đầu (`<!DOCTYPE html`, `<html>`, ...).
    - Dùng `Compartment` của `@codemirror/state` để chuyển ngữ pháp động khi prop `language` thay đổi; hỗ trợ luôn tô sáng các khối mã nhúng (`html`, `css`, `js`, `ts`, `jsx`, `tsx`) bên trong Markdown qua `embeddedMarkdownCodeLanguages`.
  - **Thanh tiêu đề Editor & Hỗ trợ chuyển PDF (`src/views/docs2pdf/DocsSplitWorkbench.tsx`, `src/views/Docs2PdfView.tsx`, `crates/knit-docs/src/models.rs`):**
    - Hiển thị tiêu đề động theo ngôn ngữ (`editorTitleByLang`), select box chọn/đổi ngôn ngữ thủ công ngay trên thanh Editor, và nút `Lưu (.ext)` tương ứng.
    - Mở rộng `SUPPORTED_DOC_RE`, hộp thoại `pickFiles`/`pickSaveFile` và `DocInputKind::from_path` cho `.css`, `.js`, `.mjs`, `.cjs`, `.ts`, `.jsx`, `.tsx`; hàm `formatEditorContentForCompilation` tự bọc mã `.css`/`.js`/`.ts`/`.jsx`/`.tsx` thành fenced code block Markdown an toàn khi biên dịch ra PDF qua Typst.
- **Lý do chọn cách làm này:** Dùng `Compartment` tái cấu hình ngôn ngữ ngay trên cùng instance `EditorView` giúp giữ nguyên lịch sử Undo/Redo, vị trí con trỏ và vùng cuộn khi chuyển ngôn ngữ hoặc chỉnh sửa tệp; bọc fenced code cho mã nguồn giúp PDF đầu ra có khối code rõ ràng thay vì bị xử lý nhầm như văn xuôi.

---

## 3. Docs to PDF — Bỏ hoàn toàn tô nền xám trên text trong cặp dấu `` ` `` của Editor

- **Vấn đề trước đó:** Khi mở file `.md` có văn bản nằm giữa cặp dấu backtick `` `...` `` (hoặc một số đoạn bị Lezer gán token monospace/processingInstruction), nền chữ bị tô xám ngẫu nhiên làm rối mắt.
- **Nguyên nhân kỹ thuật:** Trong `src/components/MarkdownCodeEditor.tsx`, rule highlight `vsCodeLightHighlight` gắn thuộc tính `backgroundColor: "#F3F3F3", borderRadius: "2px"` cho nhóm tag `[tags.monospace, tags.processingInstruction]`.
- **Thay đổi đã áp dụng:** Xóa bỏ hoàn toàn `backgroundColor` và `borderRadius` khỏi `vsCodeLightHighlight` trong `src/components/MarkdownCodeEditor.tsx` (chỉ giữ màu chữ `#A31515` để phân biệt inline code sạch sẽ trên nền trắng `#FFFFFF`), đồng thời bổ sung assertion kiểm tra style không còn `#F3F3F3` trong `src/components/Review118Components.test.tsx`.
- **Lý do chọn cách làm này:** Giữ màu mực đậm dịu (`#A31515`) mà không tô màu nền giữ giao diện phẳng sạch theo `DESIGIN.md` và loại bỏ triệt để hiện tượng mảng nền xám loang khi Lezer tokenize các cặp dấu `` ` ``.

---

## 4. Docs to PDF — Nhận diện lỗi cú pháp (Syntax Diagnostics) và scale cỡ chữ Editor theo app

- **Vấn đề trước đó:**
  1. Editor chưa kiểm tra và báo lỗi cú pháp khi người dùng gõ hoặc nạp tệp HTML/CSS/JS/TS/JSX/TSX/Markdown có lỗi.
  2. Cỡ chữ nội dung soạn thảo (`12.5px`) và số dòng gutter (`11.5px`) bị gắn cứng theo `px`, không scale theo cỡ chữ ứng dụng.
- **Nguyên nhân kỹ thuật:** `MarkdownCodeEditor.tsx` chưa tích hợp `@codemirror/lint`, còn `editorBaseTheme` sử dụng `fontSize: "12.5px"` cho `&` và `"11.5px"` cho `.cm-lineNumbers .cm-gutterElement`.
- **Thay đổi đã áp dụng:**
  - **Cỡ chữ theo app (`src/components/MarkdownCodeEditor.tsx`):** Đổi `"&"` sang `fontSize: "0.875rem"` và `.cm-lineNumbers .cm-gutterElement` sang `fontSize: "0.75rem"` để kế thừa tỷ lệ từ `--knit-app-font-size`.
  - **Kiểm tra lỗi cú pháp (`collectSyntaxDiagnostics` trong `src/components/MarkdownCodeEditor.tsx`, `DocsSplitWorkbench.tsx`):**
    - Tích hợp `lintGutter()` + `linter(...)` từ `@codemirror/lint` và `forceLinting` khi đổi ngôn ngữ.
    - Quét cây Lezer (`syntaxTree` cho `html`, `css`, `javascript`, `typescript`, `jsx`, `tsx`) phát hiện mọi node `isError`; đồng thời kiểm tra cấu trúc thẻ đóng/mở HTML (bao gồm phát hiện ký tự thừa trước `<!DOCTYPE` như `z<!DOCTYPE html>`) và fenced code block chưa đóng trong Markdown.
    - Đếm và hiển thị badge số lỗi cú pháp ngay trên header Editor (`editor-syntax-error-badge` với icon `AlertTriangle`).
- **Lý do chọn cách làm này:** Kết hợp Lezer error nodes (chính xác từng ngôn ngữ JS/TS/JSX/TSX/CSS/HTML) cùng kiểm tra cấu trúc thẻ HTML/Markdown giúp bắt cả các lỗi cấu trúc mà HTML parser dung sai thường bỏ qua, chạy hoàn toàn ngoại tuyến trong trình duyệt mà không cần language server nặng nề.

---

## 5. Docs to PDF — Chuyển bố cục 2 cột khi không có Editor (EPUB / DOCX / PPTX) và thu về 1 cột khi `width < 1200px`

- **Vấn đề trước đó:** Khi nạp các định dạng chỉ đọc không có khung Editor (`.epub`, `.docx`, `.pptx`), toàn bộ màn hình xếp 1 cột dọc rất dài: Dropzone, thẻ tệp, tên tệp xuất, card Cài đặt ở trên và Preview PDF tít phía dưới, lãng phí không gian ngang trên màn hình rộng.
- **Nguyên nhân kỹ thuật:** `src/views/Docs2PdfView.tsx` luôn render `Dropzone`, `ExportFilenameControl`, `Docs2PdfSettingsCard` và `DocsSplitWorkbench` theo chiều dọc 1 cột đơn nhất, không phân biệt trường hợp `!isEditableText`.
- **Thay đổi đã áp dụng:**
  - Tách cụm điều khiển nhập/cài đặt thành `controlsCluster` (`Dropzone` → File đang mở → `ExportFilenameControl` → `Docs2PdfSettingsCard`) và vùng xem trước thành `workbenchNode` trong `src/views/Docs2PdfView.tsx`.
  - Khi `isPreviewableDoc && !isEditableText` (nạp EPUB / DOCX / PPTX): bọc bởi container `data-testid="docs2pdf-no-editor-split-layout"` dùng CSS Grid `grid-cols-1 gap-4 min-[1200px]:grid-cols-12 min-[1200px]:items-start`:
    - Khi màn hình rộng (`>= 1200px`): Cột trái (`min-[1200px]:order-1 min-[1200px]:col-span-7`) hiển thị **Preview PDF**; Cột phải (`min-[1200px]:order-2 min-[1200px]:col-span-5`) chứa **Dropzone đến hết phần cài đặt**.
    - Khi màn hình hẹp (`< 1200px`): Tự động xếp 1 cột theo thứ tự `order-1` (`controlsCluster`) ở trên và `order-2` (`workbenchNode`) ở dưới, giữ nguyên bố cục hiện tại.
- **Lý do chọn cách làm này:** Dùng responsive CSS Grid breakpoint `min-[1200px]` kết hợp `order-1`/`order-2` trên cùng một cây DOM (không nhân đôi component) giữ nguyên state Preview PDF (`pdfjs-dist` canvas, trang hiện tại, mức zoom) không bị remount khi thay đổi kích thước cửa sổ ngang qua mốc 1200px.

---

## 6. Docs to PDF — Hỗ trợ convert HTML slide điều hướng bằng `Space` / phím mũi tên / Click Event (mỗi bước = 1 trang PDF)

- **Vấn đề trước đó:** Khi chuyển đổi file HTML slide thuyết trình (như `slides/index.html`) điều hướng bằng phím `Space` / `ArrowRight`:
  1. Dư ký tự `z` trước `<!DOCTYPE html>` đẩy Slide 1 xuống trang 2.
  2. Chế độ `--print-to-pdf` 1 lượt khiến các khối `.reveal { opacity: 0 }` ở Slide 2 → 9 không được JS gắn class `.slide.visible`, dẫn đến trang 3 → 10 bị trắng hoàn toàn; với các deck HTML điều hướng bằng sự kiện không có `@media print` cũng không thể tách từng slide.
- **Nguyên nhân kỹ thuật:** Trình kết xuất tĩnh `--print-to-pdf` chỉ in trạng thái DOM ban đầu tại thời điểm tải trang, không mô phỏng tương tác nhấn phím `Space`/mũi tên hoặc click chuyển trang tuần tự của người thuyết trình.
- **Thay đổi đã áp dụng:**
  - **Chromium CDP Slide-Step (`crates/knit-docs/src/cdp.rs`, `office.rs`, `models.rs`, `lib.rs`, `Cargo.toml`):**
    - Thêm `HtmlRenderMode` (`auto`, `slide_step`, `document_print`) và `HtmlStepTrigger` (`AutoKey`, `Key`, `ClickSelector`, `ClickPoint`) vào `DocConvertOptions`.
    - Khi chọn `slide_step` (hoặc `auto` tự nhận diện qua `should_use_slide_step_auto`), mở Chromium headless với `--remote-debugging-port=0` và kết nối WebSocket CDP cục bộ thuần `std` (`LocalWebSocket` + `DevToolsActivePort`).
    - Tự dò kích thước stage (ví dụ `1920x1080`), vô hiệu hóa `@media print` gây tràn nhiều slide cùng lúc, rút ngắn transition về `0.01s`, chụp từng trạng thái bằng `Page.printToPDF` (`pageRanges: "1"`, giữ vector/selectable text), phát sự kiện chuyển trang (`Space`, `ArrowRight`, phím chỉ định, hoặc click chuột theo CSS Selector / tọa độ chuẩn hóa), so sánh dấu vân tay DOM + screenshot `fnv1a_64` (`seen_hashes`) để dừng chính xác khi chạm trang cuối hoặc lặp vòng, rồi ghép các trang PDF qua `merge_pdf_documents_mem` (`lopdf`).
    - Bổ sung `sanitize_leading_doctype_junk` để loại ký tự nhiễu nhỏ trước `<!DOCTYPE` khi in trình duyệt, và bổ sung rule `.slide .reveal { opacity: 1 !important; transform: none !important; }` cho chế độ `document_print`.
  - **Giao diện chọn Mode & Sự kiện (`Docs2PdfSettingsCard.tsx`, `PdfJsPreview.tsx`, `Docs2PdfView.tsx`):**
    - Chỉ hiện tùy chọn **Chế độ Render HTML** khi mở file `.html`/`.htm`/`.xhtml`, kèm cấu hình sự kiện phím hoặc click (hỗ trợ chọn tọa độ click trực tiếp ngay trên khung Preview).
  - Bổ sung 2 integration tests trên Chromium thật trong `crates/knit-docs/tests/docs_tests.rs` (gồm test file thực tế `slides/index.html` xuất đủ 9 trang PDF).
- **Lý do chọn cách làm này:** Giao tiếp trực tiếp CDP WebSocket từ `knit-docs` qua binary Chromium có sẵn trên máy (không cần Node/Playwright trong runtime) giữ ứng dụng gọn nhẹ, hoàn toàn cục bộ và cho ra PDF vector sắc nét cho cả deck dùng phím lẫn deck dùng nút Next.

---

## 7. ExportSuccessToast — Cho cỡ chữ đường dẫn (`path`) và nút `Mở thư mục` (`Open folder`) scale theo app

- **Vấn đề trước đó:** Trong toast thông báo xuất thành công ở góc dưới phải (`ExportSuccessToast`), đường dẫn tệp kết xuất và nút `Mở thư mục` có cỡ chữ quá nhỏ cố định, không scale khi đổi cỡ chữ toàn ứng dụng.
- **Nguyên nhân kỹ thuật:** Trong `src/components/ExportSuccessToast.tsx`, thẻ `<span>` hiển thị `outPath` (dòng 79) và `<button>` `openFolder` (dòng 85) cùng dùng class cứng `text-[11px]`.
- **Thay đổi đã áp dụng:** Chuyển `src/components/ExportSuccessToast.tsx` từ `text-[11px]` sang `text-xs` (`0.75rem`) cho cả đường dẫn `outPath` lẫn nút `Open folder`, đồng thời nâng dòng tiêu đề toast lên `text-base`, vùng nội dung lên `text-sm` và icon thư mục lên `h-3.5 w-3.5` để toàn bộ toast scale đồng bộ theo `--knit-app-font-size`.
- **Lý do chọn cách làm này:** Sử dụng thang `rem` chuẩn của Tailwind đảm bảo mọi thành phần trong toast co giãn đồng điệu với toàn bộ workbench và vẫn giữ bố cục gọn gàng không tràn hộp thoại toast.

---

## 8. Tổng hợp tệp đã chỉnh sửa / tạo mới

- **Backend Rust:**
  - `crates/knit-docs/Cargo.toml`, `Cargo.lock` (Thêm `base64.workspace = true` cho `knit-docs`)
  - `crates/knit-docs/src/cdp.rs` *(tạo mới)* (Client CDP WebSocket RFC 6455, nhận diện HTML deck, vòng lặp nhấn phím / click qua từng slide và ghép PDF via `lopdf`)
  - `crates/knit-docs/src/models.rs` (Mở rộng `DocInputKind::from_path` cho `.css`/`.js`/`.ts`/`.jsx`/`.tsx`; thêm `HtmlRenderMode`, `HtmlStepKind`, `HtmlStepTrigger`, `preview_max_chapters`)
  - `crates/knit-docs/src/office.rs` (Tích hợp luồng CDP slide-step vào `compile_html_via_browser_to_pdf_bytes`, bổ sung `sanitize_leading_doctype_junk` và rule `.slide .reveal` cho print)
  - `crates/knit-docs/src/html_epub.rs`, `crates/knit-docs/src/world.rs` (Tách cache EPUB theo `chapters: Vec<String>` bỏ quét Regex thừa, hỗ trợ `preview_max_chapters`, drop `World`/`PagedDocument` sớm)
  - `crates/knit-docs/src/lib.rs` (Export module `cdp` và các struct cấu hình HTML render)
  - `crates/knit-docs/tests/docs_tests.rs` (Thêm tests cho CDP slide-step `Space`/Click/Key và `epub_preview_max_chapters_limits_preview_while_full_export_keeps_all_chapters`)
- **Frontend & Helpers:**
  - `package.json`, `pnpm-lock.yaml` (Khai báo và liên kết `@codemirror/lang-{html,css,javascript}` và `@codemirror/lint`)
  - `src/components/MarkdownCodeEditor.tsx` (Hỗ trợ đa ngôn ngữ qua `Compartment`, `detectEditorLanguage`, `collectSyntaxDiagnostics` + `linter`, bỏ nền xám `#F3F3F3` trên inline code, đổi cỡ chữ sang `0.875rem`/`0.75rem`)
  - `src/components/ExportSuccessToast.tsx` (Đổi `outPath` và nút `openFolder` từ `text-[11px]` sang `text-xs` / `text-sm` scale theo `--knit-app-font-size`)
  - `src/components/PdfJsPreview.tsx` (Hỗ trợ chọn tọa độ click chuẩn hóa cho HTML step, tối ưu bộ nhớ khi cuộn/đổi theme: bỏ `getPage` ngoài viewport, hủy `pdfDoc` cũ trước khi nạp mới, giới hạn `dpr` tài liệu dài)
  - `src/views/pdf-ops/LoadedPdfList.tsx` (Chuyển badge duplicate & path từ `text-[10px]`/`text-[11px]` sang `text-sm`)
  - `src/views/docs2pdf/Docs2PdfSettingsCard.tsx`, `src/views/docs2pdf/DocsSplitWorkbench.tsx`, `src/views/Docs2PdfView.tsx` (UI chọn HTML Render Mode & Event Step, chọn ngôn ngữ & badge lỗi cú pháp Editor, mở/convert `.css`/`.js`/`.ts`/`.jsx`/`.tsx`, bố cục 2 cột `>= 1200px` khi không có Editor)
  - `src/types/ipc.ts`, `src/i18n/{types,vi,en}.ts` (Bổ sung kiểu dữ liệu và khóa dịch Việt - Anh)
  - `src/App.test.tsx`, `src/components/Review115Components.test.tsx` (Cập nhật test cho tiêu đề/dropzone Docs2PDF và cấu hình HTML)
  - `src/components/Review118Components.test.tsx` *(tạo mới)* (Unit tests bao phủ đầy đủ các mục 1, 2, 3, 4, 5, 7 của Review 1.18)

---

## 9. Kết quả kiểm thử (sau lần chỉnh sửa cuối cùng)

Lệnh đã chạy: `cargo test --workspace && cargo check -p knit-desktop && pnpm build && pnpm test`

| Hạng mục kiểm tra | Lệnh thực thi | Kết quả | Ghi chú |
|---|---|---|---|
| Rust Core Crates Test | `cargo test --workspace` | **63 passed, 0 failed** | `knit-archive` (5), `knit-core` (7), `knit-docs` (3 unit + 18 integration = 21), `knit-manga` (5), `knit-pdf` (19), `knit-renamer` (6), `knit-desktop` (0 failed) |
| Tauri Desktop Crate Check | `cargo check -p knit-desktop` | **Pass (exit 0)** | 0 warnings, IPC handlers & capabilities hợp lệ |
| Frontend TypeCheck & Build | `pnpm build` | **Pass (exit 0)** | `tsc --noEmit` & `vite build` (`3301 modules transformed`) |
| Frontend Vitest Suite | `pnpm test` | **25 files passed, 96 tests passed** | 0 failed, 0 skipped (`4.63s`) |

### Phạm vi kiểm thử thực tế chưa tự động hóa được trong CLI:
- Kiểm tra trực quan trên ứng dụng Tauri desktop thật: đổi cỡ chữ toàn app trong Settings để quan sát độ co giãn đồng nhất của `LoadedPdfList` (mục 1), `MarkdownCodeEditor` (mục 4) và `ExportSuccessToast` (mục 7); co giãn cửa sổ Tauri qua ngưỡng chiều rộng `1200px` khi mở `.epub`/`.docx` để kiểm tra chuyển đổi mượt giữa bố cục 2 cột và 1 cột (mục 5); và dùng chuột chọn trực tiếp tọa độ click trên Preview cho file HTML trình chiếu tùy chỉnh (mục 6).
