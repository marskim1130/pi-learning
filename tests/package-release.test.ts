import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface PackageManifest {
  private?: boolean;
  main?: string;
  dependencies?: Record<string, string>;
  keywords?: string[];
  pi?: {
    extensions?: string[];
  };
}

interface PackResult {
  files: Array<{ path: string }>;
}

const projectRoot = resolve(import.meta.dirname, "..");

describe("published Pi package", () => {
  it("does not expose a missing JS entry or depend on the private web workspace", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(projectRoot, "package.json"), "utf8")
    ) as PackageManifest;

    expect.soft(manifest.main).toBeUndefined();
    expect.soft(manifest.dependencies?.["pi-learning-web"]).toBeUndefined();
    expect.soft(Object.keys(manifest.dependencies ?? {})).toEqual([]);
  });

  it("is discoverable by Pi and contains the extension plus built workspace", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(projectRoot, "package.json"), "utf8")
    ) as PackageManifest;

    execSync("npm run prepack", {
      cwd: projectRoot,
      stdio: "pipe"
    });
    const packOutput = execSync("npm pack --dry-run --json --ignore-scripts", {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 5 * 1024 * 1024
    });
    const [packResult] = JSON.parse(packOutput) as PackResult[];
    const archivedPaths = packResult?.files.map((file) => file.path) ?? [];

    expect.soft(manifest.private).not.toBe(true);
    expect.soft(manifest.keywords).toContain("pi-package");
    expect.soft(manifest.pi?.extensions).toContain("./extension/index.ts");
    expect.soft(archivedPaths).toContain("extension/index.ts");
    expect.soft(archivedPaths).toContain("web/dist/index.html");
  }, 30_000);
});
