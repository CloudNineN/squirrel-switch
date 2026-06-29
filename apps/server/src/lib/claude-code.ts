import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db } from "./db.js";
import { decryptText, encryptText, sha256Text, stableJson } from "./crypto.js";
import { AppError, getErrorMessage } from "./errors.js";
import { readTextFile, writeTextFileAtomic } from "./files.js";
import {
  appBinDir,
  claudeProjectSettingsPath,
  claudeUserSettingsPath,
} from "./paths.js";
import { nowSeconds } from "./time.js";
import { writeRuntimeLog } from "./runtime-log.js";
import { getClaudeCodeProvider } from "./claude-code-providers.js";
import type {
  ClaudeCodeAuthHeader,
  ClaudeCodeProviderId,
  ClaudeCodeProviderTemplate,
} from "./claude-code-providers.js";

type ClaudeCodeTargetType =
  | "user-settings"
  | "project-local-settings"
  | "project-shared-settings"
  | "launch-env";

interface ApplyClaudeCodeProfilePayload {
  target:
    | { type: "user-settings" }
    | { type: "project-local-settings"; projectPath: string }
    | { type: "project-shared-settings"; projectPath: string; confirmShared: true }
    | { type: "launch-env"; workingDirectory?: string };
}

interface UpsertClaudeCodeProfilePayload {
  name: string;
  providerId: ClaudeCodeProviderId;
  baseUrl?: string;
  mainModel?: string;
  opusModel?: string;
  sonnetModel?: string;
  haikuModel?: string;
  subagentModel?: string;
  authHeader: ClaudeCodeAuthHeader;
  apiKey?: string;
  clearApiKey?: boolean;
  customHeadersJson?: string;
  disableNonessentialTraffic: boolean;
  apiKeyHelperTtlMs?: number | null;
}

interface RevertClaudeCodeApplicationPayload {
  force?: boolean;
}

interface ClaudeCodeProfileView {
  id: string;
  name: string;
  providerId: ClaudeCodeProviderId;
  providerName: string;
  baseUrl: string;
  mainModel: string;
  opusModel: string;
  sonnetModel: string;
  haikuModel: string;
  subagentModel: string;
  authHeader: ClaudeCodeAuthHeader;
  hasApiKey: boolean;
  customHeadersJson: string;
  disableNonessentialTraffic: boolean;
  apiKeyHelperTtlMs: number | null;
  isActive: boolean;
  lastAppliedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface ClaudeCodeApplicationView {
  id: string;
  profileId: string;
  profileName: string;
  targetType: ClaudeCodeTargetType;
  targetPath: string;
  appliedPatch: Record<string, unknown>;
  appliedAt: number;
  revertedAt: number | null;
  error: string | null;
}

interface ClaudeCodeBackupPayload {
  app: "squirrel-switch";
  platform: "claude-code";
  v: 1;
  exportedAt: string;
  includesApiKeys: boolean;
  profiles: Array<{
    name: string;
    providerId: ClaudeCodeProviderId;
    baseUrl: string;
    mainModel: string;
    opusModel: string;
    sonnetModel: string;
    haikuModel: string;
    subagentModel: string;
    authHeader: ClaudeCodeAuthHeader;
    apiKey?: string;
    customHeadersJson: string;
    disableNonessentialTraffic: boolean;
    apiKeyHelperTtlMs: number | null;
  }>;
}

interface ImportClaudeCodeBackupResult {
  imported: number;
  profiles: ClaudeCodeProfileView[];
}

interface PlatformProfileRow {
  id: string;
  platform_id: "claude-code";
  name: string;
  provider_id: string;
  is_active: 0 | 1;
  last_applied_at: number | null;
  created_at: number;
  updated_at: number;
}

interface ClaudeCodeProfileRow extends PlatformProfileRow {
  profile_id: string;
  base_url: string;
  main_model: string;
  opus_model: string;
  sonnet_model: string;
  haiku_model: string;
  subagent_model: string;
  auth_header: ClaudeCodeAuthHeader;
  encrypted_api_key: Buffer | null;
  custom_headers_json: string;
  disable_nonessential_traffic: 0 | 1;
  api_key_helper_ttl_ms: number | null;
}

interface ClaudeCodeApplicationRow {
  id: string;
  profile_id: string;
  name: string;
  target_type: ClaudeCodeApplicationView["targetType"];
  target_path: string;
  previous_snapshot_encrypted: Buffer | null;
  previous_snapshot_hash: string | null;
  applied_snapshot_hash: string | null;
  applied_patch_json: string;
  applied_at: number;
  reverted_at: number | null;
  error: string | null;
}

type JsonObject = Record<string, unknown>;

const MANAGED_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
  "CLAUDE_CODE_API_KEY_HELPER_TTL_MS",
  "ANTHROPIC_CUSTOM_HEADERS",
] as const;

export function listClaudeCodeProfiles(): ClaudeCodeProfileView[] {
  const rows = db
    .prepare(
      `SELECT pp.*, cp.*
       FROM platform_profiles pp
       JOIN claude_code_profiles cp ON cp.profile_id = pp.id
       WHERE pp.platform_id = 'claude-code'
       ORDER BY pp.is_active DESC, pp.updated_at DESC`,
    )
    .all() as ClaudeCodeProfileRow[];
  return rows.map(mapClaudeCodeProfile);
}

export function listClaudeCodeApplications(): ClaudeCodeApplicationView[] {
  const rows = db
    .prepare(
      `SELECT app.*, pp.name
       FROM claude_code_config_applications app
       JOIN platform_profiles pp ON pp.id = app.profile_id
       ORDER BY app.applied_at DESC
       LIMIT 100`,
    )
    .all() as ClaudeCodeApplicationRow[];
  return rows.map(mapClaudeCodeApplication);
}

export async function createClaudeCodeProfile(
  payload: UpsertClaudeCodeProfilePayload,
): Promise<ClaudeCodeProfileView> {
  const normalized = normalizeProfilePayload(payload);
  const id = randomUUID();
  const now = nowSeconds();
  const encryptedApiKey = normalized.apiKey ? await encryptText(normalized.apiKey) : null;

  db.transaction(() => {
    db.prepare(
      `INSERT INTO platform_profiles (
         id, platform_id, name, provider_id, is_active, created_at, updated_at
       ) VALUES (?, 'claude-code', ?, ?, 0, ?, ?)`,
    ).run(id, normalized.name, normalized.providerId, now, now);
    db.prepare(
      `INSERT INTO claude_code_profiles (
         profile_id, provider_id, base_url, main_model, opus_model, sonnet_model,
         haiku_model, subagent_model, auth_header, encrypted_api_key,
         custom_headers_json, disable_nonessential_traffic, api_key_helper_ttl_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      normalized.providerId,
      normalized.baseUrl,
      normalized.mainModel,
      normalized.opusModel,
      normalized.sonnetModel,
      normalized.haikuModel,
      normalized.subagentModel,
      normalized.authHeader,
      encryptedApiKey,
      normalized.customHeadersJson,
      normalized.disableNonessentialTraffic ? 1 : 0,
      normalized.apiKeyHelperTtlMs,
    );
  })();

  const profile = getClaudeCodeProfile(id);
  void writeRuntimeLog("info", "claude-code", `创建 Claude Code profile ${profile.name}`);
  return profile;
}

export async function updateClaudeCodeProfile(
  id: string,
  payload: UpsertClaudeCodeProfilePayload,
): Promise<ClaudeCodeProfileView> {
  getClaudeCodeProfileRow(id);
  const normalized = normalizeProfilePayload(payload);
  const now = nowSeconds();
  const encryptedApiKey =
    normalized.clearApiKey || normalized.apiKey
      ? normalized.apiKey
        ? await encryptText(normalized.apiKey)
        : null
      : undefined;

  db.transaction(() => {
    db.prepare(
      `UPDATE platform_profiles
       SET name = ?, provider_id = ?, updated_at = ?
       WHERE id = ? AND platform_id = 'claude-code'`,
    ).run(normalized.name, normalized.providerId, now, id);
    db.prepare(
      `UPDATE claude_code_profiles
       SET provider_id = ?,
           base_url = ?,
           main_model = ?,
           opus_model = ?,
           sonnet_model = ?,
           haiku_model = ?,
           subagent_model = ?,
           auth_header = ?,
           custom_headers_json = ?,
           disable_nonessential_traffic = ?,
           api_key_helper_ttl_ms = ?,
           encrypted_api_key = COALESCE(?, encrypted_api_key)
       WHERE profile_id = ?`,
    ).run(
      normalized.providerId,
      normalized.baseUrl,
      normalized.mainModel,
      normalized.opusModel,
      normalized.sonnetModel,
      normalized.haikuModel,
      normalized.subagentModel,
      normalized.authHeader,
      normalized.customHeadersJson,
      normalized.disableNonessentialTraffic ? 1 : 0,
      normalized.apiKeyHelperTtlMs,
      encryptedApiKey ?? null,
      id,
    );
    if (normalized.clearApiKey) {
      db.prepare("UPDATE claude_code_profiles SET encrypted_api_key = NULL WHERE profile_id = ?").run(
        id,
      );
    }
  })();

  const profile = getClaudeCodeProfile(id);
  void writeRuntimeLog("info", "claude-code", `更新 Claude Code profile ${profile.name}`);
  return profile;
}

export function deleteClaudeCodeProfile(id: string): void {
  const profile = getClaudeCodeProfile(id);
  db.prepare("DELETE FROM platform_profiles WHERE id = ? AND platform_id = 'claude-code'").run(id);
  void writeRuntimeLog("warn", "claude-code", `删除 Claude Code profile ${profile.name}`);
}

export async function applyClaudeCodeProfile(
  id: string,
  payload: ApplyClaudeCodeProfilePayload,
): Promise<ClaudeCodeApplicationView> {
  const row = getClaudeCodeProfileRow(id);
  if (!row.encrypted_api_key) {
    throw new AppError("该 profile 未保存 API key，无法应用或启动", 400);
  }
  await ensureClaudeCodeApiKeyHelper();

  if (payload.target.type === "launch-env") {
    await launchClaudeCode(row, payload.target.workingDirectory);
    return insertApplication(row, {
      targetType: "launch-env",
      targetPath: payload.target.workingDirectory ? resolve(payload.target.workingDirectory) : homedir(),
      previousText: null,
      appliedText: null,
      appliedPatch: buildSettingsPatch(row),
    });
  }

  const targetPath = resolveSettingsTarget(payload.target);
  const previousText = await readFile(targetPath, "utf8").catch((error: unknown) => {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  });
  const nextText = buildSettingsText(previousText, row);
  await writeTextFileAtomic(targetPath, nextText);
  await assertReadableJson(targetPath);
  const application = await insertApplication(row, {
    targetType: payload.target.type,
    targetPath,
    previousText,
    appliedText: nextText,
    appliedPatch: buildSettingsPatch(row),
  });
  void writeRuntimeLog(
    "info",
    "claude-code",
    `应用 ${row.name} 到 ${targetLabel(payload.target.type)}`,
  );
  return application;
}

export async function revertClaudeCodeApplication(
  id: string,
  payload: RevertClaudeCodeApplicationPayload = {},
): Promise<ClaudeCodeApplicationView> {
  const row = getClaudeCodeApplicationRow(id);
  if (row.target_type === "launch-env") {
    throw new AppError("一次性启动记录不需要恢复", 400);
  }
  if (row.reverted_at) {
    throw new AppError("该应用记录已恢复", 400);
  }
  const current = await readTextFile(row.target_path).catch((error: unknown) => {
    if (isNotFoundError(error)) {
      return "";
    }
    throw error;
  });
  const currentHash = sha256Text(current);
  if (row.applied_snapshot_hash && currentHash !== row.applied_snapshot_hash && !payload.force) {
    throw new AppError("目标 settings 已被手动修改，请确认后再覆盖恢复", 409);
  }

  if (!row.previous_snapshot_encrypted) {
    await unlink(row.target_path).catch((error: unknown) => {
      if (!isNotFoundError(error)) {
        throw error;
      }
    });
    const now = nowSeconds();
    db.prepare("UPDATE claude_code_config_applications SET reverted_at = ? WHERE id = ?").run(
      now,
      id,
    );
    void writeRuntimeLog("info", "claude-code", `移除 Claude Code settings ${row.name}`);
    return mapClaudeCodeApplication(getClaudeCodeApplicationRow(id));
  }

  const previous = await decryptText(row.previous_snapshot_encrypted);
  await writeTextFileAtomic(row.target_path, previous);
  const now = nowSeconds();
  db.prepare("UPDATE claude_code_config_applications SET reverted_at = ? WHERE id = ?").run(now, id);
  void writeRuntimeLog("info", "claude-code", `恢复 Claude Code settings ${row.name}`);
  return mapClaudeCodeApplication(getClaudeCodeApplicationRow(id));
}

export async function exportClaudeCodeBackup(
  includeApiKeys: boolean,
): Promise<ClaudeCodeBackupPayload> {
  const rows = listClaudeCodeProfileRows();
  const profiles = await Promise.all(
    rows.map(async (row) => ({
      name: row.name,
      providerId: row.provider_id as ClaudeCodeProviderId,
      baseUrl: row.base_url,
      mainModel: row.main_model,
      opusModel: row.opus_model,
      sonnetModel: row.sonnet_model,
      haikuModel: row.haiku_model,
      subagentModel: row.subagent_model,
      authHeader: row.auth_header,
      ...(includeApiKeys && row.encrypted_api_key
        ? { apiKey: await decryptText(row.encrypted_api_key) }
        : {}),
      customHeadersJson: row.custom_headers_json,
      disableNonessentialTraffic: row.disable_nonessential_traffic === 1,
      apiKeyHelperTtlMs: row.api_key_helper_ttl_ms,
    })),
  );
  return {
    app: "squirrel-switch",
    platform: "claude-code",
    v: 1,
    exportedAt: new Date().toISOString(),
    includesApiKeys: includeApiKeys,
    profiles,
  };
}

export async function importClaudeCodeBackup(
  payload: ClaudeCodeBackupPayload,
): Promise<ImportClaudeCodeBackupResult> {
  for (const profile of payload.profiles) {
    await createClaudeCodeProfile({
      name: profile.name,
      providerId: profile.providerId,
      baseUrl: profile.baseUrl,
      mainModel: profile.mainModel,
      opusModel: profile.opusModel,
      sonnetModel: profile.sonnetModel,
      haikuModel: profile.haikuModel,
      subagentModel: profile.subagentModel,
      authHeader: profile.authHeader,
      apiKey: profile.apiKey,
      customHeadersJson: profile.customHeadersJson,
      disableNonessentialTraffic: profile.disableNonessentialTraffic,
      apiKeyHelperTtlMs: profile.apiKeyHelperTtlMs,
    });
  }
  return {
    imported: payload.profiles.length,
    profiles: listClaudeCodeProfiles(),
  };
}

export async function readClaudeCodeApiKey(id: string): Promise<string> {
  const row = getClaudeCodeProfileRow(id);
  if (!row.encrypted_api_key) {
    throw new AppError("该 profile 未保存 API key", 404);
  }
  return decryptText(row.encrypted_api_key);
}

function getClaudeCodeProfile(id: string): ClaudeCodeProfileView {
  return mapClaudeCodeProfile(getClaudeCodeProfileRow(id));
}

function getClaudeCodeProfileRow(id: string): ClaudeCodeProfileRow {
  const row = db
    .prepare(
      `SELECT pp.*, cp.*
       FROM platform_profiles pp
       JOIN claude_code_profiles cp ON cp.profile_id = pp.id
       WHERE pp.platform_id = 'claude-code' AND pp.id = ?`,
    )
    .get(id) as ClaudeCodeProfileRow | undefined;
  if (!row) {
    throw new AppError("Claude Code profile 不存在", 404);
  }
  return row;
}

function listClaudeCodeProfileRows(): ClaudeCodeProfileRow[] {
  return db
    .prepare(
      `SELECT pp.*, cp.*
       FROM platform_profiles pp
       JOIN claude_code_profiles cp ON cp.profile_id = pp.id
       WHERE pp.platform_id = 'claude-code'
       ORDER BY pp.updated_at DESC`,
    )
    .all() as ClaudeCodeProfileRow[];
}

function getClaudeCodeApplicationRow(id: string): ClaudeCodeApplicationRow {
  const row = db
    .prepare(
      `SELECT app.*, pp.name
       FROM claude_code_config_applications app
       JOIN platform_profiles pp ON pp.id = app.profile_id
       WHERE app.id = ?`,
    )
    .get(id) as ClaudeCodeApplicationRow | undefined;
  if (!row) {
    throw new AppError("应用记录不存在", 404);
  }
  return row;
}

function mapClaudeCodeProfile(row: ClaudeCodeProfileRow): ClaudeCodeProfileView {
  const provider = getClaudeCodeProvider(row.provider_id);
  return {
    id: row.id,
    name: row.name,
    providerId: provider.id,
    providerName: provider.displayName,
    baseUrl: row.base_url,
    mainModel: row.main_model,
    opusModel: row.opus_model,
    sonnetModel: row.sonnet_model,
    haikuModel: row.haiku_model,
    subagentModel: row.subagent_model,
    authHeader: row.auth_header,
    hasApiKey: Boolean(row.encrypted_api_key),
    customHeadersJson: row.custom_headers_json,
    disableNonessentialTraffic: row.disable_nonessential_traffic === 1,
    apiKeyHelperTtlMs: row.api_key_helper_ttl_ms,
    isActive: row.is_active === 1,
    lastAppliedAt: row.last_applied_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapClaudeCodeApplication(row: ClaudeCodeApplicationRow): ClaudeCodeApplicationView {
  return {
    id: row.id,
    profileId: row.profile_id,
    profileName: row.name,
    targetType: row.target_type,
    targetPath: row.target_path,
    appliedPatch: parseJsonObject(row.applied_patch_json, "应用记录内容不合法"),
    appliedAt: row.applied_at,
    revertedAt: row.reverted_at,
    error: row.error,
  };
}

function normalizeProfilePayload(payload: UpsertClaudeCodeProfilePayload) {
  const provider = getClaudeCodeProvider(payload.providerId);
  const defaults = provider.defaultModels;
  const customHeadersJson = normalizeCustomHeaders(payload.customHeadersJson ?? "");
  const ttl = payload.apiKeyHelperTtlMs ?? 300_000;
  if (ttl < 1_000 || ttl > 86_400_000) {
    throw new AppError("apiKeyHelper TTL 必须在 1000 到 86400000 毫秒之间");
  }
  return {
    name: requireTrimmed(payload.name, "名称不能为空"),
    providerId: provider.id,
    baseUrl: (payload.baseUrl ?? provider.defaultBaseUrl).trim(),
    mainModel: trimWithDefault(payload.mainModel, defaults.main),
    opusModel: trimWithDefault(payload.opusModel, defaults.opus),
    sonnetModel: trimWithDefault(payload.sonnetModel, defaults.sonnet),
    haikuModel: trimWithDefault(payload.haikuModel, defaults.haiku),
    subagentModel: trimWithDefault(payload.subagentModel, defaults.subagent),
    authHeader: payload.authHeader,
    apiKey: payload.apiKey?.trim() || undefined,
    clearApiKey: payload.clearApiKey === true && !payload.apiKey?.trim(),
    customHeadersJson,
    disableNonessentialTraffic: payload.disableNonessentialTraffic,
    apiKeyHelperTtlMs: ttl,
  };
}

function normalizeCustomHeaders(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const parsed = parseJsonObject(trimmed, "自定义 headers 必须是 JSON 对象");
  return stableJson(parsed).trim();
}

function buildSettingsText(previousText: string | null, row: ClaudeCodeProfileRow): string {
  const settings = previousText ? parseJsonObject(previousText, "Claude Code settings JSON 损坏") : {};
  const currentEnv = isJsonObject(settings.env) ? settings.env : {};
  const nextEnv: JsonObject = { ...currentEnv };
  for (const key of MANAGED_ENV_KEYS) {
    delete nextEnv[key];
  }
  Object.assign(nextEnv, buildManagedEnv(row));
  settings.env = nextEnv;
  settings.apiKeyHelper = apiKeyHelperCommand(row.id);
  return stableJson(settings);
}

function buildManagedEnv(row: ClaudeCodeProfileRow): Record<string, string> {
  const env: Record<string, string> = {};
  setIfValue(env, "ANTHROPIC_BASE_URL", row.base_url);
  setIfValue(env, "ANTHROPIC_MODEL", row.main_model);
  setIfValue(env, "ANTHROPIC_DEFAULT_OPUS_MODEL", row.opus_model);
  setIfValue(env, "ANTHROPIC_DEFAULT_SONNET_MODEL", row.sonnet_model);
  setIfValue(env, "ANTHROPIC_DEFAULT_HAIKU_MODEL", row.haiku_model);
  setIfValue(env, "CLAUDE_CODE_SUBAGENT_MODEL", row.subagent_model);
  if (row.disable_nonessential_traffic === 1) {
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1";
  }
  if (row.api_key_helper_ttl_ms) {
    env.CLAUDE_CODE_API_KEY_HELPER_TTL_MS = String(row.api_key_helper_ttl_ms);
  }
  setIfValue(env, "ANTHROPIC_CUSTOM_HEADERS", row.custom_headers_json);
  return env;
}

function buildSettingsPatch(row: ClaudeCodeProfileRow): Record<string, unknown> {
  return {
    env: buildManagedEnv(row),
    apiKeyHelper: apiKeyHelperCommand(row.id),
    authHeader: row.auth_header,
  };
}

async function insertApplication(
  row: ClaudeCodeProfileRow,
  input: {
    targetType: ClaudeCodeApplicationView["targetType"];
    targetPath: string;
    previousText: string | null;
    appliedText: string | null;
    appliedPatch: Record<string, unknown>;
  },
): Promise<ClaudeCodeApplicationView> {
  const id = randomUUID();
  const now = nowSeconds();
  const previousEncrypted = input.previousText === null ? null : await encryptText(input.previousText);
  db.transaction(() => {
    db.prepare(
      `INSERT INTO claude_code_config_applications (
         id, profile_id, target_type, target_path, previous_snapshot_encrypted,
         previous_snapshot_hash, applied_snapshot_hash, applied_patch_json, applied_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      row.id,
      input.targetType,
      input.targetPath,
      previousEncrypted,
      input.previousText === null ? null : sha256Text(input.previousText),
      input.appliedText === null ? null : sha256Text(input.appliedText),
      stableJson(input.appliedPatch),
      now,
    );
    db.prepare("UPDATE platform_profiles SET is_active = 0 WHERE platform_id = 'claude-code'").run();
    db.prepare(
      `UPDATE platform_profiles
       SET is_active = 1, last_applied_at = ?, updated_at = ?
       WHERE id = ? AND platform_id = 'claude-code'`,
    ).run(now, now, row.id);
  })();
  return mapClaudeCodeApplication(getClaudeCodeApplicationRow(id));
}

function resolveSettingsTarget(target: ApplyClaudeCodeProfilePayload["target"]): string {
  if (target.type === "user-settings") {
    return claudeUserSettingsPath();
  }
  if (target.type === "project-local-settings") {
    return claudeProjectSettingsPath(requireProjectPath(target.projectPath), target.type);
  }
  if (target.type === "project-shared-settings") {
    if (target.confirmShared !== true) {
      throw new AppError("写入项目共享配置需要确认", 400);
    }
    return claudeProjectSettingsPath(requireProjectPath(target.projectPath), target.type);
  }
  throw new AppError("一次性启动不写 settings", 400);
}

function requireProjectPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new AppError("项目路径不能为空");
  }
  return resolve(trimmed);
}

async function assertReadableJson(path: string): Promise<void> {
  parseJsonObject(await readTextFile(path), "写入后的 settings JSON 不合法");
}

async function ensureClaudeCodeApiKeyHelper(): Promise<void> {
  await mkdir(appBinDir, { recursive: true, mode: 0o700 });
  const script = `#!/bin/sh
set -eu
profile_id="$1"
curl -fsS "http://127.0.0.1:\${SQUIRREL_SWITCH_PORT:-3210}/api/platforms/claude-code/profiles/$profile_id/api-key-helper"
`;
  const path = apiKeyHelperPath();
  const exists = await access(path, constants.X_OK).then(
    () => true,
    () => false,
  );
  if (!exists || (await readFile(path, "utf8").catch(() => "")) !== script) {
    await chmod(path, 0o700).catch(() => undefined);
    await writeFile(path, script, { mode: 0o500 });
  }
  await chmod(path, 0o500);
}

async function launchClaudeCode(
  row: ClaudeCodeProfileRow,
  workingDirectory: string | undefined,
): Promise<void> {
  const cwd = workingDirectory ? requireProjectPath(workingDirectory) : homedir();
  await stat(cwd).catch(() => {
    throw new AppError("启动目录不存在", 404);
  });
  const launcherPath = await ensureClaudeCodeLauncher(row, cwd);
  const command = `clear && exec ${shellQuote(launcherPath)}`;
  const execFileAsync = promisify(execFile);
  try {
    await execFileAsync("osascript", [
      "-e",
      `tell application "Terminal" to do script ${JSON.stringify(command)}`,
      "-e",
      `tell application "Terminal" to activate`,
    ]);
    void writeRuntimeLog("info", "claude-code", `启动 Claude Code ${row.name}`);
  } catch (error) {
    throw new AppError(`启动 Terminal 失败：${getErrorMessage(error)}`, 500);
  }
}

async function ensureClaudeCodeLauncher(row: ClaudeCodeProfileRow, cwd: string): Promise<string> {
  await mkdir(appBinDir, { recursive: true, mode: 0o700 });
  const launcherPath = `${appBinDir}/claude-code-launch-${row.id}.sh`;
  const script = buildLaunchScript(row, cwd);
  const tempPath = `${launcherPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, script, { mode: 0o500 });
  await chmod(tempPath, 0o500);
  await rename(tempPath, launcherPath);
  await chmod(launcherPath, 0o500);
  return launcherPath;
}

function buildLaunchScript(row: ClaudeCodeProfileRow, cwd: string): string {
  const env = buildManagedEnv(row);
  const keyVar = row.auth_header === "authorization-bearer" ? "ANTHROPIC_AUTH_TOKEN" : "ANTHROPIC_API_KEY";
  env[keyVar] = `$(${apiKeyHelperShellCommand(row.id)})`;
  const exports = Object.entries(env)
    .map(([key, value]) =>
      value.startsWith("$(") ? `export ${key}="${value}"` : `export ${key}=${shellQuote(value)}`,
    )
    .join("\n");
  return `#!/bin/sh
set -eu
cd ${shellQuote(cwd)}
${exports}
exec claude
`;
}

function apiKeyHelperPath(): string {
  return `${appBinDir}/claude-code-api-key-helper`;
}

function apiKeyHelperCommand(profileId: string): string {
  return `SQUIRREL_SWITCH_PORT=${serverPort()} ${apiKeyHelperPath()} ${profileId}`;
}

function apiKeyHelperShellCommand(profileId: string): string {
  return `SQUIRREL_SWITCH_PORT=${shellQuote(serverPort())} ${shellQuote(apiKeyHelperPath())} ${shellQuote(profileId)}`;
}

function serverPort(): string {
  return String(process.env.PORT || 3210);
}

function targetLabel(target: ClaudeCodeApplicationView["targetType"]): string {
  const map: Record<ClaudeCodeApplicationView["targetType"], string> = {
    "user-settings": "用户级配置",
    "project-local-settings": "项目本地配置",
    "project-shared-settings": "项目共享配置",
    "launch-env": "一次性启动环境",
  };
  return map[target];
}

function setIfValue(env: Record<string, string>, key: string, value: string | null): void {
  const trimmed = value?.trim();
  if (trimmed) {
    env[key] = trimmed;
  }
}

function trimWithDefault(value: string | undefined, fallback: string | undefined): string {
  return (value ?? fallback ?? "").trim();
}

function requireTrimmed(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new AppError(message);
  }
  return trimmed;
}

function parseJsonObject(text: string, message: string): JsonObject {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isJsonObject(parsed)) {
      throw new Error(message);
    }
    return parsed;
  } catch {
    throw new AppError(message, 409);
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function claudeCodeModelDefaults(
  providerId: ClaudeCodeProviderId,
): ClaudeCodeProviderTemplate["defaultModels"] {
  return getClaudeCodeProvider(providerId).defaultModels;
}
