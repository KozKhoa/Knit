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
    SUPPORTED_IMAGE_EXTS,
};
pub use models::{
    AnimatedImagePolicy, AnnotationLayer, BookmarkNode, CropRect, Image2PdfConfig,
    ImageScanResult, PageBackground, PageDraft, PageLayoutPolicy, PageSelection, PageSource,
    PdfBuildResult, PdfInfo, PdfMergeConfig, PdfSplitGroup, PdfSplitRule, StrokeAnnotation,
    TextAnnotation,
};
pub use ops::{
    inspect_pdf, merge_pdfs, parse_page_ranges, render_pdf_bytes_thumbnails,
    render_pdf_thumbnail, split_pdf,
};
pub use packer::build_pdf_from_drafts;
