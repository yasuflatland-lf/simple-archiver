//! `FsPlacer`: a `Placer` that recursively copies an extracted tree into the
//! output directory, never overwriting an existing entry (auto-renaming on
//! collision). Blocking filesystem work runs on a `spawn_blocking` thread so the
//! async engine is never blocked.

use crate::application::ports::{PlaceError, Placer};
use crate::domain::conflict_policy::ConflictPolicy;
use crate::infrastructure::path_utils::{resolve_path_blocking, ClaimResult, Resolution};
use std::path::{Path, PathBuf};

/// Copies extracted trees into the output directory without overwriting.
#[derive(Debug, Default)]
pub struct FsPlacer;

impl FsPlacer {
    /// Create a new placer.
    pub fn new() -> Self {
        Self
    }
}

impl Placer for FsPlacer {
    async fn place(
        &self,
        src_tree: &Path,
        desired_dest: &Path,
        policy: ConflictPolicy,
    ) -> Result<PathBuf, PlaceError> {
        let src = src_tree.to_path_buf();
        let desired = desired_dest.to_path_buf();
        // Blocking std::fs work off the async runtime; flatten JoinError into Io.
        tokio::task::spawn_blocking(move || place_blocking(&src, &desired, policy))
            .await
            .map_err(|e| PlaceError::Io(std::io::Error::other(e)))?
    }
}

/// Atomically resolve and claim the destination, then copy `src` into it.
fn place_blocking(
    src: &Path,
    desired: &Path,
    policy: ConflictPolicy,
) -> Result<PathBuf, PlaceError> {
    let resolution = resolve_path_blocking(
        desired,
        policy,
        |n| renamed_folder_candidate(desired, n),
        claim_directory,
        std::fs::remove_dir_all,
    )?;

    match resolution {
        Resolution::Write(dest, ()) => {
            copy_tree_or_cleanup(src, &dest)?;
            Ok(dest)
        }
        // Leave the existing folder untouched; nothing is copied.
        Resolution::SkipExisting(path) => Ok(path),
    }
}

/// Atomically claim a directory path. Only `AlreadyExists` means the ladder may
/// advance; every other filesystem error must fail the task at this exact path.
fn claim_directory(path: PathBuf) -> std::io::Result<ClaimResult<()>> {
    match std::fs::create_dir(&path) {
        Ok(()) => Ok(ClaimResult::Claimed(())),
        Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => Ok(ClaimResult::Taken),
        Err(err) => Err(err),
    }
}

/// Copy `src` into `dest`; on failure best-effort remove the partial `dest` this
/// call created, mirroring `ZipArchiver`'s partial-output cleanup, so a failed
/// task never leaves a half-copied tree that looks like complete output.
fn copy_tree_or_cleanup(src: &Path, dest: &Path) -> Result<(), PlaceError> {
    if let Err(e) = copy_tree(src, dest) {
        // Best-effort: removal errors are intentionally swallowed (a logging
        // pass is deferred, matching `remove_partial_output`).
        let _ = std::fs::remove_dir_all(dest);
        return Err(PlaceError::Io(e));
    }
    Ok(())
}

/// Build `desired (n)` by appending the counter to the whole final component.
fn renamed_folder_candidate(desired: &Path, n: u32) -> PathBuf {
    let parent = desired.parent().unwrap_or_else(|| Path::new("."));
    let base = desired
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "archive".to_string());
    parent.join(format!("{base} ({n})"))
}

/// Fill the already-claimed directory `dest` with the tree at `src`.
fn copy_tree(src: &Path, dest: &Path) -> std::io::Result<()> {
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dest.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            // Only nested directories use `create_dir_all`; the destination root
            // was already atomically claimed with `create_dir`.
            std::fs::create_dir_all(&to)?;
            copy_tree(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a temp source tree: `root/a.txt` + `root/sub/b.txt`.
    fn make_source_tree() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), b"alpha").unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("sub").join("b.txt"), b"beta").unwrap();
        dir
    }

    #[tokio::test]
    async fn places_tree_into_fresh_dest_and_copies_all_files() {
        let src = make_source_tree();
        let out = tempfile::tempdir().unwrap();
        let dest = out.path().join("foo");

        let final_path = FsPlacer::new()
            .place(src.path(), &dest, ConflictPolicy::AutoRename)
            .await
            .unwrap();

        assert_eq!(final_path, dest);
        assert_eq!(std::fs::read(dest.join("a.txt")).unwrap(), b"alpha");
        assert_eq!(
            std::fs::read(dest.join("sub").join("b.txt")).unwrap(),
            b"beta"
        );
    }

    #[tokio::test]
    async fn does_not_overwrite_and_auto_renames_on_collision() {
        let src = make_source_tree();
        let out = tempfile::tempdir().unwrap();
        let dest = out.path().join("foo");
        // Pre-create the desired dest with a sentinel file.
        std::fs::create_dir(&dest).unwrap();
        std::fs::write(dest.join("keep.txt"), b"original").unwrap();

        let final_path = FsPlacer::new()
            .place(src.path(), &dest, ConflictPolicy::AutoRename)
            .await
            .unwrap();

        // The original is untouched; the new tree landed in "foo (2)".
        assert_eq!(final_path, out.path().join("foo (2)"));
        assert_eq!(std::fs::read(dest.join("keep.txt")).unwrap(), b"original");
        assert_eq!(std::fs::read(final_path.join("a.txt")).unwrap(), b"alpha");
    }

    #[tokio::test]
    async fn skip_returns_existing_path_without_copying() {
        let src = make_source_tree();
        let out = tempfile::tempdir().unwrap();
        let dest = out.path().join("foo");
        // Pre-create the desired dest with a sentinel file and no source files.
        std::fs::create_dir(&dest).unwrap();
        std::fs::write(dest.join("keep.txt"), b"original").unwrap();

        let final_path = FsPlacer::new()
            .place(src.path(), &dest, ConflictPolicy::Skip)
            .await
            .unwrap();

        // Skip returns the existing path untouched: no copy happened, so the
        // source files are absent and only the sentinel remains.
        assert_eq!(final_path, dest);
        assert_eq!(std::fs::read(dest.join("keep.txt")).unwrap(), b"original");
        assert!(
            !dest.join("a.txt").exists(),
            "Skip must not copy the source tree into an existing dest"
        );
        // No auto-rename sibling was created either.
        assert!(!out.path().join("foo (2)").exists());
    }

    #[tokio::test]
    async fn overwrite_replaces_existing() {
        let src = make_source_tree();
        let out = tempfile::tempdir().unwrap();
        let dest = out.path().join("foo");
        // Pre-create the desired dest with a sentinel file that must be removed.
        std::fs::create_dir(&dest).unwrap();
        std::fs::write(dest.join("keep.txt"), b"original").unwrap();

        let final_path = FsPlacer::new()
            .place(src.path(), &dest, ConflictPolicy::Overwrite)
            .await
            .unwrap();

        // Overwrite removes the existing dir then extracts in place: the sentinel
        // is gone and the source files are now present at the original path.
        assert_eq!(final_path, dest);
        assert!(
            !dest.join("keep.txt").exists(),
            "Overwrite must remove the pre-existing contents"
        );
        assert_eq!(std::fs::read(dest.join("a.txt")).unwrap(), b"alpha");
        assert_eq!(
            std::fs::read(dest.join("sub").join("b.txt")).unwrap(),
            b"beta"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn concurrent_auto_rename_placements_never_merge_source_trees() {
        let src_a = tempfile::tempdir().unwrap();
        std::fs::write(src_a.path().join("a.txt"), b"alpha").unwrap();
        let src_b = tempfile::tempdir().unwrap();
        std::fs::write(src_b.path().join("b.txt"), b"beta").unwrap();
        let out = tempfile::tempdir().unwrap();
        let placer = FsPlacer::new();
        let desired_a = out.path().join("foo");
        let desired_b = out.path().join("foo (2)");
        std::fs::create_dir(&desired_a).unwrap();
        let start = tokio::sync::Barrier::new(2);

        // Align both calls at the blocking boundary so the old probe-then-write
        // implementation lets both workers observe the same free rung.
        let place_a = async {
            start.wait().await;
            tokio::task::yield_now().await;
            placer
                .place(src_a.path(), &desired_a, ConflictPolicy::AutoRename)
                .await
        };
        let place_b = async {
            start.wait().await;
            tokio::task::yield_now().await;
            placer
                .place(src_b.path(), &desired_b, ConflictPolicy::AutoRename)
                .await
        };
        let (placed_a, placed_b) = tokio::join!(place_a, place_b);
        let placed_a = placed_a.unwrap();
        let placed_b = placed_b.unwrap();

        assert_ne!(
            placed_a, placed_b,
            "concurrent workers must claim distinct destination directories"
        );
        assert_eq!(std::fs::read(placed_a.join("a.txt")).unwrap(), b"alpha");
        assert!(
            !placed_a.join("b.txt").exists(),
            "the first destination must contain only the first source tree"
        );
        assert_eq!(std::fs::read(placed_b.join("b.txt")).unwrap(), b"beta");
        assert!(
            !placed_b.join("a.txt").exists(),
            "the second destination must contain only the second source tree"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn auto_rename_propagates_permission_denied_without_advancing() {
        use std::os::unix::fs::PermissionsExt as _;
        let src = make_source_tree();
        let out = tempfile::tempdir().unwrap();
        let desired = out.path().join("foo");
        std::fs::set_permissions(out.path(), std::fs::Permissions::from_mode(0o555)).unwrap();

        let result = FsPlacer::new()
            .place(src.path(), &desired, ConflictPolicy::AutoRename)
            .await;

        // Restore permissions before asserting so `TempDir` can always clean up.
        std::fs::set_permissions(out.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
        let err = result.unwrap_err();
        match err {
            PlaceError::Io(err) => {
                assert_eq!(err.kind(), std::io::ErrorKind::PermissionDenied);
            }
        }
        assert!(
            !out.path().join("foo (2)").exists(),
            "a permission error must not advance to a renamed sibling"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn copy_error_removes_the_partial_destination() {
        use std::os::unix::fs::PermissionsExt as _;
        let src = tempfile::tempdir().unwrap();
        std::fs::write(src.path().join("a.txt"), b"alpha").unwrap();
        let locked = src.path().join("locked.bin");
        std::fs::write(&locked, b"x").unwrap();
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap();

        let out = tempfile::tempdir().unwrap();
        let dest = out.path().join("foo");

        let err = FsPlacer::new()
            .place(src.path(), &dest, ConflictPolicy::AutoRename)
            .await
            .unwrap_err();

        assert!(matches!(err, PlaceError::Io(_)), "got {err:?}");
        assert!(
            !dest.exists(),
            "a placement error must not leave a partial destination tree"
        );

        // Restore perms so the TempDir can clean up.
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o644)).unwrap();
    }
}
