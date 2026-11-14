//! Quét cấu trúc thư mục truyện tranh và đóng gói ZIP/CBZ (tương thích `zip_pack` của MangamentTools).

pub mod csv_builder;
pub mod models;
pub mod naming;
pub mod packer;
pub mod scanner;

pub use csv_builder::{build_csv_bytes, preview_csv};
pub use models::{Chapter, MangaPackOptions, MangaPackSummary, MangaScanMode, NodeKind, NodeRef, Story, StoryInfo};
pub use naming::{fmt_num, parse_node_folder_name, ParsedName};
pub use packer::{default_output_name, group_by_size, pack_stories};
pub use scanner::{inspect_story, looks_like_single_story, scan_stories};
