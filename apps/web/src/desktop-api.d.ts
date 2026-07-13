import type {
  ChatGptDesktopProfileInput,
  ChatGptAccountStatusResult,
  ChatGptAppConfigureResult,
  ChatGptAppSyncCheckResult,
  ChatGptExportBackupResult,
  ChatGptImportBackupResult,
  ChatGptSessionSummary,
} from "@squirrel-switch/shared";

declare global {
  interface DesktopActionResult {
    error: string | null;
  }

  interface OpenDesktopWindowResult extends DesktopActionResult {
    opened: boolean;
  }

  interface CloseDesktopWindowResult extends DesktopActionResult {
    closed: boolean;
  }

  interface ClearChatGptSessionResult extends DesktopActionResult {
    cleared: boolean;
  }

  interface ChatGptTaskNoticeResult extends DesktopActionResult {
    cleared?: boolean;
    shown?: boolean;
  }

  interface ChatGptSessionSummaryResult extends DesktopActionResult {
    summary: ChatGptSessionSummary | null;
  }

  interface ChatGptAccountStatusDesktopResult extends DesktopActionResult {
    status: ChatGptAccountStatusResult | null;
  }

  interface ChatGptAppSyncCheckDesktopResult extends DesktopActionResult {
    result: ChatGptAppSyncCheckResult | null;
  }

  interface ChatGptAppConfigureDesktopResult extends DesktopActionResult {
    result: ChatGptAppConfigureResult | null;
  }

  interface ChatGptExportDesktopResult extends DesktopActionResult {
    result: ChatGptExportBackupResult | null;
  }

  interface ChatGptImportDesktopResult extends DesktopActionResult {
    result: ChatGptImportBackupResult | null;
  }

  interface SquirrelSwitchDesktopApi {
    openLoginUrl: (sessionId: string, url: string) => Promise<OpenDesktopWindowResult>;
    openChatGpt: (profile: ChatGptDesktopProfileInput) => Promise<OpenDesktopWindowResult>;
    closeChatGpt: (profile: ChatGptDesktopProfileInput) => Promise<CloseDesktopWindowResult>;
    openUrlInChatGpt: (
      profile: ChatGptDesktopProfileInput,
      url: string,
    ) => Promise<OpenDesktopWindowResult>;
    showChatGptTaskNotice: (input: {
      blocking?: boolean;
      message: string;
      preferredUrl?: string;
      profile: ChatGptDesktopProfileInput;
    }) => Promise<ChatGptTaskNoticeResult>;
    clearChatGptTaskNotice: (input: {
      preferredUrl?: string;
      profile: ChatGptDesktopProfileInput;
    }) => Promise<ChatGptTaskNoticeResult>;
    clearChatGptSession: (
      profile: ChatGptDesktopProfileInput,
    ) => Promise<ClearChatGptSessionResult>;
    getChatGptSessionSummary: (
      profile: ChatGptDesktopProfileInput,
    ) => Promise<ChatGptSessionSummaryResult>;
    getChatGptAccountStatus: (
      input: ChatGptDesktopProfileInput & { accountId: string | null; closeAfterCheck?: boolean },
    ) => Promise<ChatGptAccountStatusDesktopResult>;
    checkChatGptAppSync: (
      input: { profile: ChatGptDesktopProfileInput; requireActive?: boolean },
    ) => Promise<ChatGptAppSyncCheckDesktopResult>;
    configureChatGptAppSync: (
      input: { profile: ChatGptDesktopProfileInput; configId: string },
    ) => Promise<ChatGptAppConfigureDesktopResult>;
    exportChatGptBackup: (payload: {
      profiles: ChatGptDesktopProfileInput[];
      password: string;
    }) => Promise<ChatGptExportDesktopResult>;
    importChatGptBackup: (payload: {
      backupText: string;
      password: string;
    }) => Promise<ChatGptImportDesktopResult>;
  }

  interface Window {
    squirrelSwitchDesktop?: SquirrelSwitchDesktopApi;
  }
}

export {};
