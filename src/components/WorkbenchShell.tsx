import React from "react";
import {
  Archive,
  BookOpen,
  Cpu,
  FileCode2,
  FileSpreadsheet,
  FolderKanban,
  History,
  Image as ImageIcon,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Terminal,
  Upload,
  XCircle,
} from "lucide-react";
import { useI18n } from "../i18n";
import {
  formatBytes,
  getAppMetrics,
  isTauriRuntime,
  revealInExplorer,
} from "../lib/ipc";
import { usePersistentState } from "../lib/storage";
import type {
  AppMetrics,
  JobHistoryItem,
  JobLogEntry,
  JobProgress,
  ToolId,
} from "../types/ipc";

interface NavMeta {
  id: ToolId;
  key: "image2pdf" | "pdfOps" | "docs2pdf" | "archive" | "mangaPack" | "renamer";
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_META: NavMeta[] = [
  { id: "image2pdf", key: "image2pdf", icon: ImageIcon },
  { id: "pdf-ops", key: "pdfOps", icon: Layers },
  { id: "docs2pdf", key: "docs2pdf", icon: FileCode2 },
  { id: "archive", key: "archive", icon: Archive },
  { id: "manga-pack", key: "mangaPack", icon: BookOpen },
  { id: "renamer", key: "renamer", icon: FolderKanban },
];

interface WorkbenchShellProps {
  activeTool: ToolId;
  onSelectTool: (id: ToolId) => void;
  activeJobId: string | null;
  progress: JobProgress | null;
  onCancelJob: () => void;
  logs: JobLogEntry[];
  onClearLogs: () => void;
  history: JobHistoryItem[];
  nativeDialogOpen?: boolean;
  isDraggingFiles?: boolean;
  children: React.ReactNode;
}

export const WorkbenchShell: React.FC<WorkbenchShellProps> = ({
  activeTool,
  onSelectTool,
  activeJobId,
  progress,
  onCancelJob,
  logs,
  onClearLogs,
  history,
  nativeDialogOpen = false,
  isDraggingFiles = false,
  children,
}) => {
  const { t } = useI18n();
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistentState<boolean>(
    "knit.ui.sidebarCollapsed",
    false,
  );
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [drawerTab, setDrawerTab] = React.useState<"logs" | "history">("logs");
  const [metrics, setMetrics] = React.useState<AppMetrics | null>(null);
  const shellRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await getAppMetrics();
        if (!cancelled) setMetrics(next);
      } catch {
        // Ignore transient metric polling errors
      }
    };
    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  React.useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    if (nativeDialogOpen) {
      el.setAttribute("inert", "");
    } else {
      el.removeAttribute("inert");
    }
  }, [nativeDialogOpen]);

  const pct = React.useMemo(() => {
    if (!progress) return 0;
    if (progress.bytes_total > 0) {
      return Math.min(100, Math.round((progress.bytes_done / progress.bytes_total) * 100));
    }
    if (progress.total > 0) {
      return Math.min(100, Math.round((progress.done / progress.total) * 100));
    }
    return 0;
  }, [progress]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#F8F9FA] text-[#212529]">
      <div
        ref={shellRef}
        aria-hidden={nativeDialogOpen || undefined}
        className="flex h-full w-full overflow-hidden"
      >
        {/* Left Sidebar (Flat Corporate #343A40, collapsible) */}
        <aside
          className={`flex shrink-0 flex-col border-r border-[#2B3035] bg-[#343A40] text-white transition-[width] duration-150 ${
            sidebarCollapsed ? "w-16" : "w-72"
          }`}
        >
          <div
            className={`flex items-center border-b border-[#495057] py-3.5 ${
              sidebarCollapsed ? "flex-col gap-2 px-2" : "justify-between gap-2 px-4"
            }`}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] bg-[#007BFF] text-base font-bold text-white">
                K
              </div>
              {!sidebarCollapsed && (
                <div className="min-w-0">
                  <div className="text-base font-bold tracking-wide">{t.common.appTitle}</div>
                  <div className="truncate text-xs text-[#ADB5BD]">{t.common.appSubtitle}</div>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSidebarCollapsed((c) => !c)}
              title={sidebarCollapsed ? t.shell.expandSidebar : t.shell.collapseSidebar}
              aria-label={sidebarCollapsed ? t.shell.expandSidebar : t.shell.collapseSidebar}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] text-[#ADB5BD] hover:bg-[#495057] hover:text-white"
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto p-2.5">
            {NAV_META.map((item) => {
              const Icon = item.icon;
              const active = item.id === activeTool;
              const copy = t.shell.nav[item.key];
              return (
                <button
                  key={item.id}
                  type="button"
                  title={sidebarCollapsed ? copy.label : undefined}
                  aria-label={copy.label}
                  onClick={() => onSelectTool(item.id)}
                  className={`flex w-full items-start rounded-[4px] transition-colors ${
                    sidebarCollapsed ? "justify-center px-2 py-2.5" : "gap-2.5 px-3 py-2.5 text-left"
                  } ${
                    active
                      ? "bg-[#007BFF] text-white"
                      : "text-[#DEE2E6] hover:bg-[#495057] hover:text-white"
                  }`}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  {!sidebarCollapsed && (
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold leading-snug">
                        {copy.label}
                      </div>
                      <div
                        className={`mt-0.5 truncate text-xs leading-snug ${
                          active ? "text-[#E7F1FF]" : "text-[#ADB5BD]"
                        }`}
                      >
                        {copy.subtitle}
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="space-y-2 border-t border-[#495057] p-2.5">
            {/* Settings Nav Item */}
            <button
              type="button"
              title={sidebarCollapsed ? t.shell.nav.settings.label : undefined}
              aria-label={t.shell.nav.settings.label}
              onClick={() => onSelectTool("settings")}
              className={`flex w-full items-center rounded-[4px] transition-colors ${
                sidebarCollapsed ? "justify-center px-2 py-2" : "gap-2.5 px-3 py-2 text-left"
              } ${
                activeTool === "settings"
                  ? "bg-[#007BFF] text-white"
                  : "text-[#DEE2E6] hover:bg-[#495057] hover:text-white"
              }`}
            >
              <Settings className="h-4 w-4 shrink-0" />
              {!sidebarCollapsed && (
                <span className="truncate text-sm font-semibold">
                  {t.shell.nav.settings.label}
                </span>
              )}
            </button>

            <button
              type="button"
              title={sidebarCollapsed ? t.shell.logsButton : undefined}
              aria-label={t.shell.logsButton}
              onClick={() => {
                setDrawerTab("logs");
                setDrawerOpen((o) => !o || drawerTab !== "logs");
              }}
              className={`flex w-full items-center rounded-[4px] border border-[#495057] bg-[#2B3035] py-1.5 text-sm text-[#DEE2E6] hover:bg-[#495057] ${
                sidebarCollapsed ? "justify-center px-1" : "justify-between px-3"
              }`}
            >
              <span className="flex items-center gap-2">
                <Terminal className="h-4 w-4 shrink-0" />
                {!sidebarCollapsed && t.shell.logsButton}
              </span>
              {!sidebarCollapsed && (
                <span className="rounded-[4px] bg-[#495057] px-1.5 py-0.5 font-mono-code text-xs">
                  {logs.length}
                </span>
              )}
            </button>
            <button
              type="button"
              title={sidebarCollapsed ? t.shell.historyButton : undefined}
              aria-label={t.shell.historyButton}
              onClick={() => {
                setDrawerTab("history");
                setDrawerOpen((o) => !o || drawerTab !== "history");
              }}
              className={`flex w-full items-center rounded-[4px] border border-[#495057] bg-[#2B3035] py-1.5 text-sm text-[#DEE2E6] hover:bg-[#495057] ${
                sidebarCollapsed ? "justify-center px-1" : "justify-between px-3"
              }`}
            >
              <span className="flex items-center gap-2">
                <History className="h-4 w-4 shrink-0" />
                {!sidebarCollapsed && t.shell.historyButton}
              </span>
              {!sidebarCollapsed && (
                <span className="rounded-[4px] bg-[#495057] px-1.5 py-0.5 font-mono-code text-xs">
                  {history.length}
                </span>
              )}
            </button>

            {metrics && (
              <div
                title={t.shell.metricsTooltip(
                  metrics.cpu_percent.toFixed(1),
                  formatBytes(metrics.ram_bytes),
                  metrics.process_count,
                )}
                className={`mt-1 flex items-center rounded-[4px] border border-[#343A40] bg-[#16191D] font-mono-code text-[11px] text-[#ADB5BD] ${
                  sidebarCollapsed
                    ? "flex-col justify-center gap-0.5 px-1 py-1.5 text-[10px]"
                    : "justify-between px-2.5 py-1.5"
                }`}
              >
                <span className="flex items-center gap-1.5 text-[#DEE2E6]">
                  <Cpu className="h-3.5 w-3.5 shrink-0 text-[#4DABF7]" />
                  {!sidebarCollapsed && (
                    <span>CPU {metrics.cpu_percent.toFixed(1)}%</span>
                  )}
                  {sidebarCollapsed && (
                    <span>{metrics.cpu_percent.toFixed(0)}%</span>
                  )}
                </span>
                <span className="text-[#CED4DA]">
                  {sidebarCollapsed
                    ? formatBytes(metrics.ram_bytes).replace(/\s+/g, "")
                    : formatBytes(metrics.ram_bytes)}
                </span>
              </div>
            )}
          </div>
        </aside>

        {/* Main Content Column */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Active Progress Bar Banner */}
          {(activeJobId || progress) && (
            <div className="flex items-center gap-3 border-b border-[#DEE2E6] bg-white px-5 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="truncate font-semibold text-[#343A40]">
                    {progress?.current_item || t.common.processing}
                  </span>
                  <span className="ml-2 shrink-0 font-mono-code text-xs text-[#007BFF]">
                    {pct}% ({progress?.done ?? 0}/{progress?.total ?? 0})
                  </span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-[4px] bg-[#E9ECEF]">
                  <div
                    className="h-full bg-[#007BFF] transition-all duration-150"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              {activeJobId && (
                <button
                  type="button"
                  onClick={onCancelJob}
                  className="flex shrink-0 items-center gap-1.5 rounded-[4px] border border-[#DC3545] bg-white px-3 py-1.5 text-xs font-semibold text-[#DC3545] hover:bg-[#DC3545] hover:text-white"
                >
                  <XCircle className="h-4 w-4" />
                  {t.common.cancelJob}
                </button>
              )}
            </div>
          )}

          {/* Active Tool Canvas */}
          <main className="min-h-0 flex-1 overflow-y-auto p-5">{children}</main>

          {/* Bottom Log / History Drawer */}
          {drawerOpen && (
            <div className="flex h-60 shrink-0 flex-col border-t border-[#DEE2E6] bg-white">
              <div className="flex items-center justify-between border-b border-[#DEE2E6] bg-[#F8F9FA] px-4 py-1.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setDrawerTab("logs")}
                    className={`rounded-[4px] px-2.5 py-1 text-xs font-semibold ${
                      drawerTab === "logs"
                        ? "bg-[#343A40] text-white"
                        : "text-[#6C757D] hover:bg-[#E9ECEF]"
                    }`}
                  >
                    {t.shell.logsTab} ({logs.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawerTab("history")}
                    className={`rounded-[4px] px-2.5 py-1 text-xs font-semibold ${
                      drawerTab === "history"
                        ? "bg-[#343A40] text-white"
                        : "text-[#6C757D] hover:bg-[#E9ECEF]"
                    }`}
                  >
                    {t.shell.historyTab} ({history.length})
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  {drawerTab === "logs" && logs.length > 0 && (
                    <button
                      type="button"
                      onClick={onClearLogs}
                      className="text-xs text-[#6C757D] hover:text-[#212529]"
                    >
                      {t.shell.clearLogs}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    className="text-xs font-semibold text-[#6C757D] hover:text-[#212529]"
                  >
                    {t.common.close}
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3">
                {drawerTab === "logs" ? (
                  logs.length === 0 ? (
                    <div className="py-6 text-center text-sm text-[#6C757D]">
                      {t.shell.emptyLogs}
                    </div>
                  ) : (
                    <div className="space-y-1 font-mono-code text-xs">
                      {logs.map((log) => (
                        <div key={log.id} className="flex items-start gap-2">
                          <span className="shrink-0 text-[#6C757D]">[{log.timestamp}]</span>
                          <span
                            className={`shrink-0 font-semibold uppercase ${
                              log.level === "error"
                                ? "text-[#DC3545]"
                                : log.level === "warn"
                                  ? "text-[#D39E00]"
                                  : "text-[#17A2B8]"
                            }`}
                          >
                            {log.level}
                          </span>
                          <span className="break-all text-[#212529]">{log.message}</span>
                        </div>
                      ))}
                    </div>
                  )
                ) : history.length === 0 ? (
                  <div className="py-6 text-center text-sm text-[#6C757D]">
                    {t.shell.emptyHistory}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {history.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between rounded-[4px] border border-[#DEE2E6] bg-[#F8F9FA] px-3 py-2 text-sm"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <FileSpreadsheet className="h-4 w-4 text-[#007BFF]" />
                            <span className="font-semibold">{item.title}</span>
                            <span
                              className={`rounded-[4px] px-1.5 py-0.5 text-[11px] font-semibold uppercase ${
                                item.status === "success"
                                  ? "bg-[#D4EDDA] text-[#155724]"
                                  : item.status === "cancelled"
                                    ? "bg-[#FFF3CD] text-[#856404]"
                                    : "bg-[#F8D7DA] text-[#721C24]"
                              }`}
                            >
                              {item.status}
                            </span>
                            <span className="font-mono-code text-xs text-[#6C757D]">
                              {item.timestamp}
                            </span>
                          </div>
                          <div className="mt-0.5 truncate text-xs text-[#6C757D]">
                            {item.summary}
                          </div>
                        </div>
                        {item.outputs.length > 0 && (
                          <button
                            type="button"
                            onClick={() => void revealInExplorer(item.outputs[0])}
                            className="ml-3 shrink-0 rounded-[4px] border border-[#CED4DA] bg-white px-2.5 py-1 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
                          >
                            {t.common.openFolder}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* OS File Drag & Drop Overlay */}
      {isDraggingFiles && !nativeDialogOpen && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-[#007BFF]/10 p-8 backdrop-blur-[1px]">
          <div className="flex flex-col items-center rounded-[4px] border-2 border-dashed border-[#007BFF] bg-white px-10 py-8 text-center">
            <Upload className="mb-2 h-8 w-8 text-[#007BFF]" />
            <div className="text-base font-bold text-[#212529]">{t.common.dropzoneOverlayTitle}</div>
            <div className="mt-1 text-sm text-[#6C757D]">{t.common.dropzoneOverlayHint}</div>
          </div>
        </div>
      )}

      {/* Modal Lock Overlay while Native OS Picker / Save Dialog is open */}
      {nativeDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 cursor-wait"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="rounded-[4px] border border-[#CED4DA] bg-white px-5 py-3 text-sm font-semibold text-[#343A40]">
            {t.common.nativeDialogHint}
          </div>
        </div>
      )}
    </div>
  );
};
