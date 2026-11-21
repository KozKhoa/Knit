import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import type { Page } from "@playwright/test";

export interface E2eBridgeOptions {
  scanPageCount?: number;
  includeBookmarks?: boolean;
  useFixtureExportDirAsDefault?: boolean;
  missingFileIndices?: number[];
  conflictFiles?: string[];
  slowExportMs?: number;
}

export interface E2eInvocationRecord {
  cmd: string;
  args: Record<string, unknown>;
}

export interface E2eFixtureInfo {
  rootDir: string;
  albumDir: string;
  exportDir: string;
  cacheDir: string;
  files: string[];
}

export interface PdfBookmarkInspection {
  title: string;
  target_page_index: number;
  children: PdfBookmarkInspection[];
}

export interface PdfDiskInspection {
  exists: boolean;
  file_size_bytes: number;
  header_magic: string;
  page_count: number;
  page_dimensions_pt: [number, number][];
  bookmarks: PdfBookmarkInspection[];
}

interface WorkerResponse {
  id: number;
  ok: unknown;
  events: unknown[];
  error: string | null;
}

const WORKER_BIN = path.resolve(
  process.cwd(),
  process.platform === "win32"
    ? "target/debug/examples/e2e_ipc_worker.exe"
    : "target/debug/examples/e2e_ipc_worker",
);

let workerBuilt = false;

function ensureWorkerBinary(): string {
  if (!workerBuilt) {
    execFileSync("cargo", ["build", "-p", "knit-pdf", "--example", "e2e_ipc_worker"], {
      cwd: process.cwd(),
      stdio: "inherit",
    });
    workerBuilt = true;
  }
  return WORKER_BIN;
}

class E2eRustWorker {
  private proc: ChildProcessWithoutNullStreams;
  private rl: readline.Interface;
  private nextId = 1;
  private disposed = false;
  private pending = new Map<
    number,
    { resolve: (resp: WorkerResponse) => void; reject: (err: Error) => void }
  >();

  constructor() {
    const bin = ensureWorkerBinary();
    this.proc = spawn(bin, [], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "inherit"],
    });
    this.rl = readline.createInterface({ input: this.proc.stdout });

    this.rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let parsed: WorkerResponse;
      try {
        parsed = JSON.parse(trimmed) as WorkerResponse;
      } catch (e) {
        return;
      }
      const entry = this.pending.get(parsed.id);
      if (!entry) return;
      this.pending.delete(parsed.id);
      if (parsed.error) {
        entry.reject(new Error(parsed.error));
      } else {
        entry.resolve(parsed);
      }
    });

    this.proc.on("exit", (code) => {
      for (const [, entry] of this.pending) {
        entry.reject(new Error(`e2e_ipc_worker exited unexpectedly (code ${code ?? "null"})`));
      }
      this.pending.clear();
    });
  }

  call<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<{ ok: T; events: unknown[] }> {
    if (this.disposed) {
      return Promise.reject(new Error("e2e_ipc_worker is already disposed"));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (resp) => resolve({ ok: resp.ok as T, events: resp.events ?? [] }),
        reject,
      });
      this.proc.stdin.write(`${JSON.stringify({ id, cmd, args })}\n`);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.rl.close();
    } catch {
      // ignore close errors during teardown
    }
    try {
      this.proc.kill();
    } catch {
      // ignore kill errors during teardown
    }
  }
}

export async function installTauriE2eBridge(
  page: Page,
  options: E2eBridgeOptions = {},
): Promise<{
  pageErrors: string[];
  fixture: E2eFixtureInfo;
  inspectPdfOnDisk: (pdfPath?: string) => Promise<PdfDiskInspection>;
  createConflictFileOnDisk: (fileName?: string) => string;
  deleteImageFileOnDisk: (index: number) => void;
  listCacheFilesOnDisk: () => string[];
  cleanup: () => void;
}> {
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => {
    pageErrors.push(err.message || String(err));
  });

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "knit-e2e-"));
  const worker = new E2eRustWorker();

  const { ok: rawFixture } = await worker.call<Omit<E2eFixtureInfo, "rootDir">>("setup_fixture", {
    rootDir: tempRoot,
    pageCount: options.scanPageCount ?? 12,
    includeBookmarks: options.includeBookmarks ?? true,
  });

  const fixture: E2eFixtureInfo = {
    rootDir: tempRoot,
    albumDir: rawFixture.albumDir,
    exportDir: rawFixture.exportDir,
    cacheDir: rawFixture.cacheDir,
    files: rawFixture.files,
  };

  for (const idx of options.missingFileIndices ?? []) {
    const filePath = fixture.files[idx];
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  for (const name of options.conflictFiles ?? []) {
    const target = path.isAbsolute(name) ? name : path.join(fixture.exportDir, name);
    fs.writeFileSync(target, "existing-conflict");
  }

  const cancelledJobIds = new Set<string>();
  const slowExportMs = options.slowExportMs ?? 0;

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    worker.dispose();
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures on teardown
    }
  };
  page.once("close", cleanup);

  await page.exposeFunction(
    "__KNIT_RUST_INVOKE__",
    async (
      cmd: string,
      args: Record<string, unknown>,
    ): Promise<{
      ok: unknown;
      events: unknown[];
      error: string | null;
      sourceDataUrls?: Record<string, string>;
    }> => {
      try {
        switch (cmd) {
          case "cancel_job": {
            const jobId = String(args.jobId ?? "");
            if (jobId) cancelledJobIds.add(jobId);
            return { ok: null, events: [], error: null };
          }
          case "pdf_scan_images": {
            const res = await worker.call<{
              pages: Array<{ source?: { path?: string } }>;
              bookmarks: unknown[];
              warnings: string[];
            }>("pdf_scan_images", args);
            let sourceDataUrls: Record<string, string> | undefined;
            if (res.ok.pages.length <= 24) {
              sourceDataUrls = {};
              for (const p of res.ok.pages) {
                const imgPath = p.source?.path;
                if (imgPath && !sourceDataUrls[imgPath] && fs.existsSync(imgPath)) {
                  const buf = fs.readFileSync(imgPath);
                  sourceDataUrls[imgPath] = `data:image/jpeg;base64,${buf.toString("base64")}`;
                }
              }
            }
            return { ok: res.ok, events: res.events, error: null, sourceDataUrls };
          }
          case "render_image_thumb_file":
          case "render_page_draft_preview_file": {
            const res = await worker.call<string>(cmd, {
              ...args,
              cacheDir: fixture.cacheDir,
            });
            const jpgPath = res.ok;
            const buf = fs.readFileSync(jpgPath);
            return {
              ok: {
                path: jpgPath,
                dataUrl: `data:image/jpeg;base64,${buf.toString("base64")}`,
              },
              events: res.events,
              error: null,
            };
          }
          case "clear_image_preview_cache": {
            const res = await worker.call(cmd, { cacheDir: fixture.cacheDir });
            return { ok: res.ok, events: res.events, error: null };
          }
          case "pdf_build_from_images": {
            const jobId = String(args.jobId ?? "");
            if (slowExportMs > 0) {
              const startedAt = Date.now();
              while (Date.now() - startedAt < slowExportMs) {
                if (cancelledJobIds.has(jobId)) {
                  return { ok: null, events: [], error: "Job cancelled by user" };
                }
                await new Promise((r) => setTimeout(r, 40));
              }
              if (cancelledJobIds.has(jobId)) {
                return { ok: null, events: [], error: "Job cancelled by user" };
              }
            }
            const res = await worker.call(cmd, args);
            return { ok: res.ok, events: res.events, error: null };
          }
          case "validate_export_directory":
          case "check_missing_files":
          case "check_export_conflicts":
          case "resolve_unique_export_path": {
            const res = await worker.call(cmd, args);
            return { ok: res.ok, events: res.events, error: null };
          }
          default:
            return { ok: null, events: [], error: `Unsupported Rust command: ${cmd}` };
        }
      } catch (e) {
        return { ok: null, events: [], error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  const defaultSavePath = path.join(fixture.exportDir, "output.pdf");
  const initPayload = {
    albumDir: fixture.albumDir,
    files: fixture.files,
    defaultSavePath,
    defaultExportDir: options.useFixtureExportDirAsDefault ? fixture.exportDir : "",
  };

  await page.addInitScript((init: typeof initPayload) => {
    window.localStorage.clear();
    if (init.defaultExportDir) {
      window.localStorage.setItem("knit.export.defaultDir", JSON.stringify(init.defaultExportDir));
    }

    const callbacks = new Map<number, (data: unknown) => void>();
    const invocations: E2eInvocationRecord[] = [];
    const fileDataUrlMap = new Map<string, string>();
    const state = {
      nextSavePath: init.defaultSavePath,
    };

    const registerCallback = (cb?: (data: unknown) => void, once = false): number => {
      const id =
        window.crypto.getRandomValues(new Uint32Array(1))[0] || Math.floor(Math.random() * 1e9);
      callbacks.set(id, (data: unknown) => {
        if (once) callbacks.delete(id);
        if (typeof cb === "function") cb(data);
      });
      return id;
    };

    const unregisterCallback = (id: number) => {
      callbacks.delete(id);
    };

    const runCallback = (id: number, data: unknown) => {
      const fn = callbacks.get(id);
      if (fn) fn(data);
    };

    const extractChannelId = (arg: unknown): number | null => {
      if (typeof arg === "string" && arg.startsWith("__CHANNEL__:")) {
        const parsed = Number.parseInt(arg.slice("__CHANNEL__:".length), 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      if (arg && typeof arg === "object" && "id" in arg && typeof (arg as { id: unknown }).id === "number") {
        return (arg as { id: number }).id;
      }
      return null;
    };

    const sendChannel = (channelArg: unknown, index: number, message: unknown) => {
      const id = extractChannelId(channelArg);
      if (id !== null) runCallback(id, { index, message });
    };

    const endChannel = (channelArg: unknown, index: number) => {
      const id = extractChannelId(channelArg);
      if (id !== null) runCallback(id, { index, end: true });
    };

    const buildFallbackSvgUrl = (label: string) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320" viewBox="0 0 240 320"><rect width="240" height="320" fill="#E7F1FF"/><text x="120" y="164" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#004085">${label.replace(/[<>&"]/g, "")}</text></svg>`;
      return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    };

    const win = window as unknown as Record<string, unknown>;
    const rustInvoke = win.__KNIT_RUST_INVOKE__ as (
      cmd: string,
      args: Record<string, unknown>,
    ) => Promise<{
      ok: unknown;
      events: unknown[];
      error: string | null;
      sourceDataUrls?: Record<string, string>;
    }>;

    win.__KNIT_E2E__ = { state, invocations };
    win.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: (_ev: string, id: number) => unregisterCallback(id),
    };
    win.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { windowLabel: "main", label: "main" },
      },
      transformCallback: registerCallback,
      unregisterCallback,
      runCallback,
      callbacks,
      convertFileSrc: (filePath: string) => {
        const mapped = fileDataUrlMap.get(filePath);
        if (mapped) return mapped;
        const base = String(filePath).split("/").pop() || "thumb";
        return buildFallbackSvgUrl(base);
      },
      invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
        try {
          invocations.push({ cmd, args: JSON.parse(JSON.stringify(args ?? {})) });
        } catch {
          invocations.push({ cmd, args: {} });
        }

        switch (cmd) {
          case "plugin:event|listen":
            return (args.handler as number) ?? 1;
          case "plugin:event|unlisten":
          case "plugin:opener|reveal_item_in_dir":
          case "set_log_verbosity":
            return null;
          case "get_app_metrics":
            return { cpu_percent: 2.5, ram_bytes: 128 * 1024 * 1024, process_count: 3 };
          case "renamer_list_presets":
          case "renamer_save_preset":
          case "renamer_delete_preset":
            return [];
          case "renamer_has_undo":
            return false;
          case "docs_engine_status":
            return {
              libreoffice_available: false,
              executable_path: null,
              version_text: null,
              checked_paths: [],
            };
          case "get_file_size_bytes":
            return 0;
          case "dialog_pick_paths": {
            const pickArgs = (args.args ?? {}) as { directory?: boolean };
            return pickArgs.directory ? [init.albumDir] : init.files;
          }
          case "dialog_save_path":
            return state.nextSavePath;
          case "render_image_thumb":
            return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
          case "pdf_scan_images":
          case "pdf_build_from_images": {
            const onEventChannel = args.onEvent;
            const payload = { ...args };
            delete payload.onEvent;
            const res = await rustInvoke(cmd, payload);
            res.events.forEach((ev, idx) => sendChannel(onEventChannel, idx, ev));
            endChannel(onEventChannel, res.events.length);
            if (res.sourceDataUrls) {
              for (const [p, url] of Object.entries(res.sourceDataUrls)) {
                fileDataUrlMap.set(p, url);
              }
            }
            if (res.error) throw res.error;
            return res.ok;
          }
          case "render_image_thumb_file":
          case "render_page_draft_preview_file": {
            const res = await rustInvoke(cmd, args ?? {});
            if (res.error) throw res.error;
            const thumb = res.ok as { path: string; dataUrl: string };
            fileDataUrlMap.set(thumb.path, thumb.dataUrl);
            return thumb.path;
          }
          case "cancel_job":
          case "validate_export_directory":
          case "check_missing_files":
          case "check_export_conflicts":
          case "resolve_unique_export_path":
          case "clear_image_preview_cache": {
            const res = await rustInvoke(cmd, args ?? {});
            if (res.error) throw res.error;
            return res.ok;
          }
          default:
            return null;
        }
      },
    };
  }, initPayload);

  return {
    pageErrors,
    fixture,
    inspectPdfOnDisk: async (pdfPath?: string) => {
      const target = pdfPath ?? path.join(fixture.exportDir, "output.pdf");
      const { ok } = await worker.call<PdfDiskInspection>("inspect_exported_pdf", { path: target });
      return ok;
    },
    createConflictFileOnDisk: (fileName = "output.pdf") => {
      const target = path.isAbsolute(fileName)
        ? fileName
        : path.join(fixture.exportDir, fileName);
      fs.writeFileSync(target, "existing-conflict");
      return target;
    },
    deleteImageFileOnDisk: (index: number) => {
      const target = fixture.files[index];
      if (target && fs.existsSync(target)) {
        fs.unlinkSync(target);
      }
    },
    listCacheFilesOnDisk: () => {
      if (!fs.existsSync(fixture.cacheDir)) return [];
      return fs.readdirSync(fixture.cacheDir).filter((name) => name.endsWith(".jpg"));
    },
    cleanup,
  };
}
