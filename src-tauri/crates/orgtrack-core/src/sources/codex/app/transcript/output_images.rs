//! Output images stay in the provider transcript. Replay carries only a source
//! offset, call identity and part index; opening a thumbnail reads one bounded row.
use super::super::CodexJsonlLine;
use crate::sources::imported_history::user_sources::transcript_image_ref;
use serde_json::{json, Value};
use std::{
    fs::File,
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
    path::Path,
};

pub(super) const OUTPUT_IMAGE_PREFIX: &str = "codex-output-image:";
const MAX_IMAGE_RECORD_BYTES: u64 = 32 * 1024 * 1024;

pub(super) fn reference_output_images(session_id: &str, offset: u64, payload: &mut Value) {
    if payload.get("type").and_then(Value::as_str) == Some("image_generation_call") {
        if let Some(id) = payload.get("id").and_then(Value::as_str) {
            if payload
                .get("result")
                .and_then(Value::as_str)
                .is_some_and(|s| !s.is_empty())
            {
                let identity = json!([id, 0]).to_string();
                payload["result"] = json!(transcript_image_ref(
                    session_id,
                    &format!("{OUTPUT_IMAGE_PREFIX}{offset}"),
                    &identity
                ));
            }
        }
        return;
    }
    if !matches!(
        payload.get("type").and_then(Value::as_str),
        Some("function_call_output" | "custom_tool_call_output")
    ) {
        return;
    }
    let Some(call_id) = payload
        .get("call_id")
        .and_then(Value::as_str)
        .map(str::to_owned)
    else {
        return;
    };
    let Some(parts) = payload.get_mut("output").and_then(Value::as_array_mut) else {
        return;
    };
    for (index, part) in parts.iter_mut().enumerate() {
        if !matches!(
            part.get("type").and_then(Value::as_str),
            Some("input_image" | "output_image" | "image")
        ) {
            continue;
        }
        let Some(url) = part.get("image_url").and_then(Value::as_str) else {
            continue;
        };
        if url.starts_with("data:image/") || url == "[embedded image omitted]" {
            let identity = json!([call_id, index]).to_string();
            part["image_url"] = json!(transcript_image_ref(
                session_id,
                &format!("{OUTPUT_IMAGE_PREFIX}{offset}"),
                &identity
            ));
        }
    }
}

pub(super) fn load_output_image(
    path: &Path,
    reference: &str,
    identity: &str,
) -> Result<Option<String>, String> {
    let offset = reference
        .strip_prefix(OUTPUT_IMAGE_PREFIX)
        .and_then(|s| s.parse::<u64>().ok())
        .ok_or("Invalid output image offset")?;
    let (call_id, index): (String, usize) =
        serde_json::from_str(identity).map_err(|_| "Invalid output image identity")?;
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| e.to_string())?;
    let mut line = String::new();
    BufReader::new(file.take(MAX_IMAGE_RECORD_BYTES + 1))
        .read_line(&mut line)
        .map_err(|e| e.to_string())?;
    if line.len() as u64 > MAX_IMAGE_RECORD_BYTES {
        return Err("Output image exceeds read limit".into());
    }
    let row: CodexJsonlLine = serde_json::from_str(&line).map_err(|e| e.to_string())?;
    if row.payload.get("type").and_then(Value::as_str) == Some("image_generation_call") {
        if row.payload.get("id").and_then(Value::as_str) != Some(call_id.as_str()) {
            return Err("Output image source changed".into());
        }
        return Ok(row
            .payload
            .get("result")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(|data| {
                if data.starts_with("data:image/") {
                    data.to_string()
                } else {
                    format!("data:image/png;base64,{data}")
                }
            }));
    }
    if !matches!(
        row.payload.get("type").and_then(Value::as_str),
        Some("function_call_output" | "custom_tool_call_output")
    ) || row.payload.get("call_id").and_then(Value::as_str) != Some(call_id.as_str())
    {
        return Err("Output image source changed".into());
    }
    let part = &row.payload["output"][index];
    if !matches!(
        part.get("type").and_then(Value::as_str),
        Some("input_image" | "output_image" | "image")
    ) {
        return Err("Output image part changed".into());
    }
    Ok(part
        .get("image_url")
        .and_then(Value::as_str)
        .filter(|s| s.starts_with("data:image/"))
        .map(str::to_owned))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn output_images_are_lazy_and_guarded_against_rewrites() {
        let payload = json!({"type":"custom_tool_call_output","call_id":"image-call","output":[
            {"type":"input_text","text":"done"},
            {"type":"input_image","image_url":"data:image/png;base64,AAAA"}
        ]});
        let path =
            std::env::temp_dir().join(format!("orgii-output-image-{}.jsonl", std::process::id()));
        std::fs::write(
            &path,
            json!({"type":"response_item","payload":payload}).to_string(),
        )
        .unwrap();
        let mut projected = payload.clone();
        reference_output_images("session", 0, &mut projected);
        assert!(!projected.to_string().contains("base64"));
        let reference = projected["output"][1]["image_url"].as_str().unwrap();
        let parts: (String, String, String) =
            serde_json::from_str(reference.strip_prefix("orgii-transcript-image:").unwrap())
                .unwrap();
        assert_eq!(
            load_output_image(&path, &parts.1, &parts.2)
                .unwrap()
                .as_deref(),
            Some("data:image/png;base64,AAAA")
        );
        assert!(load_output_image(&path, &parts.1, r#"["different-call",1]"#).is_err());
        std::fs::remove_file(path).unwrap();
    }
}

/// Cloud export must carry portable bytes, never a source-machine offset.
/// This is called for one requested turn, not the history catalog.
pub(super) fn materialize_output_images(
    path: &Path,
    chunks: &mut [core_types::activity::ActivityChunk],
) -> Result<(), String> {
    for chunk in chunks {
        let Some(images) = chunk.result.get_mut("images").and_then(Value::as_array_mut) else {
            continue;
        };
        for image in images {
            let Some(reference) = image
                .as_str()
                .and_then(|s| s.strip_prefix("orgii-transcript-image:"))
            else {
                continue;
            };
            let (_, turn, original): (String, String, String) =
                serde_json::from_str(reference).map_err(|e| e.to_string())?;
            if turn.starts_with(OUTPUT_IMAGE_PREFIX) {
                *image = json!(load_output_image(path, &turn, &original)?
                    .ok_or("Output image unavailable during export")?);
            }
        }
    }
    Ok(())
}

/// Catalog metadata borrows image bytes while inspecting a row; only identities
/// survive in the bounded catalog. A string tool output is deliberately ignored.
#[derive(Debug, Clone)]
pub(super) struct CatalogOutputImage {
    offset: u64,
    identity: String,
}
impl CatalogOutputImage {
    pub(super) fn retained_bytes(&self) -> usize {
        self.identity.len() + std::mem::size_of::<Self>()
    }

    pub(super) fn reference(&self, session: &str) -> String {
        transcript_image_ref(
            session,
            &format!("{OUTPUT_IMAGE_PREFIX}{}", self.offset),
            &self.identity,
        )
    }
}

pub(super) fn catalog_output_images(line: &[u8], offset: u64) -> Vec<CatalogOutputImage> {
    use serde::Deserialize;
    #[derive(Deserialize)]
    struct Row<'a> {
        #[serde(borrow)]
        payload: Payload<'a>,
    }
    #[derive(Deserialize)]
    struct Payload<'a> {
        #[serde(rename = "type")]
        kind: &'a str,
        call_id: Option<&'a str>,
        id: Option<&'a str>,
        result: Option<&'a str>,
        #[serde(default, deserialize_with = "image_parts")]
        output: Vec<usize>,
    }
    fn image_parts<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<usize>, D::Error> {
        struct Parts;
        impl<'de> serde::de::Visitor<'de> for Parts {
            type Value = Vec<usize>;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("tool output")
            }
            fn visit_str<E: serde::de::Error>(self, _: &str) -> Result<Self::Value, E> {
                Ok(vec![])
            }
            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut seq: A,
            ) -> Result<Self::Value, A::Error> {
                #[derive(Deserialize)]
                struct Part<'a> {
                    #[serde(rename = "type")]
                    kind: &'a str,
                    image_url: Option<&'a str>,
                }
                let mut images = vec![];
                let mut index = 0;
                while let Some(part) = seq.next_element::<Part>()? {
                    if matches!(part.kind, "input_image" | "output_image" | "image")
                        && images.len() < 64
                        && part
                            .image_url
                            .is_some_and(|url| url.starts_with("data:image/"))
                    {
                        images.push(index);
                    }
                    index += 1;
                }
                Ok(images)
            }
        }
        d.deserialize_any(Parts)
    }
    let Ok(row) = serde_json::from_slice::<Row>(line) else {
        return vec![];
    };
    let p = row.payload;
    let (id, indices) = match p.kind {
        "image_generation_call" if p.result.is_some_and(|s| !s.is_empty()) => (p.id, vec![0]),
        "function_call_output" | "custom_tool_call_output" => (p.call_id, p.output),
        _ => return vec![],
    };
    let Some(id) = id.filter(|id| id.len() <= 512) else {
        return vec![];
    };
    indices
        .into_iter()
        .take(64)
        .map(|index| CatalogOutputImage {
            offset,
            identity: json!([id, index]).to_string(),
        })
        .collect()
}
