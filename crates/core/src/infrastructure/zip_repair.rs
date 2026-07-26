//! Repairs zip archives whose extra fields `async_zip` refuses to parse.
//!
//! Some Windows repackers emit a proprietary extra-field subfield whose declared
//! data size overruns the field it lives in. `unzip`, macOS and 7-Zip ignore an
//! unparseable extra field; `async_zip` instead fails the whole archive (and, with
//! overflow checks on, panics while building that error), so an otherwise valid
//! archive cannot be opened at all.
//!
//! This module scans an archive for such subfields and, when it finds any, writes
//! a repaired copy with each offending declared size CLAMPED to the bytes actually
//! present. Clamping rewrites two bytes in place, so every local-header, central
//! directory and end-of-central-directory offset stays valid and the entry data is
//! untouched — the copy differs from the original only in those size fields.

use crate::infrastructure::temp_workspace::TempWorkspace;
use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

/// A repaired copy of an archive. `Drop` removes it along with its temp directory.
#[derive(Debug)]
pub(crate) struct RepairedZip {
    // Held for its `Drop`: it owns the temp directory `path` lives in.
    _workspace: TempWorkspace,
    path: PathBuf,
}

impl RepairedZip {
    /// The path of the repaired copy, valid until this guard drops.
    pub(crate) fn path(&self) -> &Path {
        &self.path
    }
}

/// Scan `src` for extra fields whose declared subfield size overruns the field and,
/// if there are any, write a repaired copy with those sizes clamped.
///
/// Returns `Ok(None)` when the archive needs no repair — nothing is copied, so the
/// common case costs one central-directory read and one small read per entry.
/// A scan that cannot proceed confidently (no end-of-central-directory record, a
/// zip64 archive, an unexpected header signature) also yields `Ok(None)`, leaving
/// the original archive for `async_zip` to accept or reject on its own terms.
pub(crate) async fn repair_extra_fields(src: &Path) -> std::io::Result<Option<RepairedZip>> {
    let fixups = scan_fixups(src).await?;
    if fixups.is_empty() {
        return Ok(None);
    }

    let workspace = TempWorkspace::new()?;
    let path = workspace.path().join(REPAIRED_FILE_NAME);
    tokio::fs::copy(src, &path).await?;

    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .open(&path)
        .await?;
    for (offset, clamped) in fixups {
        file.seek(SeekFrom::Start(offset)).await?;
        file.write_all(&clamped.to_le_bytes()).await?;
    }
    file.flush().await?;

    Ok(Some(RepairedZip {
        _workspace: workspace,
        path,
    }))
}

/// Name given to the repaired copy inside its temp directory.
const REPAIRED_FILE_NAME: &str = "repaired.zip";

/// Signatures and fixed header lengths from the zip spec (APPNOTE 4.3.7/4.3.12/4.3.16).
const LOCAL_HEADER_SIGNATURE: [u8; 4] = [b'P', b'K', 3, 4];
const CD_ENTRY_SIGNATURE: [u8; 4] = [b'P', b'K', 1, 2];
const EOCD_SIGNATURE: [u8; 4] = [b'P', b'K', 5, 6];
const LOCAL_HEADER_FIXED_LEN: usize = 30;
const CD_ENTRY_FIXED_LEN: usize = 46;
const EOCD_FIXED_LEN: usize = 22;
/// Values replaced by these sentinels live in a zip64 record instead.
const ZIP64_SENTINEL_U16: u16 = u16::MAX;
const ZIP64_SENTINEL_U32: u32 = u32::MAX;

/// Absolute file offset of a 2-byte declared-size field, and the size to write there.
type Fixup = (u64, u16);

/// Collect the size fields that need clamping, in both the central directory and
/// the local headers (`async_zip` parses the extra fields of both).
///
/// An empty result means "nothing to repair" and is also what every give-up path
/// returns: this scan is an opportunistic repair, so anything it cannot walk with
/// confidence is left to `async_zip`.
///
/// The offset arithmetic below cannot overflow: the record rejects the zip64
/// sentinels, so the central directory is at most `u32::MAX` bytes long and every
/// length read out of a header is `u16`-bounded — sums stay far inside a 64-bit
/// `usize`. That is the very trap this module exists to work around, so it is
/// worth stating rather than assuming.
async fn scan_fixups(src: &Path) -> std::io::Result<Vec<Fixup>> {
    let mut file = tokio::fs::File::open(src).await?;
    let file_len = file.metadata().await?.len();

    let Some((cd_offset, cd_len, entries)) = read_eocd(&mut file, file_len).await? else {
        return Ok(Vec::new());
    };
    if cd_offset + cd_len > file_len {
        return Ok(Vec::new());
    }

    let mut cd = vec![0u8; cd_len as usize];
    file.seek(SeekFrom::Start(cd_offset)).await?;
    file.read_exact(&mut cd).await?;

    let mut fixups = Vec::new();
    let mut local_offsets = Vec::with_capacity(entries);
    let mut pos = 0usize;
    for _ in 0..entries {
        if pos + CD_ENTRY_FIXED_LEN > cd.len() || cd[pos..pos + 4] != CD_ENTRY_SIGNATURE {
            return Ok(Vec::new());
        }
        let name_len = le_u16(&cd, pos + 28) as usize;
        let extra_len = le_u16(&cd, pos + 30) as usize;
        let comment_len = le_u16(&cd, pos + 32) as usize;
        let local_offset = le_u32(&cd, pos + 42);
        let extra_start = pos + CD_ENTRY_FIXED_LEN + name_len;
        if extra_start + extra_len + comment_len > cd.len() || local_offset == ZIP64_SENTINEL_U32 {
            return Ok(Vec::new());
        }

        if let Some((at, clamped)) = overrunning_subfield(&cd[extra_start..extra_start + extra_len])
        {
            fixups.push((cd_offset + (extra_start + at) as u64, clamped));
        }
        local_offsets.push(u64::from(local_offset));
        pos = extra_start + extra_len + comment_len;
    }

    for local_offset in local_offsets {
        match local_header_fixup(&mut file, file_len, local_offset).await? {
            Some(Some(fixup)) => fixups.push(fixup),
            Some(None) => {}               // header read fine, nothing to clamp
            None => return Ok(Vec::new()), // unwalkable header: give up entirely
        }
    }

    Ok(fixups)
}

/// Inspect the local header at `offset`. The outer `None` means the header could
/// not be walked; the inner `None` means it holds nothing that needs clamping.
async fn local_header_fixup(
    file: &mut tokio::fs::File,
    file_len: u64,
    offset: u64,
) -> std::io::Result<Option<Option<Fixup>>> {
    if offset + LOCAL_HEADER_FIXED_LEN as u64 > file_len {
        return Ok(None);
    }
    let mut header = [0u8; LOCAL_HEADER_FIXED_LEN];
    file.seek(SeekFrom::Start(offset)).await?;
    file.read_exact(&mut header).await?;
    if header[0..4] != LOCAL_HEADER_SIGNATURE {
        return Ok(None);
    }

    let name_len = u64::from(le_u16(&header, 26));
    let extra_len = le_u16(&header, 28) as usize;
    let extra_start = offset + LOCAL_HEADER_FIXED_LEN as u64 + name_len;
    if extra_start + extra_len as u64 > file_len {
        return Ok(None);
    }
    if extra_len == 0 {
        return Ok(Some(None));
    }

    let mut extra = vec![0u8; extra_len];
    file.seek(SeekFrom::Start(extra_start)).await?;
    file.read_exact(&mut extra).await?;
    Ok(Some(
        overrunning_subfield(&extra).map(|(at, clamped)| (extra_start + at as u64, clamped)),
    ))
}

/// Locate the end-of-central-directory record and return
/// `(central directory offset, central directory length, entry count)`.
///
/// `None` means there is no usable record: the file is not a zip, the record is
/// buried further back than a maximal comment allows, or the archive is zip64 (whose
/// real values live in a separate record this opportunistic scan does not read).
async fn read_eocd(
    file: &mut tokio::fs::File,
    file_len: u64,
) -> std::io::Result<Option<(u64, u64, usize)>> {
    // The record sits at the very end, followed only by a comment of at most
    // u16::MAX bytes, so that tail is the whole search space.
    let tail_len = (EOCD_FIXED_LEN as u64 + u64::from(u16::MAX)).min(file_len);
    let tail_start = file_len - tail_len;
    let mut tail = vec![0u8; tail_len as usize];
    file.seek(SeekFrom::Start(tail_start)).await?;
    file.read_exact(&mut tail).await?;

    let Some(at) = tail
        .windows(EOCD_SIGNATURE.len())
        .rposition(|w| w == EOCD_SIGNATURE)
    else {
        return Ok(None);
    };
    let eocd = &tail[at..];
    if eocd.len() < EOCD_FIXED_LEN {
        return Ok(None);
    }

    let entries = le_u16(eocd, 10);
    let cd_len = le_u32(eocd, 12);
    let cd_offset = le_u32(eocd, 16);
    if entries == ZIP64_SENTINEL_U16
        || cd_len == ZIP64_SENTINEL_U32
        || cd_offset == ZIP64_SENTINEL_U32
    {
        return Ok(None);
    }
    Ok(Some((
        u64::from(cd_offset),
        u64::from(cd_len),
        entries as usize,
    )))
}

/// Read the little-endian `u16` at `at`. Callers bound-check the slice first.
fn le_u16(bytes: &[u8], at: usize) -> u16 {
    u16::from_le_bytes([bytes[at], bytes[at + 1]])
}

/// Read the little-endian `u32` at `at`. Callers bound-check the slice first.
fn le_u32(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

/// Locate the one subfield in `extra` whose declared size overruns the block.
///
/// Returns the offset of that subfield's 2-byte size field within `extra` and the
/// size it must be clamped to. At most one such subfield can exist: everything
/// after it lies inside its (clamped) data, so the walk ends there.
///
/// The walk mirrors `async_zip`'s own parser, including its `cursor + 4 < len`
/// bound — a trailing block too short to hold another header is ignored by both.
fn overrunning_subfield(extra: &[u8]) -> Option<(usize, u16)> {
    let mut cursor = 0;
    while cursor + 4 < extra.len() {
        let declared = u16::from_le_bytes([extra[cursor + 2], extra[cursor + 3]]);
        let available = extra.len() - cursor - 4;
        if declared as usize > available {
            // `available` came from a `u16`-bounded extra field, so it always fits.
            return Some((cursor + 2, available as u16));
        }
        cursor += 4 + declared as usize;
    }
    None
}

/// The proprietary subfield id the real-world broken archives carry.
#[cfg(test)]
pub(crate) const BROKEN_SUBFIELD_ID: u16 = 0x4004;
/// Bytes actually present in that subfield.
#[cfg(test)]
pub(crate) const BROKEN_SUBFIELD_PRESENT: u16 = 13;
/// Bytes it claims to have.
#[cfg(test)]
pub(crate) const BROKEN_SUBFIELD_DECLARED: u16 = 600;

/// Build a zip whose entries carry a MALFORMED extra field, reproducing what some
/// Windows repackers emit: subfield [`BROKEN_SUBFIELD_ID`] declares
/// [`BROKEN_SUBFIELD_DECLARED`] data bytes while only [`BROKEN_SUBFIELD_PRESENT`]
/// are present.
///
/// The field is written with its true size first and the declared size is then
/// patched in the finished bytes, so only the two size bytes change — every header
/// offset stays valid, exactly as in the real archives. `unzip`, macOS and 7-Zip
/// ignore an unparseable extra field and open such archives fine.
#[cfg(test)]
pub(crate) fn zip_with_oversized_extra_field(name: &str, bytes: &[u8]) -> tempfile::NamedTempFile {
    use std::io::{Cursor, Write as _};
    use zip::write::{ExtendedFileOptions, FileOptions};
    use zip::ZipWriter;

    let mut options: FileOptions<'static, ExtendedFileOptions> = FileOptions::default();
    options
        .add_extra_data(
            BROKEN_SUBFIELD_ID,
            &vec![0u8; BROKEN_SUBFIELD_PRESENT as usize][..],
            false,
        )
        .expect("add proprietary extra field");

    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    writer.start_file(name, options).expect("start zip entry");
    writer.write_all(bytes).expect("write zip entry bytes");
    let mut raw = writer.finish().expect("finalize zip").into_inner();

    // Patch every `id + true size` header to declare the oversized length. Both
    // the local header and the central directory carry a copy of the field.
    let mut sound = BROKEN_SUBFIELD_ID.to_le_bytes().to_vec();
    sound.extend_from_slice(&BROKEN_SUBFIELD_PRESENT.to_le_bytes());
    let mut broken = BROKEN_SUBFIELD_ID.to_le_bytes().to_vec();
    broken.extend_from_slice(&BROKEN_SUBFIELD_DECLARED.to_le_bytes());
    let mut patched = 0;
    for i in 0..raw.len().saturating_sub(3) {
        if raw[i..i + 4] == sound[..] {
            raw[i..i + 4].copy_from_slice(&broken);
            patched += 1;
        }
    }
    assert_eq!(
        patched, 2,
        "fixture must corrupt the local header and central directory copies"
    );

    let tmp = tempfile::NamedTempFile::new().expect("temp zip file");
    std::fs::write(tmp.path(), &raw).expect("write fixture zip");
    tmp
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build one extra-field block from `(header_id, declared_size, data)` triples.
    /// `declared_size` is written verbatim so a test can declare more than it gives.
    fn block(subfields: &[(u16, u16, &[u8])]) -> Vec<u8> {
        let mut out = Vec::new();
        for (id, declared, data) in subfields {
            out.extend_from_slice(&id.to_le_bytes());
            out.extend_from_slice(&declared.to_le_bytes());
            out.extend_from_slice(data);
        }
        out
    }

    #[test]
    fn well_formed_single_subfield_needs_no_clamp() {
        let extra = block(&[(0x5455, 5, &[1, 2, 3, 4, 5])]);
        assert_eq!(overrunning_subfield(&extra), None);
    }

    #[test]
    fn well_formed_consecutive_subfields_need_no_clamp() {
        let extra = block(&[(0x5455, 5, &[1, 2, 3, 4, 5]), (0x7875, 3, &[9, 9, 9])]);
        assert_eq!(overrunning_subfield(&extra), None);
    }

    #[test]
    fn empty_block_needs_no_clamp() {
        assert_eq!(overrunning_subfield(&[]), None);
    }

    #[test]
    fn trailing_bytes_too_short_for_a_header_are_ignored() {
        // Three leftover bytes cannot hold an id + size pair. `async_zip` stops
        // there too, so there is nothing to repair.
        let mut extra = block(&[(0x5455, 5, &[1, 2, 3, 4, 5])]);
        extra.extend_from_slice(&[0xAA, 0xBB, 0xCC]);
        assert_eq!(overrunning_subfield(&extra), None);
    }

    #[test]
    fn oversized_subfield_is_clamped_to_the_bytes_present() {
        // The real-world shape: id 0x4004 declares 600 bytes, 13 are present.
        let extra = block(&[(0x4004, 600, &[0u8; 13])]);
        assert_eq!(overrunning_subfield(&extra), Some((2, 13)));
    }

    #[test]
    fn oversized_subfield_after_a_valid_one_is_clamped() {
        // The walk must reach the second subfield before clamping, so the reported
        // offset is relative to the whole block, not to the offending subfield.
        let extra = block(&[(0x5455, 5, &[1, 2, 3, 4, 5]), (0x4004, 600, &[0u8; 13])]);
        assert_eq!(overrunning_subfield(&extra), Some((9 + 2, 13)));
    }

    #[test]
    fn subfield_overrunning_by_one_byte_is_clamped() {
        // Boundary case: declared size exceeds the remaining bytes by exactly one.
        let extra = block(&[(0x4004, 6, &[0u8; 5])]);
        assert_eq!(overrunning_subfield(&extra), Some((2, 5)));
    }

    /// Build a zip with no extra fields at all, using the sync `zip` dev-dependency.
    fn plain_zip(name: &str, bytes: &[u8]) -> tempfile::NamedTempFile {
        use std::io::Write as _;
        let tmp = tempfile::NamedTempFile::new().expect("temp zip file");
        let mut writer = zip::ZipWriter::new(tmp.reopen().expect("reopen temp zip"));
        writer
            .start_file(name, zip::write::SimpleFileOptions::default())
            .expect("start zip entry");
        writer.write_all(bytes).expect("write zip entry bytes");
        writer.finish().expect("finalize zip");
        tmp
    }

    #[tokio::test]
    async fn sound_archive_is_left_alone() {
        // No overrunning subfield means no copy: the happy path must not pay for
        // duplicating an archive that `async_zip` can already open.
        let zip = plain_zip("a.txt", b"alpha");

        let repaired = repair_extra_fields(zip.path())
            .await
            .expect("scan should succeed");

        assert!(
            repaired.is_none(),
            "an archive with parseable extra fields needs no repaired copy"
        );
    }

    #[tokio::test]
    async fn non_zip_input_is_left_alone() {
        // Without an end-of-central-directory record there is nothing to walk, so
        // the scan declines and leaves the original for `async_zip` to reject.
        let mut tmp = tempfile::NamedTempFile::new().expect("temp file");
        std::io::Write::write_all(&mut tmp, b"not a zip").expect("write bytes");

        let repaired = repair_extra_fields(tmp.path())
            .await
            .expect("scan should succeed");

        assert!(repaired.is_none(), "a non-zip input needs no repaired copy");
    }

    #[tokio::test]
    async fn broken_archive_is_copied_with_only_the_size_fields_changed() {
        // The repair must be byte-for-byte identical to the original except for the
        // clamped size fields — that is what keeps every header offset, and the
        // entry data itself, valid.
        let zip = zip_with_oversized_extra_field("scan_01.jpg", b"jpeg-bytes");
        let original = std::fs::read(zip.path()).expect("read original");

        let repaired = repair_extra_fields(zip.path())
            .await
            .expect("scan should succeed")
            .expect("a malformed extra field must produce a repaired copy");
        let fixed = std::fs::read(repaired.path()).expect("read repaired copy");

        assert_eq!(
            original.len(),
            fixed.len(),
            "repair must not resize the file"
        );
        let differing: Vec<usize> = (0..original.len())
            .filter(|&i| original[i] != fixed[i])
            .collect();
        // Two size fields of two bytes each, and both bytes of each differ
        // (600 = 0x0258 vs 13 = 0x000D), so the changes form two adjacent pairs.
        assert_eq!(
            differing.len(),
            4,
            "only the two size fields (2 bytes each) may change, got {differing:?}"
        );
        for pair in differing.chunks_exact(2) {
            let (at, next) = (pair[0], pair[1]);
            assert_eq!(next, at + 1, "a size field occupies two adjacent bytes");
            assert_eq!(
                u16::from_le_bytes([original[at], original[at + 1]]),
                BROKEN_SUBFIELD_DECLARED,
                "the fixture must have declared the oversized length here"
            );
            assert_eq!(
                u16::from_le_bytes([fixed[at], fixed[at + 1]]),
                BROKEN_SUBFIELD_PRESENT,
                "each declared size must be clamped to the bytes present"
            );
        }
    }

    #[tokio::test]
    async fn repaired_copy_is_removed_when_dropped() {
        let zip = zip_with_oversized_extra_field("scan_01.jpg", b"jpeg-bytes");

        let path = {
            let repaired = repair_extra_fields(zip.path())
                .await
                .expect("scan should succeed")
                .expect("repaired copy");
            repaired.path().to_path_buf()
        };

        assert!(
            !path.exists(),
            "the repaired copy must not outlive its guard"
        );
    }
}
