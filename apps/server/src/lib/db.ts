import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { databasePath, ensureAppDataDirSync, legacyDatabasePath } from "./paths.js";
import { nowSeconds } from "./time.js";

interface RateLimitWindowView {
  usedPercent: number | null;
  remainingPercent: number | null;
  windowMinutes: number | null;
  resetsAt: number | null;
}

const FIVE_HOUR_WINDOW_MINUTES = 5 * 60;
const WEEKLY_WINDOW_MINUTES = 7 * 24 * 60;
const MONTHLY_WINDOW_MINUTES = 30 * 24 * 60;

export interface UsageSnapshotView {
  id: string;
  source: string;
  primary: RateLimitWindowView | null;
  secondary: RateLimitWindowView | null;
  resetAvailableCount: number | null;
  rawJson: unknown;
  stale: boolean;
  error: string | null;
  fetchedAt: number;
}

export interface AccountView {
  id: string;
  name: string;
  email: string | null;
  accountId: string | null;
  workspaceId: string | null;
  planType: string | null;
  subscriptionPlan: string | null;
  subscriptionExpiresAt: number | null;
  subscriptionRenewsAt: number | null;
  subscriptionError: string | null;
  isActive: boolean;
  lastActivatedAt: number | null;
  lastRefreshedAt: number | null;
  fiveHourActivationStartedAt: number | null;
  fiveHourActivationUntil: number | null;
  fiveHourActivationSource: string | null;
  fiveHourActivationError: string | null;
  createdAt: number;
  updatedAt: number;
  usage: UsageSnapshotView | null;
}

export interface AccountRow {
  id: string;
  name: string;
  email: string | null;
  account_id: string | null;
  workspace_id: string | null;
  plan_type: string | null;
  subscription_plan: string | null;
  subscription_expires_at: number | null;
  subscription_renews_at: number | null;
  subscription_error: string | null;
  encrypted_auth_json: Buffer;
  auth_hash: string;
  is_active: 0 | 1;
  last_activated_at: number | null;
  last_refreshed_at: number | null;
  five_hour_activation_started_at: number | null;
  five_hour_activation_until: number | null;
  five_hour_activation_source: string | null;
  five_hour_activation_error: string | null;
  created_at: number;
  updated_at: number;
}

export interface UsageSnapshotRow {
  id: string;
  account_id: string;
  source: string;
  primary_used_percent: number | null;
  primary_window_minutes: number | null;
  primary_resets_at: number | null;
  secondary_used_percent: number | null;
  secondary_window_minutes: number | null;
  secondary_resets_at: number | null;
  raw_json: string | null;
  stale: 0 | 1;
  error: string | null;
  fetched_at: number;
}

export interface ChatGptProfileRow {
  id: string;
  display_name: string;
  linked_codex_account_id: string | null;
  browser_kind: string | null;
  browser_executable_path: string | null;
  browser_profile_dir: string | null;
  session_hash: string | null;
  account_email: string | null;
  account_name: string | null;
  account_id: string | null;
  plan_type: string | null;
  plan_label: string | null;
  subscription_expires_at: number | null;
  subscription_renews_at: number | null;
  session_status: string | null;
  last_checked_at: number | null;
  last_check_error: string | null;
  last_opened_at: number | null;
  last_exported_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface ChatGptProfileView {
  id: string;
  displayName: string;
  linkedCodexAccountId: string | null;
  linkedCodexAccountName: string | null;
  linkedCodexEmail: string | null;
  browserKind: "chrome" | "edge" | "custom" | null;
  browserExecutablePath: string | null;
  browserProfileDir: string | null;
  sessionHash: string | null;
  accountEmail: string | null;
  accountName: string | null;
  accountId: string | null;
  planType: string | null;
  planLabel: string | null;
  subscriptionExpiresAt: number | null;
  subscriptionRenewsAt: number | null;
  sessionStatus: "unchecked" | "available" | "invalid" | "reauth_required";
  lastCheckedAt: number | null;
  lastCheckError: string | null;
  lastOpenedAt: number | null;
  lastExportedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ChatGptProfileJoinedRow extends ChatGptProfileRow {
  linked_codex_account_name: string | null;
  linked_codex_email: string | null;
}

ensureAppDataDirSync();

export const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      account_id TEXT,
      workspace_id TEXT,
      plan_type TEXT,
      subscription_plan TEXT,
      subscription_expires_at INTEGER,
      subscription_renews_at INTEGER,
      subscription_error TEXT,
      encrypted_auth_json BLOB NOT NULL,
      auth_hash TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 0,
      last_activated_at INTEGER,
      last_refreshed_at INTEGER,
      five_hour_activation_started_at INTEGER,
      five_hour_activation_until INTEGER,
      five_hour_activation_source TEXT,
      five_hour_activation_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS account_usage_snapshots (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      source TEXT NOT NULL,
      primary_used_percent REAL,
      primary_window_minutes INTEGER,
      primary_resets_at INTEGER,
      secondary_used_percent REAL,
      secondary_window_minutes INTEGER,
      secondary_resets_at INTEGER,
      raw_json TEXT,
      stale INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      fetched_at INTEGER NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS platform_profiles (
      id TEXT PRIMARY KEY,
      platform_id TEXT NOT NULL,
      name TEXT NOT NULL,
      provider_id TEXT,
      is_active INTEGER NOT NULL DEFAULT 0,
      last_applied_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS claude_code_profiles (
      profile_id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      base_url TEXT NOT NULL DEFAULT '',
      main_model TEXT NOT NULL DEFAULT '',
      opus_model TEXT NOT NULL DEFAULT '',
      sonnet_model TEXT NOT NULL DEFAULT '',
      haiku_model TEXT NOT NULL DEFAULT '',
      subagent_model TEXT NOT NULL DEFAULT '',
      auth_header TEXT NOT NULL,
      encrypted_api_key BLOB,
      custom_headers_json TEXT NOT NULL DEFAULT '',
      disable_nonessential_traffic INTEGER NOT NULL DEFAULT 1,
      api_key_helper_ttl_ms INTEGER,
      FOREIGN KEY (profile_id) REFERENCES platform_profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS claude_code_config_applications (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_path TEXT NOT NULL,
      previous_snapshot_encrypted BLOB,
      previous_snapshot_hash TEXT,
      applied_snapshot_hash TEXT,
      applied_patch_json TEXT NOT NULL,
      applied_at INTEGER NOT NULL,
      reverted_at INTEGER,
      error TEXT,
      FOREIGN KEY (profile_id) REFERENCES platform_profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chatgpt_profiles (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      linked_codex_account_id TEXT,
      browser_kind TEXT,
      browser_executable_path TEXT,
      browser_profile_dir TEXT,
      session_hash TEXT,
      account_email TEXT,
      account_name TEXT,
      account_id TEXT,
      plan_type TEXT,
      plan_label TEXT,
      subscription_expires_at INTEGER,
      subscription_renews_at INTEGER,
      session_status TEXT NOT NULL DEFAULT 'unchecked',
      last_checked_at INTEGER,
      last_check_error TEXT,
      last_opened_at INTEGER,
      last_exported_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (linked_codex_account_id) REFERENCES accounts(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS chatgpt_app_configs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      official_app_url TEXT,
      official_app_id TEXT,
      mcp_server_url TEXT,
      auth_type TEXT NOT NULL,
      auth_note TEXT,
      scope_type TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      config_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chatgpt_app_config_profiles (
      config_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (config_id, profile_id),
      FOREIGN KEY (config_id) REFERENCES chatgpt_app_configs(id) ON DELETE CASCADE,
      FOREIGN KEY (profile_id) REFERENCES chatgpt_profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chatgpt_app_config_sync_states (
      config_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      status TEXT NOT NULL,
      config_hash TEXT,
      last_synced_at INTEGER,
      last_checked_at INTEGER,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (config_id, profile_id),
      FOREIGN KEY (config_id) REFERENCES chatgpt_app_configs(id) ON DELETE CASCADE,
      FOREIGN KEY (profile_id) REFERENCES chatgpt_profiles(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chatgpt_app_config_sync_profile
      ON chatgpt_app_config_sync_states(profile_id);
  `);

  setSettingIfMissing("codexHome", process.env.CODEX_HOME || "");
  setSettingIfMissing("refreshIntervalSeconds", "600");
  setSettingIfMissing("scheduledRefreshEnabled", "false");
  setSettingIfMissing("scheduledRefreshIntervalMinutes", "60");
  setSettingIfMissing("scheduledRefreshStartTime", "07:00");
  setSettingIfMissing("scheduledRefreshEndTime", "19:00");
  setSettingIfMissing("scheduledRefreshActivateFiveHourWindow", "false");
  ensureColumn("accounts", "subscription_error", "TEXT");
  ensureColumn("accounts", "five_hour_activation_started_at", "INTEGER");
  ensureColumn("accounts", "five_hour_activation_until", "INTEGER");
  ensureColumn("accounts", "five_hour_activation_source", "TEXT");
  ensureColumn("accounts", "five_hour_activation_error", "TEXT");
  ensureColumn("claude_code_config_applications", "applied_snapshot_hash", "TEXT");
  ensureColumn("chatgpt_profiles", "account_email", "TEXT");
  ensureColumn("chatgpt_profiles", "browser_kind", "TEXT");
  ensureColumn("chatgpt_profiles", "browser_executable_path", "TEXT");
  ensureColumn("chatgpt_profiles", "browser_profile_dir", "TEXT");
  ensureColumn("chatgpt_profiles", "account_name", "TEXT");
  ensureColumn("chatgpt_profiles", "account_id", "TEXT");
  ensureColumn("chatgpt_profiles", "plan_type", "TEXT");
  ensureColumn("chatgpt_profiles", "plan_label", "TEXT");
  ensureColumn("chatgpt_profiles", "subscription_expires_at", "INTEGER");
  ensureColumn("chatgpt_profiles", "subscription_renews_at", "INTEGER");
  ensureColumn("chatgpt_profiles", "session_status", "TEXT NOT NULL DEFAULT 'unchecked'");
  ensureColumn("chatgpt_profiles", "last_checked_at", "INTEGER");
  ensureColumn("chatgpt_profiles", "last_check_error", "TEXT");
  db.prepare("UPDATE chatgpt_profiles SET session_status = 'unchecked' WHERE session_status IS NULL OR session_status = ''").run();
  migrateChatGptProfilesWithoutElectronColumns();
  mergeLegacyDatabase();
  cleanupDuplicateAccountIds();
  normalizeActiveAccount();
}

function ensureColumn(table: string, column: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!rows.some((row) => row.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrateChatGptProfilesWithoutElectronColumns(): void {
  const columns = tableColumns("chatgpt_profiles");
  if (
    !columns.has("partition_name") &&
    !columns.has("storage_kind") &&
    !columns.has("legacy_partition_name")
  ) {
    return;
  }

  const selectColumns = [
    "id",
    "display_name",
    "linked_codex_account_id",
    columnExpression(columns, "browser_kind", "NULL"),
    columnExpression(columns, "browser_executable_path", "NULL"),
    columnExpression(columns, "browser_profile_dir", "NULL"),
    columnExpression(columns, "session_hash", "NULL"),
    columnExpression(columns, "account_email", "NULL"),
    columnExpression(columns, "account_name", "NULL"),
    columnExpression(columns, "account_id", "NULL"),
    columnExpression(columns, "plan_type", "NULL"),
    columnExpression(columns, "plan_label", "NULL"),
    columnExpression(columns, "subscription_expires_at", "NULL"),
    columnExpression(columns, "subscription_renews_at", "NULL"),
    "COALESCE(NULLIF(session_status, ''), 'unchecked') AS session_status",
    columnExpression(columns, "last_checked_at", "NULL"),
    columnExpression(columns, "last_check_error", "NULL"),
    columnExpression(columns, "last_opened_at", "NULL"),
    columnExpression(columns, "last_exported_at", "NULL"),
    "created_at",
    "updated_at",
  ];

  db.transaction(() => {
    db.exec("DROP TABLE IF EXISTS chatgpt_profiles_next");
    db.exec(`
      CREATE TABLE chatgpt_profiles_next (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        linked_codex_account_id TEXT,
        browser_kind TEXT,
        browser_executable_path TEXT,
        browser_profile_dir TEXT,
        session_hash TEXT,
        account_email TEXT,
        account_name TEXT,
        account_id TEXT,
        plan_type TEXT,
        plan_label TEXT,
        subscription_expires_at INTEGER,
        subscription_renews_at INTEGER,
        session_status TEXT NOT NULL DEFAULT 'unchecked',
        last_checked_at INTEGER,
        last_check_error TEXT,
        last_opened_at INTEGER,
        last_exported_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (linked_codex_account_id) REFERENCES accounts(id) ON DELETE SET NULL
      );

      INSERT INTO chatgpt_profiles_next (
        id, display_name, linked_codex_account_id, browser_kind, browser_executable_path,
        browser_profile_dir, session_hash, account_email, account_name, account_id,
        plan_type, plan_label, subscription_expires_at, subscription_renews_at,
        session_status, last_checked_at, last_check_error, last_opened_at,
        last_exported_at, created_at, updated_at
      )
      SELECT ${selectColumns.join(", ")}
      FROM chatgpt_profiles;

      DROP TABLE chatgpt_profiles;
      ALTER TABLE chatgpt_profiles_next RENAME TO chatgpt_profiles;
    `);
  })();
}

function tableColumns(table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function columnExpression(columns: Set<string>, column: string, fallback: string): string {
  return columns.has(column) ? column : `${fallback} AS ${column}`;
}

function cleanupDuplicateAccountIds(): void {
  const duplicates = db
    .prepare(
      `SELECT account_id
       FROM accounts
       WHERE account_id IS NOT NULL AND account_id != ''
       GROUP BY account_id
       HAVING COUNT(*) > 1`,
    )
    .all() as Array<{ account_id: string }>;

  for (const duplicate of duplicates) {
    const rows = db
      .prepare(
        `SELECT id
         FROM accounts
         WHERE account_id = ?
         ORDER BY is_active DESC,
                  last_refreshed_at IS NULL ASC,
                  last_refreshed_at DESC,
                  updated_at DESC`,
      )
      .all(duplicate.account_id) as Array<{ id: string }>;
    for (const row of rows.slice(1)) {
      db.prepare("DELETE FROM accounts WHERE id = ?").run(row.id);
    }
  }
}

function mergeLegacyDatabase(): void {
  if (!existsSync(legacyDatabasePath)) {
    return;
  }

  if (getSetting("legacyDatabaseMergedAt")) {
    return;
  }

  try {
    db.prepare("ATTACH DATABASE ? AS legacy").run(legacyDatabasePath);
  } catch {
    return;
  }

  try {
    if (!legacyTableExists("accounts")) {
      markLegacyDatabaseMerged();
      return;
    }

    const legacyAccountColumns = legacyTableColumns("accounts");
    const legacyAccounts = db
      .prepare(
        `SELECT
           id,
           name,
           email,
           account_id,
           workspace_id,
           plan_type,
           ${legacyColumnExpression(legacyAccountColumns, "subscription_plan", "NULL")},
           subscription_expires_at,
           ${legacyColumnExpression(legacyAccountColumns, "subscription_renews_at", "NULL")},
           ${legacyColumnExpression(legacyAccountColumns, "subscription_error", "NULL")},
           encrypted_auth_json,
           auth_hash,
           is_active,
           last_activated_at,
           last_refreshed_at,
           ${legacyColumnExpression(legacyAccountColumns, "five_hour_activation_started_at", "NULL")},
           ${legacyColumnExpression(legacyAccountColumns, "five_hour_activation_until", "NULL")},
           ${legacyColumnExpression(legacyAccountColumns, "five_hour_activation_source", "NULL")},
           ${legacyColumnExpression(legacyAccountColumns, "five_hour_activation_error", "NULL")},
           created_at,
           updated_at
         FROM legacy.accounts`,
      )
      .all() as AccountRow[];

    if (legacyAccounts.length === 0) {
      markLegacyDatabaseMerged();
      return;
    }

    if (hasAlreadyMergedLegacyAccount(legacyAccounts)) {
      markLegacyDatabaseMerged();
      return;
    }

    const accountIdMap = new Map<string, string>();
    const findAccount = db.prepare(
      `SELECT id
       FROM accounts
       WHERE id = @id
          OR auth_hash = @authHash
          OR (@accountId IS NOT NULL AND @accountId != '' AND account_id = @accountId)
          OR (@email IS NOT NULL AND @email != '' AND email = @email)
       ORDER BY updated_at DESC
       LIMIT 1`,
    );
    const insertAccount = db.prepare(
      `INSERT INTO accounts (
         id, name, email, account_id, workspace_id, plan_type, subscription_plan,
         subscription_expires_at, subscription_renews_at, subscription_error, encrypted_auth_json,
         auth_hash, is_active, last_activated_at, last_refreshed_at,
         five_hour_activation_started_at, five_hour_activation_until, five_hour_activation_source,
         five_hour_activation_error, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const updateAccountMetadata = db.prepare(
      `UPDATE accounts
       SET email = COALESCE(email, ?),
           account_id = COALESCE(account_id, ?),
           workspace_id = COALESCE(workspace_id, ?),
           plan_type = COALESCE(plan_type, ?),
           subscription_plan = COALESCE(subscription_plan, ?),
           subscription_expires_at = COALESCE(subscription_expires_at, ?),
           subscription_renews_at = COALESCE(subscription_renews_at, ?),
           subscription_error = COALESCE(subscription_error, ?),
           five_hour_activation_started_at = COALESCE(five_hour_activation_started_at, ?),
           five_hour_activation_until = COALESCE(five_hour_activation_until, ?),
           five_hour_activation_source = COALESCE(five_hour_activation_source, ?),
           five_hour_activation_error = COALESCE(five_hour_activation_error, ?)
       WHERE id = ?`,
    );

    db.transaction(() => {
      for (const account of legacyAccounts) {
        const matched = findAccount.get({
          id: account.id,
          authHash: account.auth_hash,
          accountId: account.account_id,
          email: account.email,
        }) as { id: string } | undefined;

        if (matched) {
          accountIdMap.set(account.id, matched.id);
          updateAccountMetadata.run(
            account.email,
            account.account_id,
            account.workspace_id,
            account.plan_type,
            account.subscription_plan,
            account.subscription_expires_at,
            account.subscription_renews_at,
            account.subscription_error,
            account.five_hour_activation_started_at,
            account.five_hour_activation_until,
            account.five_hour_activation_source,
            account.five_hour_activation_error,
            matched.id,
          );
          continue;
        }

        insertAccount.run(
          account.id,
          account.name,
          account.email,
          account.account_id,
          account.workspace_id,
          account.plan_type,
          account.subscription_plan,
          account.subscription_expires_at,
          account.subscription_renews_at,
          account.subscription_error,
          account.encrypted_auth_json,
          account.auth_hash,
          account.is_active,
          account.last_activated_at,
          account.last_refreshed_at,
          account.five_hour_activation_started_at,
          account.five_hour_activation_until,
          account.five_hour_activation_source,
          account.five_hour_activation_error,
          account.created_at,
          account.updated_at,
        );
        accountIdMap.set(account.id, account.id);
      }

      mergeLegacyUsageSnapshots(accountIdMap);
    })();
    markLegacyDatabaseMerged();
  } finally {
    db.prepare("DETACH DATABASE legacy").run();
  }
}

function hasAlreadyMergedLegacyAccount(legacyAccounts: AccountRow[]): boolean {
  const findAccount = db.prepare(
    `SELECT id
     FROM accounts
     WHERE id = @id
        OR auth_hash = @authHash
        OR (@accountId IS NOT NULL AND @accountId != '' AND account_id = @accountId)
        OR (@email IS NOT NULL AND @email != '' AND email = @email)
     LIMIT 1`,
  );

  return legacyAccounts.some((account) =>
    Boolean(
      findAccount.get({
        id: account.id,
        authHash: account.auth_hash,
        accountId: account.account_id,
        email: account.email,
      }),
    ),
  );
}

function markLegacyDatabaseMerged(): void {
  setSetting("legacyDatabaseMergedAt", String(nowSeconds()));
}

function mergeLegacyUsageSnapshots(accountIdMap: Map<string, string>): void {
  if (!legacyTableExists("account_usage_snapshots")) {
    return;
  }

  const snapshots = db
    .prepare("SELECT * FROM legacy.account_usage_snapshots")
    .all() as UsageSnapshotRow[];
  const insertSnapshot = db.prepare(
    `INSERT OR IGNORE INTO account_usage_snapshots (
       id, account_id, source, primary_used_percent, primary_window_minutes, primary_resets_at,
       secondary_used_percent, secondary_window_minutes, secondary_resets_at, raw_json, stale,
       error, fetched_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const snapshot of snapshots) {
    const targetAccountId = accountIdMap.get(snapshot.account_id);
    if (!targetAccountId) {
      continue;
    }

    insertSnapshot.run(
      snapshot.id,
      targetAccountId,
      snapshot.source,
      snapshot.primary_used_percent,
      snapshot.primary_window_minutes,
      snapshot.primary_resets_at,
      snapshot.secondary_used_percent,
      snapshot.secondary_window_minutes,
      snapshot.secondary_resets_at,
      snapshot.raw_json,
      snapshot.stale,
      snapshot.error,
      snapshot.fetched_at,
    );
  }
}

function legacyTableExists(table: string): boolean {
  const row = db
    .prepare("SELECT name FROM legacy.sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name: string } | undefined;
  return Boolean(row);
}

function legacyTableColumns(table: string): Set<string> {
  const rows = db.prepare(`PRAGMA legacy.table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function legacyColumnExpression(columns: Set<string>, column: string, fallback: string): string {
  return columns.has(column) ? column : `${fallback} AS ${column}`;
}

export function setSettingIfMissing(key: string, value: string): void {
  db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)").run(key, value);
}

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    "INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

function normalizeActiveAccount(): void {
  const activeAccountId = getSetting("activeAccountId");
  const activeBySetting = activeAccountId
    ? (db.prepare("SELECT id FROM accounts WHERE id = ?").get(activeAccountId) as
        | { id: string }
        | undefined)
    : null;
  const active =
    activeBySetting ??
    ((db
      .prepare(
        `SELECT id
         FROM accounts
         WHERE is_active = 1
         ORDER BY last_activated_at DESC, updated_at DESC
         LIMIT 1`,
      )
      .get() as { id: string } | undefined) ??
      null);

  db.transaction(() => {
    db.prepare("UPDATE accounts SET is_active = 0").run();
    if (active) {
      db.prepare("UPDATE accounts SET is_active = 1 WHERE id = ?").run(active.id);
      setSetting("activeAccountId", active.id);
    } else {
      setSetting("activeAccountId", "");
    }
  })();
}

export function getEffectiveCodexHome(defaultValue: string): string {
  const configured = getSetting("codexHome");
  return configured && configured.length > 0 ? configured : defaultValue;
}

export function latestUsageForAccount(accountId: string): UsageSnapshotRow | null {
  return (
    (db
      .prepare(
        "SELECT * FROM account_usage_snapshots WHERE account_id = ? ORDER BY fetched_at DESC LIMIT 1",
      )
      .get(accountId) as UsageSnapshotRow | undefined) ?? null
  );
}

export function mapUsage(row: UsageSnapshotRow | null): UsageSnapshotView | null {
  if (!row) {
    return null;
  }

  const rawJson = parseRawJson(row.raw_json);
  const stored = normalizeUsageWindows(
    mapWindow(row.primary_used_percent, row.primary_window_minutes, row.primary_resets_at),
    mapWindow(row.secondary_used_percent, row.secondary_window_minutes, row.secondary_resets_at),
  );
  const raw = normalizeUsageWindowsFromRawJson(rawJson);
  const normalized = {
    primary: stored.primary ?? raw.primary,
    secondary: stored.secondary ?? raw.secondary,
  };

  return {
    id: row.id,
    source: row.source,
    primary: normalized.primary,
    secondary: normalized.secondary,
    resetAvailableCount: resetAvailableCountFromRawJson(rawJson),
    rawJson,
    stale: row.stale === 1,
    error: row.error,
    fetchedAt: row.fetched_at,
  };
}

function mapWindow(
  usedPercent: number | null,
  windowMinutes: number | null,
  resetsAt: number | null,
): RateLimitWindowView | null {
  if (usedPercent === null) {
    return null;
  }

  return {
    usedPercent,
    remainingPercent: Math.max(0, 100 - usedPercent),
    windowMinutes,
    resetsAt,
  };
}

function normalizeUsageWindows(
  primary: RateLimitWindowView | null,
  secondary: RateLimitWindowView | null,
) {
  const windows = [primary, secondary].filter((window) => window !== null);
  return {
    primary: windows.find((window) => window.windowMinutes === FIVE_HOUR_WINDOW_MINUTES) ?? null,
    secondary:
      windows.find((window) =>
        [WEEKLY_WINDOW_MINUTES, MONTHLY_WINDOW_MINUTES].includes(window.windowMinutes ?? 0),
      ) ?? null,
  };
}

function normalizeUsageWindowsFromRawJson(rawJson: unknown) {
  const snapshot = selectRawRateLimitSnapshot(rawJson);
  return normalizeUsageWindows(
    mapRawWindow(snapshot?.primary),
    mapRawWindow(snapshot?.secondary),
  );
}

function resetAvailableCountFromRawJson(rawJson: unknown): number | null {
  if (!isRecord(rawJson) || !isRecord(rawJson.rateLimitResetCredits)) {
    return null;
  }
  const count = rawJson.rateLimitResetCredits.availableCount;
  return typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : null;
}

function selectRawRateLimitSnapshot(rawJson: unknown): Record<string, unknown> | null {
  if (!isRecord(rawJson)) {
    return null;
  }

  const byLimit = rawJson.rateLimitsByLimitId;
  if (isRecord(byLimit) && isRecord(byLimit.codex)) {
    return byLimit.codex;
  }
  return isRecord(rawJson.rateLimits) ? rawJson.rateLimits : null;
}

function mapRawWindow(value: unknown): RateLimitWindowView | null {
  if (!isRecord(value) || typeof value.usedPercent !== "number") {
    return null;
  }

  return mapWindow(
    value.usedPercent,
    typeof value.windowDurationMins === "number" ? value.windowDurationMins : null,
    typeof value.resetsAt === "number" ? value.resetsAt : null,
  );
}

function parseRawJson(value: string | null): unknown {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function mapAccount(row: AccountRow): AccountView {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    accountId: row.account_id,
    workspaceId: row.workspace_id,
    planType: row.plan_type,
    subscriptionPlan: row.subscription_plan,
    subscriptionExpiresAt: row.subscription_expires_at,
    subscriptionRenewsAt: row.subscription_renews_at,
    subscriptionError: row.subscription_error,
    isActive: row.is_active === 1,
    lastActivatedAt: row.last_activated_at,
    lastRefreshedAt: row.last_refreshed_at,
    fiveHourActivationStartedAt: row.five_hour_activation_started_at,
    fiveHourActivationUntil: row.five_hour_activation_until,
    fiveHourActivationSource: row.five_hour_activation_source,
    fiveHourActivationError: row.five_hour_activation_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    usage: mapUsage(latestUsageForAccount(row.id)),
  };
}

export function mapChatGptProfile(row: ChatGptProfileJoinedRow): ChatGptProfileView {
  return {
    id: row.id,
    displayName: row.display_name,
    linkedCodexAccountId: row.linked_codex_account_id,
    linkedCodexAccountName: row.linked_codex_account_name,
    linkedCodexEmail: row.linked_codex_email,
    browserKind: normalizeChatGptBrowserKind(row.browser_kind),
    browserExecutablePath: row.browser_executable_path,
    browserProfileDir: row.browser_profile_dir,
    sessionHash: row.session_hash,
    accountEmail: row.account_email,
    accountName: row.account_name,
    accountId: row.account_id,
    planType: row.plan_type,
    planLabel: row.plan_label,
    subscriptionExpiresAt: row.subscription_expires_at,
    subscriptionRenewsAt: row.subscription_renews_at,
    sessionStatus: normalizeChatGptSessionStatus(row.session_status),
    lastCheckedAt: row.last_checked_at,
    lastCheckError: row.last_check_error,
    lastOpenedAt: row.last_opened_at,
    lastExportedAt: row.last_exported_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeChatGptSessionStatus(
  value: string | null,
): ChatGptProfileView["sessionStatus"] {
  if (value === "available" || value === "invalid" || value === "reauth_required") {
    return value;
  }
  return "unchecked";
}

function normalizeChatGptBrowserKind(
  value: string | null,
): ChatGptProfileView["browserKind"] {
  if (value === "chrome" || value === "edge" || value === "custom") {
    return value;
  }
  return null;
}

export function touchAccount(id: string): void {
  db.prepare("UPDATE accounts SET updated_at = ? WHERE id = ?").run(nowSeconds(), id);
}
