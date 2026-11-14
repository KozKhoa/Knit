import React from "react";
import { NumberInput } from "../components/NumberInput";
import { Select } from "../components/Select";
import { Slider } from "../components/Slider";
import {
  Edit3,
  FileOutput,
  GripVertical,
  Layers,
  RotateCw,
  Trash2,
} from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { BookmarkTreeEditor } from "../components/BookmarkTreeEditor";
import { Dropzone } from "../components/Dropzone";
import { ImageCanvasEditorModal } from "../components/ImageCanvasEditorModal";
import { useI18n } from "../i18n";
import {
  buildImage2Pdf,
  isTauriRuntime,
  pickDirectory,
  pickFiles,
  pickSaveFile,
  renderImageThumbBase64,
  scanImagesForPdf,
} from "../lib/ipc";
import { usePersistentState } from "../lib/storage";
import type {
  AnimatedImagePolicy,
  BookmarkNode,
  Image2PdfConfig,
  JobEvent,
  PageBackground,
  PageDraft,
  PageLayoutPolicy,
} from "../types/ipc";

export interface DroppedBatch {
  seq: number;
  paths: string[];
}

interface Image2PdfViewProps {
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

type BgMode = "transparent" | "white" | "black" | "custom";
type MarginUnit = "pt" | "mm";

const PT_PER_MM = 72 / 25.4;
const GRID_COL_OPTIONS = [2, 3, 4, 5, 6] as const;

export const Image2PdfView: React.FC<Image2PdfViewProps> = ({
  onStartJob,
  onJobEvent,
  onFinishJob,
  busy,
  droppedBatch,
}) => {
  const { t } = useI18n();

  const [pages, setPages] = React.useState<PageDraft[]>([]);
  const [bookmarks, setBookmarks] = React.useState<BookmarkNode[]>([]);
  const [thumbCache, setThumbCache] = React.useState<Record<string, string>>({});
  const [editingPageId, setEditingPageId] = React.useState<string | null>(null);

  const [layoutMode, setLayoutMode] = usePersistentState<"original_size" | "fit_a4" | "fit_letter">(
    "knit.img2pdf.layoutMode",
    "original_size",
  );
  const [dpi, setDpi] = usePersistentState<number>("knit.img2pdf.dpi", 72);
  const [marginValue, setMarginValue] = usePersistentState<number>("knit.img2pdf.marginValue", 24);
  const [marginUnit, setMarginUnit] = usePersistentState<MarginUnit>("knit.img2pdf.marginUnit", "pt");
  const [bgMode, setBgMode] = usePersistentState<BgMode>("knit.img2pdf.bgMode", "white");
  const [bgCustomHex, setBgCustomHex] = usePersistentState<string>(
    "knit.img2pdf.bgCustomHex",
    "#F8F9FA",
  );
  const [jpegQuality, setJpegQuality] = usePersistentState<number>("knit.img2pdf.jpegQuality", 88);
  const [losslessPassthrough, setLosslessPassthrough] = usePersistentState<boolean>(
    "knit.img2pdf.losslessPassthrough",
    true,
  );
  const [animatedPolicy, setAnimatedPolicy] = usePersistentState<AnimatedImagePolicy>(
    "knit.img2pdf.animatedPolicy",
    "first_frame_only",
  );
  const [maxMb, setMaxMb] = usePersistentState<string>("knit.img2pdf.maxMb", "");
  const [gridCols, setGridCols] = usePersistentState<number>("knit.img2pdf.gridCols", 4);

  const [dragIndex, setDragIndex] = React.useState<number | null>(null);
  const [dropTarget, setDropTarget] = React.useState<{
    index: number;
    side: "before" | "after";
  } | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const lastHandledDropSeq = React.useRef<number>(0);

  const loadThumbnails = React.useCallback(async (newPages: PageDraft[]) => {
    for (const p of newPages) {
      if (p.source.kind === "image_file") {
        const lower = p.source.path.toLowerCase();
        if (lower.endsWith(".avif") || lower.endsWith(".tiff") || lower.endsWith(".tif")) {
          try {
            const b64 = await renderImageThumbBase64(p.source.path, 360);
            setThumbCache((prev) => ({ ...prev, [p.id]: `data:image/png;base64,${b64}` }));
          } catch {
            // fallback handled by placeholder
          }
        } else if (isTauriRuntime()) {
          setThumbCache((prev) => ({
            ...prev,
            [p.id]: convertFileSrc(p.source.kind === "image_file" ? p.source.path : ""),
          }));
        }
      } else if (p.source.kind === "animated_frame") {
        try {
          const b64 = await renderImageThumbBase64(p.source.path, 360);
          setThumbCache((prev) => ({ ...prev, [p.id]: `data:image/png;base64,${b64}` }));
        } catch {
          // ignore
        }
      }
    }
  }, []);

  const appendScanPaths = React.useCallback(
    async (paths: string[], isFolder: boolean) => {
      if (paths.length === 0) return;
      setErrorMsg(null);
      try {
        const scan = await scanImagesForPdf(paths, isFolder, animatedPolicy);
        if (scan.pages.length === 0) return;
        setPages((prev) => {
          const offset = prev.length;
          if (scan.bookmarks.length > 0) {
            const shifted = shiftBookmarks(scan.bookmarks, offset);
            setBookmarks((bPrev) => [...bPrev, ...shifted]);
          }
          return [...prev, ...scan.pages];
        });
        void loadThumbnails(scan.pages);
      } catch (e) {
        setErrorMsg(String(e));
      }
    },
    [animatedPolicy, loadThumbnails],
  );

  React.useEffect(() => {
    if (!droppedBatch || droppedBatch.seq === lastHandledDropSeq.current) return;
    lastHandledDropSeq.current = droppedBatch.seq;
    void appendScanPaths(droppedBatch.paths, false);
  }, [droppedBatch, appendScanPaths]);

  const handlePickFiles = async () => {
    setErrorMsg(null);
    try {
      const selected = await pickFiles({
        title: t.image2pdf.pickFilesDialog,
        multiple: true,
        filters: [
          {
            name: "Images",
            extensions: ["jpg", "jpeg", "jfif", "png", "webp", "avif", "gif", "bmp", "tiff", "tif"],
          },
        ],
      });
      if (selected.length === 0) return;
      await appendScanPaths(selected, false);
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const handlePickFolder = async () => {
    setErrorMsg(null);
    try {
      const dir = await pickDirectory(t.image2pdf.pickFolderDialog);
      if (!dir) return;
      await appendScanPaths([dir], true);
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const reorderPage = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || toIdx >= pages.length) return;
    setPages((prev) => {
      const next = [...prev];
      const [item] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, item);
      return next;
    });
  };

  const rotatePage = (id: string) => {
    setPages((prev) =>
      prev.map((p) => (p.id === id ? { ...p, rotation_deg: (p.rotation_deg + 90) % 360 } : p)),
    );
  };

  const removePage = (id: string) => {
    setPages((prev) => prev.filter((p) => p.id !== id));
  };

  const switchMarginUnit = (nextUnit: MarginUnit) => {
    if (nextUnit === marginUnit) return;
    const converted =
      nextUnit === "mm" ? marginValue / PT_PER_MM : marginValue * PT_PER_MM;
    setMarginValue(Math.round(converted * 10) / 10);
    setMarginUnit(nextUnit);
  };

  const buildPageBackground = (): PageBackground => {
    switch (bgMode) {
      case "transparent":
        return { kind: "transparent" };
      case "white":
        return { kind: "white" };
      case "black":
        return { kind: "black" };
      case "custom": {
        const rgb = parseHexRgb(bgCustomHex);
        return { kind: "custom", ...rgb };
      }
    }
  };

  const handleExportPdf = async () => {
    if (pages.length === 0 || busy) return;
    setErrorMsg(null);
    try {
      const outPath = await pickSaveFile({
        title: t.image2pdf.savePdfDialog,
        defaultPath: "output.pdf",
        filters: [{ name: "PDF Document", extensions: ["pdf"] }],
      });
      if (!outPath) return;

      const marginPt =
        marginUnit === "mm" ? Math.max(0, marginValue) * PT_PER_MM : Math.max(0, marginValue);
      const background = buildPageBackground();

      const layout: PageLayoutPolicy =
        layoutMode === "original_size"
          ? { mode: "original_size", dpi }
          : layoutMode === "fit_a4"
            ? { mode: "fit_a4", margin_pt: marginPt, background }
            : { mode: "fit_letter", margin_pt: marginPt, background };

      const parsedMax = Number(maxMb);
      const config: Image2PdfConfig = {
        output_path: outPath,
        layout,
        jpeg_quality: jpegQuality,
        lossless_passthrough: losslessPassthrough,
        animated_policy: animatedPolicy,
        max_mb: maxMb.trim() !== "" && !Number.isNaN(parsedMax) && parsedMax > 0 ? parsedMax : null,
      };

      const jobId = crypto.randomUUID();
      onStartJob(jobId, t.shell.nav.image2pdf.label);
      const res = await buildImage2Pdf(jobId, pages, bookmarks, config, onJobEvent);
      onFinishJob(
        t.shell.nav.image2pdf.label,
        res.output_files,
        t.image2pdf.exportDoneSummary(res.total_pages, res.output_files.length, res.passthrough_pages),
        "success",
      );
    } catch (e) {
      const msg = String(e);
      setErrorMsg(msg);
      onFinishJob(
        t.shell.nav.image2pdf.label,
        [],
        msg,
        msg.toLowerCase().includes("cancel") || msg.includes("huy") ? "cancelled" : "error",
      );
    }
  };

  const editingPage = pages.find((p) => p.id === editingPageId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#212529]">{t.image2pdf.title}</h1>
          <p className="text-sm text-[#6C757D]">{t.image2pdf.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {pages.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setPages([]);
                setBookmarks([]);
              }}
              className="rounded-[4px] border border-[#CED4DA] bg-white px-3.5 py-2 text-sm font-semibold text-[#DC3545] hover:bg-[#F8D7DA]"
            >
              {t.image2pdf.clearList}
            </button>
          )}
          <button
            type="button"
            disabled={pages.length === 0 || busy}
            onClick={() => void handleExportPdf()}
            className="flex items-center gap-1.5 rounded-[4px] bg-[#007BFF] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0069D9] disabled:opacity-50"
          >
            <FileOutput className="h-4 w-4" />
            {t.image2pdf.exportBtn(pages.length)}
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-[4px] border border-[#F5C6CB] bg-[#F8D7DA] px-3.5 py-2.5 text-sm text-[#721C24]">
          {errorMsg}
        </div>
      )}

      {/* Configuration Bar */}
      <div className="grid grid-cols-1 gap-3.5 rounded-[4px] border border-[#DEE2E6] bg-white p-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.image2pdf.layoutHeading}
          </label>
          <Select
            ariaLabel={t.image2pdf.layoutHeading}
            value={layoutMode}
            onChange={(val) => setLayoutMode(val as typeof layoutMode)}
            className="w-full"
            options={[
              { value: "original_size", label: t.image2pdf.layoutOriginal },
              { value: "fit_a4", label: t.image2pdf.layoutA4 },
              { value: "fit_letter", label: t.image2pdf.layoutLetter },
            ]}
          />

          {layoutMode === "original_size" ? (
            <label className="flex items-center justify-between gap-2 text-xs text-[#6C757D]">
              <span>{t.image2pdf.dpiLabel}</span>
              <NumberInput
                ariaLabel={t.image2pdf.dpiLabel}
                size="sm"
                min={36}
                max={600}
                value={dpi}
                onChange={setDpi}
                className="w-24"
              />
            </label>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs text-[#6C757D]">
                <span>{t.image2pdf.paddingLabel}</span>
                <div className="flex items-center gap-1">
                  <NumberInput
                    ariaLabel={t.image2pdf.paddingLabel}
                    size="sm"
                    min={0}
                    max={marginUnit === "mm" ? 60 : 170}
                    step={marginUnit === "mm" ? 1 : 2}
                    value={marginValue}
                    onChange={setMarginValue}
                    className="w-20"
                  />
                  <Select
                    ariaLabel="Padding unit"
                    size="sm"
                    value={marginUnit}
                    onChange={(val) => switchMarginUnit(val as MarginUnit)}
                    className="font-mono-code"
                    options={[
                      { value: "mm", label: "mm" },
                      { value: "pt", label: "pt" },
                    ]}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 text-xs text-[#6C757D]">
                <span>{t.image2pdf.bgColorLabel}</span>
                <div className="flex items-center gap-1.5">
                  <Select
                    ariaLabel={t.image2pdf.bgColorLabel}
                    size="sm"
                    value={bgMode}
                    onChange={(val) => setBgMode(val as BgMode)}
                    options={[
                      { value: "white", label: t.image2pdf.bgWhite },
                      { value: "black", label: t.image2pdf.bgBlack },
                      { value: "transparent", label: t.image2pdf.bgTransparent },
                      { value: "custom", label: t.image2pdf.bgCustom },
                    ]}
                  />
                  {bgMode === "custom" && (
                    <input
                      type="color"
                      value={bgCustomHex}
                      onChange={(e) => setBgCustomHex(e.target.value)}
                      className="knit-control-sm w-9 cursor-pointer rounded-[4px] border border-[#CED4DA] bg-white p-0.5"
                      title={bgCustomHex}
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.image2pdf.qualityHeading}
          </label>
          <label className="flex items-center gap-2 text-sm text-[#212529]">
            <input
              type="checkbox"
              checked={losslessPassthrough}
              onChange={(e) => setLosslessPassthrough(e.target.checked)}
            />
            {t.image2pdf.losslessLabel}
          </label>
          <label className="flex items-center justify-between gap-2 text-xs text-[#6C757D]">
            <span>{t.image2pdf.jpegQualityLabel(jpegQuality)}</span>
            <Slider
              ariaLabel="JPEG Quality"
              min={40}
              max={100}
              step={1}
              value={jpegQuality}
              onChange={setJpegQuality}
              className="w-28"
            />
          </label>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.image2pdf.animatedHeading}
          </label>
          <Select
            ariaLabel={t.image2pdf.animatedHeading}
            value={animatedPolicy}
            onChange={(val) => setAnimatedPolicy(val as AnimatedImagePolicy)}
            className="w-full"
            options={[
              { value: "first_frame_only", label: t.image2pdf.animatedFirstFrame },
              { value: "unpack_all_frames", label: t.image2pdf.animatedUnpackAll },
            ]}
          />
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.image2pdf.splitMbHeading}
          </label>
          <NumberInput
            ariaLabel={t.image2pdf.splitMbHeading}
            min={0}
            step={1}
            value={maxMb.trim() !== "" && !Number.isNaN(Number(maxMb)) ? Number(maxMb) : 0}
            onChange={(val) => setMaxMb(val > 0 ? String(val) : "")}
            className="w-full"
          />
          <p className="text-[11px] text-[#6C757D]">{t.image2pdf.splitMbPlaceholder}</p>
        </div>
      </div>

      <Dropzone
        title={t.image2pdf.dropzoneTitle}
        description={t.image2pdf.dropzoneDesc}
        onPickFiles={() => void handlePickFiles()}
        onPickFolder={() => void handlePickFolder()}
        filesLabel={t.image2pdf.pickFilesLabel}
        folderLabel={t.image2pdf.pickFolderLabel}
      />

      {pages.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-3 lg:col-span-2">
            {/* Grid Density & Drag Reorder Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-[#DEE2E6] bg-white px-3.5 py-2">
              <div className="flex items-center gap-2 text-xs text-[#6C757D]">
                <GripVertical className="h-4 w-4 text-[#007BFF]" />
                <span>{t.image2pdf.dragHint}</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-[#495057]">
                <span className="font-semibold">{t.image2pdf.gridColumnsLabel}</span>
                {GRID_COL_OPTIONS.map((cols) => (
                  <button
                    key={cols}
                    type="button"
                    onClick={() => setGridCols(cols)}
                    className={`knit-control-sm rounded-[4px] px-2.5 font-mono-code text-xs font-semibold ${
                      gridCols === cols
                        ? "bg-[#007BFF] text-white"
                        : "border border-[#CED4DA] bg-[#F8F9FA] text-[#343A40] hover:bg-[#E9ECEF]"
                    }`}
                  >
                    {cols}
                  </button>
                ))}
              </div>
            </div>

            {(() => {
              const insertAt = dropTarget
                ? dropTarget.side === "before"
                  ? dropTarget.index
                  : dropTarget.index + 1
                : null;
              const isNoOpInsert =
                dragIndex !== null &&
                insertAt !== null &&
                (insertAt === dragIndex || insertAt === dragIndex + 1);

              const commitDrop = () => {
                if (dragIndex !== null && insertAt !== null && !isNoOpInsert) {
                  const targetIdx = insertAt > dragIndex ? insertAt - 1 : insertAt;
                  reorderPage(dragIndex, targetIdx);
                }
                setDragIndex(null);
                setDropTarget(null);
              };

              return (
                <div
                  className="grid gap-3"
                  style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
                  onDragOver={(e) => {
                    if (dragIndex !== null) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }
                  }}
                  onDrop={(e) => {
                    if (dragIndex === null) return;
                    e.preventDefault();
                    commitDrop();
                  }}
                >
                  {pages.map((page, idx) => {
                    const hasEdits =
                      page.rotation_deg % 360 !== 0 ||
                      page.crop !== null ||
                      page.annotations.texts.length > 0 ||
                      page.annotations.strokes.length > 0;
                    const isDragged = dragIndex === idx;
                    const isQuarterRotated = Math.abs(page.rotation_deg % 180) === 90;
                    const showBarLeft =
                      !isNoOpInsert &&
                      dropTarget?.index === idx &&
                      dropTarget.side === "before";
                    const showBarRight =
                      !isNoOpInsert &&
                      dropTarget?.index === idx &&
                      dropTarget.side === "after";

                    return (
                      <div
                        key={page.id}
                        draggable
                        onDragStart={(e) => {
                          setDragIndex(idx);
                          setDropTarget(null);
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", page.id);
                        }}
                        onDragOver={(e) => {
                          if (dragIndex === null) return;
                          e.preventDefault();
                          e.stopPropagation();
                          e.dataTransfer.dropEffect = "move";
                          const rect = e.currentTarget.getBoundingClientRect();
                          const side = e.clientX < rect.left + rect.width / 2 ? "before" : "after";
                          if (dropTarget?.index !== idx || dropTarget?.side !== side) {
                            setDropTarget({ index: idx, side });
                          }
                        }}
                        onDrop={(e) => {
                          if (dragIndex === null) return;
                          e.preventDefault();
                          e.stopPropagation();
                          commitDrop();
                        }}
                        onDragEnd={() => {
                          setDragIndex(null);
                          setDropTarget(null);
                        }}
                        className="relative"
                      >
                        {showBarLeft && (
                          <div
                            aria-hidden="true"
                            className="pointer-events-none absolute -left-2 bottom-0 top-0 z-20 w-1 rounded-full bg-[#007BFF] shadow-[0_0_8px_rgba(0,123,255,0.65)]"
                          />
                        )}
                        {showBarRight && (
                          <div
                            aria-hidden="true"
                            className="pointer-events-none absolute -right-2 bottom-0 top-0 z-20 w-1 rounded-full bg-[#007BFF] shadow-[0_0_8px_rgba(0,123,255,0.65)]"
                          />
                        )}

                        <div
                          className={`flex cursor-grab flex-col overflow-hidden rounded-[4px] border border-[#DEE2E6] bg-white transition-opacity duration-150 active:cursor-grabbing ${
                            isDragged ? "opacity-40 ring-1 ring-[#ADB5BD]" : "opacity-100"
                          }`}
                        >
                          <div className="relative flex h-36 items-center justify-center overflow-hidden bg-[#F1F3F5] p-2">
                            {thumbCache[page.id] ? (
                              <img
                                src={thumbCache[page.id]}
                                alt={page.label}
                                draggable={false}
                                className={`pointer-events-none object-contain ${
                                  isQuarterRotated
                                    ? "max-h-[112px] max-w-[112px]"
                                    : "max-h-full max-w-full"
                                }`}
                                style={{ transform: `rotate(${page.rotation_deg}deg)` }}
                              />
                            ) : (
                              <Layers className="h-6 w-6 text-[#ADB5BD]" />
                            )}
                            <span className="absolute left-1.5 top-1.5 flex items-center gap-0.5 rounded-[4px] bg-[#343A40] px-1.5 py-0.5 font-mono-code text-[11px] text-white">
                              <GripVertical className="h-3 w-3 opacity-80" />#{idx + 1}
                            </span>
                            {hasEdits && (
                              <span className="absolute right-1.5 top-1.5 rounded-[4px] bg-[#17A2B8] px-1.5 py-0.5 text-[11px] font-semibold text-white">
                                {t.image2pdf.editedBadge}
                              </span>
                            )}
                          </div>
                          <div className="border-t border-[#DEE2E6] p-2">
                            <div
                              className="truncate text-sm font-semibold text-[#212529]"
                              title={page.label}
                            >
                              {page.label}
                            </div>
                            <div className="font-mono-code text-xs text-[#6C757D]">
                              {page.width_px}x{page.height_px}
                              {page.duration_ms ? ` · ${page.duration_ms}ms` : ""}
                            </div>
                            <div className="mt-2 flex items-center justify-between gap-1">
                              <button
                                type="button"
                                onClick={() => rotatePage(page.id)}
                                className="rounded-[4px] border border-[#DEE2E6] p-1 text-[#495057] hover:bg-[#F8F9FA]"
                                title={t.image2pdf.rotateTitle}
                              >
                                <RotateCw className="h-3.5 w-3.5" />
                              </button>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => setEditingPageId(page.id)}
                                  className="rounded-[4px] border border-[#007BFF] px-2 py-0.5 text-xs font-semibold text-[#007BFF] hover:bg-[#007BFF] hover:text-white"
                                  title={t.image2pdf.editBtnTitle}
                                >
                                  <Edit3 className="mr-0.5 inline h-3 w-3" />
                                  {t.image2pdf.editBtn}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removePage(page.id)}
                                  className="rounded-[4px] p-1 text-[#DC3545] hover:bg-[#F8D7DA]"
                                  title={t.image2pdf.deletePageTitle}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          <div>
            <BookmarkTreeEditor
              nodes={bookmarks}
              totalPages={pages.length}
              onChange={setBookmarks}
            />
          </div>
        </div>
      )}

      {editingPage && (
        <ImageCanvasEditorModal
          draft={editingPage}
          imageSrc={thumbCache[editingPage.id] || ""}
          onClose={() => setEditingPageId(null)}
          onSave={(updated) => {
            setPages((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
            setEditingPageId(null);
          }}
        />
      )}
    </div>
  );
};

function shiftBookmarks(nodes: BookmarkNode[], offset: number): BookmarkNode[] {
  return nodes.map((n) => ({
    ...n,
    target_page_index: n.target_page_index + offset,
    children: shiftBookmarks(n.children, offset),
  }));
}

function parseHexRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace(/^#/, "");
  if (clean.length !== 6) return { r: 248, g: 249, b: 250 };
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return { r: 248, g: 249, b: 250 };
  }
  return { r, g, b };
}
