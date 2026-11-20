# Báo cáo phản hồi & thay đổi — Review Version 1.14

Tài liệu này tổng hợp các thay đổi đã áp dụng cho toàn bộ 9 đầu mục trong [`user-review/version-1-14.md`](file:///home/khoa/Code/Personal%20Project/Knit/user-review/version-1-14.md), nguyên nhân kỹ thuật đằng sau mỗi thay đổi, phương án triển khai và kết quả kiểm thử sau lần chỉnh sửa cuối cùng.

---

## 1. Bộ chọn kích cỡ card (`Nhỏ` / `Vừa` / `Lớn`) trong `Image → PDF` và `PDF Merge & Split`

- **Vấn đề trước đó:** Khi làm việc với lưới trang có nhiều cột hoặc ảnh chi tiết, người dùng chỉ thay đổi được số cột mà không chỉnh được kích thước hiển thị trực quan của từng card.
- **Thay đổi đã áp dụng:**
  - Thêm kiểu `CardSizePreset = "small" | "medium" | "large"` trong [`src/lib/imageGrid.ts`](file:///home/khoa/Code/Personal%20Project/Knit/src/lib/imageGrid.ts) và tạo component chọn kích cỡ phẳng [`src/components/CardSizeSelector.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/components/CardSizeSelector.tsx) (`Nhỏ` / `Vừa` / `Lớn`, mức `Nhỏ` giữ nguyên kích thước mặc định cũ).
  - Trong `Image → PDF` ([`src/views/Image2PdfView.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/Image2PdfView.tsx) & [`src/views/image2pdf/ImagePageCard.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/image2pdf/ImagePageCard.tsx)): lưu tùy chọn `"knit.img2pdf.cardSize"`, điều chỉnh chiều cao vùng thumbnail (`h-32` / `h-48` / `h-64`) và đồng bộ `initialRowStridePx` + `extraDeps` của `useVirtualizedGrid`.
  - Trong `PDF Merge & Split` ([`src/views/PdfOpsView.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/PdfOpsView.tsx), [`src/views/pdf-ops/PdfMergePane.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/pdf-ops/PdfMergePane.tsx), [`src/views/pdf-ops/PdfSplitPane.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/pdf-ops/PdfSplitPane.tsx), [`src/views/pdf-ops/SplitSectionCard.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/pdf-ops/SplitSectionCard.tsx), [`src/components/PdfPageCards.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/components/PdfPageCards.tsx)):
    - Tab Merge dùng bộ chọn riêng (`"knit.pdfops.mergeCardSize"`) đặt cạnh `GridColumnSelector` để đổi kích thước `MergePageCard` (`h-32` / `h-48` / `h-64`).
    - Tab Split dùng chung một bộ chọn (`"knit.pdfops.splitCardSize"`) điều chỉnh đồng thời cả `SplitSourceCard` (`h-24` / `h-36` / `h-48`) lẫn `SplitSectionItemCard` (`h-20` / `h-32` / `h-44`), đồng thời cập nhật `initialRowStridePx` cho cả virtualized source grid lẫn section grid.

---

## 2. Sửa kích cỡ tag cảnh báo cạnh ô nhập tiêu đề Bookmark

- **Vấn đề trước đó:** Khi tên bookmark quá dài hoặc không đủ chỗ, badge cảnh báo màu vàng ở dòng bookmark trong `BookmarkTreeEditor` bị bóp hẹp theo chiều ngang và cao hơn/lệch chiều cao so với ô `<input type="text">` và `NumberInput`.
- **Nguyên nhân kỹ thuật:** Badge cảnh báo cũ dùng padding tự do (`px-1 py-0.5`) không có `knit-control-sm` (`32px`) và `min-w-8` nên bị flexbox co bóp không đồng đều.
- **Thay đổi đã áp dụng:** Tại [`src/components/BookmarkTreeEditor.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/components/BookmarkTreeEditor.tsx), cập nhật `data-testid="bookmark-row-warning-*"` sang `knit-control-sm inline-flex min-w-8 shrink-0 items-center justify-center rounded-[4px] border border-[#FFC107] bg-[#FFF3CD] px-2`, khớp chính xác chiều cao `32px` của input tiêu đề và `NumberInput` cạnh bên và luôn giữ tỉ lệ vuông hoặc rộng hơn cao (`width >= height`).

---

## 3. Cho phép kéo thay đổi chiều cao Bookmark Tree tự do kể cả khi có ít mục

- **Vấn đề trước đó:** Khi chỉ có 1–2 bookmark, việc kéo thanh resize chiều cao `BookmarkTreeEditor` xuống sâu hơn không làm khung mục lục cao thêm.
- **Nguyên nhân kỹ thuật:** Khung cuộn `scrollRef` đang gán `style={{ maxHeight: "${liveHeightPx}px" }}` nên chiều cao thực tế bị co gọn theo số dòng nội dung thay vì theo kích thước người dùng kéo.
- **Thay đổi đã áp dụng:** Đổi `scrollRef` trong [`src/components/BookmarkTreeEditor.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/components/BookmarkTreeEditor.tsx) sang `style={{ height: "${liveHeightPx}px" }}` để chiều cao khung luôn phản ánh đúng chiều cao đang kéo, bất kể đang có ít hay nhiều bookmark.

---

## 4. Tự động cuộn & mở rộng khi kéo resize chạm mép khung / cửa sổ

- **Vấn đề trước đó:** Khi kéo thanh chỉnh chiều cao (`BookmarkTreeEditor`, `Source PDF Pages`, `Output PDF Sections`, hoặc từng thẻ section trong Split) sát tới mép trên/dưới của khung cuộn cha hoặc viewport ứng dụng, chiều cao bị kẹt không tăng thêm được nữa vì chuột hết chỗ di chuyển xuống dưới.
- **Thay đổi đã áp dụng:**
  - Trong [`src/hooks/useVerticalResize.ts`](file:///home/khoa/Code/Personal%20Project/Knit/src/hooks/useVerticalResize.ts): tách và export `findScrollableAncestor`; bổ sung vòng lặp `requestAnimationFrame` tự động cuộn mượt khi con trỏ nằm trong vùng đệm `36px` sát mép trên/dưới của container cuộn cha hoặc viewport, đồng thời cộng thêm `scrollTop - startScrollTop` vào phép tính `latestH` để khung kéo dãn liên tục.
  - Áp dụng tương tự với `findScrollableAncestor` cho hàm resize chiều cao từng thẻ section (`handleSectionCardHeightResize`) trong [`src/views/pdf-ops/PdfSplitPane.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/pdf-ops/PdfSplitPane.tsx).

---

## 5. Giới hạn thao tác lồng cấp Bookmark chỉ khi thả đúng vào icon grip

- **Vấn đề trước đó:** Khi kéo thả bookmark trên toàn bộ hàng để sắp xếp lại thứ tự, vùng giữa của hàng dễ bị nhận nhầm là thao tác lồng thành mục con (`inside`), khiến người dùng khó đổi vị trí anh em mượt mà.
- **Thay đổi đã áp dụng:** Cập nhật hàm `hitTestDrop` trong [`src/components/BookmarkTreeEditor.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/components/BookmarkTreeEditor.tsx):
  - Trên toàn bộ hàng bookmark (`[data-bookmark-path]`), mặc định chia làm 2 nửa trên/dưới (`relY < 0.5 ? "before" : "after"`) để ưu tiên sắp xếp vị trí.
  - Chỉ khi con trỏ trỏ trực tiếp vào đúng icon tay cầm kéo (`[data-bookmark-drag-handle]`, `GripVertical`) của hàng đích thì mới chuyển sang trạng thái lồng thành bookmark con (`"inside"`).

---

## 6. Menu chuột phải (Context Menu) cho trang PDF trong `PDF Merge & Split`

- **Vấn đề trước đó:** `PDF Merge & Split` chưa có menu chuột phải giống `Image → PDF`, gây bất tiện khi cần xoay nhanh theo góc bất kỳ, gắn bookmark hoặc lấy thông tin/đường dẫn file gốc.
- **Thay đổi đã áp dụng:**
  - Tạo [`src/views/pdf-ops/PdfPageContextMenu.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/pdf-ops/PdfPageContextMenu.tsx) hỗ trợ 2 ngữ cảnh (`mode: "merge"` và `mode: "split"`):
    - **Header thông tin trên cùng:** hiển thị tên tệp, số thứ tự tệp nguồn & trang nguồn (`Tệp X: <tên> · Tr. Y`), kèm vị trí trang đầu ra (`Trang xuất: #Z`) và góc xoay hiện tại (nếu khác `0°`).
    - **Ở tab Merge:** cung cấp đủ 7 hành động: `Xoay phải 90°`, `Xoay 180°`, `Xoay trái 90°`, `Phóng to & xem chi tiết trang`, `Gắn bookmark tại trang này` (tạo bookmark `<tên file> · Tr. X` và tự bật tùy chọn giữ bookmark + mở panel bookmark), `Copy đường dẫn file PDF` (kèm toast xác nhận), và `Xóa trang`.
    - **Ở tab Split** (gắn cho cả `SplitSourceCard` và `SplitSectionItemCard`): cung cấp 2 hành động phù hợp là `Phóng to & xem chi tiết trang` và `Copy đường dẫn file PDF`.
  - Mở rộng [`src/components/PdfPageZoomModal.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/components/PdfPageZoomModal.tsx) để hiển thị thêm tổng số trang tệp nguồn, kích thước tệp gốc, vị trí trang xuất (nếu là Merge), góc xoay và đường dẫn đầy đủ.

---

## 7. Trạng thái loading + khóa chỉnh sửa khi `Populate sections from rule` & Bookmark Undo (`Ctrl+Z`)

- **Vấn đề trước đó:**
  - Khi nguồn PDF có hàng ngàn trang và tách theo từng trang (`every_n_pages`), `handlePopulateSectionsFromRule` chạy đồng bộ một mạch làm UI khựng và người dùng vẫn có thể bấm sửa rule/section giữa chừng.
  - Cây Bookmark thiếu cơ chế Hoàn tác (`Undo` / `Ctrl+Z`).
- **Thay đổi đã áp dụng:**
  - **Populate sections bất đồng bộ theo chunk ([`src/views/PdfOpsView.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/PdfOpsView.tsx) & [`src/views/pdf-ops/PdfSplitPane.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/pdf-ops/PdfSplitPane.tsx)):** chuyển `handlePopulateSectionsFromRule` sang `async` nhường luồng sau mỗi 200 sections (`setTimeout(0)`), bật state `isPopulatingSections`, hiển thị spinner `Loader2` + nhãn đang xử lý trên nút `Populate`, đồng thời khóa (`disabled`) các điều khiển rule, nút thêm/xóa/sửa section, nút thêm trang chọn, và `bookmarksDisabled` trên `BookmarkTreeEditor` trong suốt thời gian xử lý.
  - **Hoàn tác cây Bookmark ([`src/components/BookmarkTreeEditor.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/components/BookmarkTreeEditor.tsx)):**
    - Bổ sung stack lịch sử tối đa 50 bước, nút `Hoàn tác` trên thanh tiêu đề của `BookmarkTreeEditor` và phím tắt `Ctrl+Z` / `Cmd+Z`.
    - Khi đang focus trong ô nhập text (`INPUT`, `TEXTAREA`, `SELECT`), giữ nguyên hoàn tác ký tự mặc định của trình duyệt; đồng thời lưu snapshot tiêu đề theo phiên focus→blur để vẫn có thể hoàn tác thay đổi tiêu đề sau khi rời ô nhập.
    - Trong `PdfMergePane` bật `enableGlobalUndoShortcut={true}`; trong `Image2PdfView` đặt `enableGlobalUndoShortcut={false}` để `Ctrl+Z` trong panel bookmark không xung đột với thao tác toàn trang.
    - Xử lý an toàn kiểm tra `target instanceof Node` trước `containerRef.current.contains(target)` khi sự kiện `keydown` phát trực tiếp từ `window`.

---

## 8. Sửa lỗi giật layout viền nét đứt trong `Output PDF Sections` khi kéo thả trang

- **Vấn đề trước đó:** Khi kéo trang từ `Source PDF Pages` di chuyển qua các thẻ section trong `Output PDF Sections`, viền thẻ bị nhảy giật kích thước nhẹ rồi bật lại.
- **Nguyên nhân kỹ thuật:** Trong [`src/views/pdf-ops/SplitSectionCard.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/pdf-ops/SplitSectionCard.tsx), trạng thái hover chuyển độ dày viền từ `border` (`1px`) sang `border-2` (`2px`), làm thay đổi kích thước box thêm `2px` mỗi chiều và xô nhẹ bố cục toàn danh sách bên dưới.
- **Thay đổi đã áp dụng:** Giữ cố định `border` (`1px`) ở cả 3 trạng thái và dùng `ring-2 ring-[#007BFF]/30` kết hợp `border-dashed border-[#007BFF] bg-[#E7F1FF]/40` khi hover, loại bỏ hoàn toàn hiện tượng nhảy layout.

---

## 9. Đơn giản hóa hiển thị ước lượng kích cỡ đầu ra trên cả 5 công cụ

- **Vấn đề trước đó:** Khung ước lượng kích thước (`ExportFilenameControl`) đang hiển thị dạng thẻ pill có viền, icon `HardDrive`, tiền tố `"Ước lượng xuất:"` và số file đính kèm, hơi rối và thừa chữ trên thanh tên file.
- **Thay đổi đã áp dụng:**
  - Cập nhật [`src/components/ExportFilenameControl.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/components/ExportFilenameControl.tsx): gỡ khung viền `border` và icon `HardDrive`, chỉ render văn bản inline đơn giản với font monospace (`~223 MB`, `~1.3 GB`...).
  - Cập nhật `common.estimatedOutputSummary` và `docs2pdf.estimatedOfficeNote` trong [`src/i18n/vi.ts`](file:///home/khoa/Code/Personal%20Project/Knit/src/i18n/vi.ts) và [`src/i18n/en.ts`](file:///home/khoa/Code/Personal%20Project/Knit/src/i18n/en.ts) để trả về ngắn gọn `` `~${size}` `` trên cả 5 công cụ.

---

## 10. Tổng hợp tệp đã chỉnh sửa / tạo mới (Review 1.14)

- [`src/lib/imageGrid.ts`](file:///home/khoa/Code/Personal%20Project/Knit/src/lib/imageGrid.ts) (Thêm type `CardSizePreset`)
- [`src/components/CardSizeSelector.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/components/CardSizeSelector.tsx) (Component chọn kích cỡ `Nhỏ` / `Vừa` / `Lớn`)
- [`src/components/ExportFilenameControl.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/components/ExportFilenameControl.tsx) (Hiển thị dung lượng ước lượng dạng text đơn giản `~...`)
- [`src/i18n/types.ts`](file:///home/khoa/Code/Personal%20Project/Knit/src/i18n/types.ts), [`src/i18n/vi.ts`](file:///home/khoa/Code/Personal%20Project/Knit/src/i18n/vi.ts), [`src/i18n/en.ts`](file:///home/khoa/Code/Personal%20Project/Knit/src/i18n/en.ts) (Khóa dịch song ngữ cho 1.14 và chuẩn hóa chuỗi ước lượng `~size`)
- [`src/hooks/useVerticalResize.ts`](file:///home/khoa/Code/Personal%20Project/Knit/src/hooks/useVerticalResize.ts) (Export `findScrollableAncestor`, tự động cuộn và cộng `scrollDelta` ở mép)
- [`src/components/BookmarkTreeEditor.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/components/BookmarkTreeEditor.tsx) (Free height, badge `knit-control-sm min-w-8`, drag-drop lồng cấp chỉ tại grip icon, Undo + `Ctrl+Z`, props `disabled` & `enableGlobalUndoShortcut`)
- [`src/views/Image2PdfView.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/Image2PdfView.tsx), [`src/views/image2pdf/ImagePageCard.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/image2pdf/ImagePageCard.tsx) (Tích hợp `CardSizeSelector` & cấu hình `enableGlobalUndoShortcut={false}`)
- [`src/components/PdfPageCards.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/components/PdfPageCards.tsx), [`src/components/PdfPageZoomModal.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/components/PdfPageZoomModal.tsx) (`cardSize`, `onContextMenu*`, chi tiết tệp/trang trên modal zoom)
- [`src/views/pdf-ops/PdfPageContextMenu.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/pdf-ops/PdfPageContextMenu.tsx) (Menu chuột phải cho PDF Merge & Split)
- [`src/views/pdf-ops/SplitSectionCard.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/pdf-ops/SplitSectionCard.tsx) (Bỏ `border-2` chống giật layout hover, nhận `cardSize`, `isLocked`, `onContextMenuItem`)
- [`src/views/pdf-ops/PdfMergePane.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/pdf-ops/PdfMergePane.tsx), [`src/views/pdf-ops/PdfSplitPane.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/pdf-ops/PdfSplitPane.tsx), [`src/views/PdfOpsView.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/views/PdfOpsView.tsx) (Tích hợp `CardSizeSelector`, context menu, async chunked `handlePopulateSectionsFromRule` + khóa UI khi đang xử lý, auto-scroll resize cho section card)
- [`src/components/Review114Components.test.tsx`](file:///home/khoa/Code/Personal%20Project/Knit/src/components/Review114Components.test.tsx) (8 unit tests cho toàn bộ hành vi mới trong bản 1.14)

---

## 11. Kết quả kiểm thử (sau lần chỉnh sửa cuối cùng)

Lệnh đã chạy: `cargo test --workspace && cargo check -p knit-desktop && pnpm build && pnpm test`

| Hạng mục kiểm tra | Lệnh thực thi | Kết quả | Ghi chú |
|---|---|---|---|
| Rust Core Crates Test | `cargo test --workspace` | **49 passed, 0 failed** | `knit-archive` (5), `knit-core` (7), `knit-docs` (12), `knit-manga` (5), `knit-pdf` (14), `knit-renamer` (6) |
| Tauri Desktop Crate Check | `cargo check -p knit-desktop` | **Pass (exit 0)** | Toàn bộ IPC & workspace check hợp lệ |
| Frontend TypeCheck & Build | `pnpm build` | **Pass (exit 0)** | `tsc --noEmit` & `vite build` thành công |
| Frontend Vitest Suite | `pnpm test` | **19 files passed, 62 tests passed** | Bao gồm 8 unit tests mới trong `Review114Components.test.tsx` |

### Phạm vi kiểm thử thực tế chưa tự động hóa hoàn toàn trong CLI:
- Thao tác kéo chuột liên tục sát mép cửa sổ WebView thật trên các phần lớn của Split/Image Grid (hành vi DOM + `rAF` auto-scroll đã được kiểm tra bằng unit test mô phỏng trong jsdom).
- Mở menu chuột phải trực tiếp trên cửa sổ Tauri desktop thật và ghi đường dẫn thực tế vào clipboard hệ điều hành.
