use std::fs;

use knit_core::NoopReporter;
use knit_renamer::models::FixedPresetKind;
use knit_renamer::{
    apply_rename_plan, build_rename_plan, compile_rule, recompute_collisions, scan_items,
    undo_manifest, FilterPattern, PatternKind, PrenameEngine, PresetStore, RenameRule,
    RenameStatus, ScanFilter, TargetType,
};
use tempfile::tempdir;

#[test]
fn prename_engine_supports_sub_trans_and_chaining() {
    let eng = PrenameEngine::new(r"s/chap[\s_]*(\d+)/Chapter $1/i; y/ /_/").unwrap();
    assert_eq!(eng.apply("chap 05"), "Chapter_05");

    let tr_del = PrenameEngine::new("y/0-9//d").unwrap();
    assert_eq!(tr_del.apply("abc123def"), "abcdef");

    let upper = PrenameEngine::new("tr/a-z/A-Z/").unwrap();
    assert_eq!(upper.apply("hello"), "HELLO");
}

#[test]
fn fixed_presets_match_expected_transforms() {
    let f = compile_rule(&RenameRule::FixedPreset {
        preset: FixedPresetKind::MangaChapter,
    })
    .unwrap();
    assert_eq!(f("Chương 2.5"), "chapter 02.5");

    let clean = compile_rule(&RenameRule::FixedPreset {
        preset: FixedPresetKind::CleanTags,
    })
    .unwrap();
    assert_eq!(clean("[Team] One Piece (Web).jpg"), "One Piece .jpg");

    let ext = compile_rule(&RenameRule::FixedPreset {
        preset: FixedPresetKind::NormalizeExtensions,
    })
    .unwrap();
    assert_eq!(ext("page.JPEG"), "page.jpg");
}

#[test]
fn scan_filter_include_exclude_and_selective_preview() {
    let dir = tempdir().unwrap();
    let root = dir.path();
    fs::write(root.join("page_1.jpg"), b"1").unwrap();
    fs::write(root.join("page_2.jpg"), b"2").unwrap();
    fs::write(root.join("cover.jpg"), b"c").unwrap();
    fs::write(root.join("info.json"), b"{}").unwrap();

    let filter = ScanFilter {
        target_type: TargetType::Files,
        recursive: false,
        max_depth: None,
        ignore_hidden: true,
        include_extensions: vec!["jpg".into()],
        include_patterns: vec![],
        exclude_patterns: vec![FilterPattern {
            kind: PatternKind::Glob,
            pattern: "cover*".into(),
        }],
    };

    let items = scan_items(root, &filter).unwrap();
    let names: Vec<_> = items.iter().map(|i| i.original_name.as_str()).collect();
    assert_eq!(names, vec!["page_1.jpg", "page_2.jpg"]);

    // Cố tình tạo xung đột cả 2 file cùng đổi thành "same.jpg"
    let rule = compile_rule(&RenameRule::FindReplace {
        find: r"page_\d+".into(),
        replace: "same".into(),
        match_case: false,
        use_regex: true,
    })
    .unwrap();
    let mut plan = build_rename_plan(items, |s| rule(s));
    assert_eq!(plan.conflict_count(), 2);

    // Bỏ chọn 1 dòng -> xung đột tự biến mất
    plan.items[1].selected = false;
    recompute_collisions(&mut plan);
    assert_eq!(plan.conflict_count(), 0);
    assert_eq!(plan.selected_pending_count(), 1);

    let undo_file = root.join("undo.json");
    let res = apply_rename_plan(&mut plan, Some(&undo_file), &NoopReporter).unwrap();
    assert_eq!(res.renamed_count, 1);
    assert!(root.join("same.jpg").exists());
    assert!(root.join("page_2.jpg").exists());

    // Hoàn tác lại tên gốc
    let restored = undo_manifest(&undo_file, &NoopReporter).unwrap();
    assert_eq!(restored, 1);
    assert!(root.join("page_1.jpg").exists());
    assert!(!root.join("same.jpg").exists());
}

#[test]
fn bottom_up_folder_and_file_rename_with_undo() {
    let dir = tempdir().unwrap();
    let root = dir.path();
    fs::create_dir_all(root.join("chap 1")).unwrap();
    fs::write(root.join("chap 1/chap 1.jpg"), b"x").unwrap();

    let items = scan_items(
        root,
        &ScanFilter {
            target_type: TargetType::Both,
            recursive: true,
            ..Default::default()
        },
    )
    .unwrap();
    let rule = compile_rule(&RenameRule::FindReplace {
        find: "chap".into(),
        replace: "Chapter".into(),
        match_case: false,
        use_regex: false,
    })
    .unwrap();
    let mut plan = build_rename_plan(items, |s| rule(s));
    assert_eq!(plan.conflict_count(), 0);

    let undo_file = dir.path().join("undo_bu.json");
    let res = apply_rename_plan(&mut plan, Some(&undo_file), &NoopReporter).unwrap();
    assert_eq!(res.renamed_count, 2);
    assert!(root.join("Chapter 1/Chapter 1.jpg").exists());

    let restored = undo_manifest(&undo_file, &NoopReporter).unwrap();
    assert_eq!(restored, 2);
    assert!(root.join("chap 1/chap 1.jpg").exists());
}

#[test]
fn case_only_rename_succeeds() {
    let dir = tempdir().unwrap();
    let root = dir.path();
    fs::write(root.join("chap1.jpg"), b"x").unwrap();

    let items = scan_items(root, &ScanFilter::default()).unwrap();
    let rule = compile_rule(&RenameRule::FixedPreset {
        preset: FixedPresetKind::Uppercase,
    })
    .unwrap();
    let mut plan = build_rename_plan(items, |s| rule(s));
    assert_eq!(plan.conflict_count(), 0);
    assert_eq!(plan.items[0].status, RenameStatus::Pending);

    let res = apply_rename_plan(&mut plan, None, &NoopReporter).unwrap();
    assert_eq!(res.renamed_count, 1);
    assert!(root.join("CHAP1.JPG").exists());
}

#[test]
fn preset_store_crud_roundtrip() {
    let dir = tempdir().unwrap();
    let store = PresetStore::with_path(dir.path().join("presets.json"));
    let saved = store
        .save_preset(
            None,
            "My Preset".into(),
            "Test".into(),
            RenameRule::PerlPrename {
                expression: "s/a/b/g".into(),
            },
        )
        .unwrap();
    let loaded = store.load().unwrap();
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].title, "My Preset");
    assert!(store.delete_preset(&saved.id).unwrap());
    assert!(store.load().unwrap().is_empty());
}
