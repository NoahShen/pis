import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const SOURCE_ASSET = "src/database/schema.sql";
const DESTINATION_ASSET = "dist/database/schema.sql";

function resolveProjectPath(relativePath) {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Database asset path must be relative: ${relativePath}`);
  }

  const absolutePath = path.resolve(projectRoot, relativePath);
  const resolvedRelativePath = path.relative(projectRoot, absolutePath);
  if (
    resolvedRelativePath === "" ||
    resolvedRelativePath === ".." ||
    resolvedRelativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(resolvedRelativePath)
  ) {
    throw new Error(
      `Database asset path escapes the project root: ${relativePath}`,
    );
  }

  return absolutePath;
}

const sourcePath = resolveProjectPath(SOURCE_ASSET);
const destinationPath = resolveProjectPath(DESTINATION_ASSET);
const schemaBytes = await readFile(sourcePath);

await mkdir(path.dirname(destinationPath), { recursive: true });
await writeFile(destinationPath, schemaBytes);

console.log(
  `Copied database schema asset: ${SOURCE_ASSET} -> ${DESTINATION_ASSET}`,
);
