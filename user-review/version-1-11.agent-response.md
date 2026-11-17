# Báo cáo thay đổi — Review v1.11

Tài liệu này tổng hợp toàn bộ 13 hạng mục đã cập nhật theo [`user-review/version-1-11.md`](./version-1-11.md), nguyên nhân gốc rễ, lý do thiết kế kỹ thuật và kết quả kiểm thử sau khi hoàn tất.

---

## 1. Bố cục đóng/mở Bookmark của Image → PDF (`Image2PdfView`)
- **Vấn đề trước đây**: Trong [`src/views/Image2PdfView.tsx`](../src/views/Image2PdfView.tsx), thanh công cụ chứa nút *Show/Hide bookmarks* nằm bên trong cột lưới (`lg:col-span-2`), nên khi bật cây Bookmark, khung Bookmark đẩy cả thanh công cụ và nút bấm sang trái.
- **Thay đổi**: Đưa thanh công cụ (*Grid Density, Auto Sort, Undo & Bookmark Toggle*) ra phía trên khối `grid lg:grid-cols-3`, thống nhất bố cục với `PdfOpsView`.
- **Lý do**: Giữ nút bật/tắt Bookmark cố định ở góc trên bên phải toàn trang; khi mở Bookmark chỉ phần lưới ảnh bên dưới thu hẹp sang `lg:col-span-2`.

## 2. Bổ sung tùy chọn 8 pages (images) / row
- **Thay đổi**:
  - Cập nhật `GRID_COL_OPTIONS` thành `[2, 3, 4, 5, 6, 8]` trong [`src/views/Image2PdfView.tsx`](../src/views/Image2PdfView.tsx) và [`src/views/PdfOpsView.tsx`](../src/views/PdfOpsView.tsx).
  - Dùng `style={{ gridTemplateColumns: \`repeat(${cols}, minmax(0, 1fr))\` }}` cho lưới Merge để luôn chia đúng số cột được chọn (bao gồm `8`) thay vì phụ thuộc lớp CSS tĩnh.

## 3. Đưa khung Output Filename của PDF Merge & Split lên trên cùng
- **Thay đổi**: Di chuyển `ExportFilenameControl` lên ngay bên dưới thanh chuyển chế độ `Merge / Reorder` ↔ `Split PDF` trong [`src/views/PdfOpsView.tsx`](../src/views/PdfOpsView.tsx), bổ sung prop `label?: string` trong [`src/components/ExportFilenameControl.tsx`](../src/components/ExportFilenameControl.tsx).
  - Ở tab **Merge**: chỉnh tên tệp PDF đầu ra (mặc định `merged.pdf`, cảnh báo trùng tệp trực tiếp).
  - Ở tab **Split**: chỉnh tiền tố tên tệp đầu ra (*Output filename prefix*, để trống sẽ giữ tên tệp PDF nguồn).
- **Lý do**: Đồng bộ vị trí cấu hình tên tệp xuất giữa `Image2Pdf` và `PDF Merge & Split`.

## 4. Hiển thị loading trong khung Dropzone khi import nhiều tệp PDF
- **Thay đổi**: Thêm state `importingPdfs` và `importProgress` (`done / total`) trong `addPdfPaths` của [`src/views/PdfOpsView.tsx`](../src/views/PdfOpsView.tsx), truyền `loading` và `loadingLabel` vào `<Dropzone />` tương tự [`src/views/MangaPackView.tsx`](../src/views/MangaPackView.tsx).
- **Lý do**: Phản hồi rõ tiến độ khi `inspectPdfFile` đọc nhiều PDF nặng liên tiếp, đồng thời khóa bấm chọn trùng trong lúc đang quét.

## 5. Khắc phục lỗi chiều cao từng trang bị co còn vài pixel với PDF > 300 trang (Split Source)
- **Nguyên nhân**: Khung `Source PDF Pages` trước đây đặt `height` cố định + `overflow-y-auto` trên phần tử CSS Grid không có `auto-rows-max` và thiếu `shrink-0` trên khung ảnh `h-24`, khiến WebKitGTK nén các hàng flex con xuống vừa chiều cao container khi có 100+ hàng (`~540px / 100 ≈ vài pixel`), đồng thời dựng toàn bộ >300 node DOM cùng lúc.
- **Thay đổi**:
  - Thêm `shrink-0` cho khung preview của `MergePageCard`, `SplitSourceCard`, `SplitSectionItemCard` trong [`src/components/PdfPageCards.tsx`](../src/components/PdfPageCards.tsx).
  - Thêm `auto-rows-max` và **ảo hóa (virtualize)** hoàn toàn lưới `Source PDF Pages` bằng `computeVisibleRowRange` + `ResizeObserver` tương tự `Image2PdfView`.

## 6. Bổ sung chọn `Pages / row` cho Source PDF Pages (Split PDF)
- **Thay đổi**: Thêm persistent state `splitSourceCols` (mặc định `3`) cùng dải nút `[2, 3, 4, 5, 6, 8]` trong tiêu đề khung `Source PDF Pages` của [`src/views/PdfOpsView.tsx`](../src/views/PdfOpsView.tsx).

## 7. Nâng cấp Output PDF Sections: kéo thả chuẩn Image2PDF & double-click xem trang lớn
- **Thay đổi**:
  - Cập nhật `startSplitPointerDrag` trong [`src/views/PdfOpsView.tsx`](../src/views/PdfOpsView.tsx) sử dụng `hitTestGridInsertIndex` (tính vị trí chèn $O(1)$ từ geometry đã cache, không gây reflow trong `rAF`), hiển thị **vạch xanh chèn vị trí** (`showBarLeft` / `showBarEnd`) trên [`SplitSectionItemCard`](../src/components/PdfPageCards.tsx), **ghost thumbnail card** (`translate3d`), làm mờ card đang kéo (`opacity-40`), và tự động cuộn mượt khi kéo sát mép container.
  - Bổ sung `onDoubleClickItem` trên `SplitSectionItemCard` để nháy đúp vào trang bất kỳ trong `Output PDF Sections` sẽ mở `PdfPageZoomModal` (kèm góc xoay hiện tại).

## 8. Đồng bộ giao diện thanh kéo chỉnh chiều rộng giữa 2 khung Split
- **Thay đổi**: Cập nhật vertical splitter (`handleSplitWidthResize`) trong [`src/views/PdfOpsView.tsx`](../src/views/PdfOpsView.tsx) sang thanh đầy đủ chiều cao (`self-stretch min-h-[280px] border border-[#DEE2E6] bg-[#F8F9FA]` + icon `GripVertical`, hover xanh `#E7F1FF`), đồng nhất trực quan với các thanh resize chiều cao (`GripHorizontal`).

## 9. Bổ sung resize chiều cao cho từng section trong Output PDF Sections
- **Thay đổi**:
  - Mỗi section mặc định tự co giãn theo nội dung tới `max-h-[280px]` (có cuộn nội bộ khi nhiều trang).
  - Bổ sung thanh kéo `GripHorizontal` ở đáy mỗi section (`handleSectionCardHeightResize`, giới hạn `120px–720px`, lưu persistent state theo `section.id` trong `knit.pdfops.sectionHeightsPx`).

## 10. Hỗ trợ chọn nhiều tệp PDF trong chế độ Split PDF
- **Thay đổi Backend (Rust)**:
  - Thêm `split_multi_pdf` vào [`crates/knit-pdf/src/ops.rs`](../crates/knit-pdf/src/ops.rs) và export tại [`crates/knit-pdf/src/lib.rs`](../crates/knit-pdf/src/lib.rs): hỗ trợ cả `CustomGroups` gộp/tách chéo trang từ nhiều `file_index` thông qua `merge_pdfs` (bảo toàn xoay trang & Outlines) lẫn chạy tách hàng loạt theo quy tắc (`EveryNPages`, `PageRanges`, `MaxBytes`) cho từng tệp.
  - Đăng ký IPC `pdf_split_multi` tại [`src-tauri/src/lib.rs`](../src-tauri/src/lib.rs) và wrapper `splitMultiPdfFiles` tại [`src/lib/ipc.ts`](../src/lib/ipc.ts).
- **Thay đổi Frontend**:
  - Cho phép `pickFiles({ multiple: true })` và nạp nối tiếp nhiều PDF ở cả hai tab; cập nhật `SplitSectionItem` mang `file_index`.
  - Bổ sung thanh lọc tệp trong `Source PDF Pages` (*Tất cả tệp* hoặc lọc từng tệp `F1`, `F2`...) kèm nhãn `F{x}·P{y}` khi có >1 PDF.
  - Cập nhật `computeExpectedSplitPaths`, `confirmRemoveImportedFile` và `handleSplit` kiểm tra xung đột đầu ra trên toàn bộ các tệp được tách.

## 11. Sửa toast thông báo của Batch Rename từ "Export thành công" sang "Đổi tên thành công"
- **Nguyên nhân**: [`src/components/ExportSuccessToast.tsx`](../src/components/ExportSuccessToast.tsx) luôn ghép cứng `{t.common.exportSuccessTitle}: {result.title}`.
- **Thay đổi**: Thêm `heading?: string` vào `CompletedExportInfo` (`ExportSuccessToast.tsx`), `handleFinishJob` trong [`src/App.tsx`](../src/App.tsx), và truyền `t.renamer.renameSuccessTitle` (*"Đổi tên thành công"* / *"Rename Complete"*) / `t.renamer.undoSuccessTitle` (*"Hoàn tác đổi tên thành công"*) từ [`src/views/RenamerView.tsx`](../src/views/RenamerView.tsx). Bổ sung khóa dịch tại [`src/i18n/types.ts`](../src/i18n/types.ts), [`src/i18n/vi.ts`](../src/i18n/vi.ts), [`src/i18n/en.ts`](../src/i18n/en.ts).

## 12. Ngăn double-click nút xoay (Rotate) mở nhầm modal phóng to
- **Nguyên nhân**: Sự kiện `dblclick` từ thẻ `<button>` (Xoay / Xóa / Sửa / Thêm nhanh) nổi bọt (*bubble*) lên thẻ cha có `onDoubleClick`.
- **Thay đổi**: Kiểm tra `if ((e.target as HTMLElement).closest("button")) return;` trong handler `onDoubleClick` của `PageCard` ([`src/views/Image2PdfView.tsx`](../src/views/Image2PdfView.tsx)) và `MergePageCard`, `SplitSourceCard`, `SplitSectionItemCard` ([`src/components/PdfPageCards.tsx`](../src/components/PdfPageCards.tsx)), đồng thời thêm `onDoubleClick={(e) => e.stopPropagation()}` trên các nút hành động.

## 13. Sửa lỗi PDF Merge & Split ngừng tải thumbnail khi cuộn xuống các trang dưới
- **Nguyên nhân**:
  1. `IntersectionObserver` trước đây khởi tạo với `root: null` (viewport cửa sổ) thay vì khung cuộn thực tế (đặc biệt khung `splitSourceScrollRef` có `overflow-y: auto` riêng), khiến trình duyệt WebKitGTK bỏ sót callback `isIntersecting` khi cuộn bên trong hoặc khi vừa chuyển tab từ `hidden`.
  2. `addPdfPaths` ban đầu chỉ enqueue 48 trang đầu (`INITIAL_THUMB_LIMIT = 48`).
- **Thay đổi**:
  - Loại bỏ phụ thuộc `IntersectionObserver` `root: null` dễ hụt trong WebKitGTK; thay bằng **enqueue xác định theo cửa sổ hiển thị** (`enqueueThumbWindow`) trực tiếp bên trong `updateMergeVisibleRange` và `updateSplitSourceVisibleRange` (có `overscanRows: 3`, nạp ưu tiên LIFO từ hàng trên xuống dưới).
  - Nạp bổ sung toàn bộ trang đang nằm trong `Output PDF Sections` (`sectionThumbKeysRef`), bỏ qua các mục đã cuộn khuất khỏi hàng đợi khi cuộn nhanh, và tăng ngưỡng LRU `mergeThumbCacheLru` lên `500` mục có bảo vệ đầy đủ các trang đang hiển thị (`visibleThumbKeysRef` + `sectionThumbKeysRef`).

---

## Kết quả kiểm thử sau chỉnh sửa cuối cùng

| Lệnh kiểm tra | Phạm vi | Kết quả |
| --- | --- | --- |
| `cargo check -p knit-desktop` | Kiểm tra biên dịch toàn bộ workspace & Tauri crate | **Pass** (exit `0`, 0 warnings) |
| `cargo test` | Toàn bộ Rust tests (`knit-archive`: 4, `knit-core`: 7, `knit-docs`: 11, `knit-manga`: 4, `knit-pdf`: 11 gồm test mới `split_multi_pdf_handles_cross_file_custom_groups_and_batch_rules`, `knit-renamer`: 6) | **43 / 43 passed** |
| `pnpm build` (`tsc --noEmit && vite build`) | Kiểm tra TypeScript strict & đóng gói Vite production | **Pass** (exit `0`) |
| `pnpm test` (`vitest run`) | Toàn bộ 10 file test frontend (gồm test mới trong `App.test.tsx` cho toast Rename và `PdfPageCards.test.tsx` cho double-click button guard / multi-file Split cards) | **10 / 10 files · 29 / 29 tests passed** |
