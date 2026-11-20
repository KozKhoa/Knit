import React from "react";
import {
  AlertTriangle,
  BookmarkPlus,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  GripHorizontal,
  GripVertical,
  Trash2,
  Undo2,
} from "lucide-react";
import { useVerticalResize } from "../hooks/useVerticalResize";
import { useI18n } from "../i18n";
import {
  addChildBookmarkAtPath,
  bookmarkPathKey,
  collectParentBookmarkKeys,
  deleteBookmarkAtPath,
  flattenVisibleBookmarks,
  moveBookmarkNode,
  updateBookmarkAtPath,
  validateBookmarks,
  type BookmarkDropPosition,
  type BookmarkValidationWarning,
} from "../lib/bookmarks";
import { usePersistentState } from "../lib/storage";
import type { BookmarkNode } from "../types/ipc";
import { NumberInput } from "./NumberInput";

interface BookmarkTreeEditorProps {
  nodes: BookmarkNode[];
  totalPages: number;
  onChange: (next: BookmarkNode[]) => void;
  disabled?: boolean;
  /** When true, Ctrl+Z works globally when not typing in an input; otherwise works when focus is inside the bookmark panel. */
  enableGlobalUndoShortcut?: boolean;
}

interface DropTargetState {
  targetPath: number[];
  targetKey: string;
  position: BookmarkDropPosition;
}

const DEFAULT_ROW_STRIDE_PX = 50;
const ROW_GAP_PX = 6;
const OVERSCAN_ROWS = 8;

function isSameOrDescendantPath(source: readonly number[], target: readonly number[]): boolean {
  return target.length >= source.length && source.every((seg, i) => target[i] === seg);
}

export const BookmarkTreeEditor: React.FC<BookmarkTreeEditorProps> = React.memo(({
  nodes,
  totalPages,
  onChange,
  disabled = false,
  enableGlobalUndoShortcut = false,
}) => {
  const { t } = useI18n();
  const [treeHeightPx, setTreeHeightPx] = usePersistentState<number>(
    "knit.img2pdf.bookmarkHeightPx",
    360,
  );
  const { height: liveHeightPx, handlePointerDown: handleResizeStart } = useVerticalResize({
    value: treeHeightPx,
    min: 180,
    onCommit: setTreeHeightPx,
  });

  const [collapsedKeys, setCollapsedKeys] = React.useState<Set<string>>(() => new Set());
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  const undoStackRef = React.useRef<BookmarkNode[][]>([]);
  const [undoCount, setUndoCount] = React.useState(0);
  const titleSessionSnapshotRef = React.useRef<BookmarkNode[] | null>(null);

  const validation = React.useMemo(
    () => validateBookmarks(nodes, totalPages),
    [nodes, totalPages],
  );

  const flatRows = React.useMemo(
    () => flattenVisibleBookmarks(nodes, collapsedKeys),
    [nodes, collapsedKeys],
  );

  const parentKeys = React.useMemo(() => collectParentBookmarkKeys(nodes), [nodes]);
  const hasAnyParents = parentKeys.length > 0;
  const allCollapsed = hasAnyParents && parentKeys.every((k) => collapsedKeys.has(k));

  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const listInnerRef = React.useRef<HTMLDivElement | null>(null);
  const [rowStride, setRowStride] = React.useState<number>(DEFAULT_ROW_STRIDE_PX);
  const rowStrideRef = React.useRef<number>(DEFAULT_ROW_STRIDE_PX);
  rowStrideRef.current = rowStride;

  const [visibleRange, setVisibleRange] = React.useState<{ start: number; end: number }>({
    start: 0,
    end: 24,
  });

  const totalRowsRef = React.useRef(flatRows.length);
  totalRowsRef.current = flatRows.length;

  const recomputeWindow = React.useCallback(() => {
    const total = totalRowsRef.current;
    if (total === 0) {
      setVisibleRange((prev) => (prev.start === 0 && prev.end === 0 ? prev : { start: 0, end: 0 }));
      return;
    }

    const innerEl = listInnerRef.current;
    if (innerEl) {
      const firstRow = innerEl.firstElementChild as HTMLElement | null;
      if (firstRow) {
        const h = firstRow.getBoundingClientRect().height;
        if (h > 24) {
          const nextStride = Math.round(h + ROW_GAP_PX);
          if (Math.abs(nextStride - rowStrideRef.current) > 2) {
            rowStrideRef.current = nextStride;
            setRowStride(nextStride);
          }
        }
      }
    }

    const el = scrollRef.current;
    const stride = rowStrideRef.current;
    const scrollTop = el ? el.scrollTop : 0;
    const viewportH = el && el.clientHeight > 0 ? el.clientHeight : 600;

    const start = Math.max(0, Math.floor(scrollTop / stride) - OVERSCAN_ROWS);
    const end = Math.min(total, Math.ceil((scrollTop + viewportH) / stride) + OVERSCAN_ROWS);
    setVisibleRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  React.useEffect(() => {
    recomputeWindow();
  }, [flatRows.length, liveHeightPx, recomputeWindow]);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let rafId: number | null = null;
    const schedule = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        recomputeWindow();
      });
    };

    el.addEventListener("scroll", schedule, { passive: true });
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    ro?.observe(el);

    return () => {
      el.removeEventListener("scroll", schedule);
      ro?.disconnect();
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [recomputeWindow, nodes.length > 0]);

  const [dragSourceKey, setDragSourceKey] = React.useState<string | null>(null);
  const [dropTarget, setDropTarget] = React.useState<DropTargetState | null>(null);
  const nodesRef = React.useRef(nodes);
  nodesRef.current = nodes;
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const disabledRef = React.useRef(disabled);
  disabledRef.current = disabled;
  const dropTargetRef = React.useRef<DropTargetState | null>(null);
  dropTargetRef.current = dropTarget;
  const dragCleanupRef = React.useRef<(() => void) | null>(null);

  const pushUndoSnapshot = React.useCallback((snapshot: BookmarkNode[]) => {
    const stack = undoStackRef.current;
    stack.push(snapshot);
    if (stack.length > 50) stack.shift();
    setUndoCount(stack.length);
  }, []);

  const handleUndo = React.useCallback(() => {
    if (disabledRef.current) return;
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    setUndoCount(undoStackRef.current.length);
    titleSessionSnapshotRef.current = null;
    onChangeRef.current(prev);
  }, []);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (disabledRef.current) return;
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== "z") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      const insideEditor = Boolean(
        containerRef.current && target instanceof Node && containerRef.current.contains(target),
      );
      if (!enableGlobalUndoShortcut && !insideEditor) return;
      if (undoStackRef.current.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      handleUndo();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enableGlobalUndoShortcut, handleUndo]);

  React.useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
    };
  }, []);

  const handleRowDragStart = React.useCallback(
    (e: React.PointerEvent<HTMLElement>, sourcePath: number[]) => {
      if (disabledRef.current) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      dragCleanupRef.current?.();

      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;
      let latestX = startX;
      let latestY = startY;
      let rafId: number | null = null;

      const hitTestDrop = (clientX: number, clientY: number): DropTargetState | null => {
        const els = document.elementsFromPoint(clientX, clientY);
        for (const el of els) {
          const rowEl = (el as HTMLElement).closest?.("[data-bookmark-path]") as HTMLElement | null;
          if (!rowEl) continue;
          const rawPath = rowEl.dataset.bookmarkPath;
          if (!rawPath) continue;
          const targetPath = rawPath.split(".").map((n) => Number.parseInt(n, 10));
          if (targetPath.some((n) => Number.isNaN(n))) continue;
          if (isSameOrDescendantPath(sourcePath, targetPath)) return null;

          // Nest as child ONLY when pointer is hovering directly on the target row's drag-grip icon
          const gripEl = rowEl.querySelector<HTMLElement>("[data-bookmark-drag-handle]");
          const isHoveringGrip = Boolean(
            gripEl && els.some((hitEl) => hitEl === gripEl || gripEl.contains(hitEl as Node)),
          );
          const rect = rowEl.getBoundingClientRect();
          const relY = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
          const position: BookmarkDropPosition = isHoveringGrip
            ? "inside"
            : relY < 0.5
              ? "before"
              : "after";
          return { targetPath, targetKey: rawPath, position };
        }
        return null;
      };

      const tickDrag = () => {
        rafId = null;
        if (!dragging) return;

        const scrollEl = scrollRef.current;
        if (scrollEl) {
          const sr = scrollEl.getBoundingClientRect();
          const edge = 36;
          let dy = 0;
          if (latestY < sr.top + edge && latestY >= sr.top - 24) {
            dy = -10;
          } else if (latestY > sr.bottom - edge && latestY <= sr.bottom + 24) {
            dy = 10;
          }
          if (dy !== 0) {
            const prevTop = scrollEl.scrollTop;
            scrollEl.scrollTop += dy;
            if (scrollEl.scrollTop !== prevTop) {
              rafId = window.requestAnimationFrame(tickDrag);
            }
          }
        }

        const nextDrop = hitTestDrop(latestX, latestY);
        const prev = dropTargetRef.current;
        if (
          nextDrop?.targetKey !== prev?.targetKey ||
          nextDrop?.position !== prev?.position
        ) {
          dropTargetRef.current = nextDrop;
          setDropTarget(nextDrop);
        }
      };

      const onMove = (ev: PointerEvent) => {
        latestX = ev.clientX;
        latestY = ev.clientY;
        if (!dragging) {
          if (Math.hypot(latestX - startX, latestY - startY) < 4) return;
          dragging = true;
          setDragSourceKey(bookmarkPathKey(sourcePath));
          document.body.style.userSelect = "none";
          document.body.style.cursor = "grabbing";
        }
        if (rafId === null) {
          rafId = window.requestAnimationFrame(tickDrag);
        }
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        if (rafId !== null) {
          window.cancelAnimationFrame(rafId);
          rafId = null;
        }
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        dragCleanupRef.current = null;
      };

      const finish = (ev: PointerEvent) => {
        const finalDrop = dragging
          ? hitTestDrop(ev.clientX, ev.clientY) ?? dropTargetRef.current
          : null;
        cleanup();
        if (dragging && finalDrop) {
          const next = moveBookmarkNode(
            nodesRef.current,
            sourcePath,
            finalDrop.targetPath,
            finalDrop.position,
          );
          if (next !== nodesRef.current) {
            pushUndoSnapshot(nodesRef.current);
            onChangeRef.current(next);
          }
        }
        dropTargetRef.current = null;
        setDragSourceKey(null);
        setDropTarget(null);
      };

      dragCleanupRef.current = cleanup;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    [pushUndoSnapshot],
  );

  const handleTitleFocus = React.useCallback(() => {
    if (titleSessionSnapshotRef.current === null) {
      titleSessionSnapshotRef.current = nodesRef.current;
    }
  }, []);

  const handleTitleBlur = React.useCallback(() => {
    const startSnap = titleSessionSnapshotRef.current;
    titleSessionSnapshotRef.current = null;
    if (startSnap && startSnap !== nodesRef.current) {
      pushUndoSnapshot(startSnap);
    }
  }, [pushUndoSnapshot]);

  const handleUpdateTitle = React.useCallback((path: number[], title: string) => {
    if (disabledRef.current) return;
    onChangeRef.current(updateBookmarkAtPath(nodesRef.current, path, { title }));
  }, []);

  const handleUpdatePage = React.useCallback(
    (path: number[], target_page_index: number) => {
      if (disabledRef.current) return;
      const next = updateBookmarkAtPath(nodesRef.current, path, { target_page_index });
      if (next !== nodesRef.current) {
        pushUndoSnapshot(nodesRef.current);
        onChangeRef.current(next);
      }
    },
    [pushUndoSnapshot],
  );

  const handleDeleteAtPath = React.useCallback(
    (path: number[]) => {
      if (disabledRef.current) return;
      const next = deleteBookmarkAtPath(nodesRef.current, path);
      if (next !== nodesRef.current) {
        pushUndoSnapshot(nodesRef.current);
        onChangeRef.current(next);
      }
    },
    [pushUndoSnapshot],
  );

  const handleAddChildAtPath = React.useCallback(
    (path: number[]) => {
      if (disabledRef.current) return;
      const key = bookmarkPathKey(path);
      setCollapsedKeys((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      const next = addChildBookmarkAtPath(
        nodesRef.current,
        path,
        t.bookmarks.defaultChildSuffix,
      );
      if (next !== nodesRef.current) {
        pushUndoSnapshot(nodesRef.current);
        onChangeRef.current(next);
      }
    },
    [pushUndoSnapshot, t.bookmarks.defaultChildSuffix],
  );

  const handleToggleCollapse = React.useCallback((pathKey: string) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(pathKey)) {
        next.delete(pathKey);
      } else {
        next.add(pathKey);
      }
      return next;
    });
  }, []);

  const handleToggleAllCollapse = React.useCallback(() => {
    if (allCollapsed) {
      setCollapsedKeys(new Set());
    } else {
      setCollapsedKeys(new Set(parentKeys));
    }
  }, [allCollapsed, parentKeys]);

  const addRootBookmark = () => {
    if (disabled) return;
    pushUndoSnapshot(nodes);
    onChange([
      ...nodes,
      {
        title: t.bookmarks.defaultRootTitle(nodes.length + 1),
        target_page_index: 0,
        children: [],
      },
    ]);
  };

  const safeStart = Math.min(visibleRange.start, flatRows.length);
  const safeEnd = Math.min(Math.max(safeStart, visibleRange.end), flatRows.length);
  const visibleSlice = flatRows.slice(safeStart, safeEnd);
  const topPadPx = safeStart * rowStride;
  const bottomPadPx = Math.max(0, (flatRows.length - safeEnd) * rowStride);

  return (
    <div
      ref={containerRef}
      data-bookmark-editor="true"
      className="rounded-[4px] border border-[#DEE2E6] bg-white p-3.5"
    >
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-bold text-[#343A40]">{t.bookmarks.title}</div>
          {validation.totalWarnings > 0 && (
            <span
              data-testid="bookmark-warning-summary"
              className="inline-flex items-center gap-1 rounded-[4px] border border-[#FFC107] bg-[#FFF8E1] px-2 py-0.5 text-[11px] font-semibold text-[#856404]"
            >
              <AlertTriangle className="h-3 w-3 shrink-0 text-[#D39E00]" />
              {t.bookmarks.warningSummary(validation.totalWarnings)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={disabled || undoCount === 0}
            onClick={handleUndo}
            title={t.bookmarks.undoTooltip}
            className="inline-flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-white px-2 py-1 text-xs font-medium text-[#495057] hover:bg-[#F8F9FA] disabled:opacity-40"
          >
            <Undo2 className="h-3.5 w-3.5" />
            <span>{t.bookmarks.undoBtn}</span>
          </button>
          {hasAnyParents && (
            <button
              type="button"
              disabled={disabled}
              onClick={handleToggleAllCollapse}
              className="rounded-[4px] border border-[#CED4DA] bg-white px-2 py-1 text-xs font-medium text-[#495057] hover:bg-[#F8F9FA] disabled:opacity-40"
            >
              {allCollapsed ? t.bookmarks.expandAll : t.bookmarks.collapseAll}
            </button>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={addRootBookmark}
            className="flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-[#F8F9FA] px-2.5 py-1 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF] disabled:opacity-40"
          >
            <BookmarkPlus className="h-3.5 w-3.5 text-[#007BFF]" />
            {t.bookmarks.addRoot}
          </button>
        </div>
      </div>

      {nodes.length === 0 ? (
        <div className="rounded-[4px] border border-dashed border-[#DEE2E6] p-3.5 text-center text-sm text-[#6C757D]">
          {t.bookmarks.emptyHint}
        </div>
      ) : (
        <>
          <div
            ref={scrollRef}
            style={{ height: `${liveHeightPx}px` }}
            className={`overflow-y-auto pr-1 ${disabled ? "pointer-events-none opacity-60" : ""}`}
          >
            <div
              style={{
                paddingTop: topPadPx > 0 ? `${topPadPx}px` : undefined,
                paddingBottom: bottomPadPx > 0 ? `${bottomPadPx}px` : undefined,
              }}
            >
              <div ref={listInnerRef} className="space-y-1.5">
                {visibleSlice.map((item) => {
                  const warnings = validation.warningsByPath.get(item.pathKey);
                  const activeDropPos =
                    dropTarget?.targetKey === item.pathKey ? dropTarget.position : null;
                  return (
                    <BookmarkRow
                      key={item.pathKey}
                      title={item.node.title}
                      targetPageIndex={item.node.target_page_index}
                      path={item.path}
                      pathKey={item.pathKey}
                      depth={item.depth}
                      hasChildren={item.hasChildren}
                      isCollapsed={item.isCollapsed}
                      totalPages={totalPages}
                      warnings={warnings}
                      disabled={disabled}
                      isDragged={dragSourceKey === item.pathKey}
                      activeDropPos={activeDropPos}
                      onStartDrag={handleRowDragStart}
                      onTitleFocus={handleTitleFocus}
                      onTitleBlur={handleTitleBlur}
                      onUpdateTitle={handleUpdateTitle}
                      onUpdatePage={handleUpdatePage}
                      onAddChild={handleAddChildAtPath}
                      onDelete={handleDeleteAtPath}
                      onToggleCollapse={handleToggleCollapse}
                    />
                  );
                })}
              </div>
            </div>
          </div>
          <div
            role="separator"
            aria-orientation="horizontal"
            onPointerDown={handleResizeStart}
            title={`${liveHeightPx}px`}
            className="mt-2 flex h-4 cursor-ns-resize select-none items-center justify-center rounded-[4px] border border-dashed border-[#CED4DA] bg-[#F8F9FA] text-[#6C757D] hover:border-[#007BFF] hover:bg-[#E7F1FF] hover:text-[#007BFF]"
          >
            <GripHorizontal className="h-3.5 w-3.5" />
          </div>
        </>
      )}
    </div>
  );
});

interface BookmarkRowProps {
  title: string;
  targetPageIndex: number;
  path: number[];
  pathKey: string;
  depth: number;
  hasChildren: boolean;
  isCollapsed: boolean;
  totalPages: number;
  warnings: BookmarkValidationWarning[] | undefined;
  disabled: boolean;
  isDragged: boolean;
  activeDropPos: BookmarkDropPosition | null;
  onStartDrag: (e: React.PointerEvent<HTMLElement>, path: number[]) => void;
  onTitleFocus: () => void;
  onTitleBlur: () => void;
  onUpdateTitle: (path: number[], title: string) => void;
  onUpdatePage: (path: number[], pageIndex: number) => void;
  onAddChild: (path: number[]) => void;
  onDelete: (path: number[]) => void;
  onToggleCollapse: (pathKey: string) => void;
}

const BookmarkRow: React.FC<BookmarkRowProps> = React.memo(({
  title,
  targetPageIndex,
  path,
  pathKey,
  depth,
  hasChildren,
  isCollapsed,
  totalPages,
  warnings,
  disabled,
  isDragged,
  activeDropPos,
  onStartDrag,
  onTitleFocus,
  onTitleBlur,
  onUpdateTitle,
  onUpdatePage,
  onAddChild,
  onDelete,
  onToggleCollapse,
}) => {
  const { t } = useI18n();

  const warningTitle = warnings
    ?.map((w) => {
      if (w.kind === "order") return t.bookmarks.warningOrderDesc(w.refPage);
      if (w.kind === "parent") return t.bookmarks.warningParentDesc(w.refPage);
      return t.bookmarks.warningOutOfRangeDesc(w.refPage);
    })
    .join(" · ");

  return (
    <div style={{ marginLeft: depth * 16 }} className="relative">
      {activeDropPos === "before" && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-1 left-0 right-0 z-20 h-0.5 rounded-full bg-[#007BFF]"
        />
      )}
      <div
        data-bookmark-path={pathKey}
        className={`flex items-center gap-1.5 rounded-[4px] border px-2 py-1.5 transition-colors ${
          activeDropPos === "inside"
            ? "border-[#007BFF] bg-[#E7F1FF] ring-1 ring-[#007BFF]"
            : warnings && warnings.length > 0
              ? "border-[#FFC107] bg-[#FFF8E1]/60"
              : "border-[#DEE2E6] bg-[#F8F9FA]"
        } ${isDragged ? "opacity-45" : "opacity-100"}`}
      >
        <span
          role="button"
          tabIndex={-1}
          data-bookmark-drag-handle="true"
          title={t.bookmarks.dragReorderTitle}
          onPointerDown={(e) => onStartDrag(e, path)}
          className={`shrink-0 rounded-[4px] p-0.5 transition-colors ${
            activeDropPos === "inside"
              ? "bg-[#007BFF] text-white"
              : "cursor-grab text-[#6C757D] hover:bg-[#E9ECEF] hover:text-[#212529] active:cursor-grabbing"
          }`}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>

        {hasChildren ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onToggleCollapse(pathKey)}
            title={isCollapsed ? t.bookmarks.expandNodeTitle : t.bookmarks.collapseNodeTitle}
            className="shrink-0 rounded-[4px] p-0.5 text-[#495057] hover:bg-[#E9ECEF]"
          >
            {isCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        ) : null}

        <input
          type="text"
          disabled={disabled}
          value={title}
          onFocus={onTitleFocus}
          onBlur={onTitleBlur}
          onChange={(e) => onUpdateTitle(path, e.target.value)}
          className="knit-control-sm min-w-0 flex-1 rounded-[4px] border border-[#CED4DA] bg-white px-2 text-sm disabled:bg-[#F1F3F5]"
        />

        {warnings && warnings.length > 0 && (
          <span
            title={warningTitle}
            data-testid={`bookmark-row-warning-${pathKey}`}
            className="knit-control-sm inline-flex min-w-8 shrink-0 items-center justify-center rounded-[4px] border border-[#FFC107] bg-[#FFF3CD] px-2 text-[10px] font-semibold text-[#856404]"
          >
            <AlertTriangle className="h-3.5 w-3.5 text-[#D39E00]" />
          </span>
        )}

        <label className="flex shrink-0 items-center gap-1 text-xs text-[#6C757D]">
          {t.bookmarks.pageLabel}
          <NumberInput
            ariaLabel={t.bookmarks.pageLabel}
            size="sm"
            disabled={disabled}
            min={1}
            max={Math.max(1, totalPages)}
            value={targetPageIndex + 1}
            onChange={(p) => onUpdatePage(path, p - 1)}
            className="w-28"
          />
        </label>

        <button
          type="button"
          disabled={disabled}
          title={t.bookmarks.addChildTitle}
          onClick={() => onAddChild(path)}
          className="shrink-0 rounded-[4px] p-1 text-[#495057] hover:bg-[#E9ECEF]"
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          disabled={disabled}
          title={t.bookmarks.deleteTitle}
          onClick={() => onDelete(path)}
          className="shrink-0 rounded-[4px] p-1 text-[#DC3545] hover:bg-[#F8D7DA]"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {activeDropPos === "after" && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-1 left-0 right-0 z-20 h-0.5 rounded-full bg-[#007BFF]"
        />
      )}
    </div>
  );
});
