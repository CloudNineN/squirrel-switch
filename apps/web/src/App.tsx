import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Download,
  FileJson,
  Info,
  KeyRound,
  Languages,
  Link2,
  LogIn,
  MessageSquare,
  Pencil,
  Play,
  Plus,
  RefreshCcw,
  ScrollText,
  TextCursorInput,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { APP_VERSION } from "@squirrel-switch/shared";
import type {
  AccountBackupPayload,
  AccountView,
  ChatGptDesktopProfileInput,
  ChatGptProfileView,
  LoginSessionView,
  RateLimitWindowView,
  RuntimeLogPageView,
  RuntimeLogView,
  RuntimeStatus,
} from "@squirrel-switch/shared";
import { api } from "./api.js";
import { formatRecommendationReason, getRecommendedAccountId } from "./account-recommendation.js";
import { AboutView } from "./AboutView.js";
import { ChatGptView } from "./ChatGptView.js";
import type { ChatGptTab } from "./ChatGptView.js";
import { ChatGptAppsView } from "./ChatGptAppsView.js";
import { ClaudeCodeView } from "./ClaudeCodeView.js";
import type { ClaudeCodeTab } from "./ClaudeCodeView.js";
import { PromptManagementView } from "./PromptManagementView.js";
import { ScheduledRefreshPanel } from "./ScheduledRefreshPanel.js";
import appLogo from "./assets/app-logo.png";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { useI18n } from "./i18n.js";
import type { AppLocale } from "./i18n.js";
import { RefreshProgressBar } from "./RefreshLog.js";
import type { RefreshLogEntry } from "./RefreshLog.js";
import { TransferView } from "./TransferView.js";

type Section =
  | "accounts"
  | "add"
  | "transfer"
  | "scheduled-refresh"
  | "chatgpt"
  | "chatgpt-add"
  | "chatgpt-backup"
  | "chatgpt-apps"
  | "claude-code"
  | "claude-code-add"
  | "claude-code-backup"
  | "prompt-management"
  | "diagnostics"
  | "logs"
  | "about";
type BusyState = { action: string; id?: string } | null;
type ConfirmAction = { kind: "activate" | "delete"; account: AccountView };
type ResetTimeMode = "relative" | "absolute";
type PageFeedback = {
  section: Section;
  error: string | null;
  notice: string | null;
} | null;
const RUNTIME_LOG_PAGE_SIZE = 50;
const REFRESH_ALL_CONCURRENCY = 3;
const REFRESH_HIGHLIGHT_MS = 1100;
const SCHEDULED_REFRESH_SYNC_INTERVAL_MS = 15_000;

export function App() {
  const { locale, setLocale, t } = useI18n();
  const [accounts, setAccounts] = useState<AccountView[]>([]);
  const [chatGptProfiles, setChatGptProfiles] = useState<ChatGptProfileView[]>([]);
  const [chatGptProfileCount, setChatGptProfileCount] = useState(0);
  const [claudeCodeProfileCount, setClaudeCodeProfileCount] = useState(0);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [busy, setBusy] = useState<BusyState>(null);
  const [feedback, setFeedback] = useState<PageFeedback>(null);
  const [section, setSection] = useState<Section>("accounts");
  const [authJson, setAuthJson] = useState("");
  const [importName, setImportName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [loginSession, setLoginSession] = useState<LoginSessionView | null>(null);
  const [autoStartChatGptComboNonce, setAutoStartChatGptComboNonce] = useState<number | null>(null);
  const [refreshLogs, setRefreshLogs] = useState<RefreshLogEntry[]>([]);
  const [highlightedRefreshIds, setHighlightedRefreshIds] = useState<Record<string, number>>({});
  const [runtimeLogPage, setRuntimeLogPage] = useState<RuntimeLogPageView | null>(null);
  const [runtimeLogPageNumber, setRuntimeLogPageNumber] = useState(1);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [resetTimeMode, setResetTimeMode] = useState<ResetTimeMode>("relative");
  const [selectedExportAccountIds, setSelectedExportAccountIds] = useState<string[]>([]);
  const [preselectedChatGptAccountId, setPreselectedChatGptAccountId] = useState<string | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const sectionRef = useRef<Section>(section);
  const openedLoginUrlsRef = useRef<Set<string>>(new Set());
  const lastScheduledRefreshFinishedAtRef = useRef<number | null>(null);

  const visibleError = feedback?.section === section ? feedback.error : null;
  const visibleNotice = feedback?.section === section ? feedback.notice : null;

  const activeAccount = useMemo(
    () => accounts.find((account) => account.isActive) ?? null,
    [accounts],
  );

  useEffect(() => {
    void load();
    void loadChatGptProfiles();
    void loadClaudeCodeProfileCount();
  }, []);

  useEffect(() => {
    sectionRef.current = section;
  }, [section]);

  useEffect(() => {
    const availableIds = new Set(accounts.map((account) => account.id));
    setSelectedExportAccountIds((current) => current.filter((id) => availableIds.has(id)));
  }, [accounts]);

  useEffect(() => {
    if (!loginSession || loginSession.status !== "running") return;
    const timer = window.setInterval(() => {
      void api
        .loginSession(loginSession.id)
        .then((next) => {
          setLoginSession(next);
          if (next.status !== "running") void load();
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err), "add"));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [loginSession]);

  useEffect(() => {
    const url = loginSession?.verificationUrl;
    const sessionId = loginSession?.id;
    if (!url || !sessionId || openedLoginUrlsRef.current.has(url)) return;
    openedLoginUrlsRef.current.add(url);
    void openLoginUrlInDesktop(sessionId, url);
  }, [loginSession?.id, loginSession?.verificationUrl]);

  async function openLoginUrlInDesktop(sessionId: string, url: string): Promise<void> {
    const desktopApi = window.squirrelSwitchDesktop;
    if (desktopApi) {
      const result = await desktopApi.openLoginUrl(sessionId, url);
      if (!result.opened && result.error) {
        setNotice(`Failed to open the in-app authorization window: ${result.error}. Please copy the link and open it manually.`, "add");
      }
      return;
    }
    if (/Electron/i.test(navigator.userAgent)) {
      window.open(url, "_blank");
      return;
    }
    setNotice("This is not the desktop app, so the in-app authorization window cannot open automatically. Please copy the link and open it manually.", "add");
  }

  useEffect(() => {
    if (section === "logs") void loadRuntimeLogs(runtimeLogPageNumber);
  }, [section, runtimeLogPageNumber]);

  useEffect(() => {
    let stopped = false;

    async function syncAccountsAfterScheduledRefresh() {
      try {
        const state = await api.scheduledRefresh();
        const finishedAt = state.lastFinishedAt;
        const previousFinishedAt = lastScheduledRefreshFinishedAtRef.current;
        if (finishedAt && previousFinishedAt && finishedAt !== previousFinishedAt) {
          const [nextAccounts, nextRuntime] = await Promise.all([api.accounts(), api.runtime()]);
          if (!stopped) {
            setAccounts(nextAccounts);
            setRuntime(nextRuntime);
          }
        }
        if (!stopped) {
          lastScheduledRefreshFinishedAtRef.current = finishedAt;
        }
      } catch {
        // 定时刷新状态同步失败不打断当前页面操作，下一轮轮询会继续尝试。
      }
    }

    void syncAccountsAfterScheduledRefresh();
    const timer = window.setInterval(
      () => void syncAccountsAfterScheduledRefresh(),
      SCHEDULED_REFRESH_SYNC_INTERVAL_MS,
    );
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, []);

  function setError(message: string | null, targetSection = sectionRef.current) {
    setFeedback((current) => {
      if (message === null && current?.section !== targetSection) return current;
      return {
        section: targetSection,
        error: message,
        notice: current?.section === targetSection ? current.notice : null,
      };
    });
  }

  function setNotice(message: string | null, targetSection = sectionRef.current) {
    setFeedback((current) => {
      if (message === null && current?.section !== targetSection) return current;
      return {
        section: targetSection,
        error: current?.section === targetSection ? current.error : null,
        notice: message,
      };
    });
  }

  async function load(options: { clearError?: boolean } = {}) {
    if (options.clearError ?? true) setError(null);
    try {
      const [nextAccounts, nextRuntime] = await Promise.all([
        api.accounts(),
        api.runtime(),
      ]);
      setAccounts(nextAccounts);
      setRuntime(nextRuntime);
      void loadChatGptProfiles();
      void loadClaudeCodeProfileCount();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function loadClaudeCodeProfileCount() {
    try {
      const profiles = await api.claudeCodeProfiles();
      setClaudeCodeProfileCount(profiles.length);
    } catch {
      setClaudeCodeProfileCount(0);
    }
  }

  async function loadChatGptProfiles() {
    try {
      const profiles = await api.chatGptProfiles();
      setChatGptProfiles(profiles);
      setChatGptProfileCount(profiles.length);
    } catch {
      setChatGptProfiles([]);
      setChatGptProfileCount(0);
    }
  }

  function changeSection(next: Section) {
    setSection(next);
    if (next === "accounts") {
      void load({ clearError: false });
    }
  }

  async function run<T>(state: BusyState, task: () => Promise<T>, after?: (value: T) => void) {
    const feedbackSection = sectionRef.current;
    setBusy(state);
    setError(null, feedbackSection);
    setNotice(null, feedbackSection);
    try {
      const result = await task();
      after?.(result);
      const [nextAccounts, nextRuntime] = await Promise.all([api.accounts(), api.runtime()]);
      setAccounts(nextAccounts);
      setRuntime(nextRuntime);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err), feedbackSection);
    } finally {
      setBusy(null);
    }
  }

  async function activateAccount(id: string) {
    await run(
      { action: "activate", id },
      () => api.activate(id),
      (result) => {
        const { codexRestart } = result;
        if (!codexRestart.attempted) {
          setNotice(null);
          return;
        }
        if (codexRestart.restarted) {
          setNotice(t("Codex.app 已自动重启,新账号已生效"));
          return;
        }
        setNotice(
          codexRestart.error ?? t("Codex.app 未能自动重启,请手动关闭并重新打开 Codex 以加载新账号"),
        );
      },
    );
  }

  async function confirmAccountAction() {
    const action = confirmAction;
    if (!action) return;
    setConfirmAction(null);
    if (action.kind === "activate") {
      await activateAccount(action.account.id);
      return;
    }
    await run({ action: "delete", id: action.account.id }, () => api.remove(action.account.id));
  }

  async function submitPasteImport() {
    await run(
      { action: "import-paste" },
      () => api.importAuthJson({ authJson, name: importName || undefined }),
      () => {
        setAuthJson("");
        setImportName("");
        setSection("accounts");
      },
    );
  }

  async function startIsolatedLogin() {
    await run({ action: "login-new" }, api.startLogin, (s) => setLoginSession(s));
  }

  function startChatGptComboLogin() {
    setAutoStartChatGptComboNonce(Date.now());
    setSection("chatgpt-add");
  }

  async function exportBackup() {
    const feedbackSection = sectionRef.current;
    const accountIds = accounts
      .filter((account) => selectedExportAccountIds.includes(account.id))
      .map((account) => account.id);
    if (accountIds.length === 0) {
      setError("请选择要导出的账号", feedbackSection);
      return;
    }
    setBusy({ action: "export-backup" });
    setError(null, feedbackSection);
    setNotice(null, feedbackSection);
    try {
      const backup = await api.exportBackup(accountIds);
      const blob = new Blob([`${JSON.stringify(backup, null, 2)}\n`], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `squirrel-switch-accounts-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice(t("已导出 {count} 个账号", { count: backup.accounts.length }), feedbackSection);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err), feedbackSection);
    } finally {
      setBusy(null);
    }
  }

  async function importBackupFile(file: File) {
    await run(
      { action: "import-backup" },
      async () => {
        const backup = JSON.parse(await file.text()) as AccountBackupPayload;
        return api.importBackup(backup);
      },
      (result) => {
        setNotice(t("已导入 {count} 个账号", { count: result.imported }));
        setSection("accounts");
      },
    );
  }

  async function renameAccount(id: string) {
    await run(
      { action: "rename", id },
      () => api.rename(id, editingName),
      () => {
        setEditingId(null);
        setEditingName("");
      },
    );
  }

  async function manageChatGptForAccount(account: AccountView) {
    const profile = findChatGptProfileForAccount(account, chatGptProfiles);
    if (!profile) {
      setPreselectedChatGptAccountId(account.id);
      setSection("chatgpt-add");
      return;
    }

    const desktop = window.squirrelSwitchDesktop;
    if (!desktop) {
      setError(t("ChatGPT 网页会话只能在 Squirrel Switch 桌面版中使用"), "accounts");
      return;
    }

    setBusy({ action: "open-chatgpt", id: account.id });
    setError(null, "accounts");
    setNotice(t("正在打开绑定的 ChatGPT 会话：{name}", { name: account.name }), "accounts");
    try {
      const result = await desktop.openChatGpt(toChatGptDesktopProfile(profile));
      if (!result.opened) {
        throw new Error(result.error ?? t("ChatGPT 窗口打开失败"));
      }
      const updated = await api.markChatGptProfileOpened(profile.id);
      setChatGptProfiles((current) => replaceChatGptProfile(current, updated));
      setNotice(t("已打开绑定的 ChatGPT 会话"), "accounts");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err), "accounts");
    } finally {
      setBusy(null);
    }
  }

  async function loadRuntimeLogs(page = runtimeLogPageNumber) {
    const feedbackSection = sectionRef.current;
    setError(null, feedbackSection);
    try {
      const nextPage = await api.runtimeLogs(page, RUNTIME_LOG_PAGE_SIZE);
      setRuntimeLogPage(nextPage);
      if (nextPage.page !== runtimeLogPageNumber) {
        setRuntimeLogPageNumber(nextPage.page);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err), feedbackSection);
    }
  }

  function appendRefreshLog(entry: Omit<RefreshLogEntry, "id" | "time">) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setRefreshLogs((logs) => [...logs, { ...entry, id, time: Date.now() }].slice(-30));
    return id;
  }

  function updateRefreshLog(
    id: string,
    patch: Partial<Pick<RefreshLogEntry, "status" | "message">>,
  ) {
    setRefreshLogs((logs) =>
      logs.map((log) => (log.id === id ? { ...log, ...patch, time: Date.now() } : log)),
    );
  }

  function applyRefreshedAccount(account: AccountView) {
    setAccounts((current) => replaceAccount(current, account));
  }

  function highlightRefreshedAccount(accountId: string) {
    setHighlightedRefreshIds((current) => {
      const next = { ...current };
      delete next[accountId];
      return next;
    });

    window.requestAnimationFrame(() => {
      const marker = Date.now();
      setHighlightedRefreshIds((current) => ({ ...current, [accountId]: marker }));
      window.setTimeout(() => {
        setHighlightedRefreshIds((current) => {
          if (current[accountId] !== marker) return current;
          const next = { ...current };
          delete next[accountId];
          return next;
        });
      }, REFRESH_HIGHLIGHT_MS);
    });
  }

  async function refreshOneAccount(account: AccountView) {
    const feedbackSection: Section = "accounts";
    setBusy({ action: "refresh", id: account.id });
    setError(null, feedbackSection);
    setNotice(null, feedbackSection);
    const logId = appendRefreshLog({
      accountId: account.id,
      accountName: account.name,
      status: "running",
      message: "正在读取限额与订阅信息",
    });
    try {
      await api.refresh(account.id);
      setAccounts(await api.accounts());
      highlightRefreshedAccount(account.id);
      updateRefreshLog(logId, { status: "success", message: t("刷新成功") });
      setNotice(t("{name} 已刷新", { name: account.name }), feedbackSection);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      updateRefreshLog(logId, { status: "error", message });
      setError(t("{name} 刷新失败：{message}", { name: account.name, message }), feedbackSection);
      highlightRefreshedAccount(account.id);
      await load({ clearError: false });
      return;
    } finally {
      void api.runtime().then(setRuntime).catch(() => undefined);
      setBusy(null);
    }
  }

  async function refreshAllAccounts() {
    const targets = accounts;
    if (targets.length === 0) return;
    const feedbackSection: Section = "accounts";
    setBusy({ action: "refresh-all" });
    setError(null, feedbackSection);
    setNotice(null, feedbackSection);
    setRefreshLogs([
      {
        id: `${Date.now()}-start`,
        accountId: null,
        accountName: t("全部账号"),
        status: "running",
        message: t("开始刷新 {count} 个账号", { count: targets.length }),
        time: Date.now(),
      },
    ]);

    let completedCount = 0;
    let successCount = 0;
    let failedCount = 0;
    let nextIndex = 0;

    async function refreshNext(): Promise<void> {
      const account = targets[nextIndex];
      nextIndex += 1;
      if (!account) return;

      const logId = appendRefreshLog({
        accountId: account.id,
        accountName: account.name,
        status: "running",
        message: t("正在读取限额与订阅信息"),
      });
      try {
        const refreshed = await api.refresh(account.id);
        successCount += 1;
        completedCount += 1;
        applyRefreshedAccount(refreshed);
        highlightRefreshedAccount(account.id);
        updateRefreshLog(logId, { status: "success", message: t("刷新成功") });
      } catch (err) {
        failedCount += 1;
        completedCount += 1;
        highlightRefreshedAccount(account.id);
        updateRefreshLog(logId, {
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
        void api
          .accounts()
          .then(setAccounts)
          .catch(() => undefined);
      }
      if (completedCount < targets.length) {
        await refreshNext();
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(REFRESH_ALL_CONCURRENCY, targets.length) }, () =>
        refreshNext(),
      ),
    );
    const nextAccounts = await api.accounts().catch(() => null);
    if (nextAccounts) {
      setAccounts(nextAccounts);
    }
    void api.runtime().then(setRuntime).catch(() => undefined);
    setNotice(t("刷新完成：成功 {success} 个，失败 {failed} 个", { success: successCount, failed: failedCount }), feedbackSection);
    setBusy(null);
  }

  async function copyRuntimeLogs(logs: RuntimeLogView[]) {
    if (logs.length === 0) return;
    const text = logs
      .map(
        (log) =>
          `${formatTime(log.time, locale)} [${runtimeLevelLabel(log.level, locale)}] ${log.scope}: ${log.message}`,
      )
      .join("\n");
    await navigator.clipboard.writeText(text);
    setNotice(t("运行日志已复制"), "logs");
  }

  const sectionTitle: Record<Section, { title: string; subtitle: string }> = {
    accounts: {
      title: t("全部账号"),
      subtitle: activeAccount ? t("当前: {name}", { name: activeAccount.name }) : t("未启用任何已保存账号"),
    },
    add: { title: t("添加账号"), subtitle: t("导入或登录新的 Codex 账号") },
    transfer: { title: t("导入导出"), subtitle: t("导出或导入跨 Mac 迁移备份") },
    "scheduled-refresh": { title: t("定时刷新"), subtitle: t("按每日时间区间刷新全部账号限额") },
    chatgpt: { title: t("全部会话"), subtitle: t("管理本机隔离 ChatGPT 网页会话") },
    "chatgpt-add": { title: t("添加会话"), subtitle: t("创建 ChatGPT 会话并按邮箱自动关联 Codex") },
    "chatgpt-backup": { title: t("导入导出"), subtitle: t("加密迁移 ChatGPT 网页登录态") },
    "chatgpt-apps": { title: t("应用同步"), subtitle: t("统一管理 ChatGPT 应用与自定义 MCP 配置") },
    "claude-code": { title: t("全部配置"), subtitle: t("Claude Code provider profile 与 settings 切换") },
    "claude-code-add": { title: t("添加配置"), subtitle: t("添加或编辑 Claude Code provider profile") },
    "claude-code-backup": { title: t("导入导出"), subtitle: t("导入导出 Claude Code profile") },
    "prompt-management": {
      title: t("提示词管理"),
      subtitle: t("管理本机官方默认全局提示词文件"),
    },
    diagnostics: { title: t("运行时"), subtitle: t("本地环境诊断与文件路径") },
    logs: { title: t("运行日志"), subtitle: t("本机服务、账号和刷新任务记录") },
    about: { title: t("关于"), subtitle: t("Squirrel Switch · 本地多账号切换助手") },
  };

  return (
    <div className="app">
      <Sidebar
        section={section}
        onChange={changeSection}
        accountCount={accounts.length}
        chatGptProfileCount={chatGptProfileCount}
        claudeCodeProfileCount={claudeCodeProfileCount}
        runtime={runtime}
      />
      <div className="main">
        <header className="topbar">
          <div className="title">
            <h1>{sectionTitle[section].title}</h1>
            <small>{sectionTitle[section].subtitle}</small>
          </div>
          <div className="toolbar">
            <LanguageSwitch locale={locale} onChange={setLocale} />
          </div>
        </header>

        {section === "accounts" && (
          <RefreshProgressBar logs={refreshLogs} busy={busy} accountCount={accounts.length} />
        )}

        <div className="content">
          {visibleError && (
            <section className="notice error">
              <AlertTriangle size={16} />
              <span>{visibleError}</span>
            </section>
          )}
          {visibleNotice && !visibleError && (
            <section className="notice success">
              <CheckCircle2 size={16} />
              <span>{visibleNotice}</span>
            </section>
          )}

          {section === "accounts" && (
            <AccountsView
              accounts={accounts}
              activeAccount={activeAccount}
              busy={busy}
              resetTimeMode={resetTimeMode}
              highlightedRefreshIds={highlightedRefreshIds}
              editingId={editingId}
              editingName={editingName}
              onEditingNameChange={setEditingName}
              onEnterEdit={(id, name) => {
                setEditingId(id);
                setEditingName(name);
              }}
              onCancelEdit={() => {
                setEditingId(null);
                setEditingName("");
              }}
              onSaveRename={renameAccount}
              onActivate={(account) => setConfirmAction({ kind: "activate", account })}
              onRefresh={(account) => void refreshOneAccount(account)}
              onRefreshAll={() => void refreshAllAccounts()}
              chatGptProfiles={chatGptProfiles}
              onManageChatGpt={(account) => void manageChatGptForAccount(account)}
              onRemove={(account) => setConfirmAction({ kind: "delete", account })}
              onToggleResetTimeMode={() =>
                setResetTimeMode((current) => (current === "relative" ? "absolute" : "relative"))
              }
              locale={locale}
            />
          )}

          {section === "add" && (
            <AddAccountView
              busy={busy}
              authJson={authJson}
              importName={importName}
              loginSession={loginSession}
              onAuthJsonChange={setAuthJson}
              onImportNameChange={setImportName}
              onImportCurrent={() => run({ action: "import-current" }, api.importCurrent)}
              onOpenLoginUrl={openLoginUrlInDesktop}
              onStartComboLogin={startChatGptComboLogin}
              onStartLogin={startIsolatedLogin}
              onSubmitPaste={submitPasteImport}
            />
          )}

          {section === "transfer" && (
            <TransferView
              accounts={accounts}
              isExporting={isBusy(busy, "export-backup")}
              isImporting={isBusy(busy, "import-backup")}
              inputRef={backupInputRef}
              selectedAccountIds={selectedExportAccountIds}
              onExport={exportBackup}
              onPickImport={() => backupInputRef.current?.click()}
              onImportFile={(file) => void importBackupFile(file)}
              onSelectAll={() => setSelectedExportAccountIds(accounts.map((account) => account.id))}
              onClearSelection={() => setSelectedExportAccountIds([])}
              onToggleAccount={(accountId) =>
                setSelectedExportAccountIds((current) =>
                  current.includes(accountId)
                    ? current.filter((id) => id !== accountId)
                    : [...current, accountId],
                )
              }
            />
          )}

          {section === "scheduled-refresh" && (
            <ScheduledRefreshPanel
              onAccountsChanged={(nextAccounts, nextRuntime) => {
                setAccounts(nextAccounts);
                setRuntime(nextRuntime);
              }}
            />
          )}

          {isChatGptSection(section) && (
            <ChatGptView
              activeTab={chatGptTabFromSection(section)}
              accounts={accounts}
              autoStartComboNonce={autoStartChatGptComboNonce}
              preselectedAccountId={preselectedChatGptAccountId}
              onAutoStartComboConsumed={() => setAutoStartChatGptComboNonce(null)}
              onPreselectedAccountConsumed={() => setPreselectedChatGptAccountId(null)}
              onAccountsChanged={() => void load({ clearError: false })}
              onProfilesChanged={(profiles) => {
                setChatGptProfiles(profiles);
                setChatGptProfileCount(profiles.length);
              }}
            />
          )}

          {section === "chatgpt-apps" && <ChatGptAppsView />}

          {section === "diagnostics" && <DiagnosticsView runtime={runtime} />}

          {isClaudeCodeSection(section) && (
            <ClaudeCodeView
              activeTab={claudeTabFromSection(section)}
              onTabChange={(next) => setSection(sectionFromClaudeTab(next))}
              onProfileCountChange={setClaudeCodeProfileCount}
            />
          )}

          {section === "prompt-management" && <PromptManagementView />}

          {section === "logs" && (
            <RuntimeLogsView
              page={runtimeLogPage}
              runtime={runtime}
              onRefresh={() => void loadRuntimeLogs()}
              onCopy={() => void copyRuntimeLogs(runtimeLogPage?.logs ?? [])}
              onPageChange={setRuntimeLogPageNumber}
            />
          )}

          {section === "about" && <AboutView />}
        </div>
      </div>
      {confirmAction && (
        <ConfirmDialog
              title={confirmAction.kind === "activate" ? t("切换账号") : t("删除账号")}
          description={
            confirmAction.kind === "activate"
              ? t("确认切换到账号「{name}」？当前 Codex 登录态会被替换，并会尝试重启正在运行的 Codex.app。", { name: confirmAction.account.name })
              : t("确认删除账号「{name}」？这只会删除本工具保存的账号记录，不会删除当前 Codex 登录态。", { name: confirmAction.account.name })
          }
          confirmLabel={confirmAction.kind === "activate" ? t("确认切换") : t("确认删除")}
          tone={confirmAction.kind === "delete" ? "danger" : "default"}
          disabled={Boolean(busy)}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => void confirmAccountAction()}
        />
      )}
    </div>
  );
}

function isClaudeCodeSection(section: Section): boolean {
  return (
    section === "claude-code" ||
    section === "claude-code-add" ||
    section === "claude-code-backup"
  );
}

function isChatGptSection(section: Section): boolean {
  return section === "chatgpt" || section === "chatgpt-add" || section === "chatgpt-backup";
}

function chatGptTabFromSection(section: Section): ChatGptTab {
  if (section === "chatgpt-add") return "add";
  if (section === "chatgpt-backup") return "backup";
  return "current";
}

function claudeTabFromSection(section: Section): ClaudeCodeTab {
  if (section === "claude-code-add") return "add";
  if (section === "claude-code-backup") return "backup";
  return "current";
}

function sectionFromClaudeTab(tab: ClaudeCodeTab): Section {
  const map: Record<ClaudeCodeTab, Section> = {
    current: "claude-code",
    add: "claude-code-add",
    backup: "claude-code-backup",
  };
  return map[tab];
}

function LanguageSwitch({
  locale,
  onChange,
}: {
  locale: AppLocale;
  onChange: (locale: AppLocale) => void;
}) {
  return (
    <div className="languageSwitch" role="group" aria-label="Language">
      <Languages size={15} aria-hidden="true" />
      <button
        type="button"
        className={locale === "zh-CN" ? "active" : ""}
        title="简体中文"
        aria-pressed={locale === "zh-CN"}
        onClick={() => onChange("zh-CN")}
      >
        中
      </button>
      <button
        type="button"
        className={locale === "en-US" ? "active" : ""}
        title="English"
        aria-pressed={locale === "en-US"}
        onClick={() => onChange("en-US")}
      >
        EN
      </button>
    </div>
  );
}

/* ============ Sidebar ============ */

function Sidebar({
  section,
  onChange,
  accountCount,
  chatGptProfileCount,
  claudeCodeProfileCount,
  runtime,
}: {
  section: Section;
  onChange: (next: Section) => void;
  accountCount: number;
  chatGptProfileCount: number;
  claudeCodeProfileCount: number;
  runtime: RuntimeStatus | null;
}) {
  const { t } = useI18n();
  return (
    <aside className="sidebar">
      <div className="brand">
        <img className="brandMark" src={appLogo} alt="" />
        <div className="brandText">
          <strong>Squirrel Switch</strong>
          <small>{t("多账号切换")}</small>
        </div>
      </div>
      <nav className="sidebarNav" aria-label={t("主导航")}>
        <NavGroup label={t("Codex 账号管理")}>
          <NavItem
            icon={Users}
            label={t("全部账号")}
            active={section === "accounts"}
            onClick={() => onChange("accounts")}
            badge={accountCount > 0 ? accountCount : undefined}
          />
          <NavItem
            icon={Plus}
            label={t("添加账号")}
            active={section === "add"}
            onClick={() => onChange("add")}
          />
          <NavItem
            icon={Upload}
            label={t("导入导出")}
            active={section === "transfer"}
            onClick={() => onChange("transfer")}
          />
          <NavItem
            icon={CalendarClock}
            label={t("定时刷新")}
            active={section === "scheduled-refresh"}
            onClick={() => onChange("scheduled-refresh")}
          />
        </NavGroup>
        <NavGroup label={t("ChatGPT 网页会话")}>
          <NavItem
            icon={MessageSquare}
            label={t("全部会话")}
            active={section === "chatgpt"}
            onClick={() => onChange("chatgpt")}
            badge={chatGptProfileCount > 0 ? chatGptProfileCount : undefined}
          />
          <NavItem
            icon={Plus}
            label={t("添加会话")}
            active={section === "chatgpt-add"}
            onClick={() => onChange("chatgpt-add")}
          />
          <NavItem
            icon={Upload}
            label={t("导入导出")}
            active={section === "chatgpt-backup"}
            onClick={() => onChange("chatgpt-backup")}
          />
          <NavItem
            icon={Link2}
            label={t("应用同步")}
            active={section === "chatgpt-apps"}
            onClick={() => onChange("chatgpt-apps")}
          />
        </NavGroup>
        <NavGroup label={t("Claude Code 配置管理")}>
          <NavItem
            icon={KeyRound}
            label={t("全部配置")}
            active={section === "claude-code"}
            onClick={() => onChange("claude-code")}
            badge={claudeCodeProfileCount > 0 ? claudeCodeProfileCount : undefined}
          />
          <NavItem
            icon={Plus}
            label={t("添加配置")}
            active={section === "claude-code-add"}
            onClick={() => onChange("claude-code-add")}
          />
          <NavItem
            icon={Download}
            label={t("导入导出")}
            active={section === "claude-code-backup"}
            onClick={() => onChange("claude-code-backup")}
          />
        </NavGroup>
        <NavGroup label={t("提示词管理")}>
          <NavItem
            icon={TextCursorInput}
            label={t("提示词管理")}
            active={section === "prompt-management"}
            onClick={() => onChange("prompt-management")}
          />
        </NavGroup>
        <NavGroup label={t("系统")}>
          <NavItem
            icon={Activity}
            label={t("运行时")}
            active={section === "diagnostics"}
            onClick={() => onChange("diagnostics")}
          />
          <NavItem
            icon={ScrollText}
            label={t("运行日志")}
            active={section === "logs"}
            onClick={() => onChange("logs")}
          />
          <NavItem
            icon={Info}
            label={t("关于")}
            active={section === "about"}
            onClick={() => onChange("about")}
          />
        </NavGroup>
      </nav>
      <div className="footer">
        <div>{t("版本 V{version}", { version: APP_VERSION })}</div>
        <div>{runtime?.codexHome ?? t("Codex Home 读取中…")}</div>
      </div>
    </aside>
  );
}

function NavGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="navGroup">
      <div className="navGroupLabel">{label}</div>
      <div className="navGroupItems">{children}</div>
    </div>
  );
}

function NavItem({
  icon: Icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: ComponentType<{ size?: number }>;
  label: string;
  active?: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button className={`navItem ${active ? "active" : ""}`} onClick={onClick}>
      <Icon size={16} />
      <span>{label}</span>
      {badge !== undefined && <span className="badge">{badge}</span>}
    </button>
  );
}

/* ============ Accounts view ============ */

function AccountsView({
  accounts,
  activeAccount,
  busy,
  resetTimeMode,
  highlightedRefreshIds,
  chatGptProfiles,
  editingId,
  editingName,
  onEditingNameChange,
  onEnterEdit,
  onCancelEdit,
  onSaveRename,
  onActivate,
  onRefresh,
  onRefreshAll,
  onManageChatGpt,
  onRemove,
  onToggleResetTimeMode,
  locale,
}: {
  accounts: AccountView[];
  activeAccount: AccountView | null;
  busy: BusyState;
  resetTimeMode: ResetTimeMode;
  highlightedRefreshIds: Record<string, number>;
  chatGptProfiles: ChatGptProfileView[];
  editingId: string | null;
  editingName: string;
  onEditingNameChange: (value: string) => void;
  onEnterEdit: (id: string, name: string) => void;
  onCancelEdit: () => void;
  onSaveRename: (id: string) => void;
  onActivate: (account: AccountView) => void;
  onRefresh: (account: AccountView) => void;
  onRefreshAll: () => void;
  onManageChatGpt: (account: AccountView) => void;
  onRemove: (account: AccountView) => void;
  onToggleResetTimeMode: () => void;
  locale: AppLocale;
}) {
  const { t } = useI18n();
  const recommendedAccountId = useMemo(() => getRecommendedAccountId(accounts), [accounts]);

  return (
    <>
      {activeAccount ? <Hero account={activeAccount} resetTimeMode={resetTimeMode} locale={locale} /> : <HeroEmpty />}

      <section className="card">
        <header className="cardHeader">
          <div className="left">
            <h2>{t("全部账号")}</h2>
            <span className="count">{t("{count} 个", { count: accounts.length })}</span>
          </div>
          <div className="actions">
            <button
              className="primary"
              disabled={Boolean(busy) || accounts.length === 0}
              onClick={onRefreshAll}
            >
              <RefreshCcw
                className={isBusy(busy, "refresh-all") ? "spin" : undefined}
                size={14}
              />
              {t("刷新全部")}
            </button>
          </div>
        </header>
        <div className="cardBody tight">
          {accounts.length === 0 ? (
            <div className="empty">{t("暂无账号,请前往“添加账号”导入")}</div>
          ) : (
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("状态")}</th>
                    <th>{t("账号")}</th>
                    <th>{t("计划")}</th>
                    <th>{t("5 小时限额")}</th>
                    <th>{t("周/月限额")}</th>
                    <th>
                      <span className="resetHeader">
                        <span>{t("重置")}</span>
                        <button
                          className="resetModeButton"
                          type="button"
                          title={
                            resetTimeMode === "relative" ? t("切换为准确日期") : t("切换为剩余时长")
                          }
                          onClick={onToggleResetTimeMode}
                        >
                          {resetTimeMode === "relative" ? t("剩余时长") : t("准确日期")}
                        </button>
                      </span>
                    </th>
                    <th>{t("上次刷新")}</th>
                    <th>{t("会员到期")}</th>
                    <th style={{ textAlign: "right" }}>{t("操作")}</th>
                  </tr>
                </thead>
                <tbody>
                {accounts.map((account) => {
                  const isRecommended = account.id === recommendedAccountId;
                  const linkedChatGptProfile = findChatGptProfileForAccount(account, chatGptProfiles);
                  return (
                      <tr
                        key={account.id}
                        className={[
                          account.isActive ? "active" : "",
                          highlightedRefreshIds[account.id] ? "refreshSweep" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <td>
                          <span className="statusStack">
                            <StatusPill account={account} />
                            {isRecommended ? (
                              <span
                                className="recommendBadge"
                                title={formatRecommendationReason(account, locale)}
                              >
                                {t("推荐")}
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td>
                          {editingId === account.id ? (
                            <span className="rename">
                              <input
                                autoFocus
                                value={editingName}
                                onChange={(event) => onEditingNameChange(event.target.value)}
                              />
                              <button onClick={() => onSaveRename(account.id)}>{t("保存")}</button>
                              <button className="ghost" onClick={onCancelEdit}>
                                {t("取消")}
                              </button>
                            </span>
                          ) : (
                            <span className="identity">
                              <span className="identityNameRow">
                                <strong>{account.name}</strong>
                              </span>
                              <span className="identityMetaRow">
                                <small>{account.email || account.accountId || t("未识别")}</small>
                              </span>
                            </span>
                          )}
                        </td>
                        <td>{planLabel(account.planType || account.subscriptionPlan)}</td>
                        <td>
                          <UsageCell window={account.usage?.primary} />
                        </td>
                        <td>
                          <UsageCell window={account.usage?.secondary} />
                        </td>
                        <td className="resetCellColumn">
                          <ResetCell account={account} mode={resetTimeMode} locale={locale} />
                        </td>
                        <td>{formatLastRefreshedAt(account.lastRefreshedAt, locale)}</td>
                        <td>{formatSubscription(account, locale)}</td>
                        <td>
                          <div className="rowActions">
                            <IconButton
                              title={t("启用")}
                              disabled={isBusy(busy, "activate", account.id) || account.isActive}
                              onClick={() => onActivate(account)}
                            >
                              <Play size={14} />
                            </IconButton>
                            <IconButton
                              title={t("刷新")}
                              disabled={isAccountRefreshBusy(busy, account.id)}
                              onClick={() => onRefresh(account)}
                            >
                              <RefreshCcw
                                className={
                                  isAccountRefreshBusy(busy, account.id) ? "spin" : undefined
                                }
                                size={14}
                              />
                            </IconButton>
                            <IconButton
                              title={
                                linkedChatGptProfile
                                  ? t("打开绑定的 ChatGPT")
                                  : t("添加 ChatGPT 会话")
                              }
                              disabled={Boolean(busy)}
                              onClick={() => onManageChatGpt(account)}
                            >
                              <MessageSquare size={14} />
                            </IconButton>
                            <IconButton
                              title={t("编辑名称")}
                              onClick={() => onEnterEdit(account.id, account.name)}
                            >
                              <Pencil size={14} />
                            </IconButton>
                            <IconButton
                              className="danger"
                              title={t("删除")}
                              disabled={isBusy(busy, "delete", account.id)}
                              onClick={() => onRemove(account)}
                            >
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
    </>
  );
}

function Hero({
  account,
  resetTimeMode,
  locale,
}: {
  account: AccountView;
  resetTimeMode: ResetTimeMode;
  locale: AppLocale;
}) {
  const { t } = useI18n();
  const primaryReset = formatResetDisplay(account.usage?.primary?.resetsAt, resetTimeMode, locale);
  const secondaryReset = formatResetDisplay(account.usage?.secondary?.resetsAt, resetTimeMode, locale);
  const resetCreditText = formatResetCreditText(account.usage?.resetAvailableCount, locale);
  return (
    <section className="hero">
      <div className="heroIdentity">
        <span className="label">{t("当前账号")}</span>
        <strong>{account.name}</strong>
        <small>{account.email || account.accountId || t("未识别")}</small>
      </div>
      <HeroMetric
        label={t("计划")}
        value={planLabel(account.planType || account.subscriptionPlan)}
        sub={
          account.subscriptionExpiresAt
            ? t("到期 {time}", { time: formatTime(account.subscriptionExpiresAt, locale) })
            : account.subscriptionRenewsAt
              ? t("续费 {time}", { time: formatTime(account.subscriptionRenewsAt, locale) })
              : t("订阅信息不可用")
        }
      />
      <HeroMetric
        label={t("5 小时限额")}
        value={formatPercent(account.usage?.primary?.remainingPercent)}
        sub={
          primaryReset
            ? (
              <span title={primaryReset.title}>
                {formatResetTextWithSuffix(primaryReset.text, locale)}
              </span>
            )
            : t("无数据")
        }
      />
      <HeroMetric
        label={t("周/月限额")}
        value={formatPercent(account.usage?.secondary?.remainingPercent)}
        sub={
          secondaryReset
            ? (
              <span title={secondaryReset.title}>
                {t("周限额")}：{formatResetTextWithSuffix(secondaryReset.text, locale)}
                {resetCreditText ? <>；{resetCreditText}</> : null}
              </span>
            )
            : resetCreditText ?? t("无数据")
        }
      />
    </section>
  );
}

function HeroEmpty() {
  const { t } = useI18n();
  return <div className="heroEmpty">{t("当前未启用任何已保存账号,可在下方列表中选择一个启用。")}</div>;
}

function HeroMetric({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="heroMetric">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
}

function StatusPill({ account }: { account: AccountView }) {
  const { t } = useI18n();
  if (account.isActive) return <span className="pill active">{t("当前")}</span>;
  if (account.usage?.error) {
    return (
      <span className="pill warn" title={account.usage.error}>
        {t("需检查")}
      </span>
    );
  }
  return <span className="pill">{t("可用")}</span>;
}

function UsageCell({ window }: { window: RateLimitWindowView | null | undefined }) {
  const { t } = useI18n();
  const remaining = window?.remainingPercent;
  if (typeof remaining !== "number") {
    return <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("无法获取")}</span>;
  }
  const clamped = Math.max(0, Math.min(100, remaining));
  return (
    <div className="metric">
      <strong>{Math.round(remaining)}%</strong>
      <div className="bar muted">
        <span style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

function ResetCell({ account, mode, locale }: { account: AccountView; mode: ResetTimeMode; locale: AppLocale }) {
  const { t } = useI18n();
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null);
  const primary = account.usage?.primary?.resetsAt;
  const secondary = account.usage?.secondary;
  const primaryReset = formatResetDisplay(primary, mode, locale);
  const secondaryReset = formatResetDisplay(secondary?.resetsAt, mode, locale);
  const resetAvailableCount = account.usage?.resetAvailableCount;
  const tooltipLines = formatResetTooltipLines(account, mode, locale);
  if (!primary && !secondary) {
    return <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("无法获取")}</span>;
  }
  return (
    <div
      className="metric resetMetric"
      onMouseEnter={(event) => setTooltipPosition({ x: event.clientX, y: event.clientY })}
      onMouseMove={(event) => setTooltipPosition({ x: event.clientX, y: event.clientY })}
      onMouseLeave={() => setTooltipPosition(null)}
    >
      <ResetLine label={t("5H限额")} reset={primaryReset} locale={locale} />
      <ResetLine
        label={formatSecondaryLimitLabel(secondary, locale)}
        reset={secondaryReset}
        locale={locale}
      />
      <ResetCountLine count={resetAvailableCount} locale={locale} />
      {tooltipPosition && (
        <div
          className="resetTooltip"
          role="tooltip"
          style={{ left: tooltipPosition.x + 12, top: tooltipPosition.y + 12 }}
        >
          {tooltipLines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function ResetCountLine({ count, locale }: { count: number | null | undefined; locale: AppLocale }) {
  const value = formatResetCreditValue(count, locale);
  if (!value) return null;
  return (
    <small className="resetLine">
      <span className="resetPeriod">{translateInline("可用重置", locale)}</span>
      <span className="resetDivider">：</span>
      <span className="resetValue">{value}</span>
    </small>
  );
}

function ResetLine({
  label,
  reset,
  locale,
}: {
  label: string;
  reset: ReturnType<typeof formatResetDisplay>;
  locale: AppLocale;
}) {
  return (
    <small className="resetLine">
      <span className="resetPeriod">{label}</span>
      <span className="resetDivider">：</span>
      <span className="resetValue">
        {reset ? formatResetTextWithSuffix(reset.text, locale) : "—"}
      </span>
    </small>
  );
}

/* ============ Add account view ============ */

function AddAccountView({
  busy,
  authJson,
  importName,
  loginSession,
  onAuthJsonChange,
  onImportNameChange,
  onImportCurrent,
  onOpenLoginUrl,
  onStartComboLogin,
  onStartLogin,
  onSubmitPaste,
}: {
  busy: BusyState;
  authJson: string;
  importName: string;
  loginSession: LoginSessionView | null;
  onAuthJsonChange: (value: string) => void;
  onImportNameChange: (value: string) => void;
  onImportCurrent: () => void;
  onOpenLoginUrl: (sessionId: string, url: string) => Promise<void>;
  onStartComboLogin: () => void;
  onStartLogin: () => void;
  onSubmitPaste: () => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <section className="addGrid">
        <div className="addCard">
          <div className="icon">
            <Download size={18} />
          </div>
          <h3>{t("导入当前 Codex 登录态")}</h3>
          <p>{t("从 ~/.codex/auth.json 读取当前已登录的账号,保存到本工具。")}</p>
          <button
            className="primary"
            disabled={isBusy(busy, "import-current")}
            onClick={onImportCurrent}
          >
            <FileJson size={14} />
            {t("导入当前")}
          </button>
        </div>

        <div className="addCard">
          <div className="icon">
            <LogIn size={18} />
          </div>
          <h3>{t("推荐：组合登录")}</h3>
          <p>{t("先登录 ChatGPT，再自动复用同一浏览器完成 Codex OAuth。")}</p>
          <div className="addCardActions">
            <button
              className="primary"
              disabled={Boolean(busy)}
              onClick={onStartComboLogin}
            >
              <Link2 size={14} />
              {t("组合登录 GPT+Codex")}
            </button>
            <button
              disabled={isBusy(busy, "login-new")}
              onClick={onStartLogin}
            >
              <LogIn size={14} />
              {t("单独登录 Codex")}
            </button>
          </div>
          {loginSession && (
            <LoginSessionCard session={loginSession} onOpenLoginUrl={onOpenLoginUrl} />
          )}
        </div>

        <div className="addCard">
          <div className="icon">
            <ClipboardPaste size={18} />
          </div>
          <h3>{t("粘贴 auth.json")}</h3>
          <p>{t("从其他设备复制现成的 auth.json,粘贴后保存为新账号。")}</p>
          <input
            value={importName}
            onChange={(event) => onImportNameChange(event.target.value)}
            placeholder={t("备注名(可选)")}
          />
          <textarea
            value={authJson}
            onChange={(event) => onAuthJsonChange(event.target.value)}
            spellCheck={false}
            placeholder='{ "OPENAI_API_KEY": "...", "tokens": { ... } }'
          />
          <button
            className="primary"
            disabled={!authJson.trim() || isBusy(busy, "import-paste")}
            onClick={onSubmitPaste}
          >
            <FileJson size={14} />
            {t("保存账号")}
          </button>
        </div>
      </section>

      <div className="hint">
        <AlertTriangle size={14} />
        <span>
          {t("auth.json 属于敏感凭据,本工具仅在本机以 AES-256-GCM 加密保存,不会上传任何服务器。订阅信息接口失败时不影响账号切换。")}
        </span>
      </div>
    </>
  );
}

function LoginSessionCard({
  session,
  onOpenLoginUrl,
}: {
  session: LoginSessionView;
  onOpenLoginUrl: (sessionId: string, url: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const copyVerificationUrl = () => {
    if (!session.verificationUrl) return;
    void navigator.clipboard.writeText(session.verificationUrl);
  };

  return (
    <div className={`loginBox ${session.status}`}>
      <strong>
        {session.status === "running"
          ? t("等待应用内授权")
          : session.status === "imported"
            ? t("登录成功并已导入")
            : t("登录失败")}
      </strong>
      <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{session.message}</span>
      {session.verificationUrl && (
        <div className="loginUrlPanel">
          <div className="loginUrlActions">
            <button type="button" onClick={() => void onOpenLoginUrl(session.id, session.verificationUrl!)}>
              {t("打开窗口")}
            </button>
            <button type="button" onClick={copyVerificationUrl}>
              {t("复制链接")}
            </button>
          </div>
          <code>{session.verificationUrl}</code>
        </div>
      )}
      {session.userCode && <code>{session.userCode}</code>}
      <small>{session.codexHome}</small>
    </div>
  );
}

/* ============ Diagnostics ============ */

function DiagnosticsView({ runtime }: { runtime: RuntimeStatus | null }) {
  const { t } = useI18n();
  return (
    <>
      <section className="statusGrid">
        <StatusTile
          ok={Boolean(runtime?.authJsonExists)}
          label="auth.json"
          sub={runtime?.authJsonExists ? t("已存在") : t("不存在")}
        />
        <StatusTile
          ok={Boolean(runtime?.codexBinaryAvailable)}
          label={t("codex 二进制")}
          sub={runtime?.codexBinaryPath ?? t("未找到")}
        />
        <StatusTile
          ok={Boolean(runtime?.appServerAvailable)}
          label="app-server"
          sub={runtime?.appServerAvailable ? t("可调用") : t("不可用")}
        />
        <StatusTile
          ok={Boolean(runtime?.keychainAvailable)}
          label="Keychain"
          sub={runtime?.keychainAvailable ? t("可访问") : t("回退到本地密钥")}
        />
      </section>

      <section className="card">
        <header className="cardHeader">
          <div className="left">
            <h2>{t("路径与配置")}</h2>
          </div>
        </header>
        <div className="cardBody">
          <dl className="kv">
            <dt>Codex Home</dt>
            <dd>{runtime?.codexHome ?? "—"}</dd>
            <dt>{t("auth.json 路径")}</dt>
            <dd>{runtime?.codexHome ? `${runtime.codexHome}/auth.json` : "—"}</dd>
            <dt>{t("codex 二进制")}</dt>
            <dd>{runtime?.codexBinaryPath ?? "—"}</dd>
            <dt>{t("数据库")}</dt>
            <dd>{runtime?.databasePath ?? "—"}</dd>
            <dt>{t("运行日志")}</dt>
            <dd>{runtime?.runtimeLogPath ?? "—"}</dd>
          </dl>
        </div>
      </section>
    </>
  );
}

function RuntimeLogsView({
  page,
  runtime,
  onRefresh,
  onCopy,
  onPageChange,
}: {
  page: RuntimeLogPageView | null;
  runtime: RuntimeStatus | null;
  onRefresh: () => void;
  onCopy: () => void;
  onPageChange: (page: number) => void;
}) {
  const { t, locale } = useI18n();
  const logs = page?.logs ?? [];
  const total = page?.total ?? 0;
  const currentPage = page?.page ?? 1;
  const totalPages = page?.totalPages ?? 1;
  const start = total === 0 ? 0 : (currentPage - 1) * (page?.pageSize ?? RUNTIME_LOG_PAGE_SIZE) + 1;
  const end = total === 0 ? 0 : start + logs.length - 1;

  return (
    <section className="card">
      <header className="cardHeader">
        <div className="left">
          <h2>{t("运行日志")}</h2>
          <span className="count">{t("{count} 条", { count: total })}</span>
        </div>
        <div className="actions">
          <button onClick={onRefresh}>
            <RefreshCcw size={14} />
            {t("刷新")}
          </button>
          <button className="ghost" disabled={logs.length === 0} onClick={onCopy}>
            <ClipboardPaste size={14} />
            {t("复制")}
          </button>
        </div>
      </header>
      <div className="logPath">{runtime?.runtimeLogPath ?? t("运行日志路径读取中…")}</div>
      <div className="cardBody tight">
        {logs.length === 0 ? (
          <div className="empty">{t("暂无运行日志")}</div>
        ) : (
          <>
            <div className="runtimeLogList">
              {logs.map((log) => (
                <div key={log.id} className={`runtimeLog ${log.level}`}>
                  <time>{formatTime(log.time, locale)}</time>
                  <span className="runtimeLogLevel">{runtimeLevelLabel(log.level, locale)}</span>
                  <strong>{log.scope}</strong>
                  <span>{log.message}</span>
                </div>
              ))}
            </div>
            <div className="paginationBar">
              <span>
                {start}-{end} / {total}
              </span>
              <div className="paginationControls">
                <button
                  className="iconButton"
                  disabled={currentPage <= 1}
                  onClick={() => onPageChange(currentPage - 1)}
                  title={t("上一页")}
                  aria-label={t("上一页")}
                >
                  <ChevronLeft size={16} />
                </button>
                <strong>
                  {t("第 {current} / {total} 页", { current: currentPage, total: totalPages })}
                </strong>
                <button
                  className="iconButton"
                  disabled={currentPage >= totalPages}
                  onClick={() => onPageChange(currentPage + 1)}
                  title={t("下一页")}
                  aria-label={t("下一页")}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function StatusTile({ ok, label, sub }: { ok: boolean; label: string; sub: string }) {
  return (
    <div className={`statusTile ${ok ? "ok" : "warn"}`}>
      <span className="dot" />
      <div className="meta">
        <strong>{label}</strong>
        <small>{sub}</small>
      </div>
    </div>
  );
}

/* ============ Generic helpers ============ */

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

function isBusy(busy: BusyState, action: string, id?: string) {
  if (!busy) return false;
  if (busy.action !== action) return false;
  if (id === undefined) return busy.id === undefined;
  return busy.id === id;
}

function isAccountRefreshBusy(busy: BusyState, id: string) {
  return isBusy(busy, "refresh-all") || isBusy(busy, "refresh", id);
}

function replaceAccount(accounts: AccountView[], account: AccountView) {
  const replaced = accounts.map((candidate) => (candidate.id === account.id ? account : candidate));
  if (!replaced.some((candidate) => candidate.id === account.id)) {
    replaced.push(account);
  }
  return replaced;
}

function runtimeLevelLabel(level: RuntimeLogView["level"], locale: AppLocale) {
  const map: Record<RuntimeLogView["level"], string> = {
    info: locale === "en-US" ? "Info" : "信息",
    warn: locale === "en-US" ? "Warning" : "警告",
    error: locale === "en-US" ? "Error" : "错误",
  };
  return map[level];
}

function planLabel(value: string | null | undefined) {
  if (!value) return "Unknown";
  const map: Record<string, string> = {
    free: "Free",
    go: "Go",
    plus: "Plus",
    pro: "Pro",
    prolite: "Pro Lite",
    team: "Team",
    business: "Business",
    enterprise: "Enterprise",
    edu: "Edu",
    unknown: "Unknown",
  };
  return map[value.toLowerCase()] ?? value;
}

function formatPercent(value: number | null | undefined) {
  return typeof value === "number" ? `${Math.round(value)}%` : "—";
}

function formatSubscription(account: AccountView, locale: AppLocale) {
  const label = (text: string) => translateInline(text, locale);
  if (account.planType?.toLowerCase() === "free") return "—";
  if (account.subscriptionExpiresAt) return formatTime(account.subscriptionExpiresAt, locale);
  if (account.subscriptionRenewsAt) return formatTime(account.subscriptionRenewsAt, locale);
  if (account.planType && account.planType !== "free" && account.planType !== "unknown") {
    return <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{label("到期未知")}</span>;
  }
  return (
    <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
      {account.subscriptionError ? label("接口不可用") : label("无法获取")}
    </span>
  );
}

function formatLastRefreshedAt(value: number | null | undefined, locale: AppLocale) {
  if (value) {
    return (
      <span title={formatTime(value, locale)}>
        {formatRelativePastTime(value, locale)}
      </span>
    );
  }
  return <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{translateInline("未刷新", locale)}</span>;
}

function formatRelativePastTime(value: number, locale: AppLocale) {
  const secondsAgo = Math.max(0, Math.floor(Date.now() / 1000 - value));
  if (secondsAgo < 60) return translateInline("刚刚", locale);
  const minutesAgo = Math.floor(secondsAgo / 60);
  if (minutesAgo < 60) return translateInline("{count} 分钟前", locale, { count: minutesAgo });
  const hoursAgo = Math.floor(minutesAgo / 60);
  if (hoursAgo < 24) return translateInline("{count} 小时前", locale, { count: hoursAgo });
  const daysAgo = Math.floor(hoursAgo / 24);
  return translateInline("{count} 天前", locale, { count: daysAgo });
}

function formatResetDisplay(value: number | null | undefined, mode: ResetTimeMode, locale: AppLocale) {
  if (!value) return null;
  const relative = formatResetAfter(value, locale);
  const absolute = formatCompactResetTime(value, locale);
  return mode === "relative"
    ? { text: relative, title: `${formatFullTime(value, locale)}${translateInline("重置", locale)}` }
    : { text: absolute, title: `${relative}${translateInline("重置", locale)}` };
}

function formatResetTextWithSuffix(text: string, locale: AppLocale) {
  return locale === "en-US" ? `${text} reset` : `${text}重置`;
}

function formatResetTooltipLines(account: AccountView, mode: ResetTimeMode, locale: AppLocale) {
  const lines = [
    formatLimitWindowTooltip(translateInline("5 小时限额", locale), account.usage?.primary, mode, locale),
    formatLimitWindowTooltip(
      formatSecondaryLimitTitle(account.usage?.secondary, locale),
      account.usage?.secondary,
      mode,
      locale,
    ),
  ];
  const resetCreditText = formatResetCreditText(account.usage?.resetAvailableCount, locale);
  if (resetCreditText) {
    lines.push(resetCreditText);
  }
  return lines;
}

function formatResetCreditText(count: number | null | undefined, locale: AppLocale) {
  const value = formatResetCreditValue(count, locale);
  return value ? `${translateInline("可用重置", locale)}${locale === "en-US" ? ": " : "："}${value}` : null;
}

function formatResetCreditValue(count: number | null | undefined, locale: AppLocale) {
  if (typeof count !== "number" || count <= 0) return null;
  return locale === "en-US" ? `${count}` : `${count} 次`;
}

function formatLimitWindowTooltip(
  label: string,
  window: RateLimitWindowView | null | undefined,
  mode: ResetTimeMode,
  locale: AppLocale,
) {
  if (!window) return `${label}: ${translateInline("无数据", locale)}`;
  const reset = formatOppositeResetTooltip(window.resetsAt, mode, locale);
  return `${label}: ${reset}`;
}

function formatOppositeResetTooltip(value: number | null | undefined, mode: ResetTimeMode, locale: AppLocale) {
  if (!value) return translateInline("重置时间无法获取", locale);
  return mode === "relative" ? formatFullTime(value, locale) : `${formatResetAfter(value, locale)}${translateInline("重置", locale)}`;
}

function formatSecondaryLimitLabel(window: RateLimitWindowView | null | undefined, locale: AppLocale) {
  return window?.windowMinutes === 43200 ? translateInline("月限额", locale) : translateInline("周限额", locale);
}

function formatSecondaryLimitTitle(window: RateLimitWindowView | null | undefined, locale: AppLocale) {
  return window?.windowMinutes === 43200 ? translateInline("月限额", locale) : translateInline("周限额", locale);
}

function formatResetAfter(value: number, locale: AppLocale) {
  if (!value) return "—";
  const secondsUntil = value - Math.floor(Date.now() / 1000);
  if (secondsUntil <= 0) return translateInline("现在", locale);
  if (secondsUntil < 60) return translateInline("1 分钟后", locale);

  const minutesUntil = Math.ceil(secondsUntil / 60);
  if (minutesUntil < 60) return translateInline("{count} 分钟后", locale, { count: minutesUntil });
  if (minutesUntil < 24 * 60) return translateInline("{count} 小时后", locale, { count: Math.ceil(minutesUntil / 60) });
  return translateInline("{count} 天后", locale, { count: Math.ceil(minutesUntil / (24 * 60)) });
}

function formatCompactResetTime(value: number, locale: AppLocale) {
  const date = new Date(value * 1000);
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = isSameDate(date, now)
    ? {
        hour: "2-digit",
        minute: "2-digit",
      }
    : {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      };
  return new Intl.DateTimeFormat(locale, options).format(date);
}

function isSameDate(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatFullTime(value: number | null | undefined, locale: AppLocale) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value * 1000));
}

function formatTime(value: number | null | undefined, locale: AppLocale) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value * 1000));
}

function findChatGptProfileForAccount(
  account: AccountView,
  profiles: ChatGptProfileView[],
): ChatGptProfileView | null {
  const accountEmail = account.email?.trim().toLowerCase();
  return (
    profiles.find((profile) => {
      if (profile.linkedCodexAccountId === account.id) {
        return true;
      }
      return Boolean(
        accountEmail && profile.linkedCodexEmail?.trim().toLowerCase() === accountEmail,
      );
    }) ?? null
  );
}

function toChatGptDesktopProfile(profile: ChatGptProfileView): ChatGptDesktopProfileInput {
  return {
    id: profile.id,
    displayName: profile.displayName,
    linkedCodexEmail: profile.linkedCodexEmail,
    accountEmail: profile.accountEmail,
    accountId: profile.accountId,
    planLabel: profile.planLabel,
    browserKind: profile.browserKind,
    browserExecutablePath: profile.browserExecutablePath,
    browserProfileDir: profile.browserProfileDir,
  };
}

function replaceChatGptProfile(
  profiles: ChatGptProfileView[],
  updated: ChatGptProfileView,
): ChatGptProfileView[] {
  return profiles.map((profile) => (profile.id === updated.id ? updated : profile));
}

function translateInline(text: string, locale: AppLocale, values?: Record<string, string | number>) {
  const dictionary: Record<string, string> = {
    "到期未知": "Expiry unknown",
    "接口不可用": "API unavailable",
    "无法获取": "Unavailable",
    "未刷新": "Never",
    "刚刚": "Just now",
    "{count} 分钟前": "{count} min ago",
    "{count} 小时前": "{count}h ago",
    "{count} 天前": "{count}d ago",
    "重置": " reset",
    "无数据": "No data",
    "重置时间无法获取": "Reset time unavailable",
    "5 小时限额": "5H limit",
    "月限额": "Monthly limit",
    "周限额": "Weekly limit",
    "可用重置": "Available resets",
    "现在": "Now",
    "1 分钟后": "in 1 min",
    "{count} 分钟后": "in {count} min",
    "{count} 小时后": "in {count}h",
    "{count} 天后": "in {count}d",
  };
  const template = locale === "en-US" ? dictionary[text] ?? text : text;
  return values
    ? template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`))
    : template;
}
