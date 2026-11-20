export const IMAGE_GRID_GAP_PX = 12;

export type CardSizePreset = "small" | "medium" | "large";

export interface VisibleRowRange {
  startRow: number;
  endRow: number;
  rowCount: number;
  topPadPx: number;
  bottomPadPx: number;
}

/**
 * Tính phạm vi hàng hiển thị (inclusive) cho lưới virtualized dựa trên vị trí
 * viewport tương đối so với container ngoài của lưới.
 */
export function computeVisibleRowRange(params: {
  totalItems: number;
  gridCols: number;
  rowStride: number;
  gridRectTop: number;
  scrollRectTop: number;
  viewportHeight: number;
  overscanRows?: number;
}): VisibleRowRange {
  const {
    totalItems,
    gridCols,
    rowStride,
    gridRectTop,
    scrollRectTop,
    viewportHeight,
    overscanRows = 3,
  } = params;

  const cols = Math.max(1, gridCols);
  const rowCount = Math.ceil(totalItems / cols);
  if (rowCount === 0) {
    return {
      startRow: 0,
      endRow: -1,
      rowCount: 0,
      topPadPx: 0,
      bottomPadPx: 0,
    };
  }

  const safeStride = Math.max(1, rowStride);

  // Trong môi trường test (jsdom) hoặc trước khi layout hoàn tất, viewportHeight có thể bằng 0
  if (viewportHeight <= 0) {
    const endRow = Math.min(rowCount - 1, 15);
    return {
      startRow: 0,
      endRow,
      rowCount,
      topPadPx: 0,
      bottomPadPx: Math.max(0, (rowCount - 1 - endRow) * safeStride),
    };
  }

  const visibleStartY = scrollRectTop - gridRectTop;
  const visibleEndY = visibleStartY + viewportHeight;

  const firstVisible = Math.max(
    0,
    Math.min(rowCount - 1, Math.floor(visibleStartY / safeStride)),
  );
  const lastVisible = Math.max(
    firstVisible,
    Math.min(rowCount - 1, Math.floor(Math.max(0, visibleEndY) / safeStride)),
  );

  const startRow = Math.max(0, firstVisible - overscanRows);
  const endRow = Math.min(rowCount - 1, lastVisible + overscanRows);

  return {
    startRow,
    endRow,
    rowCount,
    topPadPx: startRow * safeStride,
    bottomPadPx: Math.max(0, (rowCount - 1 - endRow) * safeStride),
  };
}

/**
 * Xác định chỉ số chèn [0..totalItems] trong O(1) dựa trên tọa độ con trỏ và rect lưới,
 * tránh gọi getBoundingClientRect() trên toàn bộ N cards khi kéo thả.
 */
export function hitTestGridInsertIndex(params: {
  clientX: number;
  clientY: number;
  gridLeft: number;
  gridTop: number;
  gridWidth: number;
  gridCols: number;
  gapPx: number;
  rowStride: number;
  totalItems: number;
}): number | null {
  const {
    clientX,
    clientY,
    gridLeft,
    gridTop,
    gridWidth,
    gridCols,
    gapPx,
    rowStride,
    totalItems,
  } = params;

  if (totalItems <= 0 || gridWidth <= 0 || rowStride <= 0) return null;

  const cols = Math.max(1, gridCols);
  const rowCount = Math.ceil(totalItems / cols);
  const colWidth = Math.max(1, (gridWidth - gapPx * (cols - 1)) / cols);
  const colSpan = colWidth + gapPx;

  const relX = clientX - gridLeft;
  const relY = clientY - gridTop;

  const row = Math.max(0, Math.min(rowCount - 1, Math.floor(relY / rowStride)));
  const col = Math.max(0, Math.min(cols - 1, Math.floor(relX / colSpan)));

  const cardIdx = row * cols + col;
  if (cardIdx >= totalItems) {
    return totalItems;
  }

  const inCardX = relX - col * colSpan;
  return inCardX < colWidth / 2 ? cardIdx : cardIdx + 1;
}

export const THUMB_CACHE_MAX_ENTRIES = 500;

/**
 * Hợp nhất batch thumbnail mới vào cache với giới hạn LRU `maxEntries`,
 * ưu tiên giữ lại các ID đang nằm trong viewport (`protectedIds`) trước khi
 * đẩy các mục cũ nhất ra khỏi RAM.
 */
export function mergeThumbCacheLru(
  prev: Record<string, string>,
  batch: Record<string, string>,
  maxEntries: number = THUMB_CACHE_MAX_ENTRIES,
  protectedIds?: ReadonlySet<string>,
): { nextCache: Record<string, string>; evictedIds: string[] } {
  const limit = Math.max(1, maxEntries);
  const nextCache: Record<string, string> = {};

  for (const [k, v] of Object.entries(prev)) {
    if (!(k in batch)) {
      nextCache[k] = v;
    }
  }
  for (const [k, v] of Object.entries(batch)) {
    nextCache[k] = v;
  }

  const keys = Object.keys(nextCache);
  const overflow = keys.length - limit;
  if (overflow <= 0) {
    return { nextCache, evictedIds: [] };
  }

  const evictedIds: string[] = [];
  // Lượt 1: ưu tiên xóa mục cũ nhất không nằm trong viewport và không nằm trong batch vừa tải
  for (const k of keys) {
    if (evictedIds.length >= overflow) break;
    if (k in batch || protectedIds?.has(k)) continue;
    delete nextCache[k];
    evictedIds.push(k);
  }
  // Lượt 2 (hiếm khi xảy ra nếu viewport > limit): xóa theo FIFO nếu vẫn vượt giới hạn
  if (evictedIds.length < overflow) {
    for (const k of keys) {
      if (evictedIds.length >= overflow) break;
      if (!(k in nextCache) || k in batch) continue;
      delete nextCache[k];
      evictedIds.push(k);
    }
  }

  return { nextCache, evictedIds };
}
