import type { StoryInfo } from "../types/ipc";

export interface StoryInfoFormValues {
  title: string;
  description: string;
  author: string;
  genres: string;
  other_titles: string;
  nation: string;
  nation_id: string;
  poster_id: string;
  type: string;
  status: string;
}

export function joinStoryPath(storyDir: string, fileName: string): string {
  const cleanFile = fileName.replace(/^[/\\]+/, "");
  if (storyDir.endsWith("/") || storyDir.endsWith("\\")) {
    return `${storyDir}${cleanFile}`;
  }
  const sep = storyDir.includes("\\") && !storyDir.includes("/") ? "\\" : "/";
  return `${storyDir}${sep}${cleanFile}`;
}

export function splitListInput(raw: string): string[] {
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function createDefaultInfoTemplate(storyDirName: string): Record<string, unknown> {
  return {
    title: storyDirName,
    description: "",
    genres: [],
    author: [],
    other_titles: [],
    nation: "Japan",
    nation_id: "",
    poster_id: "",
    type: "manga",
    status: "ongoing",
  };
}

function pickString(obj: Record<string, unknown>, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string") {
      return val;
    }
  }
  return fallback;
}

function pickStringList(obj: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const val = obj[key];
    if (Array.isArray(val)) {
      return val
        .map((x) => (typeof x === "string" || typeof x === "number" ? String(x).trim() : ""))
        .filter((s) => s.length > 0);
    }
    if (typeof val === "string" && val.trim().length > 0) {
      return splitListInput(val);
    }
  }
  return [];
}

export function jsonObjectToForm(
  obj: Record<string, unknown>,
  fallbackTitle = "",
): StoryInfoFormValues {
  return {
    title: pickString(obj, ["title"], fallbackTitle),
    description: pickString(obj, ["description", "summary"], ""),
    author: pickStringList(obj, ["author", "authors", "author_ids", "authorIds"]).join(", "),
    genres: pickStringList(obj, ["genres", "genre"]).join(", "),
    other_titles: pickStringList(obj, ["other_titles", "other_title", "otherTitles"]).join(", "),
    nation: pickString(obj, ["nation"], ""),
    nation_id: pickString(obj, ["nation_id", "nationId"], ""),
    poster_id: pickString(obj, ["poster_id", "posterId"], ""),
    type: pickString(obj, ["type", "story_type"], "manga") || "manga",
    status: pickString(obj, ["status", "story_status"], "ongoing") || "ongoing",
  };
}

export function applyFormToJsonObject(
  baseObj: Record<string, unknown>,
  form: StoryInfoFormValues,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...baseObj };
  next.title = form.title.trim();
  next.description = form.description;
  next.genres = splitListInput(form.genres);
  next.author = splitListInput(form.author);
  next.other_titles = splitListInput(form.other_titles);
  next.nation = form.nation.trim();
  next.nation_id = form.nation_id.trim();
  next.poster_id = form.poster_id.trim();
  next.type = form.type.trim() || "manga";
  next.status = form.status.trim() || "ongoing";
  return next;
}

export function storyInfoToTemplateObject(info: StoryInfo): Record<string, unknown> {
  return {
    title: info.title,
    description: info.summary,
    genres: info.genres,
    author: info.authors,
    other_titles: info.other_titles,
    nation: info.nation,
    nation_id: info.nation_id,
    poster_id: info.poster_id,
    type: info.story_type || "manga",
    status: info.status || "ongoing",
  };
}

export function jsonObjectToStoryInfo(obj: Record<string, unknown>): StoryInfo {
  return {
    title: pickString(obj, ["title"], "").trim(),
    summary: pickString(obj, ["description", "summary"], ""),
    genres: pickStringList(obj, ["genres", "genre"]),
    authors: pickStringList(obj, ["author", "authors", "author_ids", "authorIds"]),
    other_titles: pickStringList(obj, ["other_titles", "other_title", "otherTitles"]),
    nation: pickString(obj, ["nation"], "").trim(),
    nation_id: pickString(obj, ["nation_id", "nationId"], "").trim(),
    poster_id: pickString(obj, ["poster_id", "posterId"], "").trim(),
    story_type: pickString(obj, ["type", "story_type"], "manga") || "manga",
    status: pickString(obj, ["status", "story_status"], "ongoing") || "ongoing",
  };
}

export function parseInfoJsonObject(
  rawText: string,
): { ok: true; obj: Record<string, unknown> } | { ok: false } {
  try {
    const cleaned = rawText.replace(/^\uFEFF/, "");
    const parsed: unknown = JSON.parse(cleaned);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false };
    }
    return { ok: true, obj: parsed as Record<string, unknown> };
  } catch {
    return { ok: false };
  }
}
