use super::{SourceAdapter, SourceDescriptor, SourceRecords, SourceScanOptions};
use crate::canonical::SOURCE_ORGII_RUST_AGENTS;

pub struct OrgiiRustAgentsSource;

impl SourceAdapter for OrgiiRustAgentsSource {
    fn descriptor(&self) -> SourceDescriptor {
        SourceDescriptor {
            id: SOURCE_ORGII_RUST_AGENTS.to_string(),
            label: "ORG2 Rust Agents".to_string(),
            parser_version: 1,
        }
    }

    fn scan(&self, _options: &SourceScanOptions) -> Result<SourceRecords, String> {
        Ok(SourceRecords::default())
    }
}
