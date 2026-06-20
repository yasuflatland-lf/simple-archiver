//! Shared path-component classification for the zip adapters.
//!
//! Both the archiver (`zip_entry_name`) and the extractor (`safe_relative_path`)
//! walk a path's `Component`s and sort each one into the same three buckets, but
//! they apply DIVERGING policies to the result: the archiver silently filters
//! anything that is not a normal component, while the extractor rejects unsafe
//! components with an error. This module owns ONLY the shared classification +
//! iteration primitive; each caller keeps its own policy.

use std::ffi::OsStr;
use std::path::{Component, Path};

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
