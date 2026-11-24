import React from "react";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileJson,
  FilePlus2,
  Folder,
  GripHorizontal,
  PackageCheck,
} from "lucide-react";
import { Dropzone } from "../components/Dropzone";
import { ErrorBanner } from "../components/ErrorBanner";
import { ViewHeader } from "../components/ViewHeader";
import {
  ExportConflictModal,
  type ConflictResolution,
} from "../components/ExportConflictModal";
import { ExportFilenameControl } from "../components/ExportFilenameControl";
import {
  ImportFeedbackToast,
  useImportFeedback,
} from "../components/ImportFeedbackToast";
import { MangaInfoModal } from "../components/MangaInfoModal";
import { NumberInput } from "../components/NumberInput";
import { Select } from "../components/Select";
import { useVerticalResize } from "../hooks/useVerticalResize";
import { useI18n } from "../i18n";
import {
  findActiveExportConflicts,
  resolveUniqueNonActiveExportPath,
  useExportFilenameCheck,
} from "../lib/exportPath";
import {
  checkExportConflicts,
  formatBytes,
  isJobCancelledError,
  isTauriRuntime,
  packMangaStories,
  pickDirectory,
  readDocTextFile,
  scanMangaFolder,
  writeDocTextFile,
} from "../lib/ipc";
import {
  createDefaultInfoTemplate,
  joinStoryPath,
  jsonObjectToStoryInfo,
  storyInfoToTemplateObject,
} from "../lib/mangaInfo";
import { estimateMangaPackOutput } from "../lib/sizeEstimate";
import { usePersistentState } from "../lib/storage";
import type {
  Chapter,
  JobEvent,
  MangaPackOptions,
  MangaScanMode,
  Story,
} from "../types/ipc";
import type { DroppedBatch } from "./Image2PdfView";

interface MangaPackViewProps {
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

export const MangaPackView: React.FC<MangaPackViewProps> = ({
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

  const [rootDir, setRootDir] = React.useState<string | null>(null);
  const [scanMode, setScanMode] = usePersistentState<MangaScanMode>("knit.manga.scanMode", "auto");
  const [stories, setStories] = React.useState<Story[]>([]);
  const [exportFilename, setExportFilename] = React.useState<string>("");
  const [pendingConflict, setPendingConflict] = React.useState<{
    outDir: string;
    fileName: string;
    conflicts: string[];
    lockedByActiveJob: boolean;
  } | null>(null);
  const [mangamentMode, setMangamentMode] = usePersistentState<boolean>(
    "knit.manga.mangamentMode",
    false,
  );
  const [imageCompression, setImageCompression] = usePersistentState<number>(
    "knit.manga.imageCompression",
    0,
  );
  const [maxGb, setMaxGb] = usePersistentState<number>("knit.manga.maxGb", 0);
  const [scanningFolder, setScanningFolder] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const lastHandledDropSeq = React.useRef<number>(0);

  const fallbackOutputName = React.useMemo(() => {
    if (stories.length === 1) {
      const clean = stories[0].dir_name.replace(/[<>:"/\\|?*]/g, "_").trim() || "manga";
      return `${clean}.zip`;
    }
    return "manga_batch.zip";
  }, [stories]);

  const { effectiveFilename, existsAtDefaultDir } = useExportFilenameCheck(
    defaultExportDir,
    exportFilename,
    fallbackOutputName,
    ["zip", "cbz"],
  );

  const runScan = React.useCallback(
    async (dir: string, mode: MangaScanMode) => {
      setErrorMsg(null);
      setScanningFolder(true);
      try {
        const found = await scanMangaFolder(dir, mode);
        setStories(found);
        if (found.length === 1) {
          const clean = found[0].dir_name.replace(/[<>:"/\\|?*]/g, "_").trim() || "manga";
          setExportFilename(`${clean}.zip`);
        } else if (found.length > 1) {
          setExportFilename("manga_batch.zip");
        }
        if (found.length > 0) {
          notifyImported(
            t.common.importSuccessToast(
              dir.split(/[\\/]/).pop() ?? `${found.length} stories`,
            ),
          );
        }
      } catch (e) {
        setErrorMsg(String(e));
      } finally {
        setScanningFolder(false);
      }
    },
    [notifyImported, t.common],
  );

  React.useEffect(() => {
    if (!droppedBatch || droppedBatch.seq === lastHandledDropSeq.current) return;
    lastHandledDropSeq.current = droppedBatch.seq;
    const first = droppedBatch.paths[0];
    if (first) {
      setRootDir(first);
      void runScan(first, scanMode);
    }
  }, [droppedBatch, runScan, scanMode]);

  const handlePickRoot = async () => {
    const dir = await pickDirectory(t.mangaPack.pickRootDialog);
    if (!dir) return;
    setRootDir(dir);
    await runScan(dir, scanMode);
  };

  const executePack = async (outDir: string, fileName: string) => {
    const jobId = crypto.randomUUID();
    const sep = outDir.includes("\\") && !outDir.includes("/") ? "\\" : "/";
    const expectedPath = `${outDir.replace(/[\\/]+$/, "")}${sep}${fileName}`;
    const snapStories = [...stories];
    const emitEvent = (ev: JobEvent) => onJobEvent(ev, jobId);

    try {
      const options: MangaPackOptions = {
        mangament_package_mode: mangamentMode,
        image_compression: imageCompression,
        max_gb: maxGb,
      };
      onStartJob(jobId, t.shell.nav.mangaPack.label, [expectedPath]);
      const summary = await packMangaStories(
        jobId,
        snapStories,
        outDir,
        options,
        emitEvent,
        fileName,
      );
      onFinishJob(
        t.shell.nav.mangaPack.label,
        summary.created_files,
        t.mangaPack.doneSummary(
          summary.stories_count,
          summary.total_files,
          formatBytes(summary.total_input_bytes),
          summary.created_files.length,
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
        t.shell.nav.mangaPack.label,
        [],
        msg,
        cancelled ? "cancelled" : "error",
        undefined,
        jobId,
      );
    }
  };

  const handlePack = async () => {
    if (stories.length === 0 || busy) return;
    setErrorMsg(null);
    try {
      const trimmedDefault = defaultExportDir.trim();
      const outDir = trimmedDefault
        ? trimmedDefault
        : await pickDirectory(t.mangaPack.pickOutDialog);
      if (!outDir) return;

      const sep = outDir.includes("\\") && !outDir.includes("/") ? "\\" : "/";
      const targetPath = `${outDir.replace(/[\\/]+$/, "")}${sep}${effectiveFilename}`;
      const activeHits = findActiveExportConflicts([targetPath], activeExportPaths);
      if (activeHits.length > 0) {
        setPendingConflict({
          outDir,
          fileName: effectiveFilename,
          conflicts: activeHits,
          lockedByActiveJob: true,
        });
        return;
      }

      const conflicts = await checkExportConflicts([targetPath]);
      if (conflicts.length > 0) {
        setPendingConflict({
          outDir,
          fileName: effectiveFilename,
          conflicts,
          lockedByActiveJob: false,
        });
        return;
      }

      await executePack(outDir, effectiveFilename);
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const handleConflictResolution = async (choice: ConflictResolution) => {
    const pending = pendingConflict;
    setPendingConflict(null);
    if (!pending || choice === "cancel") return;
    if (choice === "overwrite" && !pending.lockedByActiveJob) {
      await executePack(pending.outDir, pending.fileName);
      return;
    }
    const sep = pending.outDir.includes("\\") && !pending.outDir.includes("/") ? "\\" : "/";
    const candidate = `${pending.outDir.replace(/[\\/]+$/, "")}${sep}${pending.fileName}`;
    const uniquePath = await resolveUniqueNonActiveExportPath(candidate, activeExportPaths);
    const uniqueName = uniquePath.split(/[\\/]/).pop() ?? pending.fileName;
    await executePack(pending.outDir, uniqueName);
  };

  const [treeHeightsByPath, setTreeHeightsByPath] = usePersistentState<Record<string, number>>(
    "knit.manga.treeHeightsByPath",
    {},
  );
  const [modalStoryPath, setModalStoryPath] = React.useState<string | null>(null);
  const [modalInitialJson, setModalInitialJson] = React.useState<string>("");
  const [modalLoading, setModalLoading] = React.useState(false);
  const [modalSaving, setModalSaving] = React.useState(false);
  const [modalError, setModalError] = React.useState<string | null>(null);
  const [savedStoryPath, setSavedStoryPath] = React.useState<string | null>(null);
  const [collapsedDirs, setCollapsedDirs] = React.useState<Record<string, boolean>>({});

  const modalStory = React.useMemo(
    () => (modalStoryPath ? stories.find((s) => s.path === modalStoryPath) ?? null : null),
    [stories, modalStoryPath],
  );

  const handleCommitStoryTreeHeight = React.useCallback(
    (storyPath: string, nextHeight: number) => {
      setTreeHeightsByPath((prev) =>
        prev[storyPath] === nextHeight ? prev : { ...prev, [storyPath]: nextHeight },
      );
    },
    [setTreeHeightsByPath],
  );

  const handleOpenInfoModal = async (st: Story) => {
    setModalError(null);
    setModalStoryPath(st.path);

    if (!st.info_file) {
      const tpl = createDefaultInfoTemplate(st.dir_name);
      setModalInitialJson(JSON.stringify(tpl, null, 2));
      setModalLoading(false);
      return;
    }

    const fullPath = joinStoryPath(st.path, st.info_file);
    if (isTauriRuntime()) {
      setModalLoading(true);
      setModalInitialJson(
        JSON.stringify(
          st.info ? storyInfoToTemplateObject(st.info) : createDefaultInfoTemplate(st.dir_name),
          null,
          2,
        ),
      );
      try {
        const raw = await readDocTextFile(fullPath);
        setModalInitialJson(raw);
      } catch (e) {
        setModalError(String(e));
      } finally {
        setModalLoading(false);
      }
    } else {
      const obj = st.info ? storyInfoToTemplateObject(st.info) : createDefaultInfoTemplate(st.dir_name);
      setModalInitialJson(JSON.stringify(obj, null, 2));
      setModalLoading(false);
    }
  };

  const handleSaveInfoModal = async (jsonText: string, parsedObj: Record<string, unknown>) => {
    if (!modalStory) return;
    const targetFileName = modalStory.info_file || "info.json";
    const fullPath = joinStoryPath(modalStory.path, targetFileName);
    setModalSaving(true);
    setModalError(null);
    try {
      if (isTauriRuntime()) {
        await writeDocTextFile(fullPath, jsonText);
      }
      const nextInfo = jsonObjectToStoryInfo(parsedObj);
      setStories((prev) =>
        prev.map((s) =>
          s.path === modalStory.path
            ? {
                ...s,
                info_file: targetFileName,
                info: nextInfo,
                warnings: s.warnings.filter((w) => !w.includes("info.json")),
              }
            : s,
        ),
      );
      setSavedStoryPath(modalStory.path);
      window.setTimeout(() => {
        setSavedStoryPath((curr) => (curr === modalStory.path ? null : curr));
      }, 2500);
      setModalStoryPath(null);
    } catch (e) {
      setModalError(String(e));
    } finally {
      setModalSaving(false);
    }
  };

  const mangaEstimateText = React.useMemo(() => {
    if (stories.length === 0) return null;
    const est = estimateMangaPackOutput(stories, imageCompression, maxGb);
    if (est.estimatedBytes <= 0) return null;
    return t.common.estimatedOutputSummary(formatBytes(est.estimatedBytes), est.estimatedFiles);
  }, [stories, imageCompression, maxGb, t.common]);

  return (
    <div className="space-y-4">
      <ViewHeader
        title={t.mangaPack.title}
        subtitle={t.mangaPack.subtitle}
        actions={
          <button
            type="button"
            disabled={stories.length === 0 || busy}
            onClick={() => void handlePack()}
            className="knit-control knit-btn-primary flex items-center gap-1.5 px-4 text-sm disabled:opacity-50"
          >
            <PackageCheck className="h-4 w-4" />
            {t.mangaPack.packBtn(stories.length)}
          </button>
        }
      />

      <ErrorBanner message={errorMsg} />

      <div className="grid grid-cols-1 gap-3.5 rounded-[4px] border border-[#DEE2E6] bg-white p-4 md:grid-cols-4">
        <div>
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.mangaPack.scanModeLabel}
          </label>
          <Select
            ariaLabel={t.mangaPack.scanModeLabel}
            value={scanMode}
            onChange={(val) => {
              const m = val as MangaScanMode;
              setScanMode(m);
              if (rootDir) void runScan(rootDir, m);
            }}
            className="mt-1 w-full"
            options={[
              { value: "auto", label: t.mangaPack.modeAuto },
              { value: "single", label: t.mangaPack.modeSingle },
              { value: "library", label: t.mangaPack.modeLibrary },
            ]}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.mangaPack.imageCompLabel}
          </label>
          <Select
            ariaLabel={t.mangaPack.imageCompLabel}
            value={String(imageCompression)}
            onChange={(val) => setImageCompression(Number(val))}
            className="mt-1 w-full"
            options={[
              { value: "0", label: t.mangaPack.compStore },
              { value: "1", label: t.mangaPack.compFast },
              { value: "6", label: t.mangaPack.compNormal },
            ]}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.mangaPack.maxGbLabel}
          </label>
          <NumberInput
            ariaLabel={t.mangaPack.maxGbLabel}
            min={0}
            step={0.5}
            value={maxGb}
            onChange={setMaxGb}
            className="mt-1 w-full"
          />
        </div>

        <div className="flex items-center pt-3">
          <label className="flex items-start gap-2 text-sm text-[#212529]">
            <input
              type="checkbox"
              className="mt-1"
              checked={mangamentMode}
              onChange={(e) => setMangamentMode(e.target.checked)}
            />
            <span>
              <strong>MangamentPackageMode</strong>
              <span className="block text-xs text-[#6C757D]">{t.mangaPack.mangamentDesc}</span>
            </span>
          </label>
        </div>
      </div>

      <Dropzone
        title={t.mangaPack.dropTitle}
        description={t.mangaPack.dropDesc}
        onPickFolder={() => void handlePickRoot()}
        folderLabel={rootDir ? t.mangaPack.changeFolderBtn : t.mangaPack.pickFolderBtn}
        loading={scanningFolder}
      />

      {rootDir && (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 rounded-[4px] border px-3.5 py-2.5 text-sm transition-colors duration-300 ${
            importHighlighted
              ? "border-[#28A745] bg-[#D4EDDA]/50"
              : "border-[#DEE2E6] bg-white"
          }`}
        >
          <div className="flex min-w-0 items-center gap-2">
            <Folder
              className={`h-4 w-4 shrink-0 ${
                importHighlighted ? "text-[#28A745]" : "text-[#007BFF]"
              }`}
            />
            <span className="shrink-0 font-semibold text-[#343A40]">
              {t.mangaPack.activeFolderLabel}
            </span>
            <span className="font-mono-code truncate text-xs text-[#212529]" title={rootDir}>
              {rootDir}
            </span>
          </div>
          <span className="shrink-0 font-mono-code text-xs text-[#6C757D]">
            {stories.length} stories
          </span>
        </div>
      )}

      {rootDir && !scanningFolder && stories.length === 0 && (
        <div className="rounded-[4px] border border-[#DEE2E6] bg-white px-4 py-6 text-center text-sm text-[#6C757D]">
          {t.renamer.emptyMatchTitle}
        </div>
      )}

      {stories.length > 0 && (
        <ExportFilenameControl
          value={exportFilename}
          onChange={setExportFilename}
          placeholder={fallbackOutputName}
          defaultExportDir={defaultExportDir}
          existsAtDefaultDir={existsAtDefaultDir}
          estimateText={mangaEstimateText}
        />
      )}

      {stories.length > 0 && (
        <div className="space-y-3">
          {stories.map((st) => (
            <StoryCard
              key={st.path}
              story={st}
              treeHeightPx={treeHeightsByPath[st.path] ?? 220}
              onCommitTreeHeight={handleCommitStoryTreeHeight}
              isSavedRecently={savedStoryPath === st.path}
              collapsedDirs={collapsedDirs}
              onToggleDir={(key) =>
                setCollapsedDirs((prev) => ({ ...prev, [key]: !prev[key] }))
              }
              onOpenInfoModal={(s) => void handleOpenInfoModal(s)}
            />
          ))}
        </div>
      )}

      {modalStory && (
        <MangaInfoModal
          story={modalStory}
          isNewFile={!modalStory.info_file}
          initialJsonText={modalInitialJson}
          loading={modalLoading}
          errorMsg={modalError}
          saving={modalSaving}
          onSave={handleSaveInfoModal}
          onClose={() => {
            if (!modalSaving) setModalStoryPath(null);
          }}
        />
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

interface StoryCardProps {
  story: Story;
  treeHeightPx: number;
  onCommitTreeHeight: (storyPath: string, nextHeight: number) => void;
  isSavedRecently: boolean;
  collapsedDirs: Record<string, boolean>;
  onToggleDir: (key: string) => void;
  onOpenInfoModal: (story: Story) => void;
}

const StoryCard: React.FC<StoryCardProps> = ({
  story: st,
  treeHeightPx,
  onCommitTreeHeight,
  isSavedRecently,
  collapsedDirs,
  onToggleDir,
  onOpenInfoModal,
}) => {
  const { t } = useI18n();
  const totalImgs = React.useMemo(
    () => st.chapters.reduce((acc, c) => acc + c.images.length, 0),
    [st.chapters],
  );
  const { height: liveTreeHeightPx, handlePointerDown: handleTreeResizeStart } = useVerticalResize({
    value: treeHeightPx,
    min: 140,
    max: 680,
    onCommit: (nextHeight) => onCommitTreeHeight(st.path, nextHeight),
  });

  return (
    <div className="space-y-2 rounded-[4px] border border-[#DEE2E6] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <BookOpen className="h-4 w-4 text-[#007BFF]" />
          <span className="text-base font-bold text-[#212529]">
            {st.info?.title || st.dir_name}
          </span>
          {st.info_file ? (
            <span className="inline-flex items-center gap-1 rounded-[4px] bg-[#D4EDDA] px-2 py-0.5 text-xs text-[#155724]">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {st.info_file}
            </span>
          ) : (
            <span className="rounded-[4px] bg-[#F1F3F5] px-2 py-0.5 text-xs text-[#6C757D]">
              {t.mangaPack.noInfoJson}
            </span>
          )}
          {isSavedRecently && (
            <span className="rounded-[4px] bg-[#D4EDDA] px-2 py-0.5 text-xs font-semibold text-[#155724]">
              {t.mangaPack.savedInfoJson}
            </span>
          )}
          {st.cover && (
            <span className="rounded-[4px] bg-[#E7F1FF] px-2 py-0.5 font-mono-code text-xs text-[#0056B3]">
              cover: {st.cover}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono-code text-xs text-[#495057]">
            {t.mangaPack.chaptersAndPages(st.chapters.length, totalImgs)}
          </span>
          <button
            type="button"
            onClick={() => onOpenInfoModal(st)}
            className="knit-control-sm inline-flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
          >
            {st.info_file ? (
              <FileJson className="h-3.5 w-3.5 text-[#007BFF]" />
            ) : (
              <FilePlus2 className="h-3.5 w-3.5 text-[#007BFF]" />
            )}
            {st.info_file ? t.mangaPack.editInfoJsonBtn : t.mangaPack.addInfoJsonBtn}
          </button>
        </div>
      </div>

      {st.warnings.length > 0 && (
        <div className="space-y-1 rounded-[4px] border border-[#FFEEBA] bg-[#FFF3CD] px-3 py-2 text-sm text-[#856404]">
          {st.warnings.map((w, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      <div>
        <div
          style={{ height: `${liveTreeHeightPx}px` }}
          className="overscroll-contain overflow-y-auto rounded-[4px] border border-[#E9ECEF] bg-[#F8F9FA] p-2"
        >
          <FolderTree
            rootName={st.dir_name}
            chapters={st.chapters}
            collapsedDirs={collapsedDirs}
            onToggleDir={onToggleDir}
          />
        </div>
        <div
          role="separator"
          aria-orientation="horizontal"
          onPointerDown={handleTreeResizeStart}
          title={`${liveTreeHeightPx}px`}
          className="mt-1 flex h-4 cursor-ns-resize select-none items-center justify-center rounded-[4px] border border-dashed border-[#CED4DA] bg-[#F8F9FA] text-[#6C757D] hover:border-[#007BFF] hover:bg-[#E7F1FF] hover:text-[#007BFF]"
        >
          <GripHorizontal className="h-3.5 w-3.5" />
        </div>
      </div>
    </div>
  );
};

interface TreeNode {
  name: string;
  key: string;
  children: TreeNode[];
  pageCount?: number;
}

function buildFolderTree(rootName: string, chapters: Chapter[]): TreeNode {
  const root: TreeNode = { name: rootName, key: rootName, children: [] };
  for (const ch of chapters) {
    const rel = (ch.folder || "").replace(/\\/g, "/").trim();
    const parts = rel ? rel.split("/").filter(Boolean) : ["(Root chapter)"];
    let curr = root;
    let pathSoFar = rootName;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      pathSoFar += "/" + part;
      let child = curr.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, key: pathSoFar, children: [] };
        curr.children.push(child);
      }
      if (i === parts.length - 1) {
        child.pageCount = ch.images.length;
      }
      curr = child;
    }
  }
  return root;
}

const FolderTree: React.FC<{
  rootName: string;
  chapters: Chapter[];
  collapsedDirs: Record<string, boolean>;
  onToggleDir: (key: string) => void;
}> = ({ rootName, chapters, collapsedDirs, onToggleDir }) => {
  const tree = React.useMemo(() => buildFolderTree(rootName, chapters), [rootName, chapters]);

  const renderNode = (node: TreeNode, depth: number) => {
    const hasChildren = node.children.length > 0;
    const isCollapsed = Boolean(collapsedDirs[node.key]);

  return (
      <div key={node.key}>
        <div
          style={{ paddingLeft: `${depth * 14}px` }}
          onClick={() => hasChildren && onToggleDir(node.key)}
          className={`flex items-center justify-between rounded-[3px] px-1.5 py-1 text-base ${
            hasChildren ? "cursor-pointer hover:bg-[#E9ECEF]" : ""
          }`}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            {hasChildren ? (
              isCollapsed ? (
                <ChevronRight className="h-4 w-4 shrink-0 text-[#6C757D]" />
              ) : (
                <ChevronDown className="h-4 w-4 shrink-0 text-[#6C757D]" />
              )
            ) : (
              <span className="w-4 shrink-0" />
            )}
            <Folder className="h-4 w-4 shrink-0 text-[#007BFF]" />
            <span className="truncate font-medium text-[#212529]">{node.name}</span>
          </div>
          {node.pageCount !== undefined && (
            <span className="ml-2 shrink-0 font-mono-code text-base text-[#6C757D]">
              {node.pageCount}p
            </span>
          )}
        </div>
        {hasChildren && !isCollapsed && (
          <div>{node.children.map((c) => renderNode(c, depth + 1))}</div>
        )}
      </div>
    );
  };

  return <div className="space-y-0.5">{renderNode(tree, 0)}</div>;
};
