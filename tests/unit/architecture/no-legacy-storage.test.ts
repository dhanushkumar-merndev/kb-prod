import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const sourceRoot = join(projectRoot, "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);

    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }

    return /\.(ts|tsx|css)$/.test(entry) ? [path] : [];
  });
}

describe("production architecture boundaries", () => {
  it("does not reintroduce browser persistence or embedded privileged credentials", () => {
    const violations = sourceFiles(sourceRoot).flatMap((file) => {
      const content = readFileSync(file, "utf8");
      const relativePath = relative(projectRoot, file);
      const findings: string[] = [];

      if (/\blocalStorage\b|\bindexedDB\b/.test(content)) {
        findings.push(`${relativePath}: browser persistence`);
      }

      if (/SUPABASE_SERVICE_ROLE_KEY|SUPERFONE_API_KEY/.test(content)) {
        findings.push(`${relativePath}: privileged secret name in frontend source`);
      }

      return findings;
    });

    expect(violations).toEqual([]);
  });
});
