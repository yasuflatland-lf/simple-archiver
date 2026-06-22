//! Shared path-component classification for the zip adapters.
//!
//! Both the archiver (`zip_entry_name`) and the extractor (`safe_relative_path`)
//! walk a path's `Component`s and sort each one into the same three buckets, but
//! they apply DIVERGING policies to the result: the archiver silently filters
//! anything that is not a normal component, while the extractor rejects unsafe
//! components with an error. This module owns ONLY the shared classification +
//! iteration primitive; each caller keeps its own policy.

use std::ffi::OsStr;
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

/// Return `desired` unchanged when it is free, otherwise the first candidate
/// produced by `candidate(n)` (starting at `n = 2`) whose path does not yet
/// exist. The counter starts at 2 so the first alternative reads "… (2)".
///
/// `candidate` lets each caller decide HOW to fold the counter into the name
/// (the Folder placer appends ` (n)` to the whole final component; the Zip
/// archiver inserts ` (n)` before the file extension), while this helper owns
/// the shared loop, the `u32::MAX` bound, and the unreachable fallback.
///
/// This is a pure path-string helper: the only IO is the same `Path::exists()`
/// probe the two adapters already performed.
pub(crate) fn next_free_path(desired: &Path, candidate: impl Fn(u32) -> PathBuf) -> PathBuf {
    if !desired.exists() {
        return desired.to_path_buf();
    }
    // Counter starts at 2 so the first alternative reads "… (2)".
    for n in 2..=u32::MAX {
        let path = candidate(n);
        if !path.exists() {
            return path;
        }
    }
    // Astronomically unreachable; fall back to the desired path.
    desired.to_path_buf()
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
mod next_free_path_tests {
    use super::*;
    use std::path::PathBuf;

    /// Build the n-th Folder-mode candidate: append ` (n)` to the whole final
    /// component (mirrors `FsPlacer`).
    fn append_to_name(parent: &Path, base: &str, n: u32) -> PathBuf {
        parent.join(format!("{base} ({n})"))
    }

    /// Build the n-th Zip-mode candidate: insert ` (n)` before the extension
    /// (mirrors `ZipArchiver`).
    fn before_extension(parent: &Path, stem: &str, ext: &str, n: u32) -> PathBuf {
        parent.join(format!("{stem} ({n}).{ext}"))
    }

    #[test]
    fn returns_desired_unchanged_when_free() {
        let dir = tempfile::tempdir().unwrap();
        let desired = dir.path().join("foo");
        let got = next_free_path(&desired, |n| append_to_name(dir.path(), "foo", n));
        assert_eq!(got, desired);
    }

    #[test]
    fn append_to_name_picks_first_free_sibling() {
        let dir = tempfile::tempdir().unwrap();
        let desired = dir.path().join("foo");
        std::fs::create_dir(&desired).unwrap();
        let got = next_free_path(&desired, |n| append_to_name(dir.path(), "foo", n));
        assert_eq!(got, dir.path().join("foo (2)"));
    }

    #[test]
    fn before_extension_preserves_the_suffix() {
        let dir = tempfile::tempdir().unwrap();
        let desired = dir.path().join("o.zip");
        std::fs::write(&desired, b"x").unwrap();
        let got = next_free_path(&desired, |n| before_extension(dir.path(), "o", "zip", n));
        assert_eq!(got, dir.path().join("o (2).zip"));
    }

    #[test]
    fn advances_past_multiple_collisions() {
        // Both `foo` and `foo (2)` already exist, so the counter must reach 3.
        let dir = tempfile::tempdir().unwrap();
        let desired = dir.path().join("foo");
        std::fs::create_dir(&desired).unwrap();
        std::fs::create_dir(dir.path().join("foo (2)")).unwrap();
        let got = next_free_path(&desired, |n| append_to_name(dir.path(), "foo", n));
        assert_eq!(got, dir.path().join("foo (3)"));
    }
}
