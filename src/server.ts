import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { main } from "./lifecycle.js";

export { main } from "./lifecycle.js";

export function isDirectEntry(
  argvEntry: string | undefined,
  pm2Entry: string | undefined,
): boolean {
  const modulePath = fileURLToPath(new URL(import.meta.url));
  return (
    (argvEntry !== undefined && resolve(argvEntry) === modulePath) ||
    (pm2Entry !== undefined && resolve(pm2Entry) === modulePath)
  );
}

if (isDirectEntry(process.argv[1], process.env.pm_exec_path)) {
  void main();
}
