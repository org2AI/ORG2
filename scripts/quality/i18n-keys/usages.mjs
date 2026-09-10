/**
 * Static extraction of translation-key usages from TypeScript / TSX source.
 *
 * Resolution follows the react-i18next runtime as closely as a parser can:
 *
 *   const { t } = useTranslation("sessions")            → t("k")  ⇒ sessions:k
 *   const { t } = useTranslation(["projects", "common"]) → t("k")  ⇒ projects:k, then common:k
 *   const { t } = useTranslation()                       → t("k")  ⇒ common:k (defaultNS)
 *   const { t: tX } = useTranslation("settings", { keyPrefix: "p" }) → tX("k") ⇒ settings:p.k
 *   const t = i18n.getFixedT(lng, "common")              → t("k")  ⇒ common:k
 *   t("ns:k") / t("k", { ns: "x" })                      → explicit namespace wins
 *   i18n.t("k") / i18next.t("k")                         → common:k
 *   t(`a.b.${x}`)                                        → pattern a.b.* (prefix use)
 *   t(cond ? "a" : "b"), t(a ?? b), t(["a", "b"])        → every static branch
 *   <Trans i18nKey="k" ns="x" />                          → x:k
 *
 * Bindings are scoped: a `t` is resolved through the nearest enclosing
 * function that declared it, so two components in one file with different
 * namespaces do not contaminate each other. A call outside every declaring
 * scope (a helper taking `t` as a parameter) falls back to the union of the
 * file's bindings, which is where that `t` almost always comes from.
 *
 * A `t(...)` whose binding cannot be traced at all (a `TFunction` parameter in
 * a file with no hook, a `tCommon` alias defined elsewhere) resolves *loosely*:
 * the key is searched in every namespace and under every `keyPrefix` seen in
 * the codebase, so it can never produce a false "missing" report.
 *
 * Every other string literal that looks like a dotted key path is collected
 * separately. Those literals mark keys as used (they are how `labelKey:` /
 * `i18nKey:` tables feed `t(item.labelKey)`), but never report keys missing.
 */
import ts from "typescript";

const KEY_PATH_RE = /^(?:[A-Za-z][\w-]*:)?[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/;
const KEY_PREFIX_RE =
  /^(?:[A-Za-z][\w-]*:)?[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*[._]$/;
const LOOSE_ALIAS_RE = /^(?:t[A-Z][A-Za-z0-9]*|translate)$/;
const LOOSE_BINDING = Object.freeze({ namespaces: null, keyPrefix: null });

function unwrap(node) {
  while (
    node &&
    (ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node))
  ) {
    node = node.expression;
  }
  return node;
}

/** `useMemo(() => expr, deps)` / `useCallback` → `expr`. */
function unwrapMemo(node) {
  node = unwrap(node);
  if (
    node &&
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    (node.expression.text === "useMemo" ||
      node.expression.text === "useCallback") &&
    node.arguments[0] &&
    ts.isArrowFunction(node.arguments[0]) &&
    !ts.isBlock(node.arguments[0].body)
  ) {
    return unwrap(node.arguments[0].body);
  }
  return node;
}

function isStringNode(node) {
  return (
    node &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
  );
}

function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isSourceFile(node)
  );
}

function enclosingFunction(node) {
  let current = node.parent;
  while (current && !isFunctionLike(current)) current = current.parent;
  return current;
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Turn a `t()` first argument into key candidates.
 * @returns Array<{kind:"static", key, node} | {kind:"pattern", head, tails, node} | {kind:"dynamic"}>
 */
function keyCandidates(expr) {
  expr = unwrap(expr);
  if (!expr) return [];
  const dynamic = () => [{ kind: "dynamic", expr: expr.getText() }];
  if (isStringNode(expr)) {
    return expr.text
      ? [{ kind: "static", key: expr.text, node: expr }]
      : dynamic();
  }
  if (ts.isTemplateExpression(expr)) {
    const head = expr.head.text;
    if (!head) return dynamic();
    return [
      {
        kind: "pattern",
        head,
        tails: expr.templateSpans.map((span) => span.literal.text),
        node: expr,
      },
    ];
  }
  if (ts.isConditionalExpression(expr)) {
    return [...keyCandidates(expr.whenTrue), ...keyCandidates(expr.whenFalse)];
  }
  if (
    ts.isBinaryExpression(expr) &&
    (expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      expr.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return [...keyCandidates(expr.left), ...keyCandidates(expr.right)];
  }
  if (
    ts.isBinaryExpression(expr) &&
    expr.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    // `"a.b_" + x` behaves like the template `a.b_${x}`.
    const left = unwrap(expr.left);
    if (isStringNode(left) && left.text) {
      return [{ kind: "pattern", head: left.text, tails: [""], node: left }];
    }
    return dynamic();
  }
  if (ts.isArrayLiteralExpression(expr)) {
    return expr.elements.flatMap((element) => keyCandidates(element));
  }
  return dynamic();
}

/** `"ns"` → ["ns"]; `["a","b"]` → ["a","b"]; absent → [defaultNs]; else null (unknown). */
function namespacesFromArg(arg, defaultNs) {
  arg = unwrap(arg);
  if (!arg || arg.kind === ts.SyntaxKind.UndefinedKeyword) return [defaultNs];
  if (isStringNode(arg)) return [arg.text];
  if (ts.isArrayLiteralExpression(arg)) {
    const names = arg.elements.map(unwrap);
    if (names.every(isStringNode)) return names.map((n) => n.text);
  }
  return null;
}

/** Options from `t(key, options)`; `t(key, "Default text")` is the shorthand. */
function readOptions(arg) {
  const options = {
    ns: null,
    keyPrefix: null,
    returnObjects: false,
    hasDefault: false,
    defaultValue: null,
  };
  arg = unwrap(arg);
  if (!arg) return options;
  if (isStringNode(arg)) {
    options.hasDefault = true;
    options.defaultValue = arg.text;
    return options;
  }
  if (!ts.isObjectLiteralExpression(arg)) return options;
  for (const prop of arg.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name =
      ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)
        ? prop.name.text
        : null;
    const value = unwrap(prop.initializer);
    if (name === "ns" && isStringNode(value)) options.ns = value.text;
    else if (name === "keyPrefix" && isStringNode(value))
      options.keyPrefix = value.text;
    else if (
      name === "returnObjects" &&
      value.kind === ts.SyntaxKind.TrueKeyword
    )
      options.returnObjects = true;
    else if (name === "defaultValue") {
      options.hasDefault = true;
      if (isStringNode(value)) options.defaultValue = value.text;
    }
  }
  return options;
}

function splitNamespace(key, knownNamespaces) {
  const colon = key.indexOf(":");
  if (colon > 0) {
    const ns = key.slice(0, colon);
    if (knownNamespaces.has(ns)) return { ns, key: key.slice(colon + 1) };
  }
  return { ns: null, key };
}

/**
 * Merge the bindings visible for one alias: union of namespaces per keyPrefix;
 * any untraceable binding makes the group loose.
 */
function mergeBindings(entries) {
  const byPrefix = new Map();
  for (const entry of entries) {
    const prefix = entry.keyPrefix ?? "";
    const group = byPrefix.get(prefix) ?? {
      namespaces: [],
      loose: false,
      keyPrefix: entry.keyPrefix,
    };
    if (entry.namespaces === null) group.loose = true;
    else
      for (const ns of entry.namespaces)
        if (!group.namespaces.includes(ns)) group.namespaces.push(ns);
    byPrefix.set(prefix, group);
  }
  return [...byPrefix.values()].map((group) => ({
    namespaces: group.loose ? null : group.namespaces,
    keyPrefix: group.keyPrefix,
  }));
}

/**
 * @param {string} text            file contents
 * @param {string} filePath        repo-relative path (used for reporting)
 * @param {object} options
 * @param {string} options.defaultNs        i18next `defaultNS`
 * @param {Set<string>} options.namespaces  known namespace names (for `ns:key`)
 */
export function extractUsages(
  text,
  filePath,
  { defaultNs, namespaces: knownNamespaces }
) {
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const lineOf = (node) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
    1;

  /** alias → Array<{ scope, namespaces: string[] | null, keyPrefix: string | null }> */
  const bindings = new Map();
  const addBinding = (alias, declaration, binding) => {
    if (!bindings.has(alias)) bindings.set(alias, []);
    bindings
      .get(alias)
      .push({ scope: enclosingFunction(declaration), ...binding });
    if (binding.keyPrefix) keyPrefixes.add(binding.keyPrefix);
  };
  const consumed = new Set();
  const usages = [];
  const seen = new Set();
  const literals = new Set();
  const keyPrefixes = new Set();

  // Pass 1: hook / getFixedT bindings.
  const collectBindings = (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = unwrapMemo(node.initializer);
      if (ts.isCallExpression(init)) {
        const callee = unwrap(init.expression);
        if (ts.isIdentifier(callee) && callee.text === "useTranslation") {
          const binding = {
            namespaces: namespacesFromArg(init.arguments[0], defaultNs),
            keyPrefix: readOptions(init.arguments[1]).keyPrefix,
          };
          if (ts.isObjectBindingPattern(node.name)) {
            for (const element of node.name.elements) {
              const source = element.propertyName ?? element.name;
              if (
                ts.isIdentifier(source) &&
                source.text === "t" &&
                ts.isIdentifier(element.name)
              ) {
                addBinding(element.name.text, node, binding);
              }
            }
          } else if (ts.isIdentifier(node.name)) {
            addBinding(`${node.name.text}.t`, node, binding);
          }
        } else if (
          ts.isPropertyAccessExpression(callee) &&
          callee.name.text === "getFixedT" &&
          ts.isIdentifier(node.name)
        ) {
          const nsArg = unwrap(init.arguments[1]);
          const prefixArg = unwrap(init.arguments[2]);
          const nsAbsent =
            !nsArg ||
            nsArg.kind === ts.SyntaxKind.NullKeyword ||
            nsArg.kind === ts.SyntaxKind.UndefinedKeyword;
          addBinding(node.name.text, node, {
            namespaces: isStringNode(nsArg)
              ? [nsArg.text]
              : nsAbsent
                ? [defaultNs]
                : null,
            keyPrefix: isStringNode(prefixArg) ? prefixArg.text : null,
          });
        }
      }
    }
    ts.forEachChild(node, collectBindings);
  };
  collectBindings(sourceFile);

  /** Nearest enclosing function that declared `alias`; else every declaration in the file. */
  const lookupBindings = (alias, callNode) => {
    const entries = bindings.get(alias);
    if (!entries) return null;
    for (
      let scope = enclosingFunction(callNode);
      scope;
      scope = enclosingFunction(scope)
    ) {
      const inScope = entries.filter((entry) => entry.scope === scope);
      if (inScope.length) return mergeBindings(inScope);
    }
    return mergeBindings(entries);
  };

  const push = (usage) => {
    const id = `${usage.kind}|${usage.namespaces?.join(",") ?? "*"}|${usage.key}|${usage.line}`;
    if (seen.has(id)) return;
    seen.add(id);
    usages.push(usage);
  };

  const record = (candidates, options, bindingList, node) => {
    for (const candidate of candidates) {
      if (candidate.kind === "dynamic") {
        push({
          kind: "dynamic",
          key: "",
          expr: candidate.expr,
          namespaces: null,
          file: filePath,
          line: lineOf(node),
        });
        continue;
      }
      consumed.add(candidate.node);
      for (const binding of bindingList) {
        let namespaces = options.ns ? [options.ns] : binding.namespaces;
        let key = candidate.kind === "static" ? candidate.key : candidate.head;
        const split = splitNamespace(key, knownNamespaces);
        if (split.ns) {
          namespaces = [split.ns];
          key = split.key;
        } else if (binding.keyPrefix) {
          key = `${binding.keyPrefix}.${key}`;
        }
        const base = {
          namespaces,
          hasDefault: options.hasDefault,
          defaultValue: options.defaultValue,
          file: filePath,
          line: lineOf(node),
        };
        if (candidate.kind === "static") {
          push({
            kind: "static",
            key,
            returnObjects: options.returnObjects,
            ...base,
          });
        } else if (!key) {
          // `t(`ns:${x}`)` — namespace known, key entirely dynamic.
          push({
            kind: "dynamic",
            key: "",
            expr: candidate.node.getText(),
            ...base,
          });
        } else {
          const tail = candidate.tails.map((text) => `\${*}${text}`).join("");
          const regex =
            escapeRegex(key) +
            candidate.tails.map((text) => `.+${escapeRegex(text)}`).join("");
          push({
            kind: "pattern",
            key: key + tail,
            regex: `^${regex}$`,
            ...base,
          });
        }
      }
    }
  };

  // Pass 2: t() calls and <Trans i18nKey>.
  const collectUsages = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      let bindingList = null;
      let requireDotted = false;
      if (ts.isIdentifier(callee)) {
        bindingList = lookupBindings(callee.text, node);
        if (!bindingList) {
          if (callee.text === "t") bindingList = [LOOSE_BINDING];
          else if (LOOSE_ALIAS_RE.test(callee.text)) {
            bindingList = [LOOSE_BINDING];
            requireDotted = true;
          }
        }
      } else if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === "t" &&
        ts.isIdentifier(callee.expression)
      ) {
        const owner = callee.expression.text;
        if (owner === "i18n" || owner === "i18next")
          bindingList = [{ namespaces: [defaultNs], keyPrefix: null }];
        else bindingList = lookupBindings(`${owner}.t`, node);
      }
      if (bindingList && node.arguments.length > 0) {
        let candidates = keyCandidates(node.arguments[0]);
        if (requireDotted) {
          candidates = candidates.filter(
            (c) =>
              c.kind === "dynamic" ||
              /[.:]/.test(c.kind === "static" ? c.key : c.head)
          );
        }
        record(candidates, readOptions(node.arguments[1]), bindingList, node);
      }
    } else if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      node.tagName.text === "Trans"
    ) {
      let keyNode = null;
      let ns = null;
      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr) || !ts.isIdentifier(attr.name)) continue;
        const value = attr.initializer;
        if (attr.name.text === "i18nKey" && value && isStringNode(value))
          keyNode = value;
        if (attr.name.text === "ns" && value && isStringNode(value))
          ns = value.text;
      }
      if (keyNode) {
        record(
          keyCandidates(keyNode),
          { ns, keyPrefix: null, returnObjects: false, hasDefault: false },
          [LOOSE_BINDING],
          node
        );
      }
    }
    ts.forEachChild(node, collectUsages);
  };
  collectUsages(sourceFile);

  // Pass 3: bare literals that look like key paths, and key prefixes assembled
  // outside t() — `labelKey: \`items.${id}\``, `"metricKinds." + kind` — which
  // are recorded with their trailing separator and credit every key under them.
  const collectLiterals = (node) => {
    if (!consumed.has(node)) {
      if (isStringNode(node)) {
        if (KEY_PATH_RE.test(node.text) || KEY_PREFIX_RE.test(node.text))
          literals.add(node.text);
      } else if (
        ts.isTemplateExpression(node) &&
        KEY_PREFIX_RE.test(node.head.text)
      ) {
        literals.add(node.head.text);
      }
    }
    ts.forEachChild(node, collectLiterals);
  };
  collectLiterals(sourceFile);

  return { usages, literals: [...literals], keyPrefixes: [...keyPrefixes] };
}
