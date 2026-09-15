import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Wire compatibility only; not evidence of signing or end-to-end acceptance. */
export function protocolMarker({ release, commit, tagCommit, features }) {
  if (!/^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(release))
    throw new Error("Expected a versioned release tag");
  if (!/^[a-f0-9]{40}$/.test(commit) || tagCommit !== commit)
    throw new Error("Release tag must resolve to the built checkout commit");
  if (
    !features?.default?.includes("market-connect") ||
    !features?.["market-connect"]?.includes("dep:market-connect")
  )
    throw new Error("Default desktop build does not include Market protocol");
  return { release, protocol: 1, sellerProtocol: 1, commit,
    capabilities: {
      macos: { buyerPersistentCredentials: true, sellerTemporaryAuthorization: true },
      windows: { buyerPersistentCredentials: true, sellerTemporaryAuthorization: true },
      linux: { buyerPersistentCredentials: false, sellerTemporaryAuthorization: true },
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [release, output] = process.argv.slice(2);
  if (!release || !output)
    throw new Error("Usage: node protocol.mjs <tag> <output.json>");
  const git = (...args) =>
    execFileSync("git", args, { encoding: "utf8" }).trim();
  // Verify tag syntax before passing it as a git revision.
  if (!/^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(release))
    throw new Error("Expected a versioned release tag");
  const metadata = JSON.parse(
    execFileSync(
      "cargo",
      [
        "metadata",
        "--no-deps",
        "--format-version",
        "1",
        "--manifest-path",
        "src-tauri/Cargo.toml",
      ],
      { encoding: "utf8" }
    )
  );
  const root = metadata.packages.find(
    (p) => resolve(p.manifest_path) === resolve("src-tauri/Cargo.toml")
  );
  const marker = protocolMarker({
    release,
    commit: git("rev-parse", "HEAD"),
    tagCommit: git("rev-parse", `refs/tags/${release}^{commit}`),
    features: root?.features,
  });
  writeFileSync(output, `${JSON.stringify(marker, null, 2)}\n`, { flag: "wx" });
}
