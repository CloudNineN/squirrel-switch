export type ChatGptAppConfigType = "official_app" | "custom_mcp";
export type ChatGptAppAuthType = "none" | "bearer" | "oauth" | "official" | "unknown";
export type ChatGptAppScopeType = "all_profiles" | "specific_profiles";
export type ChatGptAppSyncStatus = "pending" | "synced" | "failed" | "unchecked" | "skipped";

export interface ChatGptAppConfigProfileView {
  id: string;
  displayName: string;
  linkedCodexEmail: string | null;
  accountEmail: string | null;
  accountName: string | null;
  accountId: string | null;
  planLabel: string | null;
  browserKind: "chrome" | "edge" | "custom" | null;
  browserExecutablePath: string | null;
  browserProfileDir: string | null;
}

export interface ChatGptAppSyncStateView {
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

export interface ChatGptAppConfigView {
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

export interface ChatGptAppConfigManagementState {
  configs: ChatGptAppConfigView[];
  profiles: ChatGptAppConfigProfileView[];
}

export interface UpsertChatGptAppConfigPayload {
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

export interface UpdateChatGptAppSyncStatusPayload {
  status: Extract<ChatGptAppSyncStatus, "pending" | "synced" | "failed" | "skipped">;
  error?: string | null;
  remoteConnectorId?: string | null;
  remoteLinkId?: string | null;
}

export interface ChatGptAppConnectorLinkView {
  id: string | null;
  name: string | null;
  connectorId: string | null;
  connectorName: string | null;
  connectorType: string | null;
  authStatus: string | null;
  authType: string | null;
  visibility: string | null;
  baseUrl: string | null;
  service: string | null;
}

export interface ChatGptAppSyncCheckResult {
  checkedAt: number;
  links: ChatGptAppConnectorLinkView[];
}

export interface ChatGptAppConfigureResult {
  configured: boolean;
  checkedAt: number;
  message: string | null;
  links: ChatGptAppConnectorLinkView[];
}
