# Báo cáo phản hồi & thay đổi — Review Version 1.13

Tài liệu này tổng hợp các thay đổi đã áp dụng cho toàn bộ 11 đầu mục trong `user-review/version-1-13.md`, giải thích nguyên nhân kỹ thuật đằng sau mỗi thay đổi, lý do lựa chọn phương án kiến trúc và kết quả kiểm thử sau lần chỉnh sửa cuối cùng.

---

## 1. Ước lượng kích cỡ file/files xuất ra trên 5 công cụ

- **Vấn đề trước đó:** Các công cụ `Image → PDF`, `Document → PDF`, `PDF Merge & Split`, `Archive Manager` và `Manga Packager` chưa hiển thị ước lượng dung lượng (và số lượng tệp đầu ra nếu bật chia part) trước khi người dùng bấm xuất.
- **Nguyên nhân kỹ thuật:**
  - `crates/knit-archive` chỉ tính tổng dung lượng khi bắt đầu chạy `pack_entries`, chưa có API ước lượng chỉ đọc metadata.
  - `Story` trong `crates/knit-manga` chưa lưu `total_bytes` khi quét thư mục nguồn.
  - Các view frontend chưa tổng hợp dữ liệu metadata sẵn có (`PageDraft.file_size_bytes`, `PdfInfo.file_size_bytes`, `previewPdfBytes.byteLength`) thành chỉ báo không chặn (non-blocking) trên thanh cấu hình xuất file.
- **Thay đổi đã áp dụng:**
  - **Backend Rust:**
    - Thêm `ArchiveEstimate` và `estimate_archive_output` trong `crates/knit-archive/src/lib.rs` (chỉ đọc metadata kích thước qua `collect_entries`, áp dụng hệ số nén ước lượng theo nhóm đuôi file đã nén sẵn vs văn bản/dữ liệu thô).
    - Thêm trường `total_bytes: u64` vào `Story` (`crates/knit-manga/src/models.rs`) và tính cộng dồn từ `fs::metadata` trong `inspect_story` (`crates/knit-manga/src/scanner.rs`).
    - Bổ sung 2 Tauri command chạy trên `spawn_blocking` trong `src-tauri/src/lib.rs`: `archive_estimate_size` và `get_file_size_bytes` (cho DOCX/PPTX).
  - **Frontend:**
    - Tạo `src/lib/sizeEstimate.ts` với các hàm thuần `estimateImage2PdfOutput`, `estimatePdfMergeOutput`, `estimatePdfSplitOutput`, `estimateMangaPackOutput` (tái lập logic `group_by_size` nguyên truyện).
    - Mở rộng `ExportFilenameControl` (`src/components/ExportFilenameControl.tsx`) nhận `estimateText` và `estimating` để hiển thị pill `Ước lượng xuất: ~...` đồng bộ trên cả 5 tool.
    - Ở `ArchiveView` và `Docs2PdfView` (DOCX/PPTX), gọi IPC ước lượng bất đồng bộ ở nền với debounce 220ms và hủy kết quả cũ khi state thay đổi; với Markdown/PlainText/HTML/EPUB dùng trực tiếp `previewPdfBytes.byteLength`.
- **Lý do chọn cách làm này:** Tính toán hoàn toàn bất đồng bộ/nền từ metadata sẵn có giúp giao diện không bị giật và tuyệt đối không chặn nút Export ngay cả khi tác vụ ước lượng chưa hoàn tất hoặc chưa khả dụng.

---

## 2. Chuẩn hóa tag Bookmark trên thẻ ảnh theo `DESIGIN.md`

- **Vấn đề trước đó:** Tag đánh dấu ảnh đang gắn bookmark trong `Image → PDF` trông lệch tông với phần còn lại của giao diện.
- **Nguyên nhân kỹ thuật:** Component `src/components/BookmarkPageBadge.tsx` đang dùng bảng màu vàng Bootstrap (`border-[#FFE69C] bg-[#FFF3CD] text-[#664D03]`) kèm `shadow-sm` — không thuộc bảng màu chuẩn của `DESIGIN.md` và đối chọi với badge `#343A40` (`#idx`) và `#17A2B8` (`Đã sửa`).
- **Thay đổi đã áp dụng:** Chuyển `BookmarkPageBadge.tsx` sang phong cách Corporate Blue phẳng chuẩn `DESIGIN.md`: `border border-[#B8DAFF] bg-[#E7F1FF] text-[#0056B3]`, icon `Bookmark` dùng `#007BFF`, bỏ `shadow-sm`.
- **Lý do chọn cách làm này:** Đồng bộ trực tiếp với bộ màu `#007BFF` / `#343A40` / `#17A2B8` của ứng dụng và dùng chung sạch sẽ cho cả `ImagePageCard` lẫn `MergePageCard`.

---

## 3. Hiển thị đường dẫn đầy đủ khi trùng tên file trong `PDF Merge & Split`

- **Vấn đề trước đó:** Khi nạp nhiều tệp PDF cùng tên từ các thư mục khác nhau, danh sách tài liệu chỉ hiển thị basename (`name.pdf`) nên không phân biệt được đâu là file nào.
- **Nguyên nhân kỹ thuật:** `LoadedPdfList.tsx` và bộ lọc file trong `PdfSplitPane.tsx` chỉ cắt phần tên cuối `f.path.split(/[\\/]/).pop()`.
- **Thay đổi đã áp dụng:**
  - Trong `src/views/pdf-ops/LoadedPdfList.tsx`, khi phát hiện các tệp có cùng basename (so sánh không phân biệt hoa/thường), hiển thị thêm dòng đường dẫn đầy đủ `f.path` bằng font monospace bên dưới tên file.
  - Trong `src/views/pdf-ops/PdfSplitPane.tsx`, các nút lọc tệp nguồn bổ sung thêm tên thư mục cha `shortName (parentFolder)` nếu trùng tên và đặt `title={f.path}`.
- **Lý do chọn cách làm này:** Chỉ mở rộng thêm dòng đường dẫn khi thực sự có trùng tên, giữ danh sách gọn gàng ở trường hợp thông thường nhưng phân biệt rõ ràng 100% khi có xung đột tên file.

---

## 4. Làm dịu màu nút `+` trên thẻ `Source PDF Pages`

- **Vấn đề trước đó:** Trong khung `Source PDF Pages` của `PDF Split`, nút `+` thêm nhanh vào section đang dùng nền `#007BFF` chữ trắng, rất dễ nhầm với trạng thái trang đang được chọn (`border-[#007BFF]` + badge `#007BFF`).
- **Thay đổi đã áp dụng:** Đổi nút `+` trong `SplitSourceCard` (`src/components/PdfPageCards.tsx`) sang nền trung tính phẳng: `border border-[#CED4DA] bg-white/95 text-[#495057] hover:border-[#007BFF] hover:bg-[#E7F1FF] hover:text-[#007BFF]`.
- **Lý do chọn cách làm này:** Màu xanh Corporate Blue được giữ dành riêng cho trạng thái active/selected, giúp người dùng nhận diện vùng chọn trang ngay lập tức.

---

## 5. Bổ sung badge cảnh báo trùng tên file trong `PDF Merge & Split`

- **Vấn đề trước đó:** Khi người dùng import nhiều file PDF trùng tên, chưa có tín hiệu cảnh báo nổi bật giúp nhận ra ngay tình trạng trùng tên.
- **Nguyên nhân kỹ thuật:** `LoadedPdfList.tsx` chưa thực hiện gom nhóm đếm basename trước khi render từng dòng tài liệu.
- **Thay đổi đã áp dụng:** Bổ sung đếm basename case-insensitive trong `src/views/pdf-ops/LoadedPdfList.tsx`; các file trùng tên được highlight viền `#FFC107` nhẹ và gắn badge `Trùng tên` / `Duplicate name` kèm icon `AlertTriangle`.
- **Lý do chọn cách làm này:** So sánh case-insensitive đồng nhất với quy chuẩn tương thích NTFS/exFAT trong `RULES.md` và tách biệt rõ cảnh báo trực quan ngay trên dòng tài liệu.

---

## 6. Kéo dãn chiều rộng Ảnh / Bookmark Tree, bỏ giới hạn max-height & thêm `sticky`

- **Vấn đề trước đó:** Trong `Image → PDF`, tỷ lệ 2 cột Ảnh và Bookmark Tree bị cố định `lg:grid-cols-3`, chiều cao Bookmark Tree bị chặn ở `880px`, và khi cuộn lưới ảnh dài thì khung Bookmark Tree bị trôi mất khỏi màn hình.
- **Nguyên nhân kỹ thuật:**
  - `Image2PdfView.tsx` chưa dùng `useHorizontalRatioResize` + `PaneResizeHandle`.
  - `BookmarkTreeEditor.tsx` truyền cứng `max: 880` vào `useVerticalResize`.
- **Thay đổi đã áp dụng:**
  - Cập nhật `src/hooks/useVerticalResize.ts` cho phép `max?: number` tùy chọn (khi bỏ qua sẽ không giới hạn chiều cao tối đa).
  - Trong `src/components/BookmarkTreeEditor.tsx`, giữ thanh kéo dãn dọc nhưng bỏ giới hạn `max: 880`.
  - Trong `src/views/Image2PdfView.tsx`, áp dụng `useHorizontalRatioResize` (lưu tại `knit.img2pdf.leftRatio`) + `PaneResizeHandle` dọc với CSS Grid `items-start` và gắn `lg:sticky lg:top-0 lg:self-start` cho cột Bookmark Tree.
- **Lý do chọn cách làm này:** Tái sử dụng đúng pattern resize ổn định của `PdfSplitPane`, đồng thời `items-start` + `sticky` bên trong vùng cuộn `<main>` giúp Bookmark Tree luôn bám đỉnh khi duyệt hàng trăm ảnh.

---

## 7. Kéo thả sắp xếp Bookmark Tree & nới rộng ô số trang tối thiểu 6 chữ số

- **Vấn đề trước đó:**
  - Người dùng không thể kéo thả sắp xếp hoặc lồng cấp các mục trong `BookmarkTreeEditor`.
  - Ô nhập số trang `NumberInput` có độ rộng `w-16` (64px, trừ nút tăng/giảm và padding chỉ còn ~28px cho chữ) nên bị che khuất với số trang lớn như `10000`.
- **Nguyên nhân kỹ thuật:** `BookmarkRow` chưa có drag handle/drop-zone và dùng class `w-16` cho `NumberInput`.
- **Thay đổi đã áp dụng:**
  - Nới rộng `NumberInput` trong `BookmarkRow` từ `w-16` lên `w-28` (`112px`), hiển thị trọn vẹn tối thiểu 6 chữ số (`100000+`) bằng font `JetBrains Mono`.
  - Viết hàm thuần `moveBookmarkNode` trong `src/lib/bookmarks.ts` hỗ trợ kéo thả đổi vị trí cùng cấp (`before` / `after`) và lồng cấp (`inside`), có chốt chặn không cho kéo mục cha vào chính con cháu của nó.
  - Tích hợp tay cầm kéo `GripVertical` dùng pointer events trong `src/components/BookmarkTreeEditor.tsx` với thanh chỉ báo vị trí thả và highlight vùng lồng cấp.
- **Lý do chọn cách làm này:** Dùng pointer events thay vì HTML5 Drag & Drop giúp hành vi kéo thả nhất quán trên cả WebKitGTK (Linux) và WebView2 (Windows), đồng thời tách logic biến đổi cây ra hàm thuần để unit test 100%.

---

## 8. Cảnh báo lỗi logic trong PDF Bookmarks Tree (không chặn export)

- **Vấn đề trước đó:** Khi người dùng chỉnh sửa hoặc kéo thả bookmark bị ngược thứ tự (bookmark trước có số trang lớn hơn bookmark sau, bookmark con nhỏ hơn bookmark cha, hoặc vượt tổng số trang), giao diện không báo cảnh báo.
- **Nguyên nhân kỹ thuật:** Chưa có bước kiểm tra tính nhất quán trên cây `BookmarkNode[]`.
- **Thay đổi đã áp dụng:**
  - Thêm hàm thuần `validateBookmarks(nodes, totalPages)` trong `src/lib/bookmarks.ts` kiểm tra 3 loại cảnh báo: `order` (mục sau có trang nhỏ hơn mục trước theo thứ tự duyệt), `parent` (mục con có trang nhỏ hơn mục cha), và `out_of_range` (vượt `totalPages`).
  - Hiển thị badge tổng số cảnh báo ở header của `BookmarkTreeEditor` và highlight/icon cảnh báo phẳng trên từng dòng vi phạm kèm tooltip chi tiết. Nút Export PDF vẫn hoạt động bình thường.
- **Lý do chọn cách làm này:** Cảnh báo mang tính thông tin (non-blocking) giúp người dùng phát hiện nhanh lỗi nhập liệu mà không cản trở các trường hợp xuất tài liệu đặc biệt theo ý muốn.

---

## 9. Menu chuột phải 9 tác vụ trên ảnh trong `Image → PDF`

- **Vấn đề trước đó:** Người dùng chỉ có thể bấm nút nhỏ trên thẻ ảnh hoặc kéo thả, chưa có menu ngữ cảnh chuột phải đầy đủ thao tác nhanh.
- **Nguyên nhân kỹ thuật:** `ImagePageCard.tsx` và `Image2PdfView.tsx` chưa xử lý sự kiện `onContextMenu` và chưa có component menu ngữ cảnh.
- **Thay đổi đã áp dụng:**
  - Tạo `src/views/image2pdf/ImageContextMenu.tsx` (tự động kẹp tọa độ trong viewport, đóng khi click ngoài / bấm `Esc` / cuộn trang) cung cấp đầy đủ 9 lựa chọn:
    1. Xoay phải 90° (`rotatePageBy(id, 90)`)
    2. Xoay 180° (`rotatePageBy(id, 180)`)
    3. Xoay trái 90° (`rotatePageBy(id, 270)`)
    4. Phóng to & xem chi tiết ảnh (nâng cấp `ImagePreviewModal.tsx` hiển thị thêm đường dẫn đầy đủ, dung lượng file, kích thước, trạng thái xoay/crop/annotation)
    5. Gắn bookmark tại ảnh đó (tạo mục lục theo tên ảnh và tự động mở khung Bookmark nếu đang ẩn)
    6. Chọn ảnh đó (bật chế độ chọn nhiều nếu chưa bật và chọn thẻ ảnh)
    7. Copy path của ảnh
    8. Copy path của folder chứa ảnh
    9. Xóa ảnh
  - Nối `onContextMenuCard` từ `ImagePageCard.tsx` về `Image2PdfView.tsx`.
- **Lý do chọn cách làm này:** Tách `ImageContextMenu` thành component độc lập và tái dùng các callback sẵn có (`pushUndoSnapshot`, `notifyImported`, `ImagePreviewModal`) giúp tránh trùng lặp logic và đảm bảo dọn sạch event listener khi đóng.

---

## 10. Sửa lỗi chèn Outline/TOC ở giữa file & đặt giới hạn trang trong `Document → PDF`

- **Vấn đề trước đó:** Ở công cụ `Document → PDF`, ô `Chèn mục lục tại trang` cho phép kéo tới 30 dù tài liệu chỉ có 6 trang; đồng thời khi chọn chèn ở các trang giữa, mục lục bị đẩy về đầu file hoặc cuối file thay vì nằm đúng trang chỉ định.
- **Nguyên nhân kỹ thuật:**
  - Trong `crates/knit-docs/src/world.rs`, hàm `query_label_pages` đã gọi nhầm `introspector.pages(loc)` (trả về **tổng số trang** của cả tài liệu trong `typst-layout 0.15.1`) thay vì `introspector.page(loc)` (số trang 1-based của phần tử tại `loc`). Vì mọi block `<knit-blk>` đều bị đọc thành `total_pages`, mọi `toc_page <= total_pages` luôn khớp block đầu tiên (`#metadata(0)` ở đầu file), còn `toc_page > total_pages` luôn rơi vào nhánh `None` (chèn ở cuối file).
  - Trong `Docs2PdfSettingsCard.tsx`, `NumberInput` cho `tocPage` gán cứng `max={999}`.
- **Thay đổi đã áp dụng:**
  - Sửa `query_label_pages` dùng `introspector.page(loc)` và thêm `query_block_pages` đọc trực tiếp ID từ `MetadataElem` trong `crates/knit-docs/src/world.rs`.
  - Bổ sung unit test `toc_page_inserts_in_middle_of_document_not_just_start_or_end` trong `crates/knit-docs/src/world.rs` kiểm chứng `<knit-toc>` thực sự nằm đúng trang 3 trên tài liệu nhiều trang.
  - Truyền `maxTocPage={previewTotalPages > 0 ? previewTotalPages : undefined}` từ `Docs2PdfView.tsx` vào `Docs2PdfSettingsCard.tsx` và tự động clamp `tocPage` nếu vượt quá `previewTotalPages`.
- **Lý do chọn cách làm này:** Sửa trực tiếp đúng API introspection của Typst 0.15 kết hợp tự động đồng bộ cận trên theo `previewTotalPages` giải quyết triệt để cả lỗi định vị trang giữa lẫn giới hạn UI.

---

## 11. Bổ sung `cursor: pointer` cho toàn bộ nút bấm có thể click

- **Vấn đề trước đó:** Nhiều nút bấm trong ứng dụng hiển thị con trỏ mũi tên mặc định (`cursor: default`) thay vì bàn tay (`cursor: pointer`).
- **Nguyên nhân kỹ thuật:** Tailwind CSS v4 Preflight mặc định đặt `cursor: default` cho phần tử `button`, nên các nút không gắn lớp `cursor-pointer` thủ công đều thiếu hiệu ứng con trỏ tay.
- **Thay đổi đã áp dụng:** Thêm quy tắc trong `@layer base` tại `src/styles/tokens.css` đặt `cursor: pointer` cho `button:not(:disabled)`, `[role="button"]:not([aria-disabled="true"])`, `summary`, và `cursor: not-allowed` cho trạng thái disabled.
- **Lý do chọn cách làm này:** Đặt ở `@layer base` giúp áp dụng đồng loạt cho mọi nút cũ và mới mà vẫn cho phép utility class chuyên biệt (như `cursor-grab` trên drag handle) ghi đè tự nhiên theo cascade của Tailwind v4.

---

## 12. Tổng hợp tệp đã chỉnh sửa / tạo mới (Review 1.13)

- **Backend Rust:**
  - `crates/knit-docs/src/world.rs` (Sửa `introspector.page(loc)` + `query_block_pages` + unit test chèn TOC giữa tài liệu)
  - `crates/knit-archive/src/lib.rs`, `crates/knit-archive/tests/archive_tests.rs` (`ArchiveEstimate` & `estimate_archive_output` + unit test)
  - `crates/knit-manga/src/models.rs`, `crates/knit-manga/src/scanner.rs`, `crates/knit-manga/tests/manga_tests.rs` (Thêm `total_bytes` vào `Story` + unit test)
  - `src-tauri/src/lib.rs` (Đăng ký `archive_estimate_size` và `get_file_size_bytes`)
- **Frontend & Helpers:**
  - `src/styles/tokens.css` (Quy tắc `cursor: pointer` toàn cục cho button)
  - `src/types/ipc.ts`, `src/lib/ipc.ts` (Type & wrapper `estimateArchiveSize`, `getFileSizeBytes`, `Story.total_bytes`)
  - `src/lib/bookmarks.ts`, `src/lib/bookmarks.test.ts` (`moveBookmarkNode`, `validateBookmarks`, `bookmarkPathKey` + unit tests)
  - `src/lib/sizeEstimate.ts`, `src/lib/sizeEstimate.test.ts` (Ước lượng dung lượng đầu ra + unit tests)
  - `src/hooks/useVerticalResize.ts`, `src/hooks/useVerticalResize.test.tsx`, `src/hooks/useHorizontalRatioResize.ts`, `src/hooks/useHorizontalRatioResize.test.tsx` (Hỗ trợ `max?: number` tùy chọn và chế độ `cssVar` rAF không re-render khi kéo)
  - `src/components/BookmarkPageBadge.tsx`, `src/components/BookmarkTreeEditor.tsx`, `src/components/NumberInput.tsx`, `src/components/PdfPageCards.tsx`, `src/components/ExportFilenameControl.tsx`, `src/components/Review113Components.test.tsx`
  - `src/views/Image2PdfView.tsx`, `src/views/image2pdf/ImagePageCard.tsx`, `src/views/image2pdf/ImagePreviewModal.tsx`, `src/views/image2pdf/ImageContextMenu.tsx`
  - `src/views/PdfOpsView.tsx`, `src/views/pdf-ops/LoadedPdfList.tsx`, `src/views/pdf-ops/PdfMergePane.tsx`, `src/views/pdf-ops/PdfSplitPane.tsx`, `src/views/pdf-ops/SplitSectionCard.tsx`
  - `src/views/Docs2PdfView.tsx`, `src/views/docs2pdf/Docs2PdfSettingsCard.tsx`
  - `src/views/ArchiveView.tsx`, `src/views/MangaPackView.tsx`
  - `src/i18n/{types,vi,en}.ts` (Khóa dịch song ngữ Việt - Anh)

---

## 13. Kết quả kiểm thử (sau lần chỉnh sửa cuối cùng)

Lệnh đã chạy: `cargo test --workspace && cargo check -p knit-desktop && pnpm build && pnpm test`

| Hạng mục kiểm tra | Lệnh thực thi | Kết quả | Ghi chú |
|---|---|---|---|
| Rust Core Crates Test | `cargo test --workspace` | **49 passed, 0 failed** | `knit-archive` (5), `knit-core` (7), `knit-docs` (12), `knit-manga` (5), `knit-pdf` (14), `knit-renamer` (6) |
| Tauri Desktop Crate Check | `cargo check -p knit-desktop` | **Pass (exit 0)** | IPC handlers và capabilities hợp lệ |
| Frontend TypeCheck & Build | `pnpm build` | **Pass (exit 0)** | `tsc --noEmit` & `vite build` thành công |
| Frontend Vitest Suite | `pnpm test` | **18 files passed, 54 tests passed** | Bao gồm test mới cho `sizeEstimate`, `bookmarks`, `useVerticalResize`, `useHorizontalRatioResize`, `Review113Components` |

### Phạm vi kiểm thử thực tế chưa tự động hóa được trong CLI:
- Thao tác kéo thả trực tiếp cây Bookmark (trên/giữa/dưới để đổi thứ tự và lồng cấp), kéo dãn thanh chia tỷ lệ ngang giữa lưới ảnh và Bookmark Tree, hiệu ứng `sticky` khi cuộn danh sách ảnh dài trong WebView2/WebKitGTK.
- Thao tác chuột phải mở `ImageContextMenu` và kiểm tra clipboard hệ điều hành trên cửa sổ desktop Tauri thật.
- Kiểm tra trực quan PDF xuất ra với tài liệu Markdown thực tế có mục lục chèn ở trang giữa.
