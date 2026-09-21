use url::Url;

const DEFAULT_APP_SCHEME: &str = "orgii";
const DEFAULT_CONSOLE_ORIGIN: &str = "https://market.org2.dev";
const DEFAULT_CONTROL_ORIGIN: &str = "https://org2-market.fly.dev:8443";
const DEFAULT_GATEWAY_ORIGIN: &str = "https://org2-market.fly.dev";

pub fn app_scheme() -> Result<&'static str, &'static str> {
    validated_scheme(option_env!("ORGII_DEEP_LINK_SCHEME").unwrap_or(DEFAULT_APP_SCHEME))
}

pub fn console_origin() -> Result<&'static str, &'static str> {
    validated_origin(option_env!("ORGII_MARKET_CONSOLE_ORIGIN").unwrap_or(DEFAULT_CONSOLE_ORIGIN))
}

pub fn control_origin() -> Result<&'static str, &'static str> {
    validated_origin(option_env!("ORGII_MARKET_CONTROL_ORIGIN").unwrap_or(DEFAULT_CONTROL_ORIGIN))
}

pub fn gateway_origin() -> Result<&'static str, &'static str> {
    validated_origin(option_env!("ORGII_MARKET_GATEWAY_ORIGIN").unwrap_or(DEFAULT_GATEWAY_ORIGIN))
}

pub(crate) fn validated_origin(raw: &'static str) -> Result<&'static str, &'static str> {
    let url = Url::parse(raw).map_err(|_| "invalid_market_origin")?;
    let secure = url.scheme() == "https";
    let local =
        url.scheme() == "http" && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "::1"));
    if (!secure && !local)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("invalid_market_origin");
    }
    Ok(raw.trim_end_matches('/'))
}

pub(crate) fn validated_scheme(scheme: &'static str) -> Result<&'static str, &'static str> {
    let local = scheme
        .strip_prefix("orgii-market-local-")
        .is_some_and(|suffix| suffix.len() == 8 && suffix.bytes().all(|b| b.is_ascii_hexdigit()));
    if scheme == DEFAULT_APP_SCHEME || local {
        Ok(scheme)
    } else {
        Err("invalid_market_app_scheme")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_secure_and_build_overrides_remain_bounded() {
        assert!(console_origin().is_ok());
        assert!(control_origin().is_ok());
        assert!(gateway_origin().is_ok());
        assert!(app_scheme().is_ok());
        for value in [
            "http://market.example",
            "file:///tmp/market",
            "https://user@example.test",
            "https://example.test/path",
        ] {
            assert!(validated_origin(value).is_err());
        }
    }
}
