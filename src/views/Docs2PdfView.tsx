import React from "react";
import { AlertTriangle, CheckCircle2, FileCode2, FileOutput, RefreshCw } from "lucide-react";
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
  detectEditorLanguage,
  editorLanguageExtension,
  type EditorLanguage,
  type MarkdownCodeEditorHandle,
} from "../components/MarkdownCodeEditor";
import type { PdfJsPreviewHandle } from "../components/PdfJsPreview";
import { ViewHeader } from "../components/ViewHeader";
import { useVerticalResize } from "../hooks/useVerticalResize";
import { useI18n } from "../i18n";
import {
  findActiveExportConflicts,
  resolveUniqueNonActiveExportPath,
  useExportFilenameCheck,
} from "../lib/exportPath";
import {
  checkDocMissingLinks,
  checkExportConflicts,
  convertDocContentToPdf,
  convertDocToPdf,
  formatBytes,
  getDocsEngineStatus,
  getFileSizeBytes,
  isJobCancelledError,
  isTauriRuntime,
  pickFiles,
  pickSaveFile,
  previewDocPdfBytes,
  readDocTextFile,
  writeDocTextFile,
} from "../lib/ipc";
import { findAllTextMatches, findMarkdownSourceRange } from "../lib/markdownSearch";
import { type MermaidTheme, renderMermaidSvgs } from "../lib/mermaid";
import { usePersistentState } from "../lib/storage";
import type {
  DocConvertOptions,
  DocFont,
  HtmlRenderMode,
  HtmlStepKind,
  DocInputKind,
  DocTheme,
  EngineStatus,
  JobEvent,
  PageNumberFormat,
  PageNumberPosition,
  PageNumberingOptions,
  PageOrientation,
  PageSizePreset,
} from "../types/ipc";
import type { DroppedBatch } from "./Image2PdfView";
import { Docs2PdfSettingsCard } from "./docs2pdf/Docs2PdfSettingsCard";
import { DocsSplitWorkbench } from "./docs2pdf/DocsSplitWorkbench";

interface Docs2PdfViewProps {
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
}

const SUPPORTED_DOC_RE =
  /\.(md|markdown|txt|log|rst|html|htm|xhtml|css|js|mjs|cjs|ts|jsx|tsx|epub|docx|pptx)$/i;

function detectDocKind(path: string | null): DocInputKind {
  if (!path) return "markdown";
  const lower = path.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (
    lower.endsWith(".txt") ||
    lower.endsWith(".log") ||
    lower.endsWith(".rst") ||
    lower.endsWith(".css") ||
    lower.endsWith(".js") ||
    lower.endsWith(".mjs") ||
    lower.endsWith(".cjs") ||
    lower.endsWith(".ts") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".tsx")
  ) {
    return "plain_text";
  }
  if (lower.endsWith(".html") || lower.endsWith(".htm") || lower.endsWith(".xhtml")) return "html";
  if (lower.endsWith(".epub")) return "epub";
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".pptx")) return "pptx";
  return "markdown";
}

export function formatEditorContentForCompilation(
  text: string,
  lang: EditorLanguage,
  fallbackKind: DocInputKind,
): { content: string; kind: DocInputKind } {
  if (lang === "html") return { content: text, kind: "html" };
  if (lang === "markdown") return { content: text, kind: "markdown" };
  if (lang === "plain_text") return { content: text, kind: "plain_text" };
  if (
    lang === "css" ||
    lang === "javascript" ||
    lang === "typescript" ||
    lang === "jsx" ||
    lang === "tsx"
  ) {
    const fenceLang = lang === "javascript" ? "js" : lang === "typescript" ? "ts" : lang;
    const longestRun = Math.max(2, ...(text.match(/`+/g) ?? []).map((s) => s.length));
    const fence = "`".repeat(longestRun + 1);
    return { content: `${fence}${fenceLang}\n${text}\n${fence}`, kind: "markdown" };
  }
  return { content: text, kind: fallbackKind };
}

function parentDirOf(path: string | null): string | null {
  if (!path) return null;
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (idx <= 0) return null;
  return path.slice(0, idx);
}

export const Docs2PdfView: React.FC<Docs2PdfViewProps> = ({
  onStartJob,
  onJobEvent,
  onFinishJob,
  busy,
  activeExportPaths = [],
  droppedBatch,
  defaultExportDir = "",
}) => {
  const { t } = useI18n();
  const { toast: importToast, highlighted: importHighlighted, notifyImported } =
    useImportFeedback();

  const [inputPath, setInputPath] = React.useState<string | null>(null);
  const [exportFilename, setExportFilename] = React.useState<string>("document.pdf");
  const { effectiveFilename, defaultTargetPath, existsAtDefaultDir } =
    useExportFilenameCheck(defaultExportDir, exportFilename, "document.pdf", ["pdf"]);
  const [pendingConflict, setPendingConflict] = React.useState<{
    outPath: string;
    conflicts: string[];
    lockedByActiveJob: boolean;
  } | null>(null);
  const [editorText, setEditorText] = React.useState<string>("");
  const [savedText, setSavedText] = React.useState<string>("");
  const [saveFeedback, setSaveFeedback] = React.useState<string | null>(null);

  const [engineStatus, setEngineStatus] = React.useState<EngineStatus | null>(null);
  const [pageSize, setPageSize] = usePersistentState<PageSizePreset>("knit.docs.pageSize", "a4");
  const [marginMm, setMarginMm] = usePersistentState<number>("knit.docs.marginMm", 20);
  const [fontSizePt, setFontSizePt] = usePersistentState<number>("knit.docs.fontSizePt", 11);
  const [theme, setTheme] = usePersistentState<DocTheme>("knit.docs.theme", "github");
  const [pdfFont, setPdfFont] = usePersistentState<DocFont>("knit.docs.font", "default");
  const [htmlRenderMode, setHtmlRenderMode] = usePersistentState<HtmlRenderMode>(
    "knit.docs.htmlRenderMode",
    "auto",
  );
  const [htmlStepKind, setHtmlStepKind] = usePersistentState<HtmlStepKind>(
    "knit.docs.htmlStepKind",
    "auto_key",
  );
  const [htmlStepKey, setHtmlStepKey] = usePersistentState<string>(
    "knit.docs.htmlStepKey",
    "Space",
  );
  const [htmlStepSelector, setHtmlStepSelector] = usePersistentState<string>(
    "knit.docs.htmlStepSelector",
    "",
  );
  const [htmlStepClickX, setHtmlStepClickX] = usePersistentState<number>(
    "knit.docs.htmlStepClickX",
    0.85,
  );
  const [htmlStepClickY, setHtmlStepClickY] = usePersistentState<number>(
    "knit.docs.htmlStepClickY",
    0.5,
  );
  const [pickingClickPoint, setPickingClickPoint] = React.useState(false);
  const [editorLanguage, setEditorLanguage] = React.useState<EditorLanguage>("markdown");
  const [manualLangLocked, setManualLangLocked] = React.useState(false);
  const [mermaidTheme, setMermaidTheme] = usePersistentState<MermaidTheme>(
    "knit.docs.mermaidTheme",
    "default",
  );
  const [titleOverride, setTitleOverride] = usePersistentState<string>("knit.docs.titleOverride", "");
  const [includeToc, setIncludeToc] = usePersistentState<boolean>("knit.docs.includeToc", false);
  const [tocPage, setTocPage] = usePersistentState<number>("knit.docs.tocPage", 1);
  const [orientation, setOrientation] = usePersistentState<PageOrientation>(
    "knit.docs.orientation",
    "portrait",
  );
  const [lineSpacing, setLineSpacing] = usePersistentState<number>(
    "knit.docs.lineSpacing",
    1.4,
  );
  const [pageNumEnabled, setPageNumEnabled] = usePersistentState<boolean>(
    "knit.docs.pageNumEnabled",
    false,
  );
  const [pageNumStartNumber, setPageNumStartNumber] = usePersistentState<number>(
    "knit.docs.pageNumStartNumber",
    1,
  );
  const [pageNumStartFromPage, setPageNumStartFromPage] = usePersistentState<number>(
    "knit.docs.pageNumStartFromPage",
    1,
  );
  const [pageNumPosition, setPageNumPosition] = usePersistentState<PageNumberPosition>(
    "knit.docs.pageNumPosition",
    "bottom_center",
  );
  const [pageNumFormat, setPageNumFormat] = usePersistentState<PageNumberFormat>(
    "knit.docs.pageNumFormat",
    "number_only",
  );
  const [workspaceHeightPx, setWorkspaceHeightPx] = usePersistentState<number>(
    "knit.docs.workspaceHeightPx",
    560,
  );
  const { height: liveHeightPx, handlePointerDown: handleStartHeightResize } = useVerticalResize({
    value: workspaceHeightPx,
    min: 320,
    max: 4000,
    onCommit: setWorkspaceHeightPx,
  });
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [missingLinks, setMissingLinks] = React.useState<string[]>([]);
  const [previewPdfBytes, setPreviewPdfBytes] = React.useState<Uint8Array | null>(null);
  const [previewTotalPages, setPreviewTotalPages] = React.useState<number>(0);
  const [officeSourceBytes, setOfficeSourceBytes] = React.useState<number | null>(null);

  const [editorFindOpen, setEditorFindOpen] = React.useState(false);
  const [editorFindQuery, setEditorFindQuery] = React.useState("");
  const [editorFindIdx, setEditorFindIdx] = React.useState(0);

  const [previewFindOpen, setPreviewFindOpen] = React.useState(false);
  const [previewFindQuery, setPreviewFindQuery] = React.useState("");
  const [previewFindIdx, setPreviewFindIdx] = React.useState(0);
  const [previewMatchCount, setPreviewMatchCount] = React.useState(0);

  const [syncScroll, setSyncScroll] = usePersistentState<boolean>("knit.docs.syncScroll", false);

  const previewSeqRef = React.useRef(0);
  const lastHandledDropSeq = React.useRef<number>(0);
  const mermaidCacheRef = React.useRef<Map<string, string>>(new Map());
  const editorRef = React.useRef<MarkdownCodeEditorHandle | null>(null);
  const previewRef = React.useRef<PdfJsPreviewHandle | null>(null);
  const editorFindInputRef = React.useRef<HTMLInputElement | null>(null);
  const previewFindInputRef = React.useRef<HTMLInputElement | null>(null);
  const editorPaneRef = React.useRef<HTMLDivElement | null>(null);
  const previewPaneRef = React.useRef<HTMLDivElement | null>(null);
  const syncLockRef = React.useRef<{ source: "editor" | "preview" | null; until: number }>({
    source: null,
    until: 0,
  });

  const docKind = detectDocKind(inputPath);
  const isEditableText =
    docKind === "markdown" || docKind === "plain_text" || docKind === "html";
  const isOfficeFile = docKind === "docx" || docKind === "pptx";
  const isPreviewableDoc =
    isEditableText ||
    (docKind === "epub" && Boolean(inputPath)) ||
    (isOfficeFile && Boolean(inputPath));
  const isDirty = isEditableText && editorText !== savedText;

  React.useEffect(() => {
    if (!isOfficeFile || !inputPath || !isTauriRuntime()) {
      setOfficeSourceBytes(null);
      return;
    }
    let cancelled = false;
    void getFileSizeBytes(inputPath)
      .then((sz) => {
        if (!cancelled) setOfficeSourceBytes(sz);
      })
      .catch(() => {
        if (!cancelled) setOfficeSourceBytes(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isOfficeFile, inputPath]);

  React.useEffect(() => {
    if (previewTotalPages > 0 && tocPage > previewTotalPages) {
      setTocPage(previewTotalPages);
    }
  }, [previewTotalPages, tocPage, setTocPage]);

  const pageNumbering = React.useMemo<PageNumberingOptions>(
    () => ({
      enabled: pageNumEnabled,
      start_number: Math.max(0, pageNumStartNumber),
      start_from_page: Math.max(1, pageNumStartFromPage),
      position: pageNumPosition,
      format: pageNumFormat,
      label_prefix: t.docs2pdf.pageLabelPrefix,
    }),
    [
      pageNumEnabled,
      pageNumStartNumber,
      pageNumStartFromPage,
      pageNumPosition,
      pageNumFormat,
      t.docs2pdf.pageLabelPrefix,
    ],
  );

  const docOptions = React.useMemo<DocConvertOptions>(
    () => ({
      page_size: pageSize,
      orientation,
      margin_mm: marginMm,
      font_size_pt: fontSizePt,
      line_spacing: lineSpacing,
      title: titleOverride.trim() !== "" ? titleOverride.trim() : null,
      include_toc: includeToc,
      toc_page: includeToc ? Math.max(1, tocPage) : 1,
      page_numbering: pageNumbering,
      theme,
      font: pdfFont,
      html_render_mode: htmlRenderMode,
      html_step_trigger: {
        kind: htmlStepKind,
        key: htmlStepKind === "key" ? htmlStepKey : null,
        selector: htmlStepKind === "click_selector" ? htmlStepSelector : null,
        click_x: htmlStepKind === "click_point" ? htmlStepClickX : null,
        click_y: htmlStepKind === "click_point" ? htmlStepClickY : null,
      },
    }),
    [
      pageSize,
      orientation,
      marginMm,
      fontSizePt,
      lineSpacing,
      titleOverride,
      includeToc,
      tocPage,
      pageNumbering,
      theme,
      pdfFont,
      htmlRenderMode,
      htmlStepKind,
      htmlStepKey,
      htmlStepSelector,
      htmlStepClickX,
      htmlStepClickY,
    ],
  );

  const checkEngine = React.useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      setEngineStatus(await getDocsEngineStatus());
    } catch {
      // ignore outside Tauri
    }
  }, []);

  React.useEffect(() => {
    void checkEngine();
  }, [checkEngine]);

  const loadDocumentPath = React.useCallback(
    async (path: string) => {
      setErrorMsg(null);
      setSaveFeedback(null);
      setManualLangLocked(false);
      setInputPath(path);
      const base = path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") || "document";
      setExportFilename(`${base}.pdf`);
      const kind = detectDocKind(path);
      setEditorLanguage(detectEditorLanguage(path, ""));
      if (kind === "markdown" || kind === "plain_text" || kind === "html") {
        if (isTauriRuntime()) {
          try {
            const text = await readDocTextFile(path);
            setEditorText(text);
            setSavedText(text);
            setEditorLanguage(detectEditorLanguage(path, text));
          } catch (e) {
            setErrorMsg(String(e));
          }
        }
      } else {
        setEditorText("");
        setSavedText("");
        setPreviewPdfBytes(null);
        setPreviewTotalPages(0);
      }
      notifyImported(t.common.importSuccessToast(path.split(/[\\/]/).pop() ?? path));
    },
    [notifyImported, t.common],
  );

  React.useEffect(() => {
    if (!droppedBatch || droppedBatch.seq === lastHandledDropSeq.current) return;
    lastHandledDropSeq.current = droppedBatch.seq;
    const match = droppedBatch.paths.find((p) => SUPPORTED_DOC_RE.test(p));
    if (match) void loadDocumentPath(match);
  }, [droppedBatch, loadDocumentPath]);

  const openEditorFind = React.useCallback(() => {
    setEditorFindOpen(true);
    window.requestAnimationFrame(() => {
      editorFindInputRef.current?.focus();
      editorFindInputRef.current?.select();
    });
  }, []);

  const openPreviewFind = React.useCallback(() => {
    setPreviewFindOpen(true);
    window.requestAnimationFrame(() => {
      previewFindInputRef.current?.focus();
      previewFindInputRef.current?.select();
    });
  }, []);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        const active = document.activeElement;
        if (active && previewPaneRef.current?.contains(active)) {
          openPreviewFind();
        } else {
          openEditorFind();
        }
      } else if (e.key === "Escape") {
        if (editorFindOpen) {
          setEditorFindOpen(false);
          setEditorFindQuery("");
        }
        if (previewFindOpen) {
          setPreviewFindOpen(false);
          setPreviewFindQuery("");
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editorFindOpen, previewFindOpen, openEditorFind, openPreviewFind]);

  const editorMatches = React.useMemo(
    () => (isEditableText && editorFindOpen ? findAllTextMatches(editorText, editorFindQuery) : []),
    [editorText, editorFindOpen, editorFindQuery, isEditableText],
  );
  const activeEditorMatchIdx =
    editorFindOpen && editorFindQuery.trim() && editorMatches.length > 0
      ? ((editorFindIdx % editorMatches.length) + editorMatches.length) % editorMatches.length
      : null;

  const activePreviewMatchIdx =
    previewFindOpen && previewFindQuery.trim() && previewMatchCount > 0
      ? ((previewFindIdx % previewMatchCount) + previewMatchCount) % previewMatchCount
      : null;

  React.useEffect(() => {
    if (!editorFindOpen || !editorFindQuery.trim()) {
      editorRef.current?.setSearchHighlights([], null);
      return;
    }
    editorRef.current?.setSearchHighlights(editorMatches, activeEditorMatchIdx);
  }, [editorFindOpen, editorFindQuery, editorMatches, activeEditorMatchIdx]);

  React.useEffect(() => {
    if (activePreviewMatchIdx !== null) {
      previewRef.current?.scrollToMatch(activePreviewMatchIdx);
    }
  }, [activePreviewMatchIdx]);

  const handleToggleSyncScroll = (checked: boolean) => {
    setSyncScroll(checked);
    if (checked) {
      const ratio = editorRef.current?.getScrollRatio() ?? 0;
      syncLockRef.current = { source: "editor", until: performance.now() + 140 };
      previewRef.current?.setScrollRatio(ratio);
    }
  };

  const handleEditorScrollRatio = React.useCallback(
    (ratio: number) => {
      if (!syncScroll) return;
      const now = performance.now();
      if (syncLockRef.current.source === "preview" && now < syncLockRef.current.until) return;
      syncLockRef.current = { source: "editor", until: now + 100 };
      previewRef.current?.setScrollRatio(ratio);
    },
    [syncScroll],
  );

  const handlePreviewScrollRatio = React.useCallback(
    (ratio: number) => {
      if (!syncScroll) return;
      const now = performance.now();
      if (syncLockRef.current.source === "editor" && now < syncLockRef.current.until) return;
      syncLockRef.current = { source: "preview", until: now + 100 };
      editorRef.current?.setScrollRatio(ratio);
    },
    [syncScroll],
  );

  const handleGoToInEditor = React.useCallback(
    (selectedText: string, occurrenceIndex = 0) => {
      if (!isEditableText) return;
      const range = findMarkdownSourceRange(editorText, selectedText, occurrenceIndex);
      if (range) {
        setErrorMsg(null);
        editorRef.current?.jumpToRange(range.from, range.to, true);
      } else {
        setErrorMsg(t.docs2pdf.gotoNotFound);
      }
    },
    [editorText, isEditableText, t.docs2pdf.gotoNotFound],
  );

  const runLivePreview = React.useCallback(async () => {
    if (!isTauriRuntime() || !isPreviewableDoc) return;
    if (isOfficeFile && engineStatus?.libreoffice_available === false) {
      setPreviewPdfBytes(null);
      setPreviewTotalPages(0);
      setMissingLinks([]);
      setPreviewError(t.docs2pdf.libreMissing);
      return;
    }
    if (isEditableText && editorText.trim().length === 0) {
      setPreviewPdfBytes(null);
      setPreviewTotalPages(0);
      setMissingLinks([]);
      setPreviewError(null);
      return;
    }

    const seq = ++previewSeqRef.current;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const compiled = isEditableText
        ? formatEditorContentForCompilation(editorText, editorLanguage, docKind)
        : { content: null as string | null, kind: docKind };
      const shouldCheckLinks =
        isEditableText && (editorLanguage === "markdown" || docKind === "markdown");
      const missingLinksPromise =
        shouldCheckLinks && typeof checkDocMissingLinks === "function"
          ? checkDocMissingLinks(editorText, parentDirOf(inputPath)).catch(() => [] as string[])
          : Promise.resolve([] as string[]);
      const mermaidSvgs =
        compiled.kind === "markdown" && compiled.content
          ? await renderMermaidSvgs(compiled.content, mermaidTheme, mermaidCacheRef.current)
          : {};
      if (previewSeqRef.current !== seq) return;
      const [pdfBytes, missing] = await Promise.all([
        previewDocPdfBytes({
          content: compiled.content,
          inputPath: !isEditableText ? inputPath : null,
          inputKind: compiled.kind,
          baseDir: parentDirOf(inputPath),
          options: {
            ...docOptions,
            mermaid_svgs: mermaidSvgs,
          },
        }),
        missingLinksPromise,
      ]);
      if (previewSeqRef.current !== seq) return;
      setMissingLinks(missing);
      setPreviewPdfBytes(pdfBytes);
    } catch (e) {
      if (previewSeqRef.current !== seq) return;
      const errStr = String(e);
      if (isJobCancelledError(errStr)) return;
      setPreviewError(errStr);
    } finally {
      if (previewSeqRef.current === seq) setPreviewLoading(false);
    }
  }, [
    docKind,
    docOptions,
    editorLanguage,
    editorText,
    engineStatus?.libreoffice_available,
    inputPath,
    isEditableText,
    isOfficeFile,
    isPreviewableDoc,
    mermaidTheme,
    t.docs2pdf.libreMissing,
  ]);

  React.useEffect(() => {
    if (!isTauriRuntime() || !isPreviewableDoc) return;
    if (isEditableText && editorText.trim().length === 0) {
      setPreviewPdfBytes(null);
      setPreviewTotalPages(0);
      setPreviewError(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void runLivePreview();
    }, docKind === "epub" || isOfficeFile ? 350 : 600);
    return () => window.clearTimeout(timer);
  }, [
    editorText,
    docOptions,
    docKind,
    inputPath,
    isEditableText,
    isPreviewableDoc,
    mermaidTheme,
    runLivePreview,
  ]);

  const handlePickDoc = async () => {
    setErrorMsg(null);
    try {
      const files = await pickFiles({
        title: t.docs2pdf.pickDocDialog,
        multiple: false,
        filters: [
          {
            name: "Documents",
            extensions: [
              "md",
              "markdown",
              "txt",
              "html",
              "htm",
              "css",
              "js",
              "ts",
              "jsx",
              "tsx",
              "epub",
              "docx",
              "pptx",
            ],
          },
        ],
      });
      if (files.length > 0) await loadDocumentPath(files[0]);
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const handleSaveText = async (saveAs: boolean) => {
    setErrorMsg(null);
    setSaveFeedback(null);
    try {
      const ext = editorLanguageExtension(editorLanguage);
      let targetPath = !saveAs && inputPath && isEditableText ? inputPath : null;
      if (!targetPath) {
        targetPath = await pickSaveFile({
          title: t.docs2pdf.saveMdDialog,
          defaultPath: inputPath || `document${ext}`,
          filters: [
            { name: "Markdown", extensions: ["md", "markdown"] },
            { name: "Web & Code", extensions: ["html", "htm", "css", "js", "ts", "jsx", "tsx"] },
            { name: "Text", extensions: ["txt"] },
          ],
        });
      }
      if (!targetPath) return;

      await writeDocTextFile(targetPath, editorText);
      setInputPath(targetPath);
      setSavedText(editorText);
      setEditorLanguage(detectEditorLanguage(targetPath, editorText));
      setSaveFeedback(t.docs2pdf.savedMdStatus);
      window.setTimeout(() => setSaveFeedback(null), 2500);
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const canConvert = isEditableText
    ? editorText.trim().length > 0 || Boolean(inputPath)
    : Boolean(inputPath);

  const executeConvert = async (outPath: string) => {
    const jobId = crypto.randomUUID();
    const snapEditorText = editorText;
    const snapEditorLanguage = editorLanguage;
    const snapDocKind = docKind;
    const snapInputPath = inputPath;
    const snapIsEditableText = isEditableText;
    const snapDocOptions = docOptions;
    const snapMermaidTheme = mermaidTheme;
    const emitEvent = (ev: JobEvent) => onJobEvent(ev, jobId);

    try {
      onStartJob(jobId, t.shell.nav.docs2pdf.label, [outPath]);

      const useInlineText = snapIsEditableText && snapEditorText.trim().length > 0;
      const compiled = useInlineText
        ? formatEditorContentForCompilation(snapEditorText, snapEditorLanguage, snapDocKind)
        : { content: snapEditorText, kind: snapDocKind };
      const mermaidSvgs =
        compiled.kind === "markdown" && compiled.content.trim().length > 0
          ? await renderMermaidSvgs(compiled.content, snapMermaidTheme, mermaidCacheRef.current)
          : {};
      const finalOptions: DocConvertOptions = { ...snapDocOptions, mermaid_svgs: mermaidSvgs };

      const res = useInlineText
        ? await convertDocContentToPdf(
            jobId,
            compiled.content,
            compiled.kind,
            parentDirOf(snapInputPath),
            snapInputPath,
            outPath,
            finalOptions,
            emitEvent,
          )
        : await convertDocToPdf(jobId, snapInputPath!, outPath, finalOptions, emitEvent);

      onFinishJob(
        t.shell.nav.docs2pdf.label,
        [res.output_path],
        t.docs2pdf.doneSummary(
          String(res.page_count ?? "?"),
          formatBytes(res.bytes_written),
          res.used_external_engine
            ? compiled.kind === "html"
              ? "Chromium"
              : "LibreOffice"
            : "Typst Native",
        ),
        "success",
        undefined,
        jobId,
      );
    } catch (e) {
      const rawMsg = String(e);
      const cancelled = isJobCancelledError(rawMsg);
      const msg = cancelled ? t.common.jobCancelledMsg : rawMsg;
      setErrorMsg(msg);
      onFinishJob(
        t.shell.nav.docs2pdf.label,
        [],
        msg,
        cancelled ? "cancelled" : "error",
        undefined,
        jobId,
      );
    }
  };

  const handleConvert = async () => {
    if (!canConvert || busy) return;
    setErrorMsg(null);
    try {
      let outPath: string | null = defaultTargetPath;
      if (!outPath) {
        const fallbackParent = parentDirOf(inputPath);
        const suggestedPath = fallbackParent
          ? `${fallbackParent}/${effectiveFilename}`
          : effectiveFilename;
        outPath = await pickSaveFile({
          title: t.docs2pdf.savePdfDialog,
          defaultPath: suggestedPath,
          filters: [{ name: "PDF Document", extensions: ["pdf"] }],
        });
      }
      if (!outPath) return;

      const activeHits = findActiveExportConflicts([outPath], activeExportPaths);
      if (activeHits.length > 0) {
        setPendingConflict({ outPath, conflicts: activeHits, lockedByActiveJob: true });
        return;
      }

      if (defaultTargetPath) {
        const conflicts = await checkExportConflicts([outPath]);
        if (conflicts.length > 0) {
          setPendingConflict({ outPath, conflicts, lockedByActiveJob: false });
          return;
        }
      }
      await executeConvert(outPath);
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const handleConflictResolution = async (choice: ConflictResolution) => {
    const pending = pendingConflict;
    setPendingConflict(null);
    if (!pending || choice === "cancel") return;
    if (choice === "overwrite" && !pending.lockedByActiveJob) {
      await executeConvert(pending.outPath);
      return;
    }
    const nextPath = await resolveUniqueNonActiveExportPath(pending.outPath, activeExportPaths);
    await executeConvert(nextPath);
  };

  const effectiveHtmlMode = docKind === "html" || editorLanguage === "html";

  const controlsCluster = (
    <>
      <Dropzone
        title={t.docs2pdf.dropTitle}
        description={t.docs2pdf.dropDesc}
        onPickFiles={() => void handlePickDoc()}
        filesLabel={t.docs2pdf.pickDocBtn}
      />

      {inputPath && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 rounded-[4px] border px-3.5 py-2 text-sm transition-colors duration-300 ${
            importHighlighted
              ? "border-[#28A745] bg-[#D4EDDA]/50"
              : "border-[#DEE2E6] bg-white"
          }`}
        >
          <div className="flex min-w-0 items-center gap-2">
            <FileCode2
              className={`h-4 w-4 shrink-0 ${
                importHighlighted ? "text-[#28A745]" : "text-[#007BFF]"
              }`}
            />
            <span className="font-semibold">{t.docs2pdf.selectedFileLabel}</span>
            <span className="font-mono-code truncate text-xs text-[#343A40]">{inputPath}</span>
          </div>
          {isDirty && (
            <span className="rounded-[4px] bg-[#FFF3CD] px-2 py-0.5 text-xs font-semibold text-[#856404]">
              {t.docs2pdf.unsavedBadge}
            </span>
          )}
        </div>
      )}

      <ExportFilenameControl
        value={exportFilename}
        onChange={setExportFilename}
        placeholder="document.pdf"
        defaultExportDir={defaultExportDir}
        existsAtDefaultDir={existsAtDefaultDir}
        estimateText={
          isPreviewableDoc && previewPdfBytes
            ? t.common.estimatedOutputSummary(formatBytes(previewPdfBytes.byteLength), 1)
            : isOfficeFile && officeSourceBytes !== null
              ? t.docs2pdf.estimatedOfficeNote(
                  formatBytes(Math.max(4096, Math.round(officeSourceBytes * 1.15))),
                )
              : null
        }
        estimating={isPreviewableDoc && previewLoading && !previewPdfBytes}
      />

      <Docs2PdfSettingsCard
        disabled={isOfficeFile}
        isHtmlFile={effectiveHtmlMode}
        htmlRenderMode={htmlRenderMode}
        onChangeHtmlRenderMode={(mode) => {
          setHtmlRenderMode(mode);
          if (mode !== "slide_step") setPickingClickPoint(false);
        }}
        htmlStepKind={htmlStepKind}
        htmlStepKey={htmlStepKey}
        htmlStepSelector={htmlStepSelector}
        htmlStepClickX={htmlStepClickX}
        htmlStepClickY={htmlStepClickY}
        pickingClickPoint={pickingClickPoint}
        onChangeHtmlStepKind={(kind) => {
          setHtmlStepKind(kind);
          if (kind !== "click_point") setPickingClickPoint(false);
        }}
        onChangeHtmlStepKey={setHtmlStepKey}
        onChangeHtmlStepSelector={setHtmlStepSelector}
        onChangeHtmlStepClickX={setHtmlStepClickX}
        onChangeHtmlStepClickY={setHtmlStepClickY}
        onTogglePickClickPoint={() => setPickingClickPoint((v) => !v)}
        theme={theme}
        pdfFont={pdfFont}
        mermaidTheme={mermaidTheme}
        pageSize={pageSize}
        orientation={orientation}
        marginMm={marginMm}
        fontSizePt={fontSizePt}
        lineSpacing={lineSpacing}
        titleOverride={titleOverride}
        includeToc={includeToc}
        tocPage={tocPage}
        maxTocPage={previewTotalPages > 0 ? previewTotalPages : undefined}
        pageNumEnabled={pageNumEnabled}
        pageNumPosition={pageNumPosition}
        pageNumFormat={pageNumFormat}
        pageNumStartNumber={pageNumStartNumber}
        pageNumStartFromPage={pageNumStartFromPage}
        onChangeTheme={setTheme}
        onChangePdfFont={setPdfFont}
        onChangeMermaidTheme={setMermaidTheme}
        onChangePageSize={setPageSize}
        onChangeOrientation={setOrientation}
        onChangeMarginMm={setMarginMm}
        onChangeFontSizePt={setFontSizePt}
        onChangeLineSpacing={setLineSpacing}
        onChangeTitleOverride={setTitleOverride}
        onChangeIncludeToc={setIncludeToc}
        onChangeTocPage={setTocPage}
        onChangePageNumEnabled={setPageNumEnabled}
        onChangePageNumPosition={setPageNumPosition}
        onChangePageNumFormat={setPageNumFormat}
        onChangePageNumStartNumber={setPageNumStartNumber}
        onChangePageNumStartFromPage={setPageNumStartFromPage}
      />
    </>
  );

  const workbenchNode = isPreviewableDoc ? (
    <DocsSplitWorkbench
      isEditableText={isEditableText}
      liveHeightPx={liveHeightPx}
      editorText={editorText}
      editorLanguage={editorLanguage}
      onChangeEditorLanguage={(lang) => {
        setManualLangLocked(true);
        setEditorLanguage(lang);
      }}
      saveExtension={editorLanguageExtension(editorLanguage)}
      saveFeedback={saveFeedback}
      previewLoading={previewLoading}
      previewError={previewError}
      previewPdfBytes={previewPdfBytes}
      previewTotalPages={previewTotalPages}
      syncScroll={syncScroll}
      editorFindOpen={editorFindOpen}
      editorFindQuery={editorFindQuery}
      activeEditorMatchIdx={activeEditorMatchIdx}
      editorMatchCount={editorMatches.length}
      previewFindOpen={previewFindOpen}
      previewFindQuery={previewFindQuery}
      activePreviewMatchIdx={activePreviewMatchIdx}
      previewMatchCount={previewMatchCount}
      editorRef={editorRef}
      previewRef={previewRef}
      editorPaneRef={editorPaneRef}
      previewPaneRef={previewPaneRef}
      editorFindInputRef={editorFindInputRef}
      previewFindInputRef={previewFindInputRef}
      onChangeEditorText={(nextText) => {
        setEditorText(nextText);
        if (!inputPath && !manualLangLocked) {
          setEditorLanguage(detectEditorLanguage(null, nextText));
        }
      }}
      onSaveText={(saveAs) => void handleSaveText(saveAs)}
      onOpenEditorFind={openEditorFind}
      onChangeEditorFindQuery={(val) => {
        setEditorFindQuery(val);
        setEditorFindIdx(0);
      }}
      onStepEditorMatch={(delta) => setEditorFindIdx((i) => i + delta)}
      onCloseEditorFind={() => {
        setEditorFindOpen(false);
        setEditorFindQuery("");
      }}
      onOpenPreviewFind={openPreviewFind}
      onChangePreviewFindQuery={(val) => {
        setPreviewFindQuery(val);
        setPreviewFindIdx(0);
      }}
      onStepPreviewMatch={(delta) => setPreviewFindIdx((i) => i + delta)}
      onClosePreviewFind={() => {
        setPreviewFindOpen(false);
        setPreviewFindQuery("");
      }}
      onRefreshPreview={() => void runLivePreview()}
      onPageCountChange={setPreviewTotalPages}
      onSearchMatchCountChange={setPreviewMatchCount}
      onToggleSyncScroll={handleToggleSyncScroll}
      onEditorScrollRatio={handleEditorScrollRatio}
      onPreviewScrollRatio={handlePreviewScrollRatio}
      onGoToInEditor={handleGoToInEditor}
      onStartHeightResize={handleStartHeightResize}
      pickPointActive={
        effectiveHtmlMode &&
        htmlRenderMode === "slide_step" &&
        htmlStepKind === "click_point" &&
        pickingClickPoint
      }
      pickedPoint={
        effectiveHtmlMode &&
        htmlRenderMode === "slide_step" &&
        htmlStepKind === "click_point"
          ? { x: htmlStepClickX, y: htmlStepClickY }
          : null
      }
      onPickPoint={(nx, ny) => {
        setHtmlStepClickX(nx);
        setHtmlStepClickY(ny);
        setPickingClickPoint(false);
      }}
    />
  ) : (
    <div className="knit-card p-4 text-sm text-[#6C757D]">
      {t.docs2pdf.editorReadonlyNotice}
    </div>
  );

  return (
    <div className="space-y-4">
      <ViewHeader
        title={t.docs2pdf.title}
        subtitle={t.docs2pdf.subtitle}
        actions={
          <button
            type="button"
            disabled={!canConvert || busy || (isOfficeFile && engineStatus?.libreoffice_available === false)}
            onClick={() => void handleConvert()}
            className="knit-control knit-btn-primary inline-flex items-center gap-1.5 px-4 text-sm disabled:opacity-50"
          >
            <FileOutput className="h-4 w-4" />
            {t.docs2pdf.convertBtn}
          </button>
        }
      />

      {engineStatus && (
        <div
          className={`flex items-center justify-between rounded-[4px] border px-3.5 py-2.5 text-sm ${
            engineStatus.libreoffice_available
              ? "border-[#C3E6CB] bg-[#D4EDDA] text-[#155724]"
              : "border-[#FFEEBA] bg-[#FFF3CD] text-[#856404]"
          }`}
        >
          <div className="flex items-center gap-2">
            {engineStatus.libreoffice_available ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0" />
            )}
            <span>
              {engineStatus.libreoffice_available
                ? t.docs2pdf.libreReady(
                    engineStatus.version_text || engineStatus.executable_path || "soffice",
                  )
                : t.docs2pdf.libreMissing}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void checkEngine()}
            className="knit-control-sm flex shrink-0 items-center gap-1 rounded-[4px] border border-current px-2.5 text-xs font-semibold"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t.docs2pdf.rescanBtn}
          </button>
        </div>
      )}

      <ErrorBanner message={errorMsg} />

      {missingLinks.length > 0 && (
        <div
          data-testid="docs2pdf-missing-links-warning"
          className="flex items-center gap-2 rounded-[4px] border border-[#FFC107] bg-[#FFF8E1] px-3.5 py-2 text-sm text-[#856404]"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-[#D39E00]" />
          <span className="font-mono-code text-xs break-all">
            {t.docs2pdf.missingLinksWarning(missingLinks.length, missingLinks.slice(0, 3))}
          </span>
        </div>
      )}

      {isPreviewableDoc && !isEditableText ? (
        <div
          data-testid="docs2pdf-no-editor-split-layout"
          className="grid grid-cols-1 gap-4 min-[1200px]:grid-cols-12 min-[1200px]:items-start"
        >
          <div
            data-testid="docs2pdf-no-editor-controls-col"
            className="order-1 space-y-4 min-[1200px]:order-2 min-[1200px]:col-span-5"
          >
            {controlsCluster}
          </div>
          <div
            data-testid="docs2pdf-no-editor-preview-col"
            className="order-2 min-[1200px]:order-1 min-[1200px]:col-span-7"
          >
            {workbenchNode}
          </div>
        </div>
      ) : (
        <>
          {controlsCluster}
          {workbenchNode}
        </>
      )}

      <ExportConflictModal
        conflictPaths={pendingConflict?.conflicts ?? []}
        isLockedByActiveJob={pendingConflict?.lockedByActiveJob}
        onResolve={(c) => void handleConflictResolution(c)}
      />

      <ImportFeedbackToast toast={importToast} />
    </div>
  );
};
