import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { db, getEffectiveCodexHome, getSetting, mapAccount, setSetting } from "./db.js";
import type { AccountRow, AccountView } from "./db.js";
import { authJsonPath, defaultCodexHome } from "./paths.js";
import { readTextFile, writeAuthJsonAtomic } from "./files.js";
import { decryptText, encryptText, sha256Text } from "./crypto.js";
import { parseAuthJson } from "./auth-json.js";
import type { ParsedAuthJson } from "./auth-json.js";
import { nowSeconds } from "./time.js";
import { AppError, getErrorMessage } from "./errors.js";
import { resolveCodexBinary } from "./codex-binary.js";
import {
  activateFiveHourWindowFromAuthJson,
  readAccountFromAuthJson,
  readAccountFromCodexHome,
} from "./app-server.js";
import type { RateLimitSnapshot } from "./app-server.js";
import { openCodexApp, quitCodexAppIfRunning } from "./codex-app.js";
import type { CodexAppRestartView } from "./codex-app.js";
import { writeRuntimeLog } from "./runtime-log.js";

export interface ActivateAccountResult {
  account: AccountView;
  codexRestart: CodexAppRestartView;
}

interface ImportAuthJsonPayload {
  name?: string;
  authJson: string | Record<string, unknown>;
}

interface ImportBackupPayload {
  accounts: Array<{
    name?: string;
    authJson: string | Record<string, unknown>;
  }>;
}

interface AccountBackupPayload {
  app: "squirrel-switch";
  v: 1;
  exportedAt: string;
  accounts: Array<{
    name: string;
    authJson: Record<string, unknown>;
  }>;
}

interface ExportAccountBackupOptions {
  accountIds: string[];
}

interface ImportAccountBackupResult {
  imported: number;
  accounts: AccountView[];
}

type RefreshSource = "manual" | "scheduled";

export interface RefreshAllAccountsSummary {
  accounts: AccountView[];
  total: number;
  succeeded: number;
  failed: number;
}

export interface FiveHourActivationSummary {
  total: number;
  due: number;
  activated: number;
  skipped: number;
  failed: number;
}

const activeFiveHourActivations = new Set<string>();

export function listAccounts(): AccountView[] {
  const rows = db.prepare("SELECT * FROM accounts").all() as AccountRow[];
  return rows.map(mapAccount).sort(compareAccountsByPlanAndWeeklyReset);
}

export function getAccountRow(id: string): AccountRow {
  const row = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as AccountRow | undefined;
  if (!row) {
    throw new AppError("账号不存在", 404);
  }
  return row;
}

export async function importCurrentAccount(): Promise<AccountView> {
  const codexHome = getEffectiveCodexHome(defaultCodexHome());
  const path = authJsonPath(codexHome);
  if (!existsSync(path)) {
    throw new AppError(`未找到 ${path}`, 404);
  }
  return importAuthJson({ authJson: await readTextFile(path) });
}

export async function importAuthJson(payload: ImportAuthJsonPayload): Promise<AccountView> {
  const { normalized, parsed } = parseAuthJson(payload.authJson, payload.name);
  const authHash = sha256Text(normalized);
  const encrypted = await encryptText(normalized);
  const existingByHash = db.prepare("SELECT * FROM accounts WHERE auth_hash = ?").get(authHash) as
    | AccountRow
    | undefined;
  const existing =
    existingByHash ??
    ((parsed.accountId && parsed.email
      ? db
          .prepare("SELECT * FROM accounts WHERE account_id = ? AND email = ?")
          .get(parsed.accountId, parsed.email)
      : null) as AccountRow | undefined | null) ??
    ((parsed.email
      ? db.prepare("SELECT * FROM accounts WHERE email = ?").get(parsed.email)
      : null) as AccountRow | undefined | null);
  const now = nowSeconds();

  if (existing) {
    db.transaction(() => {
      db.prepare(
        `UPDATE accounts
         SET name = ?, email = ?, account_id = ?, workspace_id = ?, plan_type = ?,
             subscription_expires_at = COALESCE(?, subscription_expires_at),
             encrypted_auth_json = ?, auth_hash = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        payload.name?.trim() || existing.name,
        parsed.email,
        parsed.accountId,
        parsed.workspaceId,
        parsed.planType,
        parsed.subscriptionExpiresAt,
        encrypted,
        authHash,
        now,
        existing.id,
      );
      clearFailedUsageSnapshots(existing.id);
    })();
    const account = mapAccount(getAccountRow(existing.id));
    void writeRuntimeLog("info", "account", `更新账号 ${account.name}`);
    return account;
  }

  db.prepare(
    `INSERT INTO accounts (
      id, name, email, account_id, workspace_id, plan_type, encrypted_auth_json, auth_hash,
      subscription_expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    parsed.id,
    parsed.name,
    parsed.email,
    parsed.accountId,
    parsed.workspaceId,
    parsed.planType,
    encrypted,
    authHash,
    parsed.subscriptionExpiresAt,
    now,
    now,
  );
  const account = mapAccount(getAccountRow(parsed.id));
  void writeRuntimeLog("info", "account", `导入账号 ${account.name}`);
  return account;
}

export async function exportAccountBackup(
  options: ExportAccountBackupOptions,
): Promise<AccountBackupPayload> {
  const accountIds = [...new Set(options.accountIds.map((id) => id.trim()).filter(Boolean))];
  if (accountIds.length === 0) {
    throw new AppError("请选择要导出的账号");
  }
  const rows = accountIds.map((id) => getAccountRow(id));
  const accounts = await Promise.all(
    rows.map(async (row) => ({
      name: row.name,
      authJson: JSON.parse(await decryptText(row.encrypted_auth_json)) as Record<string, unknown>,
    })),
  );
  return {
    app: "squirrel-switch",
    v: 1,
    exportedAt: new Date().toISOString(),
    accounts,
  };
}

export async function importAccountBackup(
  payload: ImportBackupPayload,
): Promise<ImportAccountBackupResult> {
  for (const account of payload.accounts) {
    await importAuthJson({
      name: account.name,
      authJson: account.authJson,
    });
  }
  return {
    imported: payload.accounts.length,
    accounts: listAccounts(),
  };
}

export function updateAccount(id: string, name: string): AccountView {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new AppError("账号名不能为空");
  }
  db.prepare("UPDATE accounts SET name = ?, updated_at = ? WHERE id = ?").run(
    trimmed,
    nowSeconds(),
    id,
  );
  const account = mapAccount(getAccountRow(id));
  void writeRuntimeLog("info", "account", `重命名账号 ${account.name}`);
  return account;
}

export function deleteAccount(id: string): void {
  const row = getAccountRow(id);
  db.prepare("DELETE FROM accounts WHERE id = ?").run(row.id);
  if (getSetting("activeAccountId") === row.id) {
    setSetting("activeAccountId", "");
  }
  void writeRuntimeLog("warn", "account", `删除账号 ${row.name}`);
}

export async function activateAccount(id: string): Promise<ActivateAccountResult> {
  const targetId = getAccountRow(id).id;
  const codexHome = getEffectiveCodexHome(defaultCodexHome());
  const path = authJsonPath(codexHome);

  try {
    await refreshAccount(targetId);
  } catch (error) {
    throw new AppError(
      `账号刷新验证失败，已标记为不可用，未写入当前 auth.json：${getErrorMessage(error)}`,
      502,
    );
  }

  if (existsSync(path)) {
    await captureCurrentActiveAuth(path, codexHome);
  }

  const targetRow = getAccountRow(targetId);
  const authJson = await decryptText(targetRow.encrypted_auth_json);

  let codexRestart: CodexAppRestartView = { attempted: false, restarted: false, error: null };
  try {
    codexRestart = await applyAuthToDiskWithCodexRestart(path, authJson);
  } catch (error) {
    throw new AppError(`账号写入失败，未更新当前账号标记：${getErrorMessage(error)}`, 502);
  }

  const now = nowSeconds();
  db.transaction(() => {
    db.prepare("UPDATE accounts SET is_active = 0").run();
    db.prepare(
      "UPDATE accounts SET is_active = 1, last_activated_at = ?, updated_at = ? WHERE id = ?",
    ).run(now, now, targetId);
    setSetting("activeAccountId", targetId);
  })();

  const account = mapAccount(getAccountRow(targetId));
  void writeRuntimeLog("info", "account", `启用账号 ${account.name}`);
  return { account, codexRestart };
}

async function applyAuthToDiskWithCodexRestart(
  path: string,
  authJson: string,
): Promise<CodexAppRestartView> {
  const quit = await quitCodexAppIfRunning();
  await writeAuthJsonAtomic(path, authJson);

  if (!quit.wasRunning) {
    return { attempted: false, restarted: false, error: null };
  }
  if (!quit.stopped) {
    return { attempted: true, restarted: false, error: quit.error };
  }
  const open = await openCodexApp();
  return { attempted: true, restarted: open.opened, error: open.opened ? null : open.error };
}

export interface ActiveReloginMatch {
  accountId: string;
  accountName: string;
}

export function findActiveReloginMatch(authJson: string): ActiveReloginMatch | null {
  const activeRow = findActiveAccountRow();
  if (!activeRow) {
    return null;
  }
  const { normalized, parsed } = parseAuthJson(authJson);
  if (!authStronglyBelongsToAccount(parsed, normalized, activeRow)) {
    return null;
  }
  return {
    accountId: activeRow.id,
    accountName: activeRow.name,
  };
}

/**
 * 重新登录明确命中当前激活账号时,用最新登录态原子回写当前 auth.json,
 * 并在 Codex.app 运行时退出后重新打开,使磁盘与数据库保持一致。
 */
export async function syncReloggedActiveAccountToDisk(
  accountId: string,
): Promise<CodexAppRestartView> {
  if (getSetting("activeAccountId") !== accountId) {
    throw new AppError("重新登录账号不是当前激活账号，拒绝回写当前 auth.json", 409);
  }
  const row = getAccountRow(accountId);
  const codexHome = getEffectiveCodexHome(defaultCodexHome());
  const path = authJsonPath(codexHome);
  const authJson = await decryptText(row.encrypted_auth_json);
  const restart = await applyAuthToDiskWithCodexRestart(path, authJson);
  void writeRuntimeLog("info", "account", `重新登录命中当前账号 ${row.name}，已回写 auth.json`);
  return restart;
}

async function captureCurrentActiveAuth(path: string, codexHome: string): Promise<void> {
  try {
    const activeRow = findActiveAccountRow();
    if (!activeRow) {
      return;
    }

    const currentAuthJson = await readTextFile(path);
    const current = parseAuthJson(currentAuthJson);
    if (!authBelongsToAccount(current.parsed, current.normalized, activeRow)) {
      void writeRuntimeLog("warn", "account", "跳过回收当前登录态：auth.json 与已激活账号不匹配");
      return;
    }

    if (sha256Text(current.normalized) === activeRow.auth_hash) {
      return;
    }

    // 磁盘登录态与数据库不一致时,先校验磁盘态是否仍有效,
    // 避免用已吊销/失效的磁盘登录态覆盖数据库中更可信的记录。
    const codexBinary = await resolveCodexBinary(getSetting("codexBinaryPath"));
    if (!codexBinary) {
      void writeRuntimeLog("warn", "account", "跳过回收当前登录态：未找到 codex 命令");
      return;
    }

    let result;
    try {
      result = await readAccountFromCodexHome(codexBinary, codexHome);
    } catch (error) {
      void writeRuntimeLog(
        "warn",
        "account",
        `跳过回收当前登录态：磁盘登录态校验失败（${getErrorMessage(error)}）`,
      );
      return;
    }

    const parsed = parseAuthJson(result.updatedAuthJson);
    const authHash = sha256Text(parsed.normalized);
    if (authHash === activeRow.auth_hash) {
      return;
    }

    db.prepare(
      `UPDATE accounts
       SET email = COALESCE(?, email),
           account_id = COALESCE(?, account_id),
           workspace_id = COALESCE(?, workspace_id),
           plan_type = COALESCE(?, plan_type),
           subscription_expires_at = COALESCE(?, subscription_expires_at),
           encrypted_auth_json = ?,
           auth_hash = ?,
           updated_at = ?
       WHERE id = ?`,
    ).run(
      parsed.parsed.email,
      parsed.parsed.accountId,
      parsed.parsed.workspaceId,
      parsed.parsed.planType,
      parsed.parsed.subscriptionExpiresAt,
      await encryptText(parsed.normalized),
      authHash,
      nowSeconds(),
      activeRow.id,
    );
    void writeRuntimeLog("info", "account", `回收当前账号 ${activeRow.name} 的最新登录态`);
  } catch (error) {
    void writeRuntimeLog("warn", "account", `回收当前登录态失败：${getErrorMessage(error)}`);
  }
}

function findActiveAccountRow(): AccountRow | null {
  const activeAccountId = getSetting("activeAccountId");
  if (activeAccountId) {
    const row = db.prepare("SELECT * FROM accounts WHERE id = ?").get(activeAccountId) as
      | AccountRow
      | undefined;
    if (row) {
      return row;
    }
  }

  return (
    (db
      .prepare("SELECT * FROM accounts WHERE is_active = 1 ORDER BY last_activated_at DESC LIMIT 1")
      .get() as AccountRow | undefined) ?? null
  );
}

function authBelongsToAccount(
  parsed: ParsedAuthJson,
  normalized: string,
  row: AccountRow,
): boolean {
  return authStronglyBelongsToAccount(parsed, normalized, row);
}

function authStronglyBelongsToAccount(
  parsed: ParsedAuthJson,
  normalized: string,
  row: AccountRow,
): boolean {
  if (sha256Text(normalized) === row.auth_hash) {
    return true;
  }

  return Boolean(parsed.email && row.email && parsed.email === row.email);
}

export async function refreshAccount(id: string, source: RefreshSource = "manual"): Promise<AccountView> {
  const row = getAccountRow(id);
  const currentCodexHome = await findCurrentCodexHomeForAccount(row);
  try {
    if (currentCodexHome) {
      await refreshCurrentLoginAccount(id, row, currentCodexHome);
    } else {
      await refreshAccountFromAuth(id, await decryptText(row.encrypted_auth_json), {});
    }
  } catch (error) {
    const message = getErrorMessage(error);
    insertUsageSnapshot(id, null, "codex-app-server", true, message);
    void writeRuntimeLog("error", "refresh", `${refreshSourceLabel(source)} ${row.name} 刷新失败：${message}`);
    throw error;
  }
  const account = mapAccount(getAccountRow(id));
  if (account.usage?.error) {
    void writeRuntimeLog("warn", "refresh", `${refreshSourceLabel(source)} ${account.name} 账号信息已刷新，额度暂不可用`);
  } else {
    void writeRuntimeLog("info", "refresh", `${refreshSourceLabel(source)} ${account.name} 刷新成功`);
  }
  return account;
}

export async function refreshAllAccounts(source: RefreshSource = "manual"): Promise<AccountView[]> {
  return (await refreshAllAccountsWithSummary(source)).accounts;
}

export async function refreshAllAccountsWithSummary(
  source: RefreshSource = "manual",
): Promise<RefreshAllAccountsSummary> {
  const rows = db.prepare("SELECT id FROM accounts ORDER BY updated_at DESC").all() as Array<{
    id: string;
  }>;
  let succeeded = 0;
  let failed = 0;
  void writeRuntimeLog("info", "refresh", `${refreshSourceLabel(source)} 开始刷新全部账号：${rows.length} 个`);
  for (const row of rows) {
    try {
      await refreshAccount(row.id, source);
      succeeded += 1;
    } catch {
      // refreshAccount 已经写入失败快照，这里继续刷新后续账号。
      failed += 1;
    }
  }
  void writeRuntimeLog(
    failed > 0 ? "warn" : "info",
    "refresh",
    `${refreshSourceLabel(source)} 刷新全部完成：成功 ${succeeded} 个，失败 ${failed} 个`,
  );
  return {
    accounts: listAccounts(),
    total: rows.length,
    succeeded,
    failed,
  };
}

export async function activateDueFiveHourWindows(): Promise<FiveHourActivationSummary> {
  const rows = db.prepare("SELECT * FROM accounts ORDER BY updated_at DESC").all() as AccountRow[];
  const summary: FiveHourActivationSummary = {
    total: rows.length,
    due: 0,
    activated: 0,
    skipped: 0,
    failed: 0,
  };

  for (const row of rows) {
    if (!shouldActivateFiveHourWindow(row, nowSeconds())) {
      summary.skipped += 1;
      continue;
    }
    summary.due += 1;
    try {
      if (await activateFiveHourWindow(row)) {
        summary.activated += 1;
      } else {
        summary.skipped += 1;
      }
    } catch (error) {
      summary.failed += 1;
      void writeRuntimeLog(
        "warn",
        "five-hour-activation",
        `${row.name} 5 小时额度窗口激活失败：${getErrorMessage(error)}`,
      );
    }
  }

  return summary;
}

function refreshSourceLabel(source: RefreshSource): string {
  return source === "scheduled" ? "定时刷新" : "手动刷新";
}

async function findCurrentCodexHomeForAccount(row: AccountRow): Promise<string | null> {
  const codexHome = getEffectiveCodexHome(defaultCodexHome());
  const path = authJsonPath(codexHome);
  if (!existsSync(path)) {
    return null;
  }

  try {
    const currentAuthJson = await readTextFile(path);
    const parsed = parseAuthJson(currentAuthJson);
    return authBelongsToAccount(parsed.parsed, parsed.normalized, row) ? codexHome : null;
  } catch (error) {
    void writeRuntimeLog("warn", "refresh", `读取当前 Codex 登录态失败：${getErrorMessage(error)}`);
    return null;
  }
}

/**
 * 刷新当前登录(磁盘)账号:磁盘登录态优先;磁盘态失效时回退到数据库中保存的登录态,
 * 若数据库态有效则用它修复磁盘并重启 Codex;两者都失效时提示重新登录或稍后重试。
 */
async function refreshCurrentLoginAccount(
  id: string,
  row: AccountRow,
  codexHome: string,
): Promise<void> {
  try {
    await refreshAccountFromAuth(id, "", { codexHome });
    return;
  } catch (diskError) {
    void writeRuntimeLog(
      "warn",
      "refresh",
      `${row.name} 当前磁盘登录态不可用，改用已保存登录态重试：${getErrorMessage(diskError)}`,
    );
  }

  const dbAuth = await decryptText(row.encrypted_auth_json);
  let normalized: string;
  try {
    normalized = await refreshAccountFromAuth(id, dbAuth, {});
  } catch (dbError) {
    throw new AppError(
      `该账号登录态已失效，请重新登录或稍后重试（${getErrorMessage(dbError)}）`,
      502,
    );
  }

  // 数据库登录态有效但磁盘态失效:用有效登录态回写磁盘并重启 Codex,当场修复当前登录。
  try {
    const restart = await applyAuthToDiskWithCodexRestart(authJsonPath(codexHome), normalized);
    void writeRuntimeLog(
      "info",
      "refresh",
      `${row.name} 已用有效登录态修复磁盘 auth.json${
        restart.attempted ? (restart.restarted ? " 并重启 Codex" : "，Codex 需手动重启") : ""
      }`,
    );
  } catch (writeError) {
    void writeRuntimeLog(
      "warn",
      "refresh",
      `${row.name} 回写磁盘登录态失败：${getErrorMessage(writeError)}`,
    );
  }
}

async function refreshAccountFromAuth(
  id: string,
  authJson: string,
  options: { codexHome?: string } = {},
): Promise<string> {
  const codexBinary = await resolveCodexBinary(getSetting("codexBinaryPath"));
  if (!codexBinary) {
    throw new AppError("未找到 codex 命令或 Codex.app 内置 codex", 503);
  }

  const appServerResult = options.codexHome
    ? await readAccountFromCodexHome(codexBinary, options.codexHome)
    : await readAccountFromAuthJson(codexBinary, authJson);
  const currentAuthJson = appServerResult.updatedAuthJson;
  const parsed = parseAuthJson(currentAuthJson);
  const authHash = sha256Text(parsed.normalized);
  const encrypted = await encryptText(parsed.normalized);
  const selected = selectRateLimit(appServerResult.rateLimits);
  const planType =
    appServerResult.account?.account?.planType ??
    selected?.planType ??
    parsed.parsed.planType;
  const now = nowSeconds();

  db.transaction(() => {
    db.prepare(
      `UPDATE accounts
       SET email = COALESCE(?, email),
           account_id = COALESCE(?, account_id),
           workspace_id = COALESCE(?, workspace_id),
           plan_type = COALESCE(?, plan_type),
           subscription_expires_at = COALESCE(?, subscription_expires_at),
           subscription_error = NULL,
           encrypted_auth_json = ?,
           auth_hash = ?,
           last_refreshed_at = ?,
           updated_at = ?
       WHERE id = ?`,
    ).run(
      appServerResult.account?.account?.email ?? parsed.parsed.email,
      parsed.parsed.accountId,
      parsed.parsed.workspaceId,
      planType,
      parsed.parsed.subscriptionExpiresAt,
      encrypted,
      authHash,
      now,
      now,
      id,
    );
    if (appServerResult.rateLimits) {
      insertUsageSnapshot(id, selected, "codex-app-server", false, null, appServerResult.rateLimits);
      recordObservedFiveHourWindow(id, selected, now);
    } else {
      insertUsageSnapshot(
        id,
        null,
        "codex-app-server",
        true,
        appServerResult.rateLimitsError ?? "Codex 额度接口暂不可用",
        null,
      );
    }
  })();

  return parsed.normalized;
}

async function activateFiveHourWindow(row: AccountRow): Promise<boolean> {
  if (activeFiveHourActivations.has(row.id)) {
    void writeRuntimeLog("info", "five-hour-activation", `${row.name} 已有激活任务运行，跳过重复触发`);
    return false;
  }

  const codexBinary = await resolveCodexBinary(getSetting("codexBinaryPath"));
  if (!codexBinary) {
    throw new AppError("未找到 codex 命令或 Codex.app 内置 codex", 503);
  }

  activeFiveHourActivations.add(row.id);
  try {
    const authJson = await decryptText(getAccountRow(row.id).encrypted_auth_json);
    const result = await activateFiveHourWindowFromAuthJson(codexBinary, authJson);
    const parsed = parseAuthJson(result.updatedAuthJson);
    const authHash = sha256Text(parsed.normalized);
    const encrypted = await encryptText(parsed.normalized);
    const selected = selectRateLimit(result.rateLimits);
    const confirmedActivationUntil = confirmedFiveHourActivationUntil(
      selected,
      result.completedAt,
    );
    if (result.rateLimits && !confirmedActivationUntil) {
      throw new AppError("Codex 未确认 5 小时额度窗口已激活", 502);
    }
    const activationUntil =
      confirmedActivationUntil ?? result.completedAt + FIVE_HOUR_WINDOW_MINUTES * 60;
    const planType = selected?.planType ?? parsed.parsed.planType;
    const activationSource = result.rateLimits ? "scheduled-confirmed" : "scheduled-fallback";

    db.transaction(() => {
      db.prepare(
        `UPDATE accounts
         SET email = COALESCE(?, email),
             account_id = COALESCE(?, account_id),
             workspace_id = COALESCE(?, workspace_id),
             plan_type = COALESCE(?, plan_type),
             subscription_expires_at = COALESCE(?, subscription_expires_at),
             encrypted_auth_json = ?,
             auth_hash = ?,
             last_refreshed_at = ?,
             five_hour_activation_started_at = ?,
             five_hour_activation_until = ?,
             five_hour_activation_source = ?,
             five_hour_activation_error = NULL,
             updated_at = ?
         WHERE id = ?`,
      ).run(
        parsed.parsed.email,
        parsed.parsed.accountId,
        parsed.parsed.workspaceId,
        planType,
        parsed.parsed.subscriptionExpiresAt,
        encrypted,
        authHash,
        result.completedAt,
        result.completedAt,
        activationUntil,
        activationSource,
        result.completedAt,
        row.id,
      );
      if (result.rateLimits) {
        insertUsageSnapshot(row.id, selected, "codex-app-server", false, null, result.rateLimits);
      } else {
        insertUsageSnapshot(
          row.id,
          null,
          "codex-app-server",
          true,
          result.rateLimitsError ?? "5 小时窗口已激活，额度读取暂不可用",
          null,
        );
      }
    })();

    void writeRuntimeLog(
      "info",
      "five-hour-activation",
      `${row.name} 已激活 5 小时额度窗口，预计 ${formatActivationUntil(activationUntil)} 到期`,
    );
    return true;
  } catch (error) {
    const now = nowSeconds();
    db.prepare(
      `UPDATE accounts
       SET five_hour_activation_error = ?,
           updated_at = ?
       WHERE id = ?`,
    ).run(getErrorMessage(error), now, row.id);
    throw error;
  } finally {
    activeFiveHourActivations.delete(row.id);
  }
}

function shouldActivateFiveHourWindow(row: AccountRow, now: number): boolean {
  const activationUntil = row.five_hour_activation_until;
  if (!activationUntil || now >= activationUntil - 60) {
    return true;
  }
  if (row.five_hour_activation_source === "scheduled-fallback") {
    return false;
  }
  if (row.five_hour_activation_source === "scheduled-confirmed") {
    return false;
  }
  return !hasConfirmedActiveFiveHourUsage(row.id, now);
}

function hasConfirmedActiveFiveHourUsage(accountId: string, now: number): boolean {
  const rows = db
    .prepare(
      `SELECT primary_used_percent, primary_resets_at
       FROM account_usage_snapshots
       WHERE account_id = ?
         AND stale = 0
         AND primary_window_minutes = ?
       ORDER BY fetched_at DESC
       LIMIT 2`,
    )
    .all(accountId, FIVE_HOUR_WINDOW_MINUTES) as Array<{
      primary_used_percent: number | null;
      primary_resets_at: number | null;
    }>;
  const [latest, previous] = rows;
  return Boolean(
    latest?.primary_resets_at &&
      latest.primary_resets_at > now &&
      latest.primary_used_percent !== null &&
      latest.primary_used_percent > 0 &&
      previous?.primary_resets_at === latest.primary_resets_at &&
      previous.primary_used_percent !== null &&
      previous.primary_used_percent > 0,
  );
}

function confirmedFiveHourActivationUntil(
  snapshot: ReturnType<typeof selectRateLimit>,
  completedAt: number,
): number | null {
  const primary = snapshot?.primary;
  if (!primary?.resetsAt || primary.resetsAt <= completedAt || primary.usedPercent <= 0) {
    return null;
  }
  return primary.resetsAt;
}

function recordObservedFiveHourWindow(
  accountId: string,
  snapshot: RateLimitSnapshot | null,
  now: number,
): void {
  const primary = snapshot?.primary;
  if (!primary?.resetsAt || primary.resetsAt <= now || primary.usedPercent <= 0) {
    return;
  }
  if (!hasConfirmedActiveFiveHourUsage(accountId, now)) {
    return;
  }

  const row = getAccountRow(accountId);
  if (row.five_hour_activation_until && row.five_hour_activation_until >= primary.resetsAt) {
    return;
  }

  db.prepare(
    `UPDATE accounts
     SET five_hour_activation_started_at = COALESCE(five_hour_activation_started_at, ?),
         five_hour_activation_until = ?,
         five_hour_activation_source = ?,
         five_hour_activation_error = NULL,
         updated_at = ?
     WHERE id = ?`,
  ).run(now, primary.resetsAt, "external", now, accountId);
}

function formatActivationUntil(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value * 1000));
}

function selectRateLimit(
  response: { rateLimits: RateLimitSnapshot; rateLimitsByLimitId: unknown } | null,
) {
  if (!response) {
    return null;
  }
  const byLimit = response.rateLimitsByLimitId;
  if (byLimit && typeof byLimit === "object" && "codex" in byLimit) {
    return normalizeRateLimitSnapshot((byLimit as Record<string, RateLimitSnapshot>).codex);
  }
  return normalizeRateLimitSnapshot(response.rateLimits);
}

const FIVE_HOUR_WINDOW_MINUTES = 5 * 60;
const WEEKLY_WINDOW_MINUTES = 7 * 24 * 60;
const MONTHLY_WINDOW_MINUTES = 30 * 24 * 60;

function normalizeRateLimitSnapshot(snapshot: RateLimitSnapshot | null | undefined) {
  if (!snapshot) {
    return null;
  }

  const windows = [snapshot.primary, snapshot.secondary].filter((window) => window !== null);
  const primary = windows.find(
    (window) => window.windowDurationMins === FIVE_HOUR_WINDOW_MINUTES,
  );
  const secondary = windows.find((window) =>
    [WEEKLY_WINDOW_MINUTES, MONTHLY_WINDOW_MINUTES].includes(window.windowDurationMins ?? 0),
  );
  return {
    ...snapshot,
    primary: primary ?? null,
    secondary: secondary ?? null,
  };
}

function insertUsageSnapshot(
  accountId: string,
  snapshot: RateLimitSnapshot | null,
  source: string,
  stale: boolean,
  error: string | null,
  raw: unknown = snapshot,
): void {
  db.prepare(
    `INSERT INTO account_usage_snapshots (
      id, account_id, source, primary_used_percent, primary_window_minutes, primary_resets_at,
      secondary_used_percent, secondary_window_minutes, secondary_resets_at, raw_json, stale,
      error, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    accountId,
    source,
    snapshot?.primary?.usedPercent ?? null,
    snapshot?.primary?.windowDurationMins ?? null,
    snapshot?.primary?.resetsAt ?? null,
    snapshot?.secondary?.usedPercent ?? null,
    snapshot?.secondary?.windowDurationMins ?? null,
    snapshot?.secondary?.resetsAt ?? null,
    JSON.stringify(raw ?? null),
    stale ? 1 : 0,
    error,
    nowSeconds(),
  );
}

function clearFailedUsageSnapshots(accountId: string): void {
  db.prepare("DELETE FROM account_usage_snapshots WHERE account_id = ? AND stale = 1").run(
    accountId,
  );
}

function compareAccountsByPlanAndWeeklyReset(a: AccountView, b: AccountView): number {
  const planDelta = planSortRank(a) - planSortRank(b);
  if (planDelta !== 0) {
    return planDelta;
  }

  const aReset = a.usage?.secondary?.resetsAt ?? Number.MAX_SAFE_INTEGER;
  const bReset = b.usage?.secondary?.resetsAt ?? Number.MAX_SAFE_INTEGER;
  if (aReset !== bReset) {
    return aReset - bReset;
  }
  return a.name.localeCompare(b.name, "zh-CN");
}

function planSortRank(account: AccountView): number {
  const plan = (account.planType || account.subscriptionPlan || "").toLowerCase();
  if (plan === "pro") return 0;
  if (plan === "plus") return 1;
  if (plan === "free") return 2;
  return 3;
}
