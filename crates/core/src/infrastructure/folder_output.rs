//! Folder output strategy backed by `FsPlacer`.

use crate::application::compress_context::CompressContext;
use crate::application::ports::{
    OutputStrategy, PlaceError, Placer, ProduceError, Produced, Written,
};
use crate::domain::conflict_policy::ConflictPolicy;
use crate::infrastructure::fs_placer::FsPlacer;
use std::path::Path;

/// Adapts tree placement to the mode-neutral output port.
///
/// Keeping this policy above `FsPlacer` lets the engine share one output flow
/// without expanding the placer's focused responsibility to progress reporting.
#[derive(Debug, Default)]
pub struct FolderOutput {
    placer: FsPlacer,
}

impl FolderOutput {
    /// Create a folder output strategy.
    pub fn new() -> Self {
        Self {
            placer: FsPlacer::new(),
        }
    }
}

impl OutputStrategy for FolderOutput {
    async fn produce(
        &self,
        prepared: &Path,
        desired: Option<&Path>,
        policy: ConflictPolicy,
        _ctx: &CompressContext,
    ) -> Result<Produced, ProduceError> {
        let Some(desired) = desired else {
            return Ok(Produced::Nothing);
        };

        self.placer
            .place(prepared, desired, policy)
            .await
            .map(|written| match written {
                Written::At(path) => Produced::At(path),
                Written::KeptExisting(path) => Produced::KeptExisting(path),
            })
            .map_err(|error| match error {
                PlaceError::Io(error) => ProduceError::Io(error),
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_output_implements_output_strategy() {
        fn assert_strategy<S: OutputStrategy>() {}

        let _ = assert_strategy::<FolderOutput>;
    }
}
