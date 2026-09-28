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
        .is_some_and(|suffix| {
            suffix.len() == 8
                && suffix
                    .bytes()
                    .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
        });
    // Numbered bundles are 2..99; the separately defined dev bundle uses
    // orgii-dev, never orgii-instance100. Keep this aligned with appScheme.ts.
    let instance = scheme.strip_prefix("orgii-instance").is_some_and(|suffix| {
        matches!(
            suffix.as_bytes(),
            [b'2'..=b'9'] | [b'1'..=b'9', b'0'..=b'9']
        )
    });
    if matches!(scheme, DEFAULT_APP_SCHEME | "orgii-dev") || local || instance {
        Ok(scheme)
    } else {
        Err("invalid_market_app_scheme")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_build_schemes_are_bounded_and_canonical() {
        for value in [
            "orgii",
            "orgii-dev",
            "orgii-instance2",
            "orgii-instance9",
            "orgii-instance10",
            "orgii-instance93",
            "orgii-instance99",
            "orgii-market-local-12abcdef",
        ] {
            assert_eq!(validated_scheme(value), Ok(value));
        }
        for value in [
            "orgii-instance0",
            "orgii-instance1",
            "orgii-instance100",
            "orgii-instance02",
            "orgii-instance093",
            "orgii-instance+2",
            "orgii-instance2x",
            "orgii-instance2-dev",
            "orgii-dev-other",
            "orgii-market-local-12ABCDEF",
            "orgii-market-local-12abcde",
            "orgii-market-local-12abcdef0",
            "orgii\n",
            "orgii-instance93\n",
            "https",
        ] {
            assert_eq!(validated_scheme(value), Err("invalid_market_app_scheme"));
        }
    }

    #[test]
    fn enrollment_envelopes_still_require_the_exact_compiled_scheme() {
        let selected = app_scheme().unwrap();
        for scheme in [
            "orgii",
            "orgii-dev",
            "orgii-instance2",
            "orgii-instance93",
            "orgii-instance99",
            "orgii-market-local-12abcdef",
            selected,
        ] {
            assert!(validated_scheme(scheme).is_ok());
            for path in ["/connect", "/authorized"] {
                let raw = format!("{scheme}://market{path}?fixture=1");
                assert_eq!(
                    super::super::envelope(&raw, path).is_some(),
                    scheme == selected
                );
            }
        }
    }

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
