//! Bộ máy đổi tên hàng loạt với bộ lọc hai lớp (Include/Exclude + Checkbox Preview) và Undo an toàn.

pub mod engine;
pub mod models;
pub mod presets;
pub mod renamer;
pub mod scanner;

pub use engine::{compile_rule, FixedPreset, PrenameEngine};
pub use models::{
    FilterMatcher, FilterPattern, PatternKind, RenameExecutionResult, RenameItem, RenamePlan,
    RenameRule, RenameStatus, ScanFilter, TargetType, UndoEntry, UndoManifest, UserPreset,
};
pub use presets::PresetStore;
pub use renamer::{apply_rename_plan, undo_manifest};
pub use scanner::{build_rename_plan, recompute_collisions, scan_items};
