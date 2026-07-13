import { app } from "electron";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
} from "node:crypto";
import {
  clearChatGptBrowserProfile,
  defaultBrowserProfileDir,
  exportChatGptBrowserSession,
  importChatGptBrowserSession,
} from "./chatgpt-browser.js";
import {
  clearChatGptBrowserTaskNotice,
  showChatGptBrowserTaskNotice,
} from "./chatgpt-browser-task-notice.js";
import { writeDesktopRuntimeLog } from "./runtime-log.js";
import type {
  ChatGptBrowserKind,
  ChatGptDesktopProfile,
  ChatGptOriginStorageSnapshot,
  ChatGptPortableCookie,
} from "./chatgpt-browser.js";

export type { ChatGptDesktopProfile } from "./chatgpt-browser.js";

interface ChatGptExportRequest {
  profiles: ChatGptDesktopProfile[];
  password: string;
}

interface ChatGptImportRequest {
  backupText: string;
  password: string;
}

interface ChatGptBackupFile {
  format: "squirrel-switch-chatgpt-backup";
  schemaVersion: 1 | 2;
  createdAt: string;
  appVersion: string;
  kdf: {
    name: "scrypt";
    salt: string;
    N: number;
    r: number;
    p: number;
  };
  cipher: {
    name: "aes-256-gcm";
    iv: string;
    tag: string;
    ciphertext: string;
  };
}

interface ChatGptBackupPayload {
  profiles: ChatGptBackupPayloadProfile[];
}

interface ChatGptBackupPayloadProfile {
  displayName: string;
  accountEmailHint: string | null;
  planLabelHint: string | null;
  linkedCodexEmailHint: string | null;
  cookies: BackupCookie[];
  originStorage: OriginStorageSnapshot[];
  exportedAt: string;
}

type BackupCookie = ChatGptPortableCookie;

type OriginStorageSnapshot = ChatGptOriginStorageSnapshot;

interface ImportedChatGptProfile {
  id: string;
  displayName: string;
  browserKind: ChatGptBrowserKind | null;
  browserExecutablePath: string | null;
  browserProfileDir: string | null;
  sessionHash: string | null;
  linkedCodexEmailHint: string | null;
  accountEmailHint: string | null;
  planLabelHint: string | null;
}

export async function exportChatGptBackup(request: ChatGptExportRequest) {
  if (request.profiles.length === 0) {
    throw new Error("请选择要导出的 ChatGPT 会话");
  }
  const exportedAt = new Date().toISOString();
  const payloadProfiles: ChatGptBackupPayloadProfile[] = [];
  const summaries: Array<{
    id: string;
    displayName: string;
    sessionHash: string | null;
    cookieCount: number;
    originStorageCount: number;
  }> = [];

  for (const profile of request.profiles) {
    await showChatGptBrowserTaskNotice(profile, {
      message: "Squirrel Switch 正在导出 ChatGPT 备份，请暂时不要关闭此窗口",
      blocking: true,
    });
    try {
      const snapshot = await exportChatGptBrowserSession(profile);
      const cookies = snapshot.cookies;
      const originStorage = snapshot.originStorage;
      const payloadProfile: ChatGptBackupPayloadProfile = {
        displayName: profile.displayName,
        accountEmailHint: profile.accountEmail,
        planLabelHint: profile.planLabel,
        linkedCodexEmailHint: profile.linkedCodexEmail,
        cookies,
        originStorage,
        exportedAt,
      };
      payloadProfiles.push(payloadProfile);
      summaries.push({
        id: profile.id,
        displayName: profile.displayName,
        sessionHash: hashBackupProfile(payloadProfile),
        cookieCount: cookies.length,
        originStorageCount: originStorage.length,
      });
    } finally {
      await clearChatGptBrowserTaskNotice(profile);
    }
  }

  return {
    backup: await encryptBackupPayload({ profiles: payloadProfiles }, request.password),
    exported: summaries,
  };
}

export async function importChatGptBackup(request: ChatGptImportRequest) {
  const payload = await decryptBackupPayload(request.backupText, request.password);
  const profiles: ImportedChatGptProfile[] = [];
  let failed = 0;
  let partialFailed = 0;
  await writeDesktopRuntimeLog("info", "chatgpt", `开始导入 ChatGPT 备份：${payload.profiles.length} 个会话`);
  for (const [index, profile] of payload.profiles.entries()) {
    const profileId = randomUUID();
    const browserProfileDir = defaultBrowserProfileDir(profileId);
    const importedProfile: ChatGptDesktopProfile = {
      id: profileId,
      displayName: profile.displayName,
      linkedCodexEmail: profile.linkedCodexEmailHint,
      accountEmail: profile.accountEmailHint,
      accountId: null,
      planLabel: profile.planLabelHint,
      browserKind: null,
      browserExecutablePath: null,
      browserProfileDir,
    };
    const importLabel = `${index + 1}/${payload.profiles.length}`;
    await showChatGptBrowserTaskNotice(importedProfile, {
      message: `Squirrel Switch 正在导入 ChatGPT 备份会话 ${importLabel}，请暂时不要关闭此窗口`,
      blocking: true,
    });
    try {
      await writeDesktopRuntimeLog("info", "chatgpt", `写入 ChatGPT 备份会话 ${importLabel}`);
      const { failedOriginStorage } = await importChatGptBrowserSession(importedProfile, {
        cookies: profile.cookies,
        originStorage: profile.originStorage,
      });
      if (failedOriginStorage > 0) {
        partialFailed += 1;
      }
      profiles.push({
        id: profileId,
        displayName: profile.displayName,
        browserKind: null,
        browserExecutablePath: null,
        browserProfileDir,
        sessionHash: hashBackupProfile(profile),
        linkedCodexEmailHint: profile.linkedCodexEmailHint,
        accountEmailHint: profile.accountEmailHint,
        planLabelHint: profile.planLabelHint,
      });
      await writeDesktopRuntimeLog(
        failedOriginStorage > 0 ? "warn" : "info",
        "chatgpt",
        failedOriginStorage > 0
          ? `ChatGPT 备份会话 ${importLabel} 已写入，部分 localStorage 来源恢复失败`
          : `ChatGPT 备份会话 ${importLabel} 已写入`,
      );
    } catch (error) {
      failed += 1;
      await clearChatGptBrowserProfile(importedProfile).catch(() => undefined);
      await writeDesktopRuntimeLog(
        "error",
        "chatgpt",
        `ChatGPT 备份会话 ${importLabel} 写入失败：${errorMessage(error)}`,
      );
    } finally {
      await clearChatGptBrowserTaskNotice(importedProfile);
    }
  }
  if (profiles.length === 0 && failed > 0) {
    throw new Error("ChatGPT 备份中的会话都未能写入");
  }
  await writeDesktopRuntimeLog(
    failed > 0 || partialFailed > 0 ? "warn" : "info",
    "chatgpt",
    `ChatGPT 备份导入完成：成功 ${profiles.length} 个，失败 ${failed} 个，不完整 ${partialFailed} 个`,
  );
  return { profiles, failed, partialFailed };
}

export function parseExportBackupRequest(value: unknown): ChatGptExportRequest | null {
  if (!isRecord(value) || !Array.isArray(value.profiles) || typeof value.password !== "string") {
    return null;
  }
  const profiles = value.profiles.map(parseChatGptDesktopProfile);
  if (profiles.some((profile) => profile === null)) {
    return null;
  }
  return { profiles: profiles as ChatGptDesktopProfile[], password: value.password };
}

export function parseImportBackupRequest(value: unknown): ChatGptImportRequest | null {
  if (!isRecord(value) || typeof value.backupText !== "string" || typeof value.password !== "string") {
    return null;
  }
  return { backupText: value.backupText, password: value.password };
}

async function encryptBackupPayload(
  payload: ChatGptBackupPayload,
  password: string,
): Promise<ChatGptBackupFile> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const kdf = { name: "scrypt" as const, salt: salt.toString("base64"), N: 32768, r: 8, p: 1 };
  const key = await deriveBackupKey(password, kdf);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(stableJson(payload), "utf8"),
    cipher.final(),
  ]);
  return {
    format: "squirrel-switch-chatgpt-backup",
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    kdf,
    cipher: {
      name: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: encrypted.toString("base64"),
    },
  };
}

async function decryptBackupPayload(
  backupText: string,
  password: string,
): Promise<ChatGptBackupPayload> {
  const backup = parseBackupFile(JSON.parse(backupText) as unknown);
  const key = await deriveBackupKey(password, backup.kdf);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(backup.cipher.iv, "base64"));
  decipher.setAuthTag(Buffer.from(backup.cipher.tag, "base64"));
  const plainText = Buffer.concat([
    decipher.update(Buffer.from(backup.cipher.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return parseBackupPayload(JSON.parse(plainText) as unknown);
}

async function deriveBackupKey(password: string, kdf: ChatGptBackupFile["kdf"]): Promise<Buffer> {
  if (!password) {
    throw new Error("备份密码不能为空");
  }
  return new Promise((resolveKey, rejectKey) => {
    const derive = scrypt as unknown as (
      password: string,
      salt: Buffer,
      keylen: number,
      options: { N: number; r: number; p: number; maxmem: number },
      callback: (error: Error | null, key: Buffer) => void,
    ) => void;
    derive(password, Buffer.from(kdf.salt, "base64"), 32, {
      N: kdf.N,
      r: kdf.r,
      p: kdf.p,
      maxmem: 128 * 1024 * 1024,
    }, (error, key) => {
      if (error) {
        rejectKey(error);
        return;
      }
      resolveKey(key);
    });
  });
}

function hashBackupProfile(profile: ChatGptBackupPayloadProfile): string {
  return createHash("sha256")
    .update(stableJson({ cookies: profile.cookies, originStorage: profile.originStorage }))
    .digest("hex");
}

function parseChatGptDesktopProfile(value: unknown): ChatGptDesktopProfile | null {
  if (!isRecord(value)) {
    return null;
  }
  const {
    id,
    displayName,
    linkedCodexEmail,
    accountEmail,
    accountId,
    planLabel,
    browserKind,
    browserExecutablePath,
    browserProfileDir,
  } = value;
  if (
    typeof id !== "string" ||
    typeof displayName !== "string" ||
    !(typeof linkedCodexEmail === "string" || linkedCodexEmail === null) ||
    !(typeof accountEmail === "string" || accountEmail === null) ||
    !(typeof accountId === "string" || accountId === null) ||
    !(typeof planLabel === "string" || planLabel === null) ||
    !(isBrowserKind(browserKind) || browserKind === null) ||
    !(typeof browserExecutablePath === "string" || browserExecutablePath === null) ||
    !(typeof browserProfileDir === "string" || browserProfileDir === null)
  ) {
    return null;
  }
  return {
    id,
    displayName,
    linkedCodexEmail,
    accountEmail,
    accountId,
    planLabel,
    browserKind,
    browserExecutablePath,
    browserProfileDir,
  };
}

function parseBackupFile(value: unknown): ChatGptBackupFile {
  if (
    !isRecord(value) ||
    value.format !== "squirrel-switch-chatgpt-backup" ||
    (value.schemaVersion !== 1 && value.schemaVersion !== 2)
  ) {
    throw new Error("不支持的 ChatGPT 备份文件");
  }
  if (!isRecord(value.kdf) || value.kdf.name !== "scrypt") {
    throw new Error("不支持的 ChatGPT 备份 KDF");
  }
  if (!isRecord(value.cipher) || value.cipher.name !== "aes-256-gcm") {
    throw new Error("不支持的 ChatGPT 备份加密算法");
  }
  const kdf = value.kdf;
  const cipher = value.cipher;
  if (
    typeof value.createdAt !== "string" ||
    typeof value.appVersion !== "string" ||
    typeof kdf.salt !== "string" ||
    typeof kdf.N !== "number" ||
    typeof kdf.r !== "number" ||
    typeof kdf.p !== "number" ||
    typeof cipher.iv !== "string" ||
    typeof cipher.tag !== "string" ||
    typeof cipher.ciphertext !== "string"
  ) {
    throw new Error("ChatGPT 备份文件结构不正确");
  }
  return {
    format: "squirrel-switch-chatgpt-backup",
    schemaVersion: value.schemaVersion,
    createdAt: value.createdAt,
    appVersion: value.appVersion,
    kdf: {
      name: "scrypt",
      salt: kdf.salt,
      N: kdf.N,
      r: kdf.r,
      p: kdf.p,
    },
    cipher: {
      name: "aes-256-gcm",
      iv: cipher.iv,
      tag: cipher.tag,
      ciphertext: cipher.ciphertext,
    },
  };
}

function parseBackupPayload(value: unknown): ChatGptBackupPayload {
  if (!isRecord(value) || !Array.isArray(value.profiles)) {
    throw new Error("ChatGPT 备份 payload 不正确");
  }
  return {
    profiles: value.profiles.map(parseBackupPayloadProfile),
  };
}

function parseBackupPayloadProfile(value: unknown): ChatGptBackupPayloadProfile {
  if (!isRecord(value) || typeof value.displayName !== "string" || !Array.isArray(value.cookies)) {
    throw new Error("ChatGPT 备份 profile 不正确");
  }
  return {
    displayName: value.displayName,
    accountEmailHint:
      typeof value.accountEmailHint === "string" ? value.accountEmailHint : null,
    planLabelHint: typeof value.planLabelHint === "string" ? value.planLabelHint : null,
    linkedCodexEmailHint:
      typeof value.linkedCodexEmailHint === "string" ? value.linkedCodexEmailHint : null,
    cookies: value.cookies.map(parseBackupCookie),
    originStorage: Array.isArray(value.originStorage)
      ? value.originStorage
          .map((item) => parseOriginStorageSnapshot(item))
          .filter((item): item is OriginStorageSnapshot => item !== null)
      : [],
    exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : new Date().toISOString(),
  };
}

function parseBackupCookie(value: unknown): BackupCookie {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.value !== "string" ||
    typeof value.domain !== "string" ||
    typeof value.path !== "string" ||
    typeof value.secure !== "boolean" ||
    typeof value.httpOnly !== "boolean"
  ) {
    throw new Error("ChatGPT 备份 cookie 不正确");
  }
  return {
    name: value.name,
    value: value.value,
    domain: value.domain,
    path: value.path,
    secure: value.secure,
    httpOnly: value.httpOnly,
    ...(typeof value.expirationDate === "number" ? { expirationDate: value.expirationDate } : {}),
    ...(typeof value.sameSite === "string" ? { sameSite: value.sameSite } : {}),
  };
}

function parseOriginStorageSnapshot(value: unknown): OriginStorageSnapshot | null {
  if (!isRecord(value) || typeof value.origin !== "string" || !isAllowedChatGptOrigin(value.origin)) {
    return null;
  }
  return {
    origin: value.origin,
    localStorage: parseStringRecord(value.localStorage),
  };
}

function parseStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.entries(value).reduce<Record<string, string>>((record, [key, item]) => {
    if (typeof item === "string") {
      record[key] = item;
    }
    return record;
  }, {});
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, sortKeys);
}

function sortKeys(_key: string, value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = (value as Record<string, unknown>)[key];
      return result;
    }, {});
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBrowserKind(value: unknown): value is ChatGptBrowserKind {
  return value === "chrome" || value === "edge" || value === "custom";
}

function isAllowedChatGptOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    return parsed.origin === origin && isTrustedLoginHost(parsed);
  } catch {
    return false;
  }
}

function isTrustedLoginHost(url: URL): boolean {
  if (url.protocol !== "https:") {
    return false;
  }
  const host = url.hostname;
  return (
    host === "chatgpt.com" ||
    host === "auth.openai.com" ||
    host.endsWith(".chatgpt.com") ||
    host.endsWith(".openai.com")
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
