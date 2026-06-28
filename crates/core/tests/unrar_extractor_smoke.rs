#![cfg(not(loom))]
//! Integration smoke test for the real `unrar` adapter against a committed fixture.

use simple_archiver_core::application::extract_context::ExtractContext;
use simple_archiver_core::application::ports::Extractor;
use simple_archiver_core::infrastructure::unrar_extractor::UnrarExtractor;
use std::path::Path;

fn fixture() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sample.rar")
}

#[tokio::test]
async fn extracts_fixture_into_a_temp_directory() {
    let extractor = UnrarExtractor::new();
    let tree = extractor
        .extract(&fixture(), &ExtractContext::detached())
        .await
        .expect("extraction succeeds");

    // Fixture contract: a top-level `hello world.txt` = "hello world" (11 bytes, no newline).
    // The committed sample.rar is a real RAR5 archive (user-provided).
    let extracted = std::fs::read_to_string(tree.path().join("hello world.txt"))
        .expect("extracted hello world.txt should exist");
    assert_eq!(extracted, "hello world");
}

#[tokio::test]
async fn temp_directory_is_removed_when_tree_is_dropped() {
    let extractor = UnrarExtractor::new();
    let path = {
        let tree = extractor
            .extract(&fixture(), &ExtractContext::detached())
            .await
            .expect("extraction succeeds");
        tree.path().to_path_buf()
    };
    assert!(
        !path.exists(),
        "temp dir must be cleaned up when the guard drops"
    );
}
