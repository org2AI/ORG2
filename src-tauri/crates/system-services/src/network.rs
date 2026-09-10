//! Network Utilities
//!
//! - Public IP + geolocation lookup via ipinfo.io (bypasses webview HTTP cache).
//! - Local LAN IPv4 discovery for Mobile Remote.

use std::process::Command;
use std::time::Duration;

// ============================================
// Public IP + Geolocation
// ============================================

#[derive(serde::Serialize, Default)]
pub struct GeoInfo {
    pub ip: String,
    pub city: String,
    pub region: String,
    pub country: String,
    pub org: String,
}

/// Fetch public IP and geolocation from ipinfo.io using reqwest.
/// Bypasses webview HTTP cache — always hits the network.
#[tauri::command]
pub async fn fetch_geo_info() -> Result<GeoInfo, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .no_proxy()
        .build()
        .map_err(|err| err.to_string())?;

    let resp = client
        .get("https://ipinfo.io/json?token=")
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|err| err.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let data: serde_json::Value = resp.json().await.map_err(|err| err.to_string())?;

    Ok(GeoInfo {
        ip: data["ip"].as_str().unwrap_or_default().to_string(),
        city: data["city"].as_str().unwrap_or_default().to_string(),
        region: data["region"].as_str().unwrap_or_default().to_string(),
        country: data["country"].as_str().unwrap_or_default().to_string(),
        org: data["org"].as_str().unwrap_or_default().to_string(),
    })
}

// ============================================
// Local LAN IPv4
// ============================================

fn is_lan_ipv4(ip: &std::net::Ipv4Addr) -> bool {
    ip.is_private() && !ip.is_loopback()
}

fn parse_lan_ipv4(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let ip: std::net::Ipv4Addr = trimmed.parse().ok()?;
    is_lan_ipv4(&ip).then(|| trimmed.to_string())
}

#[cfg(target_os = "macos")]
fn get_local_lan_ip_blocking() -> Result<String, String> {
    for iface in ["en0", "en1", "en2", "bridge0"] {
        let output = Command::new("ipconfig")
            .args(["getifaddr", iface])
            .output()
            .map_err(|err| err.to_string())?;
        if !output.status.success() {
            continue;
        }
        if let Some(ip) = parse_lan_ipv4(&String::from_utf8_lossy(&output.stdout)) {
            return Ok(ip);
        }
    }

    let output = Command::new("ifconfig")
        .output()
        .map_err(|err| err.to_string())?;
    if !output.status.success() {
        return Err("ifconfig failed".to_string());
    }

    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("inet ") || trimmed.contains("127.0.0.1") {
            continue;
        }
        let ip_part = trimmed
            .strip_prefix("inet ")
            .and_then(|rest| rest.split_whitespace().next())
            .unwrap_or_default();
        if let Some(ip) = parse_lan_ipv4(ip_part) {
            return Ok(ip);
        }
    }

    Err("No LAN IPv4 address found".to_string())
}

#[cfg(target_os = "linux")]
fn get_local_lan_ip_blocking() -> Result<String, String> {
    let output = Command::new("ip")
        .args(["-4", "-o", "addr", "show", "scope", "global", "up"])
        .output()
        .map_err(|err| err.to_string())?;
    if output.status.success() {
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            for token in line.split_whitespace() {
                if let Some(ip) = parse_lan_ipv4(token.split('/').next().unwrap_or_default()) {
                    return Ok(ip);
                }
            }
        }
    }

    let output = Command::new("hostname")
        .args(["-I"])
        .output()
        .map_err(|err| err.to_string())?;
    if output.status.success() {
        for token in String::from_utf8_lossy(&output.stdout).split_whitespace() {
            if let Some(ip) = parse_lan_ipv4(token) {
                return Ok(ip);
            }
        }
    }

    Err("No LAN IPv4 address found".to_string())
}

#[cfg(target_os = "windows")]
fn get_local_lan_ip_blocking() -> Result<String, String> {
    let mut command = Command::new("ipconfig");
    app_platform::hide_console(&mut command);
    let output = command.output().map_err(|err| err.to_string())?;
    if !output.status.success() {
        return Err("ipconfig failed".to_string());
    }

    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let trimmed = line.trim();
        let value = trimmed
            .strip_prefix("IPv4 Address")
            .or_else(|| trimmed.strip_prefix("IP Address"))
            .map(|rest| rest.trim_start_matches(':').trim());
        if let Some(raw) = value {
            if let Some(ip) = parse_lan_ipv4(raw.trim_end_matches("(Preferred)")) {
                return Ok(ip);
            }
        }
    }

    Err("No LAN IPv4 address found".to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn get_local_lan_ip_blocking() -> Result<String, String> {
    Err("LAN IP detection is not supported on this platform".to_string())
}

/// Best-effort private IPv4 on the active LAN interface (for Mobile Remote QR URLs).
#[tauri::command]
pub async fn get_local_lan_ip() -> Result<String, String> {
    tokio::task::spawn_blocking(get_local_lan_ip_blocking)
        .await
        .map_err(|err| err.to_string())?
}

#[cfg(test)]
mod lan_ip_tests {
    use super::{is_lan_ipv4, parse_lan_ipv4};

    #[test]
    fn accepts_private_ipv4() {
        assert_eq!(
            parse_lan_ipv4("192.168.1.42").as_deref(),
            Some("192.168.1.42")
        );
        assert_eq!(parse_lan_ipv4("10.0.0.5").as_deref(), Some("10.0.0.5"));
    }

    #[test]
    fn rejects_loopback_and_public_ipv4() {
        assert!(parse_lan_ipv4("127.0.0.1").is_none());
        assert!(parse_lan_ipv4("8.8.8.8").is_none());
    }

    #[test]
    fn lan_ipv4_predicate() {
        assert!(is_lan_ipv4(&"192.168.0.1".parse().unwrap()));
        assert!(!is_lan_ipv4(&"127.0.0.1".parse().unwrap()));
    }
}
