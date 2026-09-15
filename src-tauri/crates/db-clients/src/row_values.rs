//! Preserve SQL NULL separately from decoder failures and unsupported types.
use serde_json::Value;
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
            _ if <String as sqlx::Type<sqlx::Postgres>>::compatible(column.type_info()) => row.try_get::<String, _>(index).map(Value::String).map_err(error),
            _ => Err(format!("Unsupported SQL type {type_name} in column {}. Select an explicit text cast to view this value.", column.name())),
        })
    }).collect()
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
