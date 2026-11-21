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
  RunningJobInfo,
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
  const [runningJobs, setRunningJobs] = React.useState<RunningJobInfo[]>([]);
  const runningJobsRef = React.useRef<RunningJobInfo[]>([]);
  runningJobsRef.current = runningJobs;

  React.useEffect(() => {
    void setLogVerbosity(logVerbosity);
  }, [logVerbosity]);

  React.useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--knit-font-sans", FONT_CSS_STACK[appFontFamily] ?? FONT_CSS_STACK.lora);
    const clamped = Math.min(20, Math.max(13, Math.round(appFontSizePx || 16)));
    root.style.setProperty("--knit-app-font-size", `${clamped}px`);
  }, [appFontFamily, appFontSizePx]);
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
    (jobId: string, label: string, outputPaths: string[] = []) => {
      const initialProgress: JobProgress = {
        phase: "start",
        done: 0,
        total: 1,
        bytes_done: 0,
        bytes_total: 0,
        current_item: t.common.startingJob(label),
      };
      setRunningJobs((prev) => [
        ...prev,
        {
          jobId,
          tool: activeToolRef.current,
          label,
          outputPaths,
          progress: initialProgress,
        },
      ]);
      appendLog("info", t.common.startJobLog(label));
    },
    [appendLog, t.common],
  );

  const handleJobEvent = React.useCallback(
    (ev: JobEvent, jobId?: string) => {
      if (ev.kind === "progress") {
        setRunningJobs((prev) => {
          if (prev.length === 0) return prev;
          if (jobId) {
            return prev.map((j) => (j.jobId === jobId ? { ...j, progress: ev.data } : j));
          }
          const lastIdx = prev.length - 1;
          return prev.map((j, idx) => (idx === lastIdx ? { ...j, progress: ev.data } : j));
        });
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
      jobId?: string,
    ) => {
      const matchedJob = jobId
        ? runningJobsRef.current.find((j) => j.jobId === jobId)
        : runningJobsRef.current[runningJobsRef.current.length - 1];
      setRunningJobs((prev) => {
        if (prev.length === 0) return prev;
        if (jobId) return prev.filter((j) => j.jobId !== jobId);
        return prev.slice(0, -1);
      });
      appendLog(status === "error" ? "error" : status === "cancelled" ? "warn" : "info", summary);
      setHistory((prev) => [
        {
          id: crypto.randomUUID(),
          tool: matchedJob?.tool ?? activeToolRef.current,
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

  const handleCancelJob = async (jobId?: string) => {
    const targetId = jobId ?? runningJobsRef.current[runningJobsRef.current.length - 1]?.jobId;
    if (!targetId) return;
    appendLog("warn", t.common.cancellingJobLog);
    try {
      await cancelActiveJob(targetId);
    } catch {
      // ignore if already finished
    }
  };

  const activeExportPaths = React.useMemo(
    () => runningJobs.flatMap((j) => j.outputPaths),
    [runningJobs],
  );

  const sharedProps = {
    onStartJob: handleStartJob,
    onJobEvent: handleJobEvent,
    onFinishJob: handleFinishJob,
    busy: false,
    activeExportPaths,
    defaultExportDir,
  };

  const dropFor = (tool: ToolId): DroppedBatch | null =>
    lastDrop && lastDrop.tool === tool ? { seq: lastDrop.seq, paths: lastDrop.paths } : null;

  return (
    <>
      <WorkbenchShell
        activeTool={activeTool}
        onSelectTool={setActiveTool}
        runningJobs={runningJobs}
        onCancelJob={(jobId) => void handleCancelJob(jobId)}
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
