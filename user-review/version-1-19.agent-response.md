# Báo cáo phản hồi & thay đổi — Review Version 1.19

Tài liệu này tổng hợp các thay đổi đã áp dụng cho 4 đầu mục trong [`user-review/version-1-19.md`](file:///home/khoa/Code/Personal%20Project/Knit/user-review/version-1-19.md), phân tích nguyên nhân kỹ thuật đằng sau từng vấn đề, lý do lựa chọn giải pháp và kết quả kiểm thử sau lần chỉnh sửa cuối cùng.

---

## 1. Docs to PDF (MD to PDF): Hiển thị `"Not found"` trực tiếp trong PDF và cảnh báo nhẹ khi thiếu tệp/thư mục liên kết

- **Vấn đề trước đó:** Khi tài liệu Markdown chèn ảnh cục bộ hoặc liên kết tới tệp/thư mục không tồn tại trên ổ đĩa, Typst dừng toàn bộ quá trình biên dịch PDF và ném lỗi dạng `"Invalid input: Loi bien dich Typst: file not found (searched at ...)"`. Người dùng không xem được phần nội dung còn lại của tài liệu và nhận thông báo lỗi trộn tiếng Việt không dấu/tiếng Anh.
- **Nguyên nhân kỹ thuật:**
  1. `prepare_typst_images` trong `crates/knit-docs/src/world.rs` chỉ nạp byte ảnh khi `load_image_bytes` tìm thấy dữ liệu hợp lệ; những ảnh cục bộ không tồn tại giữ nguyên lệnh `image("path")` khiến Typst engine fail cứng ở bước layout/render.
  2. Hàm `check_missing_files` có sẵn trong `src-tauri/src/lib.rs` kiểm tra `!p.is_file()`, nên chưa phù hợp cho liên kết thư mục cục bộ và chưa quét AST Markdown (`Tag::Image` + `Tag::Link`).
  3. Các chuỗi fallback biên dịch Typst dùng tiền tố tiếng Việt không dấu `"Loi bien dich Typst"` / `"Loi xuat PDF Typst"`.
- **Thay đổi đã áp dụng:**
  - `crates/knit-docs/src/world.rs`: Thêm các helper `make_missing_image_placeholder_svg`, `escape_xml_text`, `truncate_middle`, và `format_typst_compile_error`; cập nhật `prepare_typst_images` để khi `load_image_bytes` trả về `None` (không nạp được ảnh cục bộ) sẽ tạo một SVG placeholder in-memory (`__knit_missing_<counter>.svg`) hiển thị khung nét đứt `"Not found"` cùng đường dẫn bị thiếu thay vì làm vỡ bản dịch Typst. Chuyển tiền tố lỗi Typst sang tiếng Anh (`"Not found"`, `"Typst compilation failed"`, `"Typst PDF export failed"`).
  - `crates/knit-docs/src/markdown.rs` & `crates/knit-docs/src/lib.rs`: Thêm và export hàm `find_missing_markdown_links` cùng `percent_decode_url` và `local_target_exists` (kiểm tra sự tồn tại bằng `Path::exists()` cho cả `Tag::Image` và `Tag::Link` cục bộ, bỏ qua URL `http/https/mailto/data` và anchor `#...`).
  - `src-tauri/src/lib.rs` & `src/lib/ipc.ts`: Bổ sung lệnh Tauri `docs_check_missing_links` (đã đăng ký trong `generate_handler![]`) và hàm IPC `checkDocMissingLinks`.
  - `src/views/Docs2PdfView.tsx` & `src/i18n/{types,vi,en}.ts`: Gọi `checkDocMissingLinks` song song trong `runLivePreview` đối với tài liệu Markdown (xóa cảnh báo khi rỗng hoặc là file Office/phi-Markdown) và hiển thị thanh cảnh báo nhẹ không chặn thao tác (`data-testid="docs2pdf-missing-links-warning"`, khóa dịch `docs2pdf.missingLinksWarning` với nội dung `"Not found (N): ..."`).
- **Lý do chọn cách làm này:** Nạp SVG placeholder trực tiếp vào virtual filesystem của Typst qua `prepare_typst_images` giữ nguyên toàn bộ cấu trúc Typst xung quanh (`#figure(...)`, `#grid(...)`, `measure(...)`) mà không cần vá AST phức tạp, giúp tài liệu vẫn xuất PDF thành công ngay cả khi thiếu nhiều ảnh/liên kết. Việc tách riêng lệnh `docs_check_missing_links` dùng `Path::exists()` bảo đảm hỗ trợ chính xác cả đường dẫn file lẫn folder mà không ảnh hưởng các công cụ khác đang dùng `check_missing_files`.

---

## 2. PDF Merge — Cây Mục Lục (`BookmarkTreeEditor`): Sửa lỗi kéo-thả vào khe hở giữa 2 mục và bổ sung Chế Độ Chọn nhiều mục

- **Vấn đề trước đó:**
  1. Khi kéo một mục lục và thả vào khe hở nằm giữa hai section (hoặc vùng thụt lề bên trái của mục con), vạch chỉ báo thả biến mất và thứ tự bookmark không được cập nhật.
  2. Cây mục lục dùng chung (trên cả `PdfOpsView` và `Image2PdfView`) mới hỗ trợ kéo-thả đơn lẻ, chưa có chế độ chọn nhiều mục bằng giữ chuột hoặc `Ctrl`/`Shift` để xóa hàng loạt hoặc kéo-thả sắp xếp nhiều mục cùng lúc.
- **Nguyên nhân kỹ thuật:**
  1. Danh sách dòng bookmark dùng `space-y-1.5` tạo khe hở `6px` giữa các dòng và `marginLeft: depth * 16` ở wrapper ngoài mỗi `BookmarkRow`. Khi con trỏ nằm trong khe hở này, `document.elementsFromPoint(clientX, clientY)` chỉ trúng container `listInnerRef` chứ không trúng phần tử có `[data-bookmark-path]`, khiến `hitTestDrop` trả về `null`.
  2. `BookmarkTreeEditor` chưa có state chọn nhiều dòng (`selectedKeys`), timer long-press 400ms, hay hàm di chuyển đa nguồn trên cây phân cấp bảo toàn subtree con.
- **Thay đổi đã áp dụng:**
  - `src/lib/bookmarks.ts`: Bổ sung `parseBookmarkPathKey`, `isBookmarkDescendantOrSame`, `pruneNestedBookmarkPaths`, `deleteBookmarkNodesAtPaths`, `moveBookmarkNodesWithSelection`, và `moveBookmarkNodes` (tự động loại bỏ đường dẫn con lồng nhau khi nút cha đã được chọn để không nhân đôi/mất subtree).
  - `src/components/BookmarkTreeEditor.tsx`:
    - Mở rộng `hitTestDrop`: khi `elementsFromPoint` không trúng trực tiếp `[data-bookmark-path]`, tính toán hình học theo trục dọc đối chiếu danh sách `[data-bookmark-path]` trong `listInnerRef` để suy ra vị trí `"before"` hoặc `"after"` của dòng liền kề và hiển thị indicator (`data-testid="bookmark-drop-before-..."` / `bookmark-drop-after-..."`).
    - Bổ sung Chế độ Chọn (Selection Mode): kích hoạt khi giữ chuột 400ms (dịch chuyển `< 5px`) trên dòng chưa chọn, hoặc nhấn `Ctrl/Cmd+Click`, hoặc `Shift+Click` (chọn theo dải). Khi `inSelectionMode` hoạt động: vô hiệu hóa (`disabled`) ô nhập tên, ô số trang `NumberInput`, và nút thêm mục con trên từng dòng; hiển thị thanh công cụ `data-testid="bookmark-selection-bar"` (`Chọn tất cả`, `Xóa mục đã chọn`, `Xong`) và hỗ trợ `Esc` để thoát.
    - Khi kéo bất kỳ dòng nào đang nằm trong tập chọn (bằng handle kéo hoặc kéo trực tiếp dòng đã chọn khi di chuyển `>= 5px`), hệ thống thực thi kéo-thả hàng loạt qua `moveBookmarkNodesWithSelection` và cập nhật lại tập `selectedKeys` theo vị trí mới sau khi thả.
  - `src/i18n/{types,vi,en}.ts`: Thêm đầy đủ khóa dịch song ngữ cho thanh Selection Mode (`selectedCount`, `selectAll`, `deleteSelected`, `doneSelection`, `selectionHint`, `multiDragHint`).
- **Lý do chọn cách làm này:** Fallback hình học trong `hitTestDrop` xử lý chính xác cả khoảng hở `space-y-1.5` lẫn khoảng thụt đầu dòng mà không cần nới padding giả làm lệch layout thẻ; trong khi `pruneNestedBookmarkPaths` đảm bảo thao tác xóa hoặc kéo cả mục cha lẫn mục con trong cùng một tập chọn luôn nhất quán, hỗ trợ Undo (`Ctrl+Z`).

---

## 3. Đóng gói đa nền tảng Linux (Ubuntu-base, Fedora-base, Arch-base) và Windows 10/11

- **Vấn đề trước đó:** Workflow phát hành (`.github/workflows/release.yml`) chỉ dựng `.deb`/`.AppImage` cho Linux và bộ cài Windows, chưa có gói `.rpm` cho họ Fedora, gói portable `.tar.gz` hay `PKGBUILD` cho hệ Arch Linux, cũng như chưa ghi rõ hướng dẫn cài đặt theo từng họ hệ điều hành trong `README.md`.
- **Nguyên nhân kỹ thuật:** Lệnh `tauri-action` trên `ubuntu-latest` chưa khai báo `--bundles appimage,deb,rpm`, chưa cài `rpm` toolchain trong job CI Linux, và chưa đóng gói kèm file `.desktop` + script `PKGBUILD` chuẩn Arch Linux.
- **Thay đổi đã áp dụng:**
  - `.github/workflows/release.yml`: Cài thêm gói `rpm` trên runner `ubuntu-latest`, bật `args: --bundles appimage,deb,rpm`, bổ sung bước đóng gói `Knit_<version>_linux_x86_64.tar.gz` (chứa binary `knit-desktop`, `knit.desktop` và icon), và bước tạo/upload `PKGBUILD` đã điền sẵn `pkgver` và `sha256sums` lên GitHub Release.
  - `packaging/linux/knit.desktop`: Tạo desktop entry chuẩn FreeDesktop cho ứng dụng Knit.
  - `packaging/arch/PKGBUILD`: Tạo mẫu `PKGBUILD` cho Arch Linux sử dụng nguồn release tarball trên GitHub.
  - `README.md`: Cập nhật bảng và hướng dẫn tải/cài đặt cho Ubuntu/Debian (`.deb`/`.AppImage`), Fedora/RHEL/openSUSE (`.rpm`), Arch Linux (`PKGBUILD` / `.tar.gz`), và Windows 10/11 (`.exe` NSIS / Portable).
- **Lý do chọn cách làm này:** Build trực tiếp `--bundles appimage,deb,rpm` cùng portable `.tar.gz` trên runner Ubuntu sẵn có giữ quy trình release gọn trên một Linux build matrix duy nhất, trong khi tự động tính SHA-256 vào `PKGBUILD` giúp người dùng Arch cài đặt được ngay bằng `makepkg -si`.

---

## 4. Hiển thị phiên bản hiện tại ở góc dưới bên phải ứng dụng

- **Vấn đề trước đó:** Giao diện chưa hiển thị cố định số phiên bản đang chạy ở góc dưới bên phải để người dùng đối chiếu nhanh khi sử dụng hoặc gửi phản hồi.
- **Nguyên nhân kỹ thuật:** `WorkbenchShell` chưa đọc phiên bản ứng dụng từ Tauri runtime API hoặc biến build-time từ `package.json`.
- **Thay đổi đã áp dụng:**
  - `vite.config.ts` & `src/vite-env.d.ts`: Định nghĩa biến compile-time `__APP_VERSION__` lấy trực tiếp `version` từ `package.json` (`0.2.0`) và khai báo kiểu TypeScript toàn cục.
  - `src/components/WorkbenchShell.tsx`: Gọi `getVersion()` từ `@tauri-apps/api/app` khi chạy trong Tauri runtime (fallback về `__APP_VERSION__`), và render badge nổi cố định ở góc dưới bên phải (`data-testid="app-version-badge"`, `fixed bottom-2.5 right-3 z-30 pointer-events-none`) hiển thị `v{appVersion}`.
- **Lý do chọn cách làm này:** Kết hợp `getVersion()` của Tauri với fallback `__APP_VERSION__` từ `package.json` đảm bảo số phiên bản luôn đúng trên cả build desktop thật lẫn môi trường web/Vitest, đồng thời `pointer-events-none` tránh che khuất thao tác cuộn hoặc click ở mép dưới nội dung.

---

## 5. Tổng hợp tệp đã chỉnh sửa / tạo mới

- **Backend Rust:**
  - `crates/knit-docs/src/world.rs` (Emit SVG placeholder `"Not found"` khi thiếu ảnh cục bộ, chuẩn hóa thông báo lỗi tiếng Anh)
  - `crates/knit-docs/src/markdown.rs` (Thêm `find_missing_markdown_links`, `percent_decode_url`, `local_target_exists`)
  - `crates/knit-docs/src/lib.rs` (Re-export `find_missing_markdown_links`)
  - `crates/knit-docs/tests/docs_tests.rs` (Thêm integration test kiểm tra SVG placeholder `"Not found"` và phát hiện thiếu link ảnh/thư mục)
  - `src-tauri/src/lib.rs` (Thêm & đăng ký command `docs_check_missing_links`)
- **Frontend & Helpers:**
  - `src/lib/ipc.ts` (Thêm wrapper `checkDocMissingLinks`)
  - `src/lib/bookmarks.ts` & `src/lib/bookmarks.test.ts` (Bổ sung helper chọn nhiều nút, xóa hàng loạt, kéo-thả nhiều mục bảo toàn subtree và unit tests)
  - `src/components/BookmarkTreeEditor.tsx` (Sửa `hitTestDrop` cho khe hở/thụt lề; bổ sung Selection Mode và kéo-thả hàng loạt)
  - `src/views/Docs2PdfView.tsx` (Cảnh báo nhẹ tiếng Anh khi phát hiện liên kết thiếu trong Markdown)
  - `src/components/WorkbenchShell.tsx` (Hiển thị version badge cố định góc dưới phải)
  - `src/i18n/{types,vi,en}.ts` (Khóa dịch cho cảnh báo thiếu link và Selection Mode bookmark)
  - `src/components/Review119Components.test.tsx` (Bộ test Vitest cho các đầu mục UI của v1.19)
  - `vite.config.ts` & `src/vite-env.d.ts` (Cung cấp `__APP_VERSION__` từ `package.json`)
- **Đóng gói & Tài liệu:**
  - `.github/workflows/release.yml` (Thêm `.rpm`, `.tar.gz`, `PKGBUILD` tự động tính SHA-256)
  - `packaging/linux/knit.desktop` (File `.desktop` cho Linux)
  - `packaging/arch/PKGBUILD` (Mẫu `PKGBUILD` cho Arch Linux)
  - `README.md` (Hướng dẫn cài đặt cho Ubuntu-base, Fedora-base, Arch-base và Windows 10/11)

---

## 6. Kết quả kiểm thử (sau lần chỉnh sửa cuối cùng)

Lệnh đã chạy: `cargo test --workspace && cargo check -p knit-desktop && pnpm build && pnpm test && python3 .agents/skills/knit-qa-gate/scripts/audit-rules.py`

| Hạng mục kiểm tra | Lệnh thực thi | Kết quả | Ghi chú |
|---|---|---|---|
| Rust Core Crates Test | `cargo test --workspace` | **64 passed, 0 failed** | Gồm `knit_archive` (5), `knit_core` (7), `knit_docs` (3 unit + 19 integration), `knit_manga` (5), `knit_pdf` (19), `knit_renamer` (6) |
| Tauri Desktop Crate Check | `cargo check -p knit-desktop` | **Pass (exit 0)** | Toàn bộ IPC commands & dependencies biên dịch sạch |
| Frontend TypeCheck & Build | `pnpm build` | **Pass (exit 0)** | `tsc --noEmit && vite build` thành công |
| Frontend Vitest Suite | `pnpm test` | **26 files passed, 101 tests passed** | Đã bổ sung tests cho `bookmarks.ts` và `Review119Components.test.tsx` (4 tests) |
| Architectural Rules Audit | `python3 .agents/skills/knit-qa-gate/scripts/audit-rules.py` | **Pass (exit 0)** | 0 lỗi phân tách crate, 0 emoji thô trong `src/`, đảm bảo `atomic_write_file` |

### Phạm vi kiểm thử thực tế chưa tự động hóa được trong CLI:
- Trải nghiệm kéo-thả trực tiếp bằng chuột/trackpad trên WebView desktop thật (WebKitGTK / WebView2), đặc biệt cảm giác phản hồi khi giữ chuột 400ms so với kéo ngay `>= 5px` hoặc thả vào khe hở hẹp giữa các dòng bookmark và lồng cấp vào biểu tượng grip.
- Quá trình thực thi thực tế của GitHub Actions runner trên tag release mới để kiểm tra file `.rpm`, `Knit_<ver>_linux_x86_64.tar.gz`, và `PKGBUILD` cài đặt trên các bản phân phối Fedora/Arch/Ubuntu thật.
