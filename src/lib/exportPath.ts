import React from "react";
import { checkExportConflicts, isTauriRuntime, resolveUniqueExportPath } from "./ipc";

export function normalizeComparePath(p: string): string {
  return p.replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function findActiveExportConflicts(
  candidatePaths: string[],
  activeExportPaths: readonly string[],
): string[] {
  if (candidatePaths.length === 0 || activeExportPaths.length === 0) return [];
  const activeSet = new Set(activeExportPaths.map(normalizeComparePath));
  return candidatePaths.filter((p) => activeSet.has(normalizeComparePath(p)));
}

export async function resolveUniqueNonActiveExportPath(
  basePath: string,
  activeExportPaths: readonly string[],
): Promise<string> {
  const activeSet = new Set(activeExportPaths.map(normalizeComparePath));
  let candidate = await resolveUniqueExportPath(basePath);
  if (!activeSet.has(normalizeComparePath(candidate))) {
    return candidate;
  }
  const slashIdx = Math.max(basePath.lastIndexOf("/"), basePath.lastIndexOf("\\"));
  const dir = slashIdx >= 0 ? basePath.slice(0, slashIdx + 1) : "";
  const file = slashIdx >= 0 ? basePath.slice(slashIdx + 1) : basePath;
  const dotIdx = file.lastIndexOf(".");
  const stem = dotIdx > 0 ? file.slice(0, dotIdx) : file;
  const ext = dotIdx > 0 ? file.slice(dotIdx) : "";
  for (let n = 1; n < 1000; n++) {
    const attempt = `${dir}${stem}_${n}${ext}`;
    if (activeSet.has(normalizeComparePath(attempt))) continue;
    const diskConflicts = await checkExportConflicts([attempt]);
    if (diskConflicts.length === 0) return attempt;
  }
  candidate = `${dir}${stem}_${Date.now()}${ext}`;
  return candidate;
}

export function joinDirAndFile(dir: string, fileName: string): string {
  const trimmedDir = dir.trim().replace(/[\\/]+$/, "");
  const cleanFile = fileName.trim().replace(/^[/\\]+/, "");
  if (!trimmedDir) return cleanFile;
  const sep = trimmedDir.includes("\\") && !trimmedDir.includes("/") ? "\\" : "/";
  return `${trimmedDir}${sep}${cleanFile}`;
}

export function normalizeOutputFilename(
  raw: string,
  fallbackName: string,
  allowedExts: string[],
): string {
  const trimmed = raw.trim();
  const base = trimmed.length > 0 ? trimmed : fallbackName;
  const sanitized = base.replace(/[<>:"/\\|?*]/g, "_").trim() || fallbackName;
  if (allowedExts.length === 0) return sanitized;
  const lower = sanitized.toLowerCase();
  const matchesAllowed = allowedExts.some((ext) =>
    lower.endsWith(`.${ext.toLowerCase()}`),
  );
  if (matchesAllowed) return sanitized;
  return `${sanitized}.${allowedExts[0]}`;
}

/**
 * Checks in real time whether the configured output filename collides with an
 * existing file inside `defaultExportDir`.
 */
export function useExportFilenameCheck(
  defaultExportDir: string,
  rawFilename: string,
  fallbackName: string,
  allowedExts: string[],
) {
  const effectiveFilename = React.useMemo(
    () => normalizeOutputFilename(rawFilename, fallbackName, allowedExts),
    [rawFilename, fallbackName, allowedExts],
  );

  const defaultTargetPath = React.useMemo(() => {
    const dir = defaultExportDir.trim();
    if (!dir) return null;
    return joinDirAndFile(dir, effectiveFilename);
  }, [defaultExportDir, effectiveFilename]);

  const [existsAtDefaultDir, setExistsAtDefaultDir] = React.useState(false);

  React.useEffect(() => {
    if (!defaultTargetPath || !isTauriRuntime()) {
      setExistsAtDefaultDir(false);
      return;
    }
    let cancelled = false;
    let inFlight = false;

    const runCheck = () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      void checkExportConflicts([defaultTargetPath])
        .then((hits) => {
          if (!cancelled) setExistsAtDefaultDir(hits.length > 0);
        })
        .catch(() => {
          if (!cancelled) setExistsAtDefaultDir(false);
        })
        .finally(() => {
          inFlight = false;
        });
    };

    const initialTimer = window.setTimeout(runCheck, 180);
    const pollTimer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      runCheck();
    }, 1500);
    const onFocus = () => runCheck();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(pollTimer);
      window.removeEventListener("focus", onFocus);
    };
  }, [defaultTargetPath]);

  return {
    effectiveFilename,
    defaultTargetPath,
    existsAtDefaultDir,
  };
}
