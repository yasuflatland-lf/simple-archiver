#![cfg(not(loom))]
//! Integration smoke test for the real `unrar` adapter against a committed fixture.

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
        .extract(&fixture())
        .await
        .expect("extraction succeeds");

    // Fixture contract (see plan Prerequisites): a top-level `hello.txt` = "hello rar\n".
    let extracted = std::fs::read_to_string(tree.path().join("hello.txt"))
        .expect("extracted hello.txt should exist");
    assert_eq!(extracted, "hello rar\n");
}

#[tokio::test]
async fn temp_directory_is_removed_when_tree_is_dropped() {
    let extractor = UnrarExtractor::new();
    let path = {
        let tree = extractor
            .extract(&fixture())
            .await
            .expect("extraction succeeds");
        tree.path().to_path_buf()
    };
    assert!(
        !path.exists(),
        "temp dir must be cleaned up when the guard drops"
    );
}
