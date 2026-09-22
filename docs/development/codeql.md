# CodeQL language selection

The repository previously used GitHub's managed default setup, configured for
Actions, JavaScript/TypeScript, Python, and Rust. That generated workflow selected
all configured languages rather than selecting them from each PR's diff. The
Rust scope in `ci.yml` controls clippy/tests only; it cannot gate managed CodeQL.

`.github/workflows/codeql.yml` replaces default setup with advanced setup:

- PRs against any branch select languages using the merge-base-to-head diff.
  The selected language is analyzed across the repository, not just changed files.
- Rust source, Cargo manifests/locks, and Cargo/toolchain configuration select Rust.
- JS/TS source, templates, extraction data formats, and dependency configuration
  select JavaScript/TypeScript. YAML can also affect the JS extractor, so workflow
  YAML selects both Actions and JS/TS; it does not select Rust.
- Python source and dependency configuration select Python. Workflow and action
  definitions select Actions.
- Markdown/CSS-only PRs skip analysis. Deletions and both sides of renames count.
- Scanner-policy changes, empty diffs, and failed diff discovery scan all languages.
- Pushes to `develop` (the current default and only protected branch), weekly runs,
  and manual runs scan all four languages to maintain complete baselines and pick
  up query updates. Add future protected branches to the push trigger.

The default query suite and remote threat model are retained. All four languages
use build mode `none`; Rust extraction uses the hosted runner's Cargo/rustup.
The workflow does not build the Tauri app or install app dependencies.

## Activation and recovery

GitHub default setup must be disabled before advanced results can be uploaded.
Keep default setup enabled while this change is under review. Once the workflow
is merged into `develop`, switch CodeQL from default to advanced setup in repository
Settings → Advanced Security, then manually dispatch the CodeQL workflow. Verify
all four analyses upload successfully and inspect code-scanning tool status for
obsolete default-setup configurations. An initial pre-switch upload may fail;
rerun after switching.

Check any CodeQL merge rules against a source-only and documentation-only PR:
language jobs are intentionally absent when their inputs are unchanged. Do not
require every individual language job on every PR. This selection has local
regression coverage, but hosted uploads and merge-rule behavior require rollout
verification on GitHub.

To roll back, disable the advanced workflow and re-enable default setup with the
same four languages and default query suite. This restores unconditional scans
without changing application data.

See [GitHub advanced setup documentation](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/configure-code-scanning/configuring-advanced-setup-for-code-scanning).
