use std::fs::{self, File};
use std::io::Read;

use knit_core::{CancellationToken, NoopReporter};
use knit_manga::{
    build_csv_bytes, group_by_size, inspect_story, pack_stories, parse_node_folder_name,
    scan_stories, MangaPackOptions, MangaScanMode, NodeKind,
};
use tempfile::tempdir;

#[test]
fn parse_node_names_handles_vietnamese_and_nfd() {
    let p1 = parse_node_folder_name("Vol.2");
    assert!(p1.is_valid);
    assert_eq!(p1.kind, NodeKind::Volume);
    assert_eq!(p1.order_index, Some(2.0));
    assert_eq!(p1.title, "Volume 2");

    // NFD "Chương 10.5"
    let p2 = parse_node_folder_name("Chu\u{031B}\u{01A1}ng 10.5");
    assert!(p2.is_valid);
    assert_eq!(p2.kind, NodeKind::Chapter);
    assert_eq!(p2.order_index, Some(10.5));
    assert_eq!(p2.title, "Chapter 10.5");

    let p3 = parse_node_folder_name("05");
    assert!(p3.is_valid);
    assert_eq!(p3.title, "Chapter 5");

    let p4 = parse_node_folder_name("Random Folder");
    assert!(!p4.is_valid);
}

#[test]
fn inspect_story_reads_bom_info_json_and_blocks_cover_traversal() {
    let dir = tempdir().unwrap();
    let story_dir = dir.path().join("MyManga");
    fs::create_dir_all(story_dir.join("Volume 1/Volume 1/Chapter 2")).unwrap();
    fs::create_dir_all(story_dir.join("Chapter 1")).unwrap();

    // UTF-8 BOM + traversal cover_art
    let info = "\u{feff}{\"title\":\"Truyện Test\",\"author\":[\"Tác giả A\",\"Tác giả B\"],\"genres\":\"Action, Fantasy\",\"cover_art\":\"../../etc/passwd\"}";
    fs::write(story_dir.join("info.json"), info).unwrap();

    fs::write(story_dir.join("Chapter 1/001.jpg"), b"img1").unwrap();
    fs::write(story_dir.join("Chapter 1/002.webp"), b"img2").unwrap();
    fs::write(
        story_dir.join("Volume 1/Volume 1/Chapter 2/001.png"),
        b"img3",
    )
    .unwrap();

    let story = inspect_story(&story_dir, None, None, true);
    assert!(story.cover.is_none()); // traversal bị chặn
    assert_eq!(story.effective_title(), "Truyện Test");
    assert_eq!(story.chapters.len(), 2);

    // Chapter 1 (depth 1) & Volume 1 -> Chapter 2 (depth 2, duplicate Volume 1 bị collapse)
    assert_eq!(story.chapters[0].chain.len(), 1);
    assert_eq!(story.chapters[0].title(), "Chapter 1");
    assert_eq!(story.chapters[1].chain.len(), 2);
    assert_eq!(story.chapters[1].chain[0].title, "Volume 1");
    assert_eq!(story.chapters[1].chain[1].title, "Chapter 2");

    // Kiểm tra CSV right-aligned columns
    let csv = String::from_utf8(build_csv_bytes(&[story]).unwrap()).unwrap();
    let lines: Vec<&str> = csv.lines().collect();
    assert_eq!(
        lines[0],
        "title,other_titles,story_type,story_status,nation,nation_id,poster_id,author,genres,summary,cover_art_path,story_node_title,story_node_type,story_node_order_index,story_node_title,story_node_type,story_node_order_index,story_node_content_order_index,story_node_content_image_path"
    );
    // Row 1 (depth 1 -> 3 ô trống trước node Chapter 1)
    assert!(lines[1].contains(",,,,Chapter 1,chapter,1,1,MyManga/Chapter 1/001.jpg"));
    // Row 3 (depth 2 -> Volume 1 rồi Chapter 2)
    assert!(lines[3].contains(",Volume 1,volume,1,Chapter 2,chapter,2,1,MyManga/Volume 1/Volume 1/Chapter 2/001.png"));
}

#[test]
fn pack_stories_respects_mangament_toggle_and_store_compression() {
    let dir = tempdir().unwrap();
    let lib_dir = dir.path().join("Lib");
    let s1 = lib_dir.join("StoryOne");
    fs::create_dir_all(s1.join("Chapter 1")).unwrap();
    fs::write(s1.join("cover.jpg"), b"coverbytes").unwrap();
    fs::write(s1.join("info.json"), r#"{"title":"Story One"}"#).unwrap();
    fs::write(s1.join("Chapter 1/01.jpg"), b"page1bytes").unwrap();

    let stories = scan_stories(
        &lib_dir,
        MangaScanMode::Auto,
        None,
        0,
        None,
        true,
        &NoopReporter,
    )
    .unwrap();
    assert_eq!(stories.len(), 1);

    // 1) Public mode (không xuất stories.csv)
    let out_cbz = dir.path().join("public.cbz");
    pack_stories(
        &stories,
        &out_cbz,
        &MangaPackOptions {
            mangament_package_mode: false,
            image_compression: 0,
            max_gb: 0.0,
        },
        &CancellationToken::new(),
        &NoopReporter,
    )
    .unwrap();
    let mut zr1 = zip::ZipArchive::new(File::open(&out_cbz).unwrap()).unwrap();
    assert!(zr1.by_name("stories.csv").is_err());
    assert!(zr1.by_name("StoryOne/cover.jpg").is_ok());
    assert!(zr1.by_name("StoryOne/Chapter 1/01.jpg").is_ok());

    // 2) MangamentPackageMode = true (có stories.csv + info.json + STORE cho ảnh)
    let out_zip = dir.path().join("mangament.zip");
    pack_stories(
        &stories,
        &out_zip,
        &MangaPackOptions {
            mangament_package_mode: true,
            image_compression: 0,
            max_gb: 0.0,
        },
        &CancellationToken::new(),
        &NoopReporter,
    )
    .unwrap();
    let mut zr2 = zip::ZipArchive::new(File::open(&out_zip).unwrap()).unwrap();
    {
        let img = zr2.by_name("StoryOne/Chapter 1/01.jpg").unwrap();
        assert_eq!(img.compression(), zip::CompressionMethod::Stored);
    }
    let mut csv_entry = zr2.by_name("stories.csv").unwrap();
    assert_eq!(csv_entry.compression(), zip::CompressionMethod::Deflated);
    let mut csv_str = String::new();
    csv_entry.read_to_string(&mut csv_str).unwrap();
    assert!(csv_str.contains("StoryOne/cover.jpg"));
    assert!(csv_str.contains("StoryOne/Chapter 1/01.jpg"));
}

#[test]
fn group_by_size_never_splits_single_story() {
    assert_eq!(group_by_size(&[600, 300, 200], 500), vec![vec![0], vec![1, 2]]);
    assert_eq!(group_by_size(&[100, 200], 0), vec![vec![0, 1]]);
}

#[test]
fn scan_stories_populates_total_bytes() {
    let dir = tempdir().unwrap();
    let story_dir = dir.path().join("MangaA");
    fs::create_dir_all(story_dir.join("Chapter 1")).unwrap();
    fs::write(story_dir.join("cover.jpg"), vec![1u8; 120]).unwrap();
    fs::write(story_dir.join("Chapter 1/01.jpg"), vec![2u8; 340]).unwrap();
    fs::write(story_dir.join("Chapter 1/02.jpg"), vec![3u8; 240]).unwrap();

    let stories = knit_manga::scan_stories(
        dir.path(),
        knit_manga::MangaScanMode::Auto,
        None,
        0,
        None,
        false,
        &NoopReporter,
    )
    .unwrap();
    assert_eq!(stories.len(), 1);
    assert_eq!(stories[0].total_bytes, 120 + 340 + 240);
}
