import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const configurationPrefix = "smoke-configuration-";

export async function runConfigurationSmoke() {
  const entries = await readdir(scriptDirectory, { withFileTypes: true });
  const scripts = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith(configurationPrefix) &&
        entry.name.endsWith(".mjs"),
    )
    .map((entry) => entry.name)
    .sort();

  if (scripts.length === 0) {
    throw new Error("No configuration smoke scripts were discovered");
  }

  for (const script of scripts) {
    const moduleUrl = pathToFileURL(path.join(scriptDirectory, script)).href;
    const smoke = await import(moduleUrl);
    if (typeof smoke.default !== "function") {
      throw new Error(`${script} does not have a default smoke function`);
    }

    await smoke.default();
  }
}
