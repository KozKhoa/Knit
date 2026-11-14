import { Channel, invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type {
  AnimatedImagePolicy,
  ArchiveOptions,
  ArchiveSummary,
  BookmarkNode,
  DocConvertOptions,
  DocConvertResult,
  DocInputKind,
  EngineStatus,
  Image2PdfConfig,
  ImageScanResult,
  JobEvent,
  MangaPackOptions,
  MangaPackSummary,
  MangaScanMode,
  MarkdownPreviewResult,
  PageDraft,
  PdfBuildResult,
  PdfInfo,
  PdfMergeConfig,
  PdfSplitRule,
  RenameExecutionResult,
  RenamePlan,
  RenameRule,
  ScanFilter,
  Story,
  UserPreset,
} from "../types/ipc";

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

type DialogListener = (open: boolean) => void;
const dialogListeners = new Set<DialogListener>();
let activeDialogCount = 0;

function notifyDialogState(delta: number): void {
  activeDialogCount = Math.max(0, activeDialogCount + delta);
  const isOpen = activeDialogCount > 0;
  for (const listener of dialogListeners) {
    listener(isOpen);
  }
}

export function subscribeNativeDialogState(listener: DialogListener): () => void {
  dialogListeners.add(listener);
  listener(activeDialogCount > 0);
  return () => {
    dialogListeners.delete(listener);
  };
}

async function withDialogGuard<T>(fn: () => Promise<T>): Promise<T> {
  notifyDialogState(1);
  try {
    return await fn();
  } finally {
    notifyDialogState(-1);
  }
}

export async function pickFiles(options: {
  title?: string;
  multiple?: boolean;
  filters?: { name: string; extensions: string[] }[];
}): Promise<string[]> {
  if (!isTauriRuntime()) {
    throw new Error("File selection is only available inside the Knit desktop window.");
  }
  return await withDialogGuard(async () => {
    return await invoke<string[]>("dialog_pick_paths", {
      args: {
        title: options.title ?? null,
        multiple: options.multiple ?? true,
        directory: false,
        filters: options.filters ?? [],
      },
    });
  });
}

export async function pickDirectory(title = "Select folder"): Promise<string | null> {
  if (!isTauriRuntime()) {
    throw new Error("Folder selection is only available inside the Knit desktop window.");
  }
  return await withDialogGuard(async () => {
    const picked = await invoke<string[]>("dialog_pick_paths", {
      args: {
        title,
        multiple: false,
        directory: true,
        filters: [],
      },
    });
    return picked[0] ?? null;
  });
}

export async function pickSaveFile(options: {
  title?: string;
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
}): Promise<string | null> {
  if (!isTauriRuntime()) {
    throw new Error("Save dialog is only available inside the Knit desktop window.");
  }
  return await withDialogGuard(async () => {
    return await invoke<string | null>("dialog_save_path", {
      args: {
        title: options.title ?? null,
        defaultPath: options.defaultPath ?? null,
        filters: options.filters ?? [],
      },
    });
  });
}

export async function revealInExplorer(path: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await revealItemInDir(path);
}

export async function cancelActiveJob(jobId: string): Promise<void> {
  await invoke("cancel_job", { jobId });
}

function makeChannel(onEvent?: (ev: JobEvent) => void): Channel<JobEvent> {
  const ch = new Channel<JobEvent>();
  if (onEvent) {
    ch.onmessage = onEvent;
  }
  return ch;
}

// --- Image -> PDF ---
export async function scanImagesForPdf(
  paths: string[],
  isFolder: boolean,
  animatedPolicy: AnimatedImagePolicy,
): Promise<ImageScanResult> {
  return await invoke("pdf_scan_images", { paths, isFolder, animatedPolicy });
}

export async function renderImageThumbBase64(
  path: string,
  maxWidth = 360,
): Promise<string> {
  return await invoke("render_image_thumb", { path, maxWidth });
}

export async function renderPdfThumbBase64(
  path: string,
  pageIndex: number,
  maxWidth = 300,
): Promise<string> {
  return await invoke("render_pdf_thumb", { path, pageIndex, maxWidth });
}

export async function buildImage2Pdf(
  jobId: string,
  drafts: PageDraft[],
  bookmarks: BookmarkNode[],
  config: Image2PdfConfig,
  onEvent?: (ev: JobEvent) => void,
): Promise<PdfBuildResult> {
  return await invoke("pdf_build_from_images", {
    jobId,
    drafts,
    bookmarks,
    config,
    onEvent: makeChannel(onEvent),
  });
}

// --- PDF Merge / Split ---
export async function inspectPdfFile(path: string): Promise<PdfInfo> {
  return await invoke("pdf_inspect", { path });
}

export async function mergePdfFiles(
  jobId: string,
  config: PdfMergeConfig,
  onEvent?: (ev: JobEvent) => void,
): Promise<PdfBuildResult> {
  return await invoke("pdf_merge", {
    jobId,
    config,
    onEvent: makeChannel(onEvent),
  });
}

export async function splitPdfFile(
  jobId: string,
  inputPath: string,
  outputDir: string,
  stem: string,
  rule: PdfSplitRule,
  onEvent?: (ev: JobEvent) => void,
): Promise<PdfBuildResult> {
  return await invoke("pdf_split", {
    jobId,
    inputPath,
    outputDir,
    stem,
    rule,
    onEvent: makeChannel(onEvent),
  });
}

// --- Document -> PDF ---
export async function getDocsEngineStatus(): Promise<EngineStatus> {
  return await invoke("docs_engine_status");
}

export async function convertDocToPdf(
  jobId: string,
  inputPath: string,
  outputPath: string,
  options: DocConvertOptions,
  onEvent?: (ev: JobEvent) => void,
): Promise<DocConvertResult> {
  return await invoke("docs_convert_to_pdf", {
    jobId,
    inputPath,
    outputPath,
    options,
    onEvent: makeChannel(onEvent),
  });
}

export async function readDocTextFile(path: string): Promise<string> {
  return await invoke("docs_read_text_file", { path });
}

export async function writeDocTextFile(path: string, content: string): Promise<void> {
  await invoke("docs_write_text_file", { path, content });
}

export async function previewDocPdfBytes(params: {
  content?: string | null;
  inputPath?: string | null;
  inputKind: DocInputKind;
  baseDir?: string | null;
  options: DocConvertOptions;
}): Promise<Uint8Array> {
  const buf = await invoke<ArrayBuffer>("docs_preview_pdf_bytes", {
    content: params.content ?? null,
    inputPath: params.inputPath ?? null,
    inputKind: params.inputKind,
    baseDir: params.baseDir ?? null,
    options: params.options,
  });
  return new Uint8Array(buf);
}

export async function previewDocMarkdown(
  content: string,
  inputKind: DocInputKind,
  baseDir: string | null,
  options: DocConvertOptions,
  maxPages = 20,
  maxWidth = 920,
): Promise<MarkdownPreviewResult> {
  return await invoke("docs_preview_markdown", {
    content,
    inputKind,
    baseDir,
    options,
    maxPages,
    maxWidth,
  });
}

export async function convertDocContentToPdf(
  jobId: string,
  content: string,
  inputKind: DocInputKind,
  baseDir: string | null,
  inputPath: string | null,
  outputPath: string,
  options: DocConvertOptions,
  onEvent?: (ev: JobEvent) => void,
): Promise<DocConvertResult> {
  return await invoke("docs_convert_content_to_pdf", {
    jobId,
    content,
    inputKind,
    baseDir,
    inputPath,
    outputPath,
    options,
    onEvent: makeChannel(onEvent),
  });
}

// --- Archive ---
export async function createArchive(
  jobId: string,
  inputs: string[],
  outputPath: string,
  includeRootDir: boolean,
  ignoreHidden: boolean,
  options: ArchiveOptions,
  onEvent?: (ev: JobEvent) => void,
): Promise<ArchiveSummary> {
  return await invoke("archive_pack", {
    jobId,
    inputs,
    outputPath,
    includeRootDir,
    ignoreHidden,
    options,
    onEvent: makeChannel(onEvent),
  });
}

// --- Manga Packager ---
export async function scanMangaFolder(
  root: string,
  mode: MangaScanMode,
): Promise<Story[]> {
  return await invoke("manga_scan", { root, mode });
}

export async function packMangaStories(
  jobId: string,
  stories: Story[],
  outputDir: string,
  options: MangaPackOptions,
  onEvent?: (ev: JobEvent) => void,
): Promise<MangaPackSummary> {
  return await invoke("manga_pack", {
    jobId,
    stories,
    outputDir,
    options,
    onEvent: makeChannel(onEvent),
  });
}

// --- Batch Renamer ---
export async function previewBatchRename(
  roots: string[],
  filter: ScanFilter,
  rule: RenameRule,
): Promise<RenamePlan> {
  return await invoke("renamer_preview", { roots, filter, rule });
}

export async function recomputeRenameCollisions(
  plan: RenamePlan,
): Promise<RenamePlan> {
  return await invoke("renamer_recompute_collisions", { plan });
}

export async function applyBatchRename(
  jobId: string,
  plan: RenamePlan,
  onEvent?: (ev: JobEvent) => void,
): Promise<RenameExecutionResult> {
  return await invoke("renamer_apply", {
    jobId,
    plan,
    onEvent: makeChannel(onEvent),
  });
}

export async function undoLastRename(): Promise<RenameExecutionResult> {
  return await invoke("renamer_undo_last");
}

export async function hasRenameUndo(): Promise<boolean> {
  return await invoke("renamer_has_undo");
}

export async function listRenamePresets(): Promise<UserPreset[]> {
  return await invoke("renamer_list_presets");
}

export async function saveRenamePreset(preset: UserPreset): Promise<UserPreset[]> {
  return await invoke("renamer_save_preset", { preset });
}

export async function deleteRenamePreset(id: string): Promise<UserPreset[]> {
  return await invoke("renamer_delete_preset", { id });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[u]}`;
}
