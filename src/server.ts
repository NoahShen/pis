import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { main } from "./lifecycle.js";

export { main } from "./lifecycle.js";

function isDirectEntry(argvEntry: string | undefined): boolean {
  return (
    argvEntry !== undefined &&
    resolve(argvEntry) === fileURLToPath(new URL(import.meta.url))
  );
}

if (isDirectEntry(process.argv[1])) {
  void main();
}
