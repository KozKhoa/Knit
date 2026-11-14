import React from "react";
import { BookmarkPlus, FolderPlus, GripHorizontal, Trash2 } from "lucide-react";
import { NumberInput } from "./NumberInput";
import { useI18n } from "../i18n";
import { useVerticalResize } from "../hooks/useVerticalResize";
import { usePersistentState } from "../lib/storage";
import type { BookmarkNode } from "../types/ipc";

interface BookmarkTreeEditorProps {
  nodes: BookmarkNode[];
  totalPages: number;
  onChange: (next: BookmarkNode[]) => void;
}

export const BookmarkTreeEditor: React.FC<BookmarkTreeEditorProps> = ({
  nodes,
  totalPages,
  onChange,
}) => {
  const { t } = useI18n();
  const [treeHeightPx, setTreeHeightPx] = usePersistentState<number>(
    "knit.img2pdf.bookmarkHeightPx",
    300,
  );
  const { height: liveHeightPx, handlePointerDown: handleResizeStart } = useVerticalResize({
    value: treeHeightPx,
    min: 180,
    max: 880,
    onCommit: setTreeHeightPx,
  });

  const addRootBookmark = () => {
    onChange([
      ...nodes,
      {
        title: t.bookmarks.defaultRootTitle(nodes.length + 1),
        target_page_index: 0,
        children: [],
      },
    ]);
  };

  return (
    <div className="rounded-[4px] border border-[#DEE2E6] bg-white p-3.5">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="text-sm font-bold text-[#343A40]">{t.bookmarks.title}</div>
        <button
          type="button"
          onClick={addRootBookmark}
          className="flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-[#F8F9FA] px-2.5 py-1 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
        >
          <BookmarkPlus className="h-3.5 w-3.5 text-[#007BFF]" />
          {t.bookmarks.addRoot}
        </button>
      </div>

      {nodes.length === 0 ? (
        <div className="rounded-[4px] border border-dashed border-[#DEE2E6] p-3.5 text-center text-sm text-[#6C757D]">
          {t.bookmarks.emptyHint}
        </div>
      ) : (
        <>
          <div
            style={{ maxHeight: `${liveHeightPx}px` }}
            className="space-y-1.5 overflow-y-auto pr-1"
          >
            {nodes.map((node, idx) => (
              <BookmarkRow
                key={idx}
                node={node}
                depth={0}
                totalPages={totalPages}
                onUpdate={(updated) => {
                  const copy = [...nodes];
                  copy[idx] = updated;
                  onChange(copy);
                }}
                onDelete={() => onChange(nodes.filter((_, i) => i !== idx))}
              />
            ))}
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
};

interface BookmarkRowProps {
  node: BookmarkNode;
  depth: number;
  totalPages: number;
  onUpdate: (next: BookmarkNode) => void;
  onDelete: () => void;
}

const BookmarkRow: React.FC<BookmarkRowProps> = ({
  node,
  depth,
  totalPages,
  onUpdate,
  onDelete,
}) => {
  const { t } = useI18n();

  return (
    <div style={{ marginLeft: depth * 16 }} className="space-y-1">
      <div className="flex items-center gap-1.5 rounded-[4px] border border-[#DEE2E6] bg-[#F8F9FA] px-2 py-1.5">
        <input
          type="text"
          value={node.title}
          onChange={(e) => onUpdate({ ...node, title: e.target.value })}
          className="knit-control-sm min-w-0 flex-1 rounded-[4px] border border-[#CED4DA] bg-white px-2 text-sm"
        />
        <label className="flex items-center gap-1 text-xs text-[#6C757D]">
          {t.bookmarks.pageLabel}
          <NumberInput
            ariaLabel={t.bookmarks.pageLabel}
            size="sm"
            min={1}
            max={Math.max(1, totalPages)}
            value={node.target_page_index + 1}
            onChange={(p) => onUpdate({ ...node, target_page_index: p - 1 })}
            className="w-16"
          />
        </label>
        <button
          type="button"
          title={t.bookmarks.addChildTitle}
          onClick={() =>
            onUpdate({
              ...node,
              children: [
                ...node.children,
                {
                  title: `${node.title} - ${t.bookmarks.defaultChildSuffix}`,
                  target_page_index: node.target_page_index,
                  children: [],
                },
              ],
            })
          }
          className="rounded-[4px] p-1 text-[#495057] hover:bg-[#E9ECEF]"
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title={t.bookmarks.deleteTitle}
          onClick={onDelete}
          className="rounded-[4px] p-1 text-[#DC3545] hover:bg-[#F8D7DA]"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {node.children.map((child, idx) => (
        <BookmarkRow
          key={idx}
          node={child}
          depth={depth + 1}
          totalPages={totalPages}
          onUpdate={(updated) => {
            const copy = [...node.children];
            copy[idx] = updated;
            onUpdate({ ...node, children: copy });
          }}
          onDelete={() =>
            onUpdate({
              ...node,
              children: node.children.filter((_, i) => i !== idx),
            })
          }
        />
      ))}
    </div>
  );
};
