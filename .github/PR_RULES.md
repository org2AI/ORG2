# ORGII Pull Request Rules

This tracked file is the repository-wide source of truth for pull requests.
It applies to humans and to every coding agent, including Codex, Claude, and
Cursor. Agent-specific instruction files may add implementation guidance, but
they must not weaken or contradict this policy.

## Coherent scope

- One pull request may group related changes under one coherent theme or
  user-facing objective. For example, update-dialog artwork, copy, controls,
  and update-flow localization can ship together.
- Explain the shared theme in the description and how each change supports it.
  Do not force related fixes into separate PRs merely because they touch
  different layers or could be implemented independently.
- Split changes with unrelated themes or objectives into separate pull
  requests. Sharing a repository or being requested together is not enough
  to make unrelated features, fixes, cleanup, or formatting one theme.
- Supporting tests and documentation belong with the theme they verify or
  explain. Explicitly requested policy changes may accompany that work when
  they define how the requested scope should be delivered; identify them in
  the description.
- Put unrelated follow-up work in a separate branch and pull request.
- Before handoff, compare the final branch against its base and confirm every
  changed file belongs to the stated theme, problem, or solution, or an
  explicitly requested delivery-policy change.

## Title

Pull request titles must use a scoped Conventional Commit form:

```text
type(lowercase-kebab-scope): short imperative summary
```

Allowed types are `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore`,
`build`, `ci`, `style`, and `revert`.

The scope is mandatory and must be lowercase kebab-case. Examples:
`feat(chat): add pinned actions` and `fix(session-replay): preserve turns`.

## Description

The description must begin with these top-level sections in this exact order:

```markdown
## Problem

<What is wrong, who or what is affected, and the root cause.>

## Solution

<What changed, the resulting invariant or behavior, and why this approach was chosen.>

## Potential risks

<Concrete regressions, compatibility concerns, unverified paths, or operational tradeoffs.>
```

All three sections must contain meaningful content. If no material risk
remains, say why. Do not replace them with `Summary`, `Overview`, or
`Test plan`.

A non-empty `## Verification` section is also required after the three
sections. It must list the exact commands and meaningful manual checks that
actually ran, their outcomes, and any relevant checks that did not run.
Additional sections such as `Audit`, screenshots, rollout notes, or rollback
details may follow the required sections.

### Dependabot-generated descriptions

PRs authored by GitHub's `dependabot[bot]` account (type `Bot`), from a
`dependabot/` branch in the same repository as the base, may retain their
non-empty generated descriptions instead of the section template above.
The scoped title requirement and all build, test, and security checks still
apply. Human-authored PRs and other bots retain the full description contract.
This exception does not authorize merging incompatible dependency updates.

## Base and diff integrity

- Start from the intended target branch and fetch its latest state before
  handoff.
- Resolve integration conflicts and rerun affected checks.
- Keep the published description synchronized with the final diff.
- Avoid unrelated merge commits, generated churn, and history rewrites after
  review begins. If history must change, tell reviewers what changed.

## Risk and verification evidence

- Verification must be proportional to risk and cover behavior at its owning
  boundary, not only a helper or selector.
- `Potential risks` must address applicable compatibility, data, concurrency,
  lifecycle, platform, rollout, and unverified-path concerns.
- Dependency, lockfile, database/schema, configuration, persistence,
  public-API, IPC, and wire changes must explain necessity, compatibility, and
  rollback or recovery.
- Destructive or difficult-to-reverse behavior requires an explicit rollback
  or recovery plan.
- User-visible UI changes need suitable screenshots or recordings, including
  relevant themes, viewport constraints, and loading/empty/error states. If
  visual evidence is not useful, explain why.
- Inspect the final diff for secrets, tokens, personal paths, private config,
  debug logs, build artifacts, caches, and unrelated formatting changes.

## Draft and review lifecycle

- Open pull requests ready for review by default. Incomplete verification,
  unverified paths, and missing visual evidence are not reasons to use Draft.
  Disclose them in `Potential risks` and `Verification` and let reviewers
  judge whether the gap blocks the change.
- Use Draft only when the author asks for it, or when the change genuinely
  must not be reviewed yet: material design choices still open, a known
  blocker, or an incomplete migration.
- Mark a Draft ready once those resolve and the description reflects the
  implementation.
- If scope or behavior changes materially after review starts, update the
  description and notify reviewers.

## Agent authorization boundary

- An explicit user request to create a pull request authorizes the normal steps
  needed to deliver that task: create an isolated branch or worktree, stage and
  commit only in-scope changes, push that branch, and create the pull request.
  Do not ask for separate confirmation at each step. Respect any narrower
  limits explicitly set by the user.
- If the previous pull request is already merged, start a new isolated branch
  or worktree from the latest intended target branch and carry over only the
  current task's changes. A merged pull request or zero committed changes ahead
  of the target is not, by itself, a reason to request authorization again.
- Preserve unrelated working-tree changes. When the task's changes can be
  clearly separated, isolate them and continue rather than asking the user to
  approve the normal isolation workflow.
- Ask for clarification when the task's scope or ownership of changes is
  ambiguous. Obtain separate explicit authorization before including unrelated
  changes, discarding user data, force-pushing, or performing other destructive
  operations. Never silently expand the task's scope.
- A request only to modify code or documentation does not authorize committing,
  pushing, or creating a pull request. A request to commit alone does not
  authorize pushing or creating a pull request. Creating a pull request does
  not authorize merging it.

## Agent handoff

Any agent that creates or updates a pull request must:

1. Read this file before mutating the pull request.
2. Bring the title, description, base, and draft state into compliance
   in the same operation.
3. Read the published pull request back from GitHub and verify the result.
4. Report exact verification evidence and anything still incomplete.

The GitHub `PR policy` workflow enforces the machine-checkable title and
description rules. Repository branch protection should require its
`Enforce PR contract` check before merge. The remaining semantic rules are
mandatory review criteria even when automation cannot prove them.
