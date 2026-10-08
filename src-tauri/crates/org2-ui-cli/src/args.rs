use std::collections::HashMap;
pub type Flags = HashMap<String, String>;
pub fn parse(args: &[String]) -> Result<(Vec<String>, Flags), String> {
    let mut words = Vec::new();
    let mut flags = Flags::new();
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        if let Some(name) = arg.strip_prefix("--") {
            if flags.contains_key(name) {
                return Err(format!("Duplicate option --{name}"));
            }
            let value = if matches!(name, "json" | "global" | "reveal" | "list") {
                "true".into()
            } else {
                iter.next()
                    .filter(|s| !s.starts_with("--"))
                    .ok_or_else(|| format!("--{name} requires a value"))?
                    .clone()
            };
            flags.insert(name.into(), value);
        } else {
            words.push(arg.clone());
        }
    }
    Ok((words, flags))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn duplicate_and_missing_option_values_are_errors() {
        for args in [
            vec!["--line"],
            vec!["--line", "--json"],
            vec!["--global", "--global"],
        ] {
            assert!(parse(&args.into_iter().map(String::from).collect::<Vec<_>>()).is_err());
        }
    }
}
