//! Shared path-component classification and atomic destination resolution.
//!
//! Both the archiver (`zip_entry_name`) and the extractor (`safe_relative_path`)
//! walk a path's `Component`s and sort each one into the same three buckets, but
//! they apply DIVERGING policies to the result: the archiver silently filters
//! anything that is not a normal component, while the extractor rejects unsafe
//! components with an error. This module also owns the collision ladder and the
//! shared conflict-policy decision; each output adapter keeps its distinct
//! candidate-naming rule and atomic filesystem primitive.

use crate::domain::conflict_policy::ConflictPolicy;
use std::ffi::OsStr;
use std::future::Future;
use std::path::{Component, Path, PathBuf};

/// Classification of a single path `Component` into the buckets the zip adapters
/// care about. The borrowed `OsStr` in `Normal` ties the lifetime to the path.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum PathPart<'a> {
    /// A normal path segment (a real file/directory name).
    Normal(&'a OsStr),
    /// A component that contributes nothing to a relative path (`.`).
    Ignorable,
    /// A component that could escape the destination root: `..`, an absolute
    /// root, or a Windows drive/UNC prefix.
    Unsafe,
}

/// Classify a single `Component` into a `PathPart`.
///
/// The mapping mirrors the (previously duplicated) `match` arms in the two
/// adapters, so callers can reuse one classification and layer their own policy
/// on top (filter vs. reject).
pub(crate) fn classify(component: Component<'_>) -> PathPart<'_> {
    match component {
        Component::Normal(part) => PathPart::Normal(part),
        Component::CurDir => PathPart::Ignorable,
        Component::ParentDir | Component::RootDir | Component::Prefix(_) => PathPart::Unsafe,
    }
}

/// Iterate the classified components of `path` in order.
///
/// This is the single shared traversal primitive: `path.components()` mapped
/// through [`classify`]. Callers decide what to do with each `PathPart`.
pub(crate) fn classified_components(path: &Path) -> impl Iterator<Item = PathPart<'_>> {
    path.components().map(classify)
}

/// The outcome of trying to claim one candidate path.
pub(crate) enum ClaimResult<T> {
    /// The candidate was claimed; carries whatever the claim produced (an open
    /// file handle for the archiver, `()` for the placer).
    Claimed(T),
    /// The candidate is already taken — try the next rung of the ladder.
    Taken,
}

/// The shared result of resolving a destination conflict policy.
pub(crate) enum Resolution<T> {
    /// Write to the claimed path using the value produced while claiming it.
    Write(PathBuf, T),
    /// Leave the existing path untouched and perform no write.
    SkipExisting(PathBuf),
}

/// Claim `desired` if it is free, otherwise the first `candidate(n)` (from
/// `n = 2`) that `claim` succeeds on. Returns the claimed path together with
/// whatever `claim` produced.
///
/// Unlike a probe-then-write sequence, `claim` must both TEST and TAKE the path
/// in one filesystem operation (`create_new(true)` / `create_dir`), so two
/// concurrent workers can never both believe they own the same rung.
///
/// A `Taken` result advances to the next rung. Every error propagates immediately,
/// and exhausting all rungs returns `AlreadyExists`.
pub(crate) async fn claim_free_path<T, F, Fut>(
    desired: &Path,
    candidate: impl Fn(u32) -> PathBuf,
    claim: F,
) -> std::io::Result<(PathBuf, T)>
where
    F: Fn(PathBuf) -> Fut,
    Fut: Future<Output = std::io::Result<ClaimResult<T>>>,
{
    for path in candidate_paths(desired, candidate) {
        match claim(path.clone()).await? {
            ClaimResult::Claimed(value) => return Ok((path, value)),
            ClaimResult::Taken => {}
        }
    }

    Err(ladder_exhausted(desired))
}

/// Blocking twin of [`claim_free_path`] for adapters already running inside
/// `spawn_blocking`. It follows the exact same candidate ladder and error policy.
pub(crate) fn claim_free_path_blocking<T, F>(
    desired: &Path,
    candidate: impl Fn(u32) -> PathBuf,
    claim: F,
) -> std::io::Result<(PathBuf, T)>
where
    F: Fn(PathBuf) -> std::io::Result<ClaimResult<T>>,
{
    for path in candidate_paths(desired, candidate) {
        match claim(path.clone())? {
            ClaimResult::Claimed(value) => return Ok((path, value)),
            ClaimResult::Taken => {}
        }
    }

    Err(ladder_exhausted(desired))
}

/// Resolve one destination using the shared conflict-policy decision.
///
/// The candidate builder remains adapter-specific, while `claim` must atomically
/// test and take a path. `remove_existing` is used only for `Overwrite`; a missing
/// destination is ignored, but every other removal error propagates.
pub(crate) async fn resolve_path<T, F, Fut, R, RemoveFut>(
    desired: &Path,
    policy: ConflictPolicy,
    candidate: impl Fn(u32) -> PathBuf,
    claim: F,
    remove_existing: R,
) -> std::io::Result<Resolution<T>>
where
    F: Fn(PathBuf) -> Fut,
    Fut: Future<Output = std::io::Result<ClaimResult<T>>>,
    R: Fn(PathBuf) -> RemoveFut,
    RemoveFut: Future<Output = std::io::Result<()>>,
{
    match resolution_plan(policy) {
        ResolutionPlan::ClaimLadder => {
            let (path, value) = claim_free_path(desired, candidate, claim).await?;
            Ok(Resolution::Write(path, value))
        }
        ResolutionPlan::ClaimOnceOrSkip => match claim(desired.to_path_buf()).await? {
            ClaimResult::Claimed(value) => Ok(Resolution::Write(desired.to_path_buf(), value)),
            ClaimResult::Taken => Ok(Resolution::SkipExisting(desired.to_path_buf())),
        },
        ResolutionPlan::RemoveThenClaimOnce => {
            remove_ignoring_not_found(remove_existing(desired.to_path_buf()).await)?;
            match claim(desired.to_path_buf()).await? {
                ClaimResult::Claimed(value) => Ok(Resolution::Write(desired.to_path_buf(), value)),
                ClaimResult::Taken => Err(path_taken(desired)),
            }
        }
    }
}

/// Blocking twin of [`resolve_path`] for the folder placer.
pub(crate) fn resolve_path_blocking<T, F, R>(
    desired: &Path,
    policy: ConflictPolicy,
    candidate: impl Fn(u32) -> PathBuf,
    claim: F,
    remove_existing: R,
) -> std::io::Result<Resolution<T>>
where
    F: Fn(PathBuf) -> std::io::Result<ClaimResult<T>>,
    R: Fn(PathBuf) -> std::io::Result<()>,
{
    match resolution_plan(policy) {
        ResolutionPlan::ClaimLadder => {
            let (path, value) = claim_free_path_blocking(desired, candidate, claim)?;
            Ok(Resolution::Write(path, value))
        }
        ResolutionPlan::ClaimOnceOrSkip => match claim(desired.to_path_buf())? {
            ClaimResult::Claimed(value) => Ok(Resolution::Write(desired.to_path_buf(), value)),
            ClaimResult::Taken => Ok(Resolution::SkipExisting(desired.to_path_buf())),
        },
        ResolutionPlan::RemoveThenClaimOnce => {
            remove_ignoring_not_found(remove_existing(desired.to_path_buf()))?;
            match claim(desired.to_path_buf())? {
                ClaimResult::Claimed(value) => Ok(Resolution::Write(desired.to_path_buf(), value)),
                ClaimResult::Taken => Err(path_taken(desired)),
            }
        }
    }
}

/// Materialize the one shared ladder policy for both claim primitives.
fn candidate_paths(
    desired: &Path,
    candidate: impl Fn(u32) -> PathBuf,
) -> impl Iterator<Item = PathBuf> {
    std::iter::once(desired.to_path_buf()).chain((2..=u32::MAX).map(candidate))
}

enum ResolutionPlan {
    ClaimLadder,
    ClaimOnceOrSkip,
    RemoveThenClaimOnce,
}

/// Translate the domain policy once so both sync and async adapters share the
/// same three-way decision without duplicating a `ConflictPolicy` match.
fn resolution_plan(policy: ConflictPolicy) -> ResolutionPlan {
    match policy {
        ConflictPolicy::AutoRename => ResolutionPlan::ClaimLadder,
        ConflictPolicy::Skip => ResolutionPlan::ClaimOnceOrSkip,
        ConflictPolicy::Overwrite => ResolutionPlan::RemoveThenClaimOnce,
    }
}

fn remove_ignoring_not_found(result: std::io::Result<()>) -> std::io::Result<()> {
    match result {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err),
    }
}

fn path_taken(path: &Path) -> std::io::Error {
    std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        format!(
            "destination was claimed concurrently after removal: {}",
            path.display()
        ),
    )
}

fn ladder_exhausted(desired: &Path) -> std::io::Error {
    std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        format!(
            "no free destination remained in the candidate ladder for {}",
            desired.display()
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_each_component_kind() {
        // `./b/../c` keeps a leading `.` (CurDir) that `Path::components()` does
        // NOT collapse, so this input exercises all three arms: Ignorable (`.`),
        // Normal (`b`, `c`), and Unsafe (`..`).
        let parts: Vec<PathPart<'_>> = classified_components(Path::new("./b/../c")).collect();
        assert_eq!(
            parts,
            vec![
                PathPart::Ignorable,
                PathPart::Normal(OsStr::new("b")),
                PathPart::Unsafe,
                PathPart::Normal(OsStr::new("c")),
            ]
        );
    }

    #[test]
    fn absolute_root_is_unsafe() {
        // The leading `/` is a RootDir component and must classify as unsafe so
        // the extractor can reject absolute entry names.
        let parts: Vec<PathPart<'_>> = classified_components(Path::new("/etc/passwd")).collect();
        assert_eq!(parts.first(), Some(&PathPart::Unsafe));
        assert!(parts.contains(&PathPart::Normal(OsStr::new("etc"))));
        assert!(parts.contains(&PathPart::Normal(OsStr::new("passwd"))));
    }

    #[test]
    fn plain_relative_path_is_all_normal() {
        let parts: Vec<PathPart<'_>> = classified_components(Path::new("sub/file.txt")).collect();
        assert_eq!(
            parts,
            vec![
                PathPart::Normal(OsStr::new("sub")),
                PathPart::Normal(OsStr::new("file.txt")),
            ]
        );
    }
}

#[cfg(test)]
mod claim_free_path_tests {
    use super::*;
    use std::collections::HashSet;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    /// Build the n-th Folder-mode candidate: append ` (n)` to the whole final
    /// component (mirrors `FsPlacer`).
    fn append_to_name(parent: &Path, base: &str, n: u32) -> PathBuf {
        parent.join(format!("{base} ({n})"))
    }

    fn claim_in_memory(
        occupied: &Arc<Mutex<HashSet<PathBuf>>>,
        path: PathBuf,
    ) -> std::io::Result<ClaimResult<()>> {
        if occupied.lock().unwrap().insert(path) {
            Ok(ClaimResult::Claimed(()))
        } else {
            Ok(ClaimResult::Taken)
        }
    }

    #[tokio::test]
    async fn async_claims_desired_when_free() {
        let dir = tempfile::tempdir().unwrap();
        let desired = dir.path().join("foo");
        let occupied = Arc::new(Mutex::new(HashSet::new()));

        let claimed = Arc::clone(&occupied);
        let (path, ()) = claim_free_path(
            &desired,
            |n| append_to_name(dir.path(), "foo", n),
            move |path| {
                let claimed = Arc::clone(&claimed);
                async move { claim_in_memory(&claimed, path) }
            },
        )
        .await
        .unwrap();

        assert_eq!(path, desired);
    }

    #[tokio::test]
    async fn async_claims_first_sibling_when_desired_is_taken() {
        let dir = tempfile::tempdir().unwrap();
        let desired = dir.path().join("foo");
        let occupied = Arc::new(Mutex::new(HashSet::from([desired.clone()])));

        let claimed = Arc::clone(&occupied);
        let (path, ()) = claim_free_path(
            &desired,
            |n| append_to_name(dir.path(), "foo", n),
            move |path| {
                let claimed = Arc::clone(&claimed);
                async move { claim_in_memory(&claimed, path) }
            },
        )
        .await
        .unwrap();

        assert_eq!(path, dir.path().join("foo (2)"));
    }

    #[tokio::test]
    async fn async_advances_past_multiple_collisions() {
        let dir = tempfile::tempdir().unwrap();
        let desired = dir.path().join("foo");
        let occupied = Arc::new(Mutex::new(HashSet::from([
            desired.clone(),
            dir.path().join("foo (2)"),
        ])));

        let claimed = Arc::clone(&occupied);
        let (path, ()) = claim_free_path(
            &desired,
            |n| append_to_name(dir.path(), "foo", n),
            move |path| {
                let claimed = Arc::clone(&claimed);
                async move { claim_in_memory(&claimed, path) }
            },
        )
        .await
        .unwrap();

        assert_eq!(path, dir.path().join("foo (3)"));
    }

    #[tokio::test]
    async fn async_propagates_error_without_advancing() {
        let dir = tempfile::tempdir().unwrap();
        let desired = dir.path().join("foo");
        let candidate_calls = AtomicUsize::new(0);

        let err = claim_free_path(
            &desired,
            |n| {
                candidate_calls.fetch_add(1, Ordering::SeqCst);
                append_to_name(dir.path(), "foo", n)
            },
            |_| async {
                Err::<ClaimResult<()>, _>(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "denied",
                ))
            },
        )
        .await
        .unwrap_err();

        assert_eq!(err.kind(), std::io::ErrorKind::PermissionDenied);
        assert_eq!(candidate_calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn blocking_claims_desired_when_free() {
        let dir = tempfile::tempdir().unwrap();
        let desired = dir.path().join("foo");
        let occupied = Arc::new(Mutex::new(HashSet::new()));

        let claimed = Arc::clone(&occupied);
        let (path, ()) = claim_free_path_blocking(
            &desired,
            |n| append_to_name(dir.path(), "foo", n),
            move |path| claim_in_memory(&claimed, path),
        )
        .unwrap();

        assert_eq!(path, desired);
    }

    #[test]
    fn blocking_claims_first_sibling_when_desired_is_taken() {
        let dir = tempfile::tempdir().unwrap();
        let desired = dir.path().join("foo");
        let occupied = Arc::new(Mutex::new(HashSet::from([desired.clone()])));

        let claimed = Arc::clone(&occupied);
        let (path, ()) = claim_free_path_blocking(
            &desired,
            |n| append_to_name(dir.path(), "foo", n),
            move |path| claim_in_memory(&claimed, path),
        )
        .unwrap();

        assert_eq!(path, dir.path().join("foo (2)"));
    }

    #[test]
    fn blocking_advances_past_multiple_collisions() {
        let dir = tempfile::tempdir().unwrap();
        let desired = dir.path().join("foo");
        let occupied = Arc::new(Mutex::new(HashSet::from([
            desired.clone(),
            dir.path().join("foo (2)"),
        ])));

        let claimed = Arc::clone(&occupied);
        let (path, ()) = claim_free_path_blocking(
            &desired,
            |n| append_to_name(dir.path(), "foo", n),
            move |path| claim_in_memory(&claimed, path),
        )
        .unwrap();

        assert_eq!(path, dir.path().join("foo (3)"));
    }

    #[test]
    fn blocking_propagates_error_without_advancing() {
        let dir = tempfile::tempdir().unwrap();
        let desired = dir.path().join("foo");
        let candidate_calls = AtomicUsize::new(0);

        let err = claim_free_path_blocking(
            &desired,
            |n| {
                candidate_calls.fetch_add(1, Ordering::SeqCst);
                append_to_name(dir.path(), "foo", n)
            },
            |_| {
                Err::<ClaimResult<()>, _>(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "denied",
                ))
            },
        )
        .unwrap_err();

        assert_eq!(err.kind(), std::io::ErrorKind::PermissionDenied);
        assert_eq!(candidate_calls.load(Ordering::SeqCst), 0);
    }
}
