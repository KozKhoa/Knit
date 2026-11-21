# Báo cáo phản hồi & thay đổi — Review Version 1.16

Tài liệu này tổng hợp các thay đổi đã áp dụng cho toàn bộ 12 đầu mục trong `user-review/version-1-16.md`, giải thích nguyên nhân kỹ thuật đằng sau mỗi thay đổi, lý do lựa chọn phương án kiến trúc và kết quả kiểm thử sau lần chỉnh sửa code cuối cùng.

---

## 1. Docs to PDF — Bỏ mở modal khi double click trên phần preview PDF

- **Vấn đề trước đó:** Khi người dùng double click trên khung preview PDF trong công cụ `Docs to PDF`, giao diện tự động bật modal phóng to trang (`PdfPageZoomModal`), gây gián đoạn khi thao tác cuộn, chọn text hoặc click liên tiếp.
- **Nguyên nhân kỹ thuật:** `Docs2PdfView.tsx` và `DocsSplitWorkbench.tsx` duy trì state `zoomPageModal` cùng handler `onDoubleClickPreviewPage` gắn vào phần xem trước PDF để mở `PdfPageZoomModal`.
- **Thay đổi đã áp dụng:** Xóa bỏ `zoomPageModal`, `PdfPageZoomModal` và prop/callback `onDoubleClickPreviewPage` khỏi `src/views/Docs2PdfView.tsx` và `src/views/docs2pdf/DocsSplitWorkbench.tsx`.
- **Lý do chọn cách làm này:** Người dùng đã có sẵn các công cụ thu phóng trực tiếp ngay trên `PdfJsPreview` (kèm phím tắt `Ctrl/Cmd + Scroll` ở mục 11), nên loại bỏ double click mở modal giúp tránh kích hoạt nhầm mà không mất tính năng phóng to/thu nhỏ.

---

## 2. Docs to PDF — Bổ sung resize width giữa editor và preview

- **Vấn đề trước đó:** Trong `Docs to PDF`, người dùng chỉ có thể thay đổi chiều cao dùng chung giữa hai khung Editor và Preview chứ không kéo chỉnh được tỷ lệ độ rộng ngang giữa Editor và Preview.
- **Nguyên nhân kỹ thuật:** Layout chia đôi trong `DocsSplitWorkbench.tsx` cố định phân chia cột theo chiều ngang mà chưa gắn cơ chế điều chỉnh tỷ lệ cột bằng `PaneResizeHandle`.
- **Thay đổi đã áp dụng:** Bổ sung thanh kéo ngang `PaneResizeHandle` kết hợp `useHorizontalRatioResize` với khóa lưu trạng thái `knit.docs.leftRatio` trong `src/views/docs2pdf/DocsSplitWorkbench.tsx` (đồng thời vẫn giữ nguyên thanh kéo chỉnh chiều cao dùng chung giữa hai khung theo trao đổi làm rõ), kèm unit test trong `src/components/Review116Components.test.tsx`.
- **Lý do chọn cách làm này:** Tái sử dụng `PaneResizeHandle` và `useHorizontalRatioResize` sẵn có giúp đồng bộ trải nghiệm kéo thả giữa các công cụ trong ứng dụng và lưu bền vững tỷ lệ cột người dùng ưa thích.

---

## 3. Image2PDF — Hỗ trợ chuyển đổi tệp SVG sang PDF

- **Vấn đề trước đó:** Công cụ `Images to PDF` chưa hỗ trợ nhận và chuyển đổi các tệp ảnh vector `.svg` sang PDF.
- **Nguyên nhân kỹ thuật:** Danh sách phần mở rộng ảnh hỗ trợ (`SUPPORTED_IMAGE_EXTS`) ở `crates/knit-pdf` và bộ lọc chọn file trên giao diện `Image2Pdf` chưa bao gồm `"svg"`, đồng thời pipeline giải mã ảnh raster chưa có trình parse/render SVG.
- **Thay đổi đã áp dụng:**
  - Khai báo dependency `resvg = "0.47"`, `usvg = "0.47"`, `tiny-skia = "0.12"` trong `Cargo.toml` và `crates/knit-pdf/Cargo.toml`.
  - Cập nhật `crates/knit-pdf/src/imaging.rs`: thêm `"svg"` vào `SUPPORTED_IMAGE_EXTS`, triển khai `shared_svg_fontdb`, `parse_svg_tree`, `compute_svg_raster_size`, `inspect_svg_dimensions`, `decode_svg_from_bytes`, và xuất luồng `FlateStream` lossless khi bật `lossless_passthrough`.
  - Cập nhật bộ lọc file và logic giải mã thumbnail / canvas editor cho tệp SVG trong `src/views/image2pdf/Image2PdfSettingsCard.tsx` và `src/views/Image2PdfView.tsx`.
  - Bổ sung integration test `svg_to_pdf_and_animated_gif_unpack_and_richmedia` trong `crates/knit-pdf/tests/pdf_tests.rs`.
- **Lý do chọn cách làm này:** Dùng `usvg` + `resvg` + `tiny-skia` thuần Rust giúp render chính xác đồ họa SVG (kể cả text khi có `shared_svg_fontdb`) mà không phụ thuộc headless browser hay binary ngoài, đồng thời giữ chuẩn kích thước trang và cơ chế passthrough/nén đồng nhất với pipeline ảnh hiện có.

---

## 4. Image2PDF — Tách checkbox Load thumbnail sang khung riêng & thêm tùy chọn vị trí chèn tệp mới

- **Vấn đề trước đó:** Checkbox `loadThumbs` nằm chung trong khung cấu hình xuất PDF dù việc tải ảnh thu nhỏ chỉ phục vụ hiển thị trên giao diện; đồng thời người dùng chưa chọn được chèn file mới thêm lên đầu danh sách hay xuống cuối danh sách.
- **Nguyên nhân kỹ thuật:** `Image2PdfSettingsCard.tsx` gộp cả cấu hình hiển thị (`loadThumbs`) với thông số xuất PDF, còn `appendScanPaths` trong `Image2PdfView.tsx` luôn nối tệp mới vào cuối mảng trang hiện tại.
- **Thay đổi đã áp dụng:**
  - Gỡ bỏ `loadThumbs` khỏi `src/views/image2pdf/Image2PdfSettingsCard.tsx`.
  - Tách một khung `knit-card` riêng (`image2pdf.viewAndImportHeading`) trong `src/views/Image2PdfView.tsx` chứa `loadThumbs` và checkbox mới `prependNewFiles` (`image2pdf.prependNewFilesLabel`).
  - Cập nhật `appendScanPaths` trong `src/views/Image2PdfView.tsx`: khi bật `prependNewFiles`, các trang mới được chèn lên đầu danh sách và toàn bộ bookmark hiện có được tự động tịnh tiến chỉ số trang cho khớp.
  - Bổ sung khóa dịch song ngữ trong `src/i18n/{types,vi,en}.ts` và unit test trong `src/views/Image2PdfView.test.tsx`.
- **Lý do chọn cách làm này:** Tách rạch ròi cài đặt giao diện/nhập liệu khỏi cài đặt export giúp người dùng dễ tìm đúng nhóm cấu hình; việc tự động tịnh tiến bookmark khi chèn đầu danh sách đảm bảo bookmark không bị trỏ nhầm trang sau khi thêm ảnh mới.

---

## 5. Image2PDF — Sửa lỗi GIF Unpack All Frames chỉ lấy frame 0 & hỗ trợ nhúng GIF dạng `/RichMedia` + `/Screen` Annotation

- **Vấn đề trước đó:**
  1. Khi chuyển GIF sang PDF với tùy chọn tách toàn bộ frame (`UnpackAllFrames`), kết quả vẫn chỉ giữ frame đầu tiên (đặc biệt khi người dùng đổi tùy chọn sau khi đã nạp file GIF).
  2. Thiếu chế độ nhúng ảnh GIF động trực tiếp vào PDF dưới dạng luồng media tương tác (`/Screen` hoặc `/RichMedia` Annotation).
- **Nguyên nhân kỹ thuật:**
  - Trước đây backend chưa có hàm `expand_drafts_for_animated_policy`: nếu người dùng nạp `.gif` dưới chế độ lấy frame đầu rồi mới đổi sang `UnpackAllFrames` trước khi Export, React vẫn giữ 1 draft `PageSource::ImageFile` và `build_pdf_from_drafts` không xử lý lại theo `config.animated_policy`.
  - Trên UI, `Image2PdfView.tsx` trước đó chỉ gọi `renderPageDraftPreviewFile` khi `hasPageEdits(page)` đúng, khiến các trang `animated_frame` chưa chỉnh sửa đều gọi `renderImageThumbFile(path)` và hiển thị cùng hình frame 0 trên mọi thẻ.
- **Thay đổi đã áp dụng:**
  - **Backend Rust (`crates/knit-pdf/src/models.rs`, `imaging.rs`, `lib.rs`, `packer.rs`):**
    - Thêm biến thể `AnimatedImagePolicy::EmbedRichMedia`.
    - Mở quyền `pub(crate)` cho `probe_animation_frames`, triển khai và export `expand_drafts_for_animated_policy`, đồng thời luôn gọi `expand_drafts_for_animated_policy(drafts, bookmarks, config.animated_policy)` trong `build_pdf_from_drafts`.
    - Trong `StreamingPdfWriter::write_page`, khi ở chế độ `EmbedRichMedia` cho ảnh GIF động: vừa vẽ Poster frame 0 (`/XObject`), vừa nhúng byte GIF gốc vào `/EmbeddedFile` + `/Filespec`, đồng thời tạo cả `/Screen` Annotation (`/Rendition` + `/MediaClip` MIME `image/gif`) và `/RichMedia` Annotation (`/RichMediaContent` + `/RichMediaSettings`) gắn vào `/Annots` của trang.
  - **Tauri IPC & Frontend (`src-tauri/src/lib.rs`, `src/types/ipc.ts`, `src/lib/ipc.ts`, `src/lib/imageSort.ts`, `src/views/image2pdf/Image2PdfSettingsCard.tsx`, `src/views/Image2PdfView.tsx`):**
    - Thêm Tauri command `pdf_sync_animated_drafts` và wrapper `syncAnimatedDrafts` để `handleChangeAnimatedPolicy` đồng bộ ngay danh sách draft trên UI khi đổi policy.
    - Bổ sung `framePart` (`page.source.kind === "animated_frame" ? page.source.frame_index : -1`) vào `pageEditSignature` trong `src/lib/imageSort.ts` và render preview/thumbnail từng frame bằng `renderPageDraftPreviewFile`.
    - Thêm lựa chọn `"embed_rich_media"` (`image2pdf.animatedEmbedRichMedia`) trên giao diện.
  - **Kiểm thử:** Thêm integration test `svg_to_pdf_and_animated_gif_unpack_and_richmedia` (`make_sample_animated_gif`) trong `crates/knit-pdf/tests/pdf_tests.rs` và unit test trong `src/views/Image2PdfView.test.tsx`.
- **Lý do chọn cách làm này:** Đồng bộ cả hai phía (trên UI khi đổi policy và chốt chặn cuối trong `build_pdf_from_drafts`) đảm bảo không bao giờ lặp lại lỗi sai lệch giữa tùy chọn hiển thị và PDF xuất ra; đồng thời nhúng song song cả `/Screen` và `/RichMedia` kèm Poster frame 0 giúp tệp PDF hiển thị ảnh tĩnh an toàn ở mọi trình đọc và hỗ trợ phát động trên các PDF viewer hỗ trợ Annotation media.

---

## 6. Merge PDF — Không khóa tương tác và scroll của Bookmark tree khi đang export

- **Vấn đề trước đó:** Khi bất kỳ công cụ nào đang export, khung Bookmark tree trong `Merge PDF` bị vô hiệu hóa hoàn toàn, người dùng không thể cuộn hay thao tác chỉnh sửa bookmark.
- **Nguyên nhân kỹ thuật:** Component `PdfMergePane.tsx` ràng buộc `bookmarksDisabled` theo trạng thái `busy` toàn cục từ `WorkbenchShell`, khiến toàn bộ cây bookmark bị khóa trong suốt thời gian có job chạy.
- **Thay đổi đã áp dụng:** Đặt `bookmarksDisabled={false}` trong `src/views/pdf-ops/PdfMergePane.tsx` kết hợp với cơ chế `busy: false` trong `sharedProps` ở `WorkbenchShell.tsx` (Mục 7).
- **Lý do chọn cách làm này:** Dữ liệu của tiến trình đang export đã được chụp snapshot lúc nhấn Export, nên mọi chỉnh sửa bookmark sau thời điểm đó là an toàn tuyệt đối cho job đang chạy và cho phép người dùng chuẩn bị lượt export tiếp theo không bị gián đoạn.

---

## 7. Hỗ trợ Export song song nhiều tiến trình & cảnh báo xung đột đường dẫn đang chạy

- **Vấn đề trước đó:** Toàn bộ ứng dụng chỉ chạy được một tác vụ export tại một thời điểm (khóa hết các tool khác và khóa thao tác ngay trong tool đó). Người dùng không thể vừa chạy export `Image2Pdf` vừa chuyển sang `Pdf Merge` để export, hoặc xóa danh sách ảnh cũ để nạp mới và export tiếp trong khi lượt trước chưa xong.
- **Nguyên nhân kỹ thuật:** `App.tsx` và `WorkbenchShell.tsx` chỉ lưu một `activeJobId` và một object `progress` đơn lẻ, đồng thời đẩy `busy = Boolean(activeJobId)` xuống tất cả view con nên giao diện bị khóa toàn cục và không theo dõi được danh sách đường dẫn đầu ra đang có job ghi.
- **Thay đổi đã áp dụng:**
  - `src/types/ipc.ts`, `src/App.tsx`, `src/components/WorkbenchShell.tsx`: thay thế state đơn lẻ bằng mảng `runningJobs: RunningJobInfo[]`, truyền `busy: false` qua `sharedProps`, quản lý `activeExportPaths`, định tuyến sự kiện tiến trình theo từng `jobId` qua `onStartJob`/`onJobEvent`/`onFinishJob`, và hiển thị danh sách banner tiến trình xếp chồng với nút Cancel riêng cho từng job.
  - `src/lib/exportPath.ts`: bổ sung `normalizeComparePath`, `findActiveExportConflicts`, `resolveUniqueNonActiveExportPath` để phát hiện trùng lặp đường dẫn đích với các tiến trình đang chạy.
  - `src/components/ExportConflictModal.tsx`: thêm prop `isLockedByActiveJob?: boolean`; khi trùng đường dẫn với tiến trình đang chạy, ẩn nút "Overwrite" và hiển thị thông báo `common.exportActiveJobConflictTitle` / `common.exportActiveJobConflictDesc` (chỉ giữ tùy chọn tự thêm hậu tố hoặc quay lại đổi tên).
  - Toàn bộ các tool (`Docs2PdfView.tsx`, `Image2PdfView.tsx`, `PdfOpsView.tsx` cho cả Merge & Split, `ArchiveView.tsx`, `MangaPackView.tsx`, `RenamerView.tsx`): chụp snapshot payload đầu vào tại thời điểm bấm Export và kiểm tra `activeExportPaths` trước khi khởi chạy job.
- **Lý do chọn cách làm này:** Snapshot payload giúp tách biệt hoàn toàn dữ liệu đang chạy nền với state tương tác trên UI (người dùng có thể xóa/sửa danh sách ngay lập tức cho lượt export kế tiếp mà không gây race condition), còn khóa nút Overwrite khi trùng đường dẫn đang chạy giúp ngăn lỗi xung đột file trên hệ điều hành.

---

## 8. PDF Merge & Split — Bổ sung resize width giữa vùng Pages/Files và Bookmark tree

- **Vấn đề trước đó:** Trong `PDF Merge`, tỷ lệ bề rộng giữa danh sách pages/files và khung Bookmark tree bị cố định, không co giãn linh hoạt theo số lượng trang hoặc độ dài tiêu đề bookmark.
- **Nguyên nhân kỹ thuật:** Layout chia cột trong `PdfMergePane.tsx` chưa gắn `PaneResizeHandle` cho chiều ngang.
- **Thay đổi đã áp dụng:** Bổ sung thanh kéo ngang `PaneResizeHandle` với khóa `knit.pdfops.mergeLeftRatio` giữa vùng hiển thị pages/files và Bookmark tree trong `src/views/pdf-ops/PdfMergePane.tsx`, kèm unit test trong `src/components/Review116Components.test.tsx`.
- **Lý do chọn cách làm này:** Dùng cùng cơ chế `PaneResizeHandle` giúp giữ UI nhất quán với phần còn lại của ứng dụng và lưu tỷ lệ kích thước theo từng người dùng.

---

## 9. PDF Merge (chế độ hiển thị File) — Double click mở modal xem đầy đủ file PDF

- **Vấn đề trước đó:** Khi ở chế độ hiển thị theo File (`Files` mode) trong `PDF Merge`, việc double click vào thẻ file PDF chỉ mở modal zoom ảnh bìa (trang đầu tiên) thay vì cho phép xem nội dung toàn bộ file PDF như khung preview của `Docs2Pdf`.
- **Nguyên nhân kỹ thuật:** Handler double click của thẻ file gọi `openZoomModal(src.path, 0, 0)` giống chế độ từng trang lẻ, chưa có modal tích hợp `PdfJsPreview` cho một file PDF trên ổ đĩa.
- **Thay đổi đã áp dụng:**
  - Thêm Tauri command `read_pdf_file_bytes` trong `src-tauri/src/lib.rs` và wrapper `readPdfFileBytes` trong `src/lib/ipc.ts`.
  - Tạo mới `src/components/PdfFilePreviewModal.tsx` dùng `readPdfFileBytes` kết hợp `PdfJsPreview` và `DocumentFindBar`.
  - Cập nhật `src/views/pdf-ops/PdfMergePane.tsx` và `src/views/PdfOpsView.tsx` để mở `PdfFilePreviewModal` khi double click vào thẻ file PDF ở chế độ File.
- **Lý do chọn cách làm này:** Tái sử dụng trực tiếp `PdfJsPreview` và `DocumentFindBar` giúp người dùng xem nhiều trang, thu phóng và tìm kiếm văn bản trong file PDF mượt mà, đồng bộ hoàn toàn với trải nghiệm bên `Docs2Pdf`.

---

## 10. Phím tắt `Alt + Click` để gắn Bookmark nhanh

- **Vấn đề trước đó:** Ở các công cụ có thiết lập bookmark (`Image2Pdf` và `PDF Merge`), người dùng phải thực hiện nhiều thao tác thủ công để tạo bookmark tại một trang/ảnh/file cụ thể.
- **Nguyên nhân kỹ thuật:** Các card ảnh/trang/file chưa lắng nghe tổ hợp `Alt + Click` để gán bookmark tại vị trí tương ứng.
- **Thay đổi đã áp dụng:**
  - `src/views/Image2PdfView.tsx`: bổ sung xử lý `Alt + Click` trong `handleCardPointerDown` để gắn bookmark cho trang tương ứng và chặn kích hoạt double-click bằng `if (e.altKey) return` trong `handleCardDoubleClick`.
  - `src/components/PdfPageCards.tsx` và `src/views/pdf-ops/PdfMergePane.tsx`: bổ sung hỗ trợ `Alt + Click` gắn bookmark cho cả Page card và File card, kèm kiểm tra `e.altKey` tránh mở modal nhầm khi thao tác nhanh.
  - Bổ sung unit test trong `src/views/Image2PdfView.test.tsx` và `src/components/Review116Components.test.tsx`.
- **Lý do chọn cách làm này:** Bắt sự kiện `Alt + Click` trên pointer down và chặn double click khi giữ `Alt` cho phép người dùng đánh dấu bookmark liên tiếp tốc độ cao mà không bị bật modal hay thay đổi vùng chọn ngoài ý muốn.

---

## 11. Docs to PDF Preview — `Ctrl/Cmd + Scroll` để zoom & nâng giới hạn height lên 4000px

- **Vấn đề trước đó:** Khung preview PDF trong `Docs to PDF` chưa hỗ trợ thao tác quen thuộc giữ `Ctrl` (hoặc `Cmd`) + lăn chuột để thu phóng, và chiều cao tối đa của khung preview bị giới hạn thấp hơn nhu cầu xem tài liệu dài.
- **Nguyên nhân kỹ thuật:** `PdfJsPreview.tsx` chưa gắn listener `wheel` với `passive: false` để chặn cuộn trang và tính tỷ lệ zoom mới; đồng thời cấu hình resize chiều cao trong `DocsSplitWorkbench.tsx` đặt trần `max` thấp hơn `4000`.
- **Thay đổi đã áp dụng:**
  - `src/components/PdfJsPreview.tsx`: thêm listener `wheel` (`{ passive: false }`) bắt `Ctrl/Cmd + Scroll` để ngăn cuộn trang mặc định và điều chỉnh tỷ lệ zoom trong khoảng `0.4` đến `3.0`.
  - `src/views/docs2pdf/DocsSplitWorkbench.tsx`: đặt giới hạn tối đa chiều cao dùng chung `max: 4000` (`4000px`).
  - Bổ sung unit test trong `src/components/Review116Components.test.tsx`.
- **Lý do chọn cách làm này:** Bắt sự kiện `wheel` trực tiếp dạng non-passive đảm bảo trình duyệt không vừa zoom vừa cuộn trang, còn dải zoom `0.4`–`3.0` và trần `4000px` cho không gian xem trước rộng rãi trên cả màn hình lớn lẫn màn hình dọc.

---

## 12. Archive Manager — Preview cấu trúc cây thư mục trước khi nén, hỗ trợ xóa & kéo-thả sắp xếp (không rename/edit)

- **Vấn đề trước đó:** `Archive Manager` trước đây chỉ lấy danh sách đường dẫn đầu vào để estimate và nén trực tiếp, người dùng không xem được cấu trúc cây thư mục trong file nén kết quả, không loại bỏ lẻ từng file/folder trong cấu trúc đó và không kéo-thả sắp xếp vị trí thư mục/tệp trước khi nén.
- **Nguyên nhân kỹ thuật:** `crates/knit-archive` và `src-tauri` chưa tách bước thu thập danh sách entry đầu vào (`ArchiveEntrySpec`) thành API cho phép UI dựng cây chỉnh sửa rồi truyền ngược danh sách tùy biến đó vào bước estimate và pack.
- **Thay đổi đã áp dụng:**
  - **Backend (`crates/knit-archive/src/lib.rs`, `src-tauri/src/lib.rs`):** derive `Serialize, Deserialize` cho `ArchiveEntrySpec`, bổ sung `estimate_archive_entries`, thêm command `archive_collect_entries`, và mở rộng `archive_estimate_size` / `archive_pack` nhận tham số `custom_entries: Option<Vec<ArchiveEntrySpec>>`.
  - **IPC & Cấu trúc dữ liệu cây (`src/types/ipc.ts`, `src/lib/ipc.ts`, `src/lib/archiveTree.ts`, `src/lib/archiveTree.test.ts`):** định nghĩa `ArchiveEntrySpec`, hàm `collectArchiveEntries`, và các hàm thao tác cây bất biến: `buildArchiveTreeFromEntries`, `flattenArchiveTreeToEntries`, `countArchiveFilesAndBytes`, `collectArchiveFolderKeys`, `flattenVisibleArchiveRows`, `deleteArchiveNodeAtPath`, `moveArchiveNode` (hỗ trợ vị trí `before`/`after`/`inside`, chặn kéo thả thư mục vào chính nhánh con của nó, và chống trùng tên không phân biệt chữ hoa/thường).
  - **Giao diện (`src/components/ArchiveTreeEditor.tsx`, `src/views/ArchiveView.tsx`, `src/i18n/{types,vi,en}.ts`):** xây dựng `ArchiveTreeEditor` có danh sách ảo hóa (virtualized), nút `Trash2` xóa file/folder, kéo-thả sắp xếp/lồng thư mục tương tự Bookmark tree, Expand/Collapse All, kéo chỉnh chiều cao, nút Undo / `Ctrl+Z`, tuyệt đối không cho phép rename/edit tên file hay thư mục; đồng bộ cây đã chỉnh vào `estimateArchiveSize` và `createArchive` qua `customEntries`.
  - **Kiểm thử:** `src/lib/archiveTree.test.ts` (3 tests) và `src/components/Review116Components.test.tsx`.
- **Lý do chọn cách làm này:** Tách rõ bước thu thập `ArchiveEntrySpec` và cho phép truyền `custom_entries` giúp tính năng estimate dung lượng và tạo file nén phản ánh chính xác 100% những gì người dùng nhìn thấy trên cây preview mà vẫn đảm bảo logic nén và ghi nguyên tử an toàn trong Rust crate.

---

## 13. Tổng hợp tệp đã chỉnh sửa / tạo mới

- **Backend Rust:**
  - `Cargo.toml`, `Cargo.lock` (Khai báo `resvg`, `usvg`, `tiny-skia` từ lockfile hiện có cho SVG rendering)
  - `crates/knit-pdf/Cargo.toml` (Bổ sung dependencies `resvg`, `usvg`, `tiny-skia`)
  - `crates/knit-pdf/src/models.rs` (Thêm `AnimatedImagePolicy::EmbedRichMedia`)
  - `crates/knit-pdf/src/imaging.rs` (Hỗ trợ parse/rasterize/passthrough SVG, `pub(crate) probe_animation_frames`, `expand_drafts_for_animated_policy`)
  - `crates/knit-pdf/src/lib.rs` (Re-export `expand_drafts_for_animated_policy` từ `imaging`)
  - `crates/knit-pdf/src/packer.rs` (Gọi `expand_drafts_for_animated_policy` trong `build_pdf_from_drafts`; ghi Poster + `/EmbeddedFile` + `/Screen` + `/RichMedia` trong `StreamingPdfWriter::write_page`)
  - `crates/knit-pdf/tests/pdf_tests.rs` (Bổ sung `make_sample_animated_gif` và test `svg_to_pdf_and_animated_gif_unpack_and_richmedia`)
  - `crates/knit-archive/src/lib.rs` (Derive `Serialize, Deserialize` cho `ArchiveEntrySpec`; thêm `estimate_archive_entries`)
  - `src-tauri/src/lib.rs` (Thêm `pdf_sync_animated_drafts`, `read_pdf_file_bytes`, `archive_collect_entries`; cập nhật `archive_estimate_size` và `archive_pack` nhận `custom_entries`)
- **Frontend & Helpers:**
  - `src/App.tsx`, `src/components/WorkbenchShell.tsx` (Quản lý danh sách `runningJobs: RunningJobInfo[]`, `busy: false`, `activeExportPaths`, định tuyến tiến trình theo từng `jobId` và banner song song)
  - `src/components/ExportConflictModal.tsx` (`isLockedByActiveJob` ẩn Overwrite khi trùng file đang export)
  - `src/components/PdfJsPreview.tsx` (`Ctrl/Cmd + Scroll` zoom trong khoảng `0.4`–`3.0`)
  - `src/components/PdfPageCards.tsx` (Hỗ trợ `Alt + Click` gắn bookmark và tránh mở nhầm double click)
  - `src/components/PdfFilePreviewModal.tsx` *(tạo mới)* (Modal xem toàn bộ file PDF với `readPdfFileBytes`, `PdfJsPreview`, `DocumentFindBar`)
  - `src/components/ArchiveTreeEditor.tsx` *(tạo mới)* (Trình xem & chỉnh cấu trúc cây Archive ảo hóa: kéo-thả sắp xếp, xóa node, Undo, không rename)
  - `src/lib/archiveTree.ts`, `src/lib/archiveTree.test.ts` *(tạo mới)* (Logic dựng/phẳng hóa/xóa/di chuyển cây Archive bất biến và unit test)
  - `src/lib/exportPath.ts` (`normalizeComparePath`, `findActiveExportConflicts`, `resolveUniqueNonActiveExportPath`)
  - `src/lib/imageSort.ts` (`framePart` trong `pageEditSignature` cho các trang `animated_frame`)
  - `src/lib/ipc.ts`, `src/types/ipc.ts` (`"embed_rich_media"`, `ArchiveEntrySpec`, `RunningJobInfo`, `syncAnimatedDrafts`, `readPdfFileBytes`, `collectArchiveEntries`, `customEntries`)
  - `src/i18n/{types,vi,en}.ts` (Khóa dịch song ngữ Việt - Anh cho các tính năng mới)
  - `src/views/Docs2PdfView.tsx`, `src/views/docs2pdf/DocsSplitWorkbench.tsx` (Bỏ zoom modal double click, resize ngang `knit.docs.leftRatio`, max height `4000`, snapshot export song song)
  - `src/views/Image2PdfView.tsx`, `src/views/image2pdf/Image2PdfSettingsCard.tsx`, `src/views/Image2PdfView.test.tsx` (SVG import, tách khung View/Import + `prependNewFiles`, GIF `UnpackAllFrames` + `embed_rich_media`, `Alt + Click`, snapshot export song song, unit tests)
  - `src/views/PdfOpsView.tsx`, `src/views/pdf-ops/PdfMergePane.tsx` (Mở khóa bookmark tree, resize ngang `knit.pdfops.mergeLeftRatio`, `PdfFilePreviewModal`, `Alt + Click`, snapshot export song song)
  - `src/views/ArchiveView.tsx`, `src/views/MangaPackView.tsx`, `src/views/RenamerView.tsx` (Tích hợp `ArchiveTreeEditor` + `customEntries` ở Archive; đồng bộ chữ ký & snapshot export song song ở cả 3 view)
  - `src/components/Review116Components.test.tsx` *(tạo mới)* (Unit tests tổng hợp cho các thay đổi UI của Review 1.16)

---

## 14. Kết quả kiểm thử (sau lần chỉnh sửa cuối cùng)

Lệnh đã chạy: `cargo test --workspace && cargo check -p knit-desktop && pnpm build && pnpm test`

| Hạng mục kiểm tra | Lệnh thực thi | Kết quả | Ghi chú |
|---|---|---|---|
| Rust Core Crates Test | `cargo test --workspace` | **55 passed, 0 failed** | `knit-archive` (5), `knit-core` (7), `knit-docs` (14), `knit-manga` (5), `knit-pdf` (18), `knit-renamer` (6), `knit-desktop-lib` (0 failed) |
| Tauri Desktop Crate Check | `cargo check -p knit-desktop` | **Pass (exit 0)** | Biên dịch kiểm tra `knit-desktop` thành công trong `0.21s` |
| Frontend TypeCheck & Build | `pnpm build` | **Pass (exit 0)** | `tsc --noEmit` & `vite build` (`3300 modules transformed`, `18.21s`) |
| Frontend Vitest Suite | `pnpm test` | **23 files passed, 87 tests passed** | 0 failed, 0 skipped (`4.43s`) |

### Phạm vi kiểm thử thực tế chưa tự động hóa được trong CLI:
- Kiểm tra phát lại ảnh GIF động nhúng dạng `/Screen` và `/RichMedia` trên các phần mềm đọc PDF desktop thực tế (như Adobe Acrobat / Foxit Reader).
- Cảm nhận thao tác kéo thả chuột trên `PaneResizeHandle` (tỷ lệ cột ngang & chiều cao tối đa `4000px`), kéo-thả sắp xếp trên `ArchiveTreeEditor`, thao tác `Ctrl/Cmd + Scroll` zoom trên `PdfJsPreview`, và thao tác giữ `Alt + Click` gắn bookmark trên cửa sổ Tauri thật.
- Chạy đồng thời nhiều tiến trình export nặng trên UI thật (ví dụ export `Image2Pdf` song song với `PdfMerge` hoặc export 2 lượt liên tiếp trùng tên file đang chạy để kiểm tra trải nghiệm modal khóa Overwrite và tiến trình hủy từng job).
