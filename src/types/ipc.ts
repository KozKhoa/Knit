export type ToolId =
  | "image2pdf"
  | "pdf-ops"
  | "docs2pdf"
  | "archive"
  | "manga-pack"
  | "renamer"
  | "settings";

export type AppFontFamily = "lora" | "afacad" | "roboto" | "system";

export type JobLogLevel = "info" | "warn" | "error";

export interface JobProgress {
  phase: string;
  done: number;
  total: number;
  bytes_done: number;
  bytes_total: number;
  current_item: string;
}

export interface JobLogEntry {
  id: string;
  timestamp: string;
  level: JobLogLevel;
  message: string;
}

export type JobEvent =
  | { kind: "progress"; data: JobProgress }
  | { kind: "log"; level: JobLogLevel; message: string };

export interface JobHistoryItem {
  id: string;
  tool: ToolId;
  title: string;
  outputs: string[];
  timestamp: string;
  status: "success" | "error" | "cancelled";
  summary: string;
}

// --- knit-pdf ---
export type PageSource =
  | { kind: "image_file"; path: string }
  | { kind: "pdf_page"; path: string; page_index: number }
  | { kind: "animated_frame"; path: string; frame_index: number };

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextAnnotation {
  id: string;
  text: string;
  x: number;
  y: number;
  font_size_ratio: number;
  color_hex: string;
}

export interface StrokeAnnotation {
  id: string;
  points: [number, number][];
  stroke_width_ratio: number;
  color_hex: string;
}

export interface AnnotationLayer {
  texts: TextAnnotation[];
  strokes: StrokeAnnotation[];
}

export interface PageDraft {
  id: string;
  source: PageSource;
  rotation_deg: number;
  crop: CropRect | null;
  annotations: AnnotationLayer;
  duration_ms: number | null;
  label: string;
  width_px: number;
  height_px: number;
  file_size_bytes?: number;
}

export interface BookmarkNode {
  title: string;
  target_page_index: number;
  children: BookmarkNode[];
}

export type PageBackground =
  | { kind: "transparent" }
  | { kind: "white" }
  | { kind: "black" }
  | { kind: "custom"; r: number; g: number; b: number };

export type PageLayoutPolicy =
  | { mode: "original_size"; dpi: number }
  | { mode: "fit_a4"; margin_pt: number; background: PageBackground }
  | { mode: "fit_letter"; margin_pt: number; background: PageBackground };

export type AnimatedImagePolicy = "first_frame_only" | "unpack_all_frames";

export interface Image2PdfConfig {
  output_path: string;
  layout: PageLayoutPolicy;
  jpeg_quality: number;
  lossless_passthrough: boolean;
  animated_policy: AnimatedImagePolicy;
  max_mb: number | null;
  max_pages_per_file?: number | null;
}

export interface ImageScanResult {
  pages: PageDraft[];
  bookmarks: BookmarkNode[];
  warnings?: string[];
}

export interface PdfInfo {
  path: string;
  page_count: number;
  file_size_bytes: number;
  bookmarks: BookmarkNode[];
}

export interface PageSelection {
  file_index: number;
  page_index: number;
  rotation_deg: number;
}

export interface PdfMergeConfig {
  inputs: string[];
  selected_pages: PageSelection[] | null;
  output_path: string;
  preserve_bookmarks: boolean;
}

export interface PdfSplitGroup {
  name: string;
  pages: PageSelection[];
}

export type PdfSplitRule =
  | { rule: "page_ranges"; ranges: string }
  | { rule: "every_n_pages"; n: number }
  | { rule: "extract_selected"; page_indices: number[] }
  | { rule: "max_bytes"; max_mb: number }
  | { rule: "custom_groups"; groups: PdfSplitGroup[] };

export interface PdfBuildResult {
  output_files: string[];
  total_pages: number;
  total_bytes: number;
  passthrough_pages: number;
}

// --- knit-docs ---
export type DocInputKind =
  | "markdown"
  | "plain_text"
  | "html"
  | "epub"
  | "docx"
  | "pptx";

export type PageSizePreset = "a4" | "letter" | "a5";
export type PageOrientation = "portrait" | "landscape";
export type PageNumberPosition =
  | "bottom_center"
  | "bottom_right"
  | "bottom_left"
  | "top_center"
  | "top_left"
  | "top_right";
export type PageNumberFormat = "number_only" | "page_of_total" | "page_label";

export interface PageNumberingOptions {
  enabled: boolean;
  start_number: number;
  start_from_page: number;
  position: PageNumberPosition;
  format: PageNumberFormat;
  label_prefix?: string | null;
}

export type DocTheme =
  | "github"
  | "academic"
  | "minimal"
  | "modern"
  | "resume"
  | "vs_code_light"
  | "obsidian";

export type DocFont =
  | "default"
  | "afacad"
  | "roboto"
  | "lora"
  | "libertinus_serif"
  | "new_computer_modern"
  | "dejavu_sans_mono";

export interface DocConvertOptions {
  page_size: PageSizePreset;
  orientation?: PageOrientation;
  margin_mm: number;
  font_size_pt: number;
  line_spacing?: number | null;
  title: string | null;
  include_toc: boolean;
  toc_page?: number;
  page_numbering?: PageNumberingOptions;
  theme: DocTheme;
  font: DocFont;
  mermaid_svgs?: Record<string, string>;
}

export interface AppMetrics {
  cpu_percent: number;
  ram_bytes: number;
  process_count: number;
}

export interface MarkdownPreviewResult {
  page_count: number;
  pages_png_base64: string[];
}

export interface EngineStatus {
  libreoffice_available: boolean;
  executable_path: string | null;
  version_text: string | null;
  checked_paths: string[];
}

export interface DocConvertResult {
  input_path: string;
  output_path: string;
  kind: DocInputKind;
  page_count: number | null;
  bytes_written: number;
  used_external_engine: boolean;
}

// --- knit-archive ---
export type ArchiveFormat = "zip" | "tar" | "tar_gz" | "tar_zst";

export type ZipEncryption =
  | { kind: "none" }
  | { kind: "aes256"; password: string }
  | { kind: "zip_crypto"; password: string };

export type CompressionLevel = "store" | "fast" | "normal" | "best";

export interface ArchiveOptions {
  format: ArchiveFormat;
  compression: CompressionLevel;
  encryption: ZipEncryption;
}

export interface ArchiveSummary {
  output_path: string;
  files_packed: number;
  input_bytes: number;
  output_bytes: number;
}

// --- knit-manga ---
export type MangaScanMode = "auto" | "single" | "library";
export type NodeKind = "chapter" | "volume" | "arc";

export interface NodeRef {
  kind: NodeKind;
  order_index: number;
  title: string;
}

export interface StoryInfo {
  title: string;
  summary: string;
  genres: string[];
  authors: string[];
  other_titles: string[];
  nation: string;
  nation_id: string;
  poster_id: string;
  story_type: string;
  status: string;
}

export interface Chapter {
  chain: NodeRef[];
  folder: string;
  path: string;
  images: string[];
}

export interface Story {
  dir_name: string;
  path: string;
  info: StoryInfo | null;
  info_file: string | null;
  cover: string | null;
  chapters: Chapter[];
  warnings: string[];
}

export interface MangaPackOptions {
  mangament_package_mode: boolean;
  image_compression: number;
  max_gb: number;
}

export interface MangaPackSummary {
  created_files: string[];
  stories_count: number;
  total_files: number;
  total_input_bytes: number;
}

// --- knit-renamer ---
export type TargetType = "files" | "folders" | "both";
export type PatternKind = "glob" | "regex";

export interface FilterPattern {
  kind: PatternKind;
  pattern: string;
}

export interface ScanFilter {
  target_type: TargetType;
  recursive: boolean;
  max_depth: number | null;
  ignore_hidden: boolean;
  include_extensions: string[];
  include_patterns: FilterPattern[];
  exclude_patterns: FilterPattern[];
}

export type FixedPresetKind =
  | "manga_chapter"
  | "manga_volume"
  | "pad2"
  | "pad3"
  | "clean_tags"
  | "clean_whitespace"
  | "normalize_extensions"
  | "lowercase"
  | "uppercase"
  | "titlecase";

export type RenameRule =
  | {
      mode: "find_replace";
      find: string;
      replace: string;
      match_case: boolean;
      use_regex: boolean;
    }
  | { mode: "perl_prename"; expression: string }
  | { mode: "fixed_preset"; preset: FixedPresetKind };

export type RenameStatus =
  | "unchanged"
  | "pending"
  | "conflict"
  | "renamed"
  | "error";

export interface RenameItem {
  id: string;
  original_path: string;
  original_name: string;
  parent_dir: string;
  is_dir: boolean;
  depth: number;
  new_name: string;
  new_path: string;
  selected: boolean;
  status: RenameStatus;
  error_message: string | null;
}

export interface RenamePlan {
  items: RenameItem[];
}

export interface UserPreset {
  id: string;
  title: string;
  description: string;
  rule: RenameRule;
}

export interface RenameExecutionResult {
  renamed_count: number;
  skipped_count: number;
  error_count: number;
  undo_available: boolean;
}
