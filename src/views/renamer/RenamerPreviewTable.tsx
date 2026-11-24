import React from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderKanban,
  FolderOpen,
  List,
  ListTree,
} from "lucide-react";
import { PaneResizeHandle } from "../../components/PaneResizeHandle";
import { useI18n } from "../../i18n";
import type {
  FlattenedTreeRow,
  RenamerSortDir,
  RenamerSortField,
} from "../../lib/renamerTree";
import type { RenameItem } from "../../types/ipc";

interface RenamerPreviewTableProps {
  items: RenameItem[];
  selectedPending: number;
  viewMode: "tree" | "flat";
  livePreviewHeightPx: number;
  scrollTop: number;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  visibleTreeRows: FlattenedTreeRow[];
  sortedFlatItems: { item: RenameItem; planIndex: number }[];
  sortField: RenamerSortField;
  sortDir: RenamerSortDir;
  onChangeViewMode: (mode: "tree" | "flat") => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onToggleAllSelected: (selected: boolean) => void;
  onToggleItemSelected: (idx: number, selected: boolean) => void;
  onApplySelectionIndices: (indices: number[], selected: boolean) => void;
  onToggleFolderExpanded: (key: string) => void;
  onClearRoots: () => void;
  onScrollTopChange: (scrollTop: number) => void;
  onToggleSort: (field: Exclude<RenamerSortField, "none">) => void;
  onPreviewResizeStart: (e: React.PointerEvent<HTMLElement>) => void;
}

const ROW_HEIGHT = 38;
const OVERSCAN = 8;

export const RenamerPreviewTable: React.FC<RenamerPreviewTableProps> = ({
  items,
  selectedPending,
  viewMode,
  livePreviewHeightPx,
  scrollTop,
  scrollContainerRef,
  visibleTreeRows,
  sortedFlatItems,
  sortField,
  sortDir,
  onChangeViewMode,
  onExpandAll,
  onCollapseAll,
  onToggleAllSelected,
  onToggleItemSelected,
  onApplySelectionIndices,
  onToggleFolderExpanded,
  onClearRoots,
  onScrollTopChange,
  onToggleSort,
  onPreviewResizeStart,
}) => {
  const { t } = useI18n();
  if (items.length === 0) return null;

  const selectedCount = items.filter((i) => i.selected).length;
  const allSelected = selectedCount === items.length;
  const someSelected = selectedCount > 0 && selectedCount < items.length;

  const totalRows = viewMode === "tree" ? visibleTreeRows.length : sortedFlatItems.length;
  const visibleCount = Math.ceil(livePreviewHeightPx / ROW_HEIGHT) + OVERSCAN * 2;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(totalRows, startIdx + visibleCount);
  const topPadPx = startIdx * ROW_HEIGHT;
  const bottomPadPx = Math.max(0, (totalRows - endIdx) * ROW_HEIGHT);

  const renderSortIcon = (field: Exclude<RenamerSortField, "none">) => {
    if (sortField !== field) return <ArrowUpDown className="h-3.5 w-3.5 opacity-45" />;
    return sortDir === "asc" ? (
      <ArrowUp className="h-3.5 w-3.5 text-[#007BFF]" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5 text-[#007BFF]" />
    );
  };

  return (
    <div className="space-y-1.5">
      <div className="knit-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DEE2E6] bg-[#F8F9FA] px-3.5 py-2.5 text-sm">
          <div className="flex items-center gap-2 font-semibold text-[#343A40]">
            <FolderKanban className="h-4 w-4 text-[#007BFF]" />
            {t.renamer.previewHeading(items.length, selectedPending)}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="inline-flex overflow-hidden rounded-[4px] border border-[#CED4DA] bg-white">
              <button
                type="button"
                onClick={() => onChangeViewMode("tree")}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold ${
                  viewMode === "tree"
                    ? "bg-[#007BFF] text-white"
                    : "text-[#343A40] hover:bg-[#E9ECEF]"
                }`}
              >
                <ListTree className="h-3.5 w-3.5" />
                {t.renamer.viewTreeBtn}
              </button>
              <button
                type="button"
                onClick={() => onChangeViewMode("flat")}
                className={`inline-flex items-center gap-1 border-l border-[#CED4DA] px-2.5 py-1 text-xs font-semibold ${
                  viewMode === "flat"
                    ? "bg-[#007BFF] text-white"
                    : "text-[#343A40] hover:bg-[#E9ECEF]"
                }`}
              >
                <List className="h-3.5 w-3.5" />
                {t.renamer.viewFlatBtn}
              </button>
            </div>
            {viewMode === "tree" && (
              <>
                <button
                  type="button"
                  onClick={onExpandAll}
                  className="rounded-[4px] border border-[#CED4DA] bg-white px-2 py-1 text-xs hover:bg-[#E9ECEF]"
                >
                  {t.renamer.expandAllBtn}
                </button>
                <button
                  type="button"
                  onClick={onCollapseAll}
                  className="rounded-[4px] border border-[#CED4DA] bg-white px-2 py-1 text-xs hover:bg-[#E9ECEF]"
                >
                  {t.renamer.collapseAllBtn}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => onToggleAllSelected(true)}
              className="flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-white px-2.5 py-1 text-xs hover:bg-[#E9ECEF]"
            >
              <CheckSquare className="h-3.5 w-3.5" />
              {t.renamer.selectAllBtn}
            </button>
            <button
              type="button"
              onClick={() => onToggleAllSelected(false)}
              className="rounded-[4px] border border-[#CED4DA] bg-white px-2.5 py-1 text-xs hover:bg-[#E9ECEF]"
            >
              {t.renamer.deselectAllBtn}
            </button>
            <button
              type="button"
              onClick={onClearRoots}
              className="rounded-[4px] border border-[#CED4DA] bg-white px-2.5 py-1 text-xs text-[#DC3545] hover:bg-[#F8D7DA]"
            >
              {t.renamer.clearFoldersBtn}
            </button>
          </div>
        </div>

        <div
          ref={scrollContainerRef}
          onScroll={(e) => onScrollTopChange(e.currentTarget.scrollTop)}
          style={{ height: `${livePreviewHeightPx}px` }}
          className="overscroll-contain overflow-auto"
        >
          <table className="w-full table-fixed border-separate border-spacing-0 text-left text-sm">
            <colgroup>
              <col className="w-24" />
              <col className="w-20" />
              <col className="w-[34%]" />
              <col className="w-[34%]" />
              <col className="w-28" />
            </colgroup>
            <thead className="text-xs uppercase text-[#6C757D]">
              <tr>
                <th className="sticky top-0 z-20 bg-[#F8F9FA] px-3 py-2.5 shadow-[inset_0_-1px_0_#DEE2E6]">
                  <label className="inline-flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      aria-label={t.renamer.selectAllBtn}
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected;
                      }}
                      onChange={(e) => onToggleAllSelected(e.target.checked)}
                    />
                    <span>{t.renamer.colSelect}</span>
                  </label>
                </th>
                <th className="sticky top-0 z-20 bg-[#F8F9FA] px-2 py-2.5 shadow-[inset_0_-1px_0_#DEE2E6]">
                  <button
                    type="button"
                    onClick={() => onToggleSort("type")}
                    className="inline-flex items-center gap-1 uppercase hover:text-[#212529]"
                  >
                    <span>{t.renamer.colType}</span>
                    {renderSortIcon("type")}
                  </button>
                </th>
                <th className="sticky top-0 z-20 bg-[#F8F9FA] px-3 py-2.5 shadow-[inset_0_-1px_0_#DEE2E6]">
                  <button
                    type="button"
                    onClick={() => onToggleSort("original")}
                    className="inline-flex items-center gap-1 uppercase hover:text-[#212529]"
                  >
                    <span>{t.renamer.colOriginal}</span>
                    {renderSortIcon("original")}
                  </button>
                </th>
                <th className="sticky top-0 z-20 bg-[#F8F9FA] px-3 py-2.5 shadow-[inset_0_-1px_0_#DEE2E6]">
                  <button
                    type="button"
                    onClick={() => onToggleSort("new")}
                    className="inline-flex items-center gap-1 uppercase hover:text-[#212529]"
                  >
                    <span>{t.renamer.colNew}</span>
                    {renderSortIcon("new")}
                  </button>
                </th>
                <th className="sticky top-0 z-20 bg-[#F8F9FA] px-3 py-2.5 shadow-[inset_0_-1px_0_#DEE2E6]">
                  <button
                    type="button"
                    onClick={() => onToggleSort("status")}
                    className="inline-flex items-center gap-1 uppercase hover:text-[#212529]"
                  >
                    <span>{t.renamer.colStatus}</span>
                    {renderSortIcon("status")}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E9ECEF]">
              {topPadPx > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={5} style={{ height: `${topPadPx}px`, padding: 0 }} />
                </tr>
              )}

              {viewMode === "tree"
                ? visibleTreeRows.slice(startIdx, endIdx).map((row) => {
                    const { node, treeDepth, hasChildren, isExpanded } = row;
                    const item = node.item;
                    const isChecked = item ? item.selected : row.allSelected;
                    const isIndeterminate = node.isDir && row.someSelected;
                    const status = item?.status ?? null;

                    return (
                      <tr
                        key={row.key}
                        style={{ height: `${ROW_HEIGHT}px` }}
                        className={
                          isChecked || row.someSelected ? "bg-white" : "bg-[#F8F9FA] opacity-60"
                        }
                      >
                        <td className="border-b border-[#E9ECEF] px-3 py-1.5">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            ref={(el) => {
                              if (el) el.indeterminate = isIndeterminate;
                            }}
                            onChange={(e) => {
                              if (node.isDir) {
                                onApplySelectionIndices(
                                  node.subtreePlanIndices,
                                  e.target.checked,
                                );
                              } else if (node.planIndex !== null) {
                                onToggleItemSelected(node.planIndex, e.target.checked);
                              }
                            }}
                          />
                        </td>
                        <td className="border-b border-[#E9ECEF] px-2 py-1.5 text-xs font-medium text-[#6C757D]">
                          {node.isDir ? "DIR" : "FILE"}
                        </td>
                        <td className="overflow-hidden border-b border-[#E9ECEF] px-3 py-1.5 text-[#495057]">
                          <div
                            className="flex min-w-0 items-center gap-1"
                            style={{ paddingLeft: `${treeDepth * 16}px` }}
                          >
                            {hasChildren ? (
                              <button
                                type="button"
                                onClick={() => onToggleFolderExpanded(row.key)}
                                className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[#6C757D] hover:bg-[#E9ECEF]"
                              >
                                {isExpanded ? (
                                  <ChevronDown className="h-3.5 w-3.5" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5" />
                                )}
                              </button>
                            ) : (
                              <span className="inline-block w-4 shrink-0" />
                            )}
                            {node.isDir &&
                              (isExpanded ? (
                                <FolderOpen className="h-4 w-4 shrink-0 text-[#007BFF]" />
                              ) : (
                                <Folder className="h-4 w-4 shrink-0 text-[#F59E0B]" />
                              ))}
                            <span className="truncate" title={item?.original_path ?? row.key}>
                              {node.name}
                            </span>
                          </div>
                        </td>
                        <td className="overflow-hidden border-b border-[#E9ECEF] px-3 py-1.5 font-semibold text-[#212529]">
                          <span
                            className="block truncate"
                            title={item ? item.new_name : node.name}
                          >
                            {item ? item.new_name : node.name}
                          </span>
                        </td>
                        <td className="border-b border-[#E9ECEF] px-3 py-1.5">
                          {status && (
                            <span
                              className={`inline-block rounded-[4px] px-1.5 py-0.5 text-xs font-semibold uppercase ${
                                status === "conflict"
                                  ? "bg-[#F8D7DA] text-[#721C24]"
                                  : status === "pending"
                                    ? "bg-[#D1ECF1] text-[#0C5460]"
                                    : "bg-[#E9ECEF] text-[#6C757D]"
                              }`}
                              title={item?.error_message || undefined}
                            >
                              {status}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                : sortedFlatItems.slice(startIdx, endIdx).map(({ item, planIndex }) => (
                    <tr
                      key={item.id}
                      style={{ height: `${ROW_HEIGHT}px` }}
                      className={item.selected ? "bg-white" : "bg-[#F8F9FA] opacity-60"}
                    >
                      <td className="border-b border-[#E9ECEF] px-3 py-1.5">
                        <input
                          type="checkbox"
                          checked={item.selected}
                          onChange={(e) => onToggleItemSelected(planIndex, e.target.checked)}
                        />
                      </td>
                      <td className="border-b border-[#E9ECEF] px-2 py-1.5 text-xs font-medium text-[#6C757D]">
                        {item.is_dir ? "DIR" : "FILE"}
                      </td>
                      <td className="overflow-hidden border-b border-[#E9ECEF] px-3 py-1.5 text-[#495057]">
                        <span className="block truncate" title={item.original_path}>
                          {item.original_name}
                        </span>
                      </td>
                      <td className="overflow-hidden border-b border-[#E9ECEF] px-3 py-1.5 font-semibold text-[#212529]">
                        <span className="block truncate" title={item.new_name}>
                          {item.new_name}
                        </span>
                      </td>
                      <td className="border-b border-[#E9ECEF] px-3 py-1.5">
                        <span
                          className={`inline-block rounded-[4px] px-1.5 py-0.5 text-xs font-semibold uppercase ${
                            item.status === "conflict"
                              ? "bg-[#F8D7DA] text-[#721C24]"
                              : item.status === "pending"
                                ? "bg-[#D1ECF1] text-[#0C5460]"
                                : "bg-[#E9ECEF] text-[#6C757D]"
                          }`}
                          title={item.error_message || undefined}
                        >
                          {item.status}
                        </span>
                      </td>
                    </tr>
                  ))}

              {bottomPadPx > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={5} style={{ height: `${bottomPadPx}px`, padding: 0 }} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <PaneResizeHandle
        orientation="horizontal"
        variant="dashed"
        ariaLabel="Resize rename preview height"
        title={`${livePreviewHeightPx}px`}
        labelText={`${livePreviewHeightPx}px`}
        className="h-4"
        onPointerDown={onPreviewResizeStart}
      />
    </div>
  );
};
