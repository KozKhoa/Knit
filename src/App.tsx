import React from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  ExportSuccessToast,
  type CompletedExportInfo,
} from "./components/ExportSuccessToast";
import { WorkbenchShell } from "./components/WorkbenchShell";
import { I18nProvider, useI18n } from "./i18n";
import {
  cancelActiveJob,
  isTauriRuntime,
  setLogVerbosity,
  subscribeNativeDialogState,
} from "./lib/ipc";
import { usePersistentState } from "./lib/storage";
import type {
  AppFontFamily,
  JobEvent,
  JobHistoryItem,
  JobLogEntry,
  JobProgress,
  LogVerbosity,
  ToolId,
} from "./types/ipc";
import { ArchiveView } from "./views/ArchiveView";
import { Docs2PdfView } from "./views/Docs2PdfView";
import { Image2PdfView, type DroppedBatch } from "./views/Image2PdfView";
import { MangaPackView } from "./views/MangaPackView";
import { PdfOpsView } from "./views/PdfOpsView";
import { RenamerView } from "./views/RenamerView";
import { SettingsView } from "./views/SettingsView";

const FONT_CSS_STACK: Record<AppFontFamily, string> = {
  lora: '"Lora", Georgia, "Times New Roman", serif',
  afacad: '"Afacad", "Segoe UI", system-ui, sans-serif',
  roboto: '"Roboto", "Segoe UI", system-ui, sans-serif',
  system: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};

interface ActiveToolDrop extends DroppedBatch {
  tool: ToolId;
}

const AppInner: React.FC = () => {
  const { lang, t } = useI18n();
  const [activeTool, setActiveTool] = usePersistentState<ToolId>("knit.activeTool", "image2pdf");
  const [appFontFamily, setAppFontFamily] = usePersistentState<AppFontFamily>(
    "knit.ui.fontFamily",
    "lora",
  );
  const [appFontSizePx, setAppFontSizePx] = usePersistentState<number>(
    "knit.ui.fontSizePx",
    16,
  );
  const [logVerbosity, setLogVerbosityState] = usePersistentState<LogVerbosity>(
    "knit.logs.verbosity",
    "normal",
  );
  const [defaultExportDir, setDefaultExportDir] = usePersistentState<string>(
    "knit.export.defaultDir",
    "",
  );
  const [activeJobId, setActiveJobId] = React.useState<string | null>(null);

  React.useEffect(() => {
    void setLogVerbosity(logVerbosity);
  }, [logVerbosity]);

  React.useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--knit-font-sans", FONT_CSS_STACK[appFontFamily] ?? FONT_CSS_STACK.lora);
    const clamped = Math.min(20, Math.max(13, Math.round(appFontSizePx || 16)));
    root.style.setProperty("--knit-app-font-size", `${clamped}px`);
  }, [appFontFamily, appFontSizePx]);
  const [progress, setProgress] = React.useState<JobProgress | null>(null);
  const [logs, setLogs] = React.useState<JobLogEntry[]>([]);
  const [history, setHistory] = React.useState<JobHistoryItem[]>([]);
  const [nativeDialogOpen, setNativeDialogOpen] = React.useState(false);
  const [isDraggingFiles, setIsDraggingFiles] = React.useState(false);
  const [completedExport, setCompletedExport] = React.useState<CompletedExportInfo | null>(null);
  const [lastDrop, setLastDrop] = React.useState<ActiveToolDrop | null>(null);

  const activeToolRef = React.useRef<ToolId>(activeTool);
  activeToolRef.current = activeTool;
  const nativeDialogOpenRef = React.useRef<boolean>(nativeDialogOpen);
  nativeDialogOpenRef.current = nativeDialogOpen;
  const dropSeqRef = React.useRef(0);

  React.useEffect(() => {
    return subscribeNativeDialogState(setNativeDialogOpen);
  }, []);

  React.useEffect(() => {
    if (!isTauriRuntime()) return;
    let active = true;
    let unlisten: (() => void) | null = null;

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (!active || nativeDialogOpenRef.current) return;
        const payload = event.payload;
        if (payload.type === "enter" || payload.type === "over") {
          setIsDraggingFiles(true);
        } else if (payload.type === "leave") {
          setIsDraggingFiles(false);
        } else if (payload.type === "drop") {
          setIsDraggingFiles(false);
          if (payload.paths.length > 0) {
            dropSeqRef.current += 1;
            setLastDrop({
              tool: activeToolRef.current,
              seq: dropSeqRef.current,
              paths: payload.paths,
            });
          }
        }
      })
      .then((fn) => {
        if (active) {
          unlisten = fn;
        } else {
          fn();
        }
      })
      .catch(() => {});

    return () => {
      active = false;
      if (unlisten) unlisten();
    };
  }, []);

  const nowTime = React.useCallback(
    () => new Date().toLocaleTimeString(lang === "vi" ? "vi-VN" : "en-US", { hour12: false }),
    [lang],
  );

  const appendLog = React.useCallback(
    (level: JobLogEntry["level"], message: string) => {
      setLogs((prev) => [
        ...prev.slice(-800),
        {
          id: crypto.randomUUID(),
          timestamp: nowTime(),
          level,
          message,
        },
      ]);
    },
    [nowTime],
  );

  const handleStartJob = React.useCallback(
    (jobId: string, label: string) => {
      setActiveJobId(jobId);
      setProgress({
        phase: "start",
        done: 0,
        total: 1,
        bytes_done: 0,
        bytes_total: 0,
        current_item: t.common.startingJob(label),
      });
      appendLog("info", t.common.startJobLog(label));
    },
    [appendLog, t.common],
  );

  const handleJobEvent = React.useCallback(
    (ev: JobEvent) => {
      if (ev.kind === "progress") {
        setProgress(ev.data);
      } else {
        appendLog(ev.level, ev.message);
      }
    },
    [appendLog],
  );

  const handleFinishJob = React.useCallback(
    (
      title: string,
      outputs: string[],
      summary: string,
      status: "success" | "error" | "cancelled",
      heading?: string,
    ) => {
      setActiveJobId(null);
      setProgress(null);
      appendLog(status === "error" ? "error" : status === "cancelled" ? "warn" : "info", summary);
      setHistory((prev) => [
        {
          id: crypto.randomUUID(),
          tool: activeToolRef.current,
          title,
          outputs,
          timestamp: nowTime(),
          status,
          summary,
        },
        ...prev.slice(0, 49),
      ]);
      if (status === "success") {
        setCompletedExport({ title, summary, outputs, heading });
      }
    },
    [appendLog, nowTime],
  );

  const handleCancelJob = async () => {
    if (!activeJobId) return;
    appendLog("warn", t.common.cancellingJobLog);
    try {
      await cancelActiveJob(activeJobId);
    } catch {
      // ignore if already finished
    }
  };

  const sharedProps = {
    onStartJob: handleStartJob,
    onJobEvent: handleJobEvent,
    onFinishJob: handleFinishJob,
    busy: activeJobId !== null,
    defaultExportDir,
  };

  const dropFor = (tool: ToolId): DroppedBatch | null =>
    lastDrop && lastDrop.tool === tool ? { seq: lastDrop.seq, paths: lastDrop.paths } : null;

  return (
    <>
      <WorkbenchShell
        activeTool={activeTool}
        onSelectTool={setActiveTool}
        activeJobId={activeJobId}
        progress={progress}
        onCancelJob={() => void handleCancelJob()}
        logs={logs}
        onClearLogs={() => setLogs([])}
        history={history}
        nativeDialogOpen={nativeDialogOpen}
        isDraggingFiles={isDraggingFiles}
      >
        <div className={activeTool === "image2pdf" ? "block" : "hidden"}>
          <Image2PdfView {...sharedProps} droppedBatch={dropFor("image2pdf")} />
        </div>
        <div className={activeTool === "pdf-ops" ? "block" : "hidden"}>
          <PdfOpsView {...sharedProps} droppedBatch={dropFor("pdf-ops")} />
        </div>
        <div className={activeTool === "docs2pdf" ? "block" : "hidden"}>
          <Docs2PdfView {...sharedProps} droppedBatch={dropFor("docs2pdf")} />
        </div>
        <div className={activeTool === "archive" ? "block" : "hidden"}>
          <ArchiveView {...sharedProps} droppedBatch={dropFor("archive")} />
        </div>
        <div className={activeTool === "manga-pack" ? "block" : "hidden"}>
          <MangaPackView {...sharedProps} droppedBatch={dropFor("manga-pack")} />
        </div>
        <div className={activeTool === "renamer" ? "block" : "hidden"}>
          <RenamerView {...sharedProps} droppedBatch={dropFor("renamer")} />
        </div>
        <div className={activeTool === "settings" ? "block" : "hidden"}>
          <SettingsView
            fontFamily={appFontFamily}
            onChangeFontFamily={setAppFontFamily}
            fontSizePx={appFontSizePx}
            onChangeFontSizePx={setAppFontSizePx}
            logVerbosity={logVerbosity}
            onChangeLogVerbosity={setLogVerbosityState}
            defaultExportDir={defaultExportDir}
            onChangeDefaultExportDir={setDefaultExportDir}
          />
        </div>
      </WorkbenchShell>

      <ExportSuccessToast
        result={completedExport}
        onClose={() => setCompletedExport(null)}
      />
    </>
  );
};

export function App() {
  return (
    <I18nProvider>
      <AppInner />
    </I18nProvider>
  );
}

export default App;
