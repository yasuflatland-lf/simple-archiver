//! Walking-skeleton smoke test: the real `ZipArchiver` over a real filesystem,
//! verified by reading the zip back with the independent `zip` crate.

// Exclude this whole integration-test crate from loom builds: `tokio::fs` is
// unavailable under `--cfg loom`, so there is nothing to model-check here.
#![cfg(not(loom))]

use simple_archiver_core::application::ports::Archiver;
use simple_archiver_core::infrastructure::zip_archiver::ZipArchiver;
use std::collections::BTreeMap;
use std::io::Read;

/// Build a small source tree used by both smoke tests:
/// `a.txt` ("hello") at the root and `sub/b.txt` ("world") in a subdirectory.
fn make_src_tree() -> tempfile::TempDir {
    let src = tempfile::tempdir().unwrap();
    std::fs::write(src.path().join("a.txt"), b"hello").unwrap();
    std::fs::create_dir(src.path().join("sub")).unwrap();
    std::fs::write(src.path().join("sub").join("b.txt"), b"world").unwrap();
    src
}

/// Read every entry in a zip archive into a `BTreeMap<name, contents>`.
fn read_zip_entries(path: &std::path::Path) -> BTreeMap<String, String> {
    let file = std::fs::File::open(path).unwrap();
    let mut archive = zip::ZipArchive::new(file).unwrap();
    let mut entries = BTreeMap::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).unwrap();
        let name = entry.name().to_string();
        let mut body = String::new();
        entry.read_to_string(&mut body).unwrap();
        entries.insert(name, body);
    }
    entries
}

#[tokio::test]
async fn compress_folder_produces_a_readable_zip() {
    let src = make_src_tree();

    // Output goes to a separate dir so the zip is not swept into its own walk.
    let out_dir = tempfile::tempdir().unwrap();
    let out_path = out_dir.path().join("out.zip");

    ZipArchiver::new()
        .compress(src.path(), &out_path)
        .await
        .unwrap();

    let entries = read_zip_entries(&out_path);
    assert_eq!(entries.get("a.txt").map(String::as_str), Some("hello"));
    assert_eq!(entries.get("sub/b.txt").map(String::as_str), Some("world"));
}

#[tokio::test]
async fn output_inside_source_is_not_self_included() {
    let src = make_src_tree();

    // The output zip lives INSIDE the source folder — the pathological case.
    let out_path = src.path().join("out.zip");

    ZipArchiver::new()
        .compress(src.path(), &out_path)
        .await
        .unwrap();

    let entries = read_zip_entries(&out_path);
    assert_eq!(entries.get("a.txt").map(String::as_str), Some("hello"));
    assert_eq!(entries.get("sub/b.txt").map(String::as_str), Some("world"));
    // The output zip must not be archived into itself.
    assert!(
        !entries.contains_key("out.zip"),
        "out.zip must not appear inside itself"
    );
}
