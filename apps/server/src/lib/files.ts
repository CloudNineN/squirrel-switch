import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { ensureParentDir } from "./paths.js";

export async function readTextFile(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function writeAuthJsonAtomic(path: string, contents: string): Promise<void> {
  await ensureParentDir(path);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, contents, { mode: 0o600 });
  await chmod(tempPath, 0o600);
  await rename(tempPath, path);
  await chmod(path, 0o600);
}

export async function writeTextFileAtomic(path: string, contents: string): Promise<void> {
  await writeAuthJsonAtomic(path, contents);
}
