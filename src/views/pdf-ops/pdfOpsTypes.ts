import type { PageSelection, PdfInfo } from "../../types/ipc";

export const PDF_GRID_COL_OPTIONS = [2, 3, 4, 5, 6, 8] as const;

export type PdfMergeMode = "per_page" | "per_file";

export interface PerPageContiguityResult {
  intact: boolean;
  fileOrder: number[];
  reason?: "interleaved" | "edited";
}

/**
 * Checks whether per-page `selections` consist solely of intact, contiguous,
 * unrotated `0..page_count-1` blocks for each imported PDF (in any file order).
 */
export function analyzePerPageContiguity(
  selections: PageSelection[],
  files: PdfInfo[],
): PerPageContiguityResult {
  const defaultOrder = files.map((_, idx) => idx);
  if (files.length === 0) return { intact: true, fileOrder: [] };

  const seenFiles = new Set<number>();
  const fileOrder: number[] = [];
  let i = 0;

  while (i < selections.length) {
    const fileIdx = selections[i].file_index;
    const fileInfo = files[fileIdx];
    if (!fileInfo || seenFiles.has(fileIdx)) {
      return { intact: false, fileOrder: defaultOrder, reason: "interleaved" };
    }
    seenFiles.add(fileIdx);
    fileOrder.push(fileIdx);

    const expectedCount = fileInfo.page_count;
    if (i + expectedCount > selections.length) {
      return { intact: false, fileOrder: defaultOrder, reason: "edited" };
    }
    for (let p = 0; p < expectedCount; p++) {
      const sel = selections[i + p];
      if (sel.file_index !== fileIdx) {
        return { intact: false, fileOrder: defaultOrder, reason: "interleaved" };
      }
      if (sel.page_index !== p || ((sel.rotation_deg % 360) + 360) % 360 !== 0) {
        return { intact: false, fileOrder: defaultOrder, reason: "edited" };
      }
    }
    i += expectedCount;
  }

  for (let fIdx = 0; fIdx < files.length; fIdx++) {
    if (!seenFiles.has(fIdx)) {
      if (files[fIdx].page_count > 0) {
        return { intact: false, fileOrder: defaultOrder, reason: "edited" };
      }
      fileOrder.push(fIdx);
    }
  }

  return { intact: true, fileOrder };
}

/** Builds intact page selections from an ordered list of file indices. */
export function buildSelectionsFromFileOrder(
  fileOrder: number[],
  files: PdfInfo[],
): PageSelection[] {
  const out: PageSelection[] = [];
  for (const fileIdx of fileOrder) {
    const info = files[fileIdx];
    if (!info) continue;
    for (let p = 0; p < info.page_count; p++) {
      out.push({ file_index: fileIdx, page_index: p, rotation_deg: 0 });
    }
  }
  return out;
}

export interface SplitSectionItem {
  uid: string;
  file_index: number;
  page_index: number;
  rotation_deg: number;
}

export interface SplitSectionDraft {
  id: string;
  name: string;
  pages: SplitSectionItem[];
}

export type SplitDragPayload =
  | { kind: "source"; file_index: number; page_index: number }
  | { kind: "source_many"; items: { file_index: number; page_index: number }[] }
  | { kind: "section_item"; sectionId: string; itemIndex: number };

export interface SplitDragVisual {
  label: string;
  count: number;
  fileIndex: number;
  pageIndex: number;
  rotationDeg: number;
  thumbUrl?: string;
  sourceSecId?: string;
  sourceItemIdx?: number;
}

export function sourceKey(fileIndex: number, pageIndex: number): string {
  return `${fileIndex}:${pageIndex}`;
}

export function parseSourceKey(key: string): { fileIndex: number; pageIndex: number } | null {
  const [fStr, pStr] = key.split(":");
  const fileIndex = Number(fStr);
  const pageIndex = Number(pStr);
  if (!Number.isInteger(fileIndex) || !Number.isInteger(pageIndex)) return null;
  return { fileIndex, pageIndex };
}

export function getOrigPdfStem(info: PdfInfo): string {
  return info.path.split(/[\\/]/).pop()?.replace(/\.pdf$/i, "") || "split";
}

export function parsePageRangesClient(spec: string, totalPages: number): number[] | null {
  if (totalPages <= 0) return null;
  const out: number[] = [];
  for (const rawPart of spec.split(",")) {
    const part = rawPart.trim();
    if (!part) continue;
    const dashIdx = part.indexOf("-");
    if (dashIdx >= 0) {
      const a = Number.parseInt(part.slice(0, dashIdx).trim(), 10);
      const b = Number.parseInt(part.slice(dashIdx + 1).trim(), 10);
      if (
        !Number.isFinite(a) ||
        !Number.isFinite(b) ||
        a < 1 ||
        b < 1 ||
        a > totalPages ||
        b > totalPages
      ) {
        return null;
      }
      if (a <= b) {
        for (let p = a; p <= b; p++) out.push(p - 1);
      } else {
        for (let p = a; p >= b; p--) out.push(p - 1);
      }
    } else {
      const p = Number.parseInt(part, 10);
      if (!Number.isFinite(p) || p < 1 || p > totalPages) return null;
      out.push(p - 1);
    }
  }
  return out;
}
