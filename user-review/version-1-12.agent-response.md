# Báo cáo phản hồi & thay đổi — Review Version 1.12

Tài liệu này tổng hợp các thay đổi đã áp dụng cho 7 đầu mục trong `user-review/version-1-12.md`, giải thích nguyên nhân kỹ thuật đằng sau mỗi thay đổi, và ghi nhận kết quả kiểm thử sau lần chỉnh sửa cuối cùng.

---

## 1. Selection Mode trong Image2PDF (giữ chuột / `Shift` / `Ctrl`, xoay & xóa hàng loạt)

- **Vấn đề trước đó:** Thao tác nhấn-giữ và di chuột trên thẻ ảnh chỉ phục vụ kéo thả sắp xếp (`Image2PdfView.tsx`), chưa có chế độ chọn nhiều ảnh để xoay hoặc xóa hàng loạt.
- **Thay đổi đã áp dụng:**
  - Nâng cấp `handleCardPointerDown` trong `src/views/Image2PdfView.tsx`:
    - **Giữ chuột yên 400ms (long-press, không di chuyển ≥ 5px):** tự động vào Selection Mode và chọn ảnh hiện tại; nếu di chuyển ≥ 5px trước 400ms thì hủy timer giữ để kích hoạt kéo thả sắp xếp mượt như cũ (không xung đột UX).
    - **`Ctrl+Click` / `Cmd+Click`:** vào Selection Mode và bật/tắt chọn từng ảnh riêng lẻ.
    - **`Shift+Click`:** vào Selection Mode và chọn dải ảnh liên tiếp tính từ anchor gần nhất tới thẻ được click.
    - **Nút "Chọn nhiều" trên thanh công cụ & `Esc`:** cho phép bật/thoát Selection Mode chủ động bằng chuột hoặc phím tắt `Escape`.
  - Bổ sung thanh thao tác Selection Mode trong `src/views/Image2PdfView.tsx` với các nút: `Chọn tất cả`, `Bỏ chọn`, `Xoay 90°` (xoay toàn bộ ảnh đang chọn trong 1 snapshot Undo), `Xóa đã chọn` (xóa hàng loạt trong 1 snapshot Undo kèm tự cập nhật bookmark nếu đang bật), và `Thoát chọn (Esc)`.
  - Cập nhật `src/views/image2pdf/ImagePageCard.tsx` hiển thị viền `#007BFF`, nền nhạt và ô tích chọn trên từng thẻ khi ở Selection Mode.
- **Lý do chọn cách làm này:** Tách ngưỡng `400ms` (giữ yên) và ngưỡng `5px` (kéo) giúp giữ nguyên thao tác kéo thả sắp xếp và double-click xem ảnh lớn mà không cần buộc người dùng luôn phải bấm nút chuyển chế độ thủ công.

---

## 2. Tự động cập nhật Bookmark khi xóa ảnh trong Image2PDF

- **Vấn đề trước đó:** `removePage` chỉ lọc mảng `pages` mà giữ nguyên `target_page_index` của `bookmarks`, khiến mục lục trỏ sai trang sau khi xóa bớt ảnh ở các thư mục đầu.
- **Thay đổi đã áp dụng:**
  - Tạo hàm thuần `remapBookmarksAfterPageRemoval(bookmarks, oldTotalPages, removedIndices)` trong `src/lib/bookmarks.ts`:
    - Thu thập toàn bộ các mốc `target_page_index` duy nhất trong cây bookmark (`sortedStops`), xác định khoảng trang thuộc về mỗi bookmark `[target, nextStop)`.
    - Các bookmark phía sau vùng ảnh bị xóa được tự động dời chỉ số `target_page_index` lên theo số ảnh thực tế còn lại (VD: xóa 5 ảnh ở folder 1 → bookmark 2 dời từ trang 11 về trang 6, bookmark 3 từ trang 21 về trang 16).
    - Nếu chỉ xóa một phần ảnh của khoảng (kể cả ảnh đầu tiên của khoảng đó), bookmark vẫn được giữ lại và trỏ tới **ảnh còn lại đầu tiên trong khoảng**; chỉ xóa bookmark khi toàn bộ khoảng ảnh của nó bị xóa sạch và không có bookmark con nào còn sống.
  - Thêm state lưu bền `autoUpdateBookmarksOnDelete` (mặc định `true`) cùng checkbox **"Tự động cập nhật mục lục khi xóa ảnh"** ở thanh công cụ Image2PDF (khi có bookmark) và ở đầu panel Cây mục lục trong `src/views/Image2PdfView.tsx`.
  - Áp dụng đồng bộ cho cả xóa từng trang (`removePage`) lẫn xóa hàng loạt (`deleteSelectedPages`); mọi thao tác đều nằm chung trong `pushUndoSnapshot()` để `Hoàn tác (Ctrl+Z)` khôi phục đồng thời cả danh sách trang và cây mục lục.
- **Lý do chọn logic khoảng `[target, nextStop)`:** Khớp trực tiếp với mô hình mục lục theo chương/thư mục của người dùng, tránh trường hợp xóa 1–5 ảnh đầu chương mà làm mất luôn tên chương dù chương đó vẫn còn ảnh.

---

## 3. Tag đánh dấu trang có Bookmark ở cả Image2PDF & Merge PDF

- **Thay đổi đã áp dụng:**
  - Tạo helper `buildPageBookmarkMap(nodes)` trong `src/lib/bookmarks.ts` ánh xạ `0-based page_index -> danh sách tiêu đề bookmark`.
  - Tạo component dùng chung `src/components/BookmarkPageBadge.tsx` hiển thị badge vàng nhạt gọn gàng (`Bookmark` icon + tên bookmark đầu tiên + `+N` nếu có nhiều bookmark cùng trỏ 1 trang, hover hiển thị đầy đủ tất cả tên bookmark).
  - Tích hợp `BookmarkPageBadge` vào:
    - `src/views/image2pdf/ImagePageCard.tsx` + `src/views/Image2PdfView.tsx` (hiển thị ở góc dưới-trái khung ảnh, hoặc phía trên tiêu đề khi tắt tải thumbnail).
    - `src/components/PdfPageCards.tsx` (`MergePageCard`) + `src/views/pdf-ops/PdfMergePane.tsx` (hiển thị khi bật `Giữ và ánh xạ lại mục lục`).
- **Lý do dùng component & helper chung:** Tránh lặp logic duyệt cây bookmark và markup badge giữa hai công cụ.

---

## 4 & 7. Lỗi đơ / nghẽn tải Thumbnail & Double-click không load trang trong PDF Merge & Split

- **Nguyên nhân gốc rễ đã phát hiện:**
  1. **Parse lại file PDF từ đầu cho mỗi trang đơn lẻ:** `render_pdf_thumbnail_jpeg` và `render_pdf_thumbnail` (`crates/knit-pdf/src/ops.rs`) trước đó gọi `Pdf::new(...)` lại từ đầu ở mỗi lần vẽ 1 trang. Với file PDF lớn hàng nghìn trang, việc parse lại bảng `xref` và cây `/Pages` lặp lại hàng trăm/nghìn lần chiếm sạch CPU trong thời gian dài (gây hiện tượng load được đoạn đầu rồi nghẽn cứng, vài phút sau mới xả xong).
  2. **Tranh chấp semaphore giữa Thumbnail nền và Double-click Zoom:** `render_pdf_page_preview_file` dùng chung `thumb_semaphore()` với `render_pdf_thumb_file` (`src-tauri/src/lib.rs`), nên khi double-click vào một trang, tác vụ zoom phải xếp hàng chờ sau toàn bộ hàng đợi thumbnail nền.
  3. **Hàng đợi frontend giữ key ngoài màn hình & preload trang ẩn ở Split tab:**
     - `registerThumbCardRef` ở `PdfOpsView.tsx` thêm key vào `visibleKeysRef` khi mount nhưng không gỡ khi unmount (`el === null`).
     - `enqueueWindow` trong `useThumbnailQueue.ts` không cắt bỏ các key cũ vừa cuộn qua khỏi màn hình, còn `setPinnedKeys` ở tab Split đẩy trước toàn bộ trang trong các section vào hàng đợi.
- **Thay đổi đã áp dụng:**
  - **Backend `crates/knit-pdf/src/ops.rs`:** Bổ sung `HAYRO_PDF_CACHE` (LRU tối đa 4 `Arc<Pdf>` mở sẵn qua `memmap2` theo `(canonical_path, len, mtime_nanos)`) và `clear_pdf_reader_cache()`, giúp cuộn qua nhiều trang cùng 1 PDF chỉ parse `xref` & cây trang **1 lần duy nhất**.
  - **Backend `src-tauri/src/lib.rs`:** Tách **`preview_semaphore()` riêng (2 permits)** cho `render_pdf_page_preview_file` và `render_page_draft_preview_file` để double-click phóng to trang được xử lý ngay lập tức, không bao giờ phải chờ thumbnail lưới nền.
  - **Frontend `src/hooks/useThumbnailQueue.ts` & `src/views/PdfOpsView.tsx`:**
    - `enqueueWindow(..., replaceVisible = true)` tự động **cắt bỏ (prune)** mọi key đang chờ trong queue nếu không còn nằm trên màn hình và không thuộc `pinnedKeys`.
    - `popNextPrioritizedKey` luôn **ưu tiên pop các trang nằm trong `visibleKeysRef`** trước các trang `pinned`.
    - `setPinnedKeys(pinned, false)` ở `PdfOpsView.tsx` chỉ bảo vệ cache LRU cho section Split mà không enqueue trước các trang ngoài màn hình; `registerThumbCardRef` có ref-count giảm trừ chính xác khi card unmount (và cập nhật tương tự cho `registerCardRef` ở `Image2PdfView.tsx`).

---

## 5. Sửa lỗi đo đạc RAM trên thanh hiệu năng (`get_app_metrics`)

- **Nguyên nhân gốc rễ:** Trên Linux, hàm `collect_process_tree_stats()` (`src-tauri/src/lib.rs`) trước đó đọc `VmRSS:` từ `/proc/{pid}/status` rồi cộng dồn cho toàn bộ cây tiến trình (`knit` + `WebKitWebProcess` + `WebKitNetworkProcess` + GPU process...). Cách cộng này:
  - Đếm trùng nhiều lần các trang bộ nhớ chia sẻ (`RssShmem` / shared libraries / GPU buffers) giữa các tiến trình con của WebKitGTK.
  - Tính cả page cache file sạch (`RssFile` từ file PDF/ảnh `mmap`) vào RAM ứng dụng, dẫn tới app báo 9.6 GB dù thực tế hệ thống/Task Manager chỉ ghi nhận ~4.6 GB.
- **Thay đổi đã áp dụng:**
  - Viết hàm `read_linux_process_ram_bytes(pid)` trong `src-tauri/src/lib.rs` ưu tiên đọc **`Pss_Anon` + `Pss_Shmem`** từ `/proc/{pid}/smaps_rollup` (chia đều bộ nhớ chia sẻ theo số tiến trình đang dùng và không tính OS clean file page-cache). Nếu kernel không có hai trường này thì fallback về `Pss:`, cuối cùng mới về `VmRSS:`.

---

## 6. Sửa lỗi Activity Logs ngừng bám theo log mới nhất sau vài trăm dòng

- **Nguyên nhân gốc rễ:**
  - `src/App.tsx` giữ tối đa 800 dòng log (`prev.slice(-800)`). Khi danh sách chạm ngưỡng xoay vòng hoặc khi log đổ về nhanh từng cụm làm `scrollHeight` tăng vượt 36px trước lúc callback `requestAnimationFrame` trong `src/components/WorkbenchShell.tsx` kịp chạy, handler `onScroll` đo thấy `scrollHeight - scrollTop - clientHeight >= 36` và gán nhầm `logsPinnedToBottomRef.current = false` dù người dùng không hề cuộn lên.
- **Thay đổi đã áp dụng (`src/components/WorkbenchShell.tsx`):**
  - Dùng `useLayoutEffect` đồng bộ `el.scrollTop = el.scrollHeight` ngay sau commit DOM kết hợp cờ `programmaticLogScrollRef` để bỏ qua sự kiện `onScroll` phát sinh từ việc cuộn tự động.
  - Chỉ tắt auto-follow khi `el.scrollTop < lastLogScrollTopRef.current - 2` (người dùng thực sự chủ động cuộn chuột lên trên) và tự bật lại khi cuộn xuống cách đáy < 24px.
  - Bổ sung nút **`↓ Latest`** trên header drawer Logs mỗi khi người dùng đang tạm cuộn lên để quay về bám theo log mới nhất chỉ với 1 click.

---

## 7. Tổng hợp tệp đã chỉnh sửa / tạo mới

- **Backend Rust:**
  - `crates/knit-pdf/src/ops.rs` (`HAYRO_PDF_CACHE`, `clear_pdf_reader_cache`)
  - `crates/knit-pdf/src/lib.rs` (export `clear_pdf_reader_cache`)
  - `src-tauri/src/lib.rs` (`preview_semaphore`, `read_linux_process_ram_bytes`, dọn `clear_pdf_reader_cache`)
- **Frontend & Helpers:**
  - `src/lib/bookmarks.ts` *(mới)* & `src/lib/bookmarks.test.ts` *(mới)*
  - `src/components/BookmarkPageBadge.tsx` *(mới)*
  - `src/hooks/useThumbnailQueue.ts` & `src/hooks/useThumbnailQueue.test.tsx`
  - `src/components/WorkbenchShell.tsx`
  - `src/components/PdfPageCards.tsx` & `src/components/PdfPageCards.test.tsx`
  - `src/views/pdf-ops/PdfMergePane.tsx` & `src/views/PdfOpsView.tsx`
  - `src/views/image2pdf/ImagePageCard.tsx` & `src/views/Image2PdfView.tsx`
  - `src/i18n/types.ts`, `src/i18n/vi.ts`, `src/i18n/en.ts`

---

## 8. Kết quả kiểm thử (chạy sau lần chỉnh sửa cuối cùng)

Lệnh đã chạy: `cargo test --workspace && cargo check -p knit-desktop && pnpm build && pnpm test`

- **Rust workspace tests (`cargo test --workspace`):**
  - `knit-archive`: 4 passed, 0 failed
  - `knit-core`: 7 passed, 0 failed
  - `knit-docs`: 11 passed, 0 failed
  - `knit-manga`: 4 passed, 0 failed
  - `knit-pdf`: 14 passed, 0 failed
  - `knit-renamer`: 6 passed, 0 failed
  - *(Tổng: 46 integration tests passed, 0 failed)*
- **Desktop crate check (`cargo check -p knit-desktop`):** thành công (exit code 0, không lỗi).
- **Frontend typecheck & build (`pnpm build` — `tsc --noEmit && vite build`):** thành công (`3291 modules transformed`, exit code 0).
- **Frontend unit/component tests (`pnpm test` — `vitest run`):** **16 test files passed, 41 tests passed, 0 failed** (bao gồm 3 test mới trong `src/lib/bookmarks.test.ts`, test ưu tiên viewport & prune queue trong `src/hooks/useThumbnailQueue.test.tsx`, và test `BookmarkPageBadge` / `ImagePageCard` selection trong `src/components/PdfPageCards.test.tsx`).

**Phạm vi kiểm thử thực tế chưa tự động hóa được trong CLI:**
- Tương tác long-press 400ms / Shift / Ctrl thực tế bằng chuột, cuộn nhanh trên bộ PDF hàng nghìn trang, đối chiếu chỉ số RAM thực tế giữa `get_app_metrics` và Task Manager hệ thống khi mở nhiều PDF lớn, và hành vi bám đáy log với >1.000 dòng stream từ Tauri IPC nên được xác nhận thêm khi chạy app desktop (`pnpm tauri dev` hoặc bản build).
