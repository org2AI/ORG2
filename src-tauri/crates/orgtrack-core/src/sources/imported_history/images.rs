/// Bound retained attachment metadata independently of the provider row size.
/// Full attachment lists (including data URLs) remain in the source turn.
pub(crate) fn bounded_image_refs<'a>(refs: impl IntoIterator<Item = &'a str>) -> Vec<String> {
    let mut remaining = 2_048usize;
    let mut kept: Vec<String> = refs
        .into_iter()
        .filter(|value| !value.starts_with("data:"))
        .filter(|value| {
            let cost = value.len().saturating_add(std::mem::size_of::<String>());
            if cost > remaining {
                return false;
            }
            remaining -= cost;
            true
        })
        .map(str::to_string)
        .collect();
    kept.shrink_to_fit();
    kept
}

#[cfg(test)]
mod image_tests {
    use super::bounded_image_refs;

    #[test]
    fn catalog_never_retains_embedded_bytes_and_bounds_reference_memory() {
        let mut refs = vec![format!("data:image/png;base64,{}", "A".repeat(1024 * 1024))];
        refs.extend((0..100).map(|n| format!("/tmp/{n}-{}.png", "x".repeat(100))));
        let kept = bounded_image_refs(refs.iter().map(String::as_str));
        assert!(!kept.is_empty());
        assert!(kept.iter().all(|r| !r.starts_with("data:")));
        assert!(
            kept.iter()
                .map(|r| r.len() + std::mem::size_of::<String>())
                .sum::<usize>()
                <= 2_048
        );
    }
}

/// Preserve explicitly typed MCP/Anthropic image blocks at the ingestion boundary.
/// Text, tool arguments and arbitrary nested JSON are never interpreted as images.
pub fn content_image_refs(content: Option<&serde_json::Value>) -> Vec<String> {
    use serde_json::Value;
    let mut images = Vec::new();
    for part in content.and_then(Value::as_array).into_iter().flatten() {
        if !matches!(
            part.get("type").and_then(Value::as_str),
            Some("image" | "input_image" | "output_image" | "image_url")
        ) {
            continue;
        }
        let source = part.get("source").unwrap_or(part);
        let url = part
            .get("image_url")
            .and_then(|v| v.as_str().or_else(|| v.get("url").and_then(Value::as_str)))
            .or_else(|| source.get("url").and_then(Value::as_str));
        let image = if let Some(url) = url.filter(|url| {
            url.starts_with("data:image/")
                || url.starts_with("https://")
                || url.starts_with("http://")
        }) {
            Some(url.to_owned())
        } else {
            let mime = source
                .get("media_type")
                .or_else(|| source.get("mimeType"))
                .and_then(Value::as_str);
            let data = source.get("data").and_then(Value::as_str);
            match (mime, data) {
                (
                    Some(mime @ ("image/png" | "image/jpeg" | "image/gif" | "image/webp")),
                    Some(data),
                ) => Some(format!("data:{mime};base64,{data}")),
                _ => None,
            }
        };
        if let Some(image) = image {
            if !images.contains(&image) {
                images.push(image);
            }
        }
    }
    images
}

#[cfg(test)]
mod output_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn preserves_mcp_and_anthropic_images_without_interpreting_text() {
        let content = json!([
            {"type":"image","mimeType":"image/png","data":"MCP"},
            {"type":"image","source":{"type":"base64","media_type":"image/jpeg","data":"CLAUDE"}},
            {"type":"text","text":"/tmp/unrelated.png"},
            {"type":"image","source":{"type":"url","url":"https://example.com/image.png"}}
        ]);
        assert_eq!(
            content_image_refs(Some(&content)),
            vec![
                "data:image/png;base64,MCP",
                "data:image/jpeg;base64,CLAUDE",
                "https://example.com/image.png"
            ]
        );
    }
}
