import React from "react";
import { AlertCircle, BookOpen, CheckCircle2, PackageCheck } from "lucide-react";
import { Dropzone } from "../components/Dropzone";
import { useI18n } from "../i18n";
import {
  formatBytes,
  packMangaStories,
  pickDirectory,
  scanMangaFolder,
} from "../lib/ipc";
import { usePersistentState } from "../lib/storage";
import type {
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
          <select
            value={scanMode}
            onChange={(e) => {
              const m = e.target.value as MangaScanMode;
              setScanMode(m);
              if (rootDir) void runScan(rootDir, m);
            }}
            className="knit-control mt-1 w-full rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-sm"
          >
            <option value="auto">{t.mangaPack.modeAuto}</option>
            <option value="single">{t.mangaPack.modeSingle}</option>
            <option value="library">{t.mangaPack.modeLibrary}</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.mangaPack.imageCompLabel}
          </label>
          <select
            value={imageCompression}
            onChange={(e) => setImageCompression(Number(e.target.value))}
            className="knit-control mt-1 w-full rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-sm"
          >
            <option value={0}>{t.mangaPack.compStore}</option>
            <option value={1}>{t.mangaPack.compFast}</option>
            <option value={6}>{t.mangaPack.compNormal}</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.mangaPack.maxGbLabel}
          </label>
          <input
            type="number"
            min={0}
            step={0.5}
            value={maxGb}
            onChange={(e) => setMaxGb(Math.max(0, Number(e.target.value) || 0))}
            className="knit-control mt-1 w-full rounded-[4px] border border-[#CED4DA] px-2.5 font-mono-code text-xs"
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
                  <div className="font-mono-code text-xs text-[#495057]">
                    {t.mangaPack.chaptersAndPages(st.chapters.length, totalImgs)}
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

                <div className="max-h-44 overflow-y-auto rounded-[4px] border border-[#E9ECEF] bg-[#F8F9FA] p-2">
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                    {st.chapters.map((ch) => (
                      <div
                        key={ch.folder || ch.path}
                        className="flex items-center justify-between rounded-[4px] border border-[#DEE2E6] bg-white px-2.5 py-1.5 text-xs"
                      >
                        <span className="truncate font-medium">
                          {ch.folder || "(Root chapter)"}
                        </span>
                        <span className="ml-2 shrink-0 font-mono-code text-xs text-[#6C757D]">
                          {ch.images.length}p
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
