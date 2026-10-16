import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** Source roots are explicit inputs so an unused package is audited too. */
export function sourceRoots(root) {
  const roots = existsSync(path.join(root, "src")) ? ["src"] : [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (
        !entry.isDirectory() ||
        ["node_modules", "dist", ".git"].includes(entry.name)
      )
        continue;
      const child = path.join(directory, entry.name);
      if (entry.name === "src")
        roots.push(path.relative(root, child).split(path.sep).join("/"));
      else visit(child);
    }
  }
  const packages = path.join(root, "packages");
  if (existsSync(packages)) visit(packages);
  return roots.sort();
}

export function workspacePackages(root, roots = sourceRoots(root)) {
  return roots
    .filter((source) => source.startsWith("packages/"))
    .map((source) => {
      const directory = path.posix.dirname(source);
      const manifestPath = path.join(root, directory, "package.json");
      const manifest = existsSync(manifestPath)
        ? JSON.parse(readFileSync(manifestPath, "utf8"))
        : {};
      const exports = manifest.exports;
      const entries =
        exports &&
        typeof exports === "object" &&
        !Array.isArray(exports) &&
        Object.keys(exports).some((key) => key.startsWith("."))
          ? exports
          : exports
            ? { ".": exports }
            : {};
      return { source, directory, name: manifest.name, entries };
    });
}

export function publicWorkspaceImport(pkg, specifier) {
  if (!pkg.name) return false;
  const key =
    specifier === pkg.name
      ? "."
      : specifier.startsWith(`${pkg.name}/`)
        ? `.${specifier.slice(pkg.name.length)}`
        : null;
  if (key === null) return false;
  return Object.entries(pkg.entries).some(([entry, target]) => {
    if (target === null) return false;
    const pattern = entry
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    return new RegExp(`^${pattern}$`).test(key);
  });
}

/** Map source-first exports for tools whose TS resolver ignores package exports. */
export function workspaceSourcePaths(packages) {
  const paths = {};
  function target(value) {
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object") return undefined;
    if (Array.isArray(value)) return value.map(target).find(Boolean);
    return ["types", "import", "default", "require"]
      .map((condition) => target(value[condition]))
      .find(Boolean);
  }
  for (const pkg of packages) {
    if (!pkg.name) continue;
    for (const [entry, value] of Object.entries(pkg.entries)) {
      const destination = target(value);
      if (!destination?.startsWith("./src/")) continue;
      paths[entry === "." ? pkg.name : `${pkg.name}${entry.slice(1)}`] = [
        path.posix.join(pkg.directory, destination),
      ];
    }
  }
  return paths;
}
