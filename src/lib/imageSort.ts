import type { PageDraft } from "../types/ipc";

export type ImageSortMode = "manual" | "import_order" | "name" | "size" | "type";
export type SortDirection = "asc" | "desc";

const naturalCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function extractFileExtension(path: string): string {
  const fileName = path.split(/[\\/]/).pop() ?? path;
  const dotIdx = fileName.lastIndexOf(".");
  if (dotIdx <= 0 || dotIdx === fileName.length - 1) return "";
  return fileName.slice(dotIdx + 1).toLowerCase();
}

export function extractBaseName(page: PageDraft): string {
  const fileName = page.source.path.split(/[\\/]/).pop();
  return fileName && fileName.length > 0 ? fileName : page.label;
}

export function sortPageDrafts(
  pages: PageDraft[],
  mode: ImageSortMode,
  direction: SortDirection,
  importOrderMap: Readonly<Record<string, number>>,
): PageDraft[] {
  if (mode === "manual" || pages.length <= 1) return pages;

  const sign = direction === "asc" ? 1 : -1;
  const indexed = pages.map((page, idx) => ({ page, idx }));

  indexed.sort((a, b) => {
    let cmp = 0;
    switch (mode) {
      case "import_order": {
        const oa = importOrderMap[a.page.id] ?? a.idx;
        const ob = importOrderMap[b.page.id] ?? b.idx;
        cmp = oa - ob;
        break;
      }
      case "name": {
        cmp = naturalCollator.compare(
          extractBaseName(a.page),
          extractBaseName(b.page),
        );
        if (cmp === 0) {
          cmp = naturalCollator.compare(a.page.label, b.page.label);
        }
        break;
      }
      case "size": {
        cmp = (a.page.file_size_bytes ?? 0) - (b.page.file_size_bytes ?? 0);
        break;
      }
      case "type": {
        cmp = naturalCollator.compare(
          extractFileExtension(a.page.source.path),
          extractFileExtension(b.page.source.path),
        );
        if (cmp === 0) {
          cmp = naturalCollator.compare(
            extractBaseName(a.page),
            extractBaseName(b.page),
          );
        }
        break;
      }
    }

    if (cmp !== 0) return cmp * sign;
    return a.idx - b.idx;
  });

  return indexed.map((entry) => entry.page);
}

export function hasPageEdits(page: PageDraft): boolean {
  const normalizedRot = ((page.rotation_deg % 360) + 360) % 360;
  return (
    normalizedRot !== 0 ||
    page.crop !== null ||
    page.annotations.texts.length > 0 ||
    page.annotations.strokes.length > 0
  );
}

export function pageEditSignature(page: PageDraft): string {
  const rot = ((page.rotation_deg % 360) + 360) % 360;
  const cropKey = page.crop
    ? `${page.crop.x.toFixed(4)},${page.crop.y.toFixed(4)},${page.crop.width.toFixed(4)},${page.crop.height.toFixed(4)}`
    : "-";
  const strokesKey = page.annotations.strokes
    .map(
      (s) =>
        `${s.id}:${s.color_hex}:${s.stroke_width_ratio.toFixed(4)}:${s.points.length}:${
          s.points[0] ? `${s.points[0][0].toFixed(3)},${s.points[0][1].toFixed(3)}` : ""
        }`,
    )
    .join(";");
  const textsKey = page.annotations.texts
    .map(
      (t) =>
        `${t.id}:${t.text}@${t.x.toFixed(3)},${t.y.toFixed(3)}:${t.color_hex}:${t.font_size_ratio.toFixed(4)}`,
    )
    .join(";");
  return `${rot}|${cropKey}|${strokesKey}|${textsKey}`;
}

/**
 * Reorders one page or a multi-selected group of pages so they land contiguously
 * at `insertAtIndex` while preserving the relative order of moved items.
 */
export function reorderSelectedPages(
  pages: PageDraft[],
  selectedIds: ReadonlySet<string>,
  draggedId: string,
  insertAtIndex: number,
): PageDraft[] {
  if (pages.length <= 1) return pages;
  const draggedIdx = pages.findIndex((p) => p.id === draggedId);
  if (draggedIdx < 0) return pages;

  const isMulti = selectedIds.has(draggedId) && selectedIds.size > 1;
  const movingSet = isMulti ? selectedIds : new Set([draggedId]);

  const moving: PageDraft[] = [];
  const remaining: PageDraft[] = [];
  const clampedInsert = Math.max(0, Math.min(pages.length, insertAtIndex));

  let targetRemainingIdx = 0;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (movingSet.has(p.id)) {
      moving.push(p);
    } else {
      remaining.push(p);
      if (i < clampedInsert) {
        targetRemainingIdx += 1;
      }
    }
  }

  if (moving.length === 0) return pages;
  const next = [...remaining];
  next.splice(targetRemainingIdx, 0, ...moving);

  const unchanged = next.every((p, i) => p.id === pages[i]?.id);
  return unchanged ? pages : next;
}
