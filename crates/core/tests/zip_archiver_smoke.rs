//! Walking-skeleton smoke test: the real `ZipArchiver` over a real filesystem,
//! verified by reading the zip back with the independent `zip` crate.

use simple_archiver_core::application::ports::Archiver;
use simple_archiver_core::infrastructure::zip_archiver::ZipArchiver;
use std::collections::BTreeMap;
use std::io::Read;

#[tokio::test]
async fn compress_folder_produces_a_readable_zip() {
    // Arrange: a small source tree with a nested file.
    let src = tempfile::tempdir().unwrap();
    std::fs::write(src.path().join("a.txt"), b"hello").unwrap();
    std::fs::create_dir(src.path().join("sub")).unwrap();
    std::fs::write(src.path().join("sub").join("b.txt"), b"world").unwrap();

    // Output goes to a separate dir so the zip is not swept into its own walk.
    let out_dir = tempfile::tempdir().unwrap();
    let out_path = out_dir.path().join("out.zip");

    // Act.
    ZipArchiver::new()
        .compress(src.path(), &out_path)
        .await
        .unwrap();

    // Assert: an independent reader extracts the same contents.
    let file = std::fs::File::open(&out_path).unwrap();
    let mut archive = zip::ZipArchive::new(file).unwrap();
    let mut entries = BTreeMap::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).unwrap();
        let name = entry.name().to_string();
        let mut body = String::new();
        entry.read_to_string(&mut body).unwrap();
        entries.insert(name, body);
    }

    assert_eq!(entries.get("a.txt").map(String::as_str), Some("hello"));
    assert_eq!(entries.get("sub/b.txt").map(String::as_str), Some("world"));
}
