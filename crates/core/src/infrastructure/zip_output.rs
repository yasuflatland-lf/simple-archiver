//! Zip output strategy backed by `ZipArchiver`.

use crate::application::compress_context::CompressContext;
use crate::application::ports::{
    ArchiveError, Archiver, OutputStrategy, ProduceError, Produced, Written,
};
use crate::domain::conflict_policy::ConflictPolicy;
use crate::infrastructure::zip_archiver::ZipArchiver;
use std::path::Path;

/// Adapts zip compression to the mode-neutral output port.
///
/// Keeping this policy above `ZipArchiver` lets the engine remain unaware of
/// zip-specific write outcomes while preserving the archiver's focused role.
#[derive(Debug, Default)]
pub struct ZipOutput {
    archiver: ZipArchiver,
}

impl ZipOutput {
    /// Create a zip output strategy.
    pub fn new() -> Self {
        Self {
            archiver: ZipArchiver::new(),
        }
    }
}

impl OutputStrategy for ZipOutput {
    async fn produce(
        &self,
        prepared: &Path,
        desired: Option<&Path>,
        policy: ConflictPolicy,
        ctx: &CompressContext,
    ) -> Result<Produced, ProduceError> {
        let Some(desired) = desired else {
            return Ok(Produced::Nothing);
        };

        self.archiver
            .compress(prepared, desired, policy, ctx)
            .await
            .map(|written| match written {
                Written::At(path) => Produced::At(path),
                Written::KeptExisting(path) => Produced::KeptExisting(path),
            })
            .map_err(|error| match error {
                ArchiveError::Io(error) => ProduceError::Io(error),
                ArchiveError::Backend(message) => ProduceError::Backend(message),
                ArchiveError::Cancelled => ProduceError::Cancelled,
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zip_output_implements_output_strategy() {
        fn assert_strategy<S: OutputStrategy>() {}

        let _ = assert_strategy::<ZipOutput>;
    }
}
