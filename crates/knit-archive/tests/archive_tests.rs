use std::fs::{self, File};
use std::io::Read;

use flate2::read::GzDecoder;
use knit_archive::{
    collect_entries, pack_entries, ArchiveFormat, ArchiveOptions, CompressionLevel, ZipEncryption,
};
use knit_core::{CancellationToken, KnitError, NoopReporter};
use tempfile::tempdir;

fn make_sample_tree(root: &std::path::Path) -> std::path::PathBuf {
    let src = root.join("sample");
    fs::create_dir_all(src.join("sub")).unwrap();
    fs::write(src.join("a.txt"), b"Hello Knit Archive").unwrap();
    fs::write(src.join("sub/b.txt"), b"Nested content").unwrap();
    fs::write(src.join(".hidden"), b"ignore me").unwrap();
    src
}

#[test]
fn zip_aes256_roundtrip() {
    let dir = tempdir().unwrap();
    let src = make_sample_tree(dir.path());
    let entries = collect_entries(&[src], true, true).unwrap();
    assert_eq!(entries.len(), 2);

    let out_zip = dir.path().join("protected.zip");
    let opts = ArchiveOptions {
        format: ArchiveFormat::Zip,
        compression: CompressionLevel::Normal,
        encryption: ZipEncryption::Aes256("knit-secret".into()),
    };
    let summary = pack_entries(&entries, &out_zip, &opts, &CancellationToken::new(), &NoopReporter)
        .unwrap();
    assert_eq!(summary.files_packed, 2);
    assert!(out_zip.exists());

    let mut zr = zip::ZipArchive::new(File::open(&out_zip).unwrap()).unwrap();
    assert_eq!(zr.len(), 2);
    let mut file = zr.by_name_decrypt("sample/a.txt", b"knit-secret").unwrap();
    let mut text = String::new();
    file.read_to_string(&mut text).unwrap();
    assert_eq!(text, "Hello Knit Archive");
}

#[test]
fn zipcrypto_roundtrip() {
    let dir = tempdir().unwrap();
    let src = make_sample_tree(dir.path());
    let entries = collect_entries(&[src], false, true).unwrap();

    let out_zip = dir.path().join("legacy.zip");
    let opts = ArchiveOptions {
        format: ArchiveFormat::Zip,
        compression: CompressionLevel::Fast,
        encryption: ZipEncryption::ZipCrypto("pass123".into()),
    };
    pack_entries(&entries, &out_zip, &opts, &CancellationToken::new(), &NoopReporter).unwrap();

    let mut zr = zip::ZipArchive::new(File::open(&out_zip).unwrap()).unwrap();
    let mut file = zr.by_name_decrypt("sub/b.txt", b"pass123").unwrap();
    let mut text = String::new();
    file.read_to_string(&mut text).unwrap();
    assert_eq!(text, "Nested content");
}

#[test]
fn tar_gz_and_tar_zst_roundtrip() {
    let dir = tempdir().unwrap();
    let src = make_sample_tree(dir.path());
    let entries = collect_entries(&[src], true, true).unwrap();

    // .tar.gz
    let out_gz = dir.path().join("out.tar.gz");
    pack_entries(
        &entries,
        &out_gz,
        &ArchiveOptions {
            format: ArchiveFormat::TarGz,
            compression: CompressionLevel::Normal,
            encryption: ZipEncryption::None,
        },
        &CancellationToken::new(),
        &NoopReporter,
    )
    .unwrap();
    let mut ar_gz = tar::Archive::new(GzDecoder::new(File::open(&out_gz).unwrap()));
    let names_gz: Vec<_> = ar_gz
        .entries()
        .unwrap()
        .map(|e| e.unwrap().path().unwrap().to_string_lossy().to_string())
        .collect();
    assert_eq!(names_gz, vec!["sample/a.txt", "sample/sub/b.txt"]);

    // .tar.zst
    let out_zst = dir.path().join("out.tar.zst");
    pack_entries(
        &entries,
        &out_zst,
        &ArchiveOptions {
            format: ArchiveFormat::TarZst,
            compression: CompressionLevel::Best,
            encryption: ZipEncryption::None,
        },
        &CancellationToken::new(),
        &NoopReporter,
    )
    .unwrap();
    let dec = zstd::stream::read::Decoder::new(File::open(&out_zst).unwrap()).unwrap();
    let mut ar_zst = tar::Archive::new(dec);
    let names_zst: Vec<_> = ar_zst
        .entries()
        .unwrap()
        .map(|e| e.unwrap().path().unwrap().to_string_lossy().to_string())
        .collect();
    assert_eq!(names_zst, vec!["sample/a.txt", "sample/sub/b.txt"]);
}

#[test]
fn cancel_cleans_up_temp_file_and_rejects_tar_password() {
    let dir = tempdir().unwrap();
    let src = make_sample_tree(dir.path());
    let entries = collect_entries(&[src], true, true).unwrap();

    let out_tar = dir.path().join("bad.tar");
    let err = pack_entries(
        &entries,
        &out_tar,
        &ArchiveOptions {
            format: ArchiveFormat::Tar,
            compression: CompressionLevel::Normal,
            encryption: ZipEncryption::Aes256("pw".into()),
        },
        &CancellationToken::new(),
        &NoopReporter,
    );
    assert!(matches!(err, Err(KnitError::InvalidInput(_))));

    let token = CancellationToken::new();
    token.cancel();
    let out_zip = dir.path().join("cancelled.zip");
    let err = pack_entries(
        &entries,
        &out_zip,
        &ArchiveOptions::default(),
        &token,
        &NoopReporter,
    );
    assert!(matches!(err, Err(KnitError::Cancelled)));
    assert!(!out_zip.exists());
    // Không để lại file .knit_tmp
    let leftover: Vec<_> = fs::read_dir(dir.path())
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().contains(".knit_tmp"))
        .collect();
    assert!(leftover.is_empty());
}

#[test]
fn estimate_archive_output_computes_raw_and_compressed_sizes() {
    let dir = tempdir().unwrap();
    let src = make_sample_tree(dir.path());
    fs::write(src.join("photo.jpg"), vec![0xFFu8; 2000]).unwrap();

    let store_est = knit_archive::estimate_archive_output(
        &[src.clone()],
        true,
        true,
        &ArchiveOptions {
            format: ArchiveFormat::Zip,
            compression: CompressionLevel::Store,
            encryption: ZipEncryption::None,
        },
    )
    .unwrap();
    assert_eq!(store_est.files_count, 3);
    assert!(store_est.input_bytes > 2000);
    assert!(store_est.estimated_output_bytes >= store_est.input_bytes);

    let best_est = knit_archive::estimate_archive_output(
        &[src],
        true,
        true,
        &ArchiveOptions {
            format: ArchiveFormat::TarZst,
            compression: CompressionLevel::Best,
            encryption: ZipEncryption::None,
        },
    )
    .unwrap();
    assert_eq!(best_est.files_count, 3);
    assert_eq!(best_est.input_bytes, store_est.input_bytes);
}
