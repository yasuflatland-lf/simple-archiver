//! Integration test that crosses the Tauri `compress_folder` command seam.
//!
//! The `#[tauri::command]` macro wraps `compress_folder` but the original async
//! fn remains directly callable, so we exercise it here just as the generated
//! IPC handler would. This guards the seam against a `src`/`out` transposition
//! or a dropped `map_err` that would otherwise compile and pass every other
//! existing test (the core smoke test calls `ZipArchiver` directly and the
//! frontend test mocks `invoke`).

use std::fs;
use std::io::Read;

use simple_archiver_lib::presentation::commands::compress_folder;

/// Convert a path into the `String` the command expects.
fn path_to_string(path: &std::path::Path) -> String {
    path.to_string_lossy().into_owned()
}

#[tokio::test]
async fn compress_folder_writes_a_readable_zip() {
    // Source directory with a top-level file and a nested file.
    let src_dir = tempfile::tempdir().expect("create src tempdir");
    fs::write(src_dir.path().join("a.txt"), b"hello").expect("write a.txt");
    fs::create_dir(src_dir.path().join("sub")).expect("create sub dir");
    fs::write(src_dir.path().join("sub").join("b.txt"), b"world").expect("write sub/b.txt");

    // Output zip lives in a SEPARATE temp dir so a src/out swap cannot
    // accidentally read its own output.
    let out_dir = tempfile::tempdir().expect("create out tempdir");
    let out_path = out_dir.path().join("out.zip");

    let result = compress_folder(path_to_string(src_dir.path()), path_to_string(&out_path)).await;
    assert_eq!(result, Ok(()), "command should report success");

    // Read the produced archive back with the independent `zip` crate.
    let file = fs::File::open(&out_path).expect("open produced zip");
    let mut archive = zip::ZipArchive::new(file).expect("parse produced zip");

    let mut a = archive.by_name("a.txt").expect("entry a.txt present");
    let mut a_contents = String::new();
    a.read_to_string(&mut a_contents).expect("read a.txt entry");
    assert_eq!(a_contents, "hello");
    drop(a);

    let mut b = archive
        .by_name("sub/b.txt")
        .expect("entry sub/b.txt present");
    let mut b_contents = String::new();
    b.read_to_string(&mut b_contents)
        .expect("read sub/b.txt entry");
    assert_eq!(b_contents, "world");
}

#[tokio::test]
async fn compress_folder_missing_src_is_err() {
    // A src path that does not exist; out points into a real temp dir.
    let missing_src = tempfile::tempdir().expect("create base tempdir");
    let missing_path = missing_src.path().join("does-not-exist");

    let out_dir = tempfile::tempdir().expect("create out tempdir");
    let out_path = out_dir.path().join("out.zip");

    let result = compress_folder(path_to_string(&missing_path), path_to_string(&out_path)).await;

    // The command must surface a `String` error rather than panicking. We do
    // not assert the exact message.
    assert!(result.is_err(), "missing src should yield Err(_)");
}
