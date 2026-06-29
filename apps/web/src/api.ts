import type {
  AccountView,
  ActivateAccountResult,
  AccountBackupPayload,
  ApiResult,
  ExportAccountBackupPayload,
  ImportAuthJsonPayload,
  ImportAccountBackupResult,
  ApplyClaudeCodeProfilePayload,
  ClaudeCodeApplicationView,
  ClaudeCodeBackupPayload,
  ClaudeCodeProfileView,
  ClaudeCodeProviderTemplate,
  ChatGptAppConfigManagementState,
  ChatGptAppConfigView,
  ChatGptProfileView,
  CreateChatGptProfilePayload,
  ChatGptAccountStatusInput,
  ChatGptAccountStatusView,
  ImportClaudeCodeBackupResult,
  ImportChatGptProfilesPayload,
  ImportChatGptProfilesResult,
  LoginSessionView,
  PromptManagementState,
  PromptPlatformState,
  RevertClaudeCodeApplicationPayload,
  RuntimeLogPageView,
  RuntimeStatus,
  ScheduledRefreshState,
  UpdateChatGptAppSyncStatusPayload,
  UpdateScheduledRefreshConfigPayload,
  UpdatePlatformPromptParams,
  UpdateSystemPromptParams,
  UpsertChatGptAppConfigPayload,
  UpsertChatGptProfilePayload,
  UpsertClaudeCodeProfilePayload,
} from "@squirrel-switch/shared";
import { currentLocale } from "./i18n.js";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body !== undefined && init?.body !== null;
  const baseHeaders: Record<string, string> = hasBody ? { "Content-Type": "application/json" } : {};
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...baseHeaders,
        ...init?.headers,
      },
    });
  } catch (error) {
    throw new Error(
      currentLocale() === "en-US"
        ? `${path} network request failed: ${error instanceof Error ? error.message : String(error)}`
        : `${path} 网络请求失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const body = (await response.json().catch(() => null)) as
    | ApiResult<T>
    | { error?: { message?: string } }
    | { message?: string }
    | null;
  if (!response.ok) {
    const message =
      body && "error" in body
        ? body.error?.message
        : body && "message" in body
          ? body.message
          : null;
    throw new Error(
      message ||
        (currentLocale() === "en-US"
          ? `${path} request failed: HTTP ${response.status}`
          : `${path} 请求失败：HTTP ${response.status}`),
    );
  }
  if (!body || !("data" in body)) {
    throw new Error(
      currentLocale() === "en-US"
        ? `${path} returned an invalid response`
        : `${path} 响应格式不正确`,
    );
  }
  return (body as ApiResult<T>).data;
}

export const api = {
  accounts: () => request<AccountView[]>("/api/accounts"),
  runtime: () => request<RuntimeStatus>("/api/runtime/status"),
  runtimeLogs: (page: number, pageSize: number) =>
    request<RuntimeLogPageView>(`/api/runtime/logs?page=${page}&pageSize=${pageSize}`),
  promptManagement: () => request<PromptManagementState>("/api/prompt-management"),
  scheduledRefresh: () => request<ScheduledRefreshState>("/api/scheduled-refresh"),
  updateScheduledRefresh: (payload: UpdateScheduledRefreshConfigPayload) =>
    request<ScheduledRefreshState>("/api/scheduled-refresh", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  runScheduledRefreshNow: () =>
    request<ScheduledRefreshState>("/api/scheduled-refresh/run-now", { method: "POST" }),
  updateSystemPrompt: (payload: UpdateSystemPromptParams) =>
    request<PromptManagementState>("/api/prompt-management/system", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  updatePlatformPrompt: (platformId: PromptPlatformState["id"], payload: UpdatePlatformPromptParams) =>
    request<PromptPlatformState>(`/api/prompt-management/platforms/${platformId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  importCurrent: () => request<AccountView>("/api/accounts/import-current", { method: "POST" }),
  importAuthJson: (payload: ImportAuthJsonPayload) =>
    request<AccountView>("/api/accounts/import-auth-json", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  exportBackup: (accountIds: string[]) =>
    request<AccountBackupPayload>("/api/accounts/export-backup", {
      method: "POST",
      body: JSON.stringify({ accountIds } satisfies ExportAccountBackupPayload),
    }),
  importBackup: (payload: AccountBackupPayload) =>
    request<ImportAccountBackupResult>("/api/accounts/import-backup", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  activate: (id: string) =>
    request<ActivateAccountResult>(`/api/accounts/${id}/activate`, { method: "POST" }),
  refresh: (id: string) => request<AccountView>(`/api/accounts/${id}/refresh`, { method: "POST" }),
  refreshAll: () => request<AccountView[]>("/api/accounts/refresh-all", { method: "POST" }),
  rename: (id: string, name: string) =>
    request<AccountView>(`/api/accounts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  remove: (id: string) =>
    request<{ ok: true }>(`/api/accounts/${id}`, {
      method: "DELETE",
    }),
  startLogin: () => request<LoginSessionView>("/api/login-sessions", { method: "POST" }),
  loginSession: (id: string) => request<LoginSessionView>(`/api/login-sessions/${id}`),
  chatGptProfiles: () =>
    request<ChatGptProfileView[]>("/api/platforms/chatgpt/profiles"),
  chatGptAppConfigs: () =>
    request<ChatGptAppConfigManagementState>("/api/platforms/chatgpt/app-configs"),
  createChatGptAppConfig: (payload: UpsertChatGptAppConfigPayload) =>
    request<ChatGptAppConfigView>("/api/platforms/chatgpt/app-configs", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateChatGptAppConfig: (id: string, payload: UpsertChatGptAppConfigPayload) =>
    request<ChatGptAppConfigView>(`/api/platforms/chatgpt/app-configs/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteChatGptAppConfig: (id: string) =>
    request<{ ok: true }>(`/api/platforms/chatgpt/app-configs/${id}`, {
      method: "DELETE",
    }),
  updateChatGptAppSyncStatus: (
    configId: string,
    profileId: string,
    payload: UpdateChatGptAppSyncStatusPayload,
  ) =>
    request<ChatGptAppConfigView>(
      `/api/platforms/chatgpt/app-configs/${configId}/profiles/${profileId}/status`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ),
  createChatGptProfile: (payload: CreateChatGptProfilePayload) =>
    request<ChatGptProfileView>("/api/platforms/chatgpt/profiles", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  importChatGptProfiles: (payload: ImportChatGptProfilesPayload) =>
    request<ImportChatGptProfilesResult>("/api/platforms/chatgpt/profiles/import", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateChatGptProfile: (id: string, payload: UpsertChatGptProfilePayload) =>
    request<ChatGptProfileView>(`/api/platforms/chatgpt/profiles/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  checkChatGptProfile: (id: string, payload: ChatGptAccountStatusInput) =>
    request<ChatGptAccountStatusView>(`/api/platforms/chatgpt/profiles/${id}/check`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  markChatGptProfileOpened: (id: string) =>
    request<ChatGptProfileView>(`/api/platforms/chatgpt/profiles/${id}/opened`, {
      method: "POST",
    }),
  markChatGptProfileExported: (id: string, sessionHash: string | null) =>
    request<ChatGptProfileView>(`/api/platforms/chatgpt/profiles/${id}/exported`, {
      method: "POST",
      body: JSON.stringify({ sessionHash }),
    }),
  deleteChatGptProfile: (id: string) =>
    request<{ ok: true }>(`/api/platforms/chatgpt/profiles/${id}`, {
      method: "DELETE",
    }),
  claudeCodeProviders: () =>
    request<ClaudeCodeProviderTemplate[]>("/api/platforms/claude-code/providers"),
  claudeCodeProfiles: () =>
    request<ClaudeCodeProfileView[]>("/api/platforms/claude-code/profiles"),
  createClaudeCodeProfile: (payload: UpsertClaudeCodeProfilePayload) =>
    request<ClaudeCodeProfileView>("/api/platforms/claude-code/profiles", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateClaudeCodeProfile: (id: string, payload: UpsertClaudeCodeProfilePayload) =>
    request<ClaudeCodeProfileView>(`/api/platforms/claude-code/profiles/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteClaudeCodeProfile: (id: string) =>
    request<{ ok: true }>(`/api/platforms/claude-code/profiles/${id}`, {
      method: "DELETE",
    }),
  applyClaudeCodeProfile: (id: string, payload: ApplyClaudeCodeProfilePayload) =>
    request<ClaudeCodeApplicationView>(`/api/platforms/claude-code/profiles/${id}/apply`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  launchClaudeCodeProfile: (id: string, workingDirectory?: string) =>
    request<ClaudeCodeApplicationView>(`/api/platforms/claude-code/profiles/${id}/launch`, {
      method: "POST",
      body: JSON.stringify({ workingDirectory }),
    }),
  claudeCodeApplications: () =>
    request<ClaudeCodeApplicationView[]>("/api/platforms/claude-code/applications"),
  revertClaudeCodeApplication: (id: string, payload: RevertClaudeCodeApplicationPayload) =>
    request<ClaudeCodeApplicationView>(`/api/platforms/claude-code/applications/${id}/revert`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  exportClaudeCodeBackup: (includeApiKeys: boolean) =>
    request<ClaudeCodeBackupPayload>(
      `/api/platforms/claude-code/export-backup${includeApiKeys ? "?includeApiKeys=1" : ""}`,
    ),
  importClaudeCodeBackup: (payload: ClaudeCodeBackupPayload) =>
    request<ImportClaudeCodeBackupResult>("/api/platforms/claude-code/import-backup", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
