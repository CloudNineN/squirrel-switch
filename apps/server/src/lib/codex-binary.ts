import { access, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
const EXEC_TIMEOUT_MS = 3000;

export const CODEX_BINARY_NOT_FOUND_MESSAGE =
  "未找到 codex 命令或 ChatGPT/Codex.app 内置 codex";

export async function resolveCodexBinary(): Promise<string | null> {
  const candidates = await codexBinaryCandidates();
  for (const candidate of candidates) {
    if (await canRun(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function codexBinaryCandidates(): Promise<string[]> {
  return [
    ...(process.platform === "win32" ? await windowsCodexCandidates() : []),
    ...(process.platform === "darwin"
      ? ["/Applications/ChatGPT.app/Contents/Resources/codex"]
      : []),
    "codex",
    ...(process.platform === "win32" ? ["codex.exe"] : []),
  ];
}

async function windowsCodexCandidates(): Promise<string[]> {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    return [];
  }

  const codexBinRoot = join(localAppData, "OpenAI", "Codex", "bin");
  try {
    const entries = await readdir(codexBinRoot, { withFileTypes: true });
    const directories = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const path = join(codexBinRoot, entry.name);
          return { path, mtimeMs: (await stat(path)).mtimeMs };
        }),
    );
    return directories
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .map((entry) => join(entry.path, "codex.exe"));
  } catch {
    return [];
  }
}

async function canRun(path: string): Promise<boolean> {
  try {
    if (path.includes("/") || path.includes("\\")) {
      await access(path, constants.X_OK);
    }
    await execFileAsync(path, ["--version"], { timeout: EXEC_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}
