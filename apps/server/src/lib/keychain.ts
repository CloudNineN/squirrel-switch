import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { userInfo } from "node:os";
import { promisify } from "node:util";
import { ensureAppDataDir, fallbackMasterKeyPath } from "./paths.js";

const execFileAsync = promisify(execFile);
const service = "squirrel-switch.master-key";

async function keychainRead(): Promise<string | null> {
  return keychainReadService(service);
}

async function keychainReadService(serviceName: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("/usr/bin/security", [
      "find-generic-password",
      "-a",
      keychainAccount(),
      "-s",
      serviceName,
      "-w",
    ], { timeout: 2500 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function keychainWrite(secret: string): Promise<boolean> {
  try {
    await execFileAsync("/usr/bin/security", [
      "add-generic-password",
      "-a",
      keychainAccount(),
      "-s",
      service,
      "-w",
      secret,
      "-U",
    ], { timeout: 2500 });
    return true;
  } catch {
    return false;
  }
}

function keychainAccount(): string {
  return process.env.USER || process.env.LOGNAME || userInfo().username || "squirrel-switch";
}

async function fallbackRead(): Promise<string | null> {
  try {
    return (await readFile(fallbackMasterKeyPath, "utf8")).trim() || null;
  } catch {
    return null;
  }
}

async function fallbackWrite(secret: string): Promise<void> {
  await ensureAppDataDir();
  await writeFile(fallbackMasterKeyPath, `${secret}\n`, { mode: 0o600 });
  await chmod(fallbackMasterKeyPath, 0o600);
}

export async function isKeychainAvailable(): Promise<boolean> {
  return (await keychainRead()) !== null;
}

export async function getMasterKey(): Promise<{ key: Buffer; source: "keychain" | "file" }> {
  const fromKeychain = await keychainRead();
  if (fromKeychain) {
    return { key: Buffer.from(fromKeychain, "base64"), source: "keychain" };
  }

  const fromFile = await fallbackRead();
  if (fromFile) {
    return { key: Buffer.from(fromFile, "base64"), source: "file" };
  }

  const secret = randomBytes(32).toString("base64");
  if (await keychainWrite(secret)) {
    return { key: Buffer.from(secret, "base64"), source: "keychain" };
  }

  await fallbackWrite(secret);
  return { key: Buffer.from(secret, "base64"), source: "file" };
}
