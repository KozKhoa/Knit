use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
use knit_core::{CancellationToken, NoopReporter};
use knit_pdf::{
    build_pdf_from_drafts, inspect_image_dimensions, inspect_pdf, merge_pdfs, parse_page_ranges,
    remap_tree, render_page_draft_preview_jpeg, render_pdf_thumbnail, scan_image_files,
    scan_image_folder, split_multi_pdf, split_pdf, AnimatedImagePolicy, AnnotationLayer,
    BookmarkNode, CropRect, Image2PdfConfig, PageDraft, PageLayoutPolicy, PageSelection,
    PageSource, PdfExportMode, PdfMergeConfig, PdfSplitGroup, PdfSplitRule, StrokeAnnotation,
    TextAnnotation,
};
use std::io::Cursor;
use tempfile::tempdir;

fn make_sample_png(path: &std::path::Path, w: u32, h: u32, rgba: [u8; 4]) {
    let img = RgbaImage::from_fn(w, h, |_, _| Rgba(rgba));
    DynamicImage::ImageRgba8(img)
        .write_to(&mut std::fs::File::create(path).unwrap(), ImageFormat::Png)
        .unwrap();
}

fn make_sample_jpg(path: &std::path::Path, w: u32, h: u32, rgb: [u8; 3]) {
    let img = image::RgbImage::from_fn(w, h, |_, _| image::Rgb(rgb));
    DynamicImage::ImageRgb8(img)
        .write_to(&mut std::fs::File::create(path).unwrap(), ImageFormat::Jpeg)
        .unwrap();
}

#[test]
fn image2pdf_passthrough_jpg_and_avif_webp_and_bookmarks() {
    let tmp = tempdir().unwrap();
    let root = tmp.path().join("album");
    let ch1 = root.join("Chapter 1");
    let ch2 = root.join("Chapter 2");
    std::fs::create_dir_all(&ch1).unwrap();
    std::fs::create_dir_all(&ch2).unwrap();

    make_sample_jpg(&root.join("cover.jpg"), 200, 300, [240, 200, 180]);
    make_sample_png(&ch1.join("01.png"), 120, 160, [100, 180, 220, 128]); // transparent PNG -> white bg
    make_sample_jpg(&ch2.join("01.jpg"), 180, 240, [40, 120, 90]);

    // Also create a real AVIF image inside Chapter 2
    let avif_rgba = RgbaImage::from_fn(64, 64, |x, y| Rgba([x as u8 * 3, y as u8 * 3, 200, 255]));
    let avif_bytes = oxideav_avif::encode_rgba8(
        64,
        64,
        avif_rgba.as_raw(),
        &oxideav_avif::EncodeOptions::default().with_quality(80),
    )
    .unwrap();
    std::fs::write(ch2.join("02.avif"), avif_bytes).unwrap();

    let scan = scan_image_folder(&root, AnimatedImagePolicy::FirstFrameOnly).unwrap();
    assert_eq!(scan.pages.len(), 4);
    assert_eq!(scan.bookmarks.len(), 3);
    assert_eq!(scan.bookmarks[0].title, "Cover");

    let out_pdf = tmp.path().join("album.pdf");
    let res = build_pdf_from_drafts(
        &scan.pages,
        &scan.bookmarks,
        &Image2PdfConfig {
            output_path: out_pdf.clone(),
            layout: PageLayoutPolicy::OriginalSize { dpi: 72.0 },
            jpeg_quality: 85,
            lossless_passthrough: true,
            animated_policy: AnimatedImagePolicy::FirstFrameOnly,
            export_mode: PdfExportMode::Balanced,
            max_mb: None,
            max_pages_per_file: None,
        },
        &CancellationToken::new(),
        &NoopReporter,
    )
    .unwrap();

    assert_eq!(res.output_files.len(), 1);
    assert_eq!(res.total_pages, 4);
    assert_eq!(res.passthrough_pages, 2); // 2 JPEGs passed through without re-encoding

    let info = inspect_pdf(&out_pdf).unwrap();
    assert_eq!(info.page_count, 4);
    assert_eq!(info.bookmarks.len(), 3);

    // Verify hayro can render a PNG thumbnail of page 1
    let thumb_png = render_pdf_thumbnail(&out_pdf, 1, 100).unwrap();
    let decoded_thumb = image::load_from_memory(&thumb_png).unwrap();
    assert!(decoded_thumb.width() > 0 && decoded_thumb.height() > 0);
}

#[test]
fn non_destructive_crop_rotate_text_and_draw_render_into_pdf() {
    let tmp = tempdir().unwrap();
    let src_img = tmp.path().join("photo.png");
    make_sample_png(&src_img, 400, 300, [255, 255, 255, 255]);
    assert_eq!(inspect_image_dimensions(&src_img).unwrap(), (400, 300));

    let draft = PageDraft {
        id: "p1".into(),
        source: PageSource::ImageFile { path: src_img },
        rotation_deg: 90,
        crop: Some(CropRect {
            x: 0.1,
            y: 0.1,
            width: 0.5,
            height: 0.5,
        }), // cropped 200x150 -> rotated 90deg -> 150x200
        annotations: AnnotationLayer {
            texts: vec![TextAnnotation {
                id: "t1".into(),
                text: "Tiếng Việt UTF-8".into(),
                x: 0.05,
                y: 0.1,
                font_size_ratio: 0.12,
                color_hex: "#007BFF".into(),
            }],
            strokes: vec![StrokeAnnotation {
                id: "s1".into(),
                points: vec![[0.1, 0.5], [0.9, 0.5]],
                stroke_width_ratio: 0.03,
                color_hex: "#DC3545".into(),
            }],
        },
        duration_ms: None,
        label: "photo.png".into(),
        width_px: 400,
        height_px: 300,
        file_size_bytes: 0,
    };

    let out_pdf = tmp.path().join("edited.pdf");
    build_pdf_from_drafts(
        &[draft],
        &[],
        &Image2PdfConfig {
            output_path: out_pdf.clone(),
            layout: PageLayoutPolicy::OriginalSize { dpi: 72.0 },
            jpeg_quality: 90,
            lossless_passthrough: true,
            animated_policy: AnimatedImagePolicy::FirstFrameOnly,
            export_mode: PdfExportMode::Balanced,
            max_mb: None,
            max_pages_per_file: None,
        },
        &CancellationToken::new(),
        &NoopReporter,
    )
    .unwrap();

    // Render with hayro and verify dimensions match cropped + 90° rotated aspect (150x200) and red stroke pixel exists
    let thumb = render_pdf_thumbnail(&out_pdf, 0, 150).unwrap();
    let rendered = image::load_from_memory(&thumb).unwrap().to_rgb8();
    assert_eq!(rendered.width(), 150);
    assert_eq!(rendered.height(), 200);
    let has_red_stroke = rendered.pixels().any(|p| p[0] > 180 && p[1] < 100 && p[2] < 110);
    assert!(has_red_stroke, "expected drawn stroke to appear in PDF");
}

#[test]
fn pdf_merge_and_split_preserve_outlines_and_page_selection() {
    let tmp = tempdir().unwrap();
    let img1 = tmp.path().join("a.jpg");
    let img2 = tmp.path().join("b.jpg");
    make_sample_jpg(&img1, 100, 100, [10, 20, 30]);
    make_sample_jpg(&img2, 100, 100, [200, 30, 40]);

    let pdf_a = tmp.path().join("a.pdf");
    let pdf_b = tmp.path().join("b.pdf");
    let cfg = |p| Image2PdfConfig {
        output_path: p,
        layout: PageLayoutPolicy::FitA4 {
            margin_pt: 20.0,
            background: knit_pdf::PageBackground::default(),
        },
        jpeg_quality: 80,
        lossless_passthrough: true,
        animated_policy: AnimatedImagePolicy::FirstFrameOnly,
        export_mode: PdfExportMode::Balanced,
        max_mb: None,
        max_pages_per_file: None,
    };

    let d1 = PageDraft {
        id: "1".into(),
        source: PageSource::ImageFile { path: img1 },
        rotation_deg: 0,
        crop: None,
        annotations: AnnotationLayer::default(),
        duration_ms: None,
        label: "a".into(),
        width_px: 100,
        height_px: 100,
        file_size_bytes: 0,
    };
    let d2 = PageDraft {
        id: "2".into(),
        source: PageSource::ImageFile { path: img2 },
        rotation_deg: 0,
        crop: None,
        annotations: AnnotationLayer::default(),
        duration_ms: None,
        label: "b".into(),
        width_px: 100,
        height_px: 100,
        file_size_bytes: 0,
    };

    build_pdf_from_drafts(
        &[d1.clone(), d2.clone()],
        &[BookmarkNode {
            title: "Chương Một".into(),
            target_page_index: 0,
            children: vec![BookmarkNode {
                title: "Mục 1.1".into(),
                target_page_index: 1,
                children: vec![],
            }],
        }],
        &cfg(pdf_a.clone()),
        &CancellationToken::new(),
        &NoopReporter,
    )
    .unwrap();

    build_pdf_from_drafts(
        &[d2],
        &[BookmarkNode {
            title: "Chương Hai".into(),
            target_page_index: 0,
            children: vec![],
        }],
        &cfg(pdf_b.clone()),
        &CancellationToken::new(),
        &NoopReporter,
    )
    .unwrap();

    let merged = tmp.path().join("merged.pdf");
    let merge_res = merge_pdfs(
        &PdfMergeConfig {
            inputs: vec![pdf_a.clone(), pdf_b.clone()],
            selected_pages: Some(vec![
                PageSelection { file_index: 0, page_index: 1, rotation_deg: 90 },
                PageSelection { file_index: 1, page_index: 0, rotation_deg: 0 },
                PageSelection { file_index: 0, page_index: 0, rotation_deg: 0 },
            ]),
            output_path: merged.clone(),
            preserve_bookmarks: true,
            custom_bookmarks: None,
        },
        &CancellationToken::new(),
        &NoopReporter,
    )
    .unwrap();
    assert_eq!(merge_res.total_pages, 3);

    let merged_info = inspect_pdf(&merged).unwrap();
    assert_eq!(merged_info.page_count, 3);
    assert_eq!(merged_info.bookmarks[0].title, "Chương Một");
    assert_eq!(merged_info.bookmarks[0].target_page_index, 2); // page 0 of pdf_a moved to index 2!
    assert_eq!(merged_info.bookmarks[1].title, "Chương Hai");
    assert_eq!(merged_info.bookmarks[1].target_page_index, 1);

    let custom_merged = tmp.path().join("merged_custom_bm.pdf");
    merge_pdfs(
        &PdfMergeConfig {
            inputs: vec![pdf_a.clone(), pdf_b.clone()],
            selected_pages: None,
            output_path: custom_merged.clone(),
            preserve_bookmarks: true,
            custom_bookmarks: Some(vec![BookmarkNode {
                title: "Mục lục Tùy chỉnh".into(),
                target_page_index: 1,
                children: vec![],
            }]),
        },
        &CancellationToken::new(),
        &NoopReporter,
    )
    .unwrap();
    let custom_info = inspect_pdf(&custom_merged).unwrap();
    assert_eq!(custom_info.bookmarks.len(), 1);
    assert_eq!(custom_info.bookmarks[0].title, "Mục lục Tùy chỉnh");
    assert_eq!(custom_info.bookmarks[0].target_page_index, 1);

    let split_dir = tmp.path().join("split_out");
    let split_res = split_pdf(
        &merged,
        &split_dir,
        "test",
        &PdfSplitRule::EveryNPages { n: 2 },
        &CancellationToken::new(),
        &NoopReporter,
    )
    .unwrap();
    assert_eq!(split_res.output_files.len(), 2);
    assert_eq!(inspect_pdf(&split_res.output_files[0]).unwrap().page_count, 2);
    assert_eq!(inspect_pdf(&split_res.output_files[1]).unwrap().page_count, 1);

    // Check parse_page_ranges + remap_tree
    assert_eq!(parse_page_ranges("1-2, 3", 3).unwrap(), vec![0, 1, 2]);
    let remapped = remap_tree(&merged_info.bookmarks, 1, 3);
    assert_eq!(remapped.len(), 2);
    assert_eq!(remapped[0].target_page_index, 1); // original 2 - start 1 = 1
    assert_eq!(remapped[1].target_page_index, 0); // original 1 - start 1 = 0
}

#[test]
fn iso_32000_page_bounds_clamp() {
    let huge = knit_pdf::packer::compute_page_box(
        30000,
        10000,
        PageLayoutPolicy::OriginalSize { dpi: 72.0 },
    );
    assert!((huge.0 - 14400.0).abs() < 0.01);
    assert!((huge.1 - 4800.0).abs() < 0.01);

    let tiny = knit_pdf::packer::compute_page_box(
        1,
        2,
        PageLayoutPolicy::OriginalSize { dpi: 72.0 },
    );
    assert!(tiny.0 >= 3.0 && tiny.1 >= 3.0);
}

#[test]
fn animated_gif_unpacks_frames_with_duration() {
    use image::codecs::gif::{GifEncoder, Repeat};
    use image::{Delay, Frame};

    let tmp = tempdir().unwrap();
    let gif_path = tmp.path().join("anim.gif");
    {
        let mut buf = Cursor::new(Vec::new());
        {
            let mut enc = GifEncoder::new(&mut buf);
            enc.set_repeat(Repeat::Infinite).unwrap();
            let f1 = Frame::from_parts(
                RgbaImage::from_pixel(32, 32, Rgba([255, 0, 0, 255])),
                0,
                0,
                Delay::from_numer_denom_ms(120, 1),
            );
            let f2 = Frame::from_parts(
                RgbaImage::from_pixel(32, 32, Rgba([0, 255, 0, 255])),
                0,
                0,
                Delay::from_numer_denom_ms(240, 1),
            );
            enc.encode_frames([f1, f2]).unwrap();
        }
        std::fs::write(&gif_path, buf.into_inner()).unwrap();
    }

    let scan = knit_pdf::scan_image_files(&[gif_path], AnimatedImagePolicy::UnpackAllFrames).unwrap();
    assert_eq!(scan.pages.len(), 2);
    assert_eq!(scan.pages[0].duration_ms, Some(120));
    assert_eq!(scan.pages[1].duration_ms, Some(240));

    let out_pdf = tmp.path().join("anim.pdf");
    build_pdf_from_drafts(
        &scan.pages,
        &[],
        &Image2PdfConfig {
            output_path: out_pdf.clone(),
            layout: PageLayoutPolicy::OriginalSize { dpi: 72.0 },
            jpeg_quality: 85,
            lossless_passthrough: true,
            animated_policy: AnimatedImagePolicy::UnpackAllFrames,
            export_mode: PdfExportMode::Balanced,
            max_mb: None,
            max_pages_per_file: None,
        },
        &CancellationToken::new(),
        &NoopReporter,
    )
    .unwrap();
    assert_eq!(inspect_pdf(&out_pdf).unwrap().page_count, 2);
}

#[test]
fn a4_background_colors_and_padding_render_correctly() {
    use knit_pdf::PageBackground;

    let tmp = tempdir().unwrap();
    let img_path = tmp.path().join("red.png");
    let mut img = RgbaImage::new(100, 100);
    for px in img.pixels_mut() {
        *px = Rgba([220, 40, 40, 255]);
    }
    img.save(&img_path).unwrap();

    let scan = knit_pdf::scan_image_files(&[img_path], AnimatedImagePolicy::FirstFrameOnly).unwrap();
    let black_pdf = tmp.path().join("a4_black.pdf");
    build_pdf_from_drafts(
        &scan.pages,
        &[],
        &Image2PdfConfig {
            output_path: black_pdf.clone(),
            layout: PageLayoutPolicy::FitA4 {
                margin_pt: 56.7,
                background: PageBackground::Black,
            },
            jpeg_quality: 90,
            lossless_passthrough: true,
            animated_policy: AnimatedImagePolicy::FirstFrameOnly,
            export_mode: PdfExportMode::Balanced,
            max_mb: None,
            max_pages_per_file: None,
        },
        &CancellationToken::new(),
        &NoopReporter,
    )
    .unwrap();

    // Render thumbnail and check top-left margin corner pixel is dark (from PageBackground::Black)
    let png_bytes = render_pdf_thumbnail(&black_pdf, 0, 180).unwrap();
    let rendered = image::load_from_memory(&png_bytes).unwrap().to_rgba8();
    let corner = rendered.get_pixel(2, 2);
    assert!(
        corner[0] < 20 && corner[1] < 20 && corner[2] < 20,
        "expected black margin corner pixel, got {:?}",
        corner
    );

    // Check Transparent omits background rectangle
    let trans_pdf = tmp.path().join("a4_trans.pdf");
    build_pdf_from_drafts(
        &scan.pages,
        &[],
        &Image2PdfConfig {
            output_path: trans_pdf.clone(),
            layout: PageLayoutPolicy::FitA4 {
                margin_pt: 24.0,
                background: PageBackground::Transparent,
            },
            jpeg_quality: 90,
            lossless_passthrough: true,
            animated_policy: AnimatedImagePolicy::FirstFrameOnly,
            export_mode: PdfExportMode::Balanced,
            max_mb: None,
            max_pages_per_file: None,
        },
        &CancellationToken::new(),
        &NoopReporter,
    )
    .unwrap();
    assert_eq!(inspect_pdf(&trans_pdf).unwrap().page_count, 1);
}

#[test]
fn split_pdf_custom_groups_supports_reordering_duplication_and_rotation() {
    let tmp = tempdir().unwrap();
    let mut img = RgbaImage::new(60, 80);
    for px in img.pixels_mut() {
        *px = Rgba([30, 144, 255, 255]);
    }
    let img1 = tmp.path().join("p1.png");
    let img2 = tmp.path().join("p2.png");
    let img3 = tmp.path().join("p3.png");
    img.save(&img1).unwrap();
    img.save(&img2).unwrap();
    img.save(&img3).unwrap();

    let scan = knit_pdf::scan_image_files(&[img1, img2, img3], AnimatedImagePolicy::FirstFrameOnly).unwrap();
    let src_pdf = tmp.path().join("source.pdf");
    build_pdf_from_drafts(
        &scan.pages,
        &[],
        &Image2PdfConfig {
            output_path: src_pdf.clone(),
            layout: PageLayoutPolicy::OriginalSize { dpi: 72.0 },
            jpeg_quality: 90,
            lossless_passthrough: true,
            animated_policy: AnimatedImagePolicy::FirstFrameOnly,
            export_mode: PdfExportMode::Balanced,
            max_mb: None,
            max_pages_per_file: None,
        },
        &CancellationToken::new(),
        &NoopReporter,
    )
    .unwrap();

    let split_dir = tmp.path().join("sections_out");
    let res = knit_pdf::split_pdf(
        &src_pdf,
        &split_dir,
        "source",
        &knit_pdf::PdfSplitRule::CustomGroups {
            groups: vec![
                knit_pdf::PdfSplitGroup {
                    name: "chapter_one".into(),
                    pages: vec![
                        knit_pdf::PageSelection { file_index: 0, page_index: 2, rotation_deg: 90 },
                        knit_pdf::PageSelection { file_index: 0, page_index: 0, rotation_deg: 0 },
                    ],
                },
                knit_pdf::PdfSplitGroup {
                    name: "chapter_two".into(),
                    pages: vec![
                        knit_pdf::PageSelection { file_index: 0, page_index: 0, rotation_deg: 0 },
                        knit_pdf::PageSelection { file_index: 0, page_index: 1, rotation_deg: 180 },
                    ],
                },
            ],
        },
        &CancellationToken::new(),
        &NoopReporter,
    )
    .unwrap();

    assert_eq!(res.output_files.len(), 2);
    assert_eq!(res.total_pages, 4);
    assert_eq!(inspect_pdf(&res.output_files[0]).unwrap().page_count, 2);
    assert_eq!(inspect_pdf(&res.output_files[1]).unwrap().page_count, 2);

    let thumb_bytes = std::fs::read(&res.output_files[0]).unwrap();
    let (count, thumbs) = knit_pdf::render_pdf_bytes_thumbnails(&thumb_bytes, Some(2), 160).unwrap();
    assert_eq!(count, 2);
    assert_eq!(thumbs.len(), 2);
}

#[test]
fn parallel_scan_preserves_order_and_avif_header_inspection() {
    let tmp = tempdir().unwrap();
    let root = tmp.path().join("manga");
    let ch1 = root.join("Chap 1");
    let ch2 = root.join("Chap 2");
    std::fs::create_dir_all(&ch1).unwrap();
    std::fs::create_dir_all(&ch2).unwrap();

    // AVIF dimension inspection via header-only box skip
    let avif_path = ch1.join("1.avif");
    let avif_rgba = RgbaImage::from_fn(96, 48, |x, y| Rgba([x as u8, y as u8, 120, 255]));
    let avif_bytes = oxideav_avif::encode_rgba8(
        96,
        48,
        avif_rgba.as_raw(),
        &oxideav_avif::EncodeOptions::default().with_quality(75),
    )
    .unwrap();
    std::fs::write(&avif_path, avif_bytes).unwrap();
    assert_eq!(inspect_image_dimensions(&avif_path).unwrap(), (96, 48));

    // Natural sort order: 2.jpg, 10.jpg in Chap 1, cover.jpg + 1.png in Chap 2
    make_sample_jpg(&ch1.join("10.jpg"), 20, 30, [1, 2, 3]);
    make_sample_jpg(&ch1.join("2.jpg"), 20, 30, [4, 5, 6]);
    make_sample_jpg(&ch2.join("cover.jpg"), 40, 60, [7, 8, 9]);
    make_sample_png(&ch2.join("1.png"), 30, 40, [10, 11, 12, 255]);

    let scan = scan_image_folder(&root, AnimatedImagePolicy::FirstFrameOnly).unwrap();
    let labels: Vec<&str> = scan.pages.iter().map(|p| p.label.as_str()).collect();
    assert_eq!(
        labels,
        vec!["1.avif", "2.jpg", "10.jpg", "cover.jpg", "1.png"]
    );
    assert_eq!(scan.bookmarks.len(), 2);
    assert_eq!(scan.bookmarks[0].title, "Chap 1");
    assert_eq!(scan.bookmarks[0].target_page_index, 0);
    assert_eq!(scan.bookmarks[1].title, "Chap 2");
    assert_eq!(scan.bookmarks[1].target_page_index, 3);
    assert!(scan.warnings.is_empty());
}

#[test]
fn jpeg_header_inspection_handles_exif_rotation_and_skips_corrupt_images_with_warning() {
    let tmp = tempdir().unwrap();
    let root = tmp.path().join("broken_mix");
    let ch1 = root.join("Chap 1");
    let ch2 = root.join("Chap 2");
    std::fs::create_dir_all(&ch1).unwrap();
    std::fs::create_dir_all(&ch2).unwrap();

    // Minimal valid JPEG with APP1 EXIF Orientation = 6 (90 deg CW -> swaps 100x200 into 200x100)
    #[rustfmt::skip]
    let exif_rotated_jpeg: Vec<u8> = vec![
        0xFF, 0xD8, // SOI
        0xFF, 0xE1, 0x00, 0x22, // APP1 length 34 (2 + 32)
        b'E', b'x', b'i', b'f', 0x00, 0x00,
        b'M', b'M', 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08, // TIFF MM header, IFD0 @ 8
        0x00, 0x01, // 1 IFD entry
        0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06, 0x00, 0x00, // Orientation = 6
        0x00, 0x00, 0x00, 0x00, // next IFD = 0
        0xFF, 0xC0, 0x00, 0x0B, // SOF0
        0x08, 0x00, 0xC8, 0x00, 0x64, // precision=8, height=200, width=100
        0x01, 0x01, 0x11, 0x00,
        0xFF, 0xD9, // EOI
    ];
    let rotated_path = ch1.join("01_exif.jpg");
    std::fs::write(&rotated_path, &exif_rotated_jpeg).unwrap();
    assert_eq!(inspect_image_dimensions(&rotated_path).unwrap(), (200, 100));

    // Corrupt JPEG in Chap 1 (entirely invalid bytes) + valid image in Chap 2
    std::fs::write(ch1.join("02_corrupt.jpg"), b"not-a-valid-jpeg").unwrap();
    make_sample_jpg(&ch2.join("01_ok.jpg"), 64, 48, [20, 40, 60]);

    let scan = scan_image_folder(&root, AnimatedImagePolicy::FirstFrameOnly).unwrap();
    assert_eq!(scan.pages.len(), 2);
    assert_eq!(scan.pages[0].label, "01_exif.jpg");
    assert_eq!((scan.pages[0].width_px, scan.pages[0].height_px), (200, 100));
    assert_eq!(scan.pages[1].label, "01_ok.jpg");
    assert_eq!(scan.warnings.len(), 1);
    assert!(scan.warnings[0].contains("02_corrupt.jpg"));
    assert_eq!(scan.bookmarks.len(), 2);
    assert_eq!(scan.bookmarks[1].target_page_index, 1);
}

#[test]
fn split_by_max_pages_per_file_and_preview_draft_edits_and_monotonic_progress() {
    use knit_core::{JobLogLevel, JobProgress, JobReporter};
    use std::sync::Mutex;

    struct RecordingReporter(Mutex<Vec<u64>>);
    impl JobReporter for RecordingReporter {
        fn on_progress(&self, p: JobProgress) {
            self.0.lock().unwrap().push(p.done);
        }
        fn on_log(&self, _level: JobLogLevel, _msg: &str) {}
    }

    let tmp = tempdir().unwrap();
    let mut paths = Vec::new();
    for i in 0..5 {
        let p = tmp.path().join(format!("p{i}.png"));
        make_sample_png(&p, 120, 80, [240, 240, 240, 255]);
        paths.push(p);
    }

    let mut scan = knit_pdf::scan_image_files(&paths, AnimatedImagePolicy::FirstFrameOnly).unwrap();
    assert!(scan.pages.iter().all(|p| p.file_size_bytes > 0));

    // Edit page 0: crop half + rotate 90 + red stroke -> verify rendered preview reflects edits
    scan.pages[0].crop = Some(CropRect {
        x: 0.0,
        y: 0.0,
        width: 0.5,
        height: 1.0,
    }); // 60x80 -> rotated 90 -> 80x60
    scan.pages[0].rotation_deg = 90;
    scan.pages[0].annotations.strokes.push(StrokeAnnotation {
        id: "st1".into(),
        points: vec![[0.1, 0.5], [0.9, 0.5]],
        stroke_width_ratio: 0.08,
        color_hex: "#DC3545".into(),
    });

    let preview_jpeg = render_page_draft_preview_jpeg(&scan.pages[0], 400, 80).unwrap();
    let preview_img = image::load_from_memory(&preview_jpeg).unwrap().to_rgb8();
    assert_eq!(preview_img.width(), 80);
    assert_eq!(preview_img.height(), 60);
    assert!(preview_img
        .pixels()
        .any(|p| p[0] > 180 && p[1] < 100 && p[2] < 100));

    let out_pdf = tmp.path().join("split_pages.pdf");
    let reporter = RecordingReporter(Mutex::new(Vec::new()));
    let bookmarks = vec![
        BookmarkNode {
            title: "Part 1".into(),
            target_page_index: 0,
            children: vec![],
        },
        BookmarkNode {
            title: "Part 2".into(),
            target_page_index: 3,
            children: vec![],
        },
    ];
    let res = build_pdf_from_drafts(
        &scan.pages,
        &bookmarks,
        &Image2PdfConfig {
            output_path: out_pdf,
            layout: PageLayoutPolicy::OriginalSize { dpi: 72.0 },
            jpeg_quality: 85,
            lossless_passthrough: true,
            animated_policy: AnimatedImagePolicy::FirstFrameOnly,
            export_mode: PdfExportMode::Balanced,
            max_mb: None,
            max_pages_per_file: Some(2),
        },
        &CancellationToken::new(),
        &reporter,
    )
    .unwrap();

    assert_eq!(res.output_files.len(), 3); // 2 + 2 + 1 pages
    assert_eq!(inspect_pdf(&res.output_files[0]).unwrap().page_count, 2);
    assert_eq!(inspect_pdf(&res.output_files[1]).unwrap().page_count, 2);
    assert_eq!(inspect_pdf(&res.output_files[2]).unwrap().page_count, 1);
    let p2_info = inspect_pdf(&res.output_files[1]).unwrap();
    assert_eq!(p2_info.bookmarks[0].title, "Part 2");
    assert_eq!(p2_info.bookmarks[0].target_page_index, 1);

    let dones = reporter.0.lock().unwrap();
    assert!(!dones.is_empty());
    for pair in dones.windows(2) {
        assert!(pair[1] >= pair[0], "progress went backwards: {:?}", *dones);
    }
    assert_eq!(*dones.last().unwrap(), 5);
}

#[test]
fn split_multi_pdf_handles_cross_file_custom_groups_and_batch_rules() {
    let tmp = tempdir().unwrap();
    let img_a = tmp.path().join("a.png");
    let img_b = tmp.path().join("b.png");
    make_sample_png(&img_a, 80, 60, [255, 0, 0, 255]);
    make_sample_png(&img_b, 80, 60, [0, 0, 255, 255]);

    let pdf1 = tmp.path().join("doc1.pdf");
    let pdf2 = tmp.path().join("doc2.pdf");
    let scan1 = scan_image_files(&[img_a.clone(), img_b.clone()], AnimatedImagePolicy::FirstFrameOnly).unwrap();
    let scan2 = scan_image_files(&[img_b.clone(), img_a.clone()], AnimatedImagePolicy::FirstFrameOnly).unwrap();

    let cfg = |p: &std::path::Path| Image2PdfConfig {
        output_path: p.to_path_buf(),
        layout: PageLayoutPolicy::OriginalSize { dpi: 72.0 },
        jpeg_quality: 85,
        lossless_passthrough: true,
        animated_policy: AnimatedImagePolicy::FirstFrameOnly,
        export_mode: PdfExportMode::Balanced,
        max_mb: None,
        max_pages_per_file: None,
    };
    build_pdf_from_drafts(&scan1.pages, &[], &cfg(&pdf1), &CancellationToken::new(), &NoopReporter).unwrap();
    build_pdf_from_drafts(&scan2.pages, &[], &cfg(&pdf2), &CancellationToken::new(), &NoopReporter).unwrap();

    let custom_dir = tmp.path().join("custom_out");
    let res_custom = split_multi_pdf(
        &[pdf1.clone(), pdf2.clone()],
        &["doc1".into(), "doc2".into()],
        &custom_dir,
        &PdfSplitRule::CustomGroups {
            groups: vec![
                PdfSplitGroup {
                    name: "mix_section".into(),
                    pages: vec![
                        PageSelection { file_index: 0, page_index: 1, rotation_deg: 90 },
                        PageSelection { file_index: 1, page_index: 0, rotation_deg: 0 },
                    ],
                },
                PdfSplitGroup {
                    name: "only_second".into(),
                    pages: vec![PageSelection { file_index: 1, page_index: 1, rotation_deg: 0 }],
                },
            ],
        },
        &CancellationToken::new(),
        &NoopReporter,
    )
    .unwrap();
    assert_eq!(res_custom.output_files.len(), 2);
    assert_eq!(res_custom.total_pages, 3);
    assert_eq!(inspect_pdf(&res_custom.output_files[0]).unwrap().page_count, 2);
    assert_eq!(inspect_pdf(&res_custom.output_files[1]).unwrap().page_count, 1);

    let batch_dir = tmp.path().join("batch_out");
    let res_batch = split_multi_pdf(
        &[pdf1, pdf2],
        &["first".into(), "second".into()],
        &batch_dir,
        &PdfSplitRule::EveryNPages { n: 1 },
        &CancellationToken::new(),
        &NoopReporter,
    )
    .unwrap();
    assert_eq!(res_batch.output_files.len(), 4);
    assert_eq!(res_batch.total_pages, 4);
}

#[test]
fn streaming_packer_splits_by_max_mb_and_preserves_special_bookmarks_and_cleans_temp_on_cancel() {
    let tmp = tempdir().unwrap();
    let mut paths = Vec::new();
    for i in 0..4 {
        let p = tmp.path().join(format!("img_{i}.png"));
        let mut img = RgbaImage::new(200, 200);
        for (x, y, px) in img.enumerate_pixels_mut() {
            *px = Rgba([
                ((x * 7 + i * 40) % 255) as u8,
                ((y * 11 + i * 30) % 255) as u8,
                ((x ^ y) % 255) as u8,
                255,
            ]);
        }
        img.save(&p).unwrap();
        paths.push(p);
    }

    let scan = knit_pdf::scan_image_files(&paths, AnimatedImagePolicy::FirstFrameOnly).unwrap();
    let out_dir = tmp.path().join("out");
    std::fs::create_dir_all(&out_dir).unwrap();
    let out_pdf = out_dir.join("split_mb.pdf");

    let bookmarks = vec![
        BookmarkNode {
            title: "Part (1) \\ ASCII".into(),
            target_page_index: 0,
            children: vec![BookmarkNode {
                title: "Mục con Tiếng Việt".into(),
                target_page_index: 1,
                children: vec![],
            }],
        },
        BookmarkNode {
            title: "Chương cuối".into(),
            target_page_index: 3,
            children: vec![],
        },
    ];

    // Very small max_mb (~10 KB) forces streaming split across parts
    let res = build_pdf_from_drafts(
        &scan.pages,
        &bookmarks,
        &Image2PdfConfig {
            output_path: out_pdf.clone(),
            layout: PageLayoutPolicy::OriginalSize { dpi: 72.0 },
            jpeg_quality: 85,
            lossless_passthrough: true,
            animated_policy: AnimatedImagePolicy::FirstFrameOnly,
            export_mode: PdfExportMode::Balanced,
            max_mb: Some(0.01),
            max_pages_per_file: None,
        },
        &CancellationToken::new(),
        &NoopReporter,
    )
    .unwrap();

    assert!(res.output_files.len() >= 2, "expected max_mb to split into multiple PDFs");
    let total_pages_inspected: usize = res
        .output_files
        .iter()
        .map(|p| inspect_pdf(p).unwrap().page_count)
        .sum();
    assert_eq!(total_pages_inspected, 4);

    let first_info = inspect_pdf(&res.output_files[0]).unwrap();
    assert_eq!(first_info.bookmarks[0].title, "Part (1) \\ ASCII");
    let has_nested_vi = res.output_files.iter().any(|p| {
        inspect_pdf(p)
            .unwrap()
            .bookmarks
            .iter()
            .any(|b| b.children.iter().any(|c| c.title == "Mục con Tiếng Việt"))
    });
    assert!(has_nested_vi, "expected nested Vietnamese bookmark in split part");
    let last_info = inspect_pdf(res.output_files.last().unwrap()).unwrap();
    assert!(
        last_info.bookmarks.iter().any(|b| b.title == "Chương cuối"),
        "expected last bookmark in final split part"
    );

    let thumb = render_pdf_thumbnail(&res.output_files[0], 0, 80).unwrap();
    assert!(!thumb.is_empty());

    // Ensure no leftover .knit_tmp files in out_dir
    let leftover_tmp = std::fs::read_dir(&out_dir)
        .unwrap()
        .flatten()
        .any(|e| e.file_name().to_string_lossy().contains(".knit_tmp."));
    assert!(!leftover_tmp, "unexpected temporary files remained after export");

    // Verify mid-stream cancellation cleans up open temp files cleanly
    struct CancelOnFirstProgress(CancellationToken);
    impl knit_core::JobReporter for CancelOnFirstProgress {
        fn on_progress(&self, _p: knit_core::JobProgress) {
            self.0.cancel();
        }
        fn on_log(&self, _level: knit_core::JobLogLevel, _msg: &str) {}
    }

    let cancel = CancellationToken::new();
    let cancel_out = out_dir.join("cancelled.pdf");
    let err = build_pdf_from_drafts(
        &scan.pages,
        &[],
        &Image2PdfConfig {
            output_path: cancel_out.clone(),
            layout: PageLayoutPolicy::OriginalSize { dpi: 72.0 },
            jpeg_quality: 85,
            lossless_passthrough: true,
            animated_policy: AnimatedImagePolicy::FirstFrameOnly,
            export_mode: PdfExportMode::Balanced,
            max_mb: None,
            max_pages_per_file: None,
        },
        &cancel,
        &CancelOnFirstProgress(cancel.clone()),
    )
    .unwrap_err();
    assert!(matches!(err, knit_core::KnitError::Cancelled));
    assert!(!cancel_out.exists());
    let leftover_after_cancel = std::fs::read_dir(&out_dir)
        .unwrap()
        .flatten()
        .any(|e| e.file_name().to_string_lossy().contains(".knit_tmp."));
    assert!(!leftover_after_cancel, "temp files leaked after mid-stream cancel");
}

#[test]
fn export_modes_fast_balanced_and_safe_behave_as_specified() {
    let tmp = tempdir().unwrap();

    // 1. Grayscale L8 JPEG
    let gray_jpg = tmp.path().join("01_gray.jpg");
    let gray_img = image::GrayImage::from_fn(80, 60, |x, y| image::Luma([((x + y) % 255) as u8]));
    DynamicImage::ImageLuma8(gray_img)
        .write_to(&mut std::fs::File::create(&gray_jpg).unwrap(), ImageFormat::Jpeg)
        .unwrap();

    // 2. Opaque RGB PNG (eligible for IDAT passthrough)
    let rgb_png = tmp.path().join("02_opaque.png");
    let rgb_img = image::RgbImage::from_fn(60, 80, |x, y| image::Rgb([x as u8 * 3, y as u8 * 2, 120]));
    DynamicImage::ImageRgb8(rgb_img)
        .write_to(&mut std::fs::File::create(&rgb_png).unwrap(), ImageFormat::Png)
        .unwrap();

    // 3. PNG disguised with .jpg extension (magic byte detection check)
    let png_as_jpg = tmp.path().join("03_cover.jpg");
    std::fs::copy(&rgb_png, &png_as_jpg).unwrap();

    let scan = knit_pdf::scan_image_files(
        &[gray_jpg.clone(), rgb_png.clone(), png_as_jpg.clone()],
        AnimatedImagePolicy::FirstFrameOnly,
    )
    .unwrap();
    assert_eq!(scan.pages.len(), 3);

    // Mode 1: Fast — bypasses max_pages_per_file/max_mb split and writes 1 PDF file
    let fast_out = tmp.path().join("fast.pdf");
    let fast_res = build_pdf_from_drafts(
        &scan.pages,
        &[],
        &Image2PdfConfig {
            output_path: fast_out.clone(),
            layout: PageLayoutPolicy::OriginalSize { dpi: 72.0 },
            jpeg_quality: 85,
            lossless_passthrough: false,
            animated_policy: AnimatedImagePolicy::FirstFrameOnly,
            export_mode: PdfExportMode::Fast,
            max_mb: Some(0.001),
            max_pages_per_file: Some(1),
        },
        &CancellationToken::new(),
        &NoopReporter,
    )
    .unwrap();
    assert_eq!(fast_res.output_files.len(), 1);
    assert_eq!(fast_res.total_pages, 3);
    assert_eq!(fast_res.passthrough_pages, 3); // gray JPEG + both PNGs via IDAT
    assert_eq!(inspect_pdf(&fast_out).unwrap().page_count, 3);
    assert!(!render_pdf_thumbnail(&fast_out, 0, 60).unwrap().is_empty());
    assert!(!render_pdf_thumbnail(&fast_out, 1, 60).unwrap().is_empty());
    assert!(!render_pdf_thumbnail(&fast_out, 2, 60).unwrap().is_empty());

    // Mode 2: Balanced — passthroughs Grayscale JPEG + IDAT PNG AND honors split rules
    let bal_out = tmp.path().join("balanced.pdf");
    let bal_res = build_pdf_from_drafts(
        &scan.pages,
        &[],
        &Image2PdfConfig {
            output_path: bal_out,
            layout: PageLayoutPolicy::OriginalSize { dpi: 72.0 },
            jpeg_quality: 85,
            lossless_passthrough: true,
            animated_policy: AnimatedImagePolicy::FirstFrameOnly,
            export_mode: PdfExportMode::Balanced,
            max_mb: None,
            max_pages_per_file: Some(2),
        },
        &CancellationToken::new(),
        &NoopReporter,
    )
    .unwrap();
    assert_eq!(bal_res.output_files.len(), 2);
    assert_eq!(bal_res.passthrough_pages, 3);

    // Mode 3: Safe — detects truncated/corrupted JPEG pixel stream that header-only check skips
    let corrupt_jpg = tmp.path().join("04_corrupt.jpg");
    let valid_bytes = std::fs::read(&gray_jpg).unwrap();
    // Keep header intact, truncate scan payload mid-stream so pixel decode fails
    let truncated_len = (valid_bytes.len() / 2).max(40);
    std::fs::write(&corrupt_jpg, &valid_bytes[..truncated_len]).unwrap();

    let corrupt_draft = PageDraft {
        id: "corrupt".into(),
        source: PageSource::ImageFile { path: corrupt_jpg },
        rotation_deg: 0,
        crop: None,
        annotations: AnnotationLayer::default(),
        duration_ms: None,
        label: "04_corrupt.jpg".into(),
        width_px: 80,
        height_px: 60,
        file_size_bytes: truncated_len as u64,
    };

    let safe_err = build_pdf_from_drafts(
        &[corrupt_draft],
        &[],
        &Image2PdfConfig {
            output_path: tmp.path().join("safe_fail.pdf"),
            layout: PageLayoutPolicy::OriginalSize { dpi: 72.0 },
            jpeg_quality: 85,
            lossless_passthrough: true,
            animated_policy: AnimatedImagePolicy::FirstFrameOnly,
            export_mode: PdfExportMode::Safe,
            max_mb: None,
            max_pages_per_file: None,
        },
        &CancellationToken::new(),
        &NoopReporter,
    );
    assert!(safe_err.is_err(), "Safe mode must reject truncated JPEG scan stream");
}

#[test]
fn streaming_merge_duplicates_rotates_interleaves_and_splits_by_max_bytes() {
    let tmp = tempdir().unwrap();
    let img_a = tmp.path().join("wide.png");
    let img_b = tmp.path().join("tall.png");
    let noisy_wide = RgbaImage::from_fn(240, 120, |x, y| {
        Rgba([((x * 13 + y * 7) % 255) as u8, ((x ^ y) % 255) as u8, 120, 255])
    });
    let noisy_tall = RgbaImage::from_fn(120, 240, |x, y| {
        Rgba([50, ((x * 17 + y * 5) % 255) as u8, ((x ^ (y * 3)) % 255) as u8, 255])
    });
    noisy_wide.save(&img_a).unwrap();
    noisy_tall.save(&img_b).unwrap();

    let pdf_a = tmp.path().join("a.pdf");
    let pdf_b = tmp.path().join("b.pdf");
    let scan_a = knit_pdf::scan_image_files(&[img_a], AnimatedImagePolicy::FirstFrameOnly).unwrap();
    let scan_b = knit_pdf::scan_image_files(&[img_b], AnimatedImagePolicy::FirstFrameOnly).unwrap();

    let make_cfg = |out: std::path::PathBuf| Image2PdfConfig {
        output_path: out,
        layout: PageLayoutPolicy::OriginalSize { dpi: 72.0 },
        jpeg_quality: 85,
        lossless_passthrough: true,
        animated_policy: AnimatedImagePolicy::FirstFrameOnly,
        export_mode: PdfExportMode::Balanced,
        max_mb: None,
        max_pages_per_file: None,
    };
    build_pdf_from_drafts(&scan_a.pages, &[], &make_cfg(pdf_a.clone()), &CancellationToken::new(), &NoopReporter).unwrap();
    build_pdf_from_drafts(&scan_b.pages, &[], &make_cfg(pdf_b.clone()), &CancellationToken::new(), &NoopReporter).unwrap();

    // Interleave across files + duplicate same page with different rotations
    let merged = tmp.path().join("interleaved_dup.pdf");
    let res = merge_pdfs(
        &PdfMergeConfig {
            inputs: vec![pdf_a, pdf_b],
            selected_pages: Some(vec![
                PageSelection { file_index: 1, page_index: 0, rotation_deg: 0 },   // 60x120
                PageSelection { file_index: 0, page_index: 0, rotation_deg: 90 },  // 120x60 rot 90 -> 60x120
                PageSelection { file_index: 1, page_index: 0, rotation_deg: 90 },  // 60x120 rot 90 -> 120x60
            ]),
            output_path: merged.clone(),
            preserve_bookmarks: false,
            custom_bookmarks: None,
        },
        &CancellationToken::new(),
        &NoopReporter,
    )
    .unwrap();
    assert_eq!(res.total_pages, 3);

    let info = inspect_pdf(&merged).unwrap();
    assert_eq!(info.page_count, 3);

    // Render all 3 pages via mmap + hayro and verify dimensions/orientations
    let t0 = image::load_from_memory(&knit_pdf::render_pdf_thumbnail_jpeg(&merged, 0, 120, 80).unwrap()).unwrap();
    assert!(t0.height() > t0.width(), "page 0 should be portrait");
    let t1 = image::load_from_memory(&knit_pdf::render_pdf_thumbnail_jpeg(&merged, 1, 120, 80).unwrap()).unwrap();
    assert!(t1.height() > t1.width(), "page 1 (rotated 90) should be portrait");
    let t2 = image::load_from_memory(&knit_pdf::render_pdf_thumbnail_jpeg(&merged, 2, 120, 80).unwrap()).unwrap();
    assert!(t2.width() > t2.height(), "page 2 (dup rotated 90) should be landscape");

    // Verify MaxBytes split uses streaming measurement cleanly
    let split_dir = tmp.path().join("split_max_bytes");
    let split_res = split_pdf(
        &merged,
        &split_dir,
        "chunk",
        &PdfSplitRule::MaxBytes { max_mb: 0.02 },
        &CancellationToken::new(),
        &NoopReporter,
    )
    .unwrap();
    assert!(split_res.output_files.len() >= 2);
    let total_split_pages: usize = split_res
        .output_files
        .iter()
        .map(|p| inspect_pdf(p).unwrap().page_count)
        .sum();
    assert_eq!(total_split_pages, 3);
}
