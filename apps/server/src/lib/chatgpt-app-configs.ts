import { createHash, randomUUID } from "node:crypto";
import { db, mapChatGptProfile } from "./db.js";
import type { ChatGptProfileJoinedRow } from "./db.js";
import { decryptText, encryptText } from "./crypto.js";
import { AppError } from "./errors.js";
import { nowSeconds } from "./time.js";
import { writeRuntimeLog } from "./runtime-log.js";

type ChatGptAppConfigType = "official_app" | "custom_mcp";
type ChatGptAppAuthType = "none" | "bearer" | "oauth" | "official" | "unknown";
type ChatGptAppScopeType = "all_profiles" | "specific_profiles";
type ChatGptAppSyncStatus = "pending" | "synced" | "failed" | "unchecked" | "skipped";
type StoredSyncStatus = ChatGptAppSyncStatus;

interface ChatGptProfileSummary {
  id: string;
  displayName: string;
  linkedCodexEmail: string | null;
  accountEmail: string | null;
  accountName: string | null;
  accountId: string | null;
  planType: string | null;
  planLabel: string | null;
  browserKind: "chrome" | "edge" | "custom" | null;
  browserExecutablePath: string | null;
  browserProfileDir: string | null;
}

interface ChatGptAppConfigManagementState {
  configs: ChatGptAppConfigView[];
  profiles: ChatGptProfileSummary[];
}

interface ChatGptAppConfigView {
  id: string;
  type: ChatGptAppConfigType;
  name: string;
  description: string | null;
  officialAppUrl: string | null;
  officialAppId: string | null;
  mcpServerUrl: string | null;
  authType: ChatGptAppAuthType;
  authNote: string | null;
  hasOAuthPassword: boolean;
  scopeType: ChatGptAppScopeType;
  targetProfileIds: string[];
  enabled: boolean;
  configHash: string;
  createdAt: number;
  updatedAt: number;
  syncStates: ChatGptAppSyncStateView[];
}

interface ChatGptAppSyncStateView {
  configId: string;
  profileId: string;
  profileName: string;
  profileEmail: string | null;
  linkedCodexEmail: string | null;
  status: ChatGptAppSyncStatus;
  syncedConfigHash: string | null;
  remoteConnectorId: string | null;
  remoteLinkId: string | null;
  lastSyncedAt: number | null;
  lastCheckedAt: number | null;
  error: string | null;
  updatedAt: number;
}

interface UpsertChatGptAppConfigPayload {
  type: ChatGptAppConfigType;
  name: string;
  description?: string | null;
  officialAppUrl?: string | null;
  officialAppId?: string | null;
  mcpServerUrl?: string | null;
  authType: ChatGptAppAuthType;
  authNote?: string | null;
  oauthPassword?: string | null;
  clearOAuthPassword?: boolean;
  scopeType: ChatGptAppScopeType;
  targetProfileIds?: string[];
  enabled: boolean;
}

interface UpdateChatGptAppSyncStatusPayload {
  status: "pending" | "synced" | "failed" | "skipped";
  error?: string | null;
  remoteConnectorId?: string | null;
  remoteLinkId?: string | null;
}

interface ChatGptAppConfigRow {
  id: string;
  type: string;
  name: string;
  description: string | null;
  official_app_url: string | null;
  official_app_id: string | null;
  mcp_server_url: string | null;
  auth_type: string;
  auth_note: string | null;
  encrypted_oauth_password: Buffer | null;
  scope_type: string;
  enabled: 0 | 1;
  config_hash: string;
  created_at: number;
  updated_at: number;
}

interface ChatGptAppSyncStateRow {
  config_id: string;
  profile_id: string;
  profile_name: string;
  profile_email: string | null;
  linked_codex_email: string | null;
  status: string;
  config_hash: string | null;
  remote_connector_id: string | null;
  remote_link_id: string | null;
  last_synced_at: number | null;
  last_checked_at: number | null;
  error: string | null;
  updated_at: number;
}

interface NormalizedConfigInput {
  type: ChatGptAppConfigType;
  name: string;
  description: string | null;
  officialAppUrl: string | null;
  officialAppId: string | null;
  mcpServerUrl: string | null;
  authType: ChatGptAppAuthType;
  authNote: string | null;
  oauthPassword: string | null;
  clearOAuthPassword: boolean;
  scopeType: ChatGptAppScopeType;
  targetProfileIds: string[];
  enabled: boolean;
}

export function readChatGptAppConfigManagementState(): ChatGptAppConfigManagementState {
  ensureMissingSyncRows();
  return {
    configs: listChatGptAppConfigs(),
    profiles: listProfiles(),
  };
}

export async function createChatGptAppConfig(payload: UpsertChatGptAppConfigPayload): Promise<ChatGptAppConfigView> {
  const input = normalizeConfigInput(payload);
  const id = randomUUID();
  const now = nowSeconds();
  const configHash = computeConfigHash(input);
  const encryptedOAuthPassword = input.oauthPassword ? await encryptText(input.oauthPassword) : null;

  db.transaction(() => {
    db.prepare(
      `INSERT INTO chatgpt_app_configs (
         id, type, name, description, official_app_url, official_app_id,
         mcp_server_url, auth_type, auth_note, encrypted_oauth_password, scope_type, enabled,
         config_hash, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.type,
      input.name,
      input.description,
      input.officialAppUrl,
      input.officialAppId,
      input.mcpServerUrl,
      input.authType,
      input.authNote,
      encryptedOAuthPassword,
      input.scopeType,
      input.enabled ? 1 : 0,
      configHash,
      now,
      now,
    );
    replaceTargetProfiles(id, input);
    reconcileConfigSyncRows(id, true);
  })();

  void writeRuntimeLog("info", "chatgpt-apps", `创建 ChatGPT 应用配置：${input.name}`);
  return getChatGptAppConfig(id);
}

export function updateChatGptAppConfig(
  id: string,
  payload: UpsertChatGptAppConfigPayload,
): Promise<ChatGptAppConfigView> {
  return updateChatGptAppConfigInternal(id, payload);
}

async function updateChatGptAppConfigInternal(
  id: string,
  payload: UpsertChatGptAppConfigPayload,
): Promise<ChatGptAppConfigView> {
  const current = getConfigRow(id);
  const input = normalizeConfigInput(payload);
  const now = nowSeconds();
  const configHash = computeConfigHash(input);
  const markApplicablePending = shouldMarkApplicableSyncPending(current, input);
  const shouldClearOAuthPassword =
    input.clearOAuthPassword || input.type !== "custom_mcp" || input.authType !== "oauth";
  const encryptedOAuthPassword =
    shouldClearOAuthPassword || input.oauthPassword
      ? input.oauthPassword
        ? await encryptText(input.oauthPassword)
        : null
      : undefined;

  db.transaction(() => {
    db.prepare(
      `UPDATE chatgpt_app_configs
       SET type = ?,
           name = ?,
           description = ?,
           official_app_url = ?,
           official_app_id = ?,
           mcp_server_url = ?,
           auth_type = ?,
           auth_note = ?,
           encrypted_oauth_password = COALESCE(?, encrypted_oauth_password),
           scope_type = ?,
           enabled = ?,
           config_hash = ?,
           updated_at = ?
       WHERE id = ?`,
    ).run(
      input.type,
      input.name,
      input.description,
      input.officialAppUrl,
      input.officialAppId,
      input.mcpServerUrl,
      input.authType,
      input.authNote,
      encryptedOAuthPassword ?? null,
      input.scopeType,
      input.enabled ? 1 : 0,
      configHash,
      now,
      id,
    );
    replaceTargetProfiles(id, input);
    if (shouldClearOAuthPassword && encryptedOAuthPassword === null) {
      db.prepare("UPDATE chatgpt_app_configs SET encrypted_oauth_password = NULL WHERE id = ?").run(id);
    }
    reconcileConfigSyncRows(id, markApplicablePending);
  })();

  void writeRuntimeLog("info", "chatgpt-apps", `更新 ChatGPT 应用配置：${input.name}`);
  return getChatGptAppConfig(id);
}

export async function readChatGptAppConfigDesktopSecret(id: string): Promise<ChatGptAppConfigView & { oauthPassword: string | null }> {
  const config = getChatGptAppConfig(id);
  const row = getConfigRow(id);
  return {
    ...config,
    oauthPassword: row.encrypted_oauth_password ? await decryptText(row.encrypted_oauth_password) : null,
  };
}

export function deleteChatGptAppConfig(id: string): void {
  const current = getConfigRow(id);
  db.prepare("DELETE FROM chatgpt_app_configs WHERE id = ?").run(id);
  void writeRuntimeLog("info", "chatgpt-apps", `删除 ChatGPT 应用配置：${current.name}`);
}

export function updateChatGptAppSyncStatus(
  configId: string,
  profileId: string,
  payload: UpdateChatGptAppSyncStatusPayload,
): ChatGptAppConfigView {
  const config = getConfigRow(configId);
  const profile = getProfilePlan(profileId);
  const status = isGuestChatGptPlan(profile.planType, profile.planLabel) ? "skipped" : normalizeSyncStatus(payload.status);
  const now = nowSeconds();
  const error = status === "failed" ? normalizeOptionalText(payload.error) ?? "同步失败" : null;
  const syncedAt = status === "synced" ? now : null;
  const hash = status === "synced" || status === "skipped" ? config.config_hash : null;
  const remoteConnectorId = status === "synced" ? normalizeOptionalText(payload.remoteConnectorId) : null;
  const remoteLinkId = status === "synced" ? normalizeOptionalText(payload.remoteLinkId) : null;

  db.prepare(
    `INSERT INTO chatgpt_app_config_sync_states (
       config_id, profile_id, status, config_hash, remote_connector_id,
       remote_link_id, last_synced_at, last_checked_at, error, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(config_id, profile_id) DO UPDATE SET
       status = excluded.status,
       config_hash = excluded.config_hash,
       remote_connector_id = excluded.remote_connector_id,
       remote_link_id = excluded.remote_link_id,
       last_synced_at = excluded.last_synced_at,
       last_checked_at = excluded.last_checked_at,
       error = excluded.error,
       updated_at = excluded.updated_at`,
  ).run(configId, profileId, status, hash, remoteConnectorId, remoteLinkId, syncedAt, now, error, now, now);

  void writeRuntimeLog("info", "chatgpt-apps", `更新 ChatGPT 应用同步状态：${config.name} ${status}`);
  return getChatGptAppConfig(configId);
}

export function initializeChatGptAppSyncForProfile(profileId: string): void {
  ensureProfileExists(profileId);
  const configs = db.prepare("SELECT id FROM chatgpt_app_configs").all() as Array<{ id: string }>;
  for (const config of configs) {
    reconcileConfigSyncRows(config.id, false);
  }
}

function listChatGptAppConfigs(): ChatGptAppConfigView[] {
  const rows = db
    .prepare("SELECT * FROM chatgpt_app_configs ORDER BY updated_at DESC, created_at DESC")
    .all() as ChatGptAppConfigRow[];
  return rows.map(mapConfigRow);
}

function getChatGptAppConfig(id: string): ChatGptAppConfigView {
  return mapConfigRow(getConfigRow(id));
}

function mapConfigRow(row: ChatGptAppConfigRow): ChatGptAppConfigView {
  return {
    id: row.id,
    type: normalizeStoredConfigType(row.type),
    name: row.name,
    description: row.description,
    officialAppUrl: row.official_app_url,
    officialAppId: row.official_app_id,
    mcpServerUrl: row.mcp_server_url,
    authType: normalizeStoredAuthType(row.auth_type),
    authNote: row.auth_note,
    hasOAuthPassword: Boolean(row.encrypted_oauth_password),
    scopeType: normalizeStoredScopeType(row.scope_type),
    targetProfileIds: listTargetProfileIds(row.id),
    enabled: row.enabled === 1,
    configHash: row.config_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStates: listSyncStates(row.id),
  };
}

function getConfigRow(id: string): ChatGptAppConfigRow {
  const row = db.prepare("SELECT * FROM chatgpt_app_configs WHERE id = ?").get(id) as
    | ChatGptAppConfigRow
    | undefined;
  if (!row) {
    throw new AppError("ChatGPT 应用配置不存在", 404);
  }
  return row;
}

function listTargetProfileIds(configId: string): string[] {
  const rows = db
    .prepare("SELECT profile_id FROM chatgpt_app_config_profiles WHERE config_id = ? ORDER BY created_at ASC")
    .all(configId) as Array<{ profile_id: string }>;
  return rows.map((row) => row.profile_id);
}

function listSyncStates(configId: string): ChatGptAppSyncStateView[] {
  const rows = db
    .prepare(
      `SELECT s.config_id,
              s.profile_id,
              p.display_name AS profile_name,
              p.account_email AS profile_email,
              a.email AS linked_codex_email,
              s.status,
              s.config_hash,
              s.remote_connector_id,
              s.remote_link_id,
              s.last_synced_at,
              s.last_checked_at,
              s.error,
              s.updated_at
       FROM chatgpt_app_config_sync_states s
       JOIN chatgpt_profiles p ON p.id = s.profile_id
       LEFT JOIN accounts a ON a.id = p.linked_codex_account_id
       WHERE s.config_id = ?
       ORDER BY p.updated_at DESC, p.created_at DESC`,
    )
    .all(configId) as ChatGptAppSyncStateRow[];
  return rows.map((row) => ({
    configId: row.config_id,
    profileId: row.profile_id,
    profileName: row.profile_name,
    profileEmail: row.profile_email,
    linkedCodexEmail: row.linked_codex_email,
    status: normalizeStoredSyncStatus(row.status),
    syncedConfigHash: row.config_hash,
    remoteConnectorId: row.remote_connector_id,
    remoteLinkId: row.remote_link_id,
    lastSyncedAt: row.last_synced_at,
    lastCheckedAt: row.last_checked_at,
    error: row.error,
    updatedAt: row.updated_at,
  }));
}

function listProfiles(): ChatGptProfileSummary[] {
  const rows = db
    .prepare(
      `SELECT p.*,
              a.name AS linked_codex_account_name,
              a.email AS linked_codex_email
       FROM chatgpt_profiles p
       LEFT JOIN accounts a ON a.id = p.linked_codex_account_id
       ORDER BY p.updated_at DESC, p.created_at DESC`,
    )
    .all() as ChatGptProfileJoinedRow[];
  return rows.map((row) => {
    const profile = mapChatGptProfile(row);
    return {
      id: profile.id,
      displayName: profile.displayName,
      linkedCodexEmail: profile.linkedCodexEmail,
      accountEmail: profile.accountEmail,
      accountName: profile.accountName,
      accountId: profile.accountId,
      planType: profile.planType,
      planLabel: profile.planLabel,
      browserKind: profile.browserKind,
      browserExecutablePath: profile.browserExecutablePath,
      browserProfileDir: profile.browserProfileDir,
    };
  });
}

function ensureMissingSyncRows(): void {
  const configs = db.prepare("SELECT id FROM chatgpt_app_configs").all() as Array<{ id: string }>;
  for (const config of configs) {
    reconcileConfigSyncRows(config.id, false);
  }
}

function reconcileConfigSyncRows(configId: string, markApplicablePending: boolean): void {
  const config = getConfigRow(configId);
  const targetIds = targetProfileIdsFor(config);
  const profiles = db
    .prepare("SELECT id, plan_type, plan_label FROM chatgpt_profiles")
    .all() as Array<{ id: string; plan_type: string | null; plan_label: string | null }>;
  const now = nowSeconds();

  for (const profile of profiles) {
    const applicable =
      config.enabled === 1 &&
      targetIds.has(profile.id) &&
      !isGuestChatGptPlan(profile.plan_type, profile.plan_label);
    const existing = db
      .prepare(
        `SELECT status
         FROM chatgpt_app_config_sync_states
         WHERE config_id = ? AND profile_id = ?`,
      )
      .get(configId, profile.id) as { status: string } | undefined;
    const existingStatus = existing ? normalizeStoredSyncStatus(existing.status) : null;
    const nextStatus: StoredSyncStatus = applicable
      ? markApplicablePending
        ? "pending"
        : existingStatus && existingStatus !== "skipped"
          ? existingStatus
          : "pending"
      : "skipped";
    const nextHash = nextStatus === "synced" || nextStatus === "skipped" ? config.config_hash : null;

    db.prepare(
      `INSERT INTO chatgpt_app_config_sync_states (
         config_id, profile_id, status, config_hash, remote_connector_id, remote_link_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)
       ON CONFLICT(config_id, profile_id) DO UPDATE SET
         status = excluded.status,
         config_hash = CASE
           WHEN excluded.status = 'pending' THEN chatgpt_app_config_sync_states.config_hash
           ELSE excluded.config_hash
         END,
         remote_connector_id = CASE
           WHEN excluded.status IN ('pending', 'skipped') THEN NULL
           ELSE chatgpt_app_config_sync_states.remote_connector_id
         END,
         remote_link_id = CASE
           WHEN excluded.status IN ('pending', 'skipped') THEN NULL
           ELSE chatgpt_app_config_sync_states.remote_link_id
         END,
         error = CASE
           WHEN excluded.status IN ('pending', 'skipped') THEN NULL
           ELSE chatgpt_app_config_sync_states.error
         END,
         updated_at = excluded.updated_at`,
    ).run(configId, profile.id, nextStatus, nextHash, now, now);
  }
}

function isGuestChatGptPlan(planType: string | null, planLabel: string | null): boolean {
  const values = [planType, planLabel]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));
  return values.some((value) => value === "guest");
}

function targetProfileIdsFor(config: ChatGptAppConfigRow): Set<string> {
  if (normalizeStoredScopeType(config.scope_type) === "all_profiles") {
    const rows = db.prepare("SELECT id FROM chatgpt_profiles").all() as Array<{ id: string }>;
    return new Set(rows.map((row) => row.id));
  }
  return new Set(listTargetProfileIds(config.id));
}

function replaceTargetProfiles(configId: string, input: NormalizedConfigInput): void {
  db.prepare("DELETE FROM chatgpt_app_config_profiles WHERE config_id = ?").run(configId);
  if (input.scopeType !== "specific_profiles") {
    return;
  }
  const insert = db.prepare(
    "INSERT INTO chatgpt_app_config_profiles (config_id, profile_id, created_at) VALUES (?, ?, ?)",
  );
  const now = nowSeconds();
  for (const profileId of input.targetProfileIds) {
    insert.run(configId, profileId, now);
  }
}

function normalizeConfigInput(payload: UpsertChatGptAppConfigPayload): NormalizedConfigInput {
  const type = normalizeStoredConfigType(payload.type);
  const name = normalizeRequiredText(payload.name, "名称");
  const description = normalizeOptionalText(payload.description);
  const officialAppUrl = normalizeOptionalUrl(payload.officialAppUrl, "官方应用 URL");
  const officialAppId = normalizeOptionalText(payload.officialAppId);
  const mcpServerUrl = normalizeOptionalUrl(payload.mcpServerUrl, "MCP Server URL");
  const authType = normalizeStoredAuthType(payload.authType);
  const authNote = normalizeOptionalText(payload.authNote);
  const oauthPassword = normalizeOptionalText(payload.oauthPassword);
  const scopeType = normalizeStoredScopeType(payload.scopeType);
  const targetProfileIds = uniqueProfileIds(payload.targetProfileIds ?? []);

  if (type === "custom_mcp" && !mcpServerUrl) {
    throw new AppError("自定义 MCP 需要填写 Server URL", 400);
  }
  if (scopeType === "specific_profiles") {
    for (const profileId of targetProfileIds) {
      ensureProfileExists(profileId);
    }
  }

  return {
    type,
    name,
    description,
    officialAppUrl: type === "official_app" ? officialAppUrl : null,
    officialAppId: type === "official_app" ? officialAppId : null,
    mcpServerUrl: type === "custom_mcp" ? mcpServerUrl : null,
    authType,
    authNote,
    oauthPassword: type === "custom_mcp" && authType === "oauth" ? oauthPassword : null,
    clearOAuthPassword: payload.clearOAuthPassword === true,
    scopeType,
    targetProfileIds: scopeType === "specific_profiles" ? targetProfileIds : [],
    enabled: payload.enabled,
  };
}

function computeConfigHash(input: NormalizedConfigInput): string {
  if (input.type === "custom_mcp") {
    return createHash("sha256")
      .update(
        JSON.stringify({
          mcpServerUrl: input.mcpServerUrl,
          type: input.type,
        }),
      )
      .digest("hex");
  }
  const targetProfileIds = [...input.targetProfileIds].sort();
  return createHash("sha256")
    .update(
      JSON.stringify({
        authNote: input.authNote,
        authType: input.authType,
        description: input.description,
        enabled: input.enabled,
        mcpServerUrl: input.mcpServerUrl,
        name: input.name,
        officialAppId: input.officialAppId,
        officialAppUrl: input.officialAppUrl,
        scopeType: input.scopeType,
        targetProfileIds,
        type: input.type,
      }),
    )
    .digest("hex");
}

function shouldMarkApplicableSyncPending(
  current: ChatGptAppConfigRow,
  input: NormalizedConfigInput,
): boolean {
  const currentType = normalizeStoredConfigType(current.type);
  if (currentType !== input.type) {
    return true;
  }
  if (input.type === "custom_mcp") {
    return current.mcp_server_url !== input.mcpServerUrl;
  }
  return current.config_hash !== computeConfigHash(input);
}

function normalizeRequiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new AppError(`${label}不能为空`, 400);
  }
  if (normalized.length > 200) {
    throw new AppError(`${label}过长`, 400);
  }
  return normalized;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 1000) : null;
}

function normalizeOptionalUrl(value: string | null | undefined, label: string): string | null {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("unsupported protocol");
    }
    return parsed.toString();
  } catch {
    throw new AppError(`${label}不合法`, 400);
  }
}

function uniqueProfileIds(profileIds: string[]): string[] {
  return [...new Set(profileIds.map((id) => id.trim()).filter(Boolean))];
}

function ensureProfileExists(profileId: string): void {
  const row = db.prepare("SELECT id FROM chatgpt_profiles WHERE id = ?").get(profileId);
  if (!row) {
    throw new AppError("ChatGPT Profile 不存在", 404);
  }
}

function getProfilePlan(profileId: string): { planType: string | null; planLabel: string | null } {
  const row = db
    .prepare("SELECT plan_type, plan_label FROM chatgpt_profiles WHERE id = ?")
    .get(profileId) as { plan_type: string | null; plan_label: string | null } | undefined;
  if (!row) {
    throw new AppError("ChatGPT Profile 不存在", 404);
  }
  return { planType: row.plan_type, planLabel: row.plan_label };
}

function normalizeStoredConfigType(value: string): ChatGptAppConfigType {
  if (value === "official_app" || value === "custom_mcp") {
    return value;
  }
  throw new AppError("ChatGPT 应用配置类型不合法", 400);
}

function normalizeStoredAuthType(value: string): ChatGptAppAuthType {
  if (
    value === "none" ||
    value === "bearer" ||
    value === "oauth" ||
    value === "official" ||
    value === "unknown"
  ) {
    return value;
  }
  throw new AppError("ChatGPT 应用认证方式不合法", 400);
}

function normalizeStoredScopeType(value: string): ChatGptAppScopeType {
  if (value === "all_profiles" || value === "specific_profiles") {
    return value;
  }
  throw new AppError("ChatGPT 应用适用范围不合法", 400);
}

function normalizeStoredSyncStatus(value: string): ChatGptAppSyncStatus {
  if (
    value === "pending" ||
    value === "synced" ||
    value === "failed" ||
    value === "unchecked" ||
    value === "skipped"
  ) {
    return value;
  }
  return "unchecked";
}

function normalizeSyncStatus(value: UpdateChatGptAppSyncStatusPayload["status"]): UpdateChatGptAppSyncStatusPayload["status"] {
  if (value === "pending" || value === "synced" || value === "failed" || value === "skipped") {
    return value;
  }
  throw new AppError("同步状态不合法", 400);
}
