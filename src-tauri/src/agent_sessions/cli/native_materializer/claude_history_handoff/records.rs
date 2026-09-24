//! Integrity and session ownership only. Vendor records are opaque to sync:
//! no field/tool allowlist, parent rewriting, or message serialization.
use super::{Budget, Status};
use serde::de::{IgnoredAny, MapAccess, Visitor};
#[cfg(test)]
use serde_json::Value;
fn complete(bytes: &[u8]) -> Result<(), Status> {
    if bytes.is_empty() || bytes.last() != Some(&b'\n') {
        Err(Status::Incomplete)
    } else {
        Ok(())
    }
}
struct Identity(Option<String>);
impl<'de> serde::Deserialize<'de> for Identity {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Object;
        impl<'de> Visitor<'de> for Object {
            type Value = Identity;
            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("a native record object with an unambiguous session identity")
            }
            fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Identity, M::Error> {
                let mut session = None;
                while let Some(key) = map.next_key::<String>()? {
                    if key == "sessionId" {
                        if session.is_some() {
                            return Err(serde::de::Error::duplicate_field("sessionId"));
                        }
                        session = Some(map.next_value::<String>()?);
                    } else {
                        map.next_value::<IgnoredAny>()?;
                    }
                }
                Ok(Identity(session))
            }
        }
        deserializer.deserialize_map(Object)
    }
}
#[cfg(test)]
pub(super) fn rows(bytes: &[u8], budget: &Budget) -> Result<Vec<Value>, Status> {
    complete(bytes)?;
    bytes
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
        .map(|line| {
            budget.check()?;
            serde_json::from_slice(line).map_err(|_| Status::Incomplete)
        })
        .collect()
}
pub(super) fn validate(bytes: &[u8], session: &str, budget: &Budget) -> Result<(), Status> {
    complete(bytes)?;
    uuid::Uuid::parse_str(session).map_err(|_| Status::Unsupported)?;
    let mut owned = false;
    for line in bytes
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
    {
        budget.check()?;
        let Identity(identity) =
            serde_json::from_slice::<Identity>(line).map_err(|_| Status::Incomplete)?;
        if let Some(id) = identity {
            if id != session {
                return Err(Status::ScopeChanged);
            }
            owned = true;
        }
    }
    if owned {
        Ok(())
    } else {
        Err(Status::Unsupported)
    }
}
