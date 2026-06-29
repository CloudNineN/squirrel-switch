import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";

export const appDataDir = join(homedir(), ".squirrel-switch");
export const databasePath = join(appDataDir, "squirrel-switch.sqlite");
export const fallbackMasterKeyPath = join(appDataDir, "master-key");
export const loginSessionsDir = join(appDataDir, "login-sessions");
export const browserProfilesDir = join(appDataDir, "browser-profiles");
export const appBinDir = join(appDataDir, "bin");
export const legacyAppDataDir = join(homedir(), ".codex-switch");
export const legacyDatabasePath = join(legacyAppDataDir, "codex-switch.sqlite");
export const legacyFallbackMasterKeyPath = join(legacyAppDataDir, "master-key");

const legacyFileMigrations = [
  [legacyDatabasePath, databasePath, 0o600],
  [`${legacyDatabasePath}-wal`, `${databasePath}-wal`, 0o600],
  [`${legacyDatabasePath}-shm`, `${databasePath}-shm`, 0o600],
  [legacyFallbackMasterKeyPath, fallbackMasterKeyPath, 0o600],
  [join(legacyAppDataDir, "runtime.log"), join(appDataDir, "runtime.log"), 0o600],
] as const;

export function defaultCodexHome(): string {
  return process.env.CODEX_HOME || join(homedir(), ".codex");
}

export function authJsonPath(codexHome = defaultCodexHome()): string {
  return join(codexHome, "auth.json");
}

export function claudeUserSettingsPath(): string {
  return join(homedir(), ".claude", "settings.json");
}

export function claudeProjectSettingsPath(
  projectPath: string,
  target: "project-local-settings" | "project-shared-settings",
): string {
  return join(projectPath, ".claude", target === "project-local-settings" ? "settings.local.json" : "settings.json");
}

export async function ensureParentDir(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

export function ensureAppDataDirSync(): void {
  mkdirSync(appDataDir, { recursive: true, mode: 0o700 });
  chmodSync(appDataDir, 0o700);

  for (const [from, to, mode] of legacyFileMigrations) {
    if (!existsSync(from) || existsSync(to)) {
      continue;
    }
    copyFileSync(from, to);
    chmodSync(to, mode);
  }
}

export async function ensureAppDataDir(): Promise<void> {
  ensureAppDataDirSync();
  await mkdir(appDataDir, { recursive: true, mode: 0o700 });
}
