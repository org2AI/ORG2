use super::{SourceAdapter, SourceDescriptor, SourceRecords, SourceScanOptions};
use crate::canonical::SOURCE_ORGII_CLI_SESSIONS;

pub struct OrgiiCliSessionsSource;

impl SourceAdapter for OrgiiCliSessionsSource {
    fn descriptor(&self) -> SourceDescriptor {
        SourceDescriptor {
            id: SOURCE_ORGII_CLI_SESSIONS.to_string(),
            label: "ORG2 CLI Sessions".to_string(),
            parser_version: 1,
        }
    }

    fn scan(&self, _options: &SourceScanOptions) -> Result<SourceRecords, String> {
        Ok(SourceRecords::default())
    }
}
