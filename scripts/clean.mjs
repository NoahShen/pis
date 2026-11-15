import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const distDirectory = path.join(projectRoot, "dist");
const relativeDist = path.relative(projectRoot, distDirectory);

if (relativeDist !== "dist" || path.isAbsolute(relativeDist)) {
  throw new Error(`Refusing to clean unexpected path: ${distDirectory}`);
}

await rm(distDirectory, { recursive: true, force: true });
await mkdir(distDirectory, { recursive: true });
