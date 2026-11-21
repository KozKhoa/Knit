import { expect, test } from "@playwright/test";
import { installTauriE2eBridge, type E2eInvocationRecord } from "./tauriMockBridge";

async function getInvocations(page: import("@playwright/test").Page): Promise<E2eInvocationRecord[]> {
  return await page.evaluate(() => {
    const win = window as unknown as { __KNIT_E2E__?: { invocations: E2eInvocationRecord[] } };
    return win.__KNIT_E2E__?.invocations ?? [];
  });
}

test.describe("image2pdf Full-Stack End-to-End (Playwright + Real Rust knit-pdf)", () => {
  test("E2E-01: imports real folder, renders real Rust JPEG thumbnails + bookmarks, writes real PDF on disk & verifies Outlines", async ({
    page,
  }) => {
    const bridge = await installTauriE2eBridge(page, { scanPageCount: 12 });
    await page.goto("/");

    await page.getByRole("button", { name: "Quét thư mục ảnh" }).click();

    await expect(page.getByRole("button", { name: "Xuất PDF (12 trang)" })).toBeEnabled();
    await expect(page.locator("[data-page-id]")).toHaveCount(12);
    await expect(page.locator('[data-bookmark-editor] input[value="Cover"]')).toBeVisible();
    await expect(page.locator('[data-bookmark-editor] input[value="Chap 1"]')).toBeVisible();
    await expect(page.locator('[data-bookmark-editor] input[value="Chap 2"]')).toBeVisible();

    // Wait for real Rust-encoded JPEG thumbnails to decode in Chromium with naturalWidth > 0
    await expect
      .poll(async () => {
        return await page.evaluate(() => {
          const imgs = Array.from(document.querySelectorAll("[data-page-id] img")) as HTMLImageElement[];
          return imgs.filter(
            (img) =>
              img.complete &&
              img.naturalWidth > 0 &&
              img.src.startsWith("data:image/jpeg;base64,"),
          ).length;
        });
      })
      .toBeGreaterThanOrEqual(4);

    await page.getByRole("button", { name: "Xuất PDF (12 trang)" }).click();
    await expect(page.getByText(/Xuất kết quả hoàn tất: Ảnh sang PDF/)).toBeVisible();

    // Verify streamed log emitted by real knit-pdf packer appears in WorkbenchShell drawer
    await page.getByRole("button", { name: /Nhật ký xử lý/ }).click();
    await expect(
      page.getByText("Processing & writing 12 images -> PDF (mode: Balanced)"),
    ).toBeVisible();

    // Verify real exported PDF binary on disk via lopdf inspection
    const pdfOnDisk = await bridge.inspectPdfOnDisk();
    expect(pdfOnDisk.exists).toBe(true);
    expect(pdfOnDisk.header_magic.startsWith("%PDF-1.")).toBe(true);
    expect(pdfOnDisk.file_size_bytes).toBeGreaterThan(5000);
    expect(pdfOnDisk.page_count).toBe(12);
    expect(pdfOnDisk.bookmarks).toEqual([
      { title: "Cover", target_page_index: 0, children: [] },
      { title: "Chap 1", target_page_index: 1, children: [] },
      { title: "Chap 2", target_page_index: 3, children: [] },
    ]);

    expect(bridge.pageErrors).toEqual([]);
  });

  test("E2E-02: virtualizes 240 real-image page grid and mounts bottom cards + thumbnails on scroll", async ({
    page,
  }) => {
    const bridge = await installTauriE2eBridge(page, { scanPageCount: 240 });
    await page.goto("/");

    await page.getByRole("button", { name: "Quét thư mục ảnh" }).click();
    await expect(page.getByRole("button", { name: "Xuất PDF (240 trang)" })).toBeEnabled();

    const mountedInitial = await page.locator("[data-page-id]").count();
    expect(mountedInitial).toBeGreaterThan(0);
    expect(mountedInitial).toBeLessThan(120);

    await page.evaluate(() => {
      const main = document.querySelector("main");
      if (main) main.scrollTop = main.scrollHeight;
    });

    await expect(page.locator('[data-page-id="p240"]')).toBeVisible();
    const box = await page.locator('[data-page-id="p240"]').boundingBox();
    expect(box).not.toBeNull();
    expect((box?.height ?? 0) > 40).toBe(true);
    expect(bridge.pageErrors).toEqual([]);
  });

  test("E2E-03: reorders single card + multi-selected non-adjacent card group via pointer drag, Undo, and writes real PDF", async ({
    page,
  }) => {
    const bridge = await installTauriE2eBridge(page, {
      scanPageCount: 5,
      includeBookmarks: false,
    });
    await page.goto("/");

    await page.getByRole("button", { name: "Quét thư mục ảnh" }).click();
    await expect(page.locator("[data-page-id]")).toHaveCount(5);

    await page.evaluate(() => {
      const main = document.querySelector("main");
      if (main) main.scrollTop = 360;
    });

    const card1 = page.locator('[data-page-id="p1"]');
    const card2 = page.locator('[data-page-id="p2"]');
    const box1 = await card1.boundingBox();
    const box2 = await card2.boundingBox();
    expect(box1 && box2).toBeTruthy();

    // Drag card p1 past the midpoint of card p2 into slot 2 -> [p2, p1, p3, p4, p5]
    await page.mouse.move(box1!.x + box1!.width / 2, box1!.y + box1!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box2!.x + box2!.width * 0.78, box2!.y + box2!.height / 2, { steps: 12 });
    await page.mouse.up();

    const orderAfterSingleDrag = await page
      .locator("[data-page-id]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-page-id")));
    expect(orderAfterSingleDrag).toEqual(["p2", "p1", "p3", "p4", "p5"]);

    // Enter SelectionMode, click non-adjacent p2 (idx 0) and p3 (idx 2), then drag p2 after p5
    await page.getByRole("button", { name: "Chọn nhiều", exact: true }).click();
    await page.locator('[data-page-id="p2"]').click();
    await page.locator('[data-page-id="p3"]').click();
    await expect(page.getByText("Đang chọn 2 ảnh")).toBeVisible();

    const p2Box = await page.locator('[data-page-id="p2"]').boundingBox();
    const p5Box = await page.locator('[data-page-id="p5"]').boundingBox();
    expect(p2Box && p5Box).toBeTruthy();

    await page.mouse.move(p2Box!.x + p2Box!.width / 2, p2Box!.y + p2Box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(p5Box!.x + p5Box!.width * 0.85, p5Box!.y + p5Box!.height / 2, {
      steps: 14,
    });
    await page.mouse.up();

    const orderAfterGroupDrag = await page
      .locator("[data-page-id]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-page-id")));
    expect(orderAfterGroupDrag).toEqual(["p1", "p4", "p5", "p2", "p3"]);

    // Ctrl+Z Undo restores order before group drag
    await page.keyboard.press("Control+z");
    const orderAfterUndo = await page
      .locator("[data-page-id]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-page-id")));
    expect(orderAfterUndo).toEqual(["p2", "p1", "p3", "p4", "p5"]);

    await page.getByRole("button", { name: "Xuất PDF (5 trang)" }).click();
    await expect(page.getByText(/Xuất kết quả hoàn tất: Ảnh sang PDF/)).toBeVisible();

    const pdfOnDisk = await bridge.inspectPdfOnDisk();
    expect(pdfOnDisk.exists).toBe(true);
    expect(pdfOnDisk.header_magic.startsWith("%PDF-1.")).toBe(true);
    expect(pdfOnDisk.page_count).toBe(5);
    expect(bridge.pageErrors).toEqual([]);
  });

  test("E2E-04: drags horizontal CSS variable splitter (--img-left) and BookmarkTreeEditor height resizer", async ({
    page,
  }) => {
    const bridge = await installTauriE2eBridge(page, { scanPageCount: 6 });
    await page.goto("/");

    await page.getByRole("button", { name: "Quét thư mục ảnh" }).click();
    await expect(page.locator("[data-bookmark-editor]")).toBeVisible();

    await page.evaluate(() => {
      const main = document.querySelector("main");
      if (main) main.scrollTop = 360;
    });

    const vSplitter = page.locator(
      'div[role="separator"][aria-orientation="vertical"][aria-label="Kéo để chỉnh chiều rộng khung ảnh và cây mục lục"]',
    );
    await expect(vSplitter).toBeVisible();

    const initialGridWidth = (await page.locator('[data-page-id="p1"]').locator("..").boundingBox())!
      .width;
    const vBox = (await vSplitter.boundingBox())!;
    const vDragY = vBox.y + Math.min(120, vBox.height / 2);

    // Drag vertical splitter left by 140px
    await page.mouse.move(vBox.x + vBox.width / 2, vDragY);
    await page.mouse.down();
    await page.mouse.move(vBox.x + vBox.width / 2 - 140, vDragY, { steps: 10 });
    await page.mouse.up();

    const nextGridWidth = (await page.locator('[data-page-id="p1"]').locator("..").boundingBox())!
      .width;
    expect(nextGridWidth).toBeLessThan(initialGridWidth - 60);

    // Drag BookmarkTreeEditor horizontal resize handle up by 100px (360px -> ~260px)
    const hScrollBox = page.locator("[data-bookmark-editor] .overflow-y-auto");
    const initialBmHeight = (await hScrollBox.boundingBox())!.height;
    const hHandle = page.locator(
      '[data-bookmark-editor] div[role="separator"][aria-orientation="horizontal"]',
    );
    await hHandle.scrollIntoViewIfNeeded();
    const hBox = (await hHandle.boundingBox())!;

    await page.mouse.move(hBox.x + hBox.width / 2, hBox.y + hBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(hBox.x + hBox.width / 2, hBox.y + hBox.height / 2 - 100, { steps: 10 });
    await page.mouse.up();

    const nextBmHeight = (await hScrollBox.boundingBox())!.height;
    expect(nextBmHeight).toBeLessThan(initialBmHeight - 50);
    expect(bridge.pageErrors).toEqual([]);
  });

  test("E2E-05: guards Rotate double-click, zooms/pans modal, rotates 270deg & exports real rotated page dimensions to PDF", async ({
    page,
  }) => {
    const bridge = await installTauriE2eBridge(page, { scanPageCount: 4 });
    await page.goto("/");

    await page.getByRole("button", { name: "Quét thư mục ảnh" }).click();
    const card1 = page.locator('[data-page-id="p1"]');
    await expect(card1).toBeVisible();

    // Rapid double-click Rotate -> rotates twice (180deg) without opening zoom modal
    await card1.getByTitle("Xoay 90°").dblclick();
    await expect(card1.getByText("Đã sửa")).toBeVisible();
    await expect(page.getByTestId("zoom-pan-viewport")).toHaveCount(0);

    // Rotate one more time (270deg) so 800x1200 becomes 1200x800 landscape in exported PDF
    await card1.getByTitle("Xoay 90°").click();

    // Double-click card1 image body -> opens ImagePreviewModal with ZoomPanViewport
    await card1.locator("img").dblclick({ force: true });
    const viewport = page.getByTestId("zoom-pan-viewport");
    await expect(viewport).toBeVisible();
    await expect(page.getByTestId("zoom-pan-pct")).toHaveText("100%");

    const vpBox = (await viewport.boundingBox())!;
    await page.mouse.move(vpBox.x + vpBox.width / 2, vpBox.y + vpBox.height / 2);
    await page.mouse.wheel(0, -240);
    await expect(page.getByTestId("zoom-pan-pct")).not.toHaveText("100%");

    await page.mouse.down();
    await page.mouse.move(vpBox.x + vpBox.width / 2 + 60, vpBox.y + vpBox.height / 2 + 40, {
      steps: 8,
    });
    await page.mouse.up();

    const transform = await page
      .getByTestId("zoom-pan-stage")
      .evaluate((el) => (el as HTMLElement).style.transform);
    expect(transform).toContain("scale(");
    expect(transform).toContain("translate3d(");

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("zoom-pan-viewport")).toHaveCount(0);

    // Export real PDF and check Page 1 is rotated [1200, 800] vs Page 2 unrotated [800, 1200]
    await page.getByRole("button", { name: "Xuất PDF (4 trang)" }).click();
    await expect(page.getByText(/Xuất kết quả hoàn tất: Ảnh sang PDF/)).toBeVisible();

    const pdfOnDisk = await bridge.inspectPdfOnDisk();
    expect(pdfOnDisk.exists).toBe(true);
    expect(pdfOnDisk.page_count).toBe(4);
    expect(Math.round(pdfOnDisk.page_dimensions_pt[0][0])).toBe(1200);
    expect(Math.round(pdfOnDisk.page_dimensions_pt[0][1])).toBe(800);
    expect(Math.round(pdfOnDisk.page_dimensions_pt[1][0])).toBe(800);
    expect(Math.round(pdfOnDisk.page_dimensions_pt[1][1])).toBe(1200);
    expect(bridge.pageErrors).toEqual([]);
  });

  test("E2E-06: real filesystem missing-file block & default-dir conflict Auto-append writes output_1.pdf on disk", async ({
    page,
  }) => {
    const bridge = await installTauriE2eBridge(page, {
      scanPageCount: 4,
      useFixtureExportDirAsDefault: true,
    });
    await page.goto("/");

    await page.getByRole("button", { name: "Quét thư mục ảnh" }).click();
    await expect(page.locator("[data-page-id]")).toHaveCount(4);

    // Delete real 2nd image file on disk after scanning to simulate file deleted before export
    bridge.deleteImageFileOnDisk(1);

    // Real check_missing_files blocks export when 002.jpg no longer exists on disk
    await page.getByRole("button", { name: "Xuất PDF (4 trang)" }).click();
    await expect(page.getByTestId("missing-image-badge-p2")).toBeVisible();
    await expect(page.getByText(/Không tìm thấy 1 tệp ảnh trên đĩa/)).toBeVisible();
    expect((await getInvocations(page)).some((x) => x.cmd === "pdf_build_from_images")).toBe(false);

    // Remove missing card p2 and create real conflicting output.pdf on disk
    await page.locator('[data-page-id="p2"]').getByTitle("Xóa trang").click();
    bridge.createConflictFileOnDisk("output.pdf");

    await page.getByRole("button", { name: "Xuất PDF (3 trang)" }).click();
    await expect(page.getByText("Tệp đầu ra đã tồn tại")).toBeVisible();

    await page.getByRole("button", { name: "Tự thêm hậu tố (_1, _2)" }).click();
    await expect(page.getByText(/Xuất kết quả hoàn tất: Ảnh sang PDF/)).toBeVisible();

    const uniquePdfPath = `${bridge.fixture.exportDir}/output_1.pdf`;
    const pdfOnDisk = await bridge.inspectPdfOnDisk(uniquePdfPath);
    expect(pdfOnDisk.exists).toBe(true);
    expect(pdfOnDisk.header_magic.startsWith("%PDF-1.")).toBe(true);
    expect(pdfOnDisk.page_count).toBe(3);

    const inv = await getInvocations(page);
    const buildCall = inv.find((x) => x.cmd === "pdf_build_from_images");
    expect((buildCall?.args.config as { output_path?: string })?.output_path).toBe(uniquePdfPath);
    expect(bridge.pageErrors).toEqual([]);
  });

  test("E2E-07: cancels slow export mid-flight and clears workspace + real disk image cache", async ({
    page,
  }) => {
    const bridge = await installTauriE2eBridge(page, {
      scanPageCount: 8,
      slowExportMs: 2500,
    });
    await page.goto("/");

    await page.getByRole("button", { name: "Quét thư mục ảnh" }).click();
    await expect(page.getByRole("button", { name: "Xuất PDF (8 trang)" })).toBeEnabled();

    // Wait for real JPEG thumbnails written by Rust into fixture.cacheDir on disk
    await expect.poll(() => bridge.listCacheFilesOnDisk().length).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Xuất PDF (8 trang)" }).click();
    const cancelBtn = page.getByRole("button", { name: "Hủy tác vụ" });
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    await expect(page.getByText("Tác vụ đã bị hủy bởi người dùng")).toBeVisible();
    expect((await getInvocations(page)).some((x) => x.cmd === "cancel_job")).toBe(true);

    // Clear List calls real clear_image_preview_cache and deletes all .jpg cache files on disk
    await page.getByRole("button", { name: "Xóa danh sách" }).click();
    await expect(page.locator("[data-page-id]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Xuất PDF (0 trang)" })).toBeDisabled();
    await expect.poll(() => bridge.listCacheFilesOnDisk().length).toBe(0);
    expect((await getInvocations(page)).some((x) => x.cmd === "clear_image_preview_cache")).toBe(true);
    expect(bridge.pageErrors).toEqual([]);
  });
});
