import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Link2,
  LogIn,
  MessageSquare,
  Pencil,
  RefreshCcw,
  Trash2,
  Upload,
} from "lucide-react";
import type {
  AccountView,
  ChatGptAccountStatusResult,
  ChatGptDesktopProfileInput,
  ChatGptProfileView,
  LoginSessionView,
} from "@squirrel-switch/shared";
import { api } from "./api.js";
import { useI18n } from "./i18n.js";
import type { AppLocale } from "./i18n.js";
import "./chatgpt.css";

type Busy = string | null;
export type ChatGptTab = "current" | "add" | "backup";

const AUTO_STATUS_REFRESH_INTERVAL_MS = 8_000;
const AUTO_STATUS_REFRESH_MAX_ATTEMPTS = 38;
const MANUAL_STATUS_CHECK_MAX_ATTEMPTS = 3;
const MANUAL_STATUS_CHECK_RETRY_DELAY_MS = 1_200;
const AUTO_STATUS_REFRESH_DELAYS_MS = Array.from(
  { length: AUTO_STATUS_REFRESH_MAX_ATTEMPTS },
  (_, index) => (index + 1) * AUTO_STATUS_REFRESH_INTERVAL_MS,
);

interface CheckProfileStatusOptions {
  persistUnavailable?: boolean;
  closeAfterCheck?: boolean;
}

interface ChatGptViewProps {
  activeTab: ChatGptTab;
  accounts: AccountView[];
  autoStartComboNonce: number | null;
  preselectedAccountId: string | null;
  onAutoStartComboConsumed: () => void;
  onPreselectedAccountConsumed: () => void;
  onAccountsChanged?: () => void;
  onProfilesChanged?: (profiles: ChatGptProfileView[]) => void;
}

export function ChatGptView({
  activeTab,
  accounts,
  autoStartComboNonce,
  preselectedAccountId,
  onAutoStartComboConsumed,
  onPreselectedAccountConsumed,
  onAccountsChanged,
  onProfilesChanged,
}: ChatGptViewProps) {
  const { t, locale } = useI18n();
  const [profiles, setProfiles] = useState<ChatGptProfileView[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [backupPassword, setBackupPassword] = useState("");
  const [importPassword, setImportPassword] = useState("");
  const [comboProfile, setComboProfile] = useState<ChatGptProfileView | null>(null);
  const [comboLoginSession, setComboLoginSession] = useState<LoginSessionView | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [editingProfileName, setEditingProfileName] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const openedComboUrlsRef = useRef<Set<string>>(new Set());
  const autoStartedComboNonceRef = useRef<number | null>(null);
  const autoStartedComboCodexProfileIdsRef = useRef<Set<string>>(new Set());
  const comboProfileRef = useRef<ChatGptProfileView | null>(null);
  const comboLoginSessionRef = useRef<LoginSessionView | null>(null);
  const profilesRef = useRef<ChatGptProfileView[]>([]);
  const autoStatusRefreshTimersRef = useRef<Map<string, number[]>>(new Map());
  const autoStatusRefreshSyncedRef = useRef<Set<string>>(new Set());

  const selectedProfiles = profiles.filter((profile) => selectedIds.includes(profile.id));

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    return () => clearAllAutoStatusRefreshes();
  }, []);

  useEffect(() => {
    comboProfileRef.current = comboProfile;
  }, [comboProfile]);

  useEffect(() => {
    comboLoginSessionRef.current = comboLoginSession;
  }, [comboLoginSession]);

  useEffect(() => {
    const availableIds = new Set(profiles.map((profile) => profile.id));
    setSelectedIds((current) => current.filter((id) => availableIds.has(id)));
  }, [profiles]);

  useEffect(() => {
    if (activeTab !== "add" || !preselectedAccountId) {
      return;
    }
    onPreselectedAccountConsumed();
  }, [activeTab, onPreselectedAccountConsumed, preselectedAccountId]);

  useEffect(() => {
    if (
      activeTab !== "add" ||
      autoStartComboNonce === null ||
      autoStartedComboNonceRef.current === autoStartComboNonce
    ) {
      return;
    }
    autoStartedComboNonceRef.current = autoStartComboNonce;
    onAutoStartComboConsumed();
    void createProfile("combo");
  }, [activeTab, autoStartComboNonce, onAutoStartComboConsumed]);

  useEffect(() => {
    if (!comboProfile || !comboLoginSession || comboLoginSession.status !== "running") {
      return;
    }
    const timer = window.setInterval(() => {
      void api
        .loginSession(comboLoginSession.id)
        .then((next) => void handleComboLoginSession(next, comboProfile))
        .catch((err) => setError(errorMessage(err)));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [comboProfile, comboLoginSession]);

  useEffect(() => {
    const url = comboLoginSession?.verificationUrl;
    const sessionId = comboLoginSession?.id;
    if (!comboProfile || !url || !sessionId || openedComboUrlsRef.current.has(url)) {
      return;
    }
    openedComboUrlsRef.current.add(url);
    void openCodexLoginWindow(comboProfile, url);
  }, [comboProfile, comboLoginSession?.id, comboLoginSession?.verificationUrl]);

  async function load() {
    setError(null);
    try {
      const nextProfiles = await api.chatGptProfiles();
      profilesRef.current = nextProfiles;
      setProfiles(nextProfiles);
      onProfilesChanged?.(nextProfiles);
      return nextProfiles;
    } catch (err) {
      setError(errorMessage(err));
      return profilesRef.current;
    }
  }

  async function run(label: string, task: () => Promise<void>, reload = true) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await task();
      if (reload) {
        await load();
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function checkProfileStatus(
    profile: ChatGptProfileView,
    options: CheckProfileStatusOptions = {},
  ): Promise<ChatGptAccountStatusResult> {
    const desktop = requireDesktop();
    const result = await desktop.getChatGptAccountStatus({
      ...toDesktopProfile(profile),
      accountId: profile.accountId,
      closeAfterCheck: options.closeAfterCheck === true,
    });
    if (!result.status) {
      throw new Error(result.error ?? t("ChatGPT 状态检查失败"));
    }
    if (options.persistUnavailable !== false || hasChatGptStatusSignal(result.status)) {
      await api.checkChatGptProfile(profile.id, {
        status: result.status.status,
        accountEmail: result.status.accountEmail,
        accountName: result.status.accountName,
        accountId: result.status.accountId,
        planType: result.status.planType,
        planLabel: result.status.planLabel,
        subscriptionExpiresAt: result.status.subscriptionExpiresAt,
        subscriptionRenewsAt: result.status.subscriptionRenewsAt,
        error: result.status.error,
      });
    }
    return result.status;
  }

  async function checkProfileStatusWithRetries(
    profile: ChatGptProfileView,
  ): Promise<ChatGptAccountStatusResult> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= MANUAL_STATUS_CHECK_MAX_ATTEMPTS; attempt += 1) {
      try {
        const status = await checkProfileStatus(profile, { closeAfterCheck: true });
        if (status.status !== "available" || hasChatGptStatusSignal(status) || attempt === MANUAL_STATUS_CHECK_MAX_ATTEMPTS) {
          return status;
        }
      } catch (err) {
        lastError = err;
        if (attempt === MANUAL_STATUS_CHECK_MAX_ATTEMPTS) {
          throw err;
        }
      }
      await sleep(MANUAL_STATUS_CHECK_RETRY_DELAY_MS);
    }
    throw lastError instanceof Error ? lastError : new Error(t("ChatGPT 状态检查失败"));
  }

  async function checkProfileStatusManually(profile: ChatGptProfileView) {
    setNotice(t("正在后台检查 ChatGPT 登录状态：{name}", { name: profileDisplayLabel(profile, t) }));
    const status = await checkProfileStatusWithRetries(profile);
    if (status.status === "available") {
      setNotice(t("ChatGPT 检查成功：{name}", { name: profileDisplayLabel(profile, t) }));
      return;
    }
    setError(t("ChatGPT 检查失败：{reason}", { reason: status.error ?? statusLabel(status.status, t) }));
  }

  async function checkAllProfiles() {
    await run("check-all-chatgpt", async () => {
      setNotice(t("正在后台检查全部 ChatGPT 会话"));
      let available = 0;
      let failed = 0;
      for (const profile of profiles) {
        const status = await checkProfileStatusWithRetries(profile);
        if (status.status === "available") {
          available += 1;
        } else {
          failed += 1;
        }
      }
      setNotice(t("已检查全部 ChatGPT 会话：{success} 个可用，{failed} 个失败", { success: available, failed }));
    });
  }

  async function createProfile(
    mode: "standalone" | "combo",
    linkedCodexAccountId: string | null = null,
  ) {
    await run(`create-${mode}`, async () => {
      const profile = await api.createChatGptProfile({
        linkedCodexAccountId,
      });
      if (mode !== "combo") {
        await openProfile(profile, false, false);
        setNotice(t("已创建并打开 ChatGPT，登录完成后会自动同步到列表"));
        return;
      }
      await openProfile(profile, false, false);
      setComboProfile(profile);
      setComboLoginSession(null);
      openedComboUrlsRef.current.clear();
      autoStartedComboCodexProfileIdsRef.current.delete(profile.id);
      setNotice(t("ChatGPT 登录完成后会自动继续 Codex OAuth"));
    });
  }

  async function openProfile(profile: ChatGptProfileView, reload = true, checkAfterOpen = true) {
    const desktop = requireDesktop();
    const result = await desktop.openChatGpt(toDesktopProfile(profile));
    if (!result.opened) {
      throw new Error(result.error ?? t("ChatGPT 窗口打开失败"));
    }
    await api.markChatGptProfileOpened(profile.id);
    if (checkAfterOpen) {
      await checkProfileStatus(profile, { closeAfterCheck: true }).catch(() => undefined);
    }
    scheduleAutoStatusRefresh(profile);
    if (reload) {
      await load();
    }
  }

  function scheduleAutoStatusRefresh(profile: ChatGptProfileView) {
    if (!window.squirrelSwitchDesktop) {
      return;
    }
    clearAutoStatusRefresh(profile.id);
    autoStatusRefreshSyncedRef.current.delete(profile.id);
    const timers = AUTO_STATUS_REFRESH_DELAYS_MS.map((delayMs, index) =>
      window.setTimeout(() => {
        void runAutoStatusRefresh(profile.id, index === AUTO_STATUS_REFRESH_DELAYS_MS.length - 1);
      }, delayMs),
    );
    autoStatusRefreshTimersRef.current.set(profile.id, timers);
  }

  async function runAutoStatusRefresh(profileId: string, isLastAttempt: boolean) {
    const profile = profilesRef.current.find((item) => item.id === profileId);
    if (!profile) {
      clearAutoStatusRefresh(profileId);
      return;
    }
    try {
      const status = await checkProfileStatus(profile, { closeAfterCheck: true, persistUnavailable: false });
      await maybeStartComboCodexOAuth(profile, status);
      if (!hasChatGptStatusSignal(status)) {
        return;
      }
      await load();
      if (!autoStatusRefreshSyncedRef.current.has(profileId)) {
        autoStatusRefreshSyncedRef.current.add(profileId);
        if (!comboLoginSessionRef.current) {
          setNotice(t("已同步 ChatGPT 登录信息"));
        }
      }
      if (isCompleteChatGptStatus(status) || isLastAttempt) {
        clearAutoStatusRefresh(profileId);
      }
    } catch {
      if (isLastAttempt) {
        clearAutoStatusRefresh(profileId);
      }
    }
  }

  function clearAutoStatusRefresh(profileId: string) {
    const timers = autoStatusRefreshTimersRef.current.get(profileId);
    if (!timers) {
      return;
    }
    for (const timer of timers) {
      window.clearTimeout(timer);
    }
    autoStatusRefreshTimersRef.current.delete(profileId);
  }

  function clearAllAutoStatusRefreshes() {
    for (const profileId of [...autoStatusRefreshTimersRef.current.keys()]) {
      clearAutoStatusRefresh(profileId);
    }
  }

  function beginRenameProfile(profile: ChatGptProfileView) {
    setEditingProfileId(profile.id);
    setEditingProfileName(profile.displayName);
  }

  async function saveRenamedProfile(profile: ChatGptProfileView) {
    const nextName = editingProfileName.trim();
    if (!nextName || nextName === profile.displayName) {
      setEditingProfileId(null);
      setEditingProfileName("");
      return;
    }
    await run(`rename-${profile.id}`, async () => {
      await api.updateChatGptProfile(profile.id, { displayName: nextName });
      setEditingProfileId(null);
      setEditingProfileName("");
      setNotice(t("ChatGPT 备注已更新"));
    });
  }

  function cancelRenameProfile() {
    setEditingProfileId(null);
    setEditingProfileName("");
  }

  async function deleteProfile(profile: ChatGptProfileView) {
    if (!window.confirm(t("确认删除 ChatGPT 账号「{name}」？本机会话数据也会被清除。", { name: profileDisplayLabel(profile, t) }))) {
      return;
    }
    await run(`delete-${profile.id}`, async () => {
      clearAutoStatusRefresh(profile.id);
      const result = await requireDesktop().clearChatGptSession(toDesktopProfile(profile));
      if (!result.cleared) {
        throw new Error(result.error ?? t("清除 ChatGPT 会话失败"));
      }
      await api.deleteChatGptProfile(profile.id);
      setNotice(t("ChatGPT 会话已删除"));
    });
  }

  async function continueComboCodexOAuth() {
    const profile = comboProfile;
    if (!profile) {
      setError(t("请先创建组合 ChatGPT 会话"));
      return;
    }
    await startComboCodexOAuth(profile, false);
  }

  async function maybeStartComboCodexOAuth(
    profile: ChatGptProfileView,
    status: ChatGptAccountStatusResult,
  ) {
    if (!hasChatGptLoginIdentity(status)) {
      return;
    }
    const combo = comboProfileRef.current;
    if (!combo || combo.id !== profile.id || comboLoginSessionRef.current) {
      return;
    }
    if (autoStartedComboCodexProfileIdsRef.current.has(profile.id)) {
      return;
    }
    autoStartedComboCodexProfileIdsRef.current.add(profile.id);
    clearAutoStatusRefresh(profile.id);
    await startComboCodexOAuth(profile, true);
  }

  async function startComboCodexOAuth(profile: ChatGptProfileView, automatic: boolean) {
    setBusy("combo-codex-login");
    setError(null);
    setNotice(automatic ? t("已检测到 ChatGPT 登录，正在自动打开 Codex OAuth") : null);
    try {
      const session = await api.startLogin();
      comboLoginSessionRef.current = session;
      setComboLoginSession(session);
      await handleComboLoginSession(session, profile);
    } catch (err) {
      setError(errorMessage(err));
      if (automatic) {
        autoStartedComboCodexProfileIdsRef.current.delete(profile.id);
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleComboLoginSession(
    session: LoginSessionView,
    profile: ChatGptProfileView,
  ) {
    comboLoginSessionRef.current = session;
    setComboLoginSession(session);
    if (session.status === "running") {
      return;
    }
    if (session.status === "imported" && session.account) {
      let noticeText = t("组合账号已保存，首次限额已刷新");
      try {
        await api.refresh(session.account.id);
      } catch (err) {
        noticeText = t("组合账号已保存，首次限额刷新失败：{message}", {
          message: errorMessage(err),
        });
      }
      onAccountsChanged?.();
      await checkProfileStatus(profile, { closeAfterCheck: true, persistUnavailable: false }).catch(() => undefined);
      scheduleAutoStatusRefresh(profile);
      setComboProfile(null);
      comboProfileRef.current = null;
      comboLoginSessionRef.current = null;
      setComboLoginSession(null);
      await load();
      setNotice(noticeText);
      return;
    }
    setError(session.message || t("Codex OAuth 登录失败"));
  }

  async function openCodexLoginWindow(profile: ChatGptProfileView, url: string) {
    const result = await requireDesktop().openUrlInChatGpt(toDesktopProfile(profile), url);
    if (!result.opened) {
      setError(result.error ?? t("Codex 授权窗口打开失败"));
    }
  }

  async function exportBackup() {
    if (selectedProfiles.length === 0) {
      setError(t("请选择要导出的 ChatGPT 会话"));
      return;
    }
    if (!backupPassword) {
      setError(t("请输入备份密码"));
      return;
    }
    await run("export-chatgpt-backup", async () => {
      const result = await requireDesktop().exportChatGptBackup({
        profiles: selectedProfiles.map(toDesktopProfile),
        password: backupPassword,
      });
      if (!result.result) {
        throw new Error(result.error ?? t("ChatGPT 备份导出失败"));
      }
      downloadJson(
        result.result.backup,
        `squirrel-switch-chatgpt-${new Date().toISOString().slice(0, 10)}.squirrel-chatgpt-backup.json`,
      );
      await Promise.all(
        result.result.exported.map((item) =>
          api.markChatGptProfileExported(item.id, item.sessionHash),
        ),
      );
      setBackupPassword("");
      setNotice(t("已导出 {count} 个 ChatGPT 会话", { count: result.result.exported.length }));
    });
  }

  async function importBackupFile(file: File) {
    if (!importPassword) {
      setError(t("请输入备份密码"));
      return;
    }
    await run("import-chatgpt-backup", async () => {
      const result = await requireDesktop().importChatGptBackup({
        backupText: await file.text(),
        password: importPassword,
      });
      if (!result.result) {
        throw new Error(result.error ?? t("ChatGPT 备份导入失败"));
      }
      const imported = await api.importChatGptProfiles({ profiles: result.result.profiles });
      setImportPassword("");
      if (result.result.failed > 0 && result.result.partialFailed > 0) {
        setNotice(
          t("已导入 {count} 个 ChatGPT 会话，{failed} 个写入失败，{partial} 个 localStorage 恢复不完整", {
            count: imported.imported,
            failed: result.result.failed,
            partial: result.result.partialFailed,
          }),
        );
        return;
      }
      if (result.result.failed > 0) {
        setNotice(
          t("已导入 {count} 个 ChatGPT 会话，{failed} 个写入失败", {
            count: imported.imported,
            failed: result.result.failed,
          }),
        );
        return;
      }
      setNotice(
        result.result.partialFailed > 0
          ? t("已导入 {count} 个 ChatGPT 会话，{partial} 个 localStorage 恢复不完整", {
              count: imported.imported,
              partial: result.result.partialFailed,
            })
          : t("已导入 {count} 个 ChatGPT 会话", { count: imported.imported }),
      );
    });
  }

  function requireDesktop(): SquirrelSwitchDesktopApi {
    const desktop = window.squirrelSwitchDesktop;
    if (!desktop) {
      throw new Error(t("ChatGPT 网页会话只能在 Squirrel Switch 桌面版中使用"));
    }
    return desktop;
  }

  return (
    <div className="chatgptPage">
      {error && (
        <section className="notice error">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </section>
      )}
      {notice && !error && (
        <section className="notice success">
          <CheckCircle2 size={16} />
          <span>{notice}</span>
        </section>
      )}

      {activeTab === "current" && (
        <>
          <section className="chatgptHero">
            <div>
              <span className="eyebrow">ChatGPT</span>
              <h2>{profiles.length > 0 ? t("已保存 {count} 个 ChatGPT 账号", { count: profiles.length }) : t("还没有 ChatGPT 账号")}</h2>
              <p>{t("每个账号使用独立 Chrome/Edge 浏览器 Profile，打开或刷新后按邮箱自动关联 Codex。")}</p>
            </div>
          </section>

          <ProfilesTable
            profiles={profiles}
            busy={busy}
            editingProfileId={editingProfileId}
            editingProfileName={editingProfileName}
            locale={locale}
            onEditingProfileNameChange={setEditingProfileName}
            onOpen={(profile) => void run(`open-${profile.id}`, () => openProfile(profile))}
            onCheckStatus={(profile) =>
              void run(`check-chatgpt-${profile.id}`, async () => {
                await checkProfileStatusManually(profile);
              })
            }
            onStartRename={beginRenameProfile}
            onSaveRename={(profile) => void saveRenamedProfile(profile)}
            onCancelRename={cancelRenameProfile}
            onDelete={(profile) => void deleteProfile(profile)}
            onRefreshAll={() => void checkAllProfiles()}
          />
        </>
      )}

      {activeTab === "add" && (
        <AddSessionPanel
          accounts={accounts}
          profiles={profiles}
          comboProfile={comboProfile}
          comboLoginSession={comboLoginSession}
          busy={busy}
          onCreate={(mode) => void createProfile(mode)}
          onCreateForAccount={(account) => void createProfile("combo", account.id)}
          onContinueCombo={() => void continueComboCodexOAuth()}
        />
      )}

      {activeTab === "backup" && (
        <BackupPanel
          profiles={profiles}
          selectedIds={selectedIds}
          backupPassword={backupPassword}
          importPassword={importPassword}
          busy={busy}
          locale={locale}
          inputRef={importInputRef}
          onToggleSelected={(id) =>
            setSelectedIds((current) =>
              current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
            )
          }
          onToggleAll={() =>
            setSelectedIds((current) =>
              current.length === profiles.length ? [] : profiles.map((profile) => profile.id),
            )
          }
          onBackupPasswordChange={setBackupPassword}
          onImportPasswordChange={setImportPassword}
          onExport={() => void exportBackup()}
          onImportFile={(file) => void importBackupFile(file)}
        />
      )}

      <div className="hint">
        <AlertTriangle size={14} />
        <span>
          {t("ChatGPT cookie、localStorage 和备份均属于敏感登录态；Squirrel Switch 不会展示、复制或记录明文内容。")}
        </span>
      </div>
    </div>
  );
}

function AddSessionPanel({
  accounts,
  profiles,
  comboProfile,
  comboLoginSession,
  busy,
  onCreate,
  onCreateForAccount,
  onContinueCombo,
}: {
  accounts: AccountView[];
  profiles: ChatGptProfileView[];
  comboProfile: ChatGptProfileView | null;
  comboLoginSession: LoginSessionView | null;
  busy: Busy;
  onCreate: (mode: "standalone" | "combo") => void;
  onCreateForAccount: (account: AccountView) => void;
  onContinueCombo: () => void;
}) {
  const { t } = useI18n();
  const linkedAccountIds = new Set(
    profiles
      .map((profile) => profile.linkedCodexAccountId)
      .filter((id): id is string => Boolean(id)),
  );
  const pendingAccounts = accounts.filter((account) => !linkedAccountIds.has(account.id));
  return (
    <section className="addGrid chatgptAddGrid">
      <div className="addCard chatgptCreateCard">
        <div className="icon">
          <MessageSquare size={18} />
        </div>
        <h3>{t("添加组合账号")}</h3>
        <p>{t("先登录 ChatGPT，随后自动在同一浏览器继续 Codex OAuth。")}</p>
        <div className="chatgptCreateActions">
          <button
            className="primary"
            disabled={Boolean(busy)}
            onClick={() => onCreate("combo")}
          >
            <Link2 size={14} />
            {t("组合登录 GPT+Codex")}
          </button>
          <button disabled={Boolean(busy)} onClick={() => onCreate("standalone")}>
            <LogIn size={14} />
            {t("单独创建 GPT")}
          </button>
        </div>
        {comboProfile && (
          <div className="comboBox">
            <strong>{profileDisplayLabel(comboProfile, t)}</strong>
            <span>{comboLoginSession?.message ?? t("等待 ChatGPT 登录完成，随后会自动打开 Codex OAuth")}</span>
            <button disabled={busy === "combo-codex-login"} onClick={onContinueCombo}>
              <LogIn size={14} />
              {t("手动打开 Codex OAuth")}
            </button>
            <small>{t("若浏览器询问是否打开 Codex.app，请选择取消；Squirrel Switch 会自动导入登录态。")}</small>
          </div>
        )}
      </div>

      <div className="addCard chatgptPendingCard">
        <div className="icon">
          <Link2 size={18} />
        </div>
        <h3>{t("待关联 Codex")}</h3>
        <p>{t("这些 Codex 账号还没有绑定 ChatGPT 会话，可直接补一个组合登录。")}</p>
        <div className="pendingCodexList">
          {pendingAccounts.length === 0 ? (
            <div className="empty small">{t("暂无待关联 Codex 账号")}</div>
          ) : (
            pendingAccounts.map((account) => (
              <div key={account.id} className="pendingCodexRow">
                <span className="identity">
                  <strong>{account.name}</strong>
                  <small>{account.email || account.accountId || t("未识别")}</small>
                </span>
                <button disabled={Boolean(busy)} onClick={() => onCreateForAccount(account)}>
                  <Link2 size={14} />
                  {t("补 GPT")}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function BackupPanel({
  profiles,
  selectedIds,
  backupPassword,
  importPassword,
  busy,
  locale,
  inputRef,
  onToggleSelected,
  onToggleAll,
  onBackupPasswordChange,
  onImportPasswordChange,
  onExport,
  onImportFile,
}: {
  profiles: ChatGptProfileView[];
  selectedIds: string[];
  backupPassword: string;
  importPassword: string;
  busy: Busy;
  locale: AppLocale;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onToggleSelected: (id: string) => void;
  onToggleAll: () => void;
  onBackupPasswordChange: (value: string) => void;
  onImportPasswordChange: (value: string) => void;
  onExport: () => void;
  onImportFile: (file: File) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <section className="card">
        <header className="cardHeader">
          <div className="left">
            <h2>{t("选择导出会话")}</h2>
            <span className="count">{t("已选 {selected} / {total} 个", { selected: selectedIds.length, total: profiles.length })}</span>
          </div>
          <div className="actions">
            <button disabled={profiles.length === 0} onClick={onToggleAll}>
              {selectedIds.length === profiles.length ? t("清空") : t("全选")}
            </button>
          </div>
        </header>
        <div className="cardBody tight">
          {profiles.length === 0 ? (
            <div className="empty">{t("暂无 ChatGPT 会话")}</div>
          ) : (
            <div className="chatgptBackupList">
              {profiles.map((profile) => (
                <label key={profile.id} className="chatgptBackupRow">
                  <input
                    className="rowCheckbox"
                    type="checkbox"
                    checked={selectedIds.includes(profile.id)}
                    onChange={() => onToggleSelected(profile.id)}
                  />
                  <span className="identity">
                    <strong>{profileDisplayLabel(profile, t)}</strong>
                    <small>{profile.displayName}</small>
                  </span>
                  <span>{formatTime(profile.lastExportedAt, locale)}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="addGrid chatgptBackupGrid">
        <div className="addCard">
          <div className="icon">
            <Download size={18} />
          </div>
          <h3>{t("导出 ChatGPT 备份")}</h3>
          <p>{t("备份会加密保存网页登录态，只适合在你自己的设备之间迁移。")}</p>
          <input
            type="password"
            value={backupPassword}
            onChange={(event) => onBackupPasswordChange(event.target.value)}
            placeholder={t("备份密码")}
            autoComplete="new-password"
          />
          <button
            className="primary"
            disabled={selectedIds.length === 0 || busy === "export-chatgpt-backup"}
            onClick={onExport}
          >
            <Download size={14} />
            {t("导出选中会话")}
          </button>
        </div>

        <div className="addCard">
          <div className="icon">
            <Upload size={18} />
          </div>
          <h3>{t("导入 ChatGPT 备份")}</h3>
          <p>{t("导入后会写入新的独立浏览器 Profile，检查状态时按邮箱自动关联本机 Codex。")}</p>
          <input
            type="password"
            value={importPassword}
            onChange={(event) => onImportPasswordChange(event.target.value)}
            placeholder={t("备份密码")}
            autoComplete="new-password"
          />
          <input
            ref={inputRef}
            className="hiddenFileInput"
            type="file"
            accept=".squirrel-chatgpt-backup.json,application/json,.json"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) {
                onImportFile(file);
              }
            }}
          />
          <button disabled={busy === "import-chatgpt-backup"} onClick={() => inputRef.current?.click()}>
            <Upload size={14} />
            {busy === "import-chatgpt-backup" ? t("正在导入…") : t("选择备份")}
          </button>
        </div>
      </section>
    </>
  );
}

function ProfilesTable({
  profiles,
  busy,
  editingProfileId,
  editingProfileName,
  locale,
  onEditingProfileNameChange,
  onOpen,
  onCheckStatus,
  onStartRename,
  onSaveRename,
  onCancelRename,
  onDelete,
  onRefreshAll,
}: {
  profiles: ChatGptProfileView[];
  busy: Busy;
  editingProfileId: string | null;
  editingProfileName: string;
  locale: AppLocale;
  onEditingProfileNameChange: (value: string) => void;
  onOpen: (profile: ChatGptProfileView) => void;
  onCheckStatus: (profile: ChatGptProfileView) => void;
  onStartRename: (profile: ChatGptProfileView) => void;
  onSaveRename: (profile: ChatGptProfileView) => void;
  onCancelRename: () => void;
  onDelete: (profile: ChatGptProfileView) => void;
  onRefreshAll: () => void;
}) {
  const { t } = useI18n();
  return (
    <section className="card">
      <header className="cardHeader">
        <div className="left">
          <h2>{t("ChatGPT 会话")}</h2>
          <span className="count">{t("{count} 个", { count: profiles.length })}</span>
        </div>
        <div className="actions">
          <button className="primary" disabled={profiles.length === 0 || Boolean(busy)} onClick={onRefreshAll}>
            <RefreshCcw size={14} />
            {t("刷新全部")}
          </button>
        </div>
      </header>
      <div className="cardBody tight">
        {profiles.length === 0 ? (
          <div className="empty">{t("暂无 ChatGPT 会话")}</div>
        ) : (
          <div className="tableWrap">
            <table className="table chatgptProfilesTable">
              <thead>
                <tr>
                  <th>{t("状态")}</th>
                  <th>{t("账号")}</th>
                  <th>{t("计划")}</th>
                  <th>{t("会员到期")}</th>
                  <th>{t("浏览器")}</th>
                  <th>{t("绑定 Codex")}</th>
                  <th>{t("上次检查")}</th>
                  <th style={{ textAlign: "right" }}>{t("操作")}</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((profile) => {
                  return (
                    <tr key={profile.id}>
                      <td>
                        <SessionPill profile={profile} />
                      </td>
                      <td>
                        {editingProfileId === profile.id ? (
                          <span className="rename">
                            <input
                              autoFocus
                              value={editingProfileName}
                              onChange={(event) => onEditingProfileNameChange(event.target.value)}
                            />
                            <button onClick={() => onSaveRename(profile)}>{t("保存")}</button>
                            <button className="ghost" onClick={onCancelRename}>
                              {t("取消")}
                            </button>
                          </span>
                        ) : (
                          <AccountCell profile={profile} />
                        )}
                      </td>
                      <td>{formatPlan(profile, locale)}</td>
                      <td>{formatSubscription(profile, locale)}</td>
                      <td>{formatBrowser(profile, t)}</td>
                      <td>
                        <LinkedCodexCell profile={profile} />
                      </td>
                      <td>{formatTime(profile.lastCheckedAt, locale)}</td>
                      <td>
                        <div className="rowActions">
                          <IconButton title={t("打开 ChatGPT")} disabled={Boolean(busy)} onClick={() => onOpen(profile)}>
                            <MessageSquare size={14} />
                          </IconButton>
                          <IconButton title={t("检查登录状态")} disabled={Boolean(busy)} onClick={() => onCheckStatus(profile)}>
                            <RefreshCcw size={14} />
                          </IconButton>
                          <IconButton title={t("编辑备注")} disabled={Boolean(busy)} onClick={() => onStartRename(profile)}>
                            <Pencil size={14} />
                          </IconButton>
                          <IconButton className="danger" title={t("删除")} disabled={Boolean(busy)} onClick={() => onDelete(profile)}>
                            <Trash2 size={14} />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function SessionPill({ profile }: { profile: ChatGptProfileView }) {
  const { t } = useI18n();
  if (profile.sessionStatus === "available") {
    return <span className="pill active">{t("可用")}</span>;
  }
  if (profile.sessionStatus === "invalid") {
    return <span className="pill danger" title={profile.lastCheckError ?? undefined}>{t("失效")}</span>;
  }
  if (profile.sessionStatus === "reauth_required") {
    return <span className="pill warn" title={profile.lastCheckError ?? undefined}>{t("需验证")}</span>;
  }
  return <span className="pill warn">{t("未检查")}</span>;
}

function AccountCell({ profile }: { profile: ChatGptProfileView }) {
  const { t } = useI18n();
  const primary = profile.accountEmail ?? profile.accountName ?? profile.linkedCodexEmail;
  return (
    <span className="identity">
      <span className="identityNameRow">
        <strong>{profile.displayName}</strong>
      </span>
      <span className="identityMetaRow">
        <small>{primary ?? t("未识别")}</small>
      </span>
    </span>
  );
}

function IconButton({
  className,
  title,
  "aria-label": ariaLabel,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const label = ariaLabel ?? (typeof title === "string" ? title : undefined);
  return (
    <button
      className={`iconButton ${className ?? ""}`.trim()}
      title={title}
      aria-label={label}
      data-tooltip={label}
      {...props}
    />
  );
}

function LinkedCodexCell({ profile }: { profile: ChatGptProfileView }) {
  const { t } = useI18n();
  const name = profile.linkedCodexAccountName ?? profile.linkedCodexEmail;
  if (!profile.linkedCodexAccountId && !name) {
    return <span className="pill">{t("未绑定")}</span>;
  }
  return (
    <span className="identity">
      <strong>{name ?? t("已绑定")}</strong>
      {profile.linkedCodexEmail && name !== profile.linkedCodexEmail ? (
        <small>{profile.linkedCodexEmail}</small>
      ) : null}
    </span>
  );
}

function toDesktopProfile(profile: ChatGptProfileView): ChatGptDesktopProfileInput {
  return {
    id: profile.id,
    displayName: profile.accountEmail ?? profile.accountName ?? profile.linkedCodexEmail ?? profile.displayName,
    linkedCodexEmail: profile.linkedCodexEmail,
    accountEmail: profile.accountEmail,
    accountId: profile.accountId,
    planLabel: profile.planLabel,
    browserKind: profile.browserKind,
    browserExecutablePath: profile.browserExecutablePath,
    browserProfileDir: profile.browserProfileDir,
  };
}

function downloadJson(payload: unknown, filename: string) {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function formatTime(value: number | null | undefined, locale: AppLocale) {
  if (!value) {
    return locale === "en-US" ? "Never" : "从未";
  }
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value * 1000));
}

function formatPlan(profile: ChatGptProfileView, locale: AppLocale) {
  return (
    readablePlanLabel(profile.planType, profile.planLabel) ??
    (locale === "en-US" ? "Unavailable" : "会员信息不可用")
  );
}

function formatSubscription(profile: ChatGptProfileView, locale: AppLocale) {
  if (profile.subscriptionRenewsAt) {
    return formatTime(profile.subscriptionRenewsAt, locale);
  }
  if (profile.subscriptionExpiresAt) {
    return formatTime(profile.subscriptionExpiresAt, locale);
  }
  return locale === "en-US" ? "Unavailable" : "会员信息不可用";
}

function formatBrowser(profile: ChatGptProfileView, t: (text: string) => string): string {
  if (profile.browserKind === "edge") {
    return "Edge";
  }
  if (profile.browserKind === "custom") {
    return t("自定义");
  }
  return "Chrome";
}

function profileDisplayLabel(profile: ChatGptProfileView, t: (text: string) => string): string {
  return profile.accountEmail ?? profile.accountName ?? profile.linkedCodexEmail ?? profile.displayName ?? t("未识别");
}

function statusLabel(status: ChatGptAccountStatusResult["status"], t: (text: string) => string): string {
  if (status === "invalid") return t("失效");
  if (status === "reauth_required") return t("需验证");
  if (status === "unchecked") return t("未检查");
  return t("会员信息不可用");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function hasChatGptStatusSignal(status: ChatGptAccountStatusResult): boolean {
  if (status.status !== "available") {
    return false;
  }
  return Boolean(
    status.accountEmail ||
      status.accountName ||
      status.accountId ||
      readablePlanLabel(status.planType, status.planLabel) ||
      status.subscriptionExpiresAt ||
      status.subscriptionRenewsAt,
  );
}

function isCompleteChatGptStatus(status: ChatGptAccountStatusResult): boolean {
  if (status.status !== "available" || !hasChatGptIdentity(status)) {
    return false;
  }
  const planLabel = readablePlanLabel(status.planType, status.planLabel);
  if (!planLabel) {
    return false;
  }
  if (planLabel.toLowerCase() === "free") {
    return true;
  }
  return Boolean(status.subscriptionExpiresAt || status.subscriptionRenewsAt);
}

function hasChatGptIdentity(status: ChatGptAccountStatusResult): boolean {
  return Boolean(status.accountEmail || status.accountName || status.accountId);
}

function hasChatGptLoginIdentity(status: ChatGptAccountStatusResult): boolean {
  return status.status === "available" && Boolean(status.accountEmail || status.accountId);
}

function readablePlanLabel(planType: string | null, planLabel: string | null): string | null {
  const normalizedType = planType?.trim().toLowerCase() ?? null;
  if (normalizedType) {
    if (normalizedType === "plus") return "Plus";
    if (normalizedType === "pro") return "Pro";
    if (normalizedType === "team") return "Team";
    if (normalizedType === "enterprise") return "Enterprise";
    if (normalizedType === "free") return "Free";
  }
  const label = planLabel?.trim();
  if (!label || /^chatgpt[a-z0-9_-]*plan$/i.test(label)) {
    return null;
  }
  return label;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => window.setTimeout(resolveSleep, ms));
}
