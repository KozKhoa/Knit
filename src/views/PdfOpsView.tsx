import React from "react";
import {
  ArrowDown,
  ArrowUp,
  Eraser,
  FilePlus,
  GripVertical,
  Layers,
  Plus,
  RotateCw,
  Scissors,
  Trash2,
  Wand2,
} from "lucide-react";
import { Dropzone } from "../components/Dropzone";
import { useI18n } from "../i18n";
import {
  formatBytes,
  inspectPdfFile,
  mergePdfFiles,
  pickDirectory,
  pickFiles,
  pickSaveFile,
  renderPdfThumbBase64,
  splitPdfFile,
} from "../lib/ipc";
import { usePersistentState } from "../lib/storage";
import type { JobEvent, PageSelection, PdfInfo, PdfSplitRule } from "../types/ipc";
import type { DroppedBatch } from "./Image2PdfView";

interface PdfOpsViewProps {
  onStartJob: (jobId: string, label: string) => void;
  onJobEvent: (ev: JobEvent) => void;
  onFinishJob: (
    title: string,
    outputs: string[],
    summary: string,
    status: "success" | "error" | "cancelled",
  ) => void;
  busy: boolean;
  droppedBatch?: DroppedBatch | null;
}

interface SplitSectionItem {
  uid: string;
  page_index: number;
  rotation_deg: number;
}

interface SplitSectionDraft {
  id: string;
  name: string;
  pages: SplitSectionItem[];
}

type SplitDragPayload =
  | { kind: "source"; page_index: number }
  | { kind: "section_item"; sectionId: string; itemIndex: number };

const INITIAL_THUMB_LIMIT = 48;

export const PdfOpsView: React.FC<PdfOpsViewProps> = ({
  onStartJob,
  onJobEvent,
  onFinishJob,
  busy,
  droppedBatch,
}) => {
  const { t } = useI18n();

  const [tab, setTab] = usePersistentState<"merge" | "split">("knit.pdfops.tab", "merge");
  const [files, setFiles] = React.useState<PdfInfo[]>([]);
  const [selections, setSelections] = React.useState<PageSelection[]>([]);
  const [thumbs, setThumbs] = React.useState<Record<string, string>>({});
  const [thumbLimit, setThumbLimit] = React.useState<number>(INITIAL_THUMB_LIMIT);
  const [preserveBookmarks, setPreserveBookmarks] = usePersistentState<boolean>(
    "knit.pdfops.preserveBookmarks",
    true,
  );
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const [splitRuleKind, setSplitRuleKind] = usePersistentState<
    "page_ranges" | "every_n_pages" | "max_bytes"
  >("knit.pdfops.splitRuleKind", "every_n_pages");
  const [rangesStr, setRangesStr] = usePersistentState<string>("knit.pdfops.rangesStr", "1-2");
  const [everyN, setEveryN] = usePersistentState<number>("knit.pdfops.everyN", 2);
  const [splitMaxMb, setSplitMaxMb] = usePersistentState<number>("knit.pdfops.splitMaxMb", 20);

  const [splitSections, setSplitSections] = React.useState<SplitSectionDraft[]>([]);
  const [activeSectionId, setActiveSectionId] = React.useState<string | null>(null);
  const [hoverSectionId, setHoverSectionId] = React.useState<string | null>(null);
  const splitDragRef = React.useRef<SplitDragPayload | null>(null);
  const lastHandledDropSeq = React.useRef<number>(0);

  const loadPdfThumbsRange = React.useCallback(
    async (fileIndex: number, info: PdfInfo, startPage: number, endPageExclusive: number) => {
      const cap = Math.min(info.page_count, endPageExclusive);
      for (let p = startPage; p < cap; p++) {
        const key = `${fileIndex}:${p}`;
        try {
          const b64 = await renderPdfThumbBase64(info.path, p, 220);
          setThumbs((prev) => ({ ...prev, [key]: `data:image/png;base64,${b64}` }));
        } catch {
          // ignore thumbnail error for malformed fonts
        }
      }
    },
    [],
  );

  const getSplitStem = (info: PdfInfo): string =>
    info.path.split(/[\\/]/).pop()?.replace(/\.pdf$/i, "") || "split";

  const makeDefaultSectionsForPdf = React.useCallback((info: PdfInfo): SplitSectionDraft[] => {
    const stem = getSplitStem(info);
    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    setActiveSectionId(firstId);
    return [
      { id: firstId, name: `${stem}_part01`, pages: [] },
      { id: secondId, name: `${stem}_part02`, pages: [] },
    ];
  }, []);

  const addPdfPaths = React.useCallback(
    async (picked: string[]) => {
      const pdfPaths = picked.filter((p) => p.toLowerCase().endsWith(".pdf"));
      if (pdfPaths.length === 0) return;
      setErrorMsg(null);
      try {
        const baseFileIdx = tab === "split" ? 0 : files.length;
        const newInfos: PdfInfo[] = [];
        const newSelections: PageSelection[] = [];

        for (let i = 0; i < pdfPaths.length; i++) {
          const info = await inspectPdfFile(pdfPaths[i]);
          const fIdx = baseFileIdx + i;
          newInfos.push(info);
          for (let p = 0; p < info.page_count; p++) {
            newSelections.push({ file_index: fIdx, page_index: p, rotation_deg: 0 });
          }
          void loadPdfThumbsRange(fIdx, info, 0, INITIAL_THUMB_LIMIT);
        }

        if (tab === "split") {
          const first = newInfos[0];
          setThumbLimit(INITIAL_THUMB_LIMIT);
          setFiles([first]);
          setSelections(newSelections.filter((s) => s.file_index === 0));
          setSplitSections(makeDefaultSectionsForPdf(first));
        } else {
          setFiles((prev) => [...prev, ...newInfos]);
          setSelections((prev) => [...prev, ...newSelections]);
        }
      } catch (e) {
        setErrorMsg(String(e));
      }
    },
    [files.length, loadPdfThumbsRange, makeDefaultSectionsForPdf, tab],
  );

  React.useEffect(() => {
    if (!droppedBatch || droppedBatch.seq === lastHandledDropSeq.current) return;
    lastHandledDropSeq.current = droppedBatch.seq;
    void addPdfPaths(droppedBatch.paths);
  }, [droppedBatch, addPdfPaths]);

  React.useEffect(() => {
    if (tab === "split" && files.length > 0 && splitSections.length === 0) {
      setSplitSections(makeDefaultSectionsForPdf(files[0]));
    }
  }, [tab, files, splitSections.length, makeDefaultSectionsForPdf]);

  const handleAddPdfs = async () => {
    setErrorMsg(null);
    try {
      const picked = await pickFiles({
        title: t.pdfOps.pickPdfDialog,
        multiple: tab === "merge",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (picked.length === 0) return;
      await addPdfPaths(picked);
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const moveSelection = (idx: number, delta: number) => {
    const target = idx + delta;
    if (target < 0 || target >= selections.length) return;
    setSelections((prev) => {
      const copy = [...prev];
      const [item] = copy.splice(idx, 1);
      copy.splice(target, 0, item);
      return copy;
    });
  };

  const handleLoadMoreSplitThumbs = () => {
    if (files.length === 0) return;
    const src = files[0];
    const nextLimit = Math.min(src.page_count, thumbLimit + INITIAL_THUMB_LIMIT);
    void loadPdfThumbsRange(0, src, thumbLimit, nextLimit);
    setThumbLimit(nextLimit);
  };

  const handlePopulateSectionsFromRule = () => {
    if (files.length === 0) return;
    setErrorMsg(null);
    const src = files[0];
    const total = src.page_count;
    const stem = getSplitStem(src);

    if (splitRuleKind === "every_n_pages") {
      const step = Math.max(1, everyN);
      const next: SplitSectionDraft[] = [];
      let part = 1;
      for (let start = 0; start < total; start += step) {
        const end = Math.min(total, start + step);
        const pages: SplitSectionItem[] = [];
        for (let p = start; p < end; p++) {
          pages.push({ uid: crypto.randomUUID(), page_index: p, rotation_deg: 0 });
        }
        next.push({
          id: crypto.randomUUID(),
          name: `${stem}_part${String(part).padStart(2, "0")}`,
          pages,
        });
        part += 1;
      }
      setSplitSections(next);
      if (next[0]) setActiveSectionId(next[0].id);
    } else if (splitRuleKind === "page_ranges") {
      const parsed = parsePageRangesClient(rangesStr, total);
      if (!parsed || parsed.length === 0) {
        setErrorMsg("Khoảng trang không hợp lệ (ví dụ: 1-3, 5).");
        return;
      }
      const nextId = crypto.randomUUID();
      setSplitSections([
        {
          id: nextId,
          name: `${stem}_extracted`,
          pages: parsed.map((p) => ({ uid: crypto.randomUUID(), page_index: p, rotation_deg: 0 })),
        },
      ]);
      setActiveSectionId(nextId);
    }
  };

  const addSection = () => {
    const stem = files[0] ? getSplitStem(files[0]) : "split";
    const id = crypto.randomUUID();
    const num = splitSections.length + 1;
    setSplitSections((prev) => [
      ...prev,
      { id, name: `${stem}_part${String(num).padStart(2, "0")}`, pages: [] },
    ]);
    setActiveSectionId(id);
  };

  const appendSourcePageToSection = (pageIndex: number, targetSectionId?: string) => {
    const targetId = targetSectionId ?? activeSectionId ?? splitSections[0]?.id;
    if (!targetId) return;
    setSplitSections((prev) =>
      prev.map((sec) =>
        sec.id === targetId
          ? {
              ...sec,
              pages: [
                ...sec.pages,
                { uid: crypto.randomUUID(), page_index: pageIndex, rotation_deg: 0 },
              ],
            }
          : sec,
      ),
    );
  };

  const handleDropOnSection = (targetSectionId: string, insertAtIndex?: number) => {
    const payload = splitDragRef.current;
    splitDragRef.current = null;
    setHoverSectionId(null);
    if (!payload) return;

    if (payload.kind === "source") {
      const item: SplitSectionItem = {
        uid: crypto.randomUUID(),
        page_index: payload.page_index,
        rotation_deg: 0,
      };
      setSplitSections((prev) =>
        prev.map((sec) => {
          if (sec.id !== targetSectionId) return sec;
          const nextPages = [...sec.pages];
          const idx =
            insertAtIndex !== undefined ? Math.max(0, Math.min(nextPages.length, insertAtIndex)) : nextPages.length;
          nextPages.splice(idx, 0, item);
          return { ...sec, pages: nextPages };
        }),
      );
      return;
    }

    // Moving from one section item to another slot / another section
    const { sectionId: fromSecId, itemIndex: fromIdx } = payload;
    setSplitSections((prev) => {
      const fromSec = prev.find((s) => s.id === fromSecId);
      const moving = fromSec?.pages[fromIdx];
      if (!moving) return prev;

      if (fromSecId === targetSectionId) {
        return prev.map((sec) => {
          if (sec.id !== targetSectionId) return sec;
          const nextPages = [...sec.pages];
          nextPages.splice(fromIdx, 1);
          const rawTarget = insertAtIndex ?? nextPages.length;
          const adjusted = fromIdx < rawTarget ? rawTarget - 1 : rawTarget;
          const bounded = Math.max(0, Math.min(nextPages.length, adjusted));
          nextPages.splice(bounded, 0, moving);
          return { ...sec, pages: nextPages };
        });
      }

      return prev.map((sec) => {
        if (sec.id === fromSecId) {
          return { ...sec, pages: sec.pages.filter((_, i) => i !== fromIdx) };
        }
        if (sec.id === targetSectionId) {
          const nextPages = [...sec.pages];
          const idx =
            insertAtIndex !== undefined ? Math.max(0, Math.min(nextPages.length, insertAtIndex)) : nextPages.length;
          nextPages.splice(idx, 0, moving);
          return { ...sec, pages: nextPages };
        }
        return sec;
      });
    });
  };

  const handleMerge = async () => {
    if (files.length === 0 || selections.length === 0 || busy) return;
    setErrorMsg(null);
    try {
      const outPath = await pickSaveFile({
        title: t.pdfOps.saveMergedDialog,
        defaultPath: "merged.pdf",
        filters: [{ name: "PDF Document", extensions: ["pdf"] }],
      });
      if (!outPath) return;

      const jobId = crypto.randomUUID();
      onStartJob(jobId, t.pdfOps.mergeJobTitle);
      const res = await mergePdfFiles(
        jobId,
        {
          inputs: files.map((f) => f.path),
          selected_pages: selections,
          output_path: outPath,
          preserve_bookmarks: preserveBookmarks,
        },
        onJobEvent,
      );
      onFinishJob(
        t.pdfOps.mergeJobTitle,
        res.output_files,
        t.pdfOps.mergeDoneSummary(res.total_pages, formatBytes(res.total_bytes)),
        "success",
      );
    } catch (e) {
      const msg = String(e);
      setErrorMsg(msg);
      onFinishJob(t.pdfOps.mergeJobTitle, [], msg, "error");
    }
  };

  const nonEmptySections = React.useMemo(
    () => splitSections.filter((s) => s.pages.length > 0),
    [splitSections],
  );
  const totalCustomPages = React.useMemo(
    () => nonEmptySections.reduce((acc, s) => acc + s.pages.length, 0),
    [nonEmptySections],
  );

  const handleSplit = async () => {
    if (files.length === 0 || busy) return;
    setErrorMsg(null);
    try {
      const outDir = await pickDirectory(t.pdfOps.pickSplitDirDialog);
      if (!outDir) return;

      const src = files[0];
      const stem = getSplitStem(src);

      const useCustomGroups =
        splitRuleKind !== "max_bytes" && nonEmptySections.length > 0;

      const rule: PdfSplitRule = useCustomGroups
        ? {
            rule: "custom_groups",
            groups: nonEmptySections.map((sec) => ({
              name: sec.name.trim() || stem,
              pages: sec.pages.map((p) => ({
                file_index: 0,
                page_index: p.page_index,
                rotation_deg: p.rotation_deg,
              })),
            })),
          }
        : splitRuleKind === "page_ranges"
          ? { rule: "page_ranges", ranges: rangesStr }
          : splitRuleKind === "every_n_pages"
            ? { rule: "every_n_pages", n: everyN }
            : { rule: "max_bytes", max_mb: splitMaxMb };

      const jobId = crypto.randomUUID();
      onStartJob(jobId, t.pdfOps.splitJobTitle);
      const res = await splitPdfFile(jobId, src.path, outDir, stem, rule, onJobEvent);
      onFinishJob(
        t.pdfOps.splitJobTitle,
        res.output_files,
        t.pdfOps.splitDoneSummary(res.output_files.length, res.total_pages),
        "success",
      );
    } catch (e) {
      const msg = String(e);
      setErrorMsg(msg);
      onFinishJob(t.pdfOps.splitJobTitle, [], msg, "error");
    }
  };

  const sourcePdf = files[0] ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#212529]">{t.pdfOps.title}</h1>
          <p className="text-sm text-[#6C757D]">{t.pdfOps.subtitle}</p>
        </div>

        <div className="flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-white p-1">
          <button
            type="button"
            onClick={() => setTab("merge")}
            className={`knit-control-sm flex items-center gap-1.5 rounded-[4px] px-3 text-sm font-semibold ${
              tab === "merge" ? "bg-[#007BFF] text-white" : "text-[#495057]"
            }`}
          >
            <Layers className="h-4 w-4" />
            {t.pdfOps.mergeTab}
          </button>
          <button
            type="button"
            onClick={() => setTab("split")}
            className={`knit-control-sm flex items-center gap-1.5 rounded-[4px] px-3 text-sm font-semibold ${
              tab === "split" ? "bg-[#007BFF] text-white" : "text-[#495057]"
            }`}
          >
            <Scissors className="h-4 w-4" />
            {t.pdfOps.splitTab}
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-[4px] border border-[#F5C6CB] bg-[#F8D7DA] px-3.5 py-2.5 text-sm text-[#721C24]">
          {errorMsg}
        </div>
      )}

      <Dropzone
        title={tab === "merge" ? t.pdfOps.dropTitleMerge : t.pdfOps.dropTitleSplit}
        description={t.pdfOps.dropDesc}
        onPickFiles={() => void handleAddPdfs()}
        filesLabel={tab === "merge" ? t.pdfOps.addPdfBtn : t.pdfOps.pickPdfBtn}
      />

      {files.length > 0 && (
        <div className="space-y-2 rounded-[4px] border border-[#DEE2E6] bg-white p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-[#343A40]">
              {t.pdfOps.loadedDocs(files.length)}
            </span>
            <button
              type="button"
              onClick={() => {
                setFiles([]);
                setSelections([]);
                setThumbs({});
                setSplitSections([]);
              }}
              className="text-xs font-semibold text-[#DC3545] hover:underline"
            >
              {t.common.clearAll}
            </button>
          </div>
          {files.map((f, idx) => (
            <div
              key={`${f.path}-${idx}`}
              className="flex items-center justify-between rounded-[4px] border border-[#E9ECEF] bg-[#F8F9FA] px-3 py-2 text-xs"
            >
              <span className="font-mono-code truncate">{f.path}</span>
              <span className="ml-3 shrink-0 font-mono-code text-[#6C757D]">
                {t.pdfOps.docMeta(f.page_count, formatBytes(f.file_size_bytes), f.bookmarks.length)}
              </span>
            </div>
          ))}
        </div>
      )}

      {tab === "merge" && selections.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-[#DEE2E6] bg-white px-4 py-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-[#212529]">
              <input
                type="checkbox"
                checked={preserveBookmarks}
                onChange={(e) => setPreserveBookmarks(e.target.checked)}
              />
              {t.pdfOps.preserveBookmarks}
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleMerge()}
              className="knit-control inline-flex items-center gap-1.5 rounded-[4px] bg-[#007BFF] px-4 text-sm font-semibold text-white hover:bg-[#0069D9] disabled:opacity-50"
            >
              <FilePlus className="h-4 w-4" />
              {t.pdfOps.mergeBtn(selections.length)}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {selections.map((sel, idx) => {
              const key = `${sel.file_index}:${sel.page_index}`;
              return (
                <div
                  key={`${key}-${idx}`}
                  className="flex flex-col overflow-hidden rounded-[4px] border border-[#DEE2E6] bg-white"
                >
                  <div className="relative flex h-32 items-center justify-center bg-[#F1F3F5] p-1">
                    {thumbs[key] ? (
                      <img
                        src={thumbs[key]}
                        alt={`File ${sel.file_index + 1} P${sel.page_index + 1}`}
                        className="max-h-full max-w-full object-contain"
                        style={{ transform: `rotate(${sel.rotation_deg}deg)` }}
                      />
                    ) : (
                      <span className="font-mono-code text-xs text-[#6C757D]">
                        F{sel.file_index + 1}·P{sel.page_index + 1}
                      </span>
                    )}
                    <span className="absolute left-1 top-1 rounded-[4px] bg-[#343A40] px-1.5 py-0.5 font-mono-code text-[11px] text-white">
                      #{idx + 1}
                    </span>
                  </div>
                  <div className="border-t border-[#DEE2E6] p-2">
                    <div className="font-mono-code text-xs text-[#6C757D]">
                      {t.pdfOps.pageMeta(sel.file_index + 1, sel.page_index + 1, sel.rotation_deg)}
                    </div>
                    <div className="mt-1.5 flex items-center justify-between">
                      <div className="flex gap-0.5">
                        <button
                          type="button"
                          onClick={() => moveSelection(idx, -1)}
                          disabled={idx === 0}
                          className="rounded-[4px] border border-[#DEE2E6] p-1 hover:bg-[#F8F9FA] disabled:opacity-30"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveSelection(idx, 1)}
                          disabled={idx === selections.length - 1}
                          className="rounded-[4px] border border-[#DEE2E6] p-1 hover:bg-[#F8F9FA] disabled:opacity-30"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setSelections((prev) =>
                              prev.map((s, i) =>
                                i === idx ? { ...s, rotation_deg: (s.rotation_deg + 90) % 360 } : s,
                              ),
                            )
                          }
                          className="rounded-[4px] border border-[#DEE2E6] p-1 hover:bg-[#F8F9FA]"
                        >
                          <RotateCw className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelections((prev) => prev.filter((_, i) => i !== idx))}
                        className="rounded-[4px] p-1 text-[#DC3545] hover:bg-[#F8D7DA]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "split" && sourcePdf && (
        <div className="space-y-4">
          {/* Quick Split Presets + Main Split CTA */}
          <div className="flex flex-wrap items-end gap-3 rounded-[4px] border border-[#DEE2E6] bg-white p-4">
            <div className="min-w-[220px] flex-1">
              <label className="block text-xs font-semibold uppercase text-[#6C757D]">
                {t.pdfOps.splitModeLabel}
              </label>
              <select
                value={splitRuleKind}
                onChange={(e) => setSplitRuleKind(e.target.value as typeof splitRuleKind)}
                className="knit-control mt-1 w-full rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-sm"
              >
                <option value="every_n_pages">{t.pdfOps.splitEveryNOpt}</option>
                <option value="page_ranges">{t.pdfOps.splitRangesOpt}</option>
                <option value="max_bytes">{t.pdfOps.splitMaxBytesOpt}</option>
              </select>
            </div>

            {splitRuleKind === "page_ranges" && (
              <div className="min-w-[180px] flex-1">
                <label className="block text-xs font-semibold uppercase text-[#6C757D]">
                  {t.pdfOps.rangesLabel}
                </label>
                <input
                  type="text"
                  value={rangesStr}
                  onChange={(e) => setRangesStr(e.target.value)}
                  placeholder="1-3, 5, 8-10"
                  className="knit-control mt-1 w-full rounded-[4px] border border-[#CED4DA] px-2.5 font-mono-code text-xs"
                />
              </div>
            )}

            {splitRuleKind === "every_n_pages" && (
              <div className="w-40">
                <label className="block text-xs font-semibold uppercase text-[#6C757D]">
                  {t.pdfOps.everyNLabel}
                </label>
                <input
                  type="number"
                  min={1}
                  value={everyN}
                  onChange={(e) => setEveryN(Math.max(1, Number(e.target.value) || 1))}
                  className="knit-control mt-1 w-full rounded-[4px] border border-[#CED4DA] px-2.5 font-mono-code text-xs"
                />
              </div>
            )}

            {splitRuleKind === "max_bytes" && (
              <div className="w-44">
                <label className="block text-xs font-semibold uppercase text-[#6C757D]">
                  {t.pdfOps.maxMbLabel}
                </label>
                <input
                  type="number"
                  min={1}
                  step={0.5}
                  value={splitMaxMb}
                  onChange={(e) => setSplitMaxMb(Math.max(0.5, Number(e.target.value) || 1))}
                  className="knit-control mt-1 w-full rounded-[4px] border border-[#CED4DA] px-2.5 font-mono-code text-xs"
                />
              </div>
            )}

            {splitRuleKind !== "max_bytes" && (
              <button
                type="button"
                onClick={handlePopulateSectionsFromRule}
                className="knit-control inline-flex items-center gap-1.5 rounded-[4px] border border-[#CED4DA] bg-[#F8F9FA] px-3 text-sm font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
              >
                <Wand2 className="h-4 w-4 text-[#007BFF]" />
                {t.pdfOps.generateSectionsBtn}
              </button>
            )}

            <button
              type="button"
              disabled={busy}
              onClick={() => void handleSplit()}
              className="knit-control inline-flex items-center gap-1.5 rounded-[4px] bg-[#007BFF] px-4 text-sm font-semibold text-white hover:bg-[#0069D9] disabled:opacity-50"
            >
              <Scissors className="h-4 w-4" />
              {splitRuleKind !== "max_bytes" && nonEmptySections.length > 0
                ? t.pdfOps.splitCustomBtn(nonEmptySections.length, totalCustomPages)
                : t.pdfOps.splitBtn}
            </button>
          </div>

          {/* Visual Drag-and-Drop Source Pages + Output Sections */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            {/* Source PDF Pages Strip */}
            <div className="space-y-2.5 rounded-[4px] border border-[#DEE2E6] bg-white p-3.5 lg:col-span-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-bold text-[#343A40]">
                    {t.pdfOps.sourcePagesTitle(sourcePdf.page_count)}
                  </div>
                  <div className="text-xs text-[#6C757D]">{t.pdfOps.sourcePagesHint}</div>
                </div>
                {sourcePdf.page_count > thumbLimit && (
                  <button
                    type="button"
                    onClick={handleLoadMoreSplitThumbs}
                    className="knit-control-sm rounded-[4px] border border-[#CED4DA] bg-[#F8F9FA] px-2.5 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
                  >
                    {t.pdfOps.loadMoreThumbsBtn(thumbLimit, sourcePdf.page_count)}
                  </button>
                )}
              </div>

              <div className="grid max-h-[540px] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4 lg:grid-cols-3">
                {Array.from({ length: sourcePdf.page_count }, (_, pIdx) => {
                  const thumbKey = `0:${pIdx}`;
                  return (
                    <div
                      key={pIdx}
                      draggable
                      onDragStart={(e) => {
                        splitDragRef.current = { kind: "source", page_index: pIdx };
                        e.dataTransfer.effectAllowed = "copy";
                        e.dataTransfer.setData("text/plain", `source:${pIdx}`);
                      }}
                      onDragEnd={() => {
                        splitDragRef.current = null;
                        setHoverSectionId(null);
                      }}
                      className="group flex cursor-grab flex-col overflow-hidden rounded-[4px] border border-[#DEE2E6] bg-[#F8F9FA] active:cursor-grabbing hover:border-[#007BFF]"
                    >
                      <div className="relative flex h-24 items-center justify-center bg-white p-1">
                        {thumbs[thumbKey] ? (
                          <img
                            src={thumbs[thumbKey]}
                            alt={`P${pIdx + 1}`}
                            draggable={false}
                            className="pointer-events-none max-h-full max-w-full object-contain"
                          />
                        ) : (
                          <span className="font-mono-code text-xs text-[#6C757D]">
                            P{pIdx + 1}
                          </span>
                        )}
                        <span className="absolute left-1 top-1 flex items-center gap-0.5 rounded-[4px] bg-[#343A40] px-1 py-0.5 font-mono-code text-[10px] text-white">
                          <GripVertical className="h-2.5 w-2.5 text-[#ADB5BD]" />
                          {pIdx + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => appendSourcePageToSection(pIdx)}
                          title="Add to active section"
                          className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-[4px] bg-[#007BFF] text-white opacity-90 hover:opacity-100"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Output Sections Builder */}
            <div className="space-y-3 lg:col-span-7">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-[#DEE2E6] bg-white px-3.5 py-2.5">
                <span className="text-sm font-bold text-[#343A40]">
                  {t.pdfOps.splitBuilderTitle}
                </span>
                <button
                  type="button"
                  onClick={addSection}
                  className="knit-control-sm inline-flex items-center gap-1 rounded-[4px] border border-[#007BFF] bg-[#E7F1FF] px-3 text-xs font-semibold text-[#0056B3] hover:bg-[#007BFF] hover:text-white"
                >
                  {t.pdfOps.addSectionBtn}
                </button>
              </div>

              <div className="space-y-3">
                {splitSections.map((section, sIdx) => {
                  const isActive = activeSectionId === section.id;
                  const isHovered = hoverSectionId === section.id;
                  return (
                    <div
                      key={section.id}
                      onClick={() => setActiveSectionId(section.id)}
                      onDragOver={(e) => {
                        if (!splitDragRef.current) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect =
                          splitDragRef.current.kind === "source" ? "copy" : "move";
                        if (hoverSectionId !== section.id) setHoverSectionId(section.id);
                      }}
                      onDragLeave={() => {
                        if (hoverSectionId === section.id) setHoverSectionId(null);
                      }}
                      onDrop={(e) => {
                        if (!splitDragRef.current) return;
                        e.preventDefault();
                        e.stopPropagation();
                        handleDropOnSection(section.id);
                      }}
                      className={`rounded-[4px] border bg-white p-3 transition-colors ${
                        isHovered
                          ? "border-2 border-dashed border-[#007BFF] bg-[#E7F1FF]/40"
                          : isActive
                            ? "border-[#007BFF] ring-1 ring-[#007BFF]/40"
                            : "border-[#DEE2E6]"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E9ECEF] pb-2.5">
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] bg-[#343A40] font-mono-code text-xs font-bold text-white">
                            {sIdx + 1}
                          </span>
                          <input
                            type="text"
                            value={section.name}
                            onChange={(e) =>
                              setSplitSections((prev) =>
                                prev.map((s) =>
                                  s.id === section.id ? { ...s, name: e.target.value } : s,
                                ),
                              )
                            }
                            placeholder={t.pdfOps.sectionNamePlaceholder}
                            className="knit-control-sm min-w-0 flex-1 rounded-[4px] border border-[#CED4DA] px-2.5 font-mono-code text-xs text-[#212529]"
                          />
                          <span className="shrink-0 rounded-[4px] bg-[#E9ECEF] px-2 py-0.5 font-mono-code text-xs font-semibold text-[#495057]">
                            {t.pdfOps.sectionPagesCount(section.pages.length)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSplitSections((prev) =>
                                prev.map((s) => (s.id === section.id ? { ...s, pages: [] } : s)),
                              );
                            }}
                            disabled={section.pages.length === 0}
                            title={t.pdfOps.clearSectionTitle}
                            className="knit-control-sm inline-flex items-center rounded-[4px] border border-[#CED4DA] px-2 text-xs text-[#6C757D] hover:bg-[#F8F9FA] disabled:opacity-30"
                          >
                            <Eraser className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSplitSections((prev) =>
                                prev.filter((s) => s.id !== section.id),
                              );
                            }}
                            disabled={splitSections.length <= 1}
                            title={t.pdfOps.deleteSectionTitle}
                            className="knit-control-sm inline-flex items-center rounded-[4px] border border-[#F5C6CB] px-2 text-xs text-[#DC3545] hover:bg-[#F8D7DA] disabled:opacity-30"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {section.pages.length === 0 ? (
                        <div className="mt-2.5 rounded-[4px] border border-dashed border-[#CED4DA] bg-[#F8F9FA] py-5 text-center text-xs text-[#6C757D]">
                          {t.pdfOps.emptySectionHint}
                        </div>
                      ) : (
                        <div className="mt-2.5 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                          {section.pages.map((item, itemIdx) => {
                            const thumbKey = `0:${item.page_index}`;
                            return (
                              <div
                                key={item.uid}
                                draggable
                                onDragStart={(e) => {
                                  e.stopPropagation();
                                  splitDragRef.current = {
                                    kind: "section_item",
                                    sectionId: section.id,
                                    itemIndex: itemIdx,
                                  };
                                  e.dataTransfer.effectAllowed = "move";
                                  e.dataTransfer.setData("text/plain", item.uid);
                                }}
                                onDragOver={(e) => {
                                  if (!splitDragRef.current) return;
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (hoverSectionId !== section.id) setHoverSectionId(section.id);
                                }}
                                onDrop={(e) => {
                                  if (!splitDragRef.current) return;
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleDropOnSection(section.id, itemIdx);
                                }}
                                onDragEnd={() => {
                                  splitDragRef.current = null;
                                  setHoverSectionId(null);
                                }}
                                className="flex cursor-grab flex-col overflow-hidden rounded-[4px] border border-[#DEE2E6] bg-[#F8F9FA] active:cursor-grabbing"
                              >
                                <div className="relative flex h-20 items-center justify-center bg-white p-1">
                                  {thumbs[thumbKey] ? (
                                    <img
                                      src={thumbs[thumbKey]}
                                      alt={`Pg ${item.page_index + 1}`}
                                      draggable={false}
                                      className="pointer-events-none max-h-full max-w-full object-contain"
                                      style={{ transform: `rotate(${item.rotation_deg}deg)` }}
                                    />
                                  ) : (
                                    <span className="font-mono-code text-xs text-[#6C757D]">
                                      P{item.page_index + 1}
                                    </span>
                                  )}
                                  <span className="absolute left-1 top-1 rounded-[4px] bg-[#007BFF] px-1 py-0.5 font-mono-code text-[10px] text-white">
                                    P{item.page_index + 1}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between border-t border-[#DEE2E6] px-1.5 py-1">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSplitSections((prev) =>
                                        prev.map((s) =>
                                          s.id === section.id
                                            ? {
                                                ...s,
                                                pages: s.pages.map((p) =>
                                                  p.uid === item.uid
                                                    ? { ...p, rotation_deg: (p.rotation_deg + 90) % 360 }
                                                    : p,
                                                ),
                                              }
                                            : s,
                                        ),
                                      );
                                    }}
                                    className="rounded-[4px] p-0.5 text-[#495057] hover:bg-[#E9ECEF]"
                                  >
                                    <RotateCw className="h-3 w-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSplitSections((prev) =>
                                        prev.map((s) =>
                                          s.id === section.id
                                            ? {
                                                ...s,
                                                pages: s.pages.filter((p) => p.uid !== item.uid),
                                              }
                                            : s,
                                        ),
                                      );
                                    }}
                                    className="rounded-[4px] p-0.5 text-[#DC3545] hover:bg-[#F8D7DA]"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function parsePageRangesClient(spec: string, totalPages: number): number[] | null {
  if (totalPages <= 0) return null;
  const out: number[] = [];
  for (const rawPart of spec.split(",")) {
    const part = rawPart.trim();
    if (!part) continue;
    const dashIdx = part.indexOf("-");
    if (dashIdx >= 0) {
      const a = Number.parseInt(part.slice(0, dashIdx).trim(), 10);
      const b = Number.parseInt(part.slice(dashIdx + 1).trim(), 10);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a < 1 || b < 1 || a > totalPages || b > totalPages) {
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
