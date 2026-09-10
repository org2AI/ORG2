import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { format } from "prettier";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const crate = "src-tauri/crates/mobile-relay-protocol";
const output = resolve(root, "src/contracts/mobile-relay/v1");
const hash = (text) => createHash("sha256").update(text).digest("hex");

// Deliberately limited to the schema vocabulary emitted by this wire model.
// New schema features fail generation instead of silently weakening TS types.
export function typescriptType(schema) {
  if (schema === true) return "unknown";
  if (schema === false) return "never";
  const supported = new Set([
    "$schema",
    "$ref",
    "title",
    "description",
    "definitions",
    "default",
    "type",
    "properties",
    "required",
    "additionalProperties",
    "anyOf",
    "oneOf",
    "enum",
    "const",
    "format",
    "minimum",
    "maximum",
  ]);
  for (const key of Object.keys(schema)) {
    if (!supported.has(key))
      throw new Error(`Unsupported wire schema keyword: ${key}`);
  }
  if (schema.$ref) {
    const match = /^#\/definitions\/([A-Za-z][A-Za-z0-9]*)$/.exec(schema.$ref);
    if (!match) throw new Error(`Unsupported schema reference: ${schema.$ref}`);
    return match[1];
  }
  if ("const" in schema) return JSON.stringify(schema.const);
  if (schema.enum)
    return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  if (schema.oneOf || schema.anyOf) {
    return (schema.oneOf ?? schema.anyOf).map(typescriptType).join(" | ");
  }
  if (Array.isArray(schema.type)) {
    return schema.type
      .map((type) => typescriptType({ ...schema, type }))
      .join(" | ");
  }
  switch (schema.type) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "object": {
      if (schema.additionalProperties && schema.additionalProperties !== true) {
        throw new Error(
          "Typed additionalProperties needs an explicit generator implementation"
        );
      }
      const required = new Set(schema.required ?? []);
      const fields = Object.entries(schema.properties ?? {}).map(
        ([key, value]) =>
          `${JSON.stringify(key)}${required.has(key) ? "" : "?"}: ${typescriptType(value)};`
      );
      return `{ ${fields.join(" ")} }`;
    }
    case undefined:
      if (
        Object.keys(schema).every((key) =>
          ["title", "description", "$schema", "default"].includes(key)
        )
      )
        return "unknown";
      throw new Error("Schema has no supported shape");
    default:
      throw new Error(`Unsupported wire schema type: ${schema.type}`);
  }
}

export async function generateContract(check = false) {
  const result = spawnSync(
    "cargo",
    [
      "run",
      "--quiet",
      "--locked",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "-p",
      "mobile-relay-protocol",
      "--features",
      "contract-export",
      "--example",
      "export_contract",
    ],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 120_000,
    }
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `Rust contract export failed: ${result.error?.message ?? result.stderr}`
    );
  }
  const contract = JSON.parse(result.stdout);
  const lines = [
    "// Generated from mobile-relay-protocol. Do not edit; run scripts/mobile-relay/generate-contract.mjs.",
  ];
  for (const [name, value] of Object.entries(contract.constants)) {
    lines.push(`export const ${name} = ${JSON.stringify(value)};`);
  }
  for (const [name, schemas] of Object.entries(contract.types)) {
    // Request defaults are optional inputs; response fields describe real serialized output.
    lines.push(
      `export type ${name} = ${typescriptType(name.endsWith("Request") ? schemas.input : schemas.output)};`
    );
  }
  const files = {
    "relay.ts": await format(lines.join("\n"), { parser: "typescript" }),
    "schema.json": JSON.stringify(contract, null, 2) + "\n",
    "fixtures.json":
      JSON.stringify(
        JSON.parse(
          readFileSync(resolve(root, crate, "tests/fixtures/v1.json"), "utf8")
        ),
        null,
        2
      ) + "\n",
  };
  for (const name of ["schema.json", "fixtures.json"]) {
    files[name] = await format(files[name], { parser: "json" });
  }
  const sourceFiles = [
    `${crate}/src/lib.rs`,
    `${crate}/Cargo.toml`,
    `${crate}/examples/export_contract.rs`,
    `${crate}/tests/fixtures/v1.json`,
    "scripts/mobile-relay/generate-contract.mjs",
  ];
  files["manifest.json"] =
    JSON.stringify(
      {
        artifactVersion: contract.artifactVersion,
        protocolVersion: contract.constants.RELAY_PROTOCOL_VERSION,
        crateVersion: contract.crateVersion,
        source: "org2AI/ORG2:src-tauri/crates/mobile-relay-protocol",
        sourceHashes: Object.fromEntries(
          sourceFiles.map((name) => [
            name,
            hash(readFileSync(resolve(root, name))),
          ])
        ),
        files: Object.fromEntries(
          Object.entries(files).map(([name, content]) => [name, hash(content)])
        ),
      },
      null,
      2
    ) + "\n";
  files["manifest.json"] = await format(files["manifest.json"], {
    parser: "json",
  });
  if (!check) mkdirSync(output, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const path = resolve(output, name);
    if (check) {
      if (readFileSync(path, "utf8") !== content)
        throw new Error(`Stale generated Relay contract: ${name}`);
    } else writeFileSync(path, content);
  }
  console.log(
    `Relay v${contract.constants.RELAY_PROTOCOL_VERSION} contract ${check ? "verified" : "generated"}`
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--check"))
    throw new Error("Usage: generate-contract.mjs [--check]");
  await generateContract(args[0] === "--check");
}
