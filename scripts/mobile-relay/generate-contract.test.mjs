import assert from "node:assert/strict";
import { test } from "node:test";

import { typescriptType } from "./generate-contract.mjs";

test("emits required/optional/null and discriminated union shapes", () => {
  assert.equal(
    typescriptType({
      type: "object",
      required: ["type"],
      properties: {
        type: { const: "example" },
        lastSeenMs: { type: ["integer", "null"] },
      },
    }),
    '{ "type": "example"; "lastSeenMs"?: number | null; }'
  );
  assert.equal(
    typescriptType({ enum: ["full", "read_only"] }),
    '"full" | "read_only"'
  );
  assert.equal(typescriptType(true), "unknown");
});

test("fails closed on unsupported schema features and external references", () => {
  assert.throws(() => typescriptType({ allOf: [] }), /Unsupported/);
  assert.throws(
    () => typescriptType({ $ref: "https://example.com/schema" }),
    /Unsupported/
  );
  assert.throws(
    () =>
      typescriptType({
        type: "object",
        additionalProperties: { type: "string" },
      }),
    /additionalProperties/
  );
});
