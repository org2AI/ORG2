//! Private, single-thread recovery snapshot; never a native profile database.
use super::schema::{normalized_sql, Column};
use super::*;

const MAX_SNAPSHOT_FILE_BYTES: u64 = 1024 * 1024 * 1024;
const SNAPSHOT_APPLICATION_ID: i64 = 0x4f524748;
const SNAPSHOT_VERSION: i64 = 2;
const MAX_CONTRACT_BYTES: i64 = 1024 * 1024;
const META_V2_SQL: &str = "CREATE TABLE snapshot_meta (singleton INTEGER NOT NULL PRIMARY KEY,version INTEGER NOT NULL,thread_id TEXT NOT NULL,columns_json TEXT NOT NULL)";
const SNAPSHOT_META_COLUMNS: &[Column] = &[
    ("singleton", "INTEGER", 1, 1),
    ("version", "INTEGER", 1, 0),
    ("thread_id", "TEXT", 1, 0),
];
const SNAPSHOT_ROLLOUT_COLUMNS: &[Column] =
    &[("position", "INTEGER", 1, 1), ("rollout_id", "TEXT", 1, 0)];

fn snapshot_tables() -> Vec<(&'static str, &'static [Column])> {
    [
        ("snapshot_meta", SNAPSHOT_META_COLUMNS),
        ("snapshot_rollouts", SNAPSHOT_ROLLOUT_COLUMNS),
        ("thread_record", THREAD_COLUMNS),
    ]
    .into_iter()
    .chain(HISTORY_TABLES.iter().copied())
    .collect()
}

/// The recovery snapshot is our own single-file format, not a native profile.
/// It deliberately has no foreign keys, triggers, authentication or other
/// native control-plane tables. Preserve SQL value types and projection bytes.
fn snapshot_table_sql(name: &str, columns: &[Column]) -> String {
    let mut parts = columns
        .iter()
        .map(|column| {
            format!(
                "{} {}{}",
                column.0,
                column.1,
                if column.2 != 0 { " NOT NULL" } else { "" }
            )
        })
        .collect::<Vec<_>>();
    let mut key = columns
        .iter()
        .filter(|column| column.3 != 0)
        .collect::<Vec<_>>();
    key.sort_by_key(|column| column.3);
    parts.push(format!(
        "PRIMARY KEY ({})",
        key.iter()
            .map(|column| column.0)
            .collect::<Vec<_>>()
            .join(",")
    ));
    format!("CREATE TABLE {name} ({})", parts.join(","))
}

fn snapshot_path(path: &Path, missing: bool) -> Result<(), String> {
    super::super::files::regular_path(path, missing)?;
    match std::fs::symlink_metadata(path) {
        Ok(metadata) => {
            if !metadata.is_file() || metadata.len() > MAX_SNAPSHOT_FILE_BYTES {
                return Err("Invalid Codex history snapshot file".into());
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if metadata.permissions().mode() & 0o077 != 0 {
                    return Err("Codex history snapshot permissions are not private".into());
                }
            }
        }
        Err(error) if missing && error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err("Missing Codex history snapshot".into()),
    }
    for suffix in ["-wal", "-shm", "-journal"] {
        let mut sidecar = path.as_os_str().to_os_string();
        sidecar.push(suffix);
        match std::fs::symlink_metadata(PathBuf::from(sidecar)) {
            Ok(_) => return Err("Unsealed Codex history snapshot sidecar".into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("Cannot inspect Codex history snapshot sidecar".into()),
        }
    }
    Ok(())
}

fn validate_legacy_snapshot(connection: &Connection) -> Result<(), String> {
    let objects: Vec<(String, String, String)> = connection
        .prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name")
        .map_err(db_error)?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(db_error)?
        .collect::<Result<_, _>>()
        .map_err(db_error)?;
    let tables = snapshot_tables();
    if objects.len() != tables.len()
        || objects.iter().any(|(kind, name, sql)| {
            kind != "table"
                || !tables.iter().any(|(expected_name, columns)| {
                    name == expected_name
                        && normalized_sql(sql)
                            == normalized_sql(&snapshot_table_sql(expected_name, columns))
                })
        })
    {
        return Err("Unsupported Codex history snapshot schema".into());
    }
    Ok(())
}

fn data_table_sql(name: &str, columns: &[NativeColumn]) -> String {
    // BLOB has no affinity: preserve every SQLite Value without reinterpreting
    // opaque types/default expressions as SQL in our recovery format.
    let mut parts: Vec<String> = columns
        .iter()
        .map(|column| {
            format!(
                "{} BLOB{}",
                quote(&column.name),
                if column.not_null != 0 {
                    " NOT NULL"
                } else {
                    ""
                }
            )
        })
        .collect();
    let mut keys: Vec<_> = columns
        .iter()
        .filter(|column| column.primary_key > 0)
        .collect();
    keys.sort_by_key(|column| column.primary_key);
    parts.push(format!(
        "PRIMARY KEY ({})",
        keys.iter()
            .map(|column| quote(&column.name))
            .collect::<Vec<_>>()
            .join(",")
    ));
    format!("CREATE TABLE {} ({})", quote(name), parts.join(","))
}

fn read_contracts(
    connection: &Connection,
) -> Result<(i64, BTreeMap<String, Vec<NativeColumn>>), String> {
    let application: i64 = connection
        .pragma_query_value(None, "application_id", |row| row.get(0))
        .map_err(db_error)?;
    let version: i64 = connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(db_error)?;
    if application != SNAPSHOT_APPLICATION_ID {
        return Err("Invalid Codex recovery identity".into());
    }
    if version == 1 {
        // Already pending v1 snapshots retain their original portable hash and
        // fixed data contract; a migrated target may safely pause publication.
        validate_legacy_snapshot(connection)?;
        let mut contracts = read_projection_columns(connection, "main")?;
        contracts.insert(
            "thread_record".into(),
            read_columns(connection, "main", "thread_record")?,
        );
        return Ok((version, contracts));
    }
    if version != SNAPSHOT_VERSION {
        return Err("Unsupported Codex recovery format; pending history was preserved".into());
    }
    let length: i64 = connection
        .query_row(
            "SELECT length(cast(columns_json AS blob)) FROM snapshot_meta WHERE singleton=1",
            [],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    if !(1..=MAX_CONTRACT_BYTES).contains(&length) {
        return Err("Codex recovery contract exceeds its limit".into());
    }
    let encoded: String = connection
        .query_row(
            "SELECT columns_json FROM snapshot_meta WHERE singleton=1",
            [],
            |row| row.get(0),
        )
        .map_err(db_error)?;
    let contracts: BTreeMap<String, Vec<NativeColumn>> =
        serde_json::from_str(&encoded).map_err(|_| "Invalid Codex recovery contract")?;
    if contracts.len() != HISTORY_TABLES.len() + 1
        || !contracts.contains_key("thread_record")
        || HISTORY_TABLES
            .iter()
            .any(|(table, _)| !contracts.contains_key(*table))
    {
        return Err("Invalid Codex recovery table set".into());
    }
    for (table, columns) in &contracts {
        if columns.is_empty()
            || columns.len() > 256
            || columns.windows(2).any(|v| v[0].name >= v[1].name)
            || columns.iter().any(|column| {
                column.name.is_empty()
                    || column.name.len() > 256
                    || column.name.contains('\0')
                    || column.data_type.len() > 128
                    || column.default.as_ref().is_some_and(|v| v.len() > 4096)
                    || !matches!(column.not_null, 0 | 1)
                    || !(0..=256).contains(&column.primary_key)
            })
        {
            return Err("Invalid Codex recovery columns".into());
        }
        validate_columns(table, columns)?;
    }
    let mut expected: BTreeMap<String, String> = contracts
        .iter()
        .map(|(name, columns)| (name.clone(), data_table_sql(name, columns)))
        .collect();
    expected.insert("snapshot_meta".into(), META_V2_SQL.into());
    expected.insert(
        "snapshot_rollouts".into(),
        snapshot_table_sql("snapshot_rollouts", SNAPSHOT_ROLLOUT_COLUMNS),
    );
    let objects = connection
        .prepare(
            "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name LIMIT 16",
        )
        .map_err(db_error)?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(db_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(db_error)?;
    if objects.len() != expected.len()
        || objects.iter().any(|(kind, name, sql)| {
            kind != "table"
                || expected
                    .get(name)
                    .is_none_or(|s| normalized_sql(s) != normalized_sql(sql))
        })
    {
        return Err("Unsupported Codex recovery structure".into());
    }
    Ok((version, contracts))
}

impl PreparedThread {
    /// Persist exactly this source read snapshot before the caller records its
    /// pending file publication. The unique destination must not already exist.
    /// A reopened snapshot remains sufficient even if the original source has
    /// moved on, disappeared, or changed its projection schema after a crash.
    pub(in super::super) fn persist_snapshot(
        &self,
        path: &Path,
        mut check_owner: impl FnMut() -> Result<(), String>,
    ) -> Result<(), String> {
        check_owner()?;
        snapshot_path(path, true)?;
        if path.exists() {
            return Err("Codex history snapshot already exists".into());
        }
        let parent = path
            .parent()
            .ok_or("Missing Codex history snapshot directory")?;
        super::super::files::regular_path(parent, false)?;
        let temporary = tempfile::NamedTempFile::new_in(parent)
            .map_err(|_| "Cannot stage Codex history snapshot")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            temporary
                .as_file()
                .set_permissions(std::fs::Permissions::from_mode(0o600))
                .map_err(|_| "Cannot protect Codex history snapshot")?;
        }
        let mut snapshot =
            Connection::open_with_flags(temporary.path(), OpenFlags::SQLITE_OPEN_READ_WRITE)
                .map_err(db_error)?;
        snapshot
            .execute_batch("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;")
            .map_err(db_error)?;
        snapshot
            .pragma_update(None, "application_id", SNAPSHOT_APPLICATION_ID)
            .map_err(db_error)?;
        snapshot
            .pragma_update(None, "user_version", SNAPSHOT_VERSION)
            .map_err(db_error)?;
        let transaction = snapshot.transaction().map_err(db_error)?;
        let mut contracts = self.projection_columns.clone();
        contracts.insert("thread_record".into(), self.record.columns.clone());
        let encoded = serde_json::to_string(&contracts)
            .map_err(|_| "Cannot encode Codex recovery contract")?;
        if encoded.len() > MAX_CONTRACT_BYTES as usize {
            return Err("Codex recovery contract exceeds its limit".into());
        }
        transaction.execute_batch(META_V2_SQL).map_err(db_error)?;
        transaction
            .execute_batch(&snapshot_table_sql(
                "snapshot_rollouts",
                SNAPSHOT_ROLLOUT_COLUMNS,
            ))
            .map_err(db_error)?;
        for (name, columns) in &contracts {
            transaction
                .execute_batch(&data_table_sql(name, columns))
                .map_err(db_error)?;
        }
        transaction
            .execute(
                "INSERT INTO snapshot_meta VALUES (1,?1,?2,?3)",
                rusqlite::params![SNAPSHOT_VERSION, self.record.id, encoded],
            )
            .map_err(db_error)?;
        transaction
            .execute(
                &format!(
                    "INSERT INTO thread_record ({}) VALUES ({})",
                    names_sql(&self.record.columns),
                    vec!["?"; self.record.columns.len()].join(",")
                ),
                params_from_iter(self.record.values.iter()),
            )
            .map_err(db_error)?;
        for (position, projection) in self.projections.iter().enumerate() {
            transaction
                .execute(
                    "INSERT INTO snapshot_rollouts VALUES (?1,?2)",
                    rusqlite::params![position as i64, projection.rollout_id],
                )
                .map_err(db_error)?;
            for (table, columns) in &self.projection_columns {
                let mut statement = self
                    .source
                    .prepare(&format!(
                        "SELECT {} FROM {}.{table} WHERE thread_id=?1",
                        names_sql(columns),
                        self.history_schema
                    ))
                    .map_err(db_error)?;
                let mut rows = statement
                    .query([&projection.rollout_id])
                    .map_err(db_error)?;
                let mut insert = transaction
                    .prepare(&format!(
                        "INSERT INTO {table} ({}) VALUES ({})",
                        names_sql(columns),
                        vec!["?"; columns.len()].join(",")
                    ))
                    .map_err(db_error)?;
                let mut copied = 0usize;
                while let Some(row) = rows.next().map_err(db_error)? {
                    insert
                        .execute(params_from_iter(
                            row_values(row, columns.len()).map_err(db_error)?.iter(),
                        ))
                        .map_err(db_error)?;
                    copied += 1;
                    if copied % 1_000 == 0 {
                        check_owner()?;
                    }
                }
            }
            check_owner()?;
        }
        check_owner()?;
        transaction.commit().map_err(db_error)?;
        snapshot.close().map_err(|(_, error)| db_error(error))?;
        temporary
            .as_file()
            .sync_all()
            .map_err(|_| "Cannot flush Codex history snapshot")?;
        snapshot_path(temporary.path(), false)?;
        check_owner()?;
        // Noclobber makes one pending operation incapable of replacing another
        // operation's only durable recovery data.
        temporary
            .persist_noclobber(path)
            .map_err(|_| "Cannot publish Codex history snapshot")?;
        std::fs::File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|_| "Cannot flush Codex history snapshot directory")?;
        Ok(())
    }

    pub(in super::super) fn from_snapshot(path: &Path) -> Result<Self, String> {
        snapshot_path(path, false)?;
        let source = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(db_error)?;
        source
            .execute_batch("PRAGMA query_only=ON; BEGIN")
            .map_err(db_error)?;
        let (format_version, mut contracts) = read_contracts(&source)?;
        let count: i64 = source
            .query_row("SELECT count(*) FROM snapshot_meta", [], |row| row.get(0))
            .map_err(db_error)?;
        let (version, id): (i64, String) = source
            .query_row(
                "SELECT version,thread_id FROM snapshot_meta WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(db_error)?;
        if count != 1 || version != format_version {
            return Err("Invalid Codex history snapshot identity".into());
        }
        let count: i64 = source
            .query_row("SELECT count(*) FROM thread_record", [], |row| row.get(0))
            .map_err(db_error)?;
        if count != 1 {
            return Err("Codex history snapshot must contain one thread".into());
        }
        let columns = contracts
            .remove("thread_record")
            .ok_or("Missing recovery thread contract")?;
        let record = read_record_with_columns(&source, "thread_record", &id, &columns)?
            .ok_or("Missing recovery thread")?;
        let rollouts: Vec<(i64, String)> = source
            .prepare(&format!(
                "SELECT position,rollout_id FROM snapshot_rollouts ORDER BY position LIMIT {}",
                MAX_ROLLOUTS + 1
            ))
            .map_err(db_error)?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(db_error)?
            .collect::<Result<_, _>>()
            .map_err(db_error)?;
        if rollouts
            .iter()
            .enumerate()
            .any(|(position, (stored, _))| *stored != position as i64)
        {
            return Err("Invalid Codex history snapshot rollout order".into());
        }
        for (table, _) in HISTORY_TABLES {
            let extra: bool = source.query_row(&format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE thread_id NOT IN (SELECT rollout_id FROM snapshot_rollouts))"), [], |row| row.get(0)).map_err(db_error)?;
            if extra {
                return Err("Codex history snapshot contains an unrelated rollout".into());
            }
        }
        prepare_rows(
            source,
            "main",
            record,
            &rollouts.into_iter().map(|(_, id)| id).collect::<Vec<_>>(),
            contracts,
        )
    }
}
