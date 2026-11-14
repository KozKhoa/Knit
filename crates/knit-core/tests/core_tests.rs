use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use knit_core::job::ThrottledReporter;
use knit_core::{
    atomic_write_file, ensure_disk_space, human_size, natural_sort_by, nfc_normalize,
    safe_join_within, sanitize_filename, CancellationToken, JobLogLevel, JobProgress, JobReporter,
    KnitError,
};
use tempfile::tempdir;

#[test]
fn natural_sort_handles_numbers_and_case() {
    let mut items = vec![
        "Chapter 10",
        "chapter 2",
        "Chapter 1",
        "chapter 02",
        "Chapter 1.10",
        "Chapter 1.2",
    ];
    natural_sort_by(&mut items, |s| s);
    assert_eq!(
        items,
        vec![
            "Chapter 1",
            "Chapter 1.2",
            "Chapter 1.10",
            "chapter 2",
            "chapter 02",
            "Chapter 10",
        ]
    );
}

#[test]
fn sanitize_filename_strips_windows_illegal_chars_and_trailing_dots() {
    assert_eq!(sanitize_filename("Vol 1: <Test>?. ", 100), "Vol 1_ _Test__");
    assert_eq!(sanitize_filename("...", 100), "untitled");
    assert_eq!(sanitize_filename("   ", 100), "untitled");
    assert_eq!(sanitize_filename("abcdef", 4), "abcd");
}

#[test]
fn safe_join_blocks_traversal() {
    let root = Path::new("/tmp/manga");
    assert!(safe_join_within(root, "art/cover.jpg").is_ok());
    assert!(safe_join_within(root, "../../etc/passwd").is_err());
    assert!(safe_join_within(root, "/etc/passwd").is_err());
    assert!(safe_join_within(root, "vol1/../cover.jpg").is_ok());
}

#[test]
fn nfc_normalizes_nfd_vietnamese() {
    // "Chương" in NFD (u + combining horn + combining circumflex/etc.) vs NFC
    let nfd = "Chu\u{031B}\u{01A1}ng"; // partial example, test explicit NFC vs NFD of 'ế'
    let e_nfd = "e\u{0302}\u{0301}";
    let e_nfc = "\u{1EBF}";
    assert_ne!(e_nfd, e_nfc);
    assert_eq!(nfc_normalize(e_nfd), e_nfc);
    assert!(!nfc_normalize(nfd).is_empty());
}

#[test]
fn atomic_write_cleans_up_on_error_and_replaces_on_success() {
    let dir = tempdir().unwrap();
    let target = dir.path().join("out.txt");

    // Failed write leaves neither target nor tmp
    let err = atomic_write_file(&target, |f| {
        f.write_all(b"partial")?;
        Err(KnitError::Cancelled)
    });
    assert!(matches!(err, Err(KnitError::Cancelled)));
    assert!(!target.exists());
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);

    // Successful write creates target cleanly
    atomic_write_file(&target, |f| {
        f.write_all(b"complete")?;
        Ok(())
    })
    .unwrap();
    assert_eq!(std::fs::read_to_string(&target).unwrap(), "complete");
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
}

#[test]
fn cancellation_and_disk_check() {
    let token = CancellationToken::new();
    assert!(token.check().is_ok());
    token.cancel();
    assert!(matches!(token.check(), Err(KnitError::Cancelled)));

    let dir = tempdir().unwrap();
    assert!(ensure_disk_space(dir.path(), 1024).is_ok());
    assert_eq!(human_size(1536), "1.5 KB");
}

struct CountingReporter(Arc<AtomicUsize>);
impl JobReporter for CountingReporter {
    fn on_progress(&self, _p: JobProgress) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
    fn on_log(&self, _level: JobLogLevel, _msg: &str) {}
}

#[test]
fn throttled_reporter_limits_burst_and_allows_terminal() {
    let count = Arc::new(AtomicUsize::new(0));
    let rep = ThrottledReporter::new(CountingReporter(count.clone()), Duration::from_secs(10));

    for i in 1..=50 {
        rep.on_progress(JobProgress {
            phase: "pack".into(),
            done: i,
            total: 100,
            bytes_done: i,
            bytes_total: 100,
            current_item: String::new(),
        });
    }
    // Only the first update emitted within 10s window
    assert_eq!(count.load(Ordering::SeqCst), 1);

    // Terminal progress (done == total) always bypasses throttle
    rep.on_progress(JobProgress {
        phase: "pack".into(),
        done: 100,
        total: 100,
        bytes_done: 100,
        bytes_total: 100,
        current_item: String::new(),
    });
    assert_eq!(count.load(Ordering::SeqCst), 2);
}
