# Báo cáo phản hồi & thay đổi — Review Version 1.20

Tài liệu này tổng hợp các thay đổi đã áp dụng cho toàn bộ các đầu mục trong [`user-review/version-1-20.md`](./version-1-20.md), giải thích nguyên nhân kỹ thuật đằng sau mỗi thay đổi, lý do lựa chọn phương án triển khai và kết quả kiểm thử sau lần chỉnh sửa cuối cùng.

---

## 1. Bổ sung Preset Bookmark cho Merge PDF, Split PDF và Image → PDF (Item 1)

- **Vấn đề trước đó:** Khi tạo hoặc dựng lại cây mục lục trong `Merge PDF`, `Split PDF` và `Image → PDF`, người dùng phải tạo hoặc sắp xếp thủ công các bookmark tổng theo file/thư mục; riêng `Split PDF` khi xuất các section chưa hỗ trợ chọn preset bookmark (ví dụ lấy tên section làm bookmark gốc hoặc tắt bookmark).
- **Nguyên nhân kỹ thuật:**
  - `BookmarkTreeEditor` chưa có prop nhận danh sách preset tùy chọn theo ngữ cảnh từng tool.
  - Ở `Split PDF`, `PdfSplitGroup` (cả trong `crates/knit-pdf/src/models.rs` lẫn `src/types/ipc.ts`) chỉ chứa `name` và `pages`, khiến `split_pdf` / `split_multi_pdf` luôn mặc định remap bookmark gốc mà không thể ghi đè theo từng section.
- **Thay đổi đã áp dụng:**
  - **Rust Core & IPC (`crates/knit-pdf/src/models.rs`, `crates/knit-pdf/src/ops.rs`, `src/types/ipc.ts`):** Bổ sung `preserve_bookmarks: Option<bool>` và `custom_bookmarks: Option<Vec<BookmarkNode>>` (`#[serde(default)]`) vào `PdfSplitGroup`; cập nhật cả `split_pdf` và `split_multi_pdf` nhánh `PdfSplitRule::CustomGroups` áp dụng cấu hình bookmark từng section.
  - **Helpers (`src/lib/bookmarks.ts`):** Bổ sung `buildMergeBookmarkPreset` với 3 preset (`file_parent_with_children`: mỗi file làm 1 bookmark cha + giữ bookmark con đã remap; `file_only`: mỗi file 1 bookmark gốc; `flat_original`: gộp phẳng bookmark gốc) và `buildImageBookmarkPreset` (`by_parent_folder`, `per_page`, `clear`).
  - **UI (`src/components/BookmarkTreeEditor.tsx`, `src/views/pdf-ops/PdfMergePane.tsx`, `src/views/pdf-ops/PdfSplitPane.tsx`, `src/views/PdfOpsView.tsx`, `src/views/Image2PdfView.tsx`):** Gắn selector `Preset` ngay trên header `BookmarkTreeEditor` (có lưu undo snapshot để `Ctrl+Z` khôi phục được) và bộ chọn `Preset mục lục khi tách` trên `PdfSplitPane`.
- **Lý do chọn cách làm này:** Đặt logic tạo preset dưới dạng pure function ở `src/lib/bookmarks.ts` và truyền qua prop `presets` giúp `BookmarkTreeEditor` tái sử dụng sạch cho cả `Image → PDF` lẫn `Merge PDF`, đồng thời giữ tương thích ngược 100% cho `PdfSplitGroup` bằng `#[serde(default)]`.

---

## 2. Sửa lỗi chuột phải "Xem preview" ở chế độ theo file PDF trong Merge PDF (Item 2)

- **Vấn đề trước đó:** Trong `Merge PDF` ở chế độ `Theo từng tệp PDF` (`per_file`), double-click vào thẻ file mở đúng cửa sổ preview toàn bộ file PDF (`PdfFilePreviewModal`), nhưng click chuột phải chọn phóng to/xem chi tiết lại mở cửa sổ ảnh trang đầu (`PdfPageZoomModal`).
- **Nguyên nhân kỹ thuật:** Trong `src/views/PdfOpsView.tsx`, `handleContextMenuMergeFile` đã tái sử dụng `mode: "split"` trên `PdfContextMenuTarget` (`src/views/pdf-ops/PdfPageContextMenu.tsx`), nên `PdfPageContextMenu` gọi `onZoom(filePath, 0, 0)` thay vì callback mở `PdfFilePreviewModal`.
- **Thay đổi đã áp dụng:**
  - Thêm biến thể `mode: "merge_file"` vào `PdfContextMenuTarget` và prop `onPreviewFile?: (fileIndex: number) => void` trong `src/views/pdf-ops/PdfPageContextMenu.tsx`.
  - Cập nhật `handleContextMenuMergeFile` trong `src/views/PdfOpsView.tsx` phát ra `mode: "merge_file"` với `fileIndex`, `fileOrderIdx`, `targetPageIdx`, `hasBookmark`; nối `onPreviewFile` mở `setPreviewFileTarget(src)` (`PdfFilePreviewModal`).
- **Lý do chọn cách làm này:** Tách riêng `mode: "merge_file"` thay vì nhét thêm cờ vào `"split"` giúp type-safe rõ ràng cho cả hành động preview file lẫn gắn/xóa bookmark ở chế độ `per_file` (Item 6).

---

## 3. Dòng 3 trong `version-1-20.md` (Item 3)

- **Trạng thái:** Người dùng xác nhận trong Bước 1 (Intake & Clarify) rằng dòng 3 bị gõ sót/quên xóa, các ý cần làm đã nằm ở các mục 4, 5, 8 bên dưới — không phát sinh thay đổi riêng.

---

## 4. Chặn cuộn xuyên ra trang ngoài khi đang hover vùng cuộn nội bộ (Item 4)

- **Vấn đề trước đó:** Khi cuộn chuột trong các vùng có thanh cuộn riêng (như `BookmarkTreeEditor` hoặc các pane chia trang) tới đầu hoặc cuối danh sách, việc tiếp tục lăn chuột làm cuộn luôn cả trang `<main>` bên ngoài.
- **Nguyên nhân kỹ thuật:** Các container `overflow-y-auto` thiếu thuộc tính `overscroll-behavior: contain` (`overscroll-contain`), và trên một số môi trường WebKitGTK/Linux, thao tác lăn chuột ở biên cuộn vẫn lan sự kiện `wheel` lên container cha `<main>` nếu không chặn lan truyền ở biên.
- **Thay đổi đã áp dụng:**
  - Bổ sung class `overscroll-contain` cho toàn bộ các vùng cuộn nội bộ (`BookmarkTreeEditor`, `ArchiveTreeEditor`, `PdfSplitPane` source & sections, `SplitSectionCard`, `MangaPackView`, `RenamerPreviewTable`, `WorkbenchShell` `<nav>` & logs drawer, `Select`, `ExportSuccessToast`, `ExportConflictModal`, và danh sách cảnh báo trong `Image2PdfView`).
  - Trong `src/components/WorkbenchShell.tsx`, gắn một listener `wheel` (`{ passive: false }`) duy nhất trên `<main ref={mainRef}>`: tìm tổ tiên gần nhất có khả năng cuộn thực tế (`scrollHeight > clientHeight + 1`); nếu đang ở đỉnh (`scrollTop <= 0 && deltaY < 0`) hoặc ở đáy (`scrollTop + clientHeight >= scrollHeight - 1 && deltaY > 0`), gọi `e.preventDefault()` để không trôi sang `<main>` hoặc các container cha ngoài vùng đang hover.
- **Lý do chọn cách làm này:** Kết hợp CSS `overscroll-contain` với một listener `{ passive: false }` tập trung tại `<main>` đảm bảo hoạt động đồng nhất trên cả WebView2 (Windows) và WebKitGTK (Linux), tránh lỗi warning passive listener và không phải gắn nhiều listener rời rạc cho từng component.

---

## 5. Nâng cấp `BookmarkTreeEditor`: `Ctrl+C`/`X`/`V`, Double-click sửa tên, Kéo thả trên Title, Đường phân cấp (Item 5)

- **Vấn đề trước đó:**
  - Ô tiêu đề của từng mục mặc định luôn hiển thị là `<input>`, gây rối thị giác và chiếm chỗ tương tác kéo-thả.
  - Chỉ kéo-thả được khi hover đúng biểu tượng lưới `GripVertical` ở đầu dòng.
  - Chưa có phím tắt `Ctrl+C`, `Ctrl+X`, `Ctrl+V` để sao chép/cắt/dán nhanh các nhánh bookmark.
  - Phân cấp cây chỉ dịch lề trái (`marginLeft`), chưa có đường nối dọc/ngang trực quan giữa cha và con.
- **Nguyên nhân kỹ thuật:** `BookmarkRow` render `<input>` trực tiếp, `handleRowPointerDown` không kích hoạt drag khi kéo trên vùng tiêu đề, `flattenVisibleBookmarks` chưa tính thông tin anh em kế tiếp ở từng cấp cha, và `BookmarkTreeEditor` chưa có bộ đệm clipboard nội bộ + focus key.
- **Thay đổi đã áp dụng:**
  - **Title dạng text & Double-click edit (`src/components/BookmarkTreeEditor.tsx`):** Mặc định hiển thị `<span data-bookmark-title="true">`. Khi double-click (khi không bị `disabled` hoặc không ở chế độ chọn nhiều) mới mở `<input autoFocus>`; nhấn `Enter` hoặc blur để lưu (kèm snapshot undo), nhấn `Escape` để hủy (cập nhật `editingPathKeyRef.current = null` đồng bộ trước khi `focus()` container để tránh `onBlur` commit nhầm giá trị tạm).
  - **Kéo-thả trực tiếp trên Title:** Cập nhật `handleRowPointerDown` để khi giữ chuột và di chuyển `>= 5px` trên `[data-bookmark-title]` thì bắt đầu kéo-thả sắp xếp vị trí ngay; nếu giữ yên `>= 400ms` không di chuyển vẫn kích hoạt Selection Mode như cũ; và vẫn giữ quy tắc chỉ thả vào biểu tượng `GripVertical` của dòng đích mới lồng làm mục con (`inside`).
  - **Phím tắt `Ctrl+C` / `Ctrl+X` / `Ctrl+V` (`src/lib/bookmarks.ts` & `src/components/BookmarkTreeEditor.tsx`):** Hỗ trợ sao chép/cắt 1 mục đang focus hoặc nhiều mục đang chọn (kèm nhánh con via `collectBookmarkNodesAtPaths`) và dán ngay sau mục đang chọn (hoặc đầu/cuối cây theo cấu hình via `insertBookmarkNodesAt`); tự bỏ qua khi con trỏ đang nằm trong `<input>`/`<textarea>` để giữ nguyên copy/paste văn bản gốc.
  - **Đường nối phân cấp cây (`src/lib/bookmarks.ts` & `BookmarkRow`):** Mở rộng `FlattenedBookmarkRow` thêm `isLastSibling` và `ancestorHasNextSibling` để vẽ đường kẻ dọc mảnh (`1px #CED4DA`) và nhánh chữ L/T ở mọi cấp lồng nhau, tương thích hoàn toàn với danh sách ảo hóa (virtualization).
- **Lý do chọn cách làm này:** Tính sẵn `ancestorHasNextSibling` trong `flattenVisibleBookmarks` giữ cho mỗi `BookmarkRow` ảo hóa tự vẽ đúng đường phân cấp ở bất kỳ vị trí cuộn nào với độ phức tạp $O(N)$ một lần duyệt, không cần đo DOM.

---

## 6. Nút Remove Bookmark trong menu chuột phải & Gắn/Xóa bookmark trang đầu ở `per_file` mode (Item 6)

- **Vấn đề trước đó:** Khi click chuột phải vào ảnh (`Image → PDF`) hoặc trang PDF (`Merge PDF`) đã có bookmark, menu chỉ có nút gắn mới mà chưa có nút xóa bookmark; đồng thời ở chế độ `Theo từng tệp PDF` (`per_file`), menu chuột phải không có tùy chọn gắn bookmark cho trang đầu của tệp.
- **Nguyên nhân kỹ thuật:** `ImageContextMenu` và `PdfPageContextMenu` chưa nhận trạng thái `hasBookmark` và callback xóa theo trang; `handleContextMenuMergeFile` dùng `mode: "split"` nên bị ẩn hoàn toàn các hành động bookmark.
- **Thay đổi đã áp dụng:**
  - Thêm `removeBookmarksAtPage` vào `src/lib/bookmarks.ts` (xóa các bookmark trỏ vào `target_page_index` và đôn các bookmark con không thuộc trang đó lên cùng cấp để tránh mất nhầm mục lục con).
  - Bổ sung `hasBookmark` và `onRemoveBookmark` vào `ImageContextMenu.tsx` (kết nối tại `Image2PdfView.tsx` dựa trên `pageBookmarkMap.has(...)`) và `PdfPageContextMenu.tsx` (kết nối cho cả `mode: "merge"` và `mode: "merge_file"` tại `PdfOpsView.tsx`).
- **Lý do chọn cách làm này:** Chỉ hiển thị nút *Xóa bookmark* khi trang thực sự có bookmark giúp menu gọn gàng, không làm rối thao tác trên trang thường, và dùng `removeBookmarksAtPage` đảm bảo an toàn cho bookmark con.

---

## 7. Bổ sung Undo cho khung lưới Page/File trong Merge PDF (Item 7)

- **Vấn đề trước đó:** Công cụ `Image → PDF` đã có nút Hoàn tác / `Ctrl+Z` cho thao tác lưới ảnh, nhưng `Merge PDF` trong `PdfOpsView` chưa có cơ chế Undo khi người dùng xoay, xóa, kéo-thả sắp xếp trang/file hoặc xóa file nguồn.
- **Nguyên nhân kỹ thuật:** `PdfOpsView.tsx` chưa duy trì stack snapshot cho trạng thái Merge (`files`, `mergeFileOrder`, `selections`, `mergeBookmarks`, `mergeMode`).
- **Thay đổi đã áp dụng:**
  - Thêm `mergeUndoStackRef` (tối đa 50 snapshot) và `handleMergeUndo` trong `src/views/PdfOpsView.tsx`, tự động ghi snapshot trước khi sắp xếp trang/file, xoay trang, xóa trang, xóa file, hoặc reset khi chuyển sang `per_file` mode, và dọn stack khi `Clear All`.
  - Hiển thị nút `Hoàn tác` (`data-testid="merge-undo-btn"`) trên thanh công cụ `PdfMergePane.tsx`, đồng thời gắn phím tắt `Ctrl+Z` trên tab Merge (bỏ qua khi focus đang nằm trong `<input>`/`<textarea>` hoặc bên trong `[data-bookmark-editor="true"]` để tránh xung đột với `Ctrl+Z` cục bộ của cây bookmark).
- **Lý do chọn cách làm này:** Lưu snapshot đồng bộ cả danh sách trang/file lẫn `mergeBookmarks` giúp hoàn tác nhất quán nếu thao tác xóa file/trang có làm thay đổi bookmark, đồng thời tách ranh giới `Ctrl+Z` rõ ràng giữa lưới Merge và `BookmarkTreeEditor`.

---

## 8. Cấu hình thêm Bookmark mới ở Đầu cây hoặc Cuối cây (Item 8)

- **Vấn đề trước đó:** Khi bấm `+ Thêm mục chính` trong `BookmarkTreeEditor`, mục mới luôn bị nối vào cuối cây, bất tiện khi người dùng cần thêm mục mở đầu (như Bìa/Mục lục) cho danh sách dài.
- **Nguyên nhân kỹ thuật:** Hàm `addRootBookmark` trong `BookmarkTreeEditor.tsx` hardcode `[...nodes, newNode]`.
- **Thay đổi đã áp dụng:**
  - Lưu tùy chọn `insertPosition` (`"start" | "end"`, mặc định `"end"`) qua `usePersistentState("knit.bookmarks.insertPosition", "end")` trong `BookmarkTreeEditor.tsx`.
  - Thêm cặp nút chuyển nhanh `Đầu cây` / `Cuối cây` ngay trên header của `BookmarkTreeEditor`, áp dụng cho cả nút `+ Thêm mục chính` lẫn thao tác dán `Ctrl+V` khi chưa chọn node đích.
- **Lý do chọn cách làm này:** Đặt toggle ngay trên header của `BookmarkTreeEditor` giúp người dùng chuyển đổi tức thì tại chỗ mà không phải rời khỏi màn hình đang làm việc, đồng thời ghi nhớ lựa chọn giữa các phiên.

---

## 9. Tổng hợp tệp đã chỉnh sửa / tạo mới

- **Backend Rust:**
  - `crates/knit-pdf/src/models.rs` (thêm `preserve_bookmarks` và `custom_bookmarks` tùy chọn trên `PdfSplitGroup`)
  - `crates/knit-pdf/src/ops.rs` (áp dụng bookmark override trong `split_pdf` và `split_multi_pdf` nhánh `CustomGroups`)
  - `crates/knit-pdf/tests/pdf_tests.rs` (cập nhật literal và bổ sung test `split_custom_groups_supports_custom_and_disabled_bookmarks`)
- **Frontend & Helpers:**
  - `src/types/ipc.ts` (đồng bộ interface `PdfSplitGroup`)
  - `src/lib/bookmarks.ts` & `src/lib/bookmarks.test.ts` (presets Merge & Image2PDF, `collectBookmarkNodesAtPaths`, `insertBookmarkNodesAt`, `removeBookmarksAtPage`, metadata đường phân cấp trên `FlattenedBookmarkRow`, và unit tests)
  - `src/components/BookmarkTreeEditor.tsx` (double-click edit title, kéo-thả trên title, `Ctrl+C`/`X`/`V`, đường nối phân cấp, preset selector, toggle Đầu/Cuối cây, `overscroll-contain`)
  - `src/components/WorkbenchShell.tsx` (cơ chế chặn wheel scroll chaining qua biên container cuộn nội bộ + `overscroll-contain`)
  - `src/components/{ArchiveTreeEditor,ExportConflictModal,ExportSuccessToast,Select}.tsx`, `src/views/{Image2PdfView,MangaPackView}.tsx`, `src/views/pdf-ops/{PdfSplitPane,SplitSectionCard}.tsx`, `src/views/renamer/RenamerPreviewTable.tsx` (`overscroll-contain`)
  - `src/views/image2pdf/ImageContextMenu.tsx` & `src/views/Image2PdfView.tsx` (nút Remove bookmark & Image2PDF bookmark presets)
  - `src/views/pdf-ops/{PdfPageContextMenu,PdfMergePane,PdfSplitPane}.tsx` & `src/views/PdfOpsView.tsx` (`mode: "merge_file"` preview file PDF & gắn/xóa bookmark, Merge Undo stack & `Ctrl+Z`, Merge & Split bookmark presets)
  - `src/i18n/{types,vi,en}.ts` (bổ sung đầy đủ khóa dịch song ngữ Việt - Anh)
  - `src/components/{Review114Components,Review119Components,Review120Components}.test.tsx` & `src/views/Image2PdfView.test.tsx` (cập nhật assertion theo hành vi double-click title mới và bổ sung suite kiểm thử cho Review 1.20)

---

## 10. Kết quả kiểm thử (sau lần chỉnh sửa cuối cùng)

Lệnh đã chạy: `cargo test --workspace && cargo check -p knit-desktop && pnpm build && pnpm test`

| Hạng mục kiểm tra | Lệnh thực thi | Kết quả | Ghi chú |
|---|---|---|---|
| Rust Core Crates Test | `cargo test --workspace` | **65 passed, 0 failed** | `knit-archive`: 5, `knit-core`: 7, `knit-docs`: 22 (3 unit + 19 integration), `knit-manga`: 5, `knit-pdf`: 20, `knit-renamer`: 6 |
| Tauri Desktop Crate Check | `cargo check -p knit-desktop` | **Pass (exit 0)** | Biên dịch kiểm tra IPC & dependencies thành công |
| Frontend TypeCheck & Build | `pnpm build` | **Pass (exit 0)** | `tsc --noEmit` & `vite build` (3302 modules) thành công |
| Frontend Vitest Suite | `pnpm test` | **27 files passed, 106 tests passed** | Toàn bộ helper & component tests pass trong jsdom |

### Phạm vi kiểm thử thực tế chưa tự động hóa được trong CLI:
- Hành vi chặn lăn chuột khi chạm đỉnh/đáy container trên WebKitGTK (Linux) và WebView2 (Windows) với chuột trackpad/wheel thực tế nên được kiểm tra lại trực tiếp trên app desktop.
- Cảm giác kéo-thả trực tiếp trên Title vs double-click sửa tên vs nhấn giữ 400ms vào chế độ chọn nhiều trong `BookmarkTreeEditor`, cũng như xem trước `PdfFilePreviewModal` từ menu chuột phải ở chế độ `per_file` trên file PDF thực tế.
