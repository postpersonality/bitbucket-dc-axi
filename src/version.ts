import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Leaf module (node builtins only) so the bin fast path answers --version cheaply.
export const VERSION = readPackageVersion();

function readPackageVersion(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) {
    const path = join(directory, "package.json");
    if (existsSync(path)) {
      try {
        const value = JSON.parse(readFileSync(path, "utf8")) as { version?: unknown };
        if (typeof value.version === "string") return value.version;
      } catch {
        break;
      }
    }
    directory = dirname(directory);
  }
  return "0.0.0";
}
