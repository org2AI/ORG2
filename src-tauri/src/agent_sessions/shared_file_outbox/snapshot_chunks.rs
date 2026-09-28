use super::Candidate;
use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::io::{Read, Seek, SeekFrom};

pub const CHUNK_BYTES: usize = 256 * 1024;
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotChunk {
    pub status: String,
    pub captured_at: Option<i64>,
    pub sha256: Option<String>,
    pub size: usize,
    pub offset: usize,
    pub bytes_base64: Option<String>,
}

pub(super) fn read(
    conn: &Connection,
    scope: &[&str; 3],
    file: &Candidate,
    offset: usize,
) -> Result<SnapshotChunk, String> {
    if offset > 32 * 1024 * 1024 {
        return Err("Snapshot offset exceeds file limit".into());
    }
    let row = conn
        .query_row(
            "SELECT rowid,status,captured_at,sha256,size_bytes FROM cloud_file_snapshots
         WHERE identity=?1 AND org_id=?2 AND session_id=?3 AND path=?4 AND revision=?5",
            params![scope[0], scope[1], scope[2], file.path, file.revision],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    SnapshotChunk {
                        status: row.get(1)?,
                        captured_at: row.get(2)?,
                        sha256: row.get(3)?,
                        size: row.get(4)?,
                        offset,
                        bytes_base64: None,
                    },
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((rowid, mut chunk)) = row else {
        return Ok(SnapshotChunk {
            status: "not_captured".into(),
            captured_at: None,
            sha256: None,
            size: 0,
            offset,
            bytes_base64: None,
        });
    };
    if chunk.status != "captured" {
        return Ok(chunk);
    }
    if chunk.size > 32 * 1024 * 1024 || offset > chunk.size {
        chunk.status = "integrity_error".into();
        return Ok(chunk);
    }
    let mut blob = conn
        .blob_open(
            rusqlite::DatabaseName::Main,
            "cloud_file_snapshots",
            "bytes",
            rowid,
            true,
        )
        .map_err(|e| e.to_string())?;
    if blob.len() != chunk.size {
        chunk.status = "integrity_error".into();
        return Ok(chunk);
    }
    blob.seek(SeekFrom::Start(offset as u64))
        .map_err(|e| e.to_string())?;
    let mut bytes = vec![0u8; (chunk.size - offset).min(CHUNK_BYTES)];
    blob.read_exact(&mut bytes).map_err(|e| e.to_string())?;
    chunk.bytes_base64 = Some(base64::engine::general_purpose::STANDARD.encode(bytes));
    Ok(chunk)
}
