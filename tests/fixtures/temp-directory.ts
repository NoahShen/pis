import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export async function withTempDirectory<T>(
  callback: (directory: string) => T | Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(path.join(tmpdir(), "pis-test-"));

  try {
    return await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
