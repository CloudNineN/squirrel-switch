import { appendFile, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { appDataDir, ensureAppDataDir } from "./paths.js";
import { nowSeconds } from "./time.js";

export const runtimeLogPath = `${appDataDir}/runtime.log`;

export interface RuntimeLogEntry {
  id: string;
  time: number;
  level: "info" | "warn" | "error";
  scope: string;
  message: string;
}

export interface RuntimeLogPage {
  logs: RuntimeLogEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export async function writeRuntimeLog(
  level: RuntimeLogEntry["level"],
  scope: string,
  message: string,
): Promise<void> {
  await ensureAppDataDir();
  const entry: RuntimeLogEntry = {
    id: randomUUID(),
    time: nowSeconds(),
    level,
    scope,
    message: redactSensitiveText(message),
  };
  await appendFile(runtimeLogPath, `${JSON.stringify(entry)}\n`, "utf8").catch(() => undefined);
}

export async function readRuntimeLogs(limit = 300): Promise<RuntimeLogEntry[]> {
  const logs = await readAllRuntimeLogs();
  return logs.slice(0, Math.max(1, Math.min(limit, 1000)));
}

export async function readRuntimeLogPage(page = 1, pageSize = 50): Promise<RuntimeLogPage> {
  const logs = await readAllRuntimeLogs();
  const normalizedPageSize = Math.max(10, Math.min(pageSize, 100));
  const totalPages = Math.max(1, Math.ceil(logs.length / normalizedPageSize));
  const normalizedPage = Math.max(1, Math.min(page, totalPages));
  const start = (normalizedPage - 1) * normalizedPageSize;
  return {
    logs: logs.slice(start, start + normalizedPageSize),
    page: normalizedPage,
    pageSize: normalizedPageSize,
    total: logs.length,
    totalPages,
  };
}

async function readAllRuntimeLogs(): Promise<RuntimeLogEntry[]> {
  const text = await readFile(runtimeLogPath, "utf8").catch(() => "");
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  return trimmed
    .split("\n")
    .filter(Boolean)
    .map((line) => parseRuntimeLogLine(line))
    .filter((entry): entry is RuntimeLogEntry => entry !== null)
    .reverse();
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
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]");
}
