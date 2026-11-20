import type {
  PageDraft,
  PageSelection,
  PdfExportMode,
  PdfInfo,
  Story,
} from "../types/ipc";
import { hasPageEdits } from "./imageSort";

export interface OutputSizeEstimate {
  estimatedBytes: number;
  estimatedFiles: number;
}

const PDF_OBJECT_OVERHEAD_PER_PAGE = 640;
const PDF_HEADER_TRAILER_OVERHEAD = 4096;

function isJpegOrPngPath(path: string): boolean {
  return /\.(jpe?g|png)$/i.test(path);
}

/**
 * Ước lượng dung lượng & số tệp PDF đầu ra cho Image -> PDF.
 */
export function estimateImage2PdfOutput(params: {
  pages: PageDraft[];
  exportMode: PdfExportMode;
  losslessPassthrough: boolean;
  jpegQuality: number;
  splitMode: "none" | "max_mb" | "max_pages_per_file";
  maxMb: string;
  maxPagesPerFile: number;
}): OutputSizeEstimate {
  const {
    pages,
    exportMode,
    losslessPassthrough,
    jpegQuality,
    splitMode,
    maxMb,
    maxPagesPerFile,
  } = params;
  if (pages.length === 0) return { estimatedBytes: 0, estimatedFiles: 0 };

  const effectivePassthrough = exportMode === "fast" ? true : losslessPassthrough;
  const qualityFactor = Math.max(0.25, Math.min(1.15, 0.35 + (jpegQuality / 100) * 0.65));

  let payloadBytes = 0;
  for (const page of pages) {
    const rawSize =
      page.file_size_bytes && page.file_size_bytes > 0
        ? page.file_size_bytes
        : Math.max(40_000, Math.round((page.width_px * page.height_px) / 4));

    const path = page.source.path;
    const edited = hasPageEdits(page);
    const canPassthrough =
      effectivePassthrough && !edited && page.source.kind === "image_file" && isJpegOrPngPath(path);

    if (canPassthrough) {
      payloadBytes += rawSize;
    } else if (/\.png$/i.test(path) && !edited) {
      payloadBytes += Math.round(rawSize * 0.95);
    } else {
      // Re-encoded to JPEG or rasterized
      payloadBytes += Math.round(rawSize * qualityFactor);
    }
  }

  let estimatedFiles = 1;
  if (exportMode !== "fast") {
    if (splitMode === "max_pages_per_file" && maxPagesPerFile > 0) {
      estimatedFiles = Math.max(1, Math.ceil(pages.length / maxPagesPerFile));
    } else if (splitMode === "max_mb") {
      const parsedMb = Number(maxMb);
      if (Number.isFinite(parsedMb) && parsedMb > 0) {
        const limitBytes = parsedMb * 1024 * 1024;
        estimatedFiles = Math.max(1, Math.ceil(payloadBytes / limitBytes));
      }
    }
  }

  const estimatedBytes =
    payloadBytes +
    pages.length * PDF_OBJECT_OVERHEAD_PER_PAGE +
    estimatedFiles * PDF_HEADER_TRAILER_OVERHEAD;

  return { estimatedBytes, estimatedFiles };
}

function estimateSelectionBytes(files: PdfInfo[], sel: PageSelection): number {
  const f = files[sel.file_index];
  if (!f || f.page_count <= 0) return 0;
  return f.file_size_bytes / f.page_count;
}

/**
 * Ước lượng dung lượng PDF gộp từ danh sách trang đã chọn.
 */
export function estimatePdfMergeOutput(
  files: PdfInfo[],
  selections: PageSelection[],
): OutputSizeEstimate {
  if (files.length === 0 || selections.length === 0) {
    return { estimatedBytes: 0, estimatedFiles: 0 };
  }
  let sum = 0;
  for (const sel of selections) {
    sum += estimateSelectionBytes(files, sel);
  }
  return {
    estimatedBytes: Math.max(1024, Math.round(sum) + PDF_HEADER_TRAILER_OVERHEAD),
    estimatedFiles: 1,
  };
}

/**
 * Ước lượng dung lượng & số tệp đầu ra cho PDF Split (custom sections hoặc quy tắc tự động).
 */
export function estimatePdfSplitOutput(params: {
  files: PdfInfo[];
  sections: { pages: PageSelection[] }[];
  ruleKind: "page_ranges" | "every_n_pages" | "max_bytes";
  everyN: number;
  splitMaxMb: number;
}): OutputSizeEstimate {
  const { files, sections, ruleKind, everyN, splitMaxMb } = params;
  if (files.length === 0) return { estimatedBytes: 0, estimatedFiles: 0 };

  const nonEmptySections = sections.filter((s) => s.pages.length > 0);
  if (nonEmptySections.length > 0) {
    let total = 0;
    for (const sec of nonEmptySections) {
      let secSum = 0;
      for (const p of sec.pages) {
        secSum += estimateSelectionBytes(files, p);
      }
      total += Math.round(secSum) + PDF_HEADER_TRAILER_OVERHEAD;
    }
    return {
      estimatedBytes: total,
      estimatedFiles: nonEmptySections.length,
    };
  }

  const totalInputBytes = files.reduce((acc, f) => acc + f.file_size_bytes, 0);
  const totalPages = files.reduce((acc, f) => acc + f.page_count, 0);
  if (totalPages === 0) return { estimatedBytes: 0, estimatedFiles: 0 };

  let estimatedFiles = files.length;
  if (ruleKind === "every_n_pages" && everyN > 0) {
    estimatedFiles = files.reduce(
      (acc, f) => acc + Math.max(1, Math.ceil(f.page_count / everyN)),
      0,
    );
  } else if (ruleKind === "max_bytes" && splitMaxMb > 0) {
    const limit = splitMaxMb * 1024 * 1024;
    estimatedFiles = files.reduce(
      (acc, f) => acc + Math.max(1, Math.ceil(f.file_size_bytes / limit)),
      0,
    );
  }

  return {
    estimatedBytes: totalInputBytes + estimatedFiles * PDF_HEADER_TRAILER_OVERHEAD,
    estimatedFiles,
  };
}

/**
 * Ước lượng tổng dung lượng & số tệp ZIP đầu ra cho Manga Packager
 * (tái lập thuật toán `group_by_size` nguyên truyện).
 */
export function estimateMangaPackOutput(
  stories: Story[],
  imageCompression: number,
  maxGb: number,
): OutputSizeEstimate {
  if (stories.length === 0) return { estimatedBytes: 0, estimatedFiles: 0 };

  const compFactor = imageCompression <= 0 ? 1.0 : imageCompression <= 3 ? 0.985 : 0.975;
  const totalRaw = stories.reduce((acc, s) => acc + (s.total_bytes ?? 0), 0);
  const totalFilesCount = stories.reduce(
    (acc, s) => acc + s.chapters.reduce((cAcc, ch) => cAcc + ch.images.length, 0) + (s.cover ? 1 : 0),
    0,
  );

  const maxBytes = maxGb > 0 ? maxGb * 1024 * 1024 * 1024 : 0;
  let estimatedFiles = 1;
  if (maxBytes > 0) {
    estimatedFiles = 0;
    let curAcc = 0;
    let hasCur = false;
    for (const s of stories) {
      const sz = s.total_bytes ?? 0;
      if (hasCur && curAcc + sz > maxBytes) {
        estimatedFiles += 1;
        curAcc = 0;
        hasCur = false;
      }
      hasCur = true;
      curAcc += sz;
    }
    if (hasCur) estimatedFiles += 1;
  }

  const estimatedBytes =
    Math.round(totalRaw * compFactor) + totalFilesCount * 96 + estimatedFiles * 1024;

  return {
    estimatedBytes,
    estimatedFiles: Math.max(1, estimatedFiles),
  };
}
