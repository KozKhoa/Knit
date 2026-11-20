pub mod bookmarks;
pub mod imaging;
pub mod models;
pub mod ops;
pub mod packer;

pub use bookmarks::{read_outlines, remap_tree, write_outlines};
pub use imaging::{
    apply_edits, inspect_image_dimensions, rasterize_annotations, render_image_thumbnail,
    render_image_thumbnail_jpeg, render_page_draft_preview_jpeg, scan_image_files,
    scan_image_files_with_reporter, scan_image_folder, scan_image_folder_with_reporter,
    PdfColorSpace, SUPPORTED_IMAGE_EXTS,
};
pub use models::{
    AnimatedImagePolicy, AnnotationLayer, BookmarkNode, CropRect, Image2PdfConfig,
    ImageScanResult, PageBackground, PageDraft, PageLayoutPolicy, PageSelection, PageSource,
    PdfBuildResult, PdfExportMode, PdfInfo, PdfMergeConfig, PdfSplitGroup, PdfSplitRule,
    StrokeAnnotation, TextAnnotation,
};
pub use ops::{
    clear_pdf_reader_cache, inspect_pdf, merge_pdfs, parse_page_ranges,
    render_pdf_bytes_thumbnails, render_pdf_thumbnail, render_pdf_thumbnail_jpeg,
    split_multi_pdf, split_pdf,
};
pub use packer::build_pdf_from_drafts;
