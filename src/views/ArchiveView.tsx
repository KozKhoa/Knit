import React from "react";
import { Archive, Lock, Trash2 } from "lucide-react";
import { Dropzone } from "../components/Dropzone";
import { Select } from "../components/Select";
import { useI18n } from "../i18n";
import {
  createArchive,
  formatBytes,
  pickDirectory,
  pickFiles,
  pickSaveFile,
} from "../lib/ipc";
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
}

export const ArchiveView: React.FC<ArchiveViewProps> = ({
  onStartJob,
  onJobEvent,
  onFinishJob,
  busy,
  droppedBatch,
}) => {
  const { t } = useI18n();

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
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const lastHandledDropSeq = React.useRef<number>(0);

  React.useEffect(() => {
    if (!droppedBatch || droppedBatch.seq === lastHandledDropSeq.current) return;
    lastHandledDropSeq.current = droppedBatch.seq;
    if (droppedBatch.paths.length > 0) {
      setErrorMsg(null);
      setInputs((prev) => Array.from(new Set([...prev, ...droppedBatch.paths])));
    }
  }, [droppedBatch]);

  const addFiles = async () => {
    setErrorMsg(null);
    try {
      const files = await pickFiles({ title: t.archive.pickFilesDialog, multiple: true });
      if (files.length > 0) {
        setInputs((prev) => Array.from(new Set([...prev, ...files])));
      }
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const addFolder = async () => {
    setErrorMsg(null);
    try {
      const dir = await pickDirectory(t.archive.pickFolderDialog);
      if (dir) {
        setInputs((prev) => Array.from(new Set([...prev, dir])));
      }
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const extForFormat = (fmt: ArchiveFormat) => {
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
  };

  const handlePack = async () => {
    if (inputs.length === 0 || busy) return;
    setErrorMsg(null);
    if (format === "zip" && encryptionKind !== "none" && password.trim() === "") {
      setErrorMsg(t.archive.passwordRequiredError);
      return;
    }

    try {
      const ext = extForFormat(format);
      const outPath = await pickSaveFile({
        title: t.archive.saveArchiveDialog,
        defaultPath: `archive.${ext}`,
      });
      if (!outPath) return;

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
      />

      {inputs.length > 0 && (
        <div className="space-y-2 rounded-[4px] border border-[#DEE2E6] bg-white p-3.5">
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
              className="flex items-center justify-between rounded-[4px] border border-[#E9ECEF] bg-[#F8F9FA] px-3 py-2 text-xs"
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
    </div>
  );
};
