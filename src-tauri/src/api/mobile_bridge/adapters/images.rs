//! Read-only, event-scoped image previews. Never accept a caller-supplied path.
use std::io::{BufRead, BufReader, Cursor, Read};
use std::path::Path;

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::agent_sessions::session_directory::aggregation::list_all_sessions;
use crate::agent_sessions::session_directory::types::SessionFilter;
use crate::api::mobile_bridge::rpc::RpcError;

const MAX_IMAGES: usize = 8;
const MAX_INPUT: usize = 12 * 1024 * 1024;
const MAX_PREVIEW: usize = 384 * 1024;
const MAX_SCAN: u64 = 256 * 1024 * 1024;
static IMAGE_WORK: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImageParams {
    session_id: String,
    round_id: String,
    event_id: String,
    image_index: usize,
}

fn refs(result: &Value) -> impl Iterator<Item = &str> {
    result
        .get("images")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .take(MAX_IMAGES)
}

pub(super) fn image_count(result: &Value) -> usize {
    refs(result).count()
}

fn invalid() -> RpcError {
    RpcError::invalid_params("image is unavailable or unsupported")
}

fn decode_data_url(value: &str) -> Result<Vec<u8>, RpcError> {
    if value.len() > MAX_INPUT * 4 / 3 + 128 {
        return Err(invalid());
    }
    let (header, data) = value.split_once(',').ok_or_else(invalid)?;
    if !matches!(
        header,
        "data:image/png;base64" | "data:image/jpeg;base64" | "data:image/webp;base64"
    ) {
        return Err(invalid());
    }
    STANDARD.decode(data).map_err(|_| invalid())
}

/// Recover only an embedded user attachment whose image marker names the exact
/// event-owned reference. Do not search other sessions or parse tool outputs.
fn recover_embedded(reader: impl Read, image_ref: &str) -> Result<Vec<u8>, RpcError> {
    let mut reader = BufReader::new(reader.take(MAX_SCAN));
    let mut line = Vec::new();
    let marker = format!("path=\"{image_ref}\"");
    loop {
        line.clear();
        // Bound individual rows too; discard oversized tool-output rows without
        // materializing them. The entire scan is separately bounded.
        let size = reader
            .by_ref()
            .take((MAX_INPUT * 2 + 1) as u64)
            .read_until(b'\n', &mut line)
            .map_err(|_| invalid())?;
        if size == 0 {
            return Err(invalid());
        }
        if size > MAX_INPUT * 2 {
            if line.last() == Some(&b'\n') {
                continue;
            }
            loop {
                let buf = reader.fill_buf().map_err(|_| invalid())?;
                let end = buf.iter().position(|b| *b == b'\n');
                let n = end.map_or(buf.len(), |i| i + 1);
                if n == 0 {
                    return Err(invalid());
                }
                reader.consume(n);
                if end.is_some() {
                    break;
                }
            }
            continue;
        }
        // A cheap substring check avoids JSON allocations for unrelated rows.
        if !line
            .windows(image_ref.len())
            .any(|window| window == image_ref.as_bytes())
        {
            continue;
        }
        let Ok(row) = serde_json::from_slice::<Value>(&line) else {
            continue;
        };
        if row["type"] != "response_item" || row["payload"]["role"] != "user" {
            continue;
        }
        let Some(parts) = row["payload"]["content"].as_array() else {
            continue;
        };
        let mut matched = false;
        for part in parts {
            match part["type"].as_str() {
                Some("input_text") => {
                    let text = part["text"].as_str().unwrap_or_default();
                    if text.starts_with("<image ") {
                        matched = text.contains(&marker);
                    }
                    if text == "</image>" {
                        matched = false;
                    }
                }
                Some("input_image") if matched => {
                    return decode_data_url(part["image_url"].as_str().ok_or_else(invalid)?);
                }
                _ => {}
            }
        }
    }
}

fn load_bytes(session_id: &str, image_ref: &str) -> Result<Vec<u8>, RpcError> {
    if image_ref.starts_with("data:") {
        return decode_data_url(image_ref);
    }
    // Remote URLs are deliberately not fetched: no SSRF or credential forwarding.
    let path = Path::new(image_ref);
    if !path.is_absolute() {
        return Err(invalid());
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NONBLOCK | libc::O_NOFOLLOW);
    }
    match options.open(path) {
        Ok(file) => {
            let metadata = file.metadata().map_err(|_| invalid())?;
            if !metadata.is_file() || metadata.len() > MAX_INPUT as u64 {
                return Err(invalid());
            }
            let mut bytes = Vec::new();
            file.take((MAX_INPUT + 1) as u64)
                .read_to_end(&mut bytes)
                .map_err(|_| invalid())?;
            if bytes.len() > MAX_INPUT {
                return Err(invalid());
            }
            Ok(bytes)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let filter = SessionFilter {
                session_ids: Some(vec![session_id.to_owned()]),
                ..Default::default()
            };
            let response = list_all_sessions(Some(&filter)).map_err(|_| invalid())?;
            let row = response
                .sessions
                .into_iter()
                .find(|row| row.session_id == session_id)
                .ok_or_else(invalid)?;
            let source = row.storage_path.ok_or_else(invalid)?;
            // Only Codex JSONL has the response-item/image-marker contract above.
            if row.external_history_source.as_deref() != Some("codex_app")
                || !source.ends_with(".jsonl")
            {
                return Err(invalid());
            }
            recover_embedded(
                std::fs::File::open(source).map_err(|_| invalid())?,
                image_ref,
            )
        }
        Err(_) => Err(invalid()),
    }
}

fn preview(bytes: &[u8]) -> Result<Value, RpcError> {
    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| invalid())?;
    if !matches!(
        reader.format(),
        Some(image::ImageFormat::Png | image::ImageFormat::Jpeg | image::ImageFormat::WebP)
    ) {
        return Err(invalid());
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(96 * 1024 * 1024);
    reader.limits(limits);
    let decoded = reader.decode().map_err(|_| invalid())?;
    for edge in [1280, 960, 640, 320] {
        let small = decoded.thumbnail(edge, edge).to_rgb8();
        let mut output = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output, 80)
            .encode_image(&small)
            .map_err(|_| invalid())?;
        if output.len() <= MAX_PREVIEW {
            return Ok(
                json!({ "dataUrl": format!("data:image/jpeg;base64,{}", STANDARD.encode(output)),
                "width": small.width(), "height": small.height() }),
            );
        }
    }
    Err(invalid())
}

pub async fn session_image(params: &Value) -> Result<Value, RpcError> {
    let parsed: ImageParams = serde_json::from_value(params.clone()).map_err(|_| invalid())?;
    if [&parsed.session_id, &parsed.round_id, &parsed.event_id]
        .iter()
        .any(|id| id.trim().is_empty() || id.len() > 1024)
        || parsed.image_index >= MAX_IMAGES
    {
        return Err(invalid());
    }
    // No unbounded queue; thumbnails are explicitly retriable by the caller.
    let permit = IMAGE_WORK
        .try_acquire()
        .map_err(|_| RpcError::invalid_params("image service is busy; retry"))?;
    let events =
        super::session::authoritative_round_events(&parsed.session_id, &parsed.round_id).await?;
    let event = events
        .iter()
        .find(|event| event.id == parsed.event_id)
        .ok_or_else(invalid)?;
    let image_ref = refs(&event.result)
        .nth(parsed.image_index)
        .ok_or_else(invalid)?
        .to_owned();
    drop(events);
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        preview(&load_bytes(&parsed.session_id, &image_ref)?)
    })
    .await
    .map_err(|_| invalid())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn rejects_client_paths_and_invalid_indexes_before_loading_history() {
        let mut params = json!({"sessionId":"s", "roundId":"r", "eventId":"e", "imageIndex":0, "path":"/tmp/private.png"});
        assert!(session_image(&params).await.is_err());
        params.as_object_mut().unwrap().remove("path");
        params["imageIndex"] = json!(8);
        assert!(session_image(&params).await.is_err());
        params["imageIndex"] = json!(-1);
        assert!(session_image(&params).await.is_err());
    }
    #[test]
    fn local_image_reads_are_bounded_and_remote_urls_are_not_fetched() {
        assert!(load_bytes("s", "https://localhost/private.png").is_err());
        assert!(load_bytes("s", "../private.png").is_err());
        let file = tempfile::NamedTempFile::new().unwrap();
        file.as_file().set_len((MAX_INPUT + 1) as u64).unwrap();
        assert!(load_bytes("s", file.path().to_str().unwrap()).is_err());
    }
    #[test]
    #[ignore = "requires an explicitly supplied local Codex transcript and image reference"]
    fn local_history_image_recovery() {
        let path = std::env::var("ORG2_TEST_IMAGE_TRANSCRIPT").expect("transcript fixture");
        let image_ref = std::env::var("ORG2_TEST_IMAGE_REF").expect("image reference");
        let bytes = recover_embedded(std::fs::File::open(path).unwrap(), &image_ref).unwrap();
        let result = preview(&bytes).unwrap();
        assert!(result["width"].as_u64().unwrap() > 0);
        eprintln!("Recovered preview: {}x{}, {} encoded bytes", result["width"], result["height"], result["dataUrl"].as_str().unwrap().len());
    }
    #[test]
    fn reference_projection_is_bounded_and_has_no_payload() {
        assert_eq!(
            image_count(&json!({"images": [null, "", "/tmp/a.png", "data:image/png;base64,AA=="]})),
            2
        );
        assert_eq!(image_count(&json!({"images": vec!["x"; 100]})), MAX_IMAGES);
    }
    #[test]
    fn recovers_only_the_matching_user_image_marker() {
        let row = json!({"type":"response_item","payload":{"role":"user","content":[
            {"type":"input_text","text":"<image name=[Image #1] path=\"/tmp/a.png\">"},
            {"type":"input_image","image_url":"data:image/png;base64,aGVsbG8="},
            {"type":"input_text","text":"</image>"}]}})
        .to_string();
        assert_eq!(
            recover_embedded(row.as_bytes(), "/tmp/a.png").unwrap(),
            b"hello"
        );
        assert!(recover_embedded(row.as_bytes(), "/tmp/b.png").is_err());
        assert!(recover_embedded(
            row.replace("\"user\"", "\"assistant\"").as_bytes(),
            "/tmp/a.png"
        )
        .is_err());
    }
    #[test]
    fn preview_rejects_text_and_svg_and_bounds_output() {
        assert!(preview(b"secret text").is_err());
        assert!(preview(b"<svg xmlns='http://www.w3.org/2000/svg'/>").is_err());
        let image = image::RgbImage::new(2000, 1000);
        let mut png = Cursor::new(Vec::new());
        image.write_to(&mut png, image::ImageFormat::Png).unwrap();
        let result = preview(png.get_ref()).unwrap();
        assert_eq!(result["width"], 1280);
        assert!(result["dataUrl"].as_str().unwrap().len() < 512 * 1024 + 128);
    }
}
