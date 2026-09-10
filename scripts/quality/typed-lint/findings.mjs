import { createHash } from "node:crypto";
import path from "node:path";

// TypeScript can reorder literal unions when import traversal changes. The
// missing-case set is the finding; its diagnostic display order is not.
function findingKey({ file, rule, message, source }) {
  const prefix = "Switch is not exhaustive. Cases not matched: ";
  if (
    rule === "@typescript-eslint/switch-exhaustiveness-check" &&
    message.startsWith(prefix)
  ) {
    const cases = message.slice(prefix.length);
    // Only normalize a complete list of quoted literals. Do not split inside
    // literals containing a pipe or an escaped quote, or reinterpret other
    // TypeScript diagnostic syntax.
    const literalList = /^"(?:[^"\\]|\\.)*"(?: \| "(?:[^"\\]|\\.)*")*$/;
    if (literalList.test(cases)) {
      message =
        prefix +
        cases
          .match(/"(?:[^"\\]|\\.)*"/g)
          .sort()
          .join(" | ");
    }
  }
  return createHash("sha256")
    .update(JSON.stringify([file, rule, message, source]))
    .digest("hex");
}

export function collectFindings(results, root) {
  const grouped = new Map();
  for (const result of results) {
    const lines = (result.source ?? "").split(/\r?\n/);
    for (const message of result.messages) {
      if (message.fatal || !message.ruleId) {
        throw new Error(
          `${result.filePath}:${message.line}: ${message.message}`
        );
      }
      const file = path
        .relative(root, result.filePath)
        .split(path.sep)
        .join("/");
      const selected = lines.slice(
        message.line - 1,
        message.endLine ?? message.line
      );
      if (selected.length) {
        selected[selected.length - 1] = selected
          .at(-1)
          .slice(0, message.endColumn ? message.endColumn - 1 : undefined);
        selected[0] = selected[0].slice(message.column - 1);
      }
      const source = selected.join("\n").replace(/\s+/g, " ").trim();
      const key = findingKey({
        file,
        rule: message.ruleId,
        message: message.message,
        source,
      });
      const finding = grouped.get(key) ?? {
        key,
        file,
        rule: message.ruleId,
        message: message.message,
        source,
        count: 0,
      };
      finding.count++;
      grouped.set(key, finding);
    }
  }
  return [...grouped.values()].sort(
    (a, b) => a.file.localeCompare(b.file) || a.key.localeCompare(b.key)
  );
}

export function newFindings(current, baseline) {
  if (!Array.isArray(baseline)) throw new Error("Baseline must be an array");
  const limits = new Map();
  for (const entry of baseline) {
    // Recompute legacy keys with the same normalization; no baseline rewrite
    // or extra allowance is needed when only diagnostic ordering changes.
    const key = findingKey(entry);
    if (
      limits.has(key) ||
      !Number.isSafeInteger(entry.count) ||
      entry.count < 1
    )
      throw new Error("Invalid or duplicate baseline entry");
    limits.set(key, entry.count);
  }
  return current.filter((entry) => entry.count > (limits.get(entry.key) ?? 0));
}
