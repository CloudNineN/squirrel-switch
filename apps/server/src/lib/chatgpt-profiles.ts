import { randomUUID } from "node:crypto";
import { join, relative, resolve } from "node:path";
import { db, mapChatGptProfile } from "./db.js";
import type {
  AccountRow,
  ChatGptProfileJoinedRow,
  ChatGptProfileView,
} from "./db.js";
import { AppError } from "./errors.js";
import { browserProfilesDir } from "./paths.js";
import { nowSeconds } from "./time.js";
import { writeRuntimeLog } from "./runtime-log.js";
import { initializeChatGptAppSyncForProfile } from "./chatgpt-app-configs.js";
import { initialChatGptProfileName, resolvedChatGptProfileName } from "./chatgpt-profile-name.js";

type ChatGptSessionStatus = ChatGptProfileView["sessionStatus"];
type ChatGptBrowserKind = ChatGptProfileView["browserKind"];

interface CreateChatGptProfilePayload {
  id?: string;
  displayName?: string;
  linkedCodexAccountId?: string | null;
  browserKind?: ChatGptBrowserKind;
  browserExecutablePath?: string | null;
  browserProfileDir?: string | null;
  sessionHash?: string | null;
  linkedCodexEmailHint?: string | null;
  accountEmailHint?: string | null;
  planLabelHint?: string | null;
}

interface UpdateChatGptProfilePayload {
  displayName?: string;
  linkedCodexAccountId?: string | null;
  browserKind?: ChatGptBrowserKind;
  browserExecutablePath?: string | null;
}

interface ChatGptAccountStatusInput {
  status: ChatGptSessionStatus;
  accountEmail: string | null;
  accountName: string | null;
  accountId: string | null;
  planType: string | null;
  planLabel: string | null;
  subscriptionExpiresAt: number | null;
  subscriptionRenewsAt: number | null;
  error: string | null;
}

interface ChatGptAccountStatusView extends ChatGptAccountStatusInput {
  profileId: string;
  checkedAt: number;
}

interface ImportChatGptProfileDescriptor {
  id?: string;
  displayName: string;
  browserKind?: ChatGptBrowserKind;
  browserExecutablePath?: string | null;
  browserProfileDir?: string | null;
  sessionHash: string | null;
  linkedCodexEmailHint: string | null;
  accountEmailHint: string | null;
  planLabelHint: string | null;
}

interface ImportChatGptProfilesResult {
  imported: number;
  profiles: ChatGptProfileView[];
}

export function listChatGptProfiles(): ChatGptProfileView[] {
  const rows = joinedProfileQuery("ORDER BY p.updated_at DESC, p.created_at DESC").all() as
    ChatGptProfileJoinedRow[];
  return rows.map(mapChatGptProfile);
}

export function getChatGptProfile(id: string): ChatGptProfileView {
  const row = joinedProfileQuery("WHERE p.id = ?").get(id) as ChatGptProfileJoinedRow | undefined;
  if (!row) {
    throw new AppError("ChatGPT 会话不存在", 404);
  }
  return mapChatGptProfile(row);
}

export function createChatGptProfile(payload: CreateChatGptProfilePayload): ChatGptProfileView {
  const id = normalizeProfileId(payload.id) ?? randomUUID();
  const linkedAccountId =
    normalizeLinkedAccountId(payload.linkedCodexAccountId) ??
    findAvailableAccountIdByEmail(payload.linkedCodexEmailHint ?? payload.accountEmailHint, id);
  ensureLinkedAccountAvailable(linkedAccountId, id);
  const accountEmailHint =
    normalizeOptionalText(payload.accountEmailHint) ?? accountEmailForId(linkedAccountId);
  const displayName = initialChatGptProfileName(payload.displayName, accountEmailHint);
  const browserKind = normalizeBrowserKind(payload.browserKind);
  const browserExecutablePath = normalizeOptionalText(payload.browserExecutablePath);
  const browserProfileDir = normalizeBrowserProfileDir(payload.browserProfileDir, id);
  const planLabelHint = normalizeOptionalText(payload.planLabelHint);
  const now = nowSeconds();

  db.prepare(
    `INSERT INTO chatgpt_profiles (
       id, display_name, linked_codex_account_id, session_hash,
       browser_kind, browser_executable_path, browser_profile_dir,
       account_email, plan_label, session_status,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unchecked', ?, ?)`,
  ).run(
    id,
    displayName,
    linkedAccountId,
    payload.sessionHash ?? null,
    browserKind,
    browserExecutablePath,
    browserProfileDir,
    accountEmailHint,
    planLabelHint,
    now,
    now,
  );
  initializeChatGptAppSyncForProfile(id);

  void writeRuntimeLog("info", "chatgpt", `创建 ChatGPT 会话 ${displayName}`);
  return getChatGptProfile(id);
}

export function importChatGptProfiles(
  descriptors: ImportChatGptProfileDescriptor[],
): ImportChatGptProfilesResult {
  if (descriptors.length === 0) {
    throw new AppError("没有可导入的 ChatGPT 会话");
  }

  const imported = db.transaction(() => {
    const profiles: ChatGptProfileView[] = [];
    for (const descriptor of descriptors) {
      profiles.push(createChatGptProfile(descriptor));
    }
    return profiles;
  })();

  void writeRuntimeLog("info", "chatgpt", `导入 ChatGPT 会话 ${imported.length} 个`);
  return {
    imported: imported.length,
    profiles: listChatGptProfiles(),
  };
}

export function updateChatGptProfile(
  id: string,
  payload: UpdateChatGptProfilePayload,
): ChatGptProfileView {
  const current = getChatGptProfile(id);
  const displayName =
    payload.displayName === undefined
      ? current.displayName
      : normalizeDisplayName(payload.displayName);
  const linkedAccountId =
    payload.linkedCodexAccountId === undefined
      ? current.linkedCodexAccountId
      : normalizeLinkedAccountId(payload.linkedCodexAccountId);
  const browserKind =
    payload.browserKind === undefined ? current.browserKind : normalizeBrowserKind(payload.browserKind);
  const browserExecutablePath =
    payload.browserExecutablePath === undefined
      ? current.browserExecutablePath
      : normalizeOptionalText(payload.browserExecutablePath);
  ensureLinkedAccountAvailable(linkedAccountId, id);

  db.prepare(
    `UPDATE chatgpt_profiles
     SET display_name = ?,
         linked_codex_account_id = ?,
         browser_kind = ?,
         browser_executable_path = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(displayName, linkedAccountId, browserKind, browserExecutablePath, nowSeconds(), id);

  void writeRuntimeLog("info", "chatgpt", `更新 ChatGPT 会话 ${displayName}`);
  return getChatGptProfile(id);
}

export function updateChatGptProfileStatus(
  id: string,
  input: ChatGptAccountStatusInput,
): ChatGptAccountStatusView {
  const current = getChatGptProfile(id);
  const now = nowSeconds();
  const status = normalizeSessionStatus(input.status);
  const error = normalizeCheckError(input.error);
  const accountEmail = normalizeOptionalText(input.accountEmail) ?? current.accountEmail;
  const accountName = normalizeOptionalText(input.accountName) ?? current.accountName;
  const accountId = normalizeOptionalText(input.accountId) ?? current.accountId;
  const planType = normalizeOptionalText(input.planType) ?? current.planType;
  const planLabel = normalizeOptionalText(input.planLabel) ?? current.planLabel;
  const hasNonExpiringPlan = isNonExpiringChatGptPlan(planType, planLabel);
  const subscriptionExpiresAt = hasNonExpiringPlan ? null : input.subscriptionExpiresAt ?? current.subscriptionExpiresAt;
  const subscriptionRenewsAt = hasNonExpiringPlan ? null : input.subscriptionRenewsAt ?? current.subscriptionRenewsAt;
  const displayName = resolvedChatGptProfileName(
    current.displayName,
    current.accountEmail,
    accountEmail,
  );
  const linkedAccountId =
    findAvailableAccountIdByEmail(accountEmail, id) ?? current.linkedCodexAccountId;
  db.prepare(
    `UPDATE chatgpt_profiles
     SET display_name = ?,
         linked_codex_account_id = ?,
         account_email = ?,
         account_name = ?,
         account_id = ?,
         plan_type = ?,
         plan_label = ?,
         subscription_expires_at = ?,
         subscription_renews_at = ?,
         session_status = ?,
         last_checked_at = ?,
         last_check_error = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    displayName,
    linkedAccountId,
    accountEmail,
    accountName,
    accountId,
    planType,
    planLabel,
    subscriptionExpiresAt,
    subscriptionRenewsAt,
    status,
    now,
    error,
    now,
    id,
  );

  initializeChatGptAppSyncForProfile(id);

  void writeRuntimeLog(
    status === "available" ? "info" : "warn",
    "chatgpt",
    `检查 ChatGPT 会话 ${current.displayName}：${status}`,
  );
  return {
    profileId: id,
    status,
    accountEmail,
    accountName,
    accountId,
    planType,
    planLabel,
    subscriptionExpiresAt,
    subscriptionRenewsAt,
    checkedAt: now,
    error,
  };
}

function isNonExpiringChatGptPlan(planType: string | null, planLabel: string | null): boolean {
  const values = [planType, planLabel]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));
  return values.some((value) => value === "free" || value === "guest");
}

export function touchChatGptProfileOpened(id: string): ChatGptProfileView {
  const current = getChatGptProfile(id);
  const now = nowSeconds();
  db.prepare(
    "UPDATE chatgpt_profiles SET last_opened_at = ?, updated_at = ? WHERE id = ?",
  ).run(now, now, id);
  void writeRuntimeLog("info", "chatgpt", `打开 ChatGPT 会话 ${current.displayName}`);
  return getChatGptProfile(id);
}

export function markChatGptProfileExported(
  id: string,
  sessionHash: string | null,
): ChatGptProfileView {
  const current = getChatGptProfile(id);
  const now = nowSeconds();
  db.prepare(
    `UPDATE chatgpt_profiles
     SET session_hash = COALESCE(?, session_hash), last_exported_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(sessionHash, now, now, id);
  void writeRuntimeLog("info", "chatgpt", `导出 ChatGPT 会话 ${current.displayName}`);
  return getChatGptProfile(id);
}

export function deleteChatGptProfile(id: string): void {
  const current = getChatGptProfile(id);
  db.prepare("DELETE FROM chatgpt_profiles WHERE id = ?").run(id);
  void writeRuntimeLog("warn", "chatgpt", `删除 ChatGPT 会话 ${current.displayName}`);
}

function joinedProfileQuery(suffix: string) {
  return db.prepare(
    `SELECT
       p.*,
       a.name AS linked_codex_account_name,
       a.email AS linked_codex_email
     FROM chatgpt_profiles p
     LEFT JOIN accounts a ON a.id = p.linked_codex_account_id
     ${suffix}`,
  );
}

function normalizeDisplayName(value: string | undefined): string {
  const trimmed = value?.trim();
  if (trimmed) {
    return trimmed;
  }
  throw new AppError("ChatGPT 备注不能为空");
}

function accountEmailForId(accountId: string | null): string | null {
  if (!accountId) {
    return null;
  }
  const row = db.prepare("SELECT email FROM accounts WHERE id = ?").get(accountId) as
    | { email: string | null }
    | undefined;
  return normalizeOptionalText(row?.email);
}

function normalizeLinkedAccountId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  const row = db.prepare("SELECT * FROM accounts WHERE id = ?").get(trimmed) as
    | AccountRow
    | undefined;
  if (!row) {
    throw new AppError("绑定的 Codex 账号不存在", 404);
  }
  return row.id;
}

function normalizeProfileId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    throw new AppError("ChatGPT profile id 不合法");
  }
  return trimmed;
}

function normalizeBrowserKind(value: ChatGptBrowserKind | null | undefined): ChatGptBrowserKind {
  if (value === "chrome" || value === "edge" || value === "custom") {
    return value;
  }
  return null;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeBrowserProfileDir(value: string | null | undefined, id: string): string {
  const resolved = resolve(normalizeOptionalText(value) ?? join(browserProfilesDir, id));
  const root = resolve(browserProfilesDir);
  const pathFromRoot = relative(root, resolved);
  if (!pathFromRoot || pathFromRoot.startsWith("..")) {
    throw new AppError("ChatGPT 浏览器 Profile 目录不合法");
  }
  return resolved;
}

function normalizeSessionStatus(value: string): ChatGptSessionStatus {
  if (
    value === "unchecked" ||
    value === "available" ||
    value === "invalid" ||
    value === "reauth_required"
  ) {
    return value;
  }
  throw new AppError("ChatGPT 会话状态不合法");
}

function normalizeCheckError(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/https?:\/\/\S+/g, "[url]").slice(0, 200);
}

function ensureLinkedAccountAvailable(
  linkedAccountId: string | null,
  currentProfileId: string,
): void {
  if (!linkedAccountId) {
    return;
  }

  const account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(linkedAccountId) as
    | AccountRow
    | undefined;
  if (!account) {
    throw new AppError("绑定的 Codex 账号不存在", 404);
  }

  const normalizedEmail = account.email?.trim().toLowerCase() ?? "";
  const existing = normalizedEmail
    ? (db
        .prepare(
          `SELECT p.display_name AS displayName
           FROM chatgpt_profiles p
           JOIN accounts a ON a.id = p.linked_codex_account_id
           WHERE p.id <> ? AND lower(a.email) = ?
           LIMIT 1`,
        )
        .get(currentProfileId, normalizedEmail) as { displayName: string } | undefined)
    : (db
        .prepare(
          `SELECT display_name AS displayName
           FROM chatgpt_profiles
           WHERE id <> ? AND linked_codex_account_id = ?
           LIMIT 1`,
        )
        .get(currentProfileId, linkedAccountId) as { displayName: string } | undefined);
  if (existing) {
    throw new AppError(`该 Codex 账号已绑定 ChatGPT 会话「${existing.displayName}」`, 409);
  }
}

function findAvailableAccountIdByEmail(
  email: string | null | undefined,
  currentProfileId: string,
): string | null {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const rows = db.prepare("SELECT id FROM accounts WHERE lower(email) = ?").all(normalized) as
    Array<{ id: string }>;
  if (rows.length !== 1) {
    return null;
  }
  const accountId = rows[0]!.id;
  const existing = db
    .prepare(
      `SELECT id
       FROM chatgpt_profiles
       WHERE id <> ? AND linked_codex_account_id = ?
       LIMIT 1`,
    )
    .get(currentProfileId, accountId) as { id: string } | undefined;
  return existing ? null : accountId;
}
