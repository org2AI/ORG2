//! Narrow configuration-only invalidation for the unattended scheduler.
//! Evaluation watermarks and run changes are deliberately excluded.
#[derive(Debug, PartialEq, Eq)]
pub struct ScheduleRevision {
    legacy: Vec<(String, i64, bool, String)>,
    portable: Vec<(String, i64, bool, Option<String>)>,
}

/// Preserve cross-process edit detection without decoding every routine spec
/// or writing scheduler watermarks on the 30-second safety check.
pub fn read() -> Result<ScheduleRevision, String> {
    let connection = crate::projects::io::helpers::conn()?;
    let mut legacy = connection
        .prepare(
            "SELECT id, updated_at, enabled, trigger_json FROM routine_definitions ORDER BY id",
        )
        .map_err(|err| err.to_string())?;
    let legacy = legacy
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .map_err(|err| err.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())?;
    let mut portable = connection
        .prepare("SELECT name, revision, enabled, default_scope FROM pm_routines ORDER BY name")
        .map_err(|err| err.to_string())?;
    let portable = portable
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .map_err(|err| err.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())?;
    Ok(ScheduleRevision { legacy, portable })
}
