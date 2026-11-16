import React from "react";
import { Archive, Lock, Trash2 } from "lucide-react";
import { Dropzone } from "../components/Dropzone";
import { Select } from "../components/Select";
import { useI18n } from "../i18n";
import {
  checkExportConflicts,
  createArchive,
  formatBytes,
  pickDirectory,
  pickFiles,
  pickSaveFile,
  resolveUniqueExportPath,
} from "../lib/ipc";
import {
  ExportConflictModal,
  type ConflictResolution,
} from "../components/ExportConflictModal";
import { ExportFilenameControl } from "../components/ExportFilenameControl";
import {
  ImportFeedbackToast,
  useImportFeedback,
} from "../components/ImportFeedbackToast";
import { useExportFilenameCheck } from "../lib/exportPath";
import { usePersistentState } from "../lib/storage";
import type {
  ArchiveFormat,
  ArchiveOptions,
  CompressionLevel,
  JobEvent,
  ZipEncryption,
} from "../types/ipc";
import type { DroppedBatch } from "./Image2PdfView";

interface ArchiveViewProps {
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
  defaultExportDir?: string;
}

export const ArchiveView: React.FC<ArchiveViewProps> = ({
  onStartJob,
  onJobEvent,
  onFinishJob,
  busy,
  droppedBatch,
  defaultExportDir = "",
}) => {
  const { t } = useI18n();
  const { toast: importToast, highlighted: importHighlighted, notifyImported } =
    useImportFeedback();

  const [inputs, setInputs] = React.useState<string[]>([]);
  const [format, setFormat] = usePersistentState<ArchiveFormat>("knit.archive.format", "zip");
  const [compression, setCompression] = usePersistentState<CompressionLevel>(
    "knit.archive.compression",
    "normal",
  );
  const [encryptionKind, setEncryptionKind] = usePersistentState<
    "none" | "aes256" | "zip_crypto"
  >("knit.archive.encryptionKind", "none");
  const [password, setPassword] = React.useState("");
  const [includeRootDir, setIncludeRootDir] = usePersistentState<boolean>(
    "knit.archive.includeRootDir",
    true,
  );
  const [ignoreHidden, setIgnoreHidden] = usePersistentState<boolean>(
    "knit.archive.ignoreHidden",
    true,
  );
  const [loadingFolder, setLoadingFolder] = React.useState(false);
  const [exportFilename, setExportFilename] = usePersistentState<string>(
    "knit.archive.exportFilename",
    "archive.zip",
  );
  const [pendingConflict, setPendingConflict] = React.useState<{
    outPath: string;
    conflicts: string[];
  } | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const lastHandledDropSeq = React.useRef<number>(0);

  const extForFormat = React.useCallback((fmt: ArchiveFormat) => {
    switch (fmt) {
      case "zip":
        return "zip";
      case "tar":
        return "tar";
      case "tar_gz":
        return "tar.gz";
      case "tar_zst":
        return "tar.zst";
    }
  }, []);

  const currentExt = extForFormat(format);
  const { effectiveFilename, defaultTargetPath, existsAtDefaultDir } =
    useExportFilenameCheck(
      defaultExportDir,
      exportFilename,
      `archive.${currentExt}`,
      [currentExt],
    );

  // Sync filename extension smoothly when changing archive format
  React.useEffect(() => {
    setExportFilename((prev) => {
      const clean = prev.trim();
      if (!clean) return `archive.${currentExt}`;
      const stripped = clean.replace(/\.(zip|tar\.gz|tar\.zst|tar)$/i, "");
      return `${stripped}.${currentExt}`;
    });
  }, [currentExt, setExportFilename]);

  React.useEffect(() => {
    if (!droppedBatch || droppedBatch.seq === lastHandledDropSeq.current) return;
    lastHandledDropSeq.current = droppedBatch.seq;
    if (droppedBatch.paths.length > 0) {
      setErrorMsg(null);
      setInputs((prev) => Array.from(new Set([...prev, ...droppedBatch.paths])));
      notifyImported(t.common.importSuccessToast(`${droppedBatch.paths.length}`));
    }
  }, [droppedBatch, notifyImported, t.common]);

  const addFiles = async () => {
    setErrorMsg(null);
    try {
      const files = await pickFiles({ title: t.archive.pickFilesDialog, multiple: true });
      if (files.length > 0) {
        setInputs((prev) => Array.from(new Set([...prev, ...files])));
        notifyImported(t.common.importSuccessToast(`${files.length}`));
      }
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const addFolder = async () => {
    setErrorMsg(null);
    setLoadingFolder(true);
    try {
      const dir = await pickDirectory(t.archive.pickFolderDialog);
      if (dir) {
        setInputs((prev) => Array.from(new Set([...prev, dir])));
        notifyImported(
          t.common.importSuccessToast(dir.split(/[\\/]/).pop() ?? dir),
        );
      }
    } catch (e) {
      setErrorMsg(String(e));
    } finally {
      setLoadingFolder(false);
    }
  };

  const executePack = async (outPath: string) => {
    try {
      const encryption: ZipEncryption =
        format !== "zip" || encryptionKind === "none"
          ? { kind: "none" }
          : encryptionKind === "aes256"
            ? { kind: "aes256", password }
            : { kind: "zip_crypto", password };

      const options: ArchiveOptions = { format, compression, encryption };
      const jobId = crypto.randomUUID();
      onStartJob(jobId, t.shell.nav.archive.label);
      const res = await createArchive(
        jobId,
        inputs,
        outPath,
        includeRootDir,
        ignoreHidden,
        options,
        onJobEvent,
      );
      onFinishJob(
        t.shell.nav.archive.label,
        [res.output_path],
        t.archive.doneSummary(
          res.files_packed,
          formatBytes(res.input_bytes),
          formatBytes(res.output_bytes),
        ),
        "success",
      );
    } catch (e) {
      const msg = String(e);
      setErrorMsg(msg);
      onFinishJob(t.shell.nav.archive.label, [], msg, "error");
    }
  };

  const handlePack = async () => {
    if (inputs.length === 0 || busy) return;
    setErrorMsg(null);
    if (format === "zip" && encryptionKind !== "none" && password.trim() === "") {
      setErrorMsg(t.archive.passwordRequiredError);
      return;
    }

    try {
      let outPath: string | null = defaultTargetPath;
      if (!outPath) {
        outPath = await pickSaveFile({
          title: t.archive.saveArchiveDialog,
          defaultPath: effectiveFilename,
        });
      }
      if (!outPath) return;

      if (defaultTargetPath) {
        const conflicts = await checkExportConflicts([outPath]);
        if (conflicts.length > 0) {
          setPendingConflict({ outPath, conflicts });
          return;
        }
      }
      await executePack(outPath);
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const handleConflictResolution = async (choice: ConflictResolution) => {
    const pending = pendingConflict;
    setPendingConflict(null);
    if (!pending || choice === "cancel") return;
    if (choice === "overwrite") {
      await executePack(pending.outPath);
      return;
    }
    const uniquePath = await resolveUniqueExportPath(pending.outPath);
    await executePack(uniquePath);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#212529]">{t.archive.title}</h1>
          <p className="text-sm text-[#6C757D]">{t.archive.subtitle}</p>
        </div>
        <button
          type="button"
          disabled={inputs.length === 0 || busy}
          onClick={() => void handlePack()}
          className="knit-control flex items-center gap-1.5 rounded-[4px] bg-[#007BFF] px-4 text-sm font-semibold text-white hover:bg-[#0069D9] disabled:opacity-50"
        >
          <Archive className="h-4 w-4" />
          {t.archive.packBtn}
        </button>
      </div>

      {errorMsg && (
        <div className="rounded-[4px] border border-[#F5C6CB] bg-[#F8D7DA] px-3.5 py-2.5 text-sm text-[#721C24]">
          {errorMsg}
        </div>
      )}

      <ExportFilenameControl
        value={exportFilename}
        onChange={setExportFilename}
        placeholder={`archive.${currentExt}`}
        defaultExportDir={defaultExportDir}
        existsAtDefaultDir={existsAtDefaultDir}
      />

      <div className="grid grid-cols-1 gap-3.5 rounded-[4px] border border-[#DEE2E6] bg-white p-4 md:grid-cols-4">
        <div>
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.archive.formatLabel}
          </label>
          <Select
            ariaLabel={t.archive.formatLabel}
            value={format}
            onChange={(val) => setFormat(val as ArchiveFormat)}
            className="mt-1 w-full"
            options={[
              { value: "zip", label: ".zip" },
              { value: "tar", label: ".tar" },
              { value: "tar_gz", label: ".tar.gz" },
              { value: "tar_zst", label: ".tar.zst" },
            ]}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.archive.compressionLabel}
          </label>
          <Select
            ariaLabel={t.archive.compressionLabel}
            value={compression}
            onChange={(val) => setCompression(val as CompressionLevel)}
            className="mt-1 w-full"
            options={[
              { value: "store", label: t.archive.compStore },
              { value: "fast", label: t.archive.compFast },
              { value: "normal", label: t.archive.compNormal },
              { value: "best", label: t.archive.compBest },
            ]}
          />
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            <Lock className="mr-1 inline h-3.5 w-3.5" />
            {t.archive.zipPasswordLabel}
          </label>
          <Select
            ariaLabel={t.archive.zipPasswordLabel}
            disabled={format !== "zip"}
            value={format === "zip" ? encryptionKind : "none"}
            onChange={(val) => setEncryptionKind(val as typeof encryptionKind)}
            className="mt-1 w-full"
            options={[
              { value: "none", label: t.archive.encNone },
              { value: "aes256", label: t.archive.encAes256 },
              { value: "zip_crypto", label: t.archive.encZipCrypto },
            ]}
          />
          {format === "zip" && encryptionKind !== "none" && (
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t.archive.passwordPlaceholder}
              className="knit-control mt-1.5 w-full rounded-[4px] border border-[#CED4DA] px-2.5 text-sm"
            />
          )}
        </div>

        <div className="space-y-2.5 pt-1">
          <label className="flex items-center gap-2 text-sm text-[#212529]">
            <input
              type="checkbox"
              checked={includeRootDir}
              onChange={(e) => setIncludeRootDir(e.target.checked)}
            />
            {t.archive.includeRootDir}
          </label>
          <label className="flex items-center gap-2 text-sm text-[#212529]">
            <input
              type="checkbox"
              checked={ignoreHidden}
              onChange={(e) => setIgnoreHidden(e.target.checked)}
            />
            {t.archive.ignoreHidden}
          </label>
        </div>
      </div>

      <Dropzone
        title={t.archive.dropTitle}
        description={t.archive.dropDesc}
        onPickFiles={() => void addFiles()}
        onPickFolder={() => void addFolder()}
        filesLabel={t.archive.addFilesBtn}
        folderLabel={t.archive.addFolderBtn}
        loading={loadingFolder}
      />

      {inputs.length > 0 && (
        <div
          className={`space-y-2 rounded-[4px] border p-3.5 transition-colors duration-300 ${
            importHighlighted
              ? "border-[#28A745] bg-[#D4EDDA]/45"
              : "border-[#DEE2E6] bg-white"
          }`}
        >
          <div className="flex items-center justify-between text-sm font-bold text-[#343A40]">
            <span>{t.archive.inputListLabel(inputs.length)}</span>
            <button
              type="button"
              onClick={() => setInputs([])}
              className="text-xs font-semibold text-[#DC3545] hover:underline"
            >
              {t.common.clearAll}
            </button>
          </div>
          {inputs.map((item) => (
            <div
              key={item}
              className={`flex items-center justify-between rounded-[4px] border px-3 py-2 text-xs transition-colors duration-300 ${
                importHighlighted
                  ? "border-[#A3CFBB] bg-[#E9F7EF]"
                  : "border-[#E9ECEF] bg-[#F8F9FA]"
              }`}
            >
              <span className="font-mono-code truncate">{item}</span>
              <button
                type="button"
                onClick={() => setInputs((prev) => prev.filter((x) => x !== item))}
                className="ml-2 rounded-[4px] p-1 text-[#DC3545] hover:bg-[#F8D7DA]"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <ExportConflictModal
        conflictPaths={pendingConflict?.conflicts ?? []}
        onResolve={(c) => void handleConflictResolution(c)}
      />

      <ImportFeedbackToast toast={importToast} />
    </div>
  );
};
