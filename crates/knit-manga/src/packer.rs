use std::fs;
use std::path::{Path, PathBuf};

use knit_archive::{
    pack_entries, ArchiveEntrySpec, ArchiveFormat, ArchiveOptions, CompressionLevel, ZipEncryption,
};
use knit_core::{
    sanitize_filename, CancellationToken, JobReporter, JobReporterExt, KnitError, Result,
};
use tempfile::tempdir;

use crate::csv_builder::{build_csv_bytes, posix_join};
use crate::models::{MangaPackOptions, MangaPackSummary, Story};

fn story_entries(story: &Story, reporter: &dyn JobReporter) -> Vec<ArchiveEntrySpec> {
    reporter.normal(format!(
        "Chuẩn bị truyện: {} ({} chapter)",
        story.effective_title(),
        story.chapters.len()
    ));
    let mut out = Vec::new();
    let mut add = |src: PathBuf, arc: String, compression_override: Option<CompressionLevel>| {
        match fs::metadata(&src) {
            Ok(meta) => out.push(ArchiveEntrySpec {
                source_path: src,
                archive_path: arc,
                size_bytes: meta.len(),
                compression_override,
            }),
            Err(e) => reporter.warn(format!("Bỏ qua {arc}: {e}")),
        }
    };

    if let Some(cover) = &story.cover {
        let mut src = story.path.clone();
        for part in cover.split('/') {
            src.push(part);
        }
        add(src, posix_join(&[&story.dir_name, cover]), None);
    }
    if let Some(info_file) = &story.info_file {
        add(
            story.path.join(info_file),
            posix_join(&[&story.dir_name, info_file]),
            Some(CompressionLevel::Normal),
        );
    }
    for ch in &story.chapters {
        for img in &ch.images {
            add(
                ch.path.join(img),
                posix_join(&[&story.dir_name, &ch.folder, img]),
                None,
            );
        }
    }
    out
}

/// Gom NGUYÊN truyện vào từng ZIP (không cắt đôi 1 truyện). `max_bytes == 0`: 1 ZIP duy nhất.
pub fn group_by_size(sizes: &[u64], max_bytes: u64) -> Vec<Vec<usize>> {
    if sizes.is_empty() {
        return Vec::new();
    }
    if max_bytes == 0 {
        return vec![(0..sizes.len()).collect()];
    }

    let mut groups = Vec::new();
    let mut cur = Vec::new();
    let mut acc = 0u64;

    for (i, &s) in sizes.iter().enumerate() {
        if !cur.is_empty() && acc.saturating_add(s) > max_bytes {
            groups.push(cur);
            cur = Vec::new();
            acc = 0;
        }
        cur.push(i);
        acc = acc.saturating_add(s);
    }
    if !cur.is_empty() {
        groups.push(cur);
    }
    groups
}

pub fn default_output_name(stories: &[Story]) -> String {
    if stories.len() == 1 {
        format!("{}.zip", sanitize_filename(&stories[0].dir_name, 100))
    } else {
        "manga_batch.zip".to_string()
    }
}

pub fn pack_stories(
    stories: &[Story],
    output_path: &Path,
    options: &MangaPackOptions,
    token: &CancellationToken,
    reporter: &dyn JobReporter,
) -> Result<MangaPackSummary> {
    if stories.is_empty() {
        return Err(KnitError::InvalidInput(
            "Không có truyện nào để đóng gói".to_string(),
        ));
    }

    let final_base = if output_path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("zip") || e.eq_ignore_ascii_case("cbz"))
    {
        output_path.to_path_buf()
    } else {
        let mut p = output_path.to_path_buf();
        p.set_extension("zip");
        p
    };

    let per_story: Vec<Vec<ArchiveEntrySpec>> = stories
        .iter()
        .map(|s| story_entries(s, reporter))
        .collect();
    let sizes: Vec<u64> = per_story
        .iter()
        .map(|es| es.iter().map(|e| e.size_bytes).sum())
        .collect();

    let max_bytes = if options.max_gb > 0.0 {
        (options.max_gb * ((1u64 << 30) as f64)) as u64
    } else {
        0
    };
    let groups = group_by_size(&sizes, max_bytes);

    let ext = final_base
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("zip");
    let stem = final_base.with_extension("");
    let finals: Vec<PathBuf> = if groups.len() == 1 {
        vec![final_base]
    } else {
        (1..=groups.len())
            .map(|i| PathBuf::from(format!("{}_part{i:02}.{ext}", stem.display())))
            .collect()
    };

    let img_level = match options.image_compression {
        0 => CompressionLevel::Store,
        1..=3 => CompressionLevel::Fast,
        4..=6 => CompressionLevel::Normal,
        _ => CompressionLevel::Best,
    };

    let archive_opts = ArchiveOptions {
        format: ArchiveFormat::Zip,
        compression: img_level,
        encryption: ZipEncryption::None,
    };

    let tmp_dir = tempdir()?;
    let mut created = Vec::new();
    let mut total_files = 0usize;
    let total_input_bytes: u64 = sizes.iter().sum();

    let run: Result<()> = (|| {
        for (gi, (idxs, final_path)) in groups.iter().zip(finals.iter()).enumerate() {
            token.check()?;
            let mut entries = Vec::new();

            if options.mangament_package_mode {
                let subset: Vec<Story> = idxs.iter().map(|&i| stories[i].clone()).collect();
                let csv_bytes = build_csv_bytes(&subset)?;
                let csv_path = tmp_dir.path().join(format!("stories_{gi}.csv"));
                fs::write(&csv_path, &csv_bytes)?;
                entries.push(ArchiveEntrySpec {
                    source_path: csv_path,
                    archive_path: "stories.csv".to_string(),
                    size_bytes: csv_bytes.len() as u64,
                    compression_override: Some(CompressionLevel::Normal),
                });
            }

            for &i in idxs {
                entries.extend(per_story[i].iter().cloned());
            }

            let summary = pack_entries(&entries, final_path, &archive_opts, token, reporter)?;
            total_files += summary.files_packed;
            created.push(final_path.clone());
        }
        Ok(())
    })();

    if let Err(e) = run {
        for p in created {
            let _ = fs::remove_file(p);
        }
        return Err(e);
    }

    Ok(MangaPackSummary {
        created_files: created,
        stories_count: stories.len(),
        total_files,
        total_input_bytes,
    })
}
