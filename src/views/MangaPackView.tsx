import React from "react";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileJson,
  Folder,
  GripHorizontal,
  PackageCheck,
  Save,
  X,
} from "lucide-react";
import { Dropzone } from "../components/Dropzone";
import { NumberInput } from "../components/NumberInput";
import { Select } from "../components/Select";
import { useI18n } from "../i18n";
import {
  formatBytes,
  isTauriRuntime,
  packMangaStories,
  pickDirectory,
  readDocTextFile,
  scanMangaFolder,
  writeDocTextFile,
} from "../lib/ipc";
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

export const MangaPackView: React.FC<MangaPackViewProps> = ({
  onStartJob,
  onJobEvent,
  onFinishJob,
  busy,
  droppedBatch,
}) => {
  const { t } = useI18n();

  const [rootDir, setRootDir] = React.useState<string | null>(null);
  const [scanMode, setScanMode] = usePersistentState<MangaScanMode>("knit.manga.scanMode", "auto");
  const [stories, setStories] = React.useState<Story[]>([]);
  const [mangamentMode, setMangamentMode] = usePersistentState<boolean>(
    "knit.manga.mangamentMode",
    false,
  );
  const [imageCompression, setImageCompression] = usePersistentState<number>(
    "knit.manga.imageCompression",
    0,
  );
  const [maxGb, setMaxGb] = usePersistentState<number>("knit.manga.maxGb", 0);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const lastHandledDropSeq = React.useRef<number>(0);

  const runScan = React.useCallback(async (dir: string, mode: MangaScanMode) => {
    setErrorMsg(null);
    try {
      const found = await scanMangaFolder(dir, mode);
      setStories(found);
    } catch (e) {
      setErrorMsg(String(e));
    }
  }, []);

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

  const handlePack = async () => {
    if (stories.length === 0 || busy) return;
    setErrorMsg(null);
    try {
      const outDir = await pickDirectory(t.mangaPack.pickOutDialog);
      if (!outDir) return;

      const options: MangaPackOptions = {
        mangament_package_mode: mangamentMode,
        image_compression: imageCompression,
        max_gb: maxGb,
      };
      const jobId = crypto.randomUUID();
      onStartJob(jobId, t.shell.nav.mangaPack.label);
      const summary = await packMangaStories(jobId, stories, outDir, options, onJobEvent);
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
      );
    } catch (e) {
      const msg = String(e);
      setErrorMsg(msg);
      onFinishJob(t.shell.nav.mangaPack.label, [], msg, "error");
    }
  };

  const [treeHeightPx, setTreeHeightPx] = usePersistentState<number>(
    "knit.manga.treeHeightPx",
    220,
  );
  const [liveTreeHeightPx, setLiveTreeHeightPx] = React.useState(treeHeightPx);
  const [openInfoStoryPath, setOpenInfoStoryPath] = React.useState<string | null>(null);
  const [infoJsonText, setInfoJsonText] = React.useState<string>("");
  const [infoJsonError, setInfoJsonError] = React.useState<string | null>(null);
  const [infoJsonSavedMsg, setInfoJsonSavedMsg] = React.useState<string | null>(null);
  const [collapsedDirs, setCollapsedDirs] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    setLiveTreeHeightPx(Math.min(680, Math.max(140, treeHeightPx)));
  }, [treeHeightPx]);

  const handleTreeResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = liveTreeHeightPx;
    let latestH = startH;

    const onMove = (ev: PointerEvent) => {
      latestH = Math.min(680, Math.max(140, Math.round(startH + (ev.clientY - startY))));
      setLiveTreeHeightPx(latestH);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setTreeHeightPx(latestH);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const handleToggleInfoEditor = async (st: Story) => {
    if (!st.info_file) return;
    if (openInfoStoryPath === st.path) {
      setOpenInfoStoryPath(null);
      return;
    }
    setInfoJsonError(null);
    setInfoJsonSavedMsg(null);
    setOpenInfoStoryPath(st.path);
    if (isTauriRuntime()) {
      try {
        const raw = await readDocTextFile(st.info_file);
        setInfoJsonText(raw);
      } catch (e) {
        setInfoJsonError(String(e));
      }
    } else if (st.info) {
      setInfoJsonText(JSON.stringify(st.info, null, 2));
    }
  };

  const handleSaveInfoJson = async (infoFilePath: string) => {
    setInfoJsonError(null);
    setInfoJsonSavedMsg(null);
    try {
      JSON.parse(infoJsonText);
    } catch {
      setInfoJsonError(t.mangaPack.invalidJsonError);
      return;
    }
    try {
      if (isTauriRuntime()) {
        await writeDocTextFile(infoFilePath, infoJsonText);
      }
      setInfoJsonSavedMsg(t.mangaPack.savedInfoJson);
      window.setTimeout(() => setInfoJsonSavedMsg(null), 2500);
    } catch (e) {
      setInfoJsonError(String(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#212529]">{t.mangaPack.title}</h1>
          <p className="text-sm text-[#6C757D]">{t.mangaPack.subtitle}</p>
        </div>
        <button
          type="button"
          disabled={stories.length === 0 || busy}
          onClick={() => void handlePack()}
          className="knit-control flex items-center gap-1.5 rounded-[4px] bg-[#007BFF] px-4 text-sm font-semibold text-white hover:bg-[#0069D9] disabled:opacity-50"
        >
          <PackageCheck className="h-4 w-4" />
          {t.mangaPack.packBtn(stories.length)}
        </button>
      </div>

      {errorMsg && (
        <div className="rounded-[4px] border border-[#F5C6CB] bg-[#F8D7DA] px-3.5 py-2.5 text-sm text-[#721C24]">
          {errorMsg}
        </div>
      )}

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
      />

      {stories.length > 0 && (
        <div className="space-y-3">
          {stories.map((st) => {
            const totalImgs = st.chapters.reduce((acc, c) => acc + c.images.length, 0);
            return (
              <div
                key={st.path}
                className="space-y-2 rounded-[4px] border border-[#DEE2E6] bg-white p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
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
                    {st.info_file && (
                      <button
                        type="button"
                        onClick={() => void handleToggleInfoEditor(st)}
                        className={`knit-control-sm inline-flex items-center gap-1 rounded-[4px] border px-2.5 text-xs font-semibold ${
                          openInfoStoryPath === st.path
                            ? "border-[#007BFF] bg-[#E7F1FF] text-[#0056B3]"
                            : "border-[#CED4DA] bg-white text-[#343A40] hover:bg-[#E9ECEF]"
                        }`}
                      >
                        <FileJson className="h-3.5 w-3.5 text-[#007BFF]" />
                        {t.mangaPack.editInfoJsonBtn}
                      </button>
                    )}
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

                <div
                  className={`grid grid-cols-1 gap-3 ${
                    openInfoStoryPath === st.path && st.info_file ? "lg:grid-cols-2" : ""
                  }`}
                >
                  <div>
                    <div
                      style={{ height: `${liveTreeHeightPx}px` }}
                      className="overflow-y-auto rounded-[4px] border border-[#E9ECEF] bg-[#F8F9FA] p-2"
                    >
                      <FolderTree
                        rootName={st.dir_name}
                        chapters={st.chapters}
                        collapsedDirs={collapsedDirs}
                        onToggleDir={(key) =>
                          setCollapsedDirs((prev) => ({ ...prev, [key]: !prev[key] }))
                        }
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

                  {openInfoStoryPath === st.path && st.info_file && (
                    <div className="flex flex-col rounded-[4px] border border-[#CED4DA] bg-white">
                      <div className="flex items-center justify-between border-b border-[#DEE2E6] bg-[#F8F9FA] px-3 py-1.5">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-[#343A40]">
                          <FileJson className="h-3.5 w-3.5 text-[#007BFF]" />
                          <span>{t.mangaPack.infoJsonTitle}</span>
                          {infoJsonSavedMsg && (
                            <span className="rounded bg-[#D4EDDA] px-1.5 py-0.5 text-[11px] font-semibold text-[#155724]">
                              {infoJsonSavedMsg}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void handleSaveInfoJson(st.info_file!)}
                            className="knit-control-sm inline-flex items-center gap-1 rounded-[4px] bg-[#007BFF] px-2.5 text-xs font-semibold text-white hover:bg-[#0069D9]"
                          >
                            <Save className="h-3 w-3" />
                            {t.mangaPack.saveInfoJsonBtn}
                          </button>
                          <button
                            type="button"
                            onClick={() => setOpenInfoStoryPath(null)}
                            aria-label={t.common.close}
                            className="rounded-[4px] p-1 text-[#6C757D] hover:bg-[#E9ECEF]"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      {infoJsonError && (
                        <div className="border-b border-[#F5C6CB] bg-[#F8D7DA] px-3 py-1 text-xs text-[#721C24]">
                          {infoJsonError}
                        </div>
                      )}
                      <textarea
                        value={infoJsonText}
                        onChange={(e) => setInfoJsonText(e.target.value)}
                        spellCheck={false}
                        style={{ height: `${liveTreeHeightPx - 32}px` }}
                        className="w-full resize-none p-2.5 font-mono-code text-xs text-[#212529] focus:outline-none"
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
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
          className={`flex items-center justify-between rounded-[3px] px-1.5 py-1 text-xs ${
            hasChildren ? "cursor-pointer hover:bg-[#E9ECEF]" : ""
          }`}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            {hasChildren ? (
              isCollapsed ? (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#6C757D]" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#6C757D]" />
              )
            ) : (
              <span className="w-3.5 shrink-0" />
            )}
            <Folder className="h-3.5 w-3.5 shrink-0 text-[#007BFF]" />
            <span className="truncate font-medium text-[#212529]">{node.name}</span>
          </div>
          {node.pageCount !== undefined && (
            <span className="ml-2 shrink-0 font-mono-code text-[11px] text-[#6C757D]">
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
