/**
 * Shortens a filesystem path by replacing the leading home directory with `~`.
 */
export function formatHomePath(fullPath: string, homeDir?: string | null): string {
  const normalizedHome = homeDir?.trim().replace(/[\\/]+$/, "") ?? "";
  if (normalizedHome) {
    const isWindowsHome = normalizedHome.includes("\\") || /^[A-Za-z]:/.test(normalizedHome);
    const matchesHome = isWindowsHome
      ? fullPath.toLowerCase().startsWith(normalizedHome.toLowerCase())
      : fullPath.startsWith(normalizedHome);
    if (matchesHome) {
      const rest = fullPath.slice(normalizedHome.length);
      if (rest === "" || rest.startsWith("/") || rest.startsWith("\\")) {
        return `~${rest}`;
      }
    }
    return fullPath;
  }

  return fullPath
    .replace(/^\/home\/[^/\\]+(?=[/\\]|$)/, "~")
    .replace(/^\/Users\/[^/\\]+(?=[/\\]|$)/, "~")
    .replace(/^[A-Za-z]:\\Users\\[^/\\]+(?=[/\\]|$)/, "~");
}

/**
 * Splits a display path (with `~` home prefix) into directory prefix and file name
 * so CSS can truncate the directory while keeping the filename intact.
 */
export function splitDisplayPdfPath(
  fullPath: string,
  homeDir?: string | null,
): { dirPart: string; fileName: string; fullDisplay: string } {
  const fullDisplay = formatHomePath(fullPath, homeDir);
  const slashIdx = Math.max(fullDisplay.lastIndexOf("/"), fullDisplay.lastIndexOf("\\"));
  if (slashIdx < 0) {
    return { dirPart: "", fileName: fullDisplay, fullDisplay };
  }
  return {
    dirPart: fullDisplay.slice(0, slashIdx + 1),
    fileName: fullDisplay.slice(slashIdx + 1),
    fullDisplay,
  };
}
