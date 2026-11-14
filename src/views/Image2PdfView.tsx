import React from "react";
import { NumberInput } from "../components/NumberInput";
import { Select } from "../components/Select";
import { Slider } from "../components/Slider";
import {
  Edit3,
  FileOutput,
  GripVertical,
  Layers,
  PanelRightClose,
  PanelRightOpen,
  RotateCw,
  Trash2,
  X,
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
  const [hiResCache, setHiResCache] = React.useState<Record<string, string>>({});
  const [previewPageId, setPreviewPageId] = React.useState<string | null>(null);
  const [editingPageId, setEditingPageId] = React.useState<string | null>(null);
  const [showBookmarks, setShowBookmarks] = usePersistentState<boolean>(
    "knit.img2pdf.showBookmarks",
    true,
  );
  const [loadThumbs, setLoadThumbs] = usePersistentState<boolean>(
    "knit.img2pdf.loadThumbs",
    true,
  );

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
  const [dragGhostPos, setDragGhostPos] = React.useState<{ x: number; y: number } | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const lastHandledDropSeq = React.useRef<number>(0);

  const cardRefs = React.useRef<Map<string, HTMLDivElement>>(new Map());
  const dropTargetRef = React.useRef<{ index: number; side: "before" | "after" } | null>(null);
  const pagesRef = React.useRef<PageDraft[]>(pages);
  const suppressClickUntilRef = React.useRef<number>(0);

  React.useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  const registerCardRef = React.useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) {
      cardRefs.current.set(id, el);
    } else {
      cardRefs.current.delete(id);
    }
  }, []);

  const loadThumbnails = React.useCallback(async (newPages: PageDraft[]) => {
    if (!isTauriRuntime() || newPages.length === 0) return;

    // Decode compact 360px thumbnails in bounded concurrent batches so 120MB+ sets never bloat GPU RAM
    const BATCH = 4;
    for (let i = 0; i < newPages.length; i += BATCH) {
      const slice = newPages.slice(i, i + BATCH);
      const entries = await Promise.all(
        slice.map(async (p): Promise<[string, string] | null> => {
          try {
            const b64 = await renderImageThumbBase64(p.source.path, 360);
            return [p.id, `data:image/png;base64,${b64}`];
          } catch {
            if (p.source.kind === "image_file") {
              const lower = p.source.path.toLowerCase();
              if (!lower.endsWith(".avif") && !lower.endsWith(".tiff") && !lower.endsWith(".tif")) {
                return [p.id, convertFileSrc(p.source.path)];
              }
            }
            return null;
          }
        }),
      );
      const updates: Record<string, string> = {};
      for (const item of entries) {
        if (item) updates[item[0]] = item[1];
      }
      if (Object.keys(updates).length > 0) {
        setThumbCache((prev) => ({ ...prev, ...updates }));
      }
    }
  }, []);

  const resolveFullResSrc = React.useCallback(
    (page: PageDraft | null): string => {
      if (!page) return "";
      const lower = page.source.path.toLowerCase();
      // Animated images (GIF / WebP / APNG) must use native file URL so WebView plays animation
      if (
        page.source.kind === "animated_frame" ||
        lower.endsWith(".gif") ||
        lower.endsWith(".webp") ||
        lower.endsWith(".apng")
      ) {
        if (isTauriRuntime()) return convertFileSrc(page.source.path);
      }
      if (hiResCache[page.id]) return hiResCache[page.id];
      if (page.source.kind === "image_file") {
        if (!lower.endsWith(".avif") && !lower.endsWith(".tiff") && !lower.endsWith(".tif")) {
          if (isTauriRuntime()) return convertFileSrc(page.source.path);
        }
      }
      return thumbCache[page.id] || "";
    },
    [hiResCache, thumbCache],
  );

  // Lazy-decode higher-res (1600px) when opening modal for formats WebView can't load natively (AVIF/TIFF/Animated)
  React.useEffect(() => {
    const activeId = editingPageId || previewPageId;
    if (!activeId || !isTauriRuntime()) return;
    const page = pages.find((p) => p.id === activeId);
    if (!page || hiResCache[page.id]) return;
    const lower = page.source.path.toLowerCase();
    const needsRustDecode =
      page.source.kind === "animated_frame" ||
      lower.endsWith(".avif") ||
      lower.endsWith(".tiff") ||
      lower.endsWith(".tif");
    if (!needsRustDecode) return;

    let cancelled = false;
    void renderImageThumbBase64(page.source.path, 1600)
      .then((b64) => {
        if (!cancelled) {
          setHiResCache((prev) => ({ ...prev, [page.id]: `data:image/png;base64,${b64}` }));
        }
      })
      .catch(() => {
        // fallback to 360px thumb
      });
    return () => {
      cancelled = true;
    };
  }, [editingPageId, previewPageId, pages, hiResCache]);

  React.useEffect(() => {
    if (!previewPageId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewPageId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewPageId]);

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
        if (loadThumbs) {
          void loadThumbnails(scan.pages);
        }
      } catch (e) {
        setErrorMsg(String(e));
      }
    },
    [animatedPolicy, loadThumbnails, loadThumbs],
  );

  React.useEffect(() => {
    if (!loadThumbs || pages.length === 0) return;
    const missing = pages.filter((p) => !thumbCache[p.id]);
    if (missing.length > 0) {
      void loadThumbnails(missing);
    }
  }, [loadThumbs, pages, thumbCache, loadThumbnails]);

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

  const previewPage = pages.find((p) => p.id === previewPageId) ?? null;
  const editingPage = pages.find((p) => p.id === editingPageId) ?? null;

  const handleCardPointerDown = (e: React.PointerEvent<HTMLDivElement>, idx: number) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;

    const hitTestCards = (clientX: number, clientY: number) => {
      const currentPages = pagesRef.current;
      let bestIdx: number | null = null;
      let bestDist = Infinity;
      let bestSide: "before" | "after" = "before";

      for (let i = 0; i < currentPages.length; i++) {
        const el = cardRefs.current.get(currentPages[i].id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (
          clientX >= rect.left &&
          clientX <= rect.right &&
          clientY >= rect.top &&
          clientY <= rect.bottom
        ) {
          return {
            index: i,
            side: (clientX < rect.left + rect.width / 2 ? "before" : "after") as
              | "before"
              | "after",
          };
        }
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dist = Math.hypot(clientX - cx, clientY - cy);
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
          bestSide = clientX < cx ? "before" : "after";
        }
      }
      return bestIdx !== null ? { index: bestIdx, side: bestSide } : null;
    };

    const onMove = (ev: PointerEvent) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
        dragging = true;
        suppressClickUntilRef.current = performance.now() + 300;
        setDragIndex(idx);
      }
      setDragGhostPos({ x: ev.clientX, y: ev.clientY });
      const target = hitTestCards(ev.clientX, ev.clientY);
      if (
        target?.index !== dropTargetRef.current?.index ||
        target?.side !== dropTargetRef.current?.side
      ) {
        dropTargetRef.current = target;
        setDropTarget(target);
      }
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);

      if (dragging) {
        suppressClickUntilRef.current = performance.now() + 250;
        const target = dropTargetRef.current;
        if (target !== null) {
          const insertAt = target.side === "before" ? target.index : target.index + 1;
          if (insertAt !== idx && insertAt !== idx + 1) {
            const toIdx = insertAt > idx ? insertAt - 1 : insertAt;
            reorderPage(idx, toIdx);
          }
        }
        dropTargetRef.current = null;
        setDragIndex(null);
        setDropTarget(null);
        setDragGhostPos(null);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const handleCardDoubleClick = (e: React.MouseEvent<HTMLDivElement>, pageId: string) => {
    if ((e.target as HTMLElement).closest("button")) return;
    if (performance.now() < suppressClickUntilRef.current) return;
    setPreviewPageId(pageId);
  };

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
                setThumbCache({});
                setHiResCache({});
                setPreviewPageId(null);
                setEditingPageId(null);
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
        <div className={`grid grid-cols-1 gap-4 ${showBookmarks ? "lg:grid-cols-3" : ""}`}>
          <div className={`space-y-3 ${showBookmarks ? "lg:col-span-2" : ""}`}>
            {/* Grid Density, Pointer Drag Hint & Bookmark Toggle Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-[#DEE2E6] bg-white px-3.5 py-2">
              <div className="flex items-center gap-2 text-xs text-[#6C757D]">
                <GripVertical className="h-4 w-4 text-[#007BFF]" />
                <span>{t.image2pdf.dragHint}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-[#495057]">
                <label className="mr-1 flex cursor-pointer items-center gap-1.5 font-semibold text-[#343A40]">
                  <input
                    type="checkbox"
                    checked={loadThumbs}
                    onChange={(e) => setLoadThumbs(e.target.checked)}
                  />
                  {t.image2pdf.loadThumbsLabel}
                </label>
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
                <button
                  type="button"
                  onClick={() => setShowBookmarks((v) => !v)}
                  className="knit-control-sm ml-1 inline-flex items-center gap-1.5 rounded-[4px] border border-[#CED4DA] bg-[#F8F9FA] px-2.5 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
                >
                  {showBookmarks ? (
                    <PanelRightClose className="h-3.5 w-3.5 text-[#007BFF]" />
                  ) : (
                    <PanelRightOpen className="h-3.5 w-3.5 text-[#007BFF]" />
                  )}
                  {showBookmarks ? t.image2pdf.toggleBookmarksHide : t.image2pdf.toggleBookmarksShow}
                </button>
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

              return (
                <div
                  className="grid gap-3 select-none"
                  style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
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
                        ref={(el) => registerCardRef(page.id, el)}
                        onPointerDown={(e) => handleCardPointerDown(e, idx)}
                        onDoubleClick={(e) => handleCardDoubleClick(e, page.id)}
                        className="relative"
                      >
                        {showBarLeft && (
                          <div
                            aria-hidden="true"
                            className="pointer-events-none absolute -left-1.5 bottom-0 top-0 z-30 w-1.5 rounded-full bg-[#007BFF] shadow-[0_0_8px_rgba(0,123,255,0.75)]"
                          />
                        )}
                        {showBarRight && (
                          <div
                            aria-hidden="true"
                            className="pointer-events-none absolute -right-1.5 bottom-0 top-0 z-30 w-1.5 rounded-full bg-[#007BFF] shadow-[0_0_8px_rgba(0,123,255,0.75)]"
                          />
                        )}

                        <div
                          className={`flex flex-col overflow-hidden rounded-[4px] border border-[#DEE2E6] bg-white ${
                            dragIndex !== null ? "cursor-grabbing" : "cursor-grab"
                          } ${isDragged ? "opacity-40 ring-2 ring-[#007BFF]" : "opacity-100"}`}
                        >
                          {loadThumbs && (
                            <div className="relative flex h-36 items-center justify-center overflow-hidden bg-[#F1F3F5] p-2">
                              {thumbCache[page.id] ? (
                                <img
                                  src={thumbCache[page.id]}
                                  alt={page.label}
                                  loading="lazy"
                                  decoding="async"
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
                          )}
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
                                  disabled={!loadThumbs}
                                  onClick={() => setEditingPageId(page.id)}
                                  className="rounded-[4px] border border-[#007BFF] px-2 py-0.5 text-xs font-semibold text-[#007BFF] hover:bg-[#007BFF] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
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

          {showBookmarks && (
            <div>
              <BookmarkTreeEditor
                nodes={bookmarks}
                totalPages={pages.length}
                onChange={setBookmarks}
              />
            </div>
          )}
        </div>
      )}

      {dragIndex !== null && dragGhostPos && pages[dragIndex] && (
        <div
          style={{
            left: dragGhostPos.x + 14,
            top: dragGhostPos.y + 14,
          }}
          className="pointer-events-none fixed z-50 flex items-center gap-2 rounded-[4px] border border-[#007BFF] bg-white/95 px-2.5 py-1.5 text-xs font-semibold text-[#212529] shadow-lg"
        >
          <span className="rounded bg-[#007BFF] px-1.5 py-0.5 font-mono-code text-[11px] text-white">
            #{dragIndex + 1}
          </span>
          <span className="max-w-[180px] truncate">{pages[dragIndex].label}</span>
        </div>
      )}

      {/* Large Image Preview Modal (opened via Double-Click) */}
      {previewPage && (
        <div
          onClick={() => setPreviewPageId(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex h-[92vh] w-[94vw] max-w-[1400px] flex-col overflow-hidden rounded-[4px] border border-[#CED4DA] bg-white shadow-2xl"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-[#DEE2E6] bg-[#F8F9FA] px-4 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-[#212529]">
                  {previewPage.label}
                </div>
                <div className="font-mono-code text-xs text-[#6C757D]">
                  {previewPage.width_px}x{previewPage.height_px}
                  {previewPage.rotation_deg % 360 !== 0
                    ? ` · ${previewPage.rotation_deg}°`
                    : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!loadThumbs}
                  onClick={() => {
                    const id = previewPage.id;
                    setPreviewPageId(null);
                    setEditingPageId(id);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-[4px] bg-[#007BFF] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0069D9] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  {t.image2pdf.editBtn}
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewPageId(null)}
                  aria-label={t.common.close}
                  className="rounded-[4px] p-1.5 text-[#6C757D] hover:bg-[#E9ECEF] hover:text-[#212529]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex flex-1 items-center justify-center overflow-auto bg-[#212529] p-4">
              {resolveFullResSrc(previewPage) ? (
                <img
                  src={resolveFullResSrc(previewPage)}
                  alt={previewPage.label}
                  className="max-h-full max-w-full object-contain shadow-lg"
                  style={{ transform: `rotate(${previewPage.rotation_deg}deg)` }}
                />
              ) : (
                <Layers className="h-10 w-10 text-[#6C757D]" />
              )}
            </div>
          </div>
        </div>
      )}

      {editingPage && (
        <ImageCanvasEditorModal
          draft={editingPage}
          imageSrc={resolveFullResSrc(editingPage)}
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
