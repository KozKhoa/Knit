import React from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  GripHorizontal,
  GripVertical,
  Trash2,
  Undo2,
} from "lucide-react";
import { useVerticalResize } from "../hooks/useVerticalResize";
import { useI18n } from "../i18n";
import {
  archivePathKey,
  collectArchiveFolderKeys,
  countArchiveFilesAndBytes,
  deleteArchiveNodeAtPath,
  flattenVisibleArchiveRows,
  moveArchiveNode,
  type ArchiveDropPosition,
  type ArchiveTreeNode,
} from "../lib/archiveTree";
import { formatBytes } from "../lib/ipc";
import { usePersistentState } from "../lib/storage";

interface ArchiveTreeEditorProps {
  nodes: ArchiveTreeNode[];
  onChange: (next: ArchiveTreeNode[]) => void;
  loading?: boolean;
}

interface DropTargetState {
  targetPath: number[];
  targetKey: string;
  position: ArchiveDropPosition;
}

const DEFAULT_ROW_STRIDE_PX = 40;
const ROW_GAP_PX = 4;
const OVERSCAN_ROWS = 8;

function isSameOrDescendantPath(source: readonly number[], target: readonly number[]): boolean {
  return target.length >= source.length && source.every((seg, i) => target[i] === seg);
}

export const ArchiveTreeEditor: React.FC<ArchiveTreeEditorProps> = React.memo(
  ({ nodes, onChange, loading = false }) => {
    const { t } = useI18n();
    const [treeHeightPx, setTreeHeightPx] = usePersistentState<number>(
      "knit.archive.treeHeightPx",
      320,
    );
    const { height: liveHeightPx, handlePointerDown: handleResizeStart } = useVerticalResize({
      value: treeHeightPx,
      min: 180,
      max: 900,
      onCommit: setTreeHeightPx,
    });

    const [collapsedKeys, setCollapsedKeys] = React.useState<Set<string>>(() => new Set());
    const undoStackRef = React.useRef<ArchiveTreeNode[][]>([]);
    const [undoCount, setUndoCount] = React.useState(0);
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const scrollRef = React.useRef<HTMLDivElement | null>(null);
    const listInnerRef = React.useRef<HTMLDivElement | null>(null);

    const flatRows = React.useMemo(
      () => flattenVisibleArchiveRows(nodes, collapsedKeys),
      [nodes, collapsedKeys],
    );
    const folderKeys = React.useMemo(() => collectArchiveFolderKeys(nodes), [nodes]);
    const hasAnyFolders = folderKeys.length > 0;
    const allCollapsed = hasAnyFolders && folderKeys.every((k) => collapsedKeys.has(k));
    const { fileCount, totalBytes } = React.useMemo(
      () => countArchiveFilesAndBytes(nodes),
      [nodes],
    );

    const [rowStride, setRowStride] = React.useState<number>(DEFAULT_ROW_STRIDE_PX);
    const rowStrideRef = React.useRef<number>(DEFAULT_ROW_STRIDE_PX);
    rowStrideRef.current = rowStride;
    const [visibleRange, setVisibleRange] = React.useState<{ start: number; end: number }>({
      start: 0,
      end: 30,
    });
    const totalRowsRef = React.useRef(flatRows.length);
    totalRowsRef.current = flatRows.length;

    const recomputeWindow = React.useCallback(() => {
      const total = totalRowsRef.current;
      if (total === 0) {
        setVisibleRange((prev) =>
          prev.start === 0 && prev.end === 0 ? prev : { start: 0, end: 0 },
        );
        return;
      }

      const innerEl = listInnerRef.current;
      if (innerEl) {
        const firstRow = innerEl.firstElementChild as HTMLElement | null;
        if (firstRow) {
          const h = firstRow.getBoundingClientRect().height;
          if (h > 20) {
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
      const viewportH = el && el.clientHeight > 0 ? el.clientHeight : 500;
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
      const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
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
    const dropTargetRef = React.useRef<DropTargetState | null>(null);
    dropTargetRef.current = dropTarget;
    const dragCleanupRef = React.useRef<(() => void) | null>(null);

    const pushUndoSnapshot = React.useCallback((snapshot: ArchiveTreeNode[]) => {
      const stack = undoStackRef.current;
      stack.push(snapshot);
      if (stack.length > 50) stack.shift();
      setUndoCount(stack.length);
    }, []);

    const handleUndo = React.useCallback(() => {
      const prev = undoStackRef.current.pop();
      if (!prev) return;
      setUndoCount(undoStackRef.current.length);
      onChangeRef.current(prev);
    }, []);

    React.useEffect(() => {
      const onKeyDown = (e: KeyboardEvent) => {
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
        if (!insideEditor || undoStackRef.current.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        handleUndo();
      };
      window.addEventListener("keydown", onKeyDown, true);
      return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [handleUndo]);

    React.useEffect(() => {
      return () => {
        dragCleanupRef.current?.();
        dragCleanupRef.current = null;
      };
    }, []);

    const handleRowDragStart = React.useCallback(
      (e: React.PointerEvent<HTMLElement>, sourcePath: number[]) => {
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
            const rowEl = (el as HTMLElement).closest?.("[data-archive-path]") as HTMLElement | null;
            if (!rowEl) continue;
            const rawPath = rowEl.dataset.archivePath;
            const rowKind = rowEl.dataset.archiveKind;
            if (!rawPath) continue;
            const targetPath = rawPath.split(".").map((n) => Number.parseInt(n, 10));
            if (targetPath.some((n) => Number.isNaN(n))) continue;
            if (isSameOrDescendantPath(sourcePath, targetPath)) return null;

            const gripEl = rowEl.querySelector<HTMLElement>("[data-archive-drag-handle]");
            const isHoveringGrip = Boolean(
              gripEl && els.some((hitEl) => hitEl === gripEl || gripEl.contains(hitEl as Node)),
            );
            const rect = rowEl.getBoundingClientRect();
            const relY = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5;
            const position: ArchiveDropPosition =
              rowKind === "folder" && (isHoveringGrip || (relY >= 0.25 && relY <= 0.75))
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
            if (latestY < sr.top + edge && latestY >= sr.top - 24) dy = -10;
            else if (latestY > sr.bottom - edge && latestY <= sr.bottom + 24) dy = 10;
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
            setDragSourceKey(archivePathKey(sourcePath));
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
            const next = moveArchiveNode(
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

    const handleDeleteAtPath = React.useCallback(
      (path: number[]) => {
        const next = deleteArchiveNodeAtPath(nodesRef.current, path);
        if (next !== nodesRef.current) {
          pushUndoSnapshot(nodesRef.current);
          onChangeRef.current(next);
        }
      },
      [pushUndoSnapshot],
    );

    const handleToggleCollapse = React.useCallback((pathKey: string) => {
      setCollapsedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(pathKey)) next.delete(pathKey);
        else next.add(pathKey);
        return next;
      });
    }, []);

    const handleToggleAllCollapse = React.useCallback(() => {
      if (allCollapsed) {
        setCollapsedKeys(new Set());
      } else {
        setCollapsedKeys(new Set(folderKeys));
      }
    }, [allCollapsed, folderKeys]);

    const safeStart = Math.min(visibleRange.start, flatRows.length);
    const safeEnd = Math.min(Math.max(safeStart, visibleRange.end), flatRows.length);
    const visibleSlice = flatRows.slice(safeStart, safeEnd);
    const topPadPx = safeStart * rowStride;
    const bottomPadPx = Math.max(0, (flatRows.length - safeEnd) * rowStride);

    return (
      <div
        ref={containerRef}
        tabIndex={-1}
        data-archive-tree-editor="true"
        className="rounded-[4px] border border-[#DEE2E6] bg-white p-3.5 focus:outline-none"
      >
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold text-[#343A40]">{t.archive.treeTitle}</span>
            <span className="rounded-[4px] bg-[#E9ECEF] px-2 py-0.5 font-mono-code text-xs font-semibold text-[#495057]">
              {t.archive.treeSummary(fileCount, formatBytes(totalBytes))}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={undoCount === 0}
              onClick={handleUndo}
              title={t.archive.undoTooltip}
              className="inline-flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-white px-2 py-1 text-xs font-medium text-[#495057] hover:bg-[#F8F9FA] disabled:opacity-40"
            >
              <Undo2 className="h-3.5 w-3.5" />
              <span>{t.archive.undoBtn}</span>
            </button>
            {hasAnyFolders && (
              <button
                type="button"
                onClick={handleToggleAllCollapse}
                className="rounded-[4px] border border-[#CED4DA] bg-white px-2 py-1 text-xs font-medium text-[#495057] hover:bg-[#F8F9FA]"
              >
                {allCollapsed ? t.archive.expandAllBtn : t.archive.collapseAllBtn}
              </button>
            )}
          </div>
        </div>

        <div className="mb-2 text-xs text-[#6C757D]">{t.archive.treeDragHint}</div>

        {loading && nodes.length === 0 ? (
          <div className="rounded-[4px] border border-dashed border-[#DEE2E6] p-4 text-center text-xs text-[#6C757D]">
            {t.common.loadingFolder}
          </div>
        ) : nodes.length === 0 ? (
          <div className="rounded-[4px] border border-dashed border-[#DEE2E6] p-4 text-center text-xs text-[#6C757D]">
            {t.archive.treeEmptyHint}
          </div>
        ) : (
          <>
            <div
              ref={scrollRef}
              style={{ height: `${liveHeightPx}px` }}
              className="overscroll-contain overflow-y-auto pr-1"
            >
              <div
                style={{
                  paddingTop: topPadPx > 0 ? `${topPadPx}px` : undefined,
                  paddingBottom: bottomPadPx > 0 ? `${bottomPadPx}px` : undefined,
                }}
              >
                <div ref={listInnerRef} className="space-y-1">
                  {visibleSlice.map((item) => {
                    const activeDropPos =
                      dropTarget?.targetKey === item.pathKey ? dropTarget.position : null;
                    const isFolder = item.node.kind === "folder";
                    return (
                      <div key={item.pathKey} style={{ marginLeft: item.depth * 18 }} className="relative">
                        {activeDropPos === "before" && (
                          <div
                            aria-hidden="true"
                            className="pointer-events-none absolute -top-0.5 left-0 right-0 z-20 h-0.5 rounded-full bg-[#007BFF]"
                          />
                        )}
                        <div
                          data-archive-path={item.pathKey}
                          data-archive-kind={item.node.kind}
                          className={`flex items-center gap-1.5 rounded-[4px] border px-2 py-1 text-xs transition-colors ${
                            activeDropPos === "inside"
                              ? "border-[#007BFF] bg-[#E7F1FF] ring-1 ring-[#007BFF]"
                              : isFolder
                                ? "border-[#DEE2E6] bg-[#F8F9FA]"
                                : "border-[#E9ECEF] bg-white"
                          } ${dragSourceKey === item.pathKey ? "opacity-45" : "opacity-100"}`}
                        >
                          <span
                            role="button"
                            tabIndex={-1}
                            data-archive-drag-handle="true"
                            onPointerDown={(e) => handleRowDragStart(e, item.path)}
                            className={`shrink-0 rounded-[4px] p-0.5 transition-colors ${
                              activeDropPos === "inside"
                                ? "bg-[#007BFF] text-white"
                                : "cursor-grab text-[#6C757D] hover:bg-[#E9ECEF] hover:text-[#212529] active:cursor-grabbing"
                            }`}
                          >
                            <GripVertical className="h-3.5 w-3.5" />
                          </span>

                          {isFolder ? (
                            <button
                              type="button"
                              onClick={() => handleToggleCollapse(item.pathKey)}
                              className="shrink-0 rounded-[4px] p-0.5 text-[#495057] hover:bg-[#E9ECEF]"
                            >
                              {item.isCollapsed ? (
                                <ChevronRight className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5" />
                              )}
                            </button>
                          ) : (
                            <span className="w-4 shrink-0" />
                          )}

                          {isFolder ? (
                            item.isCollapsed ? (
                              <Folder className="h-3.5 w-3.5 shrink-0 text-[#007BFF]" />
                            ) : (
                              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[#007BFF]" />
                            )
                          ) : (
                            <FileText className="h-3.5 w-3.5 shrink-0 text-[#6C757D]" />
                          )}

                          <span
                            className={`min-w-0 flex-1 truncate font-mono-code ${
                              isFolder ? "font-semibold text-[#212529]" : "text-[#343A40]"
                            }`}
                            title={item.node.sourcePath ?? item.node.name}
                          >
                            {item.node.name}
                          </span>

                          <span className="shrink-0 font-mono-code text-[11px] text-[#6C757D]">
                            {isFolder
                              ? `${item.node.children.length} · ${formatBytes(item.node.sizeBytes)}`
                              : formatBytes(item.node.sizeBytes)}
                          </span>

                          <button
                            type="button"
                            title={t.archive.deleteNodeTitle}
                            onClick={() => handleDeleteAtPath(item.path)}
                            className="shrink-0 rounded-[4px] p-1 text-[#DC3545] hover:bg-[#F8D7DA]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {activeDropPos === "after" && (
                          <div
                            aria-hidden="true"
                            className="pointer-events-none absolute -bottom-0.5 left-0 right-0 z-20 h-0.5 rounded-full bg-[#007BFF]"
                          />
                        )}
                      </div>
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
  },
);
