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
  scopeType: ChatGptAppScopeType;
  targetProfileIds?: string[];
  enabled: boolean;
}

export interface UpdateChatGptAppSyncStatusPayload {
  status: Extract<ChatGptAppSyncStatus, "pending" | "synced" | "failed" | "skipped">;
  error?: string | null;
}
