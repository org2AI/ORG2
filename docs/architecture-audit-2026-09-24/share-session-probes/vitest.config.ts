import base from "../../../config/vitest.config";

export default {
  ...base,
  test: {
    ...base.test,
    include: [
      "docs/architecture-audit-2026-09-24/share-session-probes/design.test.ts",
    ],
  },
};
