import { access, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
const EXEC_TIMEOUT_MS = 3000;

export async function resolveCodexBinary(configured?: string | null): Promise<string | null> {
  const candidates = await codexBinaryCandidates(configured);
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = stripOuterQuotes(candidate);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    if (await canRun(normalized)) {
      return normalized;
    }
  }
  return null;
}

async function codexBinaryCandidates(configured?: string | null): Promise<string[]> {
  return [
    configured ?? "",
    process.env.SQUIRREL_SWITCH_CODEX_BINARY ?? "",
    ...(process.platform === "win32" ? await windowsCodexCandidates() : []),
    ...(process.platform === "darwin"
      ? ["/Applications/Codex.app/Contents/Resources/codex"]
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

function stripOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
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
