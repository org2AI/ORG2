"""Emit the Codex skin modules in `src/config/appearance/skins/` from derived Codex seeds.

Pipeline (all three steps are provenance tooling, not part of the app build):

    python3 scripts/appearance/extractCodexThemes.py   # ChatGPT.app/app.asar -> theme chunks
    python3 scripts/appearance/deriveCodexSeeds.py     # theme chunks       -> codex_seeds.json
    python3 scripts/appearance/emitCodexSkins.py       # codex_seeds.json   -> codexSkins.ts + codexSkins/*.ts

Re-run only when adopting a newer Codex build. The emitted files are checked in so
the app never depends on a local Codex install.

Each skin is written to its own module, `codexSkins/<theme id>.ts`, so every
generated file stays small however many themes Codex ships. `codexSkins.ts`
imports them and lists them in the seeds' order, which the skin pickers follow.
Modules for themes that are no longer in the seeds are deleted.
"""

import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
SEEDS = os.environ.get("CODEX_SEEDS", os.path.join(HERE, "codex_seeds.json"))
SKINS_DIR = os.path.join(REPO, "src", "config", "appearance", "skins")
TARGET = os.path.join(SKINS_DIR, "codexSkins.ts")
SKIN_MODULE_DIR = os.path.join(SKINS_DIR, "codexSkins")

# Theme ids become file names and identifiers, so keep them to lowercase kebab-case.
THEME_ID = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")

SYNTAX_ORDER = [
    "comment", "string", "keyword", "function", "variable", "number",
    "operator", "tag", "attribute", "property", "type", "constant", "invalid",
]

HEADER = '''/**
 * Codex app skins.
 *
 * Seeds are extracted from the Codex desktop app's bundled theme registry and
 * reduced with Codex's own rules: `surface` and `ink` come from the first
 * present `editor.background` / `editor.foreground` (falling back through the
 * sideBar and panel keys), `accent` from the first sufficiently chromatic
 * `activityBarBadge.background` / `textLink.foreground` /
 * `editorCursor.foreground`, and the semantic hues from the matching
 * `gitDecoration.*` and `terminal.ansi*` entries. Partner themes (Linear,
 * Notion, Vercel, Raycast, Sentry, Xcode) ship an explicit `chromeTheme` seed,
 * which overrides the derived values verbatim.
 *
 * Syntax colors are the canonical scope for each category, preferring an exact
 * TextMate scope over a longer descendant of it.
 *
 * Each skin lives in its own module under `codexSkins/`. This list keeps the
 * order of the extracted registry, which the skin pickers follow.
 *
 * DO NOT EDIT BY HAND. Regenerate with the scripts in `scripts/appearance/`.
 */
'''

SKIN_MODULE_HEADER = '''/**
 * Generated Codex skin; see `../codexSkins.ts` for provenance.
 *
 * DO NOT EDIT BY HAND. Regenerate with the scripts in `scripts/appearance/`.
 */
import type { SkinDefinition } from "../types";

'''


def q(value):
    return json.dumps(value)


def const_name(theme_id):
    return "CODEX_" + theme_id.upper().replace("-", "_") + "_SKIN"


def skin_literal(theme_id, entry):
    """The skin's object literal, opening brace at column 0, without a trailing newline."""
    out = ["{\n"]
    out.append(f"  id: {q('codex-' + theme_id)},\n")
    out.append(f"  label: {q(entry['label'])},\n")
    out.append('  source: "codex",\n')
    out.append("  variants: {\n")
    for variant in ("light", "dark"):
        seed = entry["variants"].get(variant)
        if not seed:
            continue
        out.append(f"    {variant}: {{\n")
        out.append("      seed: {\n")
        out.append(f"        surface: {q(seed['surface'])},\n")
        out.append(f"        ink: {q(seed['ink'])},\n")
        out.append(f"        accent: {q(seed['accent'])},\n")
        out.append(f"        contrast: {int(seed['contrast'])},\n")
        semantic = seed["semanticColors"]
        out.append("        semanticColors: {\n")
        for key in ("diffAdded", "diffRemoved", "skill"):
            out.append(f"          {key}: {q(semantic[key])},\n")
        out.append("        },\n")
        syntax = seed.get("syntax") or {}
        if syntax:
            out.append("        syntax: {\n")
            for key in SYNTAX_ORDER:
                if key in syntax:
                    out.append(f"          {key}: {q(syntax[key])},\n")
            out.append("        },\n")
        else:
            out.append("        syntax: {},\n")
        out.append("      },\n")
        if seed.get("sourceName"):
            out.append(f"      sourceName: {q(seed['sourceName'])},\n")
        out.append("    },\n")
    out.append("  },\n")
    out.append("}")
    return "".join(out)


def main():
    if not os.path.exists(SEEDS):
        sys.exit(f"missing seeds file: {SEEDS} (run deriveCodexSeeds.py first)")
    data = json.load(open(SEEDS, encoding="utf8"))

    for theme_id in data:
        if not THEME_ID.match(theme_id):
            sys.exit(f"theme id {theme_id!r} is not lowercase kebab-case; cannot name its module")

    os.makedirs(SKIN_MODULE_DIR, exist_ok=True)
    written = set()
    for theme_id, entry in data.items():
        module = (
            SKIN_MODULE_HEADER
            + f"export const {const_name(theme_id)}: SkinDefinition = "
            + skin_literal(theme_id, entry)
            + ";\n"
        )
        path = os.path.join(SKIN_MODULE_DIR, f"{theme_id}.ts")
        open(path, "w", encoding="utf8").write(module)
        written.add(f"{theme_id}.ts")

    for name in sorted(os.listdir(SKIN_MODULE_DIR)):
        if name.endswith(".ts") and name not in written:
            os.remove(os.path.join(SKIN_MODULE_DIR, name))
            print(f"removed stale {os.path.join(SKIN_MODULE_DIR, name)}")

    # Prettier's import sorting orders relative imports by path.
    imports = {'"./types"': 'import type { SkinDefinition } from "./types";\n'}
    for theme_id in data:
        imports[f'"./codexSkins/{theme_id}"'] = (
            f'import {{ {const_name(theme_id)} }} from "./codexSkins/{theme_id}";\n'
        )
    out = [HEADER]
    out.extend(imports[path] for path in sorted(imports))
    out.append("\nexport const CODEX_SKINS: readonly SkinDefinition[] = [\n")
    out.extend(f"  {const_name(theme_id)},\n" for theme_id in data)
    out.append("];\n")
    open(TARGET, "w", encoding="utf8").write("".join(out))

    variants = sum(len(e["variants"]) for e in data.values())
    print(f"wrote {TARGET} and {len(data)} modules in {SKIN_MODULE_DIR}: {len(data)} skins, {variants} variants")


if __name__ == "__main__":
    main()
