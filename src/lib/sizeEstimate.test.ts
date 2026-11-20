import { describe, expect, it } from "vitest";
import type { PageDraft, PdfInfo, Story } from "../types/ipc";
import {
  estimateImage2PdfOutput,
  estimateMangaPackOutput,
  estimatePdfMergeOutput,
  estimatePdfSplitOutput,
} from "./sizeEstimate";

function makeDraft(overrides: Partial<PageDraft> = {}): PageDraft {
  return {
    id: "p1",
    source: { kind: "image_file", path: "/tmp/01.jpg" },
    rotation_deg: 0,
    crop: null,
    annotations: { texts: [], strokes: [] },
    duration_ms: null,
    label: "01.jpg",
    width_px: 1000,
    height_px: 1500,
    file_size_bytes: 500_000,
    ...overrides,
  };
}

describe("sizeEstimate helpers", () => {
  it("estimates Image2PDF size and split file count", () => {
    const pages = [makeDraft({ id: "1" }), makeDraft({ id: "2" }), makeDraft({ id: "3" })];
    const single = estimateImage2PdfOutput({
      pages,
      exportMode: "balanced",
      losslessPassthrough: true,
      jpegQuality: 88,
      splitMode: "none",
      maxMb: "",
      maxPagesPerFile: 2,
    });
    expect(single.estimatedFiles).toBe(1);
    expect(single.estimatedBytes).toBeGreaterThan(1_500_000);

    const splitPages = estimateImage2PdfOutput({
      pages,
      exportMode: "balanced",
      losslessPassthrough: true,
      jpegQuality: 88,
      splitMode: "max_pages_per_file",
      maxMb: "",
      maxPagesPerFile: 2,
    });
    expect(splitPages.estimatedFiles).toBe(2);
  });

  it("estimates PDF Merge and Split outputs", () => {
    const files: PdfInfo[] = [
      { path: "/a.pdf", page_count: 10, file_size_bytes: 1_000_000, bookmarks: [] },
    ];
    const merged = estimatePdfMergeOutput(files, [
      { file_index: 0, page_index: 0, rotation_deg: 0 },
      { file_index: 0, page_index: 1, rotation_deg: 0 },
    ]);
    expect(merged.estimatedFiles).toBe(1);
    expect(merged.estimatedBytes).toBeGreaterThan(200_000);

    const split = estimatePdfSplitOutput({
      files,
      sections: [
        { pages: [{ file_index: 0, page_index: 0, rotation_deg: 0 }] },
        { pages: [{ file_index: 0, page_index: 1, rotation_deg: 0 }] },
      ],
      ruleKind: "every_n_pages",
      everyN: 2,
      splitMaxMb: 10,
    });
    expect(split.estimatedFiles).toBe(2);
  });

  it("estimates Manga Packager output size and part count", () => {
    const gib = 1024 * 1024 * 1024;
    const stories: Story[] = [
      {
        dir_name: "S1",
        path: "/s1",
        info: null,
        info_file: null,
        cover: null,
        chapters: [{ chain: [], folder: "c1", path: "/s1/c1", images: ["1.jpg"] }],
        warnings: [],
        total_bytes: Math.round(0.7 * gib),
      },
      {
        dir_name: "S2",
        path: "/s2",
        info: null,
        info_file: null,
        cover: null,
        chapters: [{ chain: [], folder: "c1", path: "/s2/c1", images: ["1.jpg"] }],
        warnings: [],
        total_bytes: Math.round(0.7 * gib),
      },
    ];
    const res = estimateMangaPackOutput(stories, 0, 1);
    expect(res.estimatedFiles).toBe(2);
    expect(res.estimatedBytes).toBeGreaterThan(Math.round(1.4 * gib));
  });
});
