//! Preserve SQL NULL separately from decoder failures and unsupported types.
use serde_json::Value;
use sqlx::types::chrono;
use sqlx::{Column, Row, TypeInfo, ValueRef};

const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
fn integer_json(value: i64) -> Value {
    if (-MAX_SAFE_INTEGER..=MAX_SAFE_INTEGER).contains(&value) {
        value.into()
    } else {
        Value::String(value.to_string())
    }
}
#[cfg(any(feature = "mysql", test))]
fn unsigned_json(value: u64) -> Value {
    if value <= MAX_SAFE_INTEGER as u64 {
        value.into()
    } else {
        Value::String(value.to_string())
    }
}
fn cell_value(
    is_null: bool,
    decode: impl FnOnce() -> Result<Value, String>,
) -> Result<Value, String> {
    if is_null {
        Ok(Value::Null)
    } else {
        decode()
    }
}
fn float_json(value: f64) -> Result<Value, String> {
    serde_json::Number::from_f64(value)
        .map(Value::Number)
        .ok_or_else(|| "Non-finite SQL floating-point value cannot be represented as JSON".into())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Render PostgreSQL's binary NUMERIC wire format as its exact decimal text:
/// `ndigits`, `weight`, `sign`, `dscale`, then base-10000 digit groups.
#[cfg(any(feature = "postgres", test))]
fn pg_numeric_text(bytes: &[u8]) -> Result<String, String> {
    let malformed = || "Malformed PostgreSQL NUMERIC value".to_string();
    let word = |at: usize| {
        bytes
            .get(at..at + 2)
            .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
            .ok_or_else(malformed)
    };
    let ndigits = word(0)? as usize;
    let weight = word(2)? as i16 as i64;
    let sign = word(4)?;
    let dscale = word(6)? as usize;
    match sign {
        0x0000 | 0x4000 => {}
        0xC000 => return Ok("NaN".into()),
        0xD000 => return Ok("Infinity".into()),
        0xF000 => return Ok("-Infinity".into()),
        _ => return Err(malformed()),
    }
    if bytes.len() != 8 + ndigits * 2 {
        return Err(malformed());
    }
    let digits = (0..ndigits)
        .map(|index| word(8 + index * 2))
        .collect::<Result<Vec<_>, _>>()?;
    let group = |index: i64| -> u16 {
        usize::try_from(index)
            .ok()
            .and_then(|index| digits.get(index).copied())
            .unwrap_or(0)
    };
    let mut text = String::new();
    if sign == 0x4000 && digits.iter().any(|digit| *digit != 0) {
        text.push('-');
    }
    if weight < 0 {
        text.push('0');
    } else {
        text.push_str(&group(0).to_string());
        for index in 1..=weight {
            text.push_str(&format!("{:04}", group(index)));
        }
    }
    if dscale > 0 {
        let mut fraction = String::new();
        let mut index = weight + 1;
        while fraction.len() < dscale {
            fraction.push_str(&format!("{:04}", group(index)));
            index += 1;
        }
        fraction.truncate(dscale);
        text.push('.');
        text.push_str(&fraction);
    }
    Ok(text)
}

#[cfg(feature = "postgres")]
pub fn pg_row_to_json(row: &sqlx::postgres::PgRow) -> Result<Vec<Value>, String> {
    row.columns().iter().map(|column| {
        let index = column.ordinal();
        let raw = row.try_get_raw(index).map_err(|e| e.to_string())?;
        let type_name = column.type_info().name();
        let error = |e: sqlx::Error| format!("Cannot decode column {} ({type_name}): {e}", column.name());
        cell_value(raw.is_null(), || match type_name {
            "BOOL" => row.try_get::<bool, _>(index).map(Value::Bool).map_err(error),
            "INT2" => row.try_get::<i16, _>(index).map(|v| integer_json(v.into())).map_err(error),
            "INT4" => row.try_get::<i32, _>(index).map(|v| integer_json(v.into())).map_err(error),
            "INT8" => row.try_get::<i64, _>(index).map(integer_json).map_err(error),
            "FLOAT4" => float_json(row.try_get::<f32, _>(index).map_err(error)?.into()),
            "FLOAT8" => float_json(row.try_get::<f64, _>(index).map_err(error)?),
            "JSON" | "JSONB" => row.try_get::<Value, _>(index).map_err(error),
            "NUMERIC" => pg_numeric_text(row.try_get_unchecked::<&[u8], _>(index).map_err(error)?).map(Value::String),
            "UUID" => row.try_get::<sqlx::types::Uuid, _>(index).map(|v| Value::String(v.to_string())).map_err(error),
            "DATE" => row.try_get::<chrono::NaiveDate, _>(index).map(|v| Value::String(v.to_string())).map_err(error),
            "TIME" => row.try_get::<chrono::NaiveTime, _>(index).map(|v| Value::String(v.to_string())).map_err(error),
            "TIMESTAMP" => row.try_get::<chrono::NaiveDateTime, _>(index).map(|v| Value::String(v.to_string())).map_err(error),
            "TIMESTAMPTZ" => row.try_get::<chrono::DateTime<chrono::Utc>, _>(index).map(|v| Value::String(v.format("%Y-%m-%dT%H:%M:%S%.fZ").to_string())).map_err(error),
            "OID" => row.try_get::<sqlx::postgres::types::Oid, _>(index).map(|v| v.0.into()).map_err(error),
            "BYTEA" => row.try_get::<Vec<u8>, _>(index).map(|v| Value::String(format!("\\x{}", hex(&v)))).map_err(error),
            _ if <String as sqlx::Type<sqlx::Postgres>>::compatible(column.type_info()) => row.try_get::<String, _>(index).map(Value::String).map_err(error),
            // Enum labels travel as UTF-8 text in the binary protocol.
            _ if matches!(column.type_info().kind(), sqlx::postgres::PgTypeKind::Enum(_)) => row.try_get_unchecked::<String, _>(index).map(Value::String).map_err(error),
            _ => Err(format!("Unsupported SQL type {type_name} in column {}. Select an explicit text cast to view this value.", column.name())),
        })
    }).collect()
}

/// MySQL's own TIME text: signed, zero-padded, and ranging past 24 hours.
#[cfg(feature = "mysql")]
fn mysql_time_text(time: sqlx::mysql::types::MySqlTime) -> Value {
    // `MySqlTime::is_negative` is inverted in sqlx 0.8.6; ask the sign itself.
    let sign = if time.sign().is_negative() { "-" } else { "" };
    let mut text = format!(
        "{sign}{:02}:{:02}:{:02}",
        time.hours(),
        time.minutes(),
        time.seconds()
    );
    if time.microseconds() != 0 {
        text.push_str(&format!(".{:06}", time.microseconds()));
    }
    Value::String(text)
}

#[cfg(feature = "mysql")]
pub fn mysql_row_to_json(row: &sqlx::mysql::MySqlRow) -> Result<Vec<Value>, String> {
    row.columns().iter().map(|column| {
        let index = column.ordinal();
        let raw = row.try_get_raw(index).map_err(|e| e.to_string())?;
        let type_name = column.type_info().name();
        let error = |e: sqlx::Error| format!("Cannot decode column {} ({type_name}): {e}", column.name());
        cell_value(raw.is_null(), || match type_name {
            "BOOLEAN" | "TINYINT(1)" => row.try_get::<bool, _>(index).map(Value::Bool).map_err(error),
            "TINYINT" | "SMALLINT" | "INT" | "MEDIUMINT" | "BIGINT" => row.try_get::<i64, _>(index).map(integer_json).map_err(error),
            "TINYINT UNSIGNED" | "SMALLINT UNSIGNED" | "INT UNSIGNED" | "MEDIUMINT UNSIGNED" | "BIGINT UNSIGNED" => row.try_get::<u64, _>(index).map(unsigned_json).map_err(error),
            "FLOAT" => float_json(row.try_get::<f32, _>(index).map_err(error)?.into()),
            "DOUBLE" => float_json(row.try_get::<f64, _>(index).map_err(error)?),
            "JSON" => row.try_get::<Value, _>(index).map_err(error),
            "CHAR" | "VARCHAR" | "TEXT" | "TINYTEXT" | "MEDIUMTEXT" | "LONGTEXT" | "ENUM" | "SET" => row.try_get::<String, _>(index).map(Value::String).map_err(error),
            // DECIMAL is sent as its exact decimal text, even in the binary protocol.
            "DECIMAL" => row.try_get_unchecked::<String, _>(index).map(Value::String).map_err(error),
            "YEAR" | "BIT" => row.try_get_unchecked::<u64, _>(index).map(unsigned_json).map_err(error),
            // A zero-length binary value is MySQL's zero date ("0000-00-00").
            "DATE" if row.try_get_unchecked::<&[u8], _>(index).map_err(error)?.is_empty() => Ok(Value::String("0000-00-00".into())),
            "DATETIME" | "TIMESTAMP" if row.try_get_unchecked::<&[u8], _>(index).map_err(error)?.is_empty() => Ok(Value::String("0000-00-00 00:00:00".into())),
            "DATE" => row.try_get_unchecked::<chrono::NaiveDate, _>(index).map(|v| Value::String(v.to_string())).map_err(error),
            "DATETIME" | "TIMESTAMP" => row.try_get_unchecked::<chrono::NaiveDateTime, _>(index).map(|v| Value::String(v.to_string())).map_err(error),
            "TIME" => row.try_get::<sqlx::mysql::types::MySqlTime, _>(index).map(mysql_time_text).map_err(error),
            "BINARY" | "VARBINARY" | "TINYBLOB" | "BLOB" | "MEDIUMBLOB" | "LONGBLOB" => row.try_get::<Vec<u8>, _>(index).map(|v| Value::String(format!("0x{}", hex(&v)))).map_err(error),
            _ => Err(format!("Unsupported SQL type {type_name} in column {}. Select an explicit text cast to view this value.", column.name())),
        })
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_database_null_skips_decoding() {
        assert_eq!(
            cell_value(true, || panic!("NULL must not decode")).unwrap(),
            Value::Null
        );
        assert_eq!(
            cell_value(false, || Err("unsupported type".into())).unwrap_err(),
            "unsupported type"
        );
        assert_eq!(
            cell_value(false, || Err("malformed payload".into())).unwrap_err(),
            "malformed payload"
        );
        assert_eq!(
            cell_value(false, || Ok(Value::String("present".into()))).unwrap(),
            Value::String("present".into())
        );
    }
    #[test]
    fn integers_preserve_javascript_precision() {
        assert_eq!(
            integer_json(MAX_SAFE_INTEGER),
            serde_json::json!(MAX_SAFE_INTEGER)
        );
        assert_eq!(integer_json(i64::MAX), Value::String(i64::MAX.to_string()));
        assert_eq!(integer_json(i64::MIN), Value::String(i64::MIN.to_string()));
        assert_eq!(unsigned_json(u64::MAX), Value::String(u64::MAX.to_string()));
        assert_eq!(unsigned_json(42), serde_json::json!(42));
    }
    #[test]
    fn nonfinite_values_are_errors_not_null() {
        assert!(float_json(f64::INFINITY).is_err());
        assert!(float_json(f64::NAN).is_err());
        assert_eq!(float_json(1.5).unwrap(), serde_json::json!(1.5));
    }
    fn numeric(weight: i16, sign: u16, dscale: u16, digits: &[u16]) -> Vec<u8> {
        let mut bytes = Vec::new();
        for word in [digits.len() as u16, weight as u16, sign, dscale]
            .into_iter()
            .chain(digits.iter().copied())
        {
            bytes.extend_from_slice(&word.to_be_bytes());
        }
        bytes
    }
    #[test]
    fn postgres_numeric_renders_exact_decimal_text() {
        let text = |w, s, d, g: &[u16]| pg_numeric_text(&numeric(w, s, d, g)).unwrap();
        assert_eq!(text(0, 0, 2, &[123, 4500]), "123.45");
        assert_eq!(text(0, 0x4000, 2, &[123, 4500]), "-123.45");
        assert_eq!(text(-1, 0, 3, &[10]), "0.001");
        assert_eq!(text(-2, 0, 5, &[1000]), "0.00001");
        assert_eq!(text(1, 0, 0, &[1]), "10000");
        assert_eq!(text(1, 0, 0, &[1234, 5678]), "12345678");
        assert_eq!(text(0, 0, 0, &[]), "0");
        assert_eq!(text(0, 0, 2, &[]), "0.00");
        assert_eq!(
            text(4, 0, 4, &[9, 2233, 7203, 6854, 7758, 700]),
            "92233720368547758.0700"
        );
        assert_eq!(text(0, 0xC000, 0, &[]), "NaN");
        assert_eq!(text(0, 0xF000, 0, &[]), "-Infinity");
        assert!(pg_numeric_text(&[0, 1]).is_err());
        assert!(pg_numeric_text(&numeric(0, 0, 0, &[1])[..9]).is_err());
    }
    #[test]
    fn bytes_render_as_lowercase_hex() {
        assert_eq!(hex(&[0x00, 0xab, 0x10]), "00ab10");
    }
    #[cfg(feature = "mysql")]
    #[test]
    fn mysql_time_matches_server_text() {
        use sqlx::mysql::types::{MySqlTime, MySqlTimeSign};
        let time = |sign, hours, micros| {
            mysql_time_text(MySqlTime::new(sign, hours, 2, 3, micros).unwrap())
        };
        assert_eq!(time(MySqlTimeSign::Negative, 1, 0), "-01:02:03");
        assert_eq!(time(MySqlTimeSign::Positive, 838, 0), "838:02:03");
        assert_eq!(time(MySqlTimeSign::Positive, 0, 500), "00:02:03.000500");
    }
    #[cfg(feature = "postgres")]
    #[test]
    fn postgres_decoders_match_the_actual_driver_types() {
        use sqlx::{postgres::PgTypeInfo, Postgres, Type};
        assert!(<i16 as Type<Postgres>>::compatible(&PgTypeInfo::with_name(
            "INT2"
        )));
        assert!(<i32 as Type<Postgres>>::compatible(&PgTypeInfo::with_name(
            "INT4"
        )));
        assert!(<f32 as Type<Postgres>>::compatible(&PgTypeInfo::with_name(
            "FLOAT4"
        )));
        assert!(<f64 as Type<Postgres>>::compatible(&PgTypeInfo::with_name(
            "FLOAT8"
        )));
        assert!(!<f64 as Type<Postgres>>::compatible(
            &PgTypeInfo::with_name("NUMERIC")
        ));
    }
}
