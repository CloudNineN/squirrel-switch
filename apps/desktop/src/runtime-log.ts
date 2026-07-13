import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const appDataDir = join(homedir(), ".squirrel-switch");
const runtimeLogPath = join(appDataDir, "runtime.log");
const maxRuntimeLogEntries = 2000;
const maxRuntimeLogAgeSeconds = 30 * 24 * 60 * 60;

interface RuntimeLogEntry {
  id: string;
  time: number;
  level: "info" | "warn" | "error";
  scope: string;
  message: string;
}

export async function writeDesktopRuntimeLog(
  level: RuntimeLogEntry["level"],
  scope: string,
  message: string,
): Promise<void> {
  const entry: RuntimeLogEntry = {
    id: randomUUID(),
    time: Math.floor(Date.now() / 1000),
    level,
    scope,
    message: redactSensitiveText(message),
  };
  await mkdir(appDataDir, { recursive: true, mode: 0o700 }).catch(() => undefined);
  await appendFile(runtimeLogPath, `${JSON.stringify(entry)}\n`, "utf8").catch(() => undefined);
  await pruneRuntimeLog().catch(() => undefined);
}

async function pruneRuntimeLog(): Promise<void> {
  const entries = await readRuntimeLogEntries();
  const minTime = Math.floor(Date.now() / 1000) - maxRuntimeLogAgeSeconds;
  const keptEntries = entries
    .filter((entry) => entry.time >= minTime)
    .slice(-maxRuntimeLogEntries);
  await writeFile(runtimeLogPath, keptEntries.map((entry) => JSON.stringify(entry)).join("\n") + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function readRuntimeLogEntries(): Promise<RuntimeLogEntry[]> {
  const text = await readFile(runtimeLogPath, "utf8").catch(() => "");
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }
  return trimmed
    .split("\n")
    .filter(Boolean)
    .map((line) => parseRuntimeLogLine(line))
    .filter((entry): entry is RuntimeLogEntry => entry !== null);
}

function parseRuntimeLogLine(line: string): RuntimeLogEntry | null {
  try {
    const value = JSON.parse(line) as Partial<RuntimeLogEntry>;
    if (
      typeof value.id !== "string" ||
      typeof value.time !== "number" ||
      (value.level !== "info" && value.level !== "warn" && value.level !== "error") ||
      typeof value.scope !== "string" ||
      typeof value.message !== "string"
    ) {
      return null;
    }
    return {
      id: value.id,
      time: value.time,
      level: value.level,
      scope: value.scope,
      message: value.message,
    };
  } catch {
    return null;
  }
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/(access_token|refresh_token|id_token|OPENAI_ACCESS_TOKEN)=?[^,\s]+/gi, "$1=[redacted]")
    .replace(/(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|api_key)=?[^,\s]+/gi, "$1=[redacted]")
    .replace(/(password|oauth_password|client_secret|clientSecret)=?[^,\s]+/gi, "$1=[redacted]")
    .replace(/("(?:password|oauthPassword|oauth_password|clientSecret|client_secret)"\s*:\s*)"[^"]*"/gi, "$1\"[redacted]\"")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]");
}
