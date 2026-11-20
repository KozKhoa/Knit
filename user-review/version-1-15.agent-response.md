# Báo cáo phản hồi & thay đổi — Review Version 1.15

Tài liệu này tổng hợp toàn bộ thay đổi đã áp dụng cho 9 đầu mục trong [`user-review/version-1-15.md`](file:///home/khoa/Code/Personal%20Project/Knit/user-review/version-1-15.md), giải thích nguyên nhân kỹ thuật, lựa chọn kiến trúc và kết quả kiểm thử sau lần chỉnh sửa cuối cùng.

---

## 1. PDF Merge: 2 chế độ sắp xếp (`Theo từng trang` ↔ `Theo từng tệp PDF`)

- **Vấn đề trước đó:** Khi chỉ cần ghép nối nguyên các tệp PDF theo thứ tự file, tab Merge vẫn bắt buộc hiển thị và thao tác từng thẻ trang riêng lẻ.
- **Thay đổi đã áp dụng:**
  - Trong [`src/views/pdf-ops/pdfOpsTypes.ts`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/pdf-ops/pdfOpsTypes.ts): thêm `PdfMergeMode = "per_page" | "per_file"`, hàm `analyzePerPageContiguity(selections, files)` kiểm tra toàn bộ các khối trang của từng tệp có đứng liền kề đúng thứ tự gốc (`0..page_count - 1`) và chưa xoay (`rotation_deg === 0`) hay không, cùng hàm `buildSelectionsFromFileOrder(fileOrder, files)`.
  - Trong [`src/components/PdfPageCards.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/components/PdfPageCards.tsx): bổ sung `MergeFileCard` hiển thị thumbnail trang đầu của từng tệp, số thứ tự `#idx`, tên tệp (phân biệt thư mục cha khi trùng tên), số trang & dung lượng, kéo thả đổi vị trí file, double-click zoom trang 1, chuột phải mở menu ngữ cảnh và nút xóa tệp.
  - Trong [`src/views/pdf-ops/PdfMergePane.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/pdf-ops/PdfMergePane.tsx) & [`src/views/PdfOpsView.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/PdfOpsView.tsx):
    - Bổ sung công tắc chế độ `Theo từng trang` / `Theo từng tệp PDF` (lưu tại `"knit.pdfops.mergeMode"`).
    - **Mode 2 → Mode 1:** giữ nguyên thứ tự các tệp đã sắp xếp và bung tương ứng thành `selections`.
    - **Mode 1 → Mode 2:** kiểm tra tính nguyên khối qua `analyzePerPageContiguity`. Nếu hợp lệ → giữ nguyên thứ tự file và chuyển trực tiếp; nếu đã bị xen trang giữa các tệp hoặc có trang bị xóa/đảo/xoay nội bộ → hiển thị `ConfirmModal` cảnh báo toàn bộ thay đổi chi tiết ở Mode 1 sẽ bị đặt lại trước khi chuyển.

---

## 2. PDF Split (`Output PDF Sections`): Bổ sung Xoay & Xóa trong Menu chuột phải

- **Vấn đề trước đó:** Menu chuột phải của các thẻ trang nằm bên trong khung `Output PDF Sections` chỉ mới hỗ trợ Phóng to & Copy đường dẫn, chưa có thao tác Xoay và Xóa như ở tab Merge.
- **Thay đổi đã áp dụng:**
  - Mở rộng `PdfContextMenuTarget` trong [`src/views/pdf-ops/PdfPageContextMenu.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/pdf-ops/PdfPageContextMenu.tsx) thêm `mode: "split_item"` với đầy đủ: `Xoay phải 90°`, `Xoay 180°`, `Xoay trái 90°`, `Phóng to & xem chi tiết trang`, `Copy đường dẫn file PDF` và `Xóa trang`.
  - Cập nhật `onContextMenuItem` trên `SplitSectionItemCard` ([`src/components/PdfPageCards.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/components/PdfPageCards.tsx)), [`src/views/pdf-ops/SplitSectionCard.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/pdf-ops/SplitSectionCard.tsx), [`src/views/pdf-ops/PdfSplitPane.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/pdf-ops/PdfSplitPane.tsx) và [`src/views/PdfOpsView.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/PdfOpsView.tsx) (bổ sung `handleRotateSectionItemBy`), giữ nguyên khung `Source PDF Pages` chỉ có Phóng to & Copy path.

---

## 3. Image2Pdf: Thu nhỏ khoảng cách top khi Bookmark Tree sticky

- **Vấn đề trước đó:** Do `<main>` trong [`src/components/WorkbenchShell.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/components/WorkbenchShell.tsx) có `p-5` (`20px`), khung sticky dùng `lg:top-0` để lại khoảng trống phía trên khá lớn khi cuộn xuống.
- **Thay đổi đã áp dụng:** Chuyển container sticky của cột PDF Bookmarks trong [`src/views/Image2PdfView.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/Image2PdfView.tsx) từ `lg:sticky lg:top-0` sang `lg:sticky lg:-top-3`, giảm khoảng cách đỉnh khi ghim xuống mức gọn hơn (~8px).

---

## 4. Modal phóng to ảnh/trang: Cuộn chuột zoom khi hover & Kéo pan để xem

- **Vấn đề trước đó:** Các modal phóng to ảnh/trang chỉ hiển thị vừa khung tĩnh, chưa hỗ trợ cuộn bánh xe chuột trên ảnh để phóng to và bấm kéo chuột để di chuyển xem vùng chi tiết.
- **Thay đổi đã áp dụng:**
  - Tạo component dùng chung [`src/components/ZoomPanViewport.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/components/ZoomPanViewport.tsx) hỗ trợ:
    - Cuộn bánh xe chuột khi hover trên ảnh/trang để thu phóng mượt từ `100%` đến `500%` bám quanh vị trí con trỏ.
    - Bấm giữ kéo chuột (`pan`) để di chuyển vùng xem khi đang zoom (`> 100%`), double-click để bật/tắt `200% ↔ 100%`, kèm HUD nút `-`, `%`, `+`, `Reset`.
  - Tích hợp `ZoomPanViewport` vào [`src/views/image2pdf/ImagePreviewModal.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/image2pdf/ImagePreviewModal.tsx) (`Image → PDF`) và [`src/components/PdfPageZoomModal.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/components/PdfPageZoomModal.tsx) (`PDF Merge & Split`).
  - Trong [`src/components/PdfJsPreview.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/components/PdfJsPreview.tsx), [`src/views/docs2pdf/DocsSplitWorkbench.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/docs2pdf/DocsSplitWorkbench.tsx) và [`src/views/Docs2PdfView.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/Docs2PdfView.tsx): bổ sung thao tác double-click lên trang trong khung xem trước để render trang ở độ nét cao (`scale = 2.2`) và mở bằng `PdfPageZoomModal` (hỗ trợ đầy đủ cuộn chuột zoom + kéo pan).

---

## 5 & 6. Thông báo hủy tác vụ đúng ngôn ngữ UI & Chuẩn hóa Activity Logs sang Tiếng Anh

- **Vấn đề trước đó:**
  - Khi bấm hủy tác vụ trong chế độ Tiếng Anh, `KnitError::Cancelled` từ Rust trả về `"Tác vụ đã bị hủy bởi người dùng"` và hiển thị nguyên văn trên banner + Activity Logs.
  - Chuỗi nhật ký `reporter.*` và `current_item` ở nhiều crate Rust đang dùng tiếng Việt không dấu/có dấu lẫn lộn.
- **Thay đổi đã áp dụng:**
  - **Rust Core & Crates:** Chuyển thông điệp `#[error(...)]` trong [`crates/knit-core/src/error.rs`](file:///home/khoa/Code/Personal%20Project/Knit/crates/knit-core/src/error.rs) (`Cancelled` → `"Job cancelled by user"`) và toàn bộ chuỗi `reporter.info/normal/detailed/warn/error` + `current_item` sang Tiếng Anh mặc định trên [`crates/knit-archive/src/lib.rs`](file:///home/khoa/Code/Personal%20Project/Knit/crates/knit-archive/src/lib.rs), [`crates/knit-docs/src/`](file:///home/khoa/Code/Personal%20Project/Knit/crates/knit-docs/src/lib.rs), [`crates/knit-manga/src/`](file:///home/khoa/Code/Personal%20Project/Knit/crates/knit-manga/src/packer.rs), [`crates/knit-pdf/src/`](file:///home/khoa/Code/Personal%20Project/Knit/crates/knit-pdf/src/ops.rs) và [`crates/knit-renamer/src/`](file:///home/khoa/Code/Personal%20Project/Knit/crates/knit-renamer/src/renamer.rs).
  - **Frontend:** Thêm `isJobCancelledError` trong [`src/lib/ipc.ts`](file:///home/khoa/Code/Personal%20Project/Knit/src/lib/ipc.ts) và khóa `common.jobCancelledMsg` (`"Job cancelled by user"` / `"Tác vụ đã bị hủy bởi người dùng"`). Cập nhật khối `catch` ở `Image2PdfView`, `Docs2PdfView`, `PdfOpsView`, `ArchiveView` và `MangaPackView` để thông báo & nhật ký hủy luôn khớp ngôn ngữ đang chọn.

---

## 7. Docs → PDF: Cho phép `Start numbering at` bắt đầu từ `0`

- **Vấn đề trước đó:** Ô nhập `Start numbering at` bị chặn `min={1}` nên không thể đánh số từ trang `0` (ví dụ đánh bìa là 0, nội dung từ 1).
- **Thay đổi đã áp dụng:**
  - Đổi `min={0}` trên `NumberInput` tại [`src/views/docs2pdf/Docs2PdfSettingsCard.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/docs2pdf/Docs2PdfSettingsCard.tsx) và đổi `Math.max(1, ...)` → `Math.max(0, ...)` tại [`src/views/Docs2PdfView.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/Docs2PdfView.tsx).
  - Kiểm chứng công thức Typst tại [`crates/knit-docs/src/markdown.rs`](file:///home/khoa/Code/Personal%20Project/Knit/crates/knit-docs/src/markdown.rs) và bổ sung test `page_numbering_can_start_at_zero` trong [`crates/knit-docs/tests/docs_tests.rs`](file:///home/khoa/Code/Personal%20Project/Knit/crates/knit-docs/tests/docs_tests.rs).

---

## 8. Image2Pdf: Kiểm tra file ảnh tồn tại trên đĩa trước khi Export & gắn badge cảnh báo

- **Vấn đề trước đó:** Vì ứng dụng chỉ giữ đường dẫn trên đĩa chứ không nạp toàn bộ ảnh vào RAM, nếu người dùng xóa/di chuyển file ảnh sau khi import thì lỗi chỉ xuất hiện giữa lúc đang chạy job export.
- **Thay đổi đã áp dụng:**
  - Thêm Tauri command `check_missing_files` trong [`src-tauri/src/lib.rs`](file:///home/khoa/Code/Personal%20Project/Knit/src-tauri/src/lib.rs) và wrapper `checkMissingFiles` trong [`src/lib/ipc.ts`](file:///home/khoa/Code/Personal%20Project/Knit/src/lib/ipc.ts).
  - Trước khi mở dialog lưu hoặc bắt đầu export trong [`src/views/Image2PdfView.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/Image2PdfView.tsx), kiểm tra danh sách đường dẫn unique qua `checkMissingFiles`; nếu có ảnh thiếu trên đĩa:
    - Chặn export và hiển thị lỗi rõ danh sách tên tệp không tìm thấy qua `ErrorBanner`.
    - Highlight viền `#FFC107` và gắn badge cảnh báo `Thiếu tệp` / `Missing file` trên các card tương ứng trong [`src/views/image2pdf/ImagePageCard.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/image2pdf/ImagePageCard.tsx).

---

## 9. Image2Pdf: Kéo thả sắp xếp nhiều ảnh đã chọn trong Select Mode

- **Vấn đề trước đó:** Khi bật `Select mode`, thao tác kéo thả sắp xếp bị vô hiệu hóa hoàn toàn.
- **Thay đổi đã áp dụng:**
  - Thêm hàm thuần `reorderSelectedPages` trong [`src/lib/imageSort.ts`](file:///home/khoa/Code/Personal%20Project/Knit/src/lib/imageSort.ts): giữ nguyên thứ tự tương đối của các ảnh được chọn và chèn chúng thành một khối liền kề tại vị trí thả (ngay cả khi các ảnh được chọn ban đầu nằm rời rạc không liền kề).
  - Cập nhật `handleCardPointerDown` trong [`src/views/Image2PdfView.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/Image2PdfView.tsx): click nhanh (`< 5px`) vẫn bật/tắt chọn card như cũ; kéo đi (`>= 5px`) khi nắm vào một ảnh đã chọn (trong nhóm `> 1` ảnh) sẽ kéo cả nhóm, làm mờ toàn bộ các thẻ trong nhóm, hiển thị ghost kèm số lượng trang và lưu Undo snapshot khi thả.

---

## 10. Tổng hợp tệp đã chỉnh sửa / tạo mới (Review 1.15)

- **Rust Backend:**
  - [`crates/knit-core/src/error.rs`](file:///home/khoa/Code/Personal%20Project/Knit/crates/knit-core/src/error.rs)
  - [`crates/knit-archive/src/lib.rs`](file:///home/khoa/Code/Personal%20Project/Knit/crates/knit-archive/src/lib.rs)
  - [`crates/knit-docs/src/lib.rs`](file:///home/khoa/Code/Personal%20Project/Knit/crates/knit-docs/src/lib.rs), [`crates/knit-docs/src/html_epub.rs`](file:///home/khoa/Code/Personal%20Project/Knit/crates/knit-docs/src/html_epub.rs), [`crates/knit-docs/src/office.rs`](file:///home/khoa/Code/Personal%20Project/Knit/crates/knit-docs/src/office.rs), [`crates/knit-docs/tests/docs_tests.rs`](file:///home/khoa/Code/Personal%20Project/Knit/crates/knit-docs/tests/docs_tests.rs)
  - [`crates/knit-manga/src/packer.rs`](file:///home/khoa/Code/Personal%20Project/Knit/crates/knit-manga/src/packer.rs), [`crates/knit-manga/src/scanner.rs`](file:///home/khoa/Code/Personal%20Project/Knit/crates/knit-manga/src/scanner.rs)
  - [`crates/knit-pdf/src/imaging.rs`](file:///home/khoa/Code/Personal%20Project/Knit/crates/knit-pdf/src/imaging.rs), [`crates/knit-pdf/src/ops.rs`](file:///home/khoa/Code/Personal%20Project/Knit/crates/knit-pdf/src/ops.rs), [`crates/knit-pdf/src/packer.rs`](file:///home/khoa/Code/Personal%20Project/Knit/crates/knit-pdf/src/packer.rs)
  - [`crates/knit-renamer/src/renamer.rs`](file:///home/khoa/Code/Personal%20Project/Knit/crates/knit-renamer/src/renamer.rs)
  - [`src-tauri/src/lib.rs`](file:///home/khoa/Code/Personal%20Project/Knit/src-tauri/src/lib.rs)
- **Frontend:**
  - [`src/components/ZoomPanViewport.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/components/ZoomPanViewport.tsx)
  - [`src/components/PdfPageZoomModal.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/components/PdfPageZoomModal.tsx), [`src/components/PdfJsPreview.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/components/PdfJsPreview.tsx), [`src/components/PdfPageCards.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/components/PdfPageCards.tsx)
  - [`src/views/image2pdf/ImagePreviewModal.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/image2pdf/ImagePreviewModal.tsx), [`src/views/image2pdf/ImagePageCard.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/image2pdf/ImagePageCard.tsx), [`src/views/Image2PdfView.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/Image2PdfView.tsx)
  - [`src/views/pdf-ops/pdfOpsTypes.ts`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/pdf-ops/pdfOpsTypes.ts), [`src/views/pdf-ops/PdfPageContextMenu.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/pdf-ops/PdfPageContextMenu.tsx), [`src/views/pdf-ops/SplitSectionCard.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/pdf-ops/SplitSectionCard.tsx), [`src/views/pdf-ops/PdfSplitPane.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/pdf-ops/PdfSplitPane.tsx), [`src/views/pdf-ops/PdfMergePane.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/pdf-ops/PdfMergePane.tsx), [`src/views/PdfOpsView.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/PdfOpsView.tsx)
  - [`src/views/docs2pdf/Docs2PdfSettingsCard.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/docs2pdf/Docs2PdfSettingsCard.tsx), [`src/views/docs2pdf/DocsSplitWorkbench.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/docs2pdf/DocsSplitWorkbench.tsx), [`src/views/Docs2PdfView.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/Docs2PdfView.tsx)
  - [`src/views/ArchiveView.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/ArchiveView.tsx), [`src/views/MangaPackView.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/MangaPackView.tsx)
  - [`src/lib/imageSort.ts`](file:///home/khoa/Code/Personal%20Project/Knit/src/lib/imageSort.ts), [`src/lib/ipc.ts`](file:///home/khoa/Code/Personal%20Project/Knit/src/lib/ipc.ts), [`src/i18n/{types,vi,en}.ts`](file:///home/khoa/Code/Personal%20Project/Knit/src/i18n/types.ts)
  - [`src/components/Review115Components.test.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/components/Review115Components.test.tsx) (7 unit tests cho bản 1.15)

---

## 11. Kết quả kiểm thử (sau lần chỉnh sửa cuối cùng)

Lệnh đã chạy: `cargo test --workspace && cargo check -p knit-desktop && pnpm build && pnpm test`

| Hạng mục kiểm tra | Lệnh thực thi | Kết quả | Ghi chú |
|---|---|---|---|
| Rust Core Crates Test | `cargo test --workspace` | **50 passed, 0 failed** | `knit-archive` (5), `knit-core` (7), `knit-docs` (13), `knit-manga` (5), `knit-pdf` (14), `knit-renamer` (6) |
| Tauri Desktop Crate Check | `cargo check -p knit-desktop` | **Pass (exit 0)** | Bao gồm IPC command mới `check_missing_files` |
| Frontend TypeCheck & Build | `pnpm build` | **Pass (exit 0)** | `tsc --noEmit` & `vite build` thành công |
| Frontend Vitest Suite | `pnpm test` | **20 files passed, 69 tests passed** | Bao gồm 7 unit tests mới trong `Review115Components.test.tsx` |

### Phạm vi kiểm thử thực tế chưa tự động hóa hoàn toàn trong CLI:
- Thao tác kéo thả nhiều thẻ ảnh thực tế trên WebView desktop và kiểm tra `check_missing_files` với file bị xóa trực tiếp trên hệ thống tệp qua runtime Tauri thật.
- Double-click trang trên `PdfJsPreview` với tài liệu Markdown render thật trong cửa sổ Tauri desktop để kiểm tra trực quan `ZoomPanViewport` ở độ phân giải cao.
