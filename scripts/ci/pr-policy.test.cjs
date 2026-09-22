const assert = require("node:assert/strict");
const test = require("node:test");

const {
  parseTitle,
  validateDescription,
  validatePullRequest,
} = require("./pr-policy.cjs");

const VALID_BODY = `## Problem

Session replay could lose the final turn after a reconnect.

## Solution

Persist the authoritative cursor before replay resumes.

## Potential risks

Older sessions keep their existing cursor until the next successful replay.

## Verification

- \`node --test scripts/ci/*.test.cjs\` — passed
`;

test("parses every allowed title type", () => {
  const expected = [
    "feat",
    "fix",
    "refactor",
    "perf",
    "test",
    "docs",
    "chore",
    "build",
    "ci",
    "style",
    "revert",
  ];

  for (const type of expected) {
    assert.deepEqual(parseTitle(`${type}(session-replay): verify policy`), {
      type,
      scope: "session-replay",
      summary: "verify policy",
    });
  }
});

test("rejects unscoped, uppercase, and malformed titles", () => {
  assert.equal(parseTitle("fix: missing scope"), null);
  assert.equal(parseTitle("Fix(session): uppercase type"), null);
  assert.equal(parseTitle("fix(Session): uppercase scope"), null);
  assert.equal(parseTitle("fix(session) missing colon"), null);
});

test("accepts the required description structure and evidence", () => {
  assert.deepEqual(validateDescription(VALID_BODY), []);
});

test("rejects reordered, missing, or placeholder-only sections", () => {
  const errors = validateDescription(`## Solution

Implemented it.

## Problem

<!-- TODO -->

## Potential risks

-
`);

  assert.ok(errors.some((error) => error.includes("exact order")));
  assert.ok(errors.some((error) => error.includes("## Problem")));
  assert.ok(errors.some((error) => error.includes("## Potential risks")));
  assert.ok(errors.some((error) => error.includes("## Verification")));
});

test("validates a complete pull request contract", () => {
  assert.deepEqual(
    validatePullRequest({
      title: "fix(session): preserve final turns",
      body: VALID_BODY,
    }),
    []
  );
});

test("does not require or validate labels", () => {
  const pullRequest = {
    title: "fix(session): preserve final turns",
    body: VALID_BODY,
  };

  assert.deepEqual(validatePullRequest(pullRequest), []);
  assert.deepEqual(
    validatePullRequest({
      ...pullRequest,
      labels: ["bug", "enhancement", "agent", "chat", "sessions"],
    }),
    []
  );
});

const DEPENDABOT_PR = {
  title: "chore(deps): bump the cargo-security group",
  body: "Bumps rand and tauri. Release notes and compatibility details follow.",
  user: { login: "dependabot[bot]", type: "Bot" },
  head: {
    ref: "dependabot/cargo/security",
    repo: { full_name: "org2AI/ORG2" },
  },
  base: { repo: { full_name: "org2AI/ORG2" } },
};

test("accepts generated Dependabot descriptions without skipping title validation", () => {
  assert.deepEqual(validatePullRequest(DEPENDABOT_PR), []);
  assert.equal(
    validatePullRequest({ ...DEPENDABOT_PR, title: "unscoped" }).length,
    1
  );
  assert.ok(
    validatePullRequest({ ...DEPENDABOT_PR, body: "<!-- empty -->" }).length
  );
});

test("requires verified bot authorship, same repository, and Dependabot branch", () => {
  for (const override of [
    { user: { login: "human", type: "User" } },
    { user: { login: "dependabot[bot]", type: "User" } },
    { user: { login: "other[bot]", type: "Bot" } },
    { user: undefined },
    { head: { ...DEPENDABOT_PR.head, repo: { full_name: "fork/ORG2" } } },
    { head: { ...DEPENDABOT_PR.head, ref: "dev/change" } },
    { head: undefined },
    { base: undefined },
  ]) {
    assert.ok(validatePullRequest({ ...DEPENDABOT_PR, ...override }).length);
  }
});
