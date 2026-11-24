import React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Code2,
  Eye,
  FileOutput,
  FileText,
  FolderSync,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Trash2,
} from "lucide-react";
import { ConfirmModal } from "../components/ConfirmModal";
import { DocumentFindBar } from "../components/DocumentFindBar";
import { Dropzone } from "../components/Dropzone";
import { ErrorBanner } from "../components/ErrorBanner";
import {
  ExportConflictModal,
  type ConflictResolution,
} from "../components/ExportConflictModal";
import { ExportFilenameControl } from "../components/ExportFilenameControl";
import {
  ImportFeedbackToast,
  useImportFeedback,
} from "../components/ImportFeedbackToast";
import {
  MarkdownCodeEditor,
  type MarkdownCodeEditorHandle,
} from "../components/MarkdownCodeEditor";
import { PaneResizeHandle } from "../components/PaneResizeHandle";
import {
  PdfLazyFilePreview,
  type PdfLazyFilePreviewHandle,
} from "../components/PdfLazyFilePreview";
import { Select, type SelectOption } from "../components/Select";
import { ViewHeader } from "../components/ViewHeader";
import { useHorizontalRatioResize } from "../hooks/useHorizontalRatioResize";
import { useVerticalResize } from "../hooks/useVerticalResize";
import { useI18n } from "../i18n";
import {
  findActiveExportConflicts,
  joinDirAndFile,
  resolveUniqueNonActiveExportPath,
  useExportFilenameCheck,
} from "../lib/exportPath";
import {
  checkExportConflicts,
  convertPdfFileToMd,
  exportPdfToMd,
  formatBytes,
  getFileSizeBytes,
  getGeminiKeyStatus,
  getHomeDir,
  inspectAndExtractPdfToMd,
  inspectPdfFile,
  isJobCancelledError,
  isTauriRuntime,
  pickFiles,
  pickSaveFile,
  refinePdfMdWithGemini,
  releasePdfCachedFiles,
} from "../lib/ipc";
import { findAllTextMatches } from "../lib/markdownSearch";
import { splitDisplayPdfPath } from "../lib/pathDisplay";
import { usePersistentState } from "../lib/storage";
import type {
  GeminiKeyStatus,
  JobEvent,
  Pdf2MdLoadMode,
  PdfToMdInspectResult,
} from "../types/ipc";
import type { DroppedBatch } from "./Image2PdfView";

export interface Pdf2MdViewProps {
  onStartJob: (jobId: string, label: string, outputPaths?: string[]) => void;
  onJobEvent: (ev: JobEvent, jobId?: string) => void;
  onFinishJob: (
    title: string,
    outputs: string[],
    summary: string,
    status: "success" | "error" | "cancelled",
    heading?: string,
    jobId?: string,
  ) => void;
  busy: boolean;
  activeExportPaths?: string[];
  droppedBatch?: DroppedBatch | null;
  defaultExportDir?: string;
  isActive?: boolean;
  onOpenSettings?: () => void;
}

function fileBasename(p: string): string {
  return p.split(/[/\\]/).pop() ?? p;
}

function fileStem(p: string): string {
  const name = fileBasename(p);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

const LARGE_PDF_WARNING_BYTES = 300 * 1024 * 1024;

function countWordsFast(text: string): number {
  let count = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const isWs =
      code === 32 ||
      code === 10 ||
      code === 13 ||
      code === 9 ||
      code === 12 ||
      code === 11 ||
      code === 160;
    if (isWs) {
      inWord = false;
    } else if (!inWord) {
      inWord = true;
      count += 1;
    }
  }
  return count;
}

function buildPackagedExportPath(targetMdPath: string): string {
  const slashIdx = Math.max(targetMdPath.lastIndexOf("/"), targetMdPath.lastIndexOf("\\"));
  const dir = slashIdx >= 0 ? targetMdPath.slice(0, slashIdx) : "";
  const file = slashIdx >= 0 ? targetMdPath.slice(slashIdx + 1) : targetMdPath;
  const dotIdx = file.lastIndexOf(".");
  const stem = (dotIdx > 0 ? file.slice(0, dotIdx) : file).trim() || "document";
  const dirBase = dir.split(/[/\\]/).pop() ?? "";
  if (dir && dirBase.toLowerCase() === stem.toLowerCase()) {
    return targetMdPath;
  }
  return dir ? joinDirAndFile(joinDirAndFile(dir, stem), file) : joinDirAndFile(stem, file);
}

function formatScannedPagesList(indices: number[]): string {
  const oneBased = indices.map((idx) => idx + 1);
  if (oneBased.length <= 12) {
    return oneBased.map((n) => `p.${n}`).join(", ");
  }
  const head = oneBased
    .slice(0, 10)
    .map((n) => `p.${n}`)
    .join(", ");
  return `${head}, … (+${oneBased.length - 10})`;
}

export const Pdf2MdView: React.FC<Pdf2MdViewProps> = ({
  onStartJob,
  onJobEvent,
  onFinishJob,
  busy,
  activeExportPaths = [],
  droppedBatch,
  defaultExportDir = "",
  isActive = true,
  onOpenSettings,
}) => {
  const { t } = useI18n();
  const { toast: importToast, notifyImported } = useImportFeedback();

  const [loadMode, setLoadMode] = usePersistentState<Pdf2MdLoadMode>(
    "knit.pdf2md.loadMode",
    "full",
  );
  const [extractImages, setExtractImages] = usePersistentState<boolean>(
    "knit.pdf2md.extractImages",
    true,
  );
  const [includePageMarkers, setIncludePageMarkers] = usePersistentState<boolean>(
    "knit.pdf2md.pageMarkers",
    true,
  );
  const [syncScroll, setSyncScroll] = usePersistentState<boolean>(
    "knit.pdf2md.syncScroll",
    false,
  );
  const [splitRatio, setSplitRatio] = usePersistentState<number>(
    "knit.pdf2md.splitRatio",
    0.45,
  );
  const [workbenchHeight, setWorkbenchHeight] = usePersistentState<number>(
    "knit.pdf2md.workbenchHeight",
    640,
  );

  const [sourcePath, setSourcePath] = React.useState<string | null>(null);
  const [inspectResult, setInspectResult] = React.useState<PdfToMdInspectResult | null>(null);
  const [markdown, setMarkdown] = React.useState<string>("");
  const [aiPreviousMarkdown, setAiPreviousMarkdown] = React.useState<string | null>(null);
  const [aiInstruction, setAiInstruction] = React.useState<string>("");
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiNotice, setAiNotice] = React.useState<string | null>(null);
  const [keyStatus, setKeyStatus] = React.useState<GeminiKeyStatus | null>(null);

  const [sourceFileSizeBytes, setSourceFileSizeBytes] = React.useState<number | null>(null);
  const [previewTotalPages, setPreviewTotalPages] = React.useState(0);
  const [homeDir, setHomeDir] = React.useState<string | null>(null);

  const [extracting, setExtracting] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [copiedMd, setCopiedMd] = React.useState(false);
  const [exportFilenameRaw, setExportFilenameRaw] = React.useState("document.md");
  const [pendingOptionToggle, setPendingOptionToggle] = React.useState<{
    extract_images: boolean;
    include_page_markers: boolean;
  } | null>(null);
  const [pendingConflict, setPendingConflict] = React.useState<{
    targetPath: string;
    conflicts: string[];
    lockedByActiveJob: boolean;
  } | null>(null);

  const [editorFindOpen, setEditorFindOpen] = React.useState(false);
  const [editorFindQuery, setEditorFindQuery] = React.useState("");
  const [editorFindIdx, setEditorFindIdx] = React.useState(0);

  const [previewFindOpen, setPreviewFindOpen] = React.useState(false);
  const [previewFindQuery, setPreviewFindQuery] = React.useState("");
  const [previewFindIdx, setPreviewFindIdx] = React.useState(0);

  const splitContainerRef = React.useRef<HTMLDivElement | null>(null);
  const editorRef = React.useRef<MarkdownCodeEditorHandle | null>(null);
  const previewRef = React.useRef<PdfLazyFilePreviewHandle | null>(null);
  const editorFindInputRef = React.useRef<HTMLInputElement | null>(null);
  const previewFindInputRef = React.useRef<HTMLInputElement | null>(null);
  const scrollSyncSourceRef = React.useRef<"editor" | "preview" | null>(null);
  const scrollSyncTimerRef = React.useRef<number | null>(null);
  const lastDropSeqRef = React.useRef<number>(0);
  const prevSourcePathRef = React.useRef<string | null>(null);
  const lastExtractedMarkdownRef = React.useRef<string>("");

  const {
    ratio: liveRatio,
    isResizing: isResizingWidth,
    handlePointerDown: handleStartWidthResize,
  } = useHorizontalRatioResize({
    value: splitRatio,
    min: 0.25,
    max: 0.72,
    containerRef: splitContainerRef,
    cssVar: "--pdf2md-split-left",
    onCommit: setSplitRatio,
  });

  const {
    height: liveHeightPx,
    isResizing: isResizingHeight,
    handlePointerDown: handleStartHeightResize,
  } = useVerticalResize({
    value: workbenchHeight,
    min: 380,
    max: 4000,
    onCommit: setWorkbenchHeight,
  });

  React.useEffect(() => {
    void getHomeDir().then(setHomeDir);
  }, []);

  const refreshKeyStatus = React.useCallback(async () => {
    try {
      const status = await getGeminiKeyStatus();
      setKeyStatus(status);
    } catch {
      // Giữ nguyên null hoặc trạng thái cũ nếu chưa lấy được key status
    }
  }, []);

  React.useEffect(() => {
    if (isActive) {
      void refreshKeyStatus();
    }
  }, [isActive, refreshKeyStatus]);

  const editorMatches = React.useMemo(
    () => (editorFindOpen ? findAllTextMatches(markdown, editorFindQuery) : []),
    [editorFindOpen, markdown, editorFindQuery],
  );

  const activeEditorMatchIdx =
    editorMatches.length > 0
      ? ((editorFindIdx % editorMatches.length) + editorMatches.length) % editorMatches.length
      : null;

  React.useEffect(() => {
    editorRef.current?.setSearchHighlights(editorMatches, activeEditorMatchIdx);
  }, [editorMatches, activeEditorMatchIdx]);

  const previewMatches = React.useMemo(() => {
    const q = previewFindQuery.trim().toLowerCase();
    if (!previewFindOpen || !q || !inspectResult) return [];
    const pagesMatched: number[] = [];
    for (const p of inspectResult.pages) {
      if (p.markdown.toLowerCase().includes(q)) {
        pagesMatched.push(p.page_index + 1);
      }
    }
    return pagesMatched;
  }, [previewFindOpen, previewFindQuery, inspectResult]);

  const activePreviewMatchIdx =
    previewMatches.length > 0
      ? ((previewFindIdx % previewMatches.length) + previewMatches.length) % previewMatches.length
      : null;

  React.useEffect(() => {
    if (activePreviewMatchIdx !== null && previewMatches[activePreviewMatchIdx] !== undefined) {
      previewRef.current?.scrollToPage(previewMatches[activePreviewMatchIdx]);
    }
  }, [activePreviewMatchIdx, previewMatches]);

  const openEditorFind = React.useCallback(() => {
    setEditorFindOpen(true);
    window.setTimeout(() => editorFindInputRef.current?.focus(), 0);
  }, []);

  const openPreviewFind = React.useCallback(() => {
    setPreviewFindOpen(true);
    window.setTimeout(() => previewFindInputRef.current?.focus(), 0);
  }, []);

  const syncScrollLock = React.useCallback((src: "editor" | "preview") => {
    scrollSyncSourceRef.current = src;
    if (scrollSyncTimerRef.current !== null) {
      window.clearTimeout(scrollSyncTimerRef.current);
    }
    scrollSyncTimerRef.current = window.setTimeout(() => {
      scrollSyncSourceRef.current = null;
      scrollSyncTimerRef.current = null;
    }, 120);
  }, []);

  const handleEditorScrollRatio = React.useCallback(
    (r: number) => {
      if (!syncScroll || scrollSyncSourceRef.current === "preview") return;
      syncScrollLock("editor");
      previewRef.current?.setScrollRatio(r);
    },
    [syncScroll, syncScrollLock],
  );

  const handlePreviewScrollRatio = React.useCallback(
    (r: number) => {
      if (!syncScroll || scrollSyncSourceRef.current === "editor") return;
      syncScrollLock("preview");
      editorRef.current?.setScrollRatio(r);
    },
    [syncScroll, syncScrollLock],
  );

  const loadPdfWithMode = React.useCallback(
    async (
      targetPath: string,
      modeOverride?: Pdf2MdLoadMode,
      opts?: { extract_images: boolean; include_page_markers: boolean },
      updateFilename = true,
      forceReextract = false,
    ) => {
      const effectiveMode = modeOverride ?? loadMode;
      const effectiveOpts = opts ?? {
        extract_images: extractImages,
        include_page_markers: includePageMarkers,
      };
      const prevPath = prevSourcePathRef.current;
      if (prevPath && prevPath !== targetPath) {
        void releasePdfCachedFiles([prevPath]);
      }
      prevSourcePathRef.current = targetPath;

      setErrorMsg(null);
      setAiNotice(null);
      setAiPreviousMarkdown(null);
      setSourcePath(targetPath);
      if (updateFilename) {
        setExportFilenameRaw(`${fileStem(targetPath)}.md`);
      }

      if (effectiveMode === "direct_export") {
        setInspectResult(null);
        setMarkdown("");
        lastExtractedMarkdownRef.current = "";
        setPreviewTotalPages(0);
        setSourceFileSizeBytes(null);
        if (isTauriRuntime()) {
          try {
            const info = await inspectPdfFile(targetPath);
            setPreviewTotalPages(info.page_count);
            setSourceFileSizeBytes(info.file_size_bytes);
          } catch {
            try {
              const sz = await getFileSizeBytes(targetPath);
              setSourceFileSizeBytes(sz);
            } catch {
              // ignore metadata fallback error
            }
          }
        }
        return;
      }

      const jobId = `pdf2md-extract-${Date.now()}`;
      setExtracting(true);
      onStartJob(jobId, `${t.shell.nav.pdf2md.label}: ${fileBasename(targetPath)}`);

      try {
        const res = await inspectAndExtractPdfToMd(
          jobId,
          targetPath,
          effectiveOpts,
          (ev) => onJobEvent(ev, jobId),
          forceReextract,
        );
        lastExtractedMarkdownRef.current = res.markdown;
        setInspectResult(res);
        setMarkdown(res.markdown);
        setPreviewTotalPages(res.page_count);
        setSourceFileSizeBytes(res.file_size_bytes);
        onFinishJob(
          t.shell.nav.pdf2md.label,
          [],
          `${fileBasename(targetPath)} · ${res.page_count} p.`,
          "success",
          t.pdf2md.title,
          jobId,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isJobCancelledError(msg)) {
          onFinishJob(
            t.shell.nav.pdf2md.label,
            [],
            t.common.jobCancelledMsg,
            "cancelled",
            t.pdf2md.title,
            jobId,
          );
        } else {
          setErrorMsg(msg);
          onFinishJob(
            t.shell.nav.pdf2md.label,
            [],
            msg,
            "error",
            t.pdf2md.title,
            jobId,
          );
        }
      } finally {
        setExtracting(false);
      }
    },
    [extractImages, includePageMarkers, loadMode, onFinishJob, onJobEvent, onStartJob, t],
  );

  React.useEffect(() => {
    if (!droppedBatch || droppedBatch.seq <= lastDropSeqRef.current) return;
    lastDropSeqRef.current = droppedBatch.seq;
    const pdf = droppedBatch.paths.find((p) => /\.pdf$/i.test(p));
    if (!pdf) return;
    notifyImported(fileBasename(pdf));
    void loadPdfWithMode(pdf, undefined, undefined, true);
  }, [droppedBatch, loadPdfWithMode, notifyImported]);

  const handlePickPdf = async () => {
    try {
      const picked = await pickFiles({
        title: t.pdf2md.pickPdfDialog,
        multiple: false,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      const path = picked[0];
      if (!path) return;
      await loadPdfWithMode(path, undefined, undefined, true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const handleClear = () => {
    const prev = sourcePath;
    prevSourcePathRef.current = null;
    lastExtractedMarkdownRef.current = "";
    if (prev) {
      void releasePdfCachedFiles([prev]);
    }
    setSourcePath(null);
    setInspectResult(null);
    setMarkdown("");
    setAiPreviousMarkdown(null);
    setAiNotice(null);
    setErrorMsg(null);
    setPreviewTotalPages(0);
    setSourceFileSizeBytes(null);
    setPendingOptionToggle(null);
  };

  const applyExtractionOptions = React.useCallback(
    (nextOpts: { extract_images: boolean; include_page_markers: boolean }) => {
      setExtractImages(nextOpts.extract_images);
      setIncludePageMarkers(nextOpts.include_page_markers);
      if (sourcePath && loadMode !== "direct_export") {
        void loadPdfWithMode(sourcePath, loadMode, nextOpts, false, false);
      }
    },
    [loadMode, loadPdfWithMode, setExtractImages, setIncludePageMarkers, sourcePath],
  );

  const handleToggleExtractionOption = (nextOpts: {
    extract_images: boolean;
    include_page_markers: boolean;
  }) => {
    if (!sourcePath || loadMode === "direct_export" || !inspectResult) {
      applyExtractionOptions(nextOpts);
      return;
    }
    if (markdown !== lastExtractedMarkdownRef.current) {
      setPendingOptionToggle(nextOpts);
      return;
    }
    applyExtractionOptions(nextOpts);
  };

  const handleChangeLoadMode = (nextMode: Pdf2MdLoadMode) => {
    setLoadMode(nextMode);
    if (!sourcePath) return;

    if (nextMode === "direct_export") {
      void releasePdfCachedFiles([sourcePath]);
      setInspectResult(null);
      setMarkdown("");
      setAiPreviousMarkdown(null);
      setAiNotice(null);
      return;
    }

    if (nextMode === "md_only") {
      void releasePdfCachedFiles([sourcePath]);
    }

    if (!inspectResult) {
      void loadPdfWithMode(sourcePath, nextMode, undefined, false);
    }
  };

  const runGeminiRefine = async (mode: "selection" | "all") => {
    if (aiBusy || busy || !markdown.trim()) return;

    let selected: { from: number; to: number; text: string } | null = null;
    if (mode === "selection") {
      selected = editorRef.current?.getSelectedText() ?? null;
      if (!selected || !selected.text.trim()) {
        setErrorMsg(t.pdf2md.aiNoSelectionError);
        return;
      }
    }

    const inputText = mode === "selection" && selected ? selected.text : markdown;
    const prevSnapshot = markdown;
    const jobId = `pdf2md-gemini-${Date.now()}`;
    setAiBusy(true);
    setErrorMsg(null);
    setAiNotice(t.pdf2md.aiRefiningNotice);
    onStartJob(jobId, t.pdf2md.aiCardTitle);

    try {
      const res = await refinePdfMdWithGemini(
        jobId,
        inputText,
        aiInstruction.trim() || null,
        (ev) => onJobEvent(ev, jobId),
      );

      setAiPreviousMarkdown(prevSnapshot);
      if (mode === "selection" && selected && editorRef.current) {
        editorRef.current.replaceRange(selected.from, selected.to, res.markdown);
      } else if (mode === "selection" && selected) {
        const nextDoc =
          prevSnapshot.slice(0, selected.from) + res.markdown + prevSnapshot.slice(selected.to);
        setMarkdown(nextDoc);
      } else {
        setMarkdown(res.markdown);
      }

      const summaryParts = [t.pdf2md.aiDoneSummary(res.refined_chunks, res.total_chunks)];
      if (res.fallback_chunks > 0) {
        summaryParts.push(t.pdf2md.aiPartialFallback(res.fallback_chunks, res.total_chunks));
      }
      if (res.warnings.length > 0) {
        summaryParts.push(res.warnings[0]);
      }
      const notice = summaryParts.join(" ");
      setAiNotice(notice);
      onFinishJob(t.pdf2md.aiCardTitle, [], notice, "success", t.pdf2md.title, jobId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isJobCancelledError(msg)) {
        setAiNotice(null);
        onFinishJob(
          t.pdf2md.aiCardTitle,
          [],
          t.common.jobCancelledMsg,
          "cancelled",
          t.pdf2md.title,
          jobId,
        );
      } else {
        setAiNotice(null);
        setErrorMsg(msg);
        onFinishJob(t.pdf2md.aiCardTitle, [], msg, "error", t.pdf2md.title, jobId);
      }
    } finally {
      setAiBusy(false);
    }
  };

  const handleUndoAi = () => {
    if (aiPreviousMarkdown === null) return;
    setMarkdown(aiPreviousMarkdown);
    setAiPreviousMarkdown(null);
    setAiNotice(null);
  };

  const fallbackStem = sourcePath ? fileStem(sourcePath) : "document";
  const { effectiveFilename, defaultTargetPath, existsAtDefaultDir } =
    useExportFilenameCheck(
      defaultExportDir,
      exportFilenameRaw,
      `${fallbackStem}.md`,
      ["md", "markdown"],
    );

  const performExport = async (outputPath: string) => {
    if (!sourcePath) return;
    const jobId = `pdf2md-export-${Date.now()}`;
    setErrorMsg(null);
    onStartJob(jobId, `${t.shell.nav.pdf2md.label}: ${fileBasename(outputPath)}`, [outputPath]);

    try {
      const res =
        loadMode === "direct_export" || !inspectResult
          ? await convertPdfFileToMd(
              jobId,
              sourcePath,
              outputPath,
              {
                extract_images: extractImages,
                include_page_markers: includePageMarkers,
              },
              (ev) => onJobEvent(ev, jobId),
            )
          : await exportPdfToMd(
              jobId,
              sourcePath,
              outputPath,
              markdown,
              extractImages,
              (ev) => onJobEvent(ev, jobId),
              inspectResult.pages
                .filter((p) => p.image_count > 0)
                .map((p) => p.page_index),
            );
      const outputs = res.asset_dir ? [res.output_path, res.asset_dir] : [res.output_path];
      const summary = t.pdf2md.doneSummary(
        res.page_count,
        res.written_image_count,
        formatBytes(res.bytes_written),
      );
      onFinishJob(t.shell.nav.pdf2md.label, outputs, summary, "success", t.pdf2md.title, jobId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isJobCancelledError(msg)) {
        onFinishJob(
          t.shell.nav.pdf2md.label,
          [],
          t.common.jobCancelledMsg,
          "cancelled",
          t.pdf2md.title,
          jobId,
        );
      } else {
        setErrorMsg(msg);
        onFinishJob(t.shell.nav.pdf2md.label, [], msg, "error", t.pdf2md.title, jobId);
      }
    }
  };

  const handleExportClick = async () => {
    if (!sourcePath || busy || extracting || aiBusy) return;
    let targetPath: string | null = defaultTargetPath;
    if (!targetPath) {
      targetPath = await pickSaveFile({
        title: t.pdf2md.saveMdDialog,
        defaultPath: effectiveFilename,
        filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
      });
    }
    if (!targetPath) return;

    const willPackageInFolder =
      extractImages &&
      (loadMode === "direct_export" || (inspectResult?.extracted_image_count ?? 0) > 0);
    const conflictCandidates = willPackageInFolder
      ? Array.from(new Set([targetPath, buildPackagedExportPath(targetPath)]))
      : [targetPath];

    const lockedConflicts = findActiveExportConflicts(conflictCandidates, activeExportPaths);
    if (lockedConflicts.length > 0) {
      setPendingConflict({
        targetPath,
        conflicts: lockedConflicts,
        lockedByActiveJob: true,
      });
      return;
    }

    if (defaultTargetPath) {
      const existing = await checkExportConflicts(conflictCandidates);
      if (existing.length > 0) {
        setPendingConflict({
          targetPath,
          conflicts: existing,
          lockedByActiveJob: false,
        });
        return;
      }
    }

    await performExport(targetPath);
  };

  const handleConflictResolution = async (choice: ConflictResolution) => {
    const pending = pendingConflict;
    setPendingConflict(null);
    if (!pending || choice === "cancel") return;
    const finalPath =
      choice === "auto_rename"
        ? await resolveUniqueNonActiveExportPath(pending.targetPath, activeExportPaths)
        : pending.targetPath;
    await performExport(finalPath);
  };

  const handleCopyMarkdown = async () => {
    if (!markdown) return;
    try {
      await navigator.clipboard.writeText(markdown);
      setCopiedMd(true);
      window.setTimeout(() => setCopiedMd(false), 1600);
    } catch {
      // Bỏ qua nếu môi trường test không cấp clipboard API
    }
  };

  const wordCount = React.useMemo(() => countWordsFast(markdown), [markdown]);

  const displaySourcePath = React.useMemo(
    () => (sourcePath ? splitDisplayPdfPath(sourcePath, homeDir) : null),
    [sourcePath, homeDir],
  );

  const loadModeOptions = React.useMemo<SelectOption<Pdf2MdLoadMode>[]>(
    () => [
      { value: "full", label: t.pdf2md.loadModes.full },
      { value: "md_only", label: t.pdf2md.loadModes.md_only },
      { value: "direct_export", label: t.pdf2md.loadModes.direct_export },
    ],
    [t.pdf2md.loadModes],
  );

  const modeSelectControl = (
    <div className="flex items-center gap-2 text-xs font-semibold text-[#343A40]">
      <span>{t.pdf2md.loadModeLabel}</span>
      <Select
        dataTestId="pdf2md-load-mode-select"
        ariaLabel={t.pdf2md.loadModeLabel}
        size="sm"
        value={loadMode}
        disabled={busy || extracting || aiBusy}
        options={loadModeOptions}
        onChange={handleChangeLoadMode}
        className="min-w-[260px]"
      />
    </div>
  );

  const renderMarkdownEditorPane = () => (
    <div className="knit-card flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#DEE2E6] bg-[#F8F9FA] px-3.5 py-2">
        <div className="flex items-center gap-2 text-sm font-bold text-[#343A40]">
          <Code2 className="h-4 w-4 text-[#007BFF]" />
          <span>{t.pdf2md.editorTitle}</span>
          <span className="rounded-[4px] bg-[#E9ECEF] px-2 py-0.5 font-mono-code text-xs font-semibold text-[#495057]">
            {t.pdf2md.wordCountBadge(wordCount)}
          </span>
          {inspectResult && inspectResult.extracted_image_count > 0 && (
            <span className="rounded-[4px] bg-[#E7F1FF] px-2 py-0.5 font-mono-code text-xs font-semibold text-[#0056B3]">
              {t.pdf2md.imagesCountBadge(inspectResult.extracted_image_count)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleCopyMarkdown()}
            disabled={!markdown.trim()}
            className="knit-control-sm inline-flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF] disabled:opacity-50"
          >
            <Clipboard className="h-3.5 w-3.5 text-[#007BFF]" />
            {copiedMd ? t.pdf2md.copiedMdStatus : t.pdf2md.copyMdBtn}
          </button>
          <button
            type="button"
            onClick={openEditorFind}
            title="Ctrl+F"
            className="knit-control-sm inline-flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-white px-2 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
          >
            <Search className="h-3.5 w-3.5 text-[#007BFF]" />
          </button>
        </div>
      </div>

      <DocumentFindBar
        open={editorFindOpen}
        query={editorFindQuery}
        activeMatchIndex={activeEditorMatchIdx}
        matchCount={editorMatches.length}
        placeholder={t.pdf2md.findEditorPlaceholder}
        prevTitle={t.pdf2md.findPrevTitle}
        nextTitle={t.pdf2md.findNextTitle}
        closeAriaLabel={t.common.close}
        inputRef={editorFindInputRef}
        onQueryChange={(val) => {
          setEditorFindQuery(val);
          setEditorFindIdx(0);
        }}
        onPrev={() => setEditorFindIdx((i) => i - 1)}
        onNext={() => setEditorFindIdx((i) => i + 1)}
        onClose={() => {
          setEditorFindOpen(false);
          setEditorFindQuery("");
        }}
      />

      <div className="flex min-h-0 flex-1 flex-col overscroll-contain">
        <MarkdownCodeEditor
          ref={editorRef}
          value={markdown}
          language="markdown"
          onChange={setMarkdown}
          onSave={() => void handleExportClick()}
          onOpenFind={openEditorFind}
          onScrollRatioChange={handleEditorScrollRatio}
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <ViewHeader
        title={t.pdf2md.title}
        subtitle={t.pdf2md.subtitle}
        actions={
          sourcePath ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handlePickPdf()}
                disabled={busy || extracting || aiBusy}
                className="knit-control knit-btn-secondary inline-flex items-center gap-1.5 px-3 text-sm disabled:opacity-50"
              >
                <FileText className="h-4 w-4 text-[#007BFF]" />
                {t.pdf2md.changePdfBtn}
              </button>
              <button
                type="button"
                onClick={handleClear}
                disabled={busy || extracting || aiBusy}
                className="knit-control knit-btn-secondary inline-flex items-center gap-1.5 px-3 text-sm disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4 text-[#DC3545]" />
                {t.pdf2md.clearBtn}
              </button>
              <button
                type="button"
                data-testid="pdf2md-export-btn"
                disabled={
                  !sourcePath ||
                  busy ||
                  extracting ||
                  aiBusy ||
                  (loadMode !== "direct_export" && !markdown.trim())
                }
                onClick={() => void handleExportClick()}
                className="knit-control knit-btn-primary inline-flex items-center gap-1.5 px-4 text-sm disabled:opacity-50"
              >
                <FileOutput className="h-4 w-4" />
                {t.pdf2md.exportBtn}
              </button>
            </div>
          ) : undefined
        }
      />

      <ErrorBanner message={errorMsg} />

      {!sourcePath ? (
        <div className="space-y-3">
          <Dropzone
            title={t.pdf2md.dropTitle}
            description={t.pdf2md.dropDesc}
            filesLabel={t.pdf2md.pickPdfBtn}
            loading={extracting}
            onPickFiles={() => void handlePickPdf()}
          />
          <div className="knit-card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            {modeSelectControl}
            <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-[#343A40]">
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={extractImages}
                  onChange={(e) => setExtractImages(e.target.checked)}
                />
                {t.pdf2md.extractImagesLabel}
              </label>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={includePageMarkers}
                  onChange={(e) => setIncludePageMarkers(e.target.checked)}
                />
                {t.pdf2md.pageMarkersLabel}
              </label>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Thanh thông tin tệp + chế độ nạp + tên file xuất */}
          <div className="knit-card space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-bold text-[#212529]">
                <FileText className="h-4 w-4 shrink-0 text-[#007BFF]" />
                {displaySourcePath && (
                  <span
                    data-testid="pdf2md-source-path"
                    className="flex min-w-0 items-center font-mono-code text-xs"
                    title={sourcePath}
                  >
                    {displaySourcePath.dirPart && (
                      <span className="min-w-0 truncate font-normal text-[#495057]">
                        {displaySourcePath.dirPart}
                      </span>
                    )}
                    <span className="shrink-0 text-[#212529]">{displaySourcePath.fileName}</span>
                  </span>
                )}
                {(previewTotalPages > 0 || sourceFileSizeBytes !== null) && (
                  <span className="shrink-0 rounded-[4px] bg-[#E9ECEF] px-2 py-0.5 font-mono-code text-xs font-semibold text-[#495057]">
                    {previewTotalPages > 0 ? `${previewTotalPages} p.` : ""}
                    {previewTotalPages > 0 && sourceFileSizeBytes !== null ? " · " : ""}
                    {sourceFileSizeBytes !== null ? formatBytes(sourceFileSizeBytes) : ""}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-[#343A40]">
                {modeSelectControl}

                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={extractImages}
                    disabled={extracting || aiBusy}
                    onChange={(e) =>
                      handleToggleExtractionOption({
                        extract_images: e.target.checked,
                        include_page_markers: includePageMarkers,
                      })
                    }
                  />
                  {t.pdf2md.extractImagesLabel}
                </label>

                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={includePageMarkers}
                    disabled={extracting || aiBusy}
                    onChange={(e) =>
                      handleToggleExtractionOption({
                        extract_images: extractImages,
                        include_page_markers: e.target.checked,
                      })
                    }
                  />
                  {t.pdf2md.pageMarkersLabel}
                </label>

                {loadMode !== "direct_export" && (
                  <button
                    type="button"
                    disabled={extracting || aiBusy}
                    onClick={() =>
                      void loadPdfWithMode(
                        sourcePath,
                        loadMode,
                        { extract_images: extractImages, include_page_markers: includePageMarkers },
                        false,
                        true,
                      )
                    }
                    className="knit-control-sm inline-flex items-center gap-1.5 rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-xs font-semibold text-[#343A40] hover:bg-[#F8F9FA] disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${extracting ? "animate-spin" : ""}`} />
                    {t.pdf2md.reextractBtn}
                  </button>
                )}
              </div>
            </div>

            <ExportFilenameControl
              value={exportFilenameRaw}
              onChange={setExportFilenameRaw}
              defaultExportDir={defaultExportDir}
              existsAtDefaultDir={existsAtDefaultDir}
            />
          </div>

          {loadMode === "direct_export" ? (
            <div
              data-testid="pdf2md-direct-export-banner"
              className="knit-card flex flex-wrap items-center justify-between gap-3 border-[#B8DAFF] bg-[#F8FAFF] p-5"
            >
              <div className="space-y-1">
                <div className="text-sm font-bold text-[#0056B3]">
                  {t.pdf2md.directExportBannerTitle}
                </div>
                <p className="text-xs text-[#495057]">{t.pdf2md.directExportBannerDesc}</p>
              </div>
              <button
                type="button"
                disabled={busy || extracting}
                onClick={() => void handleExportClick()}
                className="knit-control knit-btn-primary inline-flex items-center gap-1.5 px-4 text-sm disabled:opacity-50"
              >
                <FileOutput className="h-4 w-4" />
                {t.pdf2md.exportBtn}
              </button>
            </div>
          ) : (
            <>
              {/* Cảnh báo gợi ý khi mở file PDF lớn (>= 300MB) ở chế độ Đầy đủ */}
              {loadMode === "full" &&
                sourceFileSizeBytes !== null &&
                sourceFileSizeBytes >= LARGE_PDF_WARNING_BYTES && (
                  <div
                    data-testid="pdf2md-large-file-banner"
                    className="flex flex-wrap items-center justify-between gap-2.5 rounded-[4px] border border-[#B8DAFF] bg-[#F8FAFF] px-3.5 py-2.5 text-xs text-[#0056B3]"
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#007BFF]" />
                      <div>
                        <span className="font-bold">{t.pdf2md.largePdfWarningTitle}: </span>
                        <span>{t.pdf2md.largePdfWarningDesc(formatBytes(sourceFileSizeBytes))}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleChangeLoadMode("md_only")}
                        className="knit-control-sm rounded-[4px] border border-[#B8DAFF] bg-white px-2.5 text-xs font-semibold text-[#0056B3] hover:bg-[#E7F1FF]"
                      >
                        {t.pdf2md.switchToMdOnlyBtn}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleChangeLoadMode("direct_export")}
                        className="knit-control-sm rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
                      >
                        {t.pdf2md.switchToDirectExportBtn}
                      </button>
                    </div>
                  </div>
                )}

              {/* Cảnh báo trang scan / không có lớp chữ */}
              {inspectResult && inspectResult.scanned_page_indices.length > 0 && (
                <div
                  data-testid="pdf2md-scanned-warning"
                  className="flex items-start gap-2.5 rounded-[4px] border border-[#FFEEBA] bg-[#FFF3CD] px-3.5 py-2.5 text-sm text-[#856404]"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {t.pdf2md.scannedWarningBanner(
                      inspectResult.scanned_page_indices.length,
                      formatScannedPagesList(inspectResult.scanned_page_indices),
                    )}
                  </span>
                </div>
              )}

              {/* Thẻ Trợ lý AI tinh chỉnh tùy chọn (Gemini — On Demand) */}
              <div className="knit-card space-y-2.5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-[#007BFF]" />
                    <span className="text-sm font-bold text-[#212529]">
                      {t.pdf2md.aiCardTitle}
                    </span>
                  </div>
                  {keyStatus?.configured ? (
                    <span className="inline-flex items-center gap-1 rounded-[4px] border border-[#C3E6CB] bg-[#D4EDDA] px-2.5 py-0.5 text-xs font-semibold text-[#155724]">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      {t.pdf2md.aiReadyStatus(keyStatus.masked_key ?? "••••", keyStatus.model)}
                    </span>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-[#6C757D]">
                        {t.pdf2md.aiNotConfiguredHint}
                      </span>
                      {onOpenSettings && (
                        <button
                          type="button"
                          onClick={onOpenSettings}
                          className="knit-control-sm inline-flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-xs font-semibold text-[#343A40] hover:bg-[#F8F9FA]"
                        >
                          <SettingsIcon className="h-3.5 w-3.5 text-[#007BFF]" />
                          {t.pdf2md.aiOpenSettingsBtn}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs font-semibold text-[#495057]">
                    {t.pdf2md.aiPromptLabel}
                  </label>
                  <input
                    type="text"
                    value={aiInstruction}
                    disabled={aiBusy}
                    onChange={(e) => setAiInstruction(e.target.value)}
                    placeholder={t.pdf2md.aiPromptPlaceholder}
                    className="knit-control-sm min-w-[240px] flex-1 rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-xs text-[#212529] focus:border-[#007BFF] focus:outline-none"
                  />
                  <button
                    type="button"
                    data-testid="pdf2md-gemini-selection-btn"
                    disabled={
                      !keyStatus?.configured || aiBusy || extracting || busy || !markdown.trim()
                    }
                    onClick={() => void runGeminiRefine("selection")}
                    className="knit-control-sm knit-btn-secondary inline-flex items-center gap-1.5 px-3 text-xs font-semibold disabled:opacity-50"
                  >
                    {aiBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#007BFF]" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5 text-[#007BFF]" />
                    )}
                    {t.pdf2md.aiRefineSelectionBtn}
                  </button>
                  <button
                    type="button"
                    data-testid="pdf2md-gemini-all-btn"
                    disabled={
                      !keyStatus?.configured || aiBusy || extracting || busy || !markdown.trim()
                    }
                    onClick={() => void runGeminiRefine("all")}
                    className="knit-control-sm inline-flex items-center gap-1.5 rounded-[4px] border border-[#B8DAFF] bg-[#E7F1FF] px-3 text-xs font-semibold text-[#0056B3] hover:bg-[#D0E2FF] disabled:opacity-50"
                  >
                    {aiBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    {t.pdf2md.aiRefineAllBtn}
                  </button>
                  {aiPreviousMarkdown !== null && (
                    <button
                      type="button"
                      data-testid="pdf2md-undo-ai-btn"
                      disabled={aiBusy}
                      onClick={handleUndoAi}
                      className="knit-control-sm inline-flex items-center gap-1.5 rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-xs font-semibold text-[#343A40] hover:bg-[#F8F9FA] disabled:opacity-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5 text-[#DC3545]" />
                      {t.pdf2md.aiUndoBtn}
                    </button>
                  )}
                </div>

                {aiNotice && (
                  <div className="rounded-[4px] border border-[#B8DAFF] bg-[#F8FAFF] px-3 py-1.5 text-xs text-[#0056B3]">
                    {aiNotice}
                  </div>
                )}
              </div>

              {/* Khung làm việc: Đầy đủ (Split Preview + Editor) hoặc Chỉ Markdown */}
              <div className="space-y-0">
                {loadMode === "full" ? (
                  <div
                    ref={splitContainerRef}
                    style={
                      {
                        height: `${liveHeightPx}px`,
                        "--pdf2md-split-left": `${(liveRatio * 100).toFixed(2)}%`,
                      } as React.CSSProperties
                    }
                    className={`grid grid-cols-1 gap-3 lg:gap-2 lg:grid-cols-[minmax(280px,var(--pdf2md-split-left,45%))_10px_minmax(0,1fr)] ${
                      isResizingWidth || isResizingHeight ? "select-none" : ""
                    }`}
                  >
                    {/* Left pane: Lazy Rust-rendered PDF Preview */}
                    <div className="knit-card flex min-h-0 flex-col overflow-hidden">
                      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#DEE2E6] bg-[#F8F9FA] px-3.5 py-2">
                        <div className="flex items-center gap-2 text-sm font-bold text-[#343A40]">
                          <Eye className="h-4 w-4 text-[#007BFF]" />
                          <span>{t.pdf2md.sourceTitle}</span>
                          {previewTotalPages > 0 && (
                            <span className="rounded-[4px] bg-[#E9ECEF] px-2 py-0.5 font-mono-code text-xs font-semibold text-[#495057]">
                              {previewTotalPages} p.
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-[#343A40]">
                            <input
                              type="checkbox"
                              checked={syncScroll}
                              onChange={(e) => setSyncScroll(e.target.checked)}
                            />
                            <FolderSync className="h-3.5 w-3.5 text-[#6C757D]" />
                            {t.pdf2md.syncScrollLabel}
                          </label>
                          <button
                            type="button"
                            onClick={openPreviewFind}
                            title="Ctrl+F"
                            className="knit-control-sm inline-flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-white px-2 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
                          >
                            <Search className="h-3.5 w-3.5 text-[#007BFF]" />
                          </button>
                        </div>
                      </div>

                      <DocumentFindBar
                        open={previewFindOpen}
                        query={previewFindQuery}
                        activeMatchIndex={activePreviewMatchIdx}
                        matchCount={previewMatches.length}
                        placeholder={t.pdf2md.findPreviewPlaceholder}
                        prevTitle={t.pdf2md.findPrevTitle}
                        nextTitle={t.pdf2md.findNextTitle}
                        closeAriaLabel={t.common.close}
                        counterColorClass="text-[#856404]"
                        inputRef={previewFindInputRef}
                        onQueryChange={(val) => {
                          setPreviewFindQuery(val);
                          setPreviewFindIdx(0);
                        }}
                        onPrev={() => setPreviewFindIdx((i) => i - 1)}
                        onNext={() => setPreviewFindIdx((i) => i + 1)}
                        onClose={() => {
                          setPreviewFindOpen(false);
                          setPreviewFindQuery("");
                        }}
                      />

                      <div className="min-h-0 flex-1 overscroll-contain">
                        <PdfLazyFilePreview
                          ref={previewRef}
                          filePath={sourcePath}
                          totalPages={previewTotalPages}
                          loading={extracting}
                          error={null}
                          emptyText={t.pdf2md.previewEmpty}
                          loadingText={t.pdf2md.previewLoading}
                          onScrollRatioChange={handlePreviewScrollRatio}
                          onOpenFind={openPreviewFind}
                        />
                      </div>
                    </div>

                    <PaneResizeHandle
                      orientation="vertical"
                      ariaLabel={t.pdf2md.resizeWidthTitle}
                      title={t.pdf2md.resizeWidthTitle}
                      onPointerDown={handleStartWidthResize}
                    />

                    {renderMarkdownEditorPane()}
                  </div>
                ) : (
                  <div
                    style={{ height: `${liveHeightPx}px` }}
                    className={`flex flex-col ${isResizingHeight ? "select-none" : ""}`}
                  >
                    {renderMarkdownEditorPane()}
                  </div>
                )}

                <PaneResizeHandle
                  orientation="horizontal"
                  variant="dashed"
                  ariaLabel={t.pdf2md.resizeHeightTitle}
                  title={`${liveHeightPx}px`}
                  labelText={`${liveHeightPx}px`}
                  onPointerDown={handleStartHeightResize}
                />
              </div>
            </>
          )}
        </>
      )}

      <ConfirmModal
        open={pendingOptionToggle !== null}
        title={t.pdf2md.confirmReformatTitle}
        description={t.pdf2md.confirmReformatDesc}
        confirmLabel={t.pdf2md.confirmReformatBtn}
        cancelLabel={t.common.cancel}
        onConfirm={() => {
          const next = pendingOptionToggle;
          setPendingOptionToggle(null);
          if (next) {
            applyExtractionOptions(next);
          }
        }}
        onCancel={() => setPendingOptionToggle(null)}
      />

      <ExportConflictModal
        conflictPaths={pendingConflict?.conflicts ?? []}
        isLockedByActiveJob={pendingConflict?.lockedByActiveJob}
        onResolve={(c) => void handleConflictResolution(c)}
      />

      <ImportFeedbackToast toast={importToast} />
    </div>
  );
};
