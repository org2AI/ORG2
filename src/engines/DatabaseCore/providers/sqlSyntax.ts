export function quoteIdentifier(
  value: string,
  delimiter: '"' | "`" = '"'
): string {
  if (value.includes("\0"))
    throw new Error("Database identifier contains a null byte");
  return (
    delimiter + value.split(delimiter).join(delimiter + delimiter) + delimiter
  );
}

export function quoteLiteral(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}
